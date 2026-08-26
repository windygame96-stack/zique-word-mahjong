export async function POST() {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": "zique_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" },
  });
}
