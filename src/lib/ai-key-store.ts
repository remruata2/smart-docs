import { prisma } from "@/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from "crypto";

// Provider values mirror Prisma enum `Provider`
export type AIProvider = "gemini" | "openai" | "anthropic" | "llamaparse";

// Encryption helpers using AES-256-GCM
// Requires a 32-byte key provided via env API_KEYS_ENCRYPTION_KEY

function getRawEncryptionKey(): Buffer {
  const key = process.env.API_KEYS_ENCRYPTION_KEY || "";
  if (!key) {
    throw new Error(
      "API_KEYS_ENCRYPTION_KEY is not set. Please configure a 32-byte key (base64 or hex)."
    );
  }

  // Try base64, then hex, then plain utf-8 (last resort)
  try {
    const buf = Buffer.from(key, "base64");
    if (buf.length === 32) return buf;
  } catch {}
  try {
    const buf = Buffer.from(key, "hex");
    if (buf.length === 32) return buf;
  } catch {}
  const utf = Buffer.from(key, "utf8");
  if (utf.length === 32) return utf;

  throw new Error(
    "API_KEYS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex)."
  );
}

export function encryptSecret(plaintext: string): string {
  const key = getRawEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // store as base64 parts joined by .
  return [iv.toString("base64"), encrypted.toString("base64"), authTag.toString("base64")].join(".");
}

export function decryptSecret(serialized: string): string {
  const [ivB64, encB64, tagB64] = serialized.split(".");
  if (!ivB64 || !encB64 || !tagB64) throw new Error("Invalid encrypted payload format");
  const key = getRawEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(encB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export type KeySelection = {
  provider: AIProvider;
  keyId?: number;
  model?: string;
};

async function selectActiveKey(provider: AIProvider) {
  // Prefer active keys with higher priority, least recently used first
  // If none, return null to signal fallback
  const key = await prisma.aiApiKey.findFirst({
    where: { provider: provider as any, active: true },
    orderBy: [
      { priority: "desc" },
      { last_used_at: "asc" },
      { id: "asc" },
    ],
  });
  return key;
}

export async function getProviderApiKey(opts: KeySelection): Promise<{
  apiKey: string | null;
  keyId: number | null;
}> {
  // If specific keyId requested, use it if active; else fall back to selection
  if (opts.keyId) {
    const k = await prisma.aiApiKey.findFirst({
      where: { id: opts.keyId, active: true },
    });
    if (k) {
      return { apiKey: decryptSecret(k.api_key_enc), keyId: k.id };
    }
  }

  const key = await selectActiveKey(opts.provider);
  if (key) {
    return { apiKey: decryptSecret(key.api_key_enc), keyId: key.id };
  }
  return { apiKey: null, keyId: null };
}

export async function recordKeyUsage(keyId: number, ok: boolean) {
  try {
    await prisma.aiApiKey.update({
      where: { id: keyId },
      data: {
        last_used_at: new Date(),
        success_count: ok ? { increment: 1 } : undefined,
        error_count: ok ? undefined : { increment: 1 },
      },
    });
  } catch (e) {
    // Swallow usage update errors; do not block primary flow
    console.error("[AI-KEY-STORE] Failed to record key usage", e);
  }
}

// ─── In-memory caches to avoid DB queries on every chat message ───
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

// Cache for active model names (keyed by provider)
let modelNamesCache: { data: string[]; expiresAt: number; provider: string } | null = null;

// Cache for Gemini client (keyed by resolved keyId or "env")
let geminiClientCache: {
  client: GoogleGenerativeAI;
  keyId: number | null;
  cacheKey: string;
  expiresAt: number;
} | null = null;

// Fetch all active model names ordered by priority (desc), then id
export async function getActiveModelNames(provider: AIProvider): Promise<string[]> {
  // Check cache
  if (modelNamesCache && modelNamesCache.provider === provider && Date.now() < modelNamesCache.expiresAt) {
    return modelNamesCache.data;
  }

  try {
    const rows = await prisma.aiModel.findMany({
      where: { provider: provider as any, active: true },
      orderBy: [
        { priority: "desc" },
        { id: "asc" },
      ],
      select: { name: true },
    });
    if (rows.length > 0) {
      const names = rows.map((r) => r.name);
      modelNamesCache = { data: names, provider, expiresAt: Date.now() + CACHE_TTL_MS };
      return names;
    }
  } catch (e) {
    console.error("[AI-MODEL] Failed to list active models from DB", e);
  }
  const fallback = ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-flash-latest", "gemini-3.5-flash-lite"];
  modelNamesCache = { data: fallback, provider, expiresAt: Date.now() + CACHE_TTL_MS };
  return fallback;
}

// Gemini-specific client factory with DB-managed keys and fallback to env
export async function getGeminiClient(opts: KeySelection = { provider: "gemini" }) {
  if (opts.provider !== "gemini") {
    throw new Error("getGeminiClient only supports provider=gemini");
  }

  const cacheKey = opts.keyId ? `db-${opts.keyId}` : "auto";

  // Check cache — reuse if same key selection and not expired
  if (geminiClientCache && geminiClientCache.cacheKey === cacheKey && Date.now() < geminiClientCache.expiresAt) {
    return { client: geminiClientCache.client, keyId: geminiClientCache.keyId };
  }

  const { apiKey, keyId } = await getProviderApiKey({ provider: "gemini", keyId: opts.keyId });
  const fallback = process.env.GEMINI_API_KEY || "";
  const keyToUse = apiKey || fallback;
  if (!keyToUse) {
    throw new Error("No Gemini API key configured. Add a key in admin settings or set GEMINI_API_KEY.");
  }
  const client = new GoogleGenerativeAI(keyToUse);
  console.log(`[AI-KEY] provider=gemini keyId=${keyId ?? "env-fallback"} source=${apiKey ? "db" : "env"}`);

  // Cache for subsequent requests
  geminiClientCache = {
    client,
    keyId,
    cacheKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return { client, keyId };
}

// Utility to create/update keys (to be used by admin APIs)
export async function upsertApiKey(params: {
  id?: number;
  provider: AIProvider;
  label: string;
  apiKeyPlain: string;
  active?: boolean;
  priority?: number;
}) {
  const enc = encryptSecret(params.apiKeyPlain);
  if (params.id) {
    return prisma.aiApiKey.update({
      where: { id: params.id },
      data: {
        provider: params.provider as any,
        label: params.label,
        api_key_enc: enc,
        active: params.active ?? true,
        priority: params.priority ?? 0,
      },
    });
  }
  return prisma.aiApiKey.create({
    data: {
      provider: params.provider as any,
      label: params.label,
      api_key_enc: enc,
      active: params.active ?? true,
      priority: params.priority ?? 0,
    },
  });
}

// Check for duplicate plaintext key for a provider by decrypting existing keys.
// This avoids a schema change by enforcing uniqueness at the application layer.
export async function keyExistsWithSameSecret(
  provider: AIProvider,
  apiKeyPlain: string,
  excludeId?: number
): Promise<boolean> {
  const existing = await prisma.aiApiKey.findMany({
    where: { provider: provider as any },
    select: { id: true, api_key_enc: true },
  });
  for (const row of existing) {
    if (excludeId && row.id === excludeId) continue;
    try {
      const plain = decryptSecret(row.api_key_enc);
      if (plain === apiKeyPlain) return true;
    } catch (e) {
      // skip rows that fail to decrypt (e.g., key rotation in progress)
      continue;
    }
  }
  return false;
}
