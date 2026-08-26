import { env } from "cloudflare:workers";
import { ensureDatabase, getD1 } from "./database";

export type SignedInUser = { id: string; name: string; avatarUrl: string | null };

export function getWechatConfig() {
  const runtime = env as unknown as {
    WECHAT_APP_ID?: string;
    WECHAT_APP_SECRET?: string;
  };
  return {
    appId: runtime.WECHAT_APP_ID?.trim() || null,
    appSecret: runtime.WECHAT_APP_SECRET?.trim() || null,
  };
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function getSignedInUser(request: Request): Promise<SignedInUser | null> {
  const token = cookieValue(request, "zique_session");
  if (!token) return null;
  await ensureDatabase();
  const row = await getD1().prepare(`
    SELECT accounts.id, accounts.name, accounts.avatar_url
    FROM sessions JOIN accounts ON accounts.id = sessions.account_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).bind(token, Date.now()).first<{ id: string; name: string; avatar_url: string | null }>();
  return row ? { id: row.id, name: row.name, avatarUrl: row.avatar_url } : null;
}

export function sessionCookie(token: string) {
  return `zique_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
}
