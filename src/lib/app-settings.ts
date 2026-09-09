import prisma from "@/lib/prisma";

// Minimal settings store using raw SQL to avoid Prisma schema changes.
// It lazily creates the table `app_settings` if it does not exist, concurrency-safe.

let ensureOncePromise: Promise<void> | null = null;
async function ensureTableOnce(): Promise<void> {
  if (ensureOncePromise) return ensureOncePromise;
  ensureOncePromise = (async () => {
    try {
      // Serialize DDL using a Postgres advisory lock to avoid concurrent DDL conflicts
      await prisma.$executeRawUnsafe(
        `SELECT pg_advisory_lock(hashtext('cid_ai_app_settings_ddl_lock'));`
      );
      try {
        await prisma.$executeRawUnsafe(
          `CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );`
        );
        await prisma.$executeRawUnsafe(
          `CREATE OR REPLACE FUNCTION set_updated_at()
           RETURNS TRIGGER AS $$
           BEGIN
             NEW.updated_at = NOW();
             RETURN NEW;
           END;
           $$ LANGUAGE plpgsql;`
        );
        await prisma.$executeRawUnsafe(
          `DO $$
           BEGIN
             IF NOT EXISTS (
               SELECT 1 FROM pg_trigger WHERE tgname = 'app_settings_set_updated_at'
             ) THEN
               CREATE TRIGGER app_settings_set_updated_at
               BEFORE UPDATE ON app_settings
               FOR EACH ROW EXECUTE FUNCTION set_updated_at();
             END IF;
           END $$;`
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `SELECT pg_advisory_unlock(hashtext('cid_ai_app_settings_ddl_lock'));`
        );
      }
    } catch (e) {
      // Do not block; log and continue. If permissions disallow DDL, reads will just 404.
      console.warn("[APP-SETTINGS] ensureTable failed (non-fatal)", e);
    }
  })();
  return ensureOncePromise;
}

// In-memory cache with TTL to avoid DB queries on every chat message
const settingsCache = new Map<string, { value: string | null; expiresAt: number }>();
const SETTINGS_CACHE_TTL_MS = 60_000; // 60 seconds

export async function getSetting(key: string): Promise<string | null> {
  // Check cache first
  const cached = settingsCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  try {
    await ensureTableOnce();
    const rows: Array<{ value: string }> = await prisma.$queryRawUnsafe(
      `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
      key
    );
    const value = rows && rows.length > 0 ? rows[0].value : null;
    settingsCache.set(key, { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
    return value;
  } catch (e) {
    console.warn("[APP-SETTINGS] getSetting failed", e);
    return null;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensureTableOnce();
  await prisma.$executeRawUnsafe(
    `INSERT INTO app_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    key,
    value
  );
  // Invalidate cache for this key
  settingsCache.delete(key);
}

export async function getSettingInt(key: string, defaultValue: number): Promise<number> {
  const v = await getSetting(key);
  if (v == null) return defaultValue;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.floor(n);
}

export async function setSettingInt(key: string, value: number): Promise<void> {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Value must be a positive integer");
  }
  await setSetting(key, String(Math.floor(value)));
}
