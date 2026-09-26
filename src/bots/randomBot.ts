import { nextInt } from '../core/rng.js';
import type { Action, GameState, PlayerId, RngState } from '../core/types.js';
import { applyAction } from '../engine/apply.js';
import { legalActions, playersToAct } from '../engine/legal.js';

/** Relative preference per action type; keeps random games moving toward an end. */
const WEIGHTS: Partial<Record<Action['type'], number>> = {
  buildCity: 60,
  buildSettlement: 50,
  scenario: 25,
  placeHarbor: 20,
  buyDevCard: 12,
  confirmTrade: 10,
  playKnight: 6,
  playMonopoly: 1,
  playYearOfPlenty: 1,
  playRoadBuilding: 4,
  buildRoad: 6,
  buildShip: 6,
  moveShip: 1,
  bankTrade: 3,
  acceptTrade: 3,
  rejectTrade: 3,
  cancelTrade: 1,
  endRoadBuilding: 1,
  endTurn: 5,
};

/**
 * Weighted-random legal move. Road/ship spam and card-for-card bank trades
 * are divided among many options, so each *type* is weighted, then an option
 * of that type is picked uniformly.
 */
export function randomAction(state: GameState, player: PlayerId, rng: RngState): Action | null {
  const actions = legalActions(state, player);
  if (actions.length === 0) return null;
  const byType = new Map<string, Action[]>();
  for (const a of actions) {
    if (!byType.has(a.type)) byType.set(a.type, []);
    byType.get(a.type)!.push(a);
  }
  const types = [...byType.keys()];
  const weights = types.map((t) => WEIGHTS[t as Action['type']] ?? 10);
  const sum = weights.reduce((x, y) => x + y, 0);
  let roll = nextInt(rng, sum);
  let chosen = types[types.length - 1];
  for (let i = 0; i < types.length; i++) {
    if (roll < weights[i]) {
      chosen = types[i];
      break;
    }
    roll -= weights[i];
  }
  const options = byType.get(chosen)!;
  return options[nextInt(rng, options.length)];
}

export interface SimulationResult {
  state: GameState;
  steps: number;
  finished: boolean;
}

/**
 * Plays random legal moves until the game ends or `maxSteps` is reached.
 * Throws if a move produced by `legalActions` is rejected by the engine, or if
 * nobody can act (a deadlock), so it doubles as a fuzz test.
 */
export function simulate(
  initial: GameState,
  rng: RngState,
  maxSteps = 20000,
  onStep?: (s: GameState, a: Action) => void,
): SimulationResult {
  let s = initial;
  let steps = 0;
  while (s.phase.kind !== 'gameOver' && steps < maxSteps) {
    const actors = playersToAct(s);
    let acted = false;
    for (const p of actors) {
      const a = randomAction(s, p, rng);
      if (!a) continue;
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`legal action rejected: ${JSON.stringify(a)} -> ${r.error} (phase ${s.phase.kind})`);
      s = r.state;
      onStep?.(s, a);
      acted = true;
      break;
    }
    if (!acted) throw new Error(`deadlock in phase ${s.phase.kind}: nobody can act`);
    steps++;
  }
  return { state: s, steps, finished: s.phase.kind === 'gameOver' };
}
