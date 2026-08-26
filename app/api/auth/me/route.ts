import { getSignedInUser, getWechatConfig } from "../../../../lib/auth";

export async function GET(request: Request) {
  const user = await getSignedInUser(request);
  const config = getWechatConfig();
  return Response.json({ user, wechatConfigured: Boolean(config.appId && config.appSecret) });
}
