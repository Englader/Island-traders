import { describe, expect, it } from 'vitest';
import {
  COMMODITIES,
  PROGRESS_CARDS,
  RESOURCES,
  createGame,
  heuristicAction,
  playersToAct,
  applyAction,
  seedRng,
  nextInt,
  shuffle,
  type BotLevel,
  type Card,
  type GameState,
  type PlayerId,
  type RngState,
} from '../src/index.js';
import { CK } from './ckHelpers.js';

/**
 * Cities & Knights computer players only use what their seat can see: their
 * own hand and progress cards, public counts and events, and what a Spy or
 * Master Merchant shows them. So a decision must not change when the other
 * players' hidden cards are swapped around (each hand keeping its size, its
 * number of commodities and of progress cards, the bank and the decks their
 * counts), the decks are reshuffled and the dice's generator is reseeded.
 *
 * Offers and answers to offers are checked too; only the steps where a card
 * shows the player another hand (the Spy, the Master Merchant) are left out.
 */

const kindsOf = (s: GameState, q: PlayerId, kinds: readonly Card[]): Card[] => {
  const pl = s.players[q];
  const ck = s.ck!.players[q];
  const pile = (k: Card) => ((RESOURCES as readonly string[]).includes(k) ? (pl.resources as Record<string, number>) : (ck.commodities as Record<string, number>))[k];
  return kinds.flatMap((k) => Array<Card>(pile(k)).fill(k));
};

function take(s: GameState, q: PlayerId, k: Card, n: number): void {
  const pile = ((COMMODITIES as readonly string[]).includes(k) ? s.ck!.players[q].commodities : s.players[q].resources) as Record<string, number>;
  pile[k] += n;
}

/** The same position as `p` sees it, with everything hidden from `p` shuffled. */
function scramble(s: GameState, p: PlayerId, rng: RngState): GameState {
  const t = structuredClone(s);
  const others = t.players.map((x) => x.id).filter((q) => q !== p);
  // cards swapped between two opponents: one resource (or commodity) for another
  for (let i = 0; i < 12; i++) {
    const [a, b] = shuffle(rng, [...others]).slice(0, 2);
    if (b === undefined) break;
    for (const kinds of [RESOURCES, COMMODITIES] as const) {
      const ha = kindsOf(t, a, kinds);
      const hb = kindsOf(t, b, kinds);
      if (ha.length === 0 || hb.length === 0) continue;
      const x = ha[nextInt(rng, ha.length)];
      const y = hb[nextInt(rng, hb.length)];
      take(t, a, x, -1);
      take(t, a, y, 1);
      take(t, b, y, -1);
      take(t, b, x, 1);
    }
  }
  // progress cards: each opponent's swapped with a card of the same deck (the decks keep their sizes)
  for (const q of others) {
    const held = t.ck!.players[q].progress;
    for (let i = 0; i < held.length; i++) {
      const deck = t.ck!.decks[PROGRESS_CARDS[held[i]].deck];
      const j = deck.findIndex((c) => !PROGRESS_CARDS[c].vp && c !== held[i]);
      if (j < 0) continue;
      [held[i], deck[j]] = [deck[j], held[i]];
    }
  }
  for (const deck of Object.values(t.ck!.decks)) {
    const order = shuffle(rng, [...deck]);
    deck.splice(0, deck.length, ...order);
  }
  t.rng = { s: nextInt(rng, 1 << 30) + 1 };
  return t;
}

/** Whether `p`'s decision may depend on another hand legitimately: a card shows it one. */
function exempt(s: GameState): boolean {
  const ph = s.phase;
  return ph.kind === 'ck' && ph.step === 'card' && ph.stage === 'take';
}

describe('Cities & Knights computer players use only what their seat can see', () => {
  const cases: Array<{ scenario: string; players: number; layout: 'official' | 'random'; levels: BotLevel[] }> = [
    { scenario: 'base', players: 4, layout: 'random', levels: ['hard', 'medium', 'hard', 'easy'] },
    { scenario: 'base', players: 3, layout: 'official', levels: ['hard', 'hard', 'medium'] },
    { scenario: 'seafarers-1-new-shores', players: 4, layout: 'random', levels: ['hard', 'medium', 'hard', 'medium'] },
  ];
  for (const c of cases) {
    it(`${c.scenario}, ${c.players} players: decisions don't change with the others' hidden cards`, () => {
      let s = createGame({ scenario: c.scenario, players: c.players, seed: `fair-${c.scenario}-${c.players}`, options: { ...CK, firstPlayer: 0, layout: c.layout } });
      const rng = seedRng('scramble');
      let checked = 0;
      for (let step = 0; step < 12000 && s.phase.kind !== 'gameOver'; step++) {
        // (as simulateHeuristic: the first player to act with a move)
        const p = playersToAct(s).find((q) => heuristicAction(s, q, c.levels[q]) !== null)!;
        expect(p).toBeDefined();
        const a = heuristicAction(s, p, c.levels[p]);
        // every few decisions of the players with a strategy of their own
        if (c.levels[p] !== 'easy' && step % 2 === 0 && !exempt(s)) {
          const again = heuristicAction(scramble(s, p, rng), p, c.levels[p]);
          expect(again, `step ${step}, P${p + 1} in phase ${s.phase.kind}`).toEqual(a);
          checked++;
        }
        const r = applyAction(s, a!);
        expect(r.ok).toBe(true);
        s = r.ok ? r.state : s;
      }
      expect(s.phase.kind).toBe('gameOver');
      expect(checked).toBeGreaterThan(150);
    });
  }
});
