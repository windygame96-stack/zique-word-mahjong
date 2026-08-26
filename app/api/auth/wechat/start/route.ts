import { ensureDatabase, getD1 } from "../../../../../lib/database";
import { getWechatConfig } from "../../../../../lib/auth";

export async function GET(request: Request) {
  const config = getWechatConfig();
  const source = new URL(request.url);
  if (!config.appId || !config.appSecret) {
    return Response.redirect(new URL("/?auth=wechat_setup_needed", source.origin));
  }
  await ensureDatabase();
  const state = crypto.randomUUID();
  const requestedReturn = source.searchParams.get("returnTo") || "/";
  const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/";
  await getD1().prepare(
    "INSERT INTO oauth_states (state, return_to, expires_at) VALUES (?, ?, ?)",
  ).bind(state, returnTo, Date.now() + 10 * 60 * 1000).run();
  const callback = `${source.origin}/api/auth/wechat/callback`;
  const target = new URL("https://open.weixin.qq.com/connect/qrconnect");
  target.searchParams.set("appid", config.appId);
  target.searchParams.set("redirect_uri", callback);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("scope", "snsapi_login");
  target.searchParams.set("state", state);
  return Response.redirect(`${target.toString()}#wechat_redirect`);
}
