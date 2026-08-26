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
  status: "waiting" | "playing" | "finished";
  hostId: string;
  players: Player[];
  deck: string[];
  discards: string[];
  turn: number;
  phase: "waiting" | "draw" | "discard" | "finished";
  winnerId: string | null;
  winningSentence: string | null;
  log: string[];
};

type RoomRow = { code: string; state_json: string; revision: number };

const WORDS = Array.from(
  "我你他她它们今天明天昨天春夏秋冬风雨云雪花月山海星河光夜梦爱想要会能在去来把被让和与可是如果因为所以依然突然偷偷慢慢一起故事世界朋友时间生活快乐自由温柔勇敢浪漫认真可爱有趣等待遇见告别开始结束看见听见相信喜欢变成一只小猫宇宙答案问题喝茶散步发呆唱歌晚安早安真的假的大概也许永远此刻这里那里",
);

function makeDeck() {
  const deck: string[] = [];
  for (let index = 0; index < 144; index += 1) deck.push(WORDS[index % WORDS.length]);
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
        deck: [], discards: [], turn: 0, phase: "waiting", winnerId: null, winningSentence: null,
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
    if (action === "start" || action === "restart") {
      if (state.hostId !== playerKey) return error("只有房主可以开局");
      if (state.players.length < 2) return error("至少要有两个人才能开局");
      const deck = makeDeck();
      state.players.forEach((item) => { item.hand = deck.splice(0, 13); });
      state.players[0].hand.push(deck.pop()!);
      state.deck = deck;
      state.discards = [];
      state.turn = 0;
      state.phase = "discard";
      state.status = "playing";
      state.winnerId = null;
      state.winningSentence = null;
      state.log = ["牌局开始，房主先出牌"];
    } else if (action === "draw") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || state.phase !== "draw") return error("现在还不能摸牌");
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
      state.log.push(`${player.name} 打出了「${tile}」`);
      state.turn = (state.turn + 1) % state.players.length;
      state.phase = "draw";
    } else if (action === "win") {
      if (state.status !== "playing" || state.players[state.turn]?.id !== playerKey || state.phase !== "discard") return error("只有轮到你、摸牌后才能胡");
      const indices = Array.isArray(payload.sentenceIndices) ? payload.sentenceIndices : [];
      if (indices.length < 4 || new Set(indices).size !== indices.length) return error("至少选四张不同的字牌组成一句话");
      if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= player.hand.length)) return error("句子里有无效的牌");
      const sentence = indices.map((index) => player!.hand[index]).join("");
      state.status = "finished";
      state.phase = "finished";
      state.winnerId = playerKey;
      state.winningSentence = sentence;
      state.log.push(`${player.name} 用「${sentence}」胡了`);
    } else {
      return error("未知操作");
    }
  }

  const saved = await saveRoom(row, state);
  if (!saved) return error("刚好有人同时出牌，请再试一次", 409);
  return Response.json(publicState({ ...row, revision: row.revision + 1 }, state, playerKey));
}
