import { describe, expect, it } from 'vitest';
import {
  CARDS,
  COMMODITIES,
  RESOURCES,
  createGame,
  nextInt,
  seedRng,
  shuffle,
  simulateHeuristic,
  viewFor,
  type Card,
  type GameState,
  type PlayerId,
  type RngState,
} from '../src/index.js';
import { seenOfView } from '../web/src/game/seen.js';
import { CK } from './ckHelpers.js';

/**
 * The trade screens show what you have seen of the other hands (web/src/game/seen.ts,
 * over the computer players' tracker): only from your own view of the game.
 */

const pileOf = (s: GameState, q: PlayerId, k: Card): Record<string, number> =>
  ((COMMODITIES as readonly string[]).includes(k) ? s.ck!.players[q].commodities : s.players[q].resources) as Record<string, number>;

function cardsOf(s: GameState, q: PlayerId, kinds: readonly Card[]): Card[] {
  return kinds.flatMap((k) => Array<Card>(pileOf(s, q, k)[k]).fill(k));
}

/** The same game with the cards hidden from `me` swapped around between the other hands (each keeps its size). */
function scramble(s: GameState, me: PlayerId, rng: RngState): GameState {
  const t = structuredClone(s);
  const others = t.players.map((x) => x.id).filter((q) => q !== me);
  for (let i = 0; i < 12; i++) {
    const [a, b] = shuffle(rng, [...others]).slice(0, 2);
    if (b === undefined) break;
    for (const kinds of t.ck ? [RESOURCES, COMMODITIES] : [RESOURCES]) {
      const ha = cardsOf(t, a, kinds);
      const hb = cardsOf(t, b, kinds);
      if (ha.length === 0 || hb.length === 0) continue;
      const x = ha[nextInt(rng, ha.length)];
      const y = hb[nextInt(rng, hb.length)];
      pileOf(t, a, x)[x]--;
      pileOf(t, a, y)[y]++;
      pileOf(t, b, y)[y]--;
      pileOf(t, b, x)[x]++;
    }
  }
  return t;
}

function samples(scenario: string, players: number, ck: boolean, every = 7): GameState[] {
  const s = createGame({ scenario, players, seed: `seen-${scenario}-${players}-${ck}`, options: { ...(ck ? CK : {}), firstPlayer: 0 } });
  const out: GameState[] = [];
  let i = 0;
  simulateHeuristic(s, 6000, 'medium', (st) => {
    if (++i % every === 0 && st.phase.kind !== 'gameOver') out.push(structuredClone(st));
  });
  return out;
}

const cases: Array<[string, number, boolean]> = [
  ['base', 3, false],
  ['base', 4, false],
  ['base', 6, false],
  ['seafarers-1-new-shores', 4, false],
  ['seafarers-3-fog-islands', 4, false],
  ['seafarers-5-forgotten-tribe', 4, false],
  ['seafarers-6-cloth-trade', 4, false],
  ['seafarers-7-pirate-islands', 4, false],
  ['seafarers-8-wonders', 4, false],
  ['base', 3, true],
  ['base', 4, true],
  ['seafarers-1-new-shores', 4, true],
];

describe('what you have seen of the other hands', () => {
  for (const [scenario, players, ck] of cases) {
    it(`${scenario}, ${players} players${ck ? ', Cities & Knights' : ''}: the same whatever the hidden hands hold, and true`, () => {
      const rng = seedRng('seen');
      const states = samples(scenario, players, ck);
      expect(states.length).toBeGreaterThan(40);
      let changed = 0;
      let checked = 0;
      let narrowed = 0;
      for (const s of states) {
        const seen = seenOfView(viewFor(s, 0), 0);
        expect(seen[0]).toBeNull();
        const others = s.players.map((p) => p.id).filter((q) => q !== 0);

        // the other hands differ, the public history is the same: so is what you have seen
        const other = scramble(s, 0, rng);
        if (others.some((q) => JSON.stringify(cardsOf(other, q, ck ? CARDS : RESOURCES)) !== JSON.stringify(cardsOf(s, q, ck ? CARDS : RESOURCES)))) changed++;
        expect(seenOfView(viewFor(other, 0), 0)).toEqual(seen);

        // and the ranges hold the real hands
        for (const q of others) {
          const h = seen[q]!;
          let pinned = 0;
          for (const k of ck ? CARDS : RESOURCES) {
            const real = pileOf(s, q, k)[k];
            const r = h.cards[k]!;
            expect(real, `P${q + 1} ${k} at turn ${s.turn.number}`).toBeGreaterThanOrEqual(r.min);
            expect(real, `P${q + 1} ${k} at turn ${s.turn.number}`).toBeLessThanOrEqual(r.max);
            pinned += r.min;
            if (r.min > 0 || r.max < real + 3) narrowed++;
            checked++;
          }
          expect(pinned + h.unknown).toBe(cardsOf(s, q, ck ? CARDS : RESOURCES).length);
        }
      }
      expect(changed).toBeGreaterThan(states.length / 3);
      expect(narrowed).toBeGreaterThan(checked / 4);
    });
  }
});
