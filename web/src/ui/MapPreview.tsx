import { DEFAULT_OPTIONS, createGame, getScenario, hasOfficialMap, parseRows, viewFor, type GameOptions, type GameView } from 'engine';
import { useMemo, useState } from 'preact/hooks';
import { Board, NO_TARGETS, useTurned } from '../board/Board';
import { PLAYER_COLORS } from '../game/seats';
import { Sheet } from './common';

function sampleBoard(scenario: string, players: number, options: Partial<GameOptions>, seed: string): GameView | null {
  try {
    return viewFor(createGame({ scenario, players, seed, options }), null);
  } catch {
    return null;
  }
}

/** What comes out differently from one game to the next: the whole map, only the harbors, or nothing. */
function variation(a: GameView, b: GameView): 'map' | 'harbors' | 'nothing' {
  const ha = a.board.hexes;
  const hb = b.board.hexes;
  if (Object.keys(ha).some((h) => ha[h].terrain !== hb[h]?.terrain || ha[h].token !== hb[h]?.token)) return 'map';
  const harbors = (v: GameView) =>
    v.board.harbors
      .map((x) => `${x.edge}:${x.type}`)
      .sort()
      .join();
  return harbors(a) !== harbors(b) ? 'harbors' : 'nothing';
}

const noPick = () => {};

/** Whether the rulebook deals only part of its map at random (New Shores' main island with 5-6 players). */
function dealtInPart(scenario: string, players: number, options: GameOptions): boolean {
  const spec = getScenario(scenario).officialMap?.(players, options);
  const cells = spec ? (spec.cells ?? parseRows(spec.rows ?? [])) : [];
  return cells.some((c) => c.terrain === 'random') && cells.some((c) => c.terrain !== 'random' && c.terrain !== 'sea');
}

/** The random layout: the base game's variable set-up, or a new map in the scenario's style. */
function generatedNote(scenario: string, name: string): string {
  if (scenario === 'base') return 'Shuffled tiles and numbers, as in the rulebook’s variable set-up — tap 🎲 for another.';
  return `A new map in the style of ${name} — tap 🎲 for another.`;
}

/**
 * The map the game will be played on: a small picture on the new-game
 * screen, built from the same seed and options as the game, that opens a
 * full, zoomable view. Where the map can come out differently, 🎲 deals
 * another one (a new seed).
 */
export function MapPreview({
  scenario,
  name,
  players,
  options,
  seed,
  onReroll,
}: {
  scenario: string;
  name: string;
  players: number;
  options: Partial<GameOptions>;
  seed: string;
  onReroll(): void;
}) {
  const key = `${scenario}|${players}|${JSON.stringify(options)}`;
  const view = useMemo(() => sampleBoard(scenario, players, options, seed), [key, seed]);
  const varies = useMemo(() => {
    const a = sampleBoard(scenario, players, options, 'preview-a');
    const b = sampleBoard(scenario, players, options, 'preview-b');
    return a && b ? variation(a, b) : 'nothing';
  }, [key]);
  const [big, setBig] = useState(false);
  // One orientation for the picture and its full view: the one the game uses on this screen.
  const turned = useTurned(view?.board.layoutKey ?? null);
  if (!view) return null;
  const full = { ...DEFAULT_OPTIONS, ...options };
  const printed = options.layout !== 'random' && hasOfficialMap(getScenario(scenario), players, full);
  const hidden = Object.values(view.board.hexes).some((h) => h.terrain === 'fog');
  let note: string;
  if (!printed) note = varies === 'nothing' ? 'This map is the same in every game.' : generatedNote(scenario, name);
  else if (options.citiesAndKnights) note = 'The beginners’ map from the Cities & Knights rulebook.';
  else if (varies === 'map' && dealtInPart(scenario, players, full)) note = 'Official map from the rulebook, which deals part of it at random — tap 🎲 for another.';
  else if (varies === 'map') note = 'The rulebook deals this map at random — tap 🎲 for another.';
  else if (varies === 'harbors') note = 'Official map from the rulebook. Its harbors are shuffled — tap 🎲 for another.';
  else note = 'Official map from the rulebook.';
  const fog = hidden ? 'Grey tiles are unexplored and shuffled: they turn over when a ship or road reaches them.' : '';
  const board = <Board view={view} colors={PLAYER_COLORS} targets={NO_TARGETS} accent="#ffffff" ghost={null} flash={null} onPick={noPick} turned={turned} />;
  return (
    <>
      {/* a div, not a button: the board inside has buttons of its own */}
      <div
        class={turned ? 'map-thumb turned' : 'map-thumb'}
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
      <div class="map-caption">
        <span class="hint map-note">
          {note}
          {fog && ` ${fog}`}
        </span>
        {varies !== 'nothing' && (
          <button type="button" class="map-reroll" onClick={onReroll}>
            🎲 New map
          </button>
        )}
      </div>
      {big && (
        <Sheet title={name} onClose={() => setBig(false)} wide>
          <div class="map-big">{board}</div>
          <p class="hint">
            {note}
            {fog && ` ${fog}`} Pinch or use the buttons to zoom.
          </p>
        </Sheet>
      )}
    </>
  );
}
