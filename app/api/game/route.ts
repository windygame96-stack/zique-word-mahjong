import { ensureDatabase, getD1 } from "../../../lib/database";

type Player = {
  id: string;
  name: string;
  avatar: string;
  avatarUrl: string | null;
  avatarColor: string;
  hand: string[];
  seat: number;
};

type GameState = {
  status: "waiting" | "playing" | "finished" | "dissolved";
  hostId: string;
  players: Player[];
  deck: string[];
  discards: string[];
  lastDiscard: { tile: string; playerId: string } | null;
  turn: number;
  phase: "waiting" | "draw" | "claim" | "discard" | "voting" | "finished";
  winnerId: string | null;
  winningSentence: string | null;
  pendingWin: { playerId: string; sentence: string; votes: Record<string, "approve" | "reject"> } | null;
  log: string[];
};

type RoomRow = { code: string; state_json: string; revision: number };

const TILE_GROUPS = [
  { copies: 3, chars: ["我", "你", "他", "她", "们", "的", "了", "是", "不", "很", "也", "都", "就", "还", "想", "要", "会", "能", "有", "在", "去", "来", "爱", "好"] },
  { copies: 2, chars: ["看", "听", "说", "吃", "喝", "玩", "做", "给", "让", "把", "和", "跟", "喜", "欢", "真", "太", "更", "又", "正", "可", "以", "一", "起", "家"] },
  { copies: 1, chars: ["今", "天", "明", "晚", "早", "夜", "回", "到", "见", "走", "睡", "快", "慢", "风", "雨", "花", "月", "猫", "茶", "饭", "朋", "友", "心", "开"] },
];

function makeDeck() {
  const deck = TILE_GROUPS.flatMap(({ copies, chars }) => Array.from({ length: copies }, () => chars).flat());
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const next = random[0] % (index + 1);
    [deck[index], deck[next]] = [deck[next], deck[index]];
  }
  return deck;
}

function roomCode() {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String(1000 + (random[0] % 9000));
}

function cleanName(value: unknown) {
  const name = typeof value === "string" ? value.trim().slice(0, 10) : "";
  return name || "神秘牌友";
}

const AVATAR_COLORS = new Set(["cinnabar", "jade", "ocean", "plum", "amber", "ink"]);
function cleanAvatarColor(value: unknown) {
  return typeof value === "string" && AVATAR_COLORS.has(value) ? value : "cinnabar";
}

function publicState(row: RoomRow, state: GameState, playerKey: string) {
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
    lastDiscard: state.lastDiscard || null,
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

async function readRoom(code: string) {
  return getD1().prepare(
    "SELECT code, state_json, revision FROM rooms WHERE code = ?",
  ).bind(code).first<RoomRow>();
}

async function saveRoom(row: RoomRow, state: GameState) {
  const result = await getD1().prepare(`
    UPDATE rooms SET state_json = ?, revision = revision + 1, updated_at = ?
    WHERE code = ? AND revision = ?
  `).bind(JSON.stringify(state), Date.now(), row.code, row.revision).run();
  return Number(result.meta.changes || 0) === 1;
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  await ensureDatabase();
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim();
  const playerKey = (url.searchParams.get("playerKey") || "").trim();
  if (!code || !playerKey) return error("缺少房号或玩家身份");
  const row = await readRoom(code);
  if (!row) return error("没找到这个房间", 404);
  const state = JSON.parse(row.state_json) as GameState;
  if (state.status === "dissolved") return error("房间已解散", 404);
  if (!state.players.some((player) => player.id === playerKey)) return error("你还没有加入这个房间", 403);
  return Response.json(publicState(row, state, playerKey));
}

export async function POST(request: Request) {
  await ensureDatabase();
  const payload = await request.json() as {
    action?: string;
    code?: string;
    playerKey?: string;
    name?: string;
    avatarColor?: string;
    tileIndex?: number;
    sentenceIndices?: number[];
    approve?: boolean;
  };
  const action = payload.action || "";
  const playerKey = (payload.playerKey || "").slice(0, 100);
  if (!playerKey) return error("无法识别你的设备，请刷新后重试");
  const displayName = cleanName(payload.name);
  const avatar = displayName.slice(0, 1) || "友";
  const avatarColor = cleanAvatarColor(payload.avatarColor);

  if (action === "create") {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = roomCode();
      const now = Date.now();
      const state: GameState = {
        status: "waiting",
        hostId: playerKey,
        players: [{ id: playerKey, name: displayName, avatar, avatarUrl: null, avatarColor, hand: [], seat: 0 }],
        deck: [], discards: [], lastDiscard: null, turn: 0, phase: "waiting", winnerId: null, winningSentence: null, pendingWin: null,
        log: [`${displayName} 开了牌桌`],
      };
      try {
        await getD1().prepare(`
          INSERT INTO rooms (id, code, state_json, revision, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?)
        `).bind(crypto.randomUUID(), code, JSON.stringify(state), now, now).run();
        return Response.json(publicState({ code, state_json: "", revision: 0 }, state, playerKey), { status: 201 });
      } catch (caught) {
        if (attempt === 7) throw caught;
      }
    }
  }

  const code = (payload.code || "").trim();
  if (!/^\d{4}$/.test(code)) return error("请输入 4 位房号");
  const row = await readRoom(code);
  if (!row) return error("没找到这个房间", 404);
  const state = JSON.parse(row.state_json) as GameState;
  if (state.status === "dissolved") return error("房间已解散", 404);
  let player = state.players.find((item) => item.id === playerKey);

  if (action === "join") {
    if (!player) {
      if (state.status !== "waiting") return error("牌局已经开始了");
      if (state.players.length >= 4) return error("这个房间已经坐满了");
      player = { id: playerKey, name: displayName, avatar, avatarUrl: null, avatarColor, hand: [], seat: state.players.length };
      state.players.push(player);
      state.log.push(`${displayName} 入座了`);
    } else {
      player.name = displayName;
      player.avatar = avatar;
      player.avatarColor = avatarColor;
    }
  } else {
    if (!player) return error("你还没有加入这个房间", 403);
    if (action === "rename") {
      player.name = displayName;
      player.avatar = avatar;
      player.avatarColor = avatarColor;
      state.log.push(`${displayName} 改好了名字`);
    } else if (action === "dissolve") {
      if (state.hostId !== playerKey) return error("只有房主可以解散房间", 403);
      state.status = "dissolved";
      state.phase = "finished";
      state.pendingWin = null;
      state.log.push(`${player.name} 解散了房间`);
      const saved = await saveRoom(row, state);
      if (!saved) return error("牌桌状态刚刚变化，请再试一次", 409);
      return Response.json({ dissolved: true, code });
    } else if (action === "start" || action === "restart") {
      if (state.hostId !== playerKey) return error("只有房主可以开局");
      if (state.players.length < 2) return error("至少要有两个人才能开局");
      const deck = makeDeck();
      state.players.forEach((item) => { item.hand = deck.splice(0, 13); });
      state.players[0].hand.push(deck.pop()!);
      state.deck = deck;
      state.discards = [];
      state.lastDiscard = null;
      state.turn = 0;
      state.phase = "discard";
      state.status = "playing";
      state.winnerId = null;
      state.winningSentence = null;
      state.pendingWin = null;
      state.log = ["牌局开始，房主先出牌"];
    } else if (action === "draw") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || !["draw", "claim"].includes(state.phase)) return error("现在还不能摸牌");
      state.lastDiscard = null;
      const tile = state.deck.pop();
      if (!tile) {
        state.status = "finished"; state.phase = "finished"; state.log.push("牌山见底，这局流局");
      } else {
        player.hand.push(tile);
        state.phase = "discard";
        state.log.push(`${player.name} 摸了一张牌`);
      }
    } else if (action === "discard") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || state.phase !== "discard") return error("现在还不能出牌");
      const tileIndex = Number(payload.tileIndex);
      if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= player.hand.length) return error("请选择一张有效的牌");
      const [tile] = player.hand.splice(tileIndex, 1);
      state.discards.push(tile);
      state.lastDiscard = { tile, playerId: playerKey };
      state.log.push(`${player.name} 打出了「${tile}」，等待牌友吃牌`);
      state.turn = (state.turn + 1) % state.players.length;
      state.phase = "claim";
    } else if (action === "eat") {
      if (state.status !== "playing" || state.phase !== "claim" || !state.lastDiscard) return error("现在没有可以吃的牌");
      if (state.lastDiscard.playerId === playerKey) return error("不能吃自己打出的牌");
      const tile = state.lastDiscard.tile;
      if (state.discards.at(-1) !== tile) return error("这张牌已经不能吃了", 409);
      state.discards.pop();
      player.hand.push(tile);
      state.turn = state.players.findIndex((item) => item.id === playerKey);
      state.phase = "discard";
      state.lastDiscard = null;
      state.log.push(`${player.name} 吃了「${tile}」，本轮直接出牌`);
    } else if (action === "win") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || state.phase !== "discard") return error("只有轮到你、摸牌后才能胡");
      const indices = Array.isArray(payload.sentenceIndices) ? payload.sentenceIndices : [];
      if (indices.length < 4 || new Set(indices).size !== indices.length) return error("至少选四张不同的字牌组成一句话");
      if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= player.hand.length)) return error("句子里有无效的牌");
      const sentence = indices.map((index) => player!.hand[index]).join("");
      state.phase = "voting";
      state.pendingWin = { playerId: playerKey, sentence, votes: {} };
      state.log.push(`${player.name} 用「${sentence}」申请胡牌，等待牌友判定`);
    } else if (action === "voteWin") {
      if (state.status !== "playing" || state.phase !== "voting" || !state.pendingWin) return error("现在没有待判定的胡牌");
      if (state.pendingWin.playerId === playerKey) return error("不能判定自己的胡牌");
      if (state.pendingWin.votes[playerKey]) return error("你已经投过票了");
      if (typeof payload.approve !== "boolean") return error("请选择算胡或不算胡");
      state.pendingWin.votes[playerKey] = payload.approve ? "approve" : "reject";
      const voters = state.players.filter((item) => item.id !== state.pendingWin!.playerId);
      const votes = Object.values(state.pendingWin.votes);
      if (votes.length === voters.length) {
        const approvals = votes.filter((vote) => vote === "approve").length;
        const claimant = state.players.find((item) => item.id === state.pendingWin!.playerId);
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
      return error("未知操作");
    }
  }

  const saved = await saveRoom(row, state);
  if (!saved) return error("刚好有人同时出牌，请再试一次", 409);
  return Response.json(publicState({ ...row, revision: row.revision + 1 }, state, playerKey));
}
