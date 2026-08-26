import { ensureDatabase, getD1 } from "../../../../../lib/database";
import { getWechatConfig, sessionCookie } from "../../../../../lib/auth";

type TokenResult = { access_token?: string; openid?: string; errcode?: number };
type ProfileResult = { nickname?: string; headimgurl?: string; errcode?: number };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = () => Response.redirect(new URL("/?auth=wechat_failed", url.origin));
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const config = getWechatConfig();
  if (!code || !state || !config.appId || !config.appSecret) return fail();
  await ensureDatabase();
  const saved = await getD1().prepare(
    "SELECT return_to FROM oauth_states WHERE state = ? AND expires_at > ?",
  ).bind(state, Date.now()).first<{ return_to: string }>();
  if (!saved) return fail();
  await getD1().prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();

  const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  tokenUrl.searchParams.set("appid", config.appId);
  tokenUrl.searchParams.set("secret", config.appSecret);
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  const token = await fetch(tokenUrl).then((response) => response.json() as Promise<TokenResult>);
  if (!token.access_token || !token.openid || token.errcode) return fail();

  const profileUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
  profileUrl.searchParams.set("access_token", token.access_token);
  profileUrl.searchParams.set("openid", token.openid);
  profileUrl.searchParams.set("lang", "zh_CN");
  const profile = await fetch(profileUrl).then((response) => response.json() as Promise<ProfileResult>);
  if (profile.errcode) return fail();

  const existing = await getD1().prepare(
    "SELECT id FROM accounts WHERE wechat_openid = ?",
  ).bind(token.openid).first<{ id: string }>();
  const accountId = existing?.id || crypto.randomUUID();
  const name = (profile.nickname || "微信牌友").slice(0, 20);
  await getD1().prepare(`
    INSERT INTO accounts (id, wechat_openid, name, avatar_url, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(wechat_openid) DO UPDATE SET name = excluded.name, avatar_url = excluded.avatar_url
  `).bind(accountId, token.openid, name, profile.headimgurl || null, Date.now()).run();
  const session = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  await getD1().prepare(
    "INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)",
  ).bind(session, accountId, Date.now() + 30 * 24 * 60 * 60 * 1000).run();
  return new Response(null, {
    status: 302,
    headers: { Location: new URL(saved.return_to, url.origin).toString(), "Set-Cookie": sessionCookie(session) },
  });
}
