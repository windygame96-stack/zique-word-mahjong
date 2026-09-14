"use strict";

const TableStore = require("tablestore");
const {
  SUITS,
  chiOptions,
  countTile,
  isSameSuitSelection,
  isWinningHand,
  makeMahjongDeck,
  nextHunTile,
  removeTiles,
  sortTiles,
  tileSuit,
} = require("./mahjong");

const TILE_GROUPS = [
  { copies: 3, chars: ["我", "你", "他", "她", "们", "的", "了", "是", "不", "很", "也", "都", "就", "还", "想", "要", "会", "能", "有", "在", "去", "来", "爱", "好"] },
  { copies: 2, chars: ["看", "听", "说", "吃", "喝", "玩", "做", "给", "让", "把", "和", "跟", "喜", "欢", "真", "太", "更", "又", "正", "可", "以", "一", "起", "家"] },
  { copies: 1, chars: ["今", "天", "明", "晚", "早", "夜", "回", "到", "见", "走", "睡", "快", "慢", "风", "雨", "花", "月", "猫", "茶", "饭", "朋", "友", "心", "开"] },
];
const AVATAR_COLORS = new Set(["cinnabar", "jade", "ocean", "plum", "amber", "ink"]);
const TRUTH_PROMPTS = [
  "最近一次嘴硬但心里认输，是什么时候？",
  "在场的人里，你最想和谁交换一天生活？",
  "你手机里最舍不得删的一张照片是什么？",
  "最近做过最幼稚的一件事是什么？",
  "如果明天不用上班或上学，你最想去哪儿？",
  "你最常假装不在意的事情是什么？",
  "说一个朋友们可能不知道的小习惯。",
  "哪首歌一响，你会立刻想起某个人？",
  "你收到过最让你开心的一句夸奖是什么？",
  "如果能重来一次，你最想改掉哪次决定？",
  "你最想拥有哪一种没什么用的超能力？",
  "最近一次偷偷羡慕别人，是因为什么？",
  "你给别人留下的第一印象，和真实的你差多少？",
  "你最容易被哪一种小事哄开心？",
  "说一件你拖了很久、其实十分钟能做完的事。",
  "如果只能保留三个手机应用，你会留下什么？",
  "你小时候相信过最离谱的事情是什么？",
  "最近有什么话想说却一直没说出口？",
];
const DARE_PROMPTS = [
  "用播音腔朗读刚才的输牌感言十秒钟。",
  "模仿一种动物，让大家猜是什么。",
  "用三个表情包形容自己今天的状态。",
  "给在场每个人各说一句真诚的夸奖。",
  "用一句广告词推销你手边最近的物品。",
  "闭眼画一只猫，展示给大家看。",
  "用方言说一句“下把我一定赢”。",
  "把自己的昵称改成大家指定的称号，保留一局。",
  "即兴唱一句包含“麻将”的歌词。",
  "摆出一个胜利姿势，虽然你刚刚输了。",
  "用五个词编一个离谱的小故事。",
  "模仿一位在场朋友的口头禅，让大家猜。",
  "下一局开始前，全程用敬语说话一分钟。",
  "拍一张手边物品的艺术照，展示给大家。",
  "用一句话给刚才的牌局起一个电影名。",
  "做一个十秒钟的无声表演，让大家猜主题。",
  "用最夸张的语气祝贺本局赢家。",
  "选一个常用词，下一局五分钟内不能说它。",
];

function makeDeck() {
  const deck = TILE_GROUPS.flatMap(({ copies, chars }) => Array.from({ length: copies }, () => chars).flat());
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

function cleanVariant(value) {
  return ["word", "sichuan", "beijing"].includes(value) ? value : "word";
}

function roomVariant(state) {
  return cleanVariant(state.variant);
}

function isMahjongRoom(state) {
  return roomVariant(state) !== "word";
}

function losingPlayerIds(state) {
  if (state.status !== "finished") return [];
  if (roomVariant(state) === "sichuan" && state.winners?.length) {
    const winners = new Set(state.winners.map((item) => item.playerId));
    return state.players.filter((item) => !winners.has(item.id)).map((item) => item.id);
  }
  if (!state.winnerId) return [];
  return state.players.filter((item) => item.id !== state.winnerId).map((item) => item.id);
}

function nextActiveTurn(state, fromSeat) {
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const index = (fromSeat + offset) % state.players.length;
    if (!state.players[index].won) return index;
  }
  return fromSeat;
}

function canMahjongWin(state, player, tiles) {
  if (roomVariant(state) === "sichuan") {
    if (!player.missingSuit || tiles.some((tile) => tileSuit(tile) === player.missingSuit)) return false;
  }
  return isWinningHand(tiles, player.melds?.length || 0, roomVariant(state) === "beijing" ? state.hunTile : null);
}

function mahjongActions(state, playerKey) {
  const player = state.players.find((item) => item.id === playerKey);
  if (!player || player.won || state.status !== "playing") return { availableActions: [], chiOptions: [], gangTiles: [] };
  const actions = [];
  let choices = [];
  let gangTiles = [];
  const isCurrent = state.players[state.turn]?.id === playerKey;

  if (state.phase === "exchange" && !state.exchangeSelections?.[playerKey]) actions.push("exchange");
  if (state.phase === "dingque" && !player.missingSuit) actions.push("dingque");
  if (isCurrent && state.phase === "draw") actions.push("draw");
  if (isCurrent && state.phase === "discard") {
    actions.push("discard");
    if (canMahjongWin(state, player, player.hand)) actions.push("hu");
    gangTiles = [...new Set(player.hand.filter((tile) => countTile(player.hand, tile) === 4))];
    if (gangTiles.length) actions.push("gang");
  }
  if (state.phase === "claim" && state.lastDiscard?.playerId !== playerKey && state.claimPasses?.[playerKey]) {
    if (isCurrent) actions.push("draw");
  } else if (state.phase === "claim" && state.lastDiscard?.playerId !== playerKey) {
    const tile = state.lastDiscard?.tile;
    const openHand = (player.melds || []).some((meld) => meld.type !== "angang");
    if (tile && canMahjongWin(state, player, [...player.hand, tile]) && !(roomVariant(state) === "beijing" && openHand)) actions.push("hu");
    if (tile && countTile(player.hand, tile) >= 2) actions.push("peng");
    if (tile && countTile(player.hand, tile) >= 3) actions.push("gang");
    if (roomVariant(state) === "beijing" && isCurrent && tile) {
      choices = chiOptions(player.hand, tile);
      if (choices.length) actions.push("chi");
    }
    if (actions.some((action) => ["hu", "gang", "peng", "chi"].includes(action))) actions.push("pass");
    if (isCurrent) actions.push("draw");
  }
  return { availableActions: [...new Set(actions)], chiOptions: choices, gangTiles };
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
  const actionState = isMahjongRoom(state) ? mahjongActions(state, playerKey) : { availableActions: [], chiOptions: [], gangTiles: [] };
  return {
    code: row.code,
    revision: row.revision,
    status: state.status,
    variant: roomVariant(state),
    phase: state.phase,
    turn: state.turn,
    currentPlayerId: state.players[state.turn]?.id ?? null,
    hostId: state.hostId,
    winnerId: state.winnerId,
    winningSentence: state.winningSentence,
    pendingWin,
    hunTile: state.hunTile || null,
    hunIndicator: state.hunIndicator || null,
    exchangeDirection: state.exchangeDirection || null,
    winners: state.winners || [],
    challenges: Object.values(state.challenges || {}),
    losingPlayerIds: losingPlayerIds(state),
    ...actionState,
    lastDiscard: state.lastDiscard || null,
    deckCount: state.deck.length,
    discards: state.discards.slice(-40),
    log: state.log.slice(-5),
    players: state.players.map(({ id, name, avatar, avatarUrl, avatarColor, hand, seat, melds, missingSuit, won, score }) => ({
      id, name, avatar, avatarUrl, avatarColor: avatarColor || "cinnabar", handCount: hand.length, seat,
      melds: melds || [], missingSuit: missingSuit || null, won: !!won, score: score || 0,
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

function drawMahjongTile(state, player) {
  state.lastDiscard = null;
  const tile = state.deck.pop();
  if (!tile) {
    state.status = "finished";
    state.phase = "finished";
    state.log.push("牌墙见底，本局荒庄");
    return false;
  }
  player.hand = sortTiles([...player.hand, tile]);
  state.phase = "discard";
  state.log.push(`${player.name} 摸了一张牌`);
  return true;
}

function startMahjong(state) {
  const variant = roomVariant(state);
  const deck = makeMahjongDeck(variant);
  state.players.forEach((player) => {
    player.hand = [];
    player.melds = [];
    player.missingSuit = null;
    player.won = false;
    player.score = 0;
  });
  for (let round = 0; round < 13; round += 1) {
    state.players.forEach((player) => player.hand.push(deck.pop()));
  }
  state.players[0].hand.push(deck.pop());
  state.players.forEach((player) => { player.hand = sortTiles(player.hand); });
  state.hunIndicator = variant === "beijing" ? deck.pop() : null;
  state.hunTile = state.hunIndicator ? nextHunTile(state.hunIndicator) : null;
  state.deck = deck;
  state.discards = [];
  state.lastDiscard = null;
  state.turn = 0;
  state.status = "playing";
  state.winnerId = null;
  state.winningSentence = null;
  state.pendingWin = null;
  state.winners = [];
  state.challenges = {};
  state.exchangeSelections = {};
  if (variant === "sichuan") {
    const directions = [
      { name: "顺时针", offset: 1 },
      { name: "对家", offset: 2 },
      { name: "逆时针", offset: 3 },
    ];
    const direction = directions[Math.floor(Math.random() * directions.length)];
    state.exchangeDirection = direction.name;
    state.exchangeOffset = direction.offset;
    state.phase = "exchange";
    state.log = [`川麻开局，请各自选三张同门牌，${direction.name}交换`];
  } else {
    state.exchangeDirection = null;
    state.exchangeOffset = null;
    state.phase = "discard";
    state.log = [`京麻开局，本局混儿为 ${state.hunTile}`];
  }
}

function finishMahjongClaim(state, player, type, tiles, fromPlayerId) {
  const lastTile = state.lastDiscard.tile;
  state.discards.pop();
  player.melds.push({ type, tiles, fromPlayerId });
  state.turn = player.seat;
  state.lastDiscard = null;
  state.phase = "discard";
  state.log.push(`${player.name} ${type === "chi" ? "吃" : type === "peng" ? "碰" : "明杠"}了 ${lastTile}`);
}

function settleMahjongWin(state, player, selfDraw, fromPlayerId) {
  const active = state.players.filter((item) => !item.won && item.id !== player.id);
  const points = selfDraw ? 2 : 1;
  if (selfDraw) {
    active.forEach((item) => { item.score -= points; player.score += points; });
  } else {
    const payer = state.players.find((item) => item.id === fromPlayerId);
    const payment = roomVariant(state) === "beijing" ? points * Math.max(1, active.length) : points;
    if (payer) { payer.score -= payment; player.score += payment; }
  }
  state.winners.push({ playerId: player.id, type: selfDraw ? "自摸" : "点炮", score: player.score });
  state.log.push(`${player.name} ${selfDraw ? "自摸" : "胡牌"}了`);
}

function blockingClaim(state, playerId, priority) {
  const priorities = { chi: 1, peng: 2, gang: 2, hu: 3 };
  return state.players.some((item) => {
    if (item.id === playerId || item.id === state.lastDiscard?.playerId || state.claimPasses?.[item.id]) return false;
    return mahjongActions(state, item.id).availableActions.some((action) => (priorities[action] || 0) > priority);
  });
}

function anyOpenClaim(state, excludingPlayerId) {
  return state.players.some((item) => {
    if (item.id === excludingPlayerId || item.id === state.lastDiscard?.playerId || state.claimPasses?.[item.id]) return false;
    return mahjongActions(state, item.id).availableActions.some((action) => ["hu", "gang", "peng", "chi"].includes(action));
  });
}

function applyMahjongAction(state, player, action, payload) {
  const variant = roomVariant(state);
  const current = state.players[state.turn];
  const isCurrent = current?.id === player.id;
  if (action === "start" || action === "restart") {
    if (state.hostId !== player.id) return "只有房主可以开局";
    if (state.players.length !== 4) return "川麻和京麻需要四位牌友到齐";
    startMahjong(state);
    return null;
  }
  if (state.status !== "playing" || player.won) return "现在不能进行这个操作";

  if (action === "exchange") {
    if (variant !== "sichuan" || state.phase !== "exchange") return "现在不用换三张";
    if (state.exchangeSelections[player.id]) return "你已经选好换出的牌了";
    const indices = Array.isArray(payload.tileIndices) ? payload.tileIndices.map(Number) : [];
    if (!isSameSuitSelection(player.hand, indices)) return "请选择三张同一花色的牌";
    state.exchangeSelections[player.id] = [...indices];
    state.log.push(`${player.name} 已选好换三张`);
    if (Object.keys(state.exchangeSelections).length === state.players.length) {
      const outgoing = state.players.map((item) => state.exchangeSelections[item.id].map((index) => item.hand[index]));
      state.players.forEach((item, seat) => {
        item.hand = item.hand.filter((_, index) => !state.exchangeSelections[item.id].includes(index));
        const sender = (seat - state.exchangeOffset + state.players.length) % state.players.length;
        item.hand = sortTiles([...item.hand, ...outgoing[sender]]);
      });
      state.phase = "dingque";
      state.log.push(`换三张完成，请选择定缺花色`);
    }
    return null;
  }

  if (action === "dingque") {
    if (variant !== "sichuan" || state.phase !== "dingque") return "现在不用定缺";
    const suit = String(payload.suit || "");
    if (!SUITS.includes(suit)) return "请选择缺万、缺筒或缺条";
    player.missingSuit = suit;
    state.log.push(`${player.name} 已完成定缺`);
    if (state.players.every((item) => item.missingSuit)) {
      state.phase = "discard";
      state.turn = 0;
      state.log.push("定缺完成，庄家先出牌");
    }
    return null;
  }

  if (action === "draw") {
    if (!isCurrent || !["draw", "claim"].includes(state.phase)) return "现在还不能摸牌";
    if (state.phase === "claim" && anyOpenClaim(state, player.id)) return "还有牌友可以吃碰杠胡，请等对方选择或过牌";
    drawMahjongTile(state, player);
    return null;
  }

  if (action === "pass") {
    if (state.phase !== "claim" || !state.lastDiscard || state.lastDiscard.playerId === player.id) return "现在不用过牌";
    state.claimPasses ||= {};
    state.claimPasses[player.id] = true;
    state.log.push(`${player.name} 选择过牌`);
    return null;
  }

  if (action === "discard") {
    if (!isCurrent || state.phase !== "discard") return "现在还不能出牌";
    const tileIndex = Number(payload.tileIndex);
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= player.hand.length) return "请选择一张有效的牌";
    const tile = player.hand[tileIndex];
    if (variant === "sichuan" && player.hand.some((item) => tileSuit(item) === player.missingSuit) && tileSuit(tile) !== player.missingSuit) return "定缺牌还没打完，要先打缺门";
    player.hand.splice(tileIndex, 1);
    state.discards.push(tile);
    state.lastDiscard = { tile, playerId: player.id };
    state.claimPasses = {};
    state.turn = nextActiveTurn(state, player.seat);
    state.phase = "claim";
    state.log.push(`${player.name} 打出 ${tile}`);
    return null;
  }

  if (action === "chi") {
    if (variant !== "beijing" || state.phase !== "claim" || !state.lastDiscard || !isCurrent || state.lastDiscard.playerId === player.id || state.claimPasses?.[player.id]) return "现在不能吃牌";
    const pair = Array.isArray(payload.tiles) ? payload.tiles.map(String) : [];
    const valid = chiOptions(player.hand, state.lastDiscard.tile).some((option) => option.join(",") === pair.join(","));
    if (!valid) return "请选择有效的吃牌组合";
    if (blockingClaim(state, player.id, 1)) return "有人可以碰、杠或胡，请稍等";
    player.hand = removeTiles(player.hand, pair);
    finishMahjongClaim(state, player, "chi", sortTiles([...pair, state.lastDiscard.tile]), state.lastDiscard.playerId);
    return null;
  }

  if (action === "peng") {
    if (state.phase !== "claim" || !state.lastDiscard || state.lastDiscard.playerId === player.id || state.claimPasses?.[player.id] || countTile(player.hand, state.lastDiscard.tile) < 2) return "现在不能碰牌";
    if (blockingClaim(state, player.id, 2)) return "有人可以胡牌，请稍等";
    const tile = state.lastDiscard.tile;
    player.hand = removeTiles(player.hand, [tile, tile]);
    finishMahjongClaim(state, player, "peng", [tile, tile, tile], state.lastDiscard.playerId);
    return null;
  }

  if (action === "gang") {
    if (state.phase === "claim" && state.lastDiscard && state.lastDiscard.playerId !== player.id && !state.claimPasses?.[player.id] && countTile(player.hand, state.lastDiscard.tile) >= 3) {
      if (blockingClaim(state, player.id, 2)) return "有人可以胡牌，请稍等";
      const tile = state.lastDiscard.tile;
      const source = state.lastDiscard.playerId;
      player.hand = removeTiles(player.hand, [tile, tile, tile]);
      finishMahjongClaim(state, player, "gang", [tile, tile, tile, tile], source);
      drawMahjongTile(state, player);
      return null;
    }
    const tile = String(payload.tile || "");
    if (!isCurrent || state.phase !== "discard" || countTile(player.hand, tile) !== 4) return "现在不能杠牌";
    player.hand = removeTiles(player.hand, [tile, tile, tile, tile]);
    player.melds.push({ type: "angang", tiles: [tile, tile, tile, tile], fromPlayerId: player.id });
    state.log.push(`${player.name} 暗杠 ${tile}`);
    drawMahjongTile(state, player);
    return null;
  }

  if (action === "hu") {
    const selfDraw = isCurrent && state.phase === "discard";
    const discardWin = state.phase === "claim" && state.lastDiscard && state.lastDiscard.playerId !== player.id;
    if (!selfDraw && !discardWin) return "现在不能胡牌";
    if (discardWin && state.claimPasses?.[player.id]) return "你已经过牌了";
    const openHand = (player.melds || []).some((meld) => meld.type !== "angang");
    if (variant === "beijing" && discardWin && openHand) return "京麻吃碰明杠后只能自摸";
    const winningTiles = discardWin ? [...player.hand, state.lastDiscard.tile] : player.hand;
    if (!canMahjongWin(state, player, winningTiles)) return "这副牌还没有胡";
    const sourceId = discardWin ? state.lastDiscard.playerId : null;
    if (discardWin) state.discards.pop();
    settleMahjongWin(state, player, selfDraw, sourceId);
    state.winnerId = player.id;
    state.lastDiscard = null;
    if (variant === "beijing") {
      state.status = "finished";
      state.phase = "finished";
    } else {
      player.won = true;
      const active = state.players.filter((item) => !item.won);
      if (active.length <= 1 || state.winners.length >= 3) {
        state.status = "finished";
        state.phase = "finished";
      } else {
        const sourceSeat = selfDraw ? player.seat : state.players.find((item) => item.id === sourceId)?.seat ?? player.seat;
        state.turn = nextActiveTurn(state, sourceSeat);
        state.phase = "draw";
      }
    }
    return null;
  }
  return "未知操作";
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
    if (state.status === "dissolved") return response(origin, 404, { error: "房间已解散" });
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
    const variant = cleanVariant(payload.variant);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = roomCode();
      const state = {
        variant, status: "waiting", hostId: playerKey,
        players: [{ id: playerKey, name: displayName, avatar, avatarUrl: null, avatarColor, hand: [], melds: [], missingSuit: null, won: false, score: 0, seat: 0 }],
        deck: [], discards: [], lastDiscard: null, turn: 0, phase: "waiting", winnerId: null, winningSentence: null, pendingWin: null,
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
  if (state.status === "dissolved") return response(origin, 404, { error: "房间已解散" });
  let player = state.players.find((item) => item.id === playerKey);

  if (action === "join") {
    if (!player) {
      if (state.status !== "waiting") return response(origin, 400, { error: "牌局已经开始了" });
      if (state.players.length >= 4) return response(origin, 400, { error: "这个房间已经坐满了" });
      player = { id: playerKey, name: displayName, avatar, avatarUrl: null, avatarColor, hand: [], melds: [], missingSuit: null, won: false, score: 0, seat: state.players.length };
      state.players.push(player);
      state.log.push(`${displayName} 入座了`);
    } else {
      player.name = displayName;
      player.avatar = avatar;
      player.avatarColor = avatarColor;
    }
  } else {
    if (!player) return response(origin, 403, { error: "你还没有加入这个房间" });
    if (action === "rename") {
      player.name = displayName;
      player.avatar = avatar;
      player.avatarColor = avatarColor;
      state.log.push(`${displayName} 改好了名字`);
    } else if (action === "dissolve") {
      if (state.hostId !== playerKey) return response(origin, 403, { error: "只有房主可以解散房间" });
      state.status = "dissolved";
      state.phase = "finished";
      state.pendingWin = null;
      state.log.push(`${player.name} 解散了房间`);
      try { await saveRoom(client, row, state); }
      catch (error) {
        if (isConditionConflict(error)) return response(origin, 409, { error: "牌桌状态刚刚变化，请再试一次" });
        throw error;
      }
      return response(origin, 200, { dissolved: true, code });
    } else if (action === "challenge") {
      if (!losingPlayerIds(state).includes(playerKey)) return response(origin, 400, { error: "只有本局输家可以抽惩罚卡" });
      const type = payload.challengeType === "dare" ? "dare" : payload.challengeType === "truth" ? "truth" : null;
      if (!type) return response(origin, 400, { error: "请选择真心话或大冒险" });
      const prompts = type === "truth" ? TRUTH_PROMPTS : DARE_PROMPTS;
      const previous = state.challenges?.[playerKey]?.prompt;
      const choices = prompts.filter((prompt) => prompt !== previous);
      const prompt = choices[Math.floor(Math.random() * choices.length)];
      state.challenges ||= {};
      state.challenges[playerKey] = { playerId: playerKey, type, prompt };
      state.log.push(`${player.name} 选择了${type === "truth" ? "真心话" : "大冒险"}`);
    } else if (isMahjongRoom(state)) {
      const error = applyMahjongAction(state, player, action, payload);
      if (error) return response(origin, 400, { error });
    } else if (action === "start" || action === "restart") {
      if (state.hostId !== playerKey) return response(origin, 400, { error: "只有房主可以开局" });
      if (state.players.length < 2) return response(origin, 400, { error: "至少要有两个人才能开局" });
      const deck = makeDeck();
      state.players.forEach((item) => { item.hand = deck.splice(0, 13); });
      state.players[0].hand.push(deck.pop());
      state.deck = deck; state.discards = []; state.lastDiscard = null; state.turn = 0; state.phase = "discard"; state.status = "playing";
      state.winnerId = null; state.winningSentence = null; state.pendingWin = null; state.challenges = {}; state.log = ["牌局开始，房主先出牌"];
    } else if (action === "draw") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || !["draw", "claim"].includes(state.phase)) return response(origin, 400, { error: "现在还不能摸牌" });
      state.lastDiscard = null;
      const tile = state.deck.pop();
      if (!tile) { state.status = "finished"; state.phase = "finished"; state.log.push("牌山见底，这局流局"); }
      else { player.hand.push(tile); state.phase = "discard"; state.log.push(`${player.name} 摸了一张牌`); }
    } else if (action === "discard") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || state.phase !== "discard") return response(origin, 400, { error: "现在还不能出牌" });
      const tileIndex = Number(payload.tileIndex);
      if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= player.hand.length) return response(origin, 400, { error: "请选择一张有效的牌" });
      const [tile] = player.hand.splice(tileIndex, 1);
      state.discards.push(tile); state.lastDiscard = { tile, playerId: playerKey }; state.log.push(`${player.name} 打出了「${tile}」，等待牌友吃牌`);
      state.turn = (state.turn + 1) % state.players.length; state.phase = "claim";
    } else if (action === "eat") {
      if (state.status !== "playing" || state.phase !== "claim" || !state.lastDiscard) return response(origin, 400, { error: "现在没有可以吃的牌" });
      if (state.lastDiscard.playerId === playerKey) return response(origin, 400, { error: "不能吃自己打出的牌" });
      const tile = state.lastDiscard.tile;
      if (state.discards.at(-1) !== tile) return response(origin, 409, { error: "这张牌已经不能吃了" });
      state.discards.pop();
      player.hand.push(tile);
      state.turn = state.players.findIndex((item) => item.id === playerKey);
      state.phase = "discard";
      state.lastDiscard = null;
      state.log.push(`${player.name} 吃了「${tile}」，本轮直接出牌`);
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
