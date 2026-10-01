import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createGame,
  legalActions,
  playersToAct,
  seedRng,
  simulate,
  simulateHeuristic,
  viewFor,
  type Action,
  type GameConfig,
} from '../src/index.js';

/**
 * Games without Cities & Knights must play exactly as they did before the
 * expansion existed: the same seeds give the same states, logs, views and
 * legal moves. The fingerprints below were recorded on the engine before
 * Cities & Knights was added (commit fb6e3f7); a change here means base or
 * Seafarers games behave differently.
 */
function fingerprint(config: GameConfig, mode: 'random' | 'heuristic', steps: number): string {
  const h = createHash('sha256');
  const start = createGame(config);
  h.update(JSON.stringify(start));
  const actions: Action[] = [];
  const final =
    mode === 'random'
      ? simulate(start, seedRng(`regression-${String(config.seed)}`), steps, (_s, a) => actions.push(a)).state
      : simulateHeuristic(start, steps).state;
  h.update(JSON.stringify(actions));
  h.update(JSON.stringify(final));
  h.update(JSON.stringify(viewFor(final, 0)));
  h.update(JSON.stringify(viewFor(final, null)));
  for (const p of playersToAct(final)) h.update(JSON.stringify(legalActions(final, p)));
  return h.digest('hex').slice(0, 16);
}

const CASES: Array<{ name: string; config: GameConfig; mode: 'random' | 'heuristic'; steps: number; hash: string }> = [
  { name: 'base, 3 players, official map, random bots', config: { scenario: 'base', players: 3, seed: 'reg-1' }, mode: 'random', steps: 800, hash: 'c5e5615e376d4ef0' },
  { name: 'base, 4 players, random map, random bots', config: { scenario: 'base', players: 4, seed: 'reg-2', options: { layout: 'random' } }, mode: 'random', steps: 800, hash: '654fde1b8d434070' },
  { name: 'base, 5 players, paired players, random bots', config: { scenario: 'base', players: 5, seed: 'reg-3' }, mode: 'random', steps: 800, hash: '87eee7c62e19d762' },
  { name: 'base, 6 players, special build phase, random bots', config: { scenario: 'base', players: 6, seed: 'reg-4', options: { fiveSixMode: 'specialBuild', layout: 'random' } }, mode: 'random', steps: 800, hash: '3b853da0d33022de' },
  { name: 'base, 4 players, heuristic bots, whole game', config: { scenario: 'base', players: 4, seed: 'reg-5' }, mode: 'heuristic', steps: 4000, hash: 'a8c65213c62e51ff' },
  { name: 'Heading for New Shores, 4 players, random bots', config: { scenario: 'seafarers-1-new-shores', players: 4, seed: 'reg-6' }, mode: 'random', steps: 800, hash: '367e06b71932b467' },
  { name: 'The Fog Islands, 3 players, random map, random bots', config: { scenario: 'seafarers-3-fog-islands', players: 3, seed: 'reg-7', options: { layout: 'random' } }, mode: 'random', steps: 800, hash: 'c064237fc7525315' },
  { name: 'Cloth Trade, 4 players, random bots', config: { scenario: 'seafarers-6-cloth-trade', players: 4, seed: 'reg-8' }, mode: 'random', steps: 800, hash: '07c3defea60cfa96' },
  { name: 'The Pirate Islands, 4 players, heuristic bots, whole game', config: { scenario: 'seafarers-7-pirate-islands', players: 4, seed: 'reg-9' }, mode: 'heuristic', steps: 4000, hash: '9e2ea6feb15fe90e' },
  { name: 'The Wonders, 3 players, heuristic bots, whole game', config: { scenario: 'seafarers-8-wonders', players: 3, seed: 'reg-10' }, mode: 'heuristic', steps: 4000, hash: 'b9b044ce56061521' },
  { name: 'New World, 5 players, random bots', config: { scenario: 'seafarers-9-new-world', players: 5, seed: 'reg-11' }, mode: 'random', steps: 800, hash: '6200701285727312' },
];

describe('base and Seafarers games are unchanged by Cities & Knights', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(fingerprint(c.config, c.mode, c.steps)).toBe(c.hash);
    });
  }
});
