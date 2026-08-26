import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error("牌局数据库暂不可用");
  return binding;
}

let ready: Promise<void> | null = null;

export function ensureDatabase() {
  if (!ready) {
    const db = getD1();
    ready = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        state_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        wechat_openid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        avatar_url TEXT,
        created_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        return_to TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`),
    ]).then(() => undefined).catch((error) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}
