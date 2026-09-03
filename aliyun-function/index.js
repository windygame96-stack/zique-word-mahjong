"use strict";

const TableStore = require("tablestore");

const WORDS = Array.from(
  "我你他她它们今天明天昨天春夏秋冬风雨云雪花月山海星河光夜梦爱想要会能在去来把被让和与可是如果因为所以依然突然偷偷慢慢一起故事世界朋友时间生活快乐自由温柔勇敢浪漫认真可爱有趣等待遇见告别开始结束看见听见相信喜欢变成一只小猫宇宙答案问题喝茶散步发呆唱歌晚安早安真的假的大概也许永远此刻这里那里",
);
const AVATAR_COLORS = new Set(["cinnabar", "jade", "ocean", "plum", "amber", "ink"]);

function makeDeck() {
  const deck = [];
  for (let index = 0; index < 144; index += 1) deck.push(WORDS[index % WORDS.length]);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[next]] = [deck[next], deck[index]];
  }
  return deck;
}

function roomCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function cleanName(value) {
  const name = typeof value === "string" ? value.trim().slice(0, 10) : "";
  return name || "神秘牌友";
}

function cleanAvatarColor(value) {
  return typeof value === "string" && AVATAR_COLORS.has(value) ? value : "cinnabar";
}

function publicState(row, state, playerKey) {
  const me = state.players.find((player) => player.id === playerKey);
  const pendingWin = state.pendingWin ? {
    playerId: state.pendingWin.playerId,
    sentence: state.pendingWin.sentence,
    approvals: Object.values(state.pendingWin.votes).filter((vote) => vote === "approve").length,
    rejections: Object.values(state.pendingWin.votes).filter((vote) => vote === "reject").length,
    votesCast: Object.keys(state.pendingWin.votes).length,
    totalVoters: Math.max(0, state.players.length - 1),
    myVote: state.pendingWin.votes[playerKey] || null,
  } : null;
  return {
    code: row.code,
    revision: row.revision,
    status: state.status,
    phase: state.phase,
    turn: state.turn,
    currentPlayerId: state.players[state.turn]?.id ?? null,
    hostId: state.hostId,
    winnerId: state.winnerId,
    winningSentence: state.winningSentence,
    pendingWin,
    deckCount: state.deck.length,
    discards: state.discards.slice(-40),
    log: state.log.slice(-5),
    players: state.players.map(({ id, name, avatar, avatarUrl, avatarColor, hand, seat }) => ({
      id, name, avatar, avatarUrl, avatarColor: avatarColor || "cinnabar", handCount: hand.length, seat,
    })),
    hand: me?.hand ?? [],
    me: me ? { id: me.id, name: me.name, seat: me.seat } : null,
  };
}

function tableClient(context) {
  const credentials = context?.credentials || {};
  const accessKeyId = credentials.accessKeyId || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = credentials.accessKeySecret || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  const stsToken = credentials.securityToken || process.env.ALIBABA_CLOUD_SECURITY_TOKEN;
  if (!accessKeyId || !accessKeySecret) throw new Error("函数角色没有提供表格存储临时凭证");
  if (!process.env.OTS_ENDPOINT || !process.env.OTS_INSTANCE) throw new Error("缺少 OTS_ENDPOINT 或 OTS_INSTANCE 环境变量");
  return new TableStore.Client({
    accessKeyId,
    secretAccessKey: accessKeySecret,
    stsToken,
    endpoint: process.env.OTS_ENDPOINT,
    instancename: process.env.OTS_INSTANCE,
  });
}

function call(client, method, params) {
  return new Promise((resolve, reject) => {
    client[method](params, (error, data) => error ? reject(error) : resolve(data));
  });
}

let tableReadyPromise;

function isTableMissing(error) {
  const code = `${error?.code || ""} ${error?.message || ""}`;
  return /OTSObjectNotExist|table.*not.*exist|Requested table does not exist/i.test(code);
}

function isTableAlreadyExists(error) {
  const code = `${error?.code || ""} ${error?.message || ""}`;
  return /OTSObjectAlreadyExist|table.*already.*exist/i.test(code);
}

async function ensureTable(client) {
  const tableName = process.env.OTS_TABLE || "zique_rooms";
  try {
    await call(client, "describeTable", { tableName });
    return;
  } catch (error) {
    if (!isTableMissing(error)) throw error;
  }

  try {
    await call(client, "createTable", {
      tableMeta: {
        tableName,
        primaryKey: [{ name: "code", type: "STRING" }],
      },
      reservedThroughput: { capacityUnit: { read: 0, write: 0 } },
      tableOptions: { timeToLive: 30 * 24 * 60 * 60, maxVersions: 1 },
    });
  } catch (error) {
    if (!isTableAlreadyExists(error)) throw error;
  }
}

function longNumber(value) {
  return value && typeof value.toNumber === "function" ? value.toNumber() : Number(value || 0);
}

async function readRoom(client, code) {
  const result = await call(client, "getRow", {
    tableName: process.env.OTS_TABLE || "zique_rooms",
    primaryKey: [{ code }],
    maxVersions: 1,
  });
  if (!result.row?.attributes?.length) return null;
  const attributes = Object.fromEntries(result.row.attributes.map((column) => [column.columnName, column.columnValue]));
  return {
    code,
    state_json: String(attributes.state_json || ""),
    revision: longNumber(attributes.revision),
  };
}

async function createRoom(client, code, state) {
  const now = Date.now();
  await call(client, "putRow", {
    tableName: process.env.OTS_TABLE || "zique_rooms",
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_NOT_EXIST, null),
    primaryKey: [{ code }],
    attributeColumns: [
      { state_json: JSON.stringify(state) },
      { revision: TableStore.Long.fromNumber(0) },
      { created_at: TableStore.Long.fromNumber(now) },
      { updated_at: TableStore.Long.fromNumber(now) },
    ],
  });
}

async function saveRoom(client, row, state) {
  const revisionCondition = new TableStore.SingleColumnCondition(
    "revision",
    TableStore.Long.fromNumber(row.revision),
    TableStore.ComparatorType.EQUAL,
  );
  revisionCondition.passIfMissing = false;
  await call(client, "updateRow", {
    tableName: process.env.OTS_TABLE || "zique_rooms",
    primaryKey: [{ code: row.code }],
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, revisionCondition),
    updateOfAttributeColumns: [{ PUT: [
      { state_json: JSON.stringify(state) },
      { revision: TableStore.Long.fromNumber(row.revision + 1) },
      { updated_at: TableStore.Long.fromNumber(Date.now()) },
    ] }],
  });
}

async function deleteRoom(client, row) {
  const revisionCondition = new TableStore.SingleColumnCondition(
    "revision",
    TableStore.Long.fromNumber(row.revision),
    TableStore.ComparatorType.EQUAL,
  );
  revisionCondition.passIfMissing = false;
  await call(client, "deleteRow", {
    tableName: process.env.OTS_TABLE || "zique_rooms",
    primaryKey: [{ code: row.code }],
    condition: new TableStore.Condition(TableStore.RowExistenceExpectation.EXPECT_EXIST, revisionCondition),
  });
}

function requestFromEvent(event) {
  const raw = Buffer.isBuffer(event) ? event.toString("utf8") : event;
  const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
  const headers = Object.fromEntries(Object.entries(parsed.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  let body = parsed.body || "";
  if (parsed.isBase64Encoded && body) body = Buffer.from(body, "base64").toString("utf8");
  return {
    method: parsed.requestContext?.http?.method || parsed.httpMethod || "GET",
    path: parsed.requestContext?.http?.path || parsed.rawPath || parsed.path || "/api/game",
    query: parsed.queryParameters || parsed.queryStringParameters || {},
    headers,
    body,
  };
}

function response(origin, statusCode, payload) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://windygame96-stack.github.io,https://www.escapefromhongye.xyz")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "vary": "Origin",
  };
  if (origin && allowedOrigins.includes(origin)) headers["access-control-allow-origin"] = origin;
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function isConditionConflict(error) {
  const code = `${error?.code || ""} ${error?.message || ""}`;
  return /ConditionCheckFail|condition check/i.test(code);
}

async function handle(event, context) {
  const request = requestFromEvent(event);
  const origin = request.headers.origin || "";
  if (request.method === "OPTIONS") return response(origin, 204, {});
  if (!request.path.endsWith("/api/game")) return response(origin, 404, { error: "接口不存在" });

  const client = tableClient(context);
  tableReadyPromise ||= ensureTable(client).catch((error) => {
    tableReadyPromise = undefined;
    throw error;
  });
  await tableReadyPromise;
  if (request.method === "GET") {
    const code = String(request.query.code || "").trim();
    const playerKey = String(request.query.playerKey || "").trim();
    if (!code || !playerKey) return response(origin, 400, { error: "缺少房号或玩家身份" });
    const row = await readRoom(client, code);
    if (!row) return response(origin, 404, { error: "没找到这个房间" });
    const state = JSON.parse(row.state_json);
    if (!state.players.some((player) => player.id === playerKey)) return response(origin, 403, { error: "你还没有加入这个房间" });
    return response(origin, 200, publicState(row, state, playerKey));
  }

  if (request.method !== "POST") return response(origin, 405, { error: "请求方式不支持" });
  let payload;
  try { payload = JSON.parse(request.body || "{}"); }
  catch { return response(origin, 400, { error: "请求内容不是有效 JSON" }); }

  const action = payload.action || "";
  const playerKey = String(payload.playerKey || "").slice(0, 100);
  if (!playerKey) return response(origin, 400, { error: "无法识别你的设备，请刷新后重试" });
  const displayName = cleanName(payload.name);
  const avatar = displayName.slice(0, 1) || "友";
  const avatarColor = cleanAvatarColor(payload.avatarColor);

  if (action === "create") {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = roomCode();
      const state = {
        status: "waiting", hostId: playerKey,
        players: [{ id: playerKey, name: displayName, avatar, avatarUrl: null, avatarColor, hand: [], seat: 0 }],
        deck: [], discards: [], turn: 0, phase: "waiting", winnerId: null, winningSentence: null, pendingWin: null,
        log: [`${displayName} 开了牌桌`],
      };
      try {
        await createRoom(client, code, state);
        return response(origin, 201, publicState({ code, revision: 0 }, state, playerKey));
      } catch (error) {
        if (!isConditionConflict(error) || attempt === 7) throw error;
      }
    }
  }

  const code = String(payload.code || "").trim();
  if (!/^\d{4}$/.test(code)) return response(origin, 400, { error: "请输入 4 位房号" });
  const row = await readRoom(client, code);
  if (!row) return response(origin, 404, { error: "没找到这个房间" });
  const state = JSON.parse(row.state_json);
  let player = state.players.find((item) => item.id === playerKey);

  if (action === "join") {
    if (!player) {
      if (state.status !== "waiting") return response(origin, 400, { error: "牌局已经开始了" });
      if (state.players.length >= 4) return response(origin, 400, { error: "这个房间已经坐满了" });
      player = { id: playerKey, name: displayName, avatar, avatarUrl: null, avatarColor, hand: [], seat: state.players.length };
      state.players.push(player);
      state.log.push(`${displayName} 入座了`);
    } else {
      player.name = displayName;
      player.avatar = avatar;
      player.avatarColor = avatarColor;
    }
  } else {
    if (!player) return response(origin, 403, { error: "你还没有加入这个房间" });
    if (action === "dissolve") {
      if (state.hostId !== playerKey) return response(origin, 403, { error: "只有房主可以解散房间" });
      try { await deleteRoom(client, row); }
      catch (error) {
        if (isConditionConflict(error)) return response(origin, 409, { error: "牌桌状态刚刚变化，请再试一次" });
        throw error;
      }
      return response(origin, 200, { dissolved: true, code });
    } else if (action === "start" || action === "restart") {
      if (state.hostId !== playerKey) return response(origin, 400, { error: "只有房主可以开局" });
      if (state.players.length < 2) return response(origin, 400, { error: "至少要有两个人才能开局" });
      const deck = makeDeck();
      state.players.forEach((item) => { item.hand = deck.splice(0, 13); });
      state.players[0].hand.push(deck.pop());
      state.deck = deck; state.discards = []; state.turn = 0; state.phase = "discard"; state.status = "playing";
      state.winnerId = null; state.winningSentence = null; state.pendingWin = null; state.log = ["牌局开始，房主先出牌"];
    } else if (action === "draw") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || state.phase !== "draw") return response(origin, 400, { error: "现在还不能摸牌" });
      const tile = state.deck.pop();
      if (!tile) { state.status = "finished"; state.phase = "finished"; state.log.push("牌山见底，这局流局"); }
      else { player.hand.push(tile); state.phase = "discard"; state.log.push(`${player.name} 摸了一张牌`); }
    } else if (action === "discard") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || state.phase !== "discard") return response(origin, 400, { error: "现在还不能出牌" });
      const tileIndex = Number(payload.tileIndex);
      if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= player.hand.length) return response(origin, 400, { error: "请选择一张有效的牌" });
      const [tile] = player.hand.splice(tileIndex, 1);
      state.discards.push(tile); state.log.push(`${player.name} 打出了「${tile}」`);
      state.turn = (state.turn + 1) % state.players.length; state.phase = "draw";
    } else if (action === "win") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || state.phase !== "discard") return response(origin, 400, { error: "只有轮到你、摸牌后才能胡" });
      const indices = Array.isArray(payload.sentenceIndices) ? payload.sentenceIndices : [];
      if (indices.length < 4 || new Set(indices).size !== indices.length) return response(origin, 400, { error: "至少选四张不同的字牌组成一句话" });
      if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= player.hand.length)) return response(origin, 400, { error: "句子里有无效的牌" });
      const sentence = indices.map((index) => player.hand[index]).join("");
      state.phase = "voting";
      state.pendingWin = { playerId: playerKey, sentence, votes: {} };
      state.log.push(`${player.name} 用「${sentence}」申请胡牌，等待牌友判定`);
    } else if (action === "voteWin") {
      if (state.status !== "playing" || state.phase !== "voting" || !state.pendingWin) return response(origin, 400, { error: "现在没有待判定的胡牌" });
      if (state.pendingWin.playerId === playerKey) return response(origin, 400, { error: "不能判定自己的胡牌" });
      if (state.pendingWin.votes[playerKey]) return response(origin, 400, { error: "你已经投过票了" });
      if (typeof payload.approve !== "boolean") return response(origin, 400, { error: "请选择算胡或不算胡" });
      state.pendingWin.votes[playerKey] = payload.approve ? "approve" : "reject";
      const voters = state.players.filter((item) => item.id !== state.pendingWin.playerId);
      const votes = Object.values(state.pendingWin.votes);
      if (votes.length === voters.length) {
        const approvals = votes.filter((vote) => vote === "approve").length;
        const claimant = state.players.find((item) => item.id === state.pendingWin.playerId);
        const sentence = state.pendingWin.sentence;
        if (approvals > voters.length / 2) {
          state.status = "finished"; state.phase = "finished"; state.winnerId = state.pendingWin.playerId; state.winningSentence = sentence;
          state.log.push(`牌友判定通过，${claimant?.name || "牌友"} 用「${sentence}」胡了`);
        } else {
          state.phase = "discard";
          state.log.push(`牌友判定未通过，「${sentence}」不算胡`);
        }
        state.pendingWin = null;
      } else {
        state.log.push(`${player.name} 已完成胡牌判定`);
      }
    } else {
      return response(origin, 400, { error: "未知操作" });
    }
  }

  try { await saveRoom(client, row, state); }
  catch (error) {
    if (isConditionConflict(error)) return response(origin, 409, { error: "刚好有人同时出牌，请再试一次" });
    throw error;
  }
  return response(origin, 200, publicState({ ...row, revision: row.revision + 1 }, state, playerKey));
}

exports.handler = (event, context, callback) => {
  handle(event, context)
    .then((result) => callback(null, result))
    .catch((error) => {
      console.error("zique function failed", error);
      callback(null, response("", 500, { error: "牌桌服务暂时不可用" }));
    });
};
