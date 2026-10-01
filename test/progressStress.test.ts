import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS,
  PROGRESS_CARDS,
  createGame,
  seedRng,
  simulate,
  simulateHeuristic,
  totalVP,
  type Action,
  type GameState,
  type ProgressCardName,
} from '../src/index.js';
import { CK, checkInvariants } from './ckHelpers.js';

/**
 * Cities & Knights with every progress card: whole games between random
 * bots (every legal move must be accepted, and some player must always be
 * able to move) and the heuristic fallback, with the rule invariants
 * (cards, commodities and progress cards conserved per deck, pieces, VP)
 * checked after every action.
 */

const CARDS = (Object.keys(PROGRESS_CARDS) as ProgressCardName[]).filter((c) => !PROGRESS_CARDS[c].vp);
const STAGES = [
  'smith:promote',
  'deserter:desert',
  'deserter:place',
  'diplomat:rebuild',
  'saboteur:discard',
  'spy:take',
  'wedding:give',
  'commercialHarbor:exchange',
  'masterMerchant:take',
];

interface Seen {
  cards: Set<string>;
  stages: Set<string>;
  games: number;
  finished: number;
}

const seen: Seen = { cards: new Set(), stages: new Set(), games: 0, finished: 0 };

function watch(s: GameState, a: Action): void {
  checkInvariants(s);
  if (a.type === 'playProgress') seen.cards.add(a.card);
  const ph = s.phase;
  if (ph.kind === 'ck' && ph.step === 'card') seen.stages.add(`${ph.card}:${ph.stage}`);
  if (ph.kind === 'robber' && ph.reason === 'bishop') seen.stages.add('bishop:robber');
  if (ph.kind === 'ck' && ph.step === 'retreat' && a.type === 'playProgress' && a.card === 'intrigue') seen.stages.add('intrigue:retreat');
}

function finishedWell(s: GameState): void {
  checkInvariants(s, true);
  expect(s.phase.kind).toBe('gameOver');
  const ph = s.phase as Extract<GameState['phase'], { kind: 'gameOver' }>;
  expect(totalVP(s, ph.winner!)).toBeGreaterThanOrEqual(13);
  seen.games++;
  seen.finished++;
}

describe('Cities & Knights with progress cards: stress', () => {
  for (const n of [3, 4]) {
    it(`random bots: ${n}-player games end with every invariant intact after every action`, () => {
      for (let i = 0; i < 4; i++) {
        const layout = i % 2 === 0 ? 'official' : 'random';
        const g = createGame({ scenario: 'base', players: n, seed: `p2-random-${n}-${i}`, options: { ...CK, layout } });
        const r = simulate(g, seedRng(`p2-random-bots-${n}-${i}`), 40000, watch);
        expect(r.finished, `game ${i}`).toBe(true);
        finishedWell(r.state);
      }
    });

    it(`heuristic bots: ${n}-player games at every level end with every invariant intact`, () => {
      for (const [i, level] of BOT_LEVELS.entries()) {
        const g = createGame({ scenario: 'base', players: n, seed: `p2-heur-${n}-${level}`, options: { ...CK, layout: i % 2 ? 'random' : 'official' } });
        const levels = Array.from({ length: n }, (_, p) => BOT_LEVELS[(i + p) % BOT_LEVELS.length]);
        const { state } = simulateHeuristic(g, 8000, levels, watch);
        finishedWell(state);
        expect(state.ck!.played!.length).toBeGreaterThan(0);
      }
    });
  }

  it('the games play every progress card and reach every choice', () => {
    // (runs after the games above, in this file's order)
    expect(seen.games).toBe(2 * 4 + 2 * BOT_LEVELS.length);
    expect(CARDS.filter((c) => !seen.cards.has(c))).toEqual([]);
    expect([...STAGES, 'bishop:robber', 'intrigue:retreat'].filter((x) => !seen.stages.has(x))).toEqual([]);
  });
});
