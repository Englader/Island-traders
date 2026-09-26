import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, BUILT_IN_SCENARIOS, createGame, simulateHeuristic } from '../src/index.js';

/*
 * Computer players finish whole games on generated maps (the random layout)
 * in every scenario: a few seeds each, with an easy, a medium and a hard
 * player at the table (the heuristic bot tests play one seed per player count).
 */
describe('games on generated maps', () => {
  for (const sc of BUILT_IN_SCENARIOS) {
    it(`${sc.id}: bots finish games on three generated maps`, () => {
      const n = Math.max(3, sc.minPlayers);
      for (const seed of ['gen-game-1', 'gen-game-2', 'gen-game-3']) {
        const start = createGame({ scenario: sc.id, players: n, seed, options: { layout: 'random' } });
        const { state } = simulateHeuristic(start, 6000, BOT_LEVELS.slice(0, n));
        expect(state.phase.kind, `${sc.id} ${seed}`).toBe('gameOver');
      }
    });
  }
});
