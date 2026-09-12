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
