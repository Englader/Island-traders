import { createGame, viewFor, type GameOptions, type GameView } from 'engine';
import { useMemo, useState } from 'preact/hooks';
import { Board, NO_TARGETS } from '../board/Board';
import { PLAYER_COLORS } from '../game/seats';
import { Sheet } from './common';

function sampleBoard(scenario: string, players: number, options: Partial<GameOptions>, seed: string): GameView | null {
  try {
    return viewFor(createGame({ scenario, players, seed, options }), null);
  } catch {
    return null;
  }
}

/** True when the tiles or numbers come out differently from game to game. */
function shuffled(a: GameView, b: GameView): boolean {
  const ha = a.board.hexes;
  const hb = b.board.hexes;
  return Object.keys(ha).some((h) => ha[h].terrain !== hb[h]?.terrain || ha[h].token !== hb[h]?.token);
}

const noPick = () => {};

/**
 * What the chosen scenario's map looks like: a small picture on the
 * new-game screen that opens a full, zoomable view.
 */
export function MapPreview({ scenario, name, players, options }: { scenario: string; name: string; players: number; options: Partial<GameOptions> }) {
  const key = `${scenario}|${players}|${JSON.stringify(options)}`;
  const view = useMemo(() => sampleBoard(scenario, players, options, `preview-${scenario}`), [key]);
  const varies = useMemo(() => {
    const other = sampleBoard(scenario, players, options, `preview-${scenario}-2`);
    return !!(view && other && shuffled(view, other));
  }, [key]);
  const [big, setBig] = useState(false);
  if (!view) return null;
  const note = varies ? 'An example: tiles and numbers are shuffled for every game.' : 'This map is the same in every game.';
  const hidden = Object.values(view.board.hexes).some((h) => h.terrain === 'fog');
  const board = <Board view={view} colors={PLAYER_COLORS} targets={NO_TARGETS} accent="#ffffff" ghost={null} flash={null} onPick={noPick} />;
  return (
    <>
      {/* a div, not a button: the board inside has buttons of its own */}
      <div
        class="map-thumb"
        role="button"
        tabIndex={0}
        aria-label={`Show the ${name} map`}
        onClick={() => setBig(true)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setBig(true)}
      >
        <span class="map-thumb-board" aria-hidden="true">
          {board}
        </span>
        <span class="map-thumb-hint">🔍 Tap to see the map</span>
      </div>
      {big && (
        <Sheet title={name} onClose={() => setBig(false)} wide>
          <div class="map-big">{board}</div>
          <p class="hint">
            {note}
            {hidden ? ' Grey tiles are unexplored: they are turned over when a ship or road reaches them.' : ''} Pinch or use the buttons to zoom.
          </p>
        </Sheet>
      )}
    </>
  );
}
