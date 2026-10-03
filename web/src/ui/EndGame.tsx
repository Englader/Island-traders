import type { GameView, PlayerId } from 'engine';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { formatRough, type ClockFeed } from '../game/clock';
import { sound } from '../game/sound';
import { endCue } from '../game/soundCues';
import type { PlayerColor, SeatKind } from '../game/seats';
import { Sheet } from './common';
import { GameStatsSheet } from './GameStats';
import './endgame.css';

/**
 * The end of the game: a results popup celebrating the winner, with the game
 * stats one tap away. The popup can be closed to look at the final board;
 * a "Results" chip brings it back.
 */
export function EndGame({
  view,
  colors,
  kinds,
  seat,
  clock,
  covered,
  onHome,
  onRematch,
  onDice,
}: {
  view: GameView;
  colors: PlayerColor[];
  kinds: SeatKind[];
  seat: PlayerId | null;
  /** The game clock (null: the game was not timed). */
  clock: ClockFeed | null;
  /** Another sheet (the log, the dice statistics) is open on top. */
  covered?: boolean;
  onHome(): void;
  onRematch?: () => void;
  /** Opens the dice statistics. */
  onDice(): void;
}) {
  const [open, setOpen] = useState(true);
  const [stats, setStats] = useState(false);
  // The chip sits at the foot of the map (or of the screen, if there is no map area).
  const [boardArea, setBoardArea] = useState<Element | null>(null);
  useLayoutEffect(() => setBoardArea(document.querySelector('.game .board-area')), []);
  // a fanfare for a win at this device, a gentle close otherwise (once, after the last move's own sound)
  useEffect(() => {
    const cue = endCue(view, seat, kinds);
    if (cue) sound.play(cue, { delay: 0.45 });
  }, []);
  const ph = view.phase;
  if (ph.kind !== 'gameOver' || covered) return null;
  if (stats) {
    return (
      <GameStatsSheet
        view={view}
        colors={colors}
        kinds={kinds}
        seat={seat}
        clock={clock}
        onDice={onDice}
        close={() => {
          setStats(false);
          setOpen(true);
        }}
      />
    );
  }
  if (!open) {
    const chip = (
      <button type="button" class={boardArea ? 'results-chip' : 'results-chip floating'} onClick={() => setOpen(true)} aria-label="Show the results">
        <span aria-hidden="true">🏆</span> Results
      </button>
    );
    return boardArea ? createPortal(chip, boardArea) : chip;
  }

  const winner = ph.winner;
  const name = (p: PlayerId) => view.players[p]?.name ?? '';
  const vp = (p: PlayerId) => view.players[p].totalVP ?? view.players[p].publicVP;
  const ranked = [...view.players].sort((a, b) => (a.id === winner ? -1 : b.id === winner ? 1 : vp(b.id) - vp(a.id)));
  const title = winner === null ? 'Game over' : winner === seat ? 'You win!' : `${name(winner)} wins!`;
  return (
    <Sheet title={title} onClose={() => setOpen(false)}>
      <div class="eg">
        <div class="eg-hero" style={winner !== null ? ({ '--pc': colors[winner].fill } as Record<string, string>) : undefined}>
          <span class="eg-trophy" aria-hidden="true">
            🏆
          </span>
          <div class="eg-hero-text">
            <strong>{winner === null ? 'Nobody wins' : winner === seat ? 'Congratulations!' : name(winner)}</strong>
            <span>
              {ph.reason} · {view.turn.number} turns{clock ? ` · ${formatRough(clock.sum.playedMs)}` : ''}
            </span>
          </div>
        </div>
        <ol class="eg-ranking">
          {ranked.map((p, i) => (
            <li key={p.id} class={p.id === winner ? 'eg-first' : undefined}>
              <span class="eg-place">{i + 1}</span>
              <span class="dot" style={{ background: colors[p.id].fill, borderColor: colors[p.id].stroke }} />
              <span class="eg-name">
                {p.name}
                {p.id === seat && <span class="you">you</span>}
              </span>
              <strong class="eg-vp">{vp(p.id)} VP</strong>
            </li>
          ))}
        </ol>
        <div class="eg-buttons">
          <button type="button" onClick={() => setStats(true)}>
            📊 Game stats
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            🗺️ View map
          </button>
        </div>
        <div class="eg-buttons">
          {onRematch && (
            <button type="button" class="primary" onClick={onRematch}>
              Play again
            </button>
          )}
          <button type="button" onClick={onHome}>
            Home
          </button>
        </div>
      </div>
    </Sheet>
  );
}
