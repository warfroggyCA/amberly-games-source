import { useMemo } from "react";
import type { GameState } from "../domain/game";
import { deriveLeadCounts, type LeadSpell } from "../domain/lead-counts";

const endings: Record<LeadSpell["endedBy"], string> = {
  tie: "tied at the top",
  overtaken: "overtaken",
  "final-adjustment": "changed by final adjustments",
  "game-ended": "held to the last turn",
};

export function LeadCounts({ game }: { game: GameState }) {
  const counts = useMemo(() => deriveLeadCounts(game), [game]);
  return (
    <details className="lead-counts">
      <summary>Lead counts</summary>
      <section
        aria-label="Lead counts"
        className="lead-counts-content"
        tabIndex={0}
      >
        {!counts.available ? (
          <p>Lead counts unavailable. {counts.reason}</p>
        ) : (
          <>
            <h2>Completed game · {counts.completedTurns} turns</h2>
            <p>Complete corrected record · independent of replay position.</p>
            {game.assistance && <p>Recorded assisted turns are included.</p>}
            {counts.finalLeadChanged && (
              <p className="lead-ending-note">
                Final adjustments changed the lead without adding a turn.
              </p>
            )}
            {counts.players.map((player) => (
              <article key={player.playerId}>
                <h3>
                  {game.players.find((p) => p.id === player.playerId)?.name ??
                    "Player"}
                </h3>
                <dl>
                  <div>
                    <dt>Times taking the lead</dt>
                    <dd>{player.entries}</dd>
                  </div>
                  <div>
                    <dt>Regains after the first lead</dt>
                    <dd>{player.regains}</dd>
                  </div>
                  <div>
                    <dt>Total turns led alone</dt>
                    <dd>{player.turnsLed}</dd>
                  </div>
                  <div>
                    <dt>Turns tied at the top</dt>
                    <dd>{player.coLeadingTurns}</dd>
                  </div>
                  <div>
                    <dt>Longest spell</dt>
                    <dd>
                      {player.longest === null
                        ? "—"
                        : `${player.longest} ${player.longest === 1 ? "turn" : "turns"}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Average spell</dt>
                    <dd>
                      {player.average === null
                        ? "—"
                        : `${Number(player.average.toFixed(1))} ${Number(player.average.toFixed(1)) === 1 ? "turn" : "turns"}`}
                    </dd>
                  </div>
                </dl>
                {player.spells.length ? (
                  <ol
                    aria-label={`${game.players.find((p) => p.id === player.playerId)?.name ?? "Player"} lead spells`}
                  >
                    {player.spells.map((spell) => (
                      <li key={spell.firstTurn}>
                        {spell.firstTurn === spell.lastTurn
                          ? `Turn ${spell.firstTurn}`
                          : `Turns ${spell.firstTurn}–${spell.lastTurn}`}
                        {` · ${spell.turns} ${spell.turns === 1 ? "turn" : "turns"} · ${endings[spell.endedBy]}`}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>No sole-lead spells.</p>
                )}
              </article>
            ))}
            <details>
              <summary>How turns are counted</summary>
              <p>
                Each completed turn by any player counts, including passes and
                exchanges. These are turns, not full rounds or time. A spell
                includes the turn gaining the sole lead, but not the turn losing
                it. A tie ends a sole-lead spell; all-zero scores count as no
                lead.
              </p>
              <p>
                Undone turns do not count. Final rack adjustments add no turns.
                A regain can follow a tie; it does not necessarily mean a
                comeback from behind. This describes the game, not a competitive
                ranking.
              </p>
            </details>
          </>
        )}
      </section>
    </details>
  );
}
