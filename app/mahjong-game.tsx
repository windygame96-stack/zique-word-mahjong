"use client";

import type { AvatarColor, PlayerView, RoomView } from "./game-types";
import TruthOrDare from "./truth-or-dare";

const NUMERALS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const HONORS: Record<string, string> = { z1: "东", z2: "南", z3: "西", z4: "北", z5: "中", z6: "发", z7: "白" };
const SUIT_NAMES: Record<string, string> = { m: "万", p: "筒", s: "条" };

export function tileLabel(tile: string) {
  if (HONORS[tile]) return HONORS[tile];
  const rank = Number(tile.slice(1));
  return `${NUMERALS[rank] || rank}${SUIT_NAMES[tile.slice(0, 1)] || ""}`;
}

function readableLog(message: string) {
  return message.replace(/\b([mpsz]\d)\b/g, (tile) => tileLabel(tile));
}

function MahjongTile({ tile, selected = false, mini = false }: { tile: string; selected?: boolean; mini?: boolean }) {
  const honor = HONORS[tile];
  const suit = tile.slice(0, 1);
  const rank = Number(tile.slice(1));
  return <span className={`${mini ? "mahjong-mini" : "mahjong-face"} suit-${suit} ${selected ? "selected" : ""}`}>
    {honor ? <strong>{honor}</strong> : <><strong>{NUMERALS[rank]}</strong><small>{SUIT_NAMES[suit]}</small></>}
  </span>;
}

function MahjongSeat({ player, position, active }: { player: PlayerView; position: string; active: boolean }) {
  return <div className={`seat seat-${position} mahjong-seat ${active ? "active-seat" : ""} ${player.won ? "won-seat" : ""}`}>
    <span className={`seat-avatar color-${player.avatarColor || "cinnabar"}`}>{player.avatar}</span>
    <span><strong>{player.name}{player.won ? " · 已胡" : ""}</strong><small>{player.handCount} 张 · {player.score >= 0 ? "+" : ""}{player.score} 分{player.missingSuit ? ` · 缺${SUIT_NAMES[player.missingSuit]}` : ""}</small></span>
  </div>;
}

type Props = {
  room: RoomView;
  playerKey: string;
  avatarColor: AvatarColor;
  selected: number[];
  busy: boolean;
  message: string;
  callGame: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  setSelected: (value: number[]) => void;
  onLeave: () => void;
  onInvite: () => void;
  onRules: () => void;
  onRename: () => void;
  onDissolve: () => void;
  onClearMessage: () => void;
};

export default function MahjongGame({ room, playerKey, avatarColor, selected, busy, message, callGame, setSelected, onLeave, onInvite, onRules, onRename, onDissolve, onClearMessage }: Props) {
  const variantName = room.variant === "sichuan" ? "川麻 · 血战到底" : "京麻 · 吃碰提";
  const myTurn = room.currentPlayerId === playerKey;
  const isHost = room.hostId === playerKey;
  const me = room.players.find((player) => player.id === playerKey);
  const others = room.players.filter((player) => player.id !== playerKey);
  const discarder = room.players.find((player) => player.id === room.lastDiscard?.playerId);
  const winner = room.players.find((player) => player.id === room.winnerId);
  const actions = new Set(room.availableActions || []);

  const toggleTile = (index: number) => {
    if (room.phase === "exchange") {
      if (selected.includes(index)) setSelected(selected.filter((item) => item !== index));
      else if (selected.length < 3) setSelected([...selected, index]);
      return;
    }
    if (room.phase === "discard" && myTurn) setSelected(selected[0] === index ? [] : [index]);
  };

  const statusText = room.status === "waiting"
    ? `等待四位牌友 · ${room.players.length}/4`
    : room.status === "finished"
      ? (winner ? `${winner.name} 胡牌，本局结束` : "本局结束")
      : room.phase === "exchange"
        ? `换三张 · ${room.exchangeDirection || "随机方向"}`
        : room.phase === "dingque"
          ? "请选择定缺花色"
          : room.phase === "claim"
            ? `${discarder?.name || "牌友"} 打出 ${tileLabel(room.lastDiscard?.tile || "")}`
            : myTurn ? (room.phase === "draw" ? "轮到你摸牌" : "轮到你出牌") : "等待牌友出牌";

  const primary = () => {
    if (room.status === "waiting" && isHost) return callGame("start");
    if (room.status === "finished" && isHost) return callGame("restart");
    if (actions.has("exchange") && selected.length === 3) return callGame("exchange", { tileIndices: selected });
    if (actions.has("draw")) return callGame("draw");
    if (actions.has("discard") && selected.length === 1) return callGame("discard", { tileIndex: selected[0] });
  };

  const primaryLabel = room.status === "waiting"
    ? (isHost ? (room.players.length === 4 ? "四人到齐 · 开局" : `还差 ${4 - room.players.length} 人`) : "等待房主开局")
    : room.status === "finished"
      ? (isHost ? "再来一局" : "等待房主再开")
      : actions.has("exchange")
        ? (selected.length === 3 ? "确认换出这三张" : `选择三张同门牌 · ${selected.length}/3`)
        : actions.has("draw") ? (room.phase === "claim" ? "过 · 摸牌" : "摸一张")
          : actions.has("discard") ? (selected.length === 1 ? `打出 ${tileLabel(room.hand[selected[0]])}` : "选择一张牌打出") : "等待其他牌友";
  const primaryDisabled = busy || (room.status === "waiting" && (!isHost || room.players.length !== 4)) || (room.status === "finished" && !isHost) || (actions.has("exchange") && selected.length !== 3) || (actions.has("discard") && selected.length !== 1) || (!actions.has("exchange") && !actions.has("draw") && !actions.has("discard") && room.status === "playing");

  return <main className="game-shell mahjong-shell">
    <header className="topbar">
      <button className="brand brand-button" onClick={onLeave}><span className="brand-mark">麻</span><span><strong>{variantName}</strong><small>四人线上朋友局</small></span></button>
      <button className="room-chip room-button" onClick={onInvite}><span className="live-dot" />房间 {room.code} · {room.players.length}/4 人 · 点此邀请</button>
      <button className={`avatar color-${avatarColor}`} aria-label="修改牌友名字" onClick={onRename}>{room.me?.name.slice(0, 1) || "友"}</button>
    </header>

    <section className="table-wrap" aria-label={`${variantName}牌桌`}>
      {others.map((player, index) => <MahjongSeat key={player.id} player={player} position={["top", "left", "right"][index] || "right"} active={player.id === room.currentPlayerId} />)}
      {room.players.length < 4 && room.status === "waiting" && <div className={`seat seat-${["top", "left", "right"][others.length] || "right"} waiting`}><span className="seat-avatar">＋</span><span><strong>等朋友入座</strong><small>分享房号 {room.code}</small></span></div>}
      <div className="felt-table mahjong-table">
        <div className={`turn-badge ${myTurn ? "your-turn" : ""}`}>{statusText}</div>
        {room.status === "waiting" ? <div className="waiting-table"><strong>{variantName}</strong><p>正常麻将需要四人，好友到齐由房主开局</p><button onClick={onInvite}>复制邀请 · {room.code}</button></div> : <div className="discard-grid mahjong-river" aria-label="牌河">{room.discards.length ? room.discards.map((tile, index) => <MahjongTile tile={tile} mini key={`${tile}-${index}`} />) : <span className="empty-river">还没有人出牌</span>}</div>}
        <div className="deck-count"><span>牌墙</span><strong>{room.deckCount}</strong></div>
        {room.variant === "beijing" && room.hunTile && <div className="hun-chip"><span>翻 {tileLabel(room.hunIndicator || "")}</span><strong>混儿 {tileLabel(room.hunTile)}</strong></div>}
        {room.phase === "dingque" && actions.has("dingque") && <div className="mahjong-prompt"><small>川麻定缺</small><strong>选一门不要的牌</strong><div className="prompt-actions">{["m", "p", "s"].map((suit) => <button key={suit} onClick={() => callGame("dingque", { suit })}>缺{SUIT_NAMES[suit]}</button>)}</div></div>}
        {room.phase === "dingque" && !actions.has("dingque") && <div className="mahjong-prompt"><small>定缺完成</small><strong>等待其他牌友</strong></div>}
        {room.phase === "claim" && room.lastDiscard && <div className="mahjong-prompt claim-prompt"><small>{discarder?.name || "牌友"} 打出</small><MahjongTile tile={room.lastDiscard.tile} /><div className="prompt-actions">
          {actions.has("hu") && <button className="win-action" onClick={() => callGame("hu")}>胡</button>}
          {actions.has("gang") && <button onClick={() => callGame("gang")}>杠</button>}
          {actions.has("peng") && <button onClick={() => callGame("peng")}>碰</button>}
          {room.chiOptions?.map((tiles) => <button key={tiles.join("-")} onClick={() => callGame("chi", { tiles })}>吃 {tiles.map(tileLabel).join("·")}</button>)}
          {actions.has("pass") && !actions.has("draw") && <button className="pass-action" onClick={() => callGame("pass")}>过</button>}
          {actions.has("draw") && <button className="pass-action" onClick={() => callGame("draw")}>过</button>}
        </div></div>}
        {room.status === "finished" && <div className="winner-card"><small>{winner ? `${winner.name} 胡了` : "本局荒庄"}</small><strong>{room.variant === "sichuan" && room.winners.length ? room.winners.map((item) => room.players.find((player) => player.id === item.playerId)?.name).join("、") : variantName}</strong><TruthOrDare room={room} playerKey={playerKey} busy={busy} callGame={callGame} /></div>}
      </div>
    </section>

    <section className="meld-strip" aria-label="副露区">{me?.melds?.length ? me.melds.map((meld, index) => <div className="meld" key={`${meld.type}-${index}`}><small>{meld.type === "chi" ? "吃" : meld.type === "peng" ? "碰" : meld.type === "angang" ? "暗杠" : "杠"}</small>{meld.tiles.map((tile, tileIndex) => <MahjongTile tile={tile} mini key={`${tile}-${tileIndex}`} />)}</div>) : <span>你的副露区</span>}</section>
    <section className="hand-area mahjong-hand-area">
      <div className="hand-meta"><span>{readableLog(room.log.at(-1) || "牌桌已准备好")}</span><span>{me?.missingSuit ? `定缺：${SUIT_NAMES[me.missingSuit]} · ` : ""}{room.hand.length} 张手牌</span></div>
      <div className="hand mahjong-hand" aria-label="你的手牌">{room.hand.length ? room.hand.map((tile, index) => <button key={`${tile}-${index}`} className="mahjong-tile-button" onClick={() => toggleTile(index)} aria-pressed={selected.includes(index)}><MahjongTile tile={tile} selected={selected.includes(index)} /></button>) : <div className="empty-hand">开局后，你的麻将牌会出现在这里</div>}</div>
    </section>

    {message && <div className="game-toast" role="status">{message}<button onClick={onClearMessage}>×</button></div>}
    <nav className={`action-bar mahjong-actions ${isHost ? "host-actions" : ""}`} aria-label="牌局操作">
      <button onClick={onRules}>规则</button><button className="secondary" onClick={onInvite}>邀请朋友</button>{isHost && <button className="danger" onClick={onDissolve}>解散房间</button>}
      {actions.has("hu") && room.phase === "discard" && <button className="win-action" onClick={() => callGame("hu")}>胡牌</button>}
      {room.gangTiles?.map((tile) => <button key={tile} className="secondary" onClick={() => callGame("gang", { tile })}>杠 {tileLabel(tile)}</button>)}
      <button className="primary" onClick={primary} disabled={primaryDisabled}>{primaryLabel}</button>
    </nav>
  </main>;
}
