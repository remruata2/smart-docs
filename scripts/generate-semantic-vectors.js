#!/usr/bin/env node

/**
 * Generates semantic vector embeddings for documents in file_list
 * using Google Gemini text-embedding-004 (outputDimensionality: 384).
 *
 * Usage:
 *   npm run generate-semantic-vectors          # only processes rows where semantic_vector IS NULL
 *   npm run generate-semantic-vectors -- --force # re-embeds ALL rows
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Load .env from project root if present
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const k = trimmed.substring(0, idx).trim();
      let v = trimmed.substring(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) {
        process.env[k] = v;
      }
    }
  }
}

const { PrismaClient } = require("../src/generated/prisma");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const prisma = new PrismaClient();

function decryptSecret(serialized) {
  const keyStr = process.env.API_KEYS_ENCRYPTION_KEY || "";
  if (!keyStr) return null;

  let keyBuf;
  try {
    const b = Buffer.from(keyStr, "base64");
    if (b.length === 32) keyBuf = b;
  } catch {}
  if (!keyBuf) {
    try {
      const h = Buffer.from(keyStr, "hex");
      if (h.length === 32) keyBuf = h;
    } catch {}
  }
  if (!keyBuf) {
    const u = Buffer.from(keyStr, "utf8");
    if (u.length === 32) keyBuf = u;
  }
  if (!keyBuf) return null;

  try {
    const [ivB64, encB64, tagB64] = serialized.split(".");
    if (!ivB64 || !encB64 || !tagB64) return null;
    const iv = Buffer.from(ivB64, "base64");
    const ciphertext = Buffer.from(encB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch (e) {
    return null;
  }
}

async function getApiKey() {
  try {
    const keyRow = await prisma.aiApiKey.findFirst({
      where: { active: true, provider: "gemini" },
      orderBy: [{ priority: "desc" }, { last_used_at: "asc" }, { id: "asc" }],
    });
    if (keyRow && keyRow.api_key_enc) {
      const decrypted = decryptSecret(keyRow.api_key_enc);
      if (decrypted) return decrypted;
    }
  } catch (e) {
    console.warn("Could not load API key from DB:", e.message);
  }
  return process.env.GEMINI_API_KEY || null;
}

async function main() {
  const force = process.argv.includes("--force") || process.argv.includes("--all");
  console.log(`\n🚀 Starting semantic vector generation (forceAll=${force})...`);

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("❌ No Gemini API key found. Add an active key in Admin settings or set GEMINI_API_KEY in .env");
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

  const total = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM file_list`))[0].c;
  const missingBefore = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM file_list WHERE semantic_vector IS NULL`
  ))[0].c;

  console.log(`📊 Total documents: ${total} | Missing semantic_vector: ${missingBefore}`);

  const sql = force
    ? `SELECT id, note, title, category, file_no, entry_date FROM file_list ORDER BY id ASC`
    : `SELECT id, note, title, category, file_no, entry_date FROM file_list WHERE semantic_vector IS NULL ORDER BY id ASC`;

  const records = await prisma.$queryRawUnsafe(sql);
  console.log(`📦 Documents to process: ${records.length}`);

  if (records.length === 0) {
    console.log("✅ All documents already have semantic vectors! (Use --force to re-generate)");
    await prisma.$disconnect();
    return;
  }

  let successCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const parts = [r.note, r.title, r.category, r.file_no, r.entry_date]
      .filter((v) => !!v && String(v).trim().length > 0);
    const content = parts.join(" ").replace(/\n+/g, " ").trim().substring(0, 2048);

    if (!content) {
      console.log(`  [${i + 1}/${records.length}] Skipping file ID ${r.id} (${r.file_no || "unnamed"}) — no text content`);
      skippedCount++;
      continue;
    }

    try {
      const res = await model.embedContent({
        content: { role: "user", parts: [{ text: content }] },
        outputDimensionality: 384,
      });

      const embedding = res.embedding.values;
      if (!embedding || embedding.length !== 384) {
        throw new Error(`Unexpected embedding dimension: ${embedding?.length}`);
      }

      await prisma.$executeRawUnsafe(
        `UPDATE file_list SET semantic_vector = $1::vector WHERE id = $2`,
        embedding,
        r.id
      );

      successCount++;
      console.log(`  [${i + 1}/${records.length}] ✅ File ID ${r.id} (${r.file_no || "unnamed"}): "${(r.title || "").substring(0, 40)}" (384-dim)`);

      // Gentle pause to respect API rate limits
      if (i < records.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    } catch (err) {
      failCount++;
      console.error(`  [${i + 1}/${records.length}] ❌ File ID ${r.id} failed:`, err.message);
    }
  }

  const missingAfter = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM file_list WHERE semantic_vector IS NULL`
  ))[0].c;

  console.log(`\n🎉 Semantic vector generation complete!`);
  console.log(`   Success: ${successCount} | Skipped: ${skippedCount} | Failed: ${failCount} | Remaining NULL: ${missingAfter}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ Fatal error:", e);
  await prisma.$disconnect();
  process.exit(1);
});
