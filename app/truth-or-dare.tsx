"use client";

import type { RoomView } from "./game-types";

export default function TruthOrDare({ room, playerKey, busy, callGame }: {
  room: RoomView;
  playerKey: string;
  busy: boolean;
  callGame: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
}) {
  const losers = room.losingPlayerIds || [];
  if (room.status !== "finished" || losers.length === 0) return null;
  const mine = room.challenges?.find((item) => item.playerId === playerKey);
  const iLost = losers.includes(playerKey);

  return <section className="challenge-panel" aria-label="真心话大冒险">
    <div className="challenge-heading"><span>输家加赛</span><strong>真心话 or 大冒险</strong></div>
    {room.challenges?.length > 0 && <div className="challenge-cards">{room.challenges.map((challenge) => {
      const player = room.players.find((item) => item.id === challenge.playerId);
      return <article key={challenge.playerId} className={`challenge-card challenge-${challenge.type}`}>
        <small>{player?.name || "牌友"} · {challenge.type === "truth" ? "真心话" : "大冒险"}</small>
        <p>{challenge.prompt}</p>
      </article>;
    })}</div>}
    {iLost ? <div className="challenge-actions">
      <button disabled={busy} onClick={() => callGame("challenge", { challengeType: "truth" })}>{mine?.type === "truth" ? "换一道真心话" : "选真心话"}</button>
      <button disabled={busy} onClick={() => callGame("challenge", { challengeType: "dare" })}>{mine?.type === "dare" ? "换一个大冒险" : "选大冒险"}</button>
    </div> : room.challenges.length === 0 ? <p className="challenge-waiting">等输家自己选，赢家不许替人做主。</p> : null}
  </section>;
}
