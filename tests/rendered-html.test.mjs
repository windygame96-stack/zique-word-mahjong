import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("服务端渲染麻将馆页面与元数据", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /字雀麻将馆 · 字雀、川麻与京麻/);
  assert.match(html, /正在找回你的牌桌/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("前端包含三种玩法入口与传统麻将牌桌", async () => {
  const [page, mahjong] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/mahjong-game.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /字雀 · 川麻 · 京麻/);
  assert.match(page, /"sichuan", "川麻"/);
  assert.match(page, /"beijing", "京麻"/);
  assert.match(mahjong, /换三张/);
  assert.match(mahjong, /混儿/);
  assert.match(mahjong, /callGame\("chi"/);
  assert.match(mahjong, /callGame\("peng"/);
  assert.match(mahjong, /callGame\("gang"/);
  assert.match(mahjong, /callGame\("hu"/);
});
