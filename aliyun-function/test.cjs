"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const TableStore = require("tablestore");

const rows = new Map();

function columnsToObject(columns) {
  return Object.fromEntries(columns.map((column) => {
    const [name, value] = Object.entries(column).find(([key]) => key !== "timestamp");
    return [name, value];
  }));
}

TableStore.Client = class FakeClient {
  describeTable(params, callback) {
    callback(null, { tableMeta: { tableName: params.tableName } });
  }

  createTable(params, callback) {
    callback(null, { tableMeta: params.tableMeta });
  }

  getRow(params, callback) {
    const code = params.primaryKey[0].code;
    const row = rows.get(code);
    callback(null, { row: row ? {
      primaryKey: [{ name: "code", value: code }],
      attributes: Object.entries(row).map(([columnName, columnValue]) => ({ columnName, columnValue })),
    } : {} });
  }

  putRow(params, callback) {
    const code = params.primaryKey[0].code;
    if (rows.has(code)) return callback(Object.assign(new Error("condition check failed"), { code: "OTSConditionCheckFail" }));
    rows.set(code, columnsToObject(params.attributeColumns));
    callback(null, {});
  }

  updateRow(params, callback) {
    const code = params.primaryKey[0].code;
    const updates = columnsToObject(params.updateOfAttributeColumns[0].PUT);
    rows.set(code, { ...rows.get(code), ...updates });
    callback(null, {});
  }

};

process.env.OTS_ENDPOINT = "https://example.invalid";
process.env.OTS_INSTANCE = "zique-test";
process.env.OTS_TABLE = "zique_rooms";

const { handler } = require("./index.js");
const context = { credentials: { accessKeyId: "test", accessKeySecret: "test", securityToken: "test" } };

function invoke(method, { query = {}, body } = {}) {
  const event = JSON.stringify({
    requestContext: { http: { method, path: "/api/game" } },
    queryParameters: query,
    headers: { origin: "https://windygame96-stack.github.io" },
    body: body ? JSON.stringify(body) : "",
  });
  return new Promise((resolve, reject) => {
    handler(event, context, (error, result) => error ? reject(error) : resolve({ ...result, json: JSON.parse(result.body || "{}") }));
  });
}

test("两名玩家可以创建、加入并完成一局", async () => {
  const created = await invoke("POST", { body: { action: "create", playerKey: "p1", name: "甲" } });
  assert.equal(created.statusCode, 201);
  assert.match(created.json.code, /^\d{4}$/);
  const code = created.json.code;

  const fetched = await invoke("GET", { query: { code, playerKey: "p1" } });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json.players.length, 1);

  const joined = await invoke("POST", { body: { action: "join", code, playerKey: "p2", name: "乙", avatarColor: "jade" } });
  assert.equal(joined.json.players.length, 2);

  const renamed = await invoke("POST", { body: { action: "rename", code, playerKey: "p2", name: "乙同学", avatarColor: "jade" } });
  assert.equal(renamed.json.me.name, "乙同学");

  const started = await invoke("POST", { body: { action: "start", code, playerKey: "p1" } });
  assert.equal(started.json.status, "playing");
  assert.equal(started.json.hand.length, 14);

  const discarded = await invoke("POST", { body: { action: "discard", code, playerKey: "p1", tileIndex: 0 } });
  assert.equal(discarded.json.phase, "claim");
  assert.equal(discarded.json.currentPlayerId, "p2");
  assert.equal(discarded.json.lastDiscard.playerId, "p1");

  const ownDiscard = await invoke("POST", { body: { action: "eat", code, playerKey: "p1" } });
  assert.equal(ownDiscard.statusCode, 400);

  const eaten = await invoke("POST", { body: { action: "eat", code, playerKey: "p2" } });
  assert.equal(eaten.json.phase, "discard");
  assert.equal(eaten.json.currentPlayerId, "p2");
  assert.equal(eaten.json.hand.length, 14);
  assert.equal(eaten.json.discards.length, 0);

  const cannotDrawAfterEating = await invoke("POST", { body: { action: "draw", code, playerKey: "p2" } });
  assert.equal(cannotDrawAfterEating.statusCode, 400);

  const discardedAfterEating = await invoke("POST", { body: { action: "discard", code, playerKey: "p2", tileIndex: 0 } });
  assert.equal(discardedAfterEating.json.phase, "claim");
  assert.equal(discardedAfterEating.json.currentPlayerId, "p1");

  const drawn = await invoke("POST", { body: { action: "draw", code, playerKey: "p1" } });
  assert.equal(drawn.json.phase, "discard");
  assert.equal(drawn.json.hand.length, 14);

  const claimed = await invoke("POST", { body: { action: "win", code, playerKey: "p1", sentenceIndices: [0, 1, 2, 3] } });
  assert.equal(claimed.json.status, "playing");
  assert.equal(claimed.json.phase, "voting");
  assert.equal(claimed.json.pendingWin.playerId, "p1");

  const selfVote = await invoke("POST", { body: { action: "voteWin", code, playerKey: "p1", approve: true } });
  assert.equal(selfVote.statusCode, 400);

  const won = await invoke("POST", { body: { action: "voteWin", code, playerKey: "p2", approve: true } });
  assert.equal(won.json.status, "finished");
  assert.equal(won.json.winnerId, "p1");
  assert.equal(won.json.winningSentence.length, 4);

  const unauthorized = await invoke("POST", { body: { action: "dissolve", code, playerKey: "p2" } });
  assert.equal(unauthorized.statusCode, 403);

  const dissolved = await invoke("POST", { body: { action: "dissolve", code, playerKey: "p1" } });
  assert.equal(dissolved.statusCode, 200);
  assert.equal(dissolved.json.dissolved, true);

  const missing = await invoke("GET", { query: { code, playerKey: "p1" } });
  assert.equal(missing.statusCode, 404);
});

function threeSameSuitIndices(hand) {
  for (const suit of ["m", "p", "s"]) {
    const indices = hand.map((tile, index) => tile.startsWith(suit) ? index : -1).filter((index) => index >= 0);
    if (indices.length >= 3) return indices.slice(0, 3);
  }
  throw new Error("没有可换出的三张同门牌");
}

async function createFourPlayerRoom(variant, prefix) {
  const ids = [0, 1, 2, 3].map((index) => `${prefix}-${index}`);
  const created = await invoke("POST", { body: { action: "create", variant, playerKey: ids[0], name: "东家" } });
  const code = created.json.code;
  for (let index = 1; index < ids.length; index += 1) {
    await invoke("POST", { body: { action: "join", code, playerKey: ids[index], name: `牌友${index}` } });
  }
  return { code, ids };
}

test("川麻完成换三张与定缺流程", async () => {
  const { code, ids } = await createFourPlayerRoom("sichuan", "sc");
  const started = await invoke("POST", { body: { action: "start", code, playerKey: ids[0] } });
  assert.equal(started.json.variant, "sichuan");
  assert.equal(started.json.phase, "exchange");
  assert.equal(started.json.deckCount, 55);

  let latest;
  for (const id of ids) {
    const view = await invoke("GET", { query: { code, playerKey: id } });
    latest = await invoke("POST", { body: { action: "exchange", code, playerKey: id, tileIndices: threeSameSuitIndices(view.json.hand) } });
  }
  assert.equal(latest.json.phase, "dingque");
  for (const [index, id] of ids.entries()) {
    latest = await invoke("POST", { body: { action: "dingque", code, playerKey: id, suit: ["m", "p", "s", "m"][index] } });
  }
  assert.equal(latest.json.phase, "discard");
  assert.equal(latest.json.currentPlayerId, ids[0]);
});

test("京麻开局翻出上滚混儿", async () => {
  const { code, ids } = await createFourPlayerRoom("beijing", "bj");
  const started = await invoke("POST", { body: { action: "start", code, playerKey: ids[0] } });
  assert.equal(started.json.variant, "beijing");
  assert.equal(started.json.phase, "discard");
  assert.equal(started.json.deckCount, 82);
  assert.match(started.json.hunIndicator, /^[mpsz]\d$/);
  assert.match(started.json.hunTile, /^[mpsz]\d$/);
});

test("京麻碰牌优先于吃牌，过牌后才可吃", async () => {
  const { code, ids } = await createFourPlayerRoom("beijing", "priority");
  await invoke("POST", { body: { action: "start", code, playerKey: ids[0] } });
  const stored = rows.get(code);
  const state = JSON.parse(stored.state_json);
  state.hunTile = "z7";
  state.phase = "discard";
  state.turn = 0;
  state.players[0].hand = ["m3", "m4", "m5", "m7", "p1", "p3", "p5", "p7", "s1", "s3", "s5", "s7", "z1", "z3"];
  state.players[1].hand = ["m1", "m2", "m5", "m7", "p1", "p3", "p5", "p7", "s1", "s3", "s5", "z1", "z3"];
  state.players[2].hand = ["m3", "m3", "m5", "m7", "p1", "p3", "p5", "p7", "s1", "s3", "s5", "z1", "z3"];
  state.players[3].hand = ["m1", "m4", "m7", "p1", "p4", "p7", "s1", "s4", "s7", "z1", "z2", "z3", "z5"];
  stored.state_json = JSON.stringify(state);

  const discarded = await invoke("POST", { body: { action: "discard", code, playerKey: ids[0], tileIndex: 0 } });
  assert.equal(discarded.json.phase, "claim");
  const earlyChi = await invoke("POST", { body: { action: "chi", code, playerKey: ids[1], tiles: ["m1", "m2"] } });
  assert.equal(earlyChi.statusCode, 400);
  assert.match(earlyChi.json.error, /碰、杠或胡/);
  const passed = await invoke("POST", { body: { action: "pass", code, playerKey: ids[2] } });
  assert.equal(passed.statusCode, 200);
  const eaten = await invoke("POST", { body: { action: "chi", code, playerKey: ids[1], tiles: ["m1", "m2"] } });
  assert.equal(eaten.statusCode, 200);
  assert.equal(eaten.json.phase, "discard");
  assert.equal(eaten.json.players.find((player) => player.id === ids[1]).melds[0].type, "chi");
});
