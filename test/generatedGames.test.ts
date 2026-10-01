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

/*
 * The Seafarers 5-6 maps of scenarios 1-4: bots finish 5- and 6-player games
 * (paired players) on the rulebook's map and on maps generated in its style.
 */
describe('5-6 players on the Seafarers 5-6 maps', () => {
  const ids = ['seafarers-1-new-shores', 'seafarers-2-four-islands', 'seafarers-3-fog-islands', 'seafarers-4-through-the-desert'];
  for (const id of ids) {
    for (const n of [5, 6]) {
      it(`${id}: bots finish a ${n}-player game on the official map and on two generated maps`, () => {
        for (const [layout, seed] of [['official', `five-six-${n}`], ['random', `five-six-${n}-a`], ['random', `five-six-${n}-b`]] as const) {
          const start = createGame({ scenario: id, players: n, seed, options: { layout } });
          const { state } = simulateHeuristic(start, 8000, Array.from({ length: n }, (_, i) => BOT_LEVELS[i % 3]));
          expect(state.phase.kind, `${id} ${n} ${layout}`).toBe('gameOver');
          if (state.phase.kind === 'gameOver') expect(state.phase.winner, `${id} ${n} ${layout}`).not.toBeNull();
        }
      });
    }
  }
});
