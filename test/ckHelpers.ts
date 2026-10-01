import { expect } from 'vitest';
import {
  COMMODITIES,
  EVENT_DIE,
  PIECES_PER_PLAYER,
  PROGRESS_CARDS,
  PROGRESS_CARD_NAMES,
  RESOURCES,
  buildingsOf,
  isLandHex,
  nextInt,
  publicVP,
  rollDie,
  totalVP,
  viewFor,
  type Action,
  type Commodity,
  type EventFace,
  type GameState,
  type KnightLevel,
  type PlayerId,
  type ProgressCardName,
  type VertexId,
} from '../src/index.js';
import { H, act, blank } from './helpers.js';

/** Cities & Knights test helpers (shared by the C&K test files). */

export const CK = { citiesAndKnights: true } as const;

/** A C&K game after the set-up: player 0's turn 1, rolled, empty board and hands (the base random board, centred on 0,0). */
export function ckGame(players = 3, seed = 'ck'): GameState {
  return blank('base', players, CK, seed);
}

/** Every land hex barren and numberless, no harbors, the robber parked in a corner. */
export function bare(players = 3): GameState {
  const s = ckGame(players);
  for (const h of Object.values(s.board.hexes)) {
    if (h.terrain !== 'sea') {
      h.terrain = 'desert';
      h.token = null;
    }
  }
  s.board.harbors = [];
  s.board.robber = H(2, -2);
  return s;
}

export function giveC(s: GameState, p: PlayerId, c: Partial<Record<Commodity, number>>): void {
  for (const [k, n] of Object.entries(c) as Array<[Commodity, number]>) {
    s.ck!.bank[k] -= n;
    s.ck!.players[p].commodities[k] += n;
  }
}

/** Sets the RNG so the next roll is `yellow`, `red` and the event die `event`. */
export function withRoll(s: GameState, yellow: number, red: number, event: EventFace): GameState {
  for (let seed = 1; seed < 5_000_000; seed++) {
    const r = { s: seed };
    if (rollDie(r) === yellow && rollDie(r) === red && EVENT_DIE[nextInt(r, EVENT_DIE.length)] === event) {
      s.rng = { s: seed };
      return s;
    }
  }
  throw new Error('no seed found');
}

/** Sets the RNG so the next event die (alone, as after the Alchemist) shows `event`. */
export function withEvent(s: GameState, event: EventFace): GameState {
  for (let seed = 1; seed < 1_000_000; seed++) {
    if (EVENT_DIE[nextInt({ s: seed }, EVENT_DIE.length)] === event) {
      s.rng = { s: seed };
      return s;
    }
  }
  throw new Error('no seed found');
}

/** Player `p` rolls the given dice (from a pre-roll phase). */
export function roll(s: GameState, yellow: number, red: number, event: EventFace = 'politics', p: PlayerId = 0): GameState {
  s.phase = { kind: 'preRoll' };
  s.turn.actor = p;
  s.turn.current = p;
  return act(withRoll(s, yellow, red, event), { type: 'rollDice', player: p });
}

export function knight(s: GameState, v: VertexId, p: PlayerId, level: KnightLevel = 1, active = false): void {
  s.ck!.knights[v] = { owner: p, level, active, activatedPart: -1, promotedPart: -1 };
}

/** Moves on to a later turn of player `p` (main phase), as if the others had played. */
export function laterTurn(s: GameState, p: PlayerId = 0): GameState {
  s.turn.number += 3;
  s.turn.part += 3;
  s.turn.current = p;
  s.turn.actor = p;
  s.phase = { kind: 'main' };
  return s;
}

/** Puts `card` on top of a deck. */
export function stack(s: GameState, card: ProgressCardName): void {
  const deck = s.ck!.decks[PROGRESS_CARDS[card].deck];
  deck.splice(deck.indexOf(card), 1);
  deck.push(card);
}

/** Gives player `p` progress cards, taking them out of their decks (so every card still exists once). */
export function hand(s: GameState, p: PlayerId, ...cards: ProgressCardName[]): void {
  for (const card of cards) {
    const deck = s.ck!.decks[PROGRESS_CARDS[card].deck];
    const i = deck.indexOf(card);
    if (i < 0) throw new Error(`no ${card} left in its deck`);
    deck.splice(i, 1);
    s.ck!.players[p].progress.push(card);
  }
}

export function has(acts: Action[], a: Partial<Action>): boolean {
  return acts.some((x) => Object.entries(a).every(([k, v]) => JSON.stringify((x as Record<string, unknown>)[k]) === JSON.stringify(v)));
}

/** VP counted from the pieces and cards, independently of the engine's VP functions. */
export function countedVP(s: GameState, p: PlayerId): number {
  const ck = s.ck!;
  const { settlements, cities } = buildingsOf(s, p);
  let vp = settlements.length + 2 * cities.length;
  if (s.longestRoute.holder === p) vp += 2;
  for (const t of ['trade', 'politics', 'science'] as const) if (ck.metropolises[t]?.owner === p) vp += 2;
  vp += ck.players[p].defenders + ck.players[p].vpCards.length;
  if (ck.merchant?.owner === p) vp += 1;
  return vp;
}

/**
 * Rules that must hold after every action of a Cities & Knights game.
 * `view`: also check what the seats see (slower: it copies the state).
 */
export function checkInvariants(s: GameState, view = false): void {
  const ck = s.ck!;
  // cards: the bank and the hands always hold every card, none negative
  for (const r of RESOURCES) {
    expect(s.bank[r] + s.players.reduce((n, p) => n + p.resources[r], 0), r).toBe(19);
    expect(s.bank[r]).toBeGreaterThanOrEqual(0);
    for (const pl of s.players) expect(pl.resources[r]).toBeGreaterThanOrEqual(0);
  }
  for (const k of COMMODITIES) {
    expect(ck.bank[k] + ck.players.reduce((n, p) => n + p.commodities[k], 0), k).toBe(12);
    expect(ck.bank[k]).toBeGreaterThanOrEqual(0);
    for (const pl of ck.players) expect(pl.commodities[k]).toBeGreaterThanOrEqual(0);
  }
  // progress cards: each one exists once, in its own deck or a hand (VP cards face up)
  const cards = [...ck.decks.trade, ...ck.decks.politics, ...ck.decks.science, ...ck.players.flatMap((p) => [...p.progress, ...p.vpCards])];
  for (const name of PROGRESS_CARD_NAMES) expect(cards.filter((c) => c === name).length, name).toBe(PROGRESS_CARDS[name].count);
  for (const t of ['trade', 'politics', 'science'] as const) {
    for (const c of ck.decks[t]) expect(PROGRESS_CARDS[c].deck, `${c} in the ${t} deck`).toBe(t);
    const held = ck.players.flatMap((p) => [...p.progress, ...p.vpCards]).filter((c) => PROGRESS_CARDS[c].deck === t).length;
    expect(ck.decks[t].length + held).toBe(18);
  }
  for (const pl of ck.players) {
    for (const c of pl.vpCards) expect(PROGRESS_CARDS[c].vp).toBe(true);
    for (const c of pl.progress) expect(PROGRESS_CARDS[c].vp).toBeUndefined();
  }
  expect(ck.defenderCards + ck.players.reduce((n, p) => n + p.defenders, 0)).toBe(6);
  for (const pl of s.players) {
    const mine = Object.values(ck.knights).filter((k) => k.owner === pl.id);
    for (const level of [1, 2, 3]) expect(mine.filter((k) => k.level === level).length).toBeLessThanOrEqual(2);
    const walls = ck.players[pl.id].walls;
    expect(walls.length).toBeLessThanOrEqual(3);
    expect(new Set(walls).size).toBe(walls.length);
    for (const v of walls) expect(s.board.buildings[v]).toMatchObject({ owner: pl.id, type: 'city' });
    const buildings = Object.entries(s.board.buildings).filter(([, b]) => b.owner === pl.id);
    const tipped = buildings.filter(([v]) => ck.tipped.includes(v)).length;
    expect(pl.supply.settlements + buildings.filter(([, b]) => b.type === 'settlement').length - tipped).toBe(PIECES_PER_PLAYER.settlements);
    expect(pl.supply.cities + buildings.filter(([, b]) => b.type === 'city').length + tipped).toBe(PIECES_PER_PLAYER.cities);
    const roads = Object.values(s.board.pieces).filter((x) => x.owner === pl.id && x.type === 'road').length;
    expect(pl.supply.roads + roads).toBe(PIECES_PER_PLAYER.roads);
    expect(ck.players[pl.id].progress.length).toBeLessThanOrEqual(s.turn.actor === pl.id || s.phase.kind === 'ck' ? 54 : 4);
    // VP: every point is public in Cities & Knights
    expect(totalVP(s, pl.id), `VP of ${pl.id}`).toBe(countedVP(s, pl.id));
    expect(publicVP(s, pl.id)).toBe(totalVP(s, pl.id));
  }
  if (view) {
    for (const viewer of [null, ...s.players.map((p) => p.id)]) {
      const v = viewFor(s, viewer);
      for (const pl of v.players) expect(pl.publicVP).toBe(totalVP(s, pl.id));
      // hidden hands: only the seat's own progress cards and commodities
      for (const [i, pl] of v.ck!.players.entries()) {
        const own = viewer === i || s.phase.kind === 'gameOver';
        expect(pl.progress === undefined, `progress of ${i} seen by ${viewer}`).toBe(!own);
        expect(pl.commodities === undefined).toBe(!own);
      }
    }
  }
  for (const v of Object.keys(ck.knights)) expect(s.board.buildings[v]).toBeUndefined();
  for (const t of ['trade', 'politics', 'science'] as const) {
    const m = ck.metropolises[t];
    if (m) {
      expect(s.board.buildings[m.vertex]).toMatchObject({ owner: m.owner, type: 'city' });
      expect(ck.players[m.owner].improvements[t]).toBeGreaterThanOrEqual(4);
    }
  }
  if (ck.merchant) expect(isLandHex(s, ck.merchant.hex)).toBe(true);
  for (const e of ck.turnEffects) expect(e.player).toBe(s.turn.actor);
  expect(ck.barbarians).toBeLessThan(7);
}
