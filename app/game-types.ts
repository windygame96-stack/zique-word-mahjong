export type AvatarColor = "cinnabar" | "jade" | "ocean" | "plum" | "amber" | "ink";
export type GameVariant = "word" | "sichuan" | "beijing";
export type Meld = { type: "chi" | "peng" | "gang" | "angang"; tiles: string[]; fromPlayerId: string };
export type RoundChallenge = { playerId: string; type: "truth" | "dare"; prompt: string };

export type PlayerView = {
  id: string;
  name: string;
  avatar: string;
  avatarColor: AvatarColor;
  avatarUrl: string | null;
  handCount: number;
  seat: number;
  melds: Meld[];
  missingSuit: "m" | "p" | "s" | null;
  won: boolean;
  score: number;
};

export type RoomView = {
  code: string;
  revision: number;
  variant: GameVariant;
  status: "waiting" | "playing" | "finished";
  phase: "waiting" | "exchange" | "dingque" | "draw" | "claim" | "discard" | "voting" | "finished";
  turn: number;
  currentPlayerId: string | null;
  hostId: string;
  winnerId: string | null;
  winningSentence: string | null;
  deckCount: number;
  pendingWin: { playerId: string; sentence: string; approvals: number; rejections: number; votesCast: number; totalVoters: number; myVote: "approve" | "reject" | null } | null;
  lastDiscard: { tile: string; playerId: string } | null;
  discards: string[];
  log: string[];
  players: PlayerView[];
  hand: string[];
  me: { id: string; name: string; seat: number } | null;
  hunTile: string | null;
  hunIndicator: string | null;
  exchangeDirection: string | null;
  winners: { playerId: string; type: string; score: number }[];
  challenges: RoundChallenge[];
  losingPlayerIds: string[];
  availableActions: string[];
  chiOptions: string[][];
  gangTiles: string[];
};
