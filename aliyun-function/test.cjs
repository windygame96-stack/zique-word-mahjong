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

  const started = await invoke("POST", { body: { action: "start", code, playerKey: "p1" } });
  assert.equal(started.json.status, "playing");
  assert.equal(started.json.hand.length, 14);

  const discarded = await invoke("POST", { body: { action: "discard", code, playerKey: "p1", tileIndex: 0 } });
  assert.equal(discarded.json.phase, "draw");
  assert.equal(discarded.json.currentPlayerId, "p2");

  const drawn = await invoke("POST", { body: { action: "draw", code, playerKey: "p2" } });
  assert.equal(drawn.json.phase, "discard");
  assert.equal(drawn.json.hand.length, 14);

  const won = await invoke("POST", { body: { action: "win", code, playerKey: "p2", sentenceIndices: [0, 1, 2, 3] } });
  assert.equal(won.json.status, "finished");
  assert.equal(won.json.winnerId, "p2");
  assert.equal(won.json.winningSentence.length, 4);
});
