"use client";

import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type AvatarColor = "cinnabar" | "jade" | "ocean" | "plum" | "amber" | "ink";
type PlayerView = { id: string; name: string; avatar: string; avatarColor: AvatarColor; avatarUrl: string | null; handCount: number; seat: number };
type RoomView = {
  code: string; revision: number; status: "waiting" | "playing" | "finished";
  phase: "waiting" | "draw" | "discard" | "voting" | "finished"; turn: number; currentPlayerId: string | null;
  hostId: string; winnerId: string | null; winningSentence: string | null; deckCount: number;
  pendingWin: { playerId: string; sentence: string; approvals: number; rejections: number; votesCast: number; totalVoters: number; myVote: "approve" | "reject" | null } | null;
  discards: string[]; log: string[]; players: PlayerView[]; hand: string[]; me: { id: string; name: string; seat: number } | null;
};

const AVATAR_COLORS: { key: AvatarColor; label: string }[] = [
  { key: "cinnabar", label: "朱砂红" }, { key: "jade", label: "翡翠绿" },
  { key: "ocean", label: "远山蓝" }, { key: "plum", label: "梅子紫" },
  { key: "amber", label: "琥珀黄" }, { key: "ink", label: "墨色" },
];

function gameApi(path: string) {
  const configuredBase = typeof window === "undefined"
    ? ""
    : ((window as typeof window & { __ZIQUE_API_BASE__?: string }).__ZIQUE_API_BASE__ || "");
  return `${configuredBase.replace(/\/$/, "")}${path}`;
}

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
  const [shareOpen, setShareOpen] = useState(false);
  const [avatarColor, setAvatarColor] = useState<AvatarColor>("cinnabar");
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    const key = getDeviceKey();
    const savedName = localStorage.getItem("zique_name");
    const params = new URLSearchParams(window.location.search);
    const savedColor = (localStorage.getItem("zique_avatar_color") || "") as AvatarColor;
    const color = AVATAR_COLORS.some((item) => item.key === savedColor)
      ? savedColor
      : AVATAR_COLORS[Math.abs([...key].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % AVATAR_COLORS.length].key;
    const linkedRoom = (params.get("room") || "").slice(0, 4);
    const rememberedRoom = (localStorage.getItem("zique_last_room") || "").slice(0, 4);
    const targetRoom = linkedRoom || rememberedRoom;
    setPlayerKey(key);
    if (savedName) setName(savedName);
    setAvatarColor(color);
    localStorage.setItem("zique_avatar_color", color);
    if (targetRoom) setJoinCode(targetRoom);

    const restore = async () => {
      if (!targetRoom) { setRestoring(false); return; }
      try {
        const response = await fetch(gameApi(`/api/game?code=${targetRoom}&playerKey=${encodeURIComponent(key)}`), { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          setRoom(data);
          history.replaceState(null, "", `?room=${targetRoom}`);
          return;
        }
        if (linkedRoom && savedName && response.status === 403) {
          const join = await fetch(gameApi("/api/game"), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "join", code: linkedRoom, playerKey: key, name: savedName, avatarColor: color }),
          });
          if (join.ok) {
            const data = await join.json();
            setRoom(data);
            localStorage.setItem("zique_last_room", linkedRoom);
            return;
          }
        }
        if (!linkedRoom) localStorage.removeItem("zique_last_room");
      } catch { setMessage("暂时没能找回上次的牌桌，可以重新输入房号"); }
      finally { setRestoring(false); }
    };
    void restore();
  }, []);

  useEffect(() => {
    if (!room || !playerKey) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(gameApi(`/api/game?code=${room.code}&playerKey=${encodeURIComponent(playerKey)}`), { cache: "no-store" });
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
      localStorage.setItem("zique_avatar_color", avatarColor);
      const response = await fetch(gameApi("/api/game"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, code: room?.code || joinCode, playerKey, name, avatarColor, ...extra }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作没有成功");
      setRoom(data); setJoinCode(data.code); setSelected([]);
      if (action === "create" || action === "join") {
        localStorage.setItem("zique_last_room", data.code);
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

  const leaveToLobby = () => {
    localStorage.removeItem("zique_last_room");
    setRoom(null); setSelected([]); setMessage("");
    history.replaceState(null, "", "/");
  };

  const invite = () => { if (room) setShareOpen(true); };

  if (restoring && !room) {
    return <main className="restore-screen"><span className="brand-mark">字</span><p>正在找回你的牌桌…</p></main>;
  }

  if (!room) {
    return (
      <main className="landing-shell">
        <header className="landing-nav">
          <a className="brand" href="#"><span className="brand-mark">字</span><span><strong>字雀</strong><small>把话打到牌桌上</small></span></a>
          <div className="light-login"><span className={`profile-dot color-${avatarColor}`}>{name.trim().slice(0, 1) || "友"}</span><span><strong>免注册轻登录</strong><small>此设备会记住你</small></span></div>
        </header>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">2—4 人 · 在线文字麻将</p>
            <h1>把一句话，<br /><em>打</em>到牌桌上。</h1>
            <p className="hero-intro">摸到什么字，就说什么话。没有标准答案，只有今晚最值得截图的那一句。</p>
            <div className="profile-fields">
              <label className="name-field"><span>怎么称呼你</span><input value={name} onChange={(event) => setName(event.target.value.slice(0, 10))} placeholder="输入昵称" autoComplete="nickname" /></label>
              <div className="color-picker" aria-label="选择头像颜色">{AVATAR_COLORS.map((item) => <button key={item.key} className={`color-swatch color-${item.key} ${avatarColor === item.key ? "active" : ""}`} onClick={() => setAvatarColor(item.key)} aria-label={item.label} aria-pressed={avatarColor === item.key} />)}</div>
              <small className="profile-note">昵称和颜色只保存在这台设备；刷新、断线会自动回桌。</small>
            </div>
            <div className="start-actions">
              <button className="create-room" onClick={() => callGame("create")} disabled={busy}>{busy ? "正在铺桌…" : "开一桌"}<span>→</span></button>
              <div className="join-room"><input inputMode="numeric" maxLength={4} value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="输入 4 位房号" /><button onClick={() => callGame("join")} disabled={busy || joinCode.length !== 4}>入座</button></div>
            </div>
            {message && <p className="notice" role="status">{message}</p>}
            <div className="trust-row"><span>无需注册</span><span>不收手机号邮箱</span><span>自动找回牌桌</span></div>
          </div>
          <div className="hero-visual" aria-label="文字麻将示意">
            <div className="red-stamp">今夜<br />开局</div>
            <div className="floating-tile tile-one">我</div><div className="floating-tile tile-two">们</div><div className="floating-tile tile-three">去</div><div className="floating-tile tile-four">月</div><div className="floating-tile tile-five">亮</div><div className="floating-tile tile-six">上</div>
            <p>一句离谱的话<br />通常从一张好牌开始</p>
          </div>
        </section>
        <footer className="landing-footer"><span>玩法借鉴《白色失明文字麻将》 · 非官方线上版本</span><button onClick={() => setRulesOpen(true)}>先看玩法</button></footer>
        {rulesOpen && <Rules onClose={() => setRulesOpen(false)} />}
      </main>
    );
  }

  const otherPlayers = room.players.filter((player) => player.id !== playerKey);
  const currentPlayer = room.players.find((player) => player.id === room.currentPlayerId);
  const winner = room.players.find((player) => player.id === room.winnerId);
  const claimant = room.players.find((player) => player.id === room.pendingWin?.playerId);
  const statusText = room.status === "waiting" ? "等朋友入座" : room.status === "finished" ? "这一局结束了" : room.phase === "voting" ? `${claimant?.name || "牌友"} 申请胡牌，等待判定` : myTurn ? (room.phase === "draw" ? "轮到你摸牌" : "轮到你出牌或申请胡牌") : `${currentPlayer?.name || "牌友"} 正在想一句狠话`;

  const primary = () => {
    if (room.status === "waiting") return isHost ? callGame("start") : undefined;
    if (room.status === "finished") return isHost ? callGame("restart") : undefined;
    if (!myTurn) return undefined;
    if (room.phase === "voting") return undefined;
    if (room.phase === "draw") return callGame("draw");
    if (room.phase === "discard" && selected.length === 1) return callGame("discard", { tileIndex: selected[0] });
  };
  const primaryLabel = room.status === "waiting" ? (isHost ? "人齐了 · 开局" : "等房主开局") : room.status === "finished" ? (isHost ? "再来一局" : "等房主再开一局") : room.phase === "voting" ? "等待牌友判定" : !myTurn ? "还没轮到你" : room.phase === "draw" ? "摸一张" : selected.length === 1 ? `打出「${room.hand[selected[0]]}」` : "选一张牌打出";
  const primaryDisabled = busy || (room.status === "waiting" && (!isHost || room.players.length < 2)) || (room.status === "finished" && !isHost) || (room.status === "playing" && (room.phase === "voting" || !myTurn || (room.phase === "discard" && selected.length !== 1)));

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="brand brand-button" onClick={leaveToLobby}><span className="brand-mark">字</span><span><strong>字雀</strong><small>把话打到牌桌上</small></span></button>
        <button className="room-chip room-button" onClick={invite}><span className="live-dot" />房间 {room.code} · {room.players.length}/4 人 · 点此邀请</button>
        <button className={`avatar color-${avatarColor}`} aria-label="当前轻登录身份">{room.me?.name.slice(0, 1) || "友"}</button>
      </header>
      <section className="table-wrap" aria-label="文字麻将牌桌">
        {otherPlayers.map((player, index) => <Seat key={player.id} player={player} position={["top", "left", "right"][index] || "right"} active={player.id === room.currentPlayerId} />)}
        {room.players.length < 4 && room.status === "waiting" && <div className={`seat seat-${["top", "left", "right"][otherPlayers.length] || "right"} waiting`}><span className="seat-avatar">＋</span><span><strong>等朋友入座</strong><small>分享房号 {room.code}</small></span></div>}
        <div className="felt-table">
          <div className={`turn-badge ${myTurn ? "your-turn" : ""}`}>{statusText}</div>
          {room.status === "waiting" ? <div className="waiting-table"><strong>{room.players.length} 位牌友已入座</strong><p>{room.players.length < 2 ? "再邀请至少一位朋友" : "房主随时可以开局"}</p><button onClick={invite}>复制邀请 · {room.code}</button></div> : <div className="discard-grid" aria-label="牌河">{room.discards.length ? room.discards.map((char, index) => <span className="mini-tile" key={`${char}-${index}`}>{char}</span>) : <span className="empty-river">还没有人出牌</span>}</div>}
          <div className="deck-count"><span>牌山</span><strong>{room.deckCount}</strong></div>
          {room.status === "finished" && <div className="winner-card"><small>{winner ? `${winner.name} 胡了` : "本局流局"}</small><strong>{room.winningSentence || "牌山见底"}</strong></div>}
          {room.pendingWin && <div className="vote-card">
            <small>{claimant?.name || "牌友"} 申请胡牌</small>
            <strong>「{room.pendingWin.sentence}」</strong>
            {room.pendingWin.playerId === playerKey
              ? <p>等待牌友判定 · {room.pendingWin.votesCast}/{room.pendingWin.totalVoters}</p>
              : room.pendingWin.myVote
                ? <p>你已投票，等待其他牌友 · {room.pendingWin.votesCast}/{room.pendingWin.totalVoters}</p>
                : <div className="vote-actions"><button onClick={() => callGame("voteWin", { approve: false })}>不算胡</button><button onClick={() => callGame("voteWin", { approve: true })}>算胡</button></div>}
          </div>}
        </div>
      </section>
      <section className="composer" aria-live="polite">
        <div className="composer-label"><span>你的句子</span><small>按语序点选字牌</small></div>
        <p>{sentence || (room.status === "waiting" ? "朋友到齐，就可以开局" : "点几张牌，试着说点什么……")}</p>
        <button disabled={busy || !myTurn || room.phase !== "discard" || selected.length < 4} onClick={() => callGame("win", { sentenceIndices: selected })}>申请胡牌</button>
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
      {shareOpen && <ShareRoom code={room.code} onClose={() => setShareOpen(false)} onNotice={setMessage} />}
    </main>
  );
}

function ShareRoom({ code, onClose, onNotice }: { code: string; onClose: () => void; onNotice: (message: string) => void }) {
  const url = typeof window === "undefined" ? "" : (() => {
    const target = new URL(window.location.href);
    target.search = "";
    target.hash = "";
    target.searchParams.set("room", code);
    return target.toString();
  })();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      onNotice("邀请链接已复制");
      onClose();
    } catch { onNotice("复制失败，可以让朋友直接扫码"); }
  };

  const systemShare = async () => {
    try { await navigator.share({ title: "来字雀打文字麻将", text: `房号 ${code}，等你入座`, url }); }
    catch { /* 用户取消分享 */ }
  };

  return <div className="modal-backdrop">
    <section className="share-card" role="dialog" aria-modal="true" aria-label="分享房间二维码">
      <button className="modal-close" onClick={onClose}>×</button>
      <p className="eyebrow">邀请牌友</p>
      <h2>扫码入座</h2>
      <p className="share-room-code">房间 <strong>{code}</strong></p>
      <div className="qr-frame"><QRCodeSVG value={url} size={220} level="M" marginSize={4} bgColor="#fffaf0" fgColor="#24231f" title={`字雀房间 ${code} 邀请二维码`} /></div>
      <p className="share-tip">朋友扫码即可打开游戏并自动填写房号</p>
      <div className="share-actions">
        <button className="copy-share" onClick={copyLink}>复制邀请链接</button>
        {typeof navigator !== "undefined" && navigator.share && <button className="native-share" onClick={systemShare}>更多分享</button>}
      </div>
    </section>
  </div>;
}

function Seat({ player, position, active }: { player: PlayerView; position: string; active: boolean }) {
  return <div className={`seat seat-${position} ${active ? "active-seat" : ""}`}>{player.avatarUrl ? <img className="seat-avatar" src={player.avatarUrl} alt="" /> : <span className={`seat-avatar color-${player.avatarColor || "cinnabar"}`}>{player.avatar}</span>}<span><strong>{player.name}</strong><small>{player.handCount} 张牌</small></span></div>;
}

function Rules({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="rules-card" role="dialog" aria-modal="true" aria-label="玩法说明"><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">三分钟上手</p><h2>怎么打字雀</h2><ol><li><b>摸字</b><span>轮到你时，从牌山摸一张字牌。</span></li><li><b>出牌</b><span>选一张暂时用不上的字，打到牌河里。</span></li><li><b>申请胡牌</b><span>用至少四张字牌组成一句话，提交给同桌牌友判定。</span></li><li><b>牌友投票</b><span>申请者不能给自己投票；其余牌友全部投票，赞成过半才算胡，平票则驳回。</span></li></ol><button className="rules-done" onClick={onClose}>懂了，开打</button></section></div>;
}
