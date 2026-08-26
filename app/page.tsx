"use client";

import { useEffect, useMemo, useState } from "react";

type PlayerView = { id: string; name: string; avatar: string; avatarUrl: string | null; handCount: number; seat: number };
type RoomView = {
  code: string; revision: number; status: "waiting" | "playing" | "finished";
  phase: "waiting" | "draw" | "discard" | "finished"; turn: number; currentPlayerId: string | null;
  hostId: string; winnerId: string | null; winningSentence: string | null; deckCount: number;
  discards: string[]; log: string[]; players: PlayerView[]; hand: string[]; me: { id: string; name: string; seat: number } | null;
};
type User = { id: string; name: string; avatarUrl: string | null };

function getDeviceKey() {
  let key = localStorage.getItem("zique_player_key");
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem("zique_player_key", key);
  }
  return key;
}

export default function Home() {
  const [playerKey, setPlayerKey] = useState("");
  const [name, setName] = useState("牌友");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [wechatConfigured, setWechatConfigured] = useState(false);

  useEffect(() => {
    const key = getDeviceKey();
    const savedName = localStorage.getItem("zique_name");
    const params = new URLSearchParams(window.location.search);
    setPlayerKey(key);
    if (savedName) setName(savedName);
    if (params.get("room")) setJoinCode((params.get("room") || "").slice(0, 4));
    const auth = params.get("auth");
    if (auth === "wechat_setup_needed") setMessage("微信登录还差开放平台配置；现在可先用昵称开房");
    if (auth === "wechat_failed") setMessage("微信登录没有完成，请再试一次");
    fetch("/api/auth/me").then((response) => response.json()).then((data) => {
      setUser(data.user || null);
      setWechatConfigured(Boolean(data.wechatConfigured));
      if (data.user?.name) setName(data.user.name);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!room || !playerKey) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/game?code=${room.code}&playerKey=${encodeURIComponent(playerKey)}`, { cache: "no-store" });
        if (response.ok) setRoom(await response.json());
      } catch { /* 下一轮自动重试 */ }
    }, 1400);
    return () => window.clearInterval(timer);
  }, [room?.code, playerKey]);

  useEffect(() => { setSelected([]); }, [room?.currentPlayerId, room?.phase, room?.revision]);

  const callGame = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!playerKey || busy) return;
    setBusy(true); setMessage("");
    try {
      localStorage.setItem("zique_name", name.trim() || "牌友");
      const response = await fetch("/api/game", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, code: room?.code || joinCode, playerKey, name, ...extra }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作没有成功");
      setRoom(data); setJoinCode(data.code); setSelected([]);
      if (action === "create" || action === "join") {
        history.replaceState(null, "", `?room=${data.code}`);
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "操作没有成功");
    } finally { setBusy(false); }
  };

  const toggleTile = (index: number) => {
    setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  };

  const sentence = useMemo(() => selected.map((index) => room?.hand[index] || "").join(""), [selected, room?.hand]);
  const myTurn = room?.currentPlayerId === playerKey;
  const isHost = room?.hostId === playerKey;

  const invite = async () => {
    if (!room) return;
    const url = `${window.location.origin}/?room=${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "来字雀打文字麻将", text: `房号 ${room.code}，等你入座`, url });
      else { await navigator.clipboard.writeText(url); setMessage("邀请链接已复制"); }
    } catch { /* 用户取消分享 */ }
  };

  if (!room) {
    return (
      <main className="landing-shell">
        <header className="landing-nav">
          <a className="brand" href="#"><span className="brand-mark">字</span><span><strong>字雀</strong><small>把话打到牌桌上</small></span></a>
          {user ? <div className="signed-user">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{user.name.slice(0, 1)}</span>}<b>{user.name}</b></div> : (
            <a className={`wechat-link ${!wechatConfigured ? "disabled" : ""}`} href={wechatConfigured ? "/api/auth/wechat/start" : undefined} aria-disabled={!wechatConfigured}>
              <i>微</i>{wechatConfigured ? "微信扫码登录" : "微信登录待配置"}
            </a>
          )}
        </header>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">2—4 人 · 在线文字麻将</p>
            <h1>把一句话，<br /><em>打</em>到牌桌上。</h1>
            <p className="hero-intro">摸到什么字，就说什么话。没有标准答案，只有今晚最值得截图的那一句。</p>
            {!user && <label className="name-field"><span>怎么称呼你</span><input value={name} onChange={(event) => setName(event.target.value.slice(0, 10))} placeholder="输入昵称" /></label>}
            <div className="start-actions">
              <button className="create-room" onClick={() => callGame("create")} disabled={busy}>{busy ? "正在铺桌…" : "开一桌"}<span>→</span></button>
              <div className="join-room"><input inputMode="numeric" maxLength={4} value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="输入 4 位房号" /><button onClick={() => callGame("join")} disabled={busy || joinCode.length !== 4}>入座</button></div>
            </div>
            {message && <p className="notice" role="status">{message}</p>}
            <div className="trust-row"><span>免下载</span><span>房号邀请</span><span>手机电脑都能玩</span></div>
          </div>
          <div className="hero-visual" aria-label="文字麻将示意">
            <div className="red-stamp">今夜<br />开局</div>
            <div className="floating-tile tile-one">我</div><div className="floating-tile tile-two">们</div><div className="floating-tile tile-three">去</div><div className="floating-tile tile-four">月</div><div className="floating-tile tile-five">亮</div><div className="floating-tile tile-six">上</div>
            <p>一句离谱的话<br />通常从一张好牌开始</p>
          </div>
        </section>
        <footer className="landing-footer"><span>原创在线字牌游戏</span><button onClick={() => setRulesOpen(true)}>先看玩法</button></footer>
        {rulesOpen && <Rules onClose={() => setRulesOpen(false)} />}
      </main>
    );
  }

  const otherPlayers = room.players.filter((player) => player.id !== playerKey);
  const currentPlayer = room.players.find((player) => player.id === room.currentPlayerId);
  const winner = room.players.find((player) => player.id === room.winnerId);
  const statusText = room.status === "waiting" ? "等朋友入座" : room.status === "finished" ? "这一局结束了" : myTurn ? (room.phase === "draw" ? "轮到你摸牌" : "轮到你出牌或胡牌") : `${currentPlayer?.name || "牌友"} 正在想一句狠话`;

  const primary = () => {
    if (room.status === "waiting") return isHost ? callGame("start") : undefined;
    if (room.status === "finished") return isHost ? callGame("restart") : undefined;
    if (!myTurn) return undefined;
    if (room.phase === "draw") return callGame("draw");
    if (room.phase === "discard" && selected.length === 1) return callGame("discard", { tileIndex: selected[0] });
  };
  const primaryLabel = room.status === "waiting" ? (isHost ? "人齐了 · 开局" : "等房主开局") : room.status === "finished" ? (isHost ? "再来一局" : "等房主再开一局") : !myTurn ? "还没轮到你" : room.phase === "draw" ? "摸一张" : selected.length === 1 ? `打出「${room.hand[selected[0]]}」` : "选一张牌打出";
  const primaryDisabled = busy || (room.status === "waiting" && (!isHost || room.players.length < 2)) || (room.status === "finished" && !isHost) || (room.status === "playing" && (!myTurn || (room.phase === "discard" && selected.length !== 1)));

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={() => { setRoom(null); history.replaceState(null, "", "/"); }}><span className="brand-mark">字</span><span><strong>字雀</strong><small>把话打到牌桌上</small></span></button>
        <button className="room-chip room-button" onClick={invite}><span className="live-dot" />房间 {room.code} · {room.players.length}/4 人 · 点此邀请</button>
        <button className="avatar" aria-label="个人菜单">{room.me?.name.slice(0, 1) || "友"}</button>
      </header>
      <section className="table-wrap" aria-label="文字麻将牌桌">
        {otherPlayers.map((player, index) => <Seat key={player.id} player={player} position={["top", "left", "right"][index] || "right"} active={player.id === room.currentPlayerId} />)}
        {room.players.length < 4 && room.status === "waiting" && <div className={`seat seat-${["top", "left", "right"][otherPlayers.length] || "right"} waiting`}><span className="seat-avatar">＋</span><span><strong>等朋友入座</strong><small>分享房号 {room.code}</small></span></div>}
        <div className="felt-table">
          <div className={`turn-badge ${myTurn ? "your-turn" : ""}`}>{statusText}</div>
          {room.status === "waiting" ? <div className="waiting-table"><strong>{room.players.length} 位牌友已入座</strong><p>{room.players.length < 2 ? "再邀请至少一位朋友" : "房主随时可以开局"}</p><button onClick={invite}>复制邀请 · {room.code}</button></div> : <div className="discard-grid" aria-label="牌河">{room.discards.length ? room.discards.map((char, index) => <span className="mini-tile" key={`${char}-${index}`}>{char}</span>) : <span className="empty-river">还没有人出牌</span>}</div>}
          <div className="deck-count"><span>牌山</span><strong>{room.deckCount}</strong></div>
          {room.status === "finished" && <div className="winner-card"><small>{winner ? `${winner.name} 胡了` : "本局流局"}</small><strong>{room.winningSentence || "牌山见底"}</strong></div>}
        </div>
      </section>
      <section className="composer" aria-live="polite">
        <div className="composer-label"><span>你的句子</span><small>按语序点选字牌</small></div>
        <p>{sentence || (room.status === "waiting" ? "朋友到齐，就可以开局" : "点几张牌，试着说点什么……")}</p>
        <button disabled={busy || !myTurn || room.phase !== "discard" || selected.length < 4} onClick={() => callGame("win", { sentenceIndices: selected })}>就这句 · 胡</button>
      </section>
      <section className="hand-area">
        <div className="hand-meta"><span>{room.log.at(-1) || "牌桌已准备好"}</span><span>{room.hand.length} 张手牌</span></div>
        <div className="hand" aria-label="你的手牌">
          {room.hand.length ? room.hand.map((char, index) => <button key={`${char}-${index}`} className={`tile ${selected.includes(index) ? "selected" : ""}`} onClick={() => toggleTile(index)} aria-pressed={selected.includes(index)}>{char}<small>{selected.includes(index) ? selected.indexOf(index) + 1 : ""}</small></button>) : <div className="empty-hand">开局后，你的字牌会出现在这里</div>}
          {room.status === "playing" && room.phase === "draw" && myTurn && <button className="draw-tile" onClick={() => callGame("draw")}>摸</button>}
        </div>
      </section>
      {message && <div className="game-toast" role="status">{message}<button onClick={() => setMessage("")}>×</button></div>}
      <nav className="action-bar" aria-label="牌局操作"><button onClick={() => setRulesOpen(true)}>规则</button><button className="secondary" onClick={invite}>邀请朋友</button><button className="primary" onClick={primary} disabled={primaryDisabled}>{primaryLabel}</button></nav>
      {rulesOpen && <Rules onClose={() => setRulesOpen(false)} />}
    </main>
  );
}

function Seat({ player, position, active }: { player: PlayerView; position: string; active: boolean }) {
  return <div className={`seat seat-${position} ${active ? "active-seat" : ""}`}>{player.avatarUrl ? <img className="seat-avatar" src={player.avatarUrl} alt="" /> : <span className="seat-avatar peach">{player.avatar}</span>}<span><strong>{player.name}</strong><small>{player.handCount} 张牌</small></span></div>;
}

function Rules({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="rules-card" role="dialog" aria-modal="true" aria-label="玩法说明"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">三分钟上手</p><h2>怎么打字雀</h2><ol><li><b>摸字</b><span>轮到你时，从牌山摸一张字牌。</span></li><li><b>出牌</b><span>选一张暂时用不上的字，打到牌河里。</span></li><li><b>成句</b><span>手里的牌能按顺序拼出一句至少四个字的话，就可以胡。</span></li><li><b>随心判</b><span>句子通不通，由同桌牌友投票裁定。好笑通常比工整重要。</span></li></ol><button className="rules-done" onClick={onClose}>懂了，开打</button></section></div>;
}
