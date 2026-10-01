import { describe, expect, it } from 'vitest';
import {
  PROGRESS_CARDS,
  cardRates,
  heuristicAction,
  knightCanAct,
  legalActions,
  longestRouteLength,
  playersToAct,
  publicVP,
  topo,
  viewFor,
  type Action,
  type GameState,
  type PlayerId,
  type ProgressCardName,
  type VertexId,
} from '../src/index.js';
import { bare, giveC, hand, has, knight, laterTurn, roll, withEvent } from './ckHelpers.js';
import { C, H, act, fail, give, put, road, setHex, trail } from './helpers.js';

/**
 * Cities & Knights, part 2: every progress card (5th-edition Almanac,
 * pp. 14-18; docs/cities-and-knights.md section 10).
 */

function plays(s: GameState, p: PlayerId, card: ProgressCardName): Array<Extract<Action, { type: 'playProgress' }>> {
  return legalActions(s, p).filter((a): a is Extract<Action, { type: 'playProgress' }> => a.type === 'playProgress' && a.card === card);
}

function choices(s: GameState, p: PlayerId): Array<Record<string, unknown> | undefined> {
  return legalActions(s, p)
    .filter((a): a is Extract<Action, { type: 'progressChoice' }> => a.type === 'progressChoice')
    .map((a) => a.args);
}

function play(s: GameState, card: ProgressCardName, args?: Record<string, unknown>, p: PlayerId = 0): GameState {
  return act(s, { type: 'playProgress', player: p, card, ...(args ? { args } : {}) });
}

function answer(s: GameState, p: PlayerId, args?: Record<string, unknown>): GameState {
  return act(s, { type: 'progressChoice', player: p, ...(args ? { args } : {}) });
}

function cardStep(s: GameState) {
  expect(s.phase).toMatchObject({ kind: 'ck', step: 'card' });
  return s.phase as Extract<GameState['phase'], { kind: 'ck'; step: 'card' }>;
}

/** The intersection next to `v` that is neither `a` nor `b`. */
function outward(s: GameState, v: VertexId, a: VertexId, b: VertexId): VertexId {
  return topo(s).vertexNeighbors[v].find((w) => w !== a && w !== b)!;
}

const sorted = <T>(xs: T[]) => [...xs].sort();

// ---------------------------------------------------------------------------

describe('Progress cards: timing and bookkeeping', () => {
  it('every card but the VP cards has an effect; they are played after the roll on your own turn only', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0);
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1)]), 0);
    hand(s, 0, 'roadBuilding');
    hand(s, 1, 'roadBuilding');
    expect(plays(s, 0, 'roadBuilding')).toHaveLength(1);
    // never on another player's turn, before the roll or during another decision (p. 6, 9; FAQ 95, 99)
    fail(s, { type: 'playProgress', player: 1, card: 'roadBuilding' }, /not your turn/);
    expect(plays(s, 1, 'roadBuilding')).toHaveLength(0);
    s.phase = { kind: 'preRoll' };
    fail(s, { type: 'playProgress', player: 0, card: 'roadBuilding' }, /roll the dice first/);
    expect(plays(s, 0, 'roadBuilding')).toHaveLength(0);
    s.phase = { kind: 'discard', pending: { 1: 1 }, resume: { kind: 'main' } };
    fail(s, { type: 'playProgress', player: 0, card: 'roadBuilding' }, /not allowed right now/);
    s.phase = { kind: 'main' };
    fail(s, { type: 'playProgress', player: 0, card: 'roadBuilding', args: [] as unknown as Record<string, unknown> }, /invalid/);
    // played: public, and face down under its deck (p. 6)
    s = play(s, 'roadBuilding');
    expect(s.ck!.players[0].progress).toEqual([]);
    expect(s.ck!.decks.science[0]).toBe('roadBuilding');
    expect(s.ck!.played).toEqual([{ player: 0, card: 'roadBuilding', turn: 1 }]);
    for (const viewer of [0, 1, 2, null]) {
      const v = viewFor(s, viewer);
      expect(v.ck!.played).toEqual([{ player: 0, card: 'roadBuilding', turn: 1 }]);
      expect(v.log.some((l) => /plays Road Building/.test(l.msg))).toBe(true);
    }
    // the other player's card stays hidden
    expect(viewFor(s, 0).ck!.players[1].progress).toBeUndefined();
    expect(viewFor(s, 0).ck!.players[1].progressCount).toBe(1);
    const cards = Object.keys(PROGRESS_CARDS) as ProgressCardName[];
    expect(cards.filter((c) => !PROGRESS_CARDS[c].vp)).toHaveLength(23);
  });

  it('a card may be played the turn it is drawn; a Spy that takes a fifth card must discard by the end of the turn', () => {
    let s = bare();
    s.ck!.players[0].improvements.trade = 1;
    s.ck!.decks.trade.push(...s.ck!.decks.trade.splice(s.ck!.decks.trade.indexOf('resourceMonopoly'), 1));
    s = roll(s, 1, 1, 'trade'); // draws the Resource Monopoly on its own roll
    expect(s.ck!.players[0].progress).toEqual(['resourceMonopoly']);
    s = play(s, 'resourceMonopoly', { resource: 'ore' });
    expect(s.ck!.players[0].progress).toEqual([]);
    // a Spy and four more cards: five again after the theft
    hand(s, 0, 'spy', 'bishop', 'wedding', 'warlord', 'deserter');
    hand(s, 1, 'saboteur');
    s = play(s, 'spy', { target: 1 });
    s = answer(s, 0, { card: 'saboteur' });
    expect(s.ck!.players[0].progress).toHaveLength(5);
    fail(s, { type: 'endTurn', player: 0 }, /discard progress cards/);
    s = act(s, { type: 'discardProgress', player: 0, card: 'deserter' });
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.turn.current).toBe(1);
  });

  it('a card known to do nothing is not offered, and playing it is refused (FAQ 98)', () => {
    const s = bare();
    hand(s, 0, 'mining', 'irrigation', 'warlord', 'smith', 'deserter', 'intrigue', 'spy', 'wedding', 'saboteur', 'masterMerchant', 'bishop', 'engineer', 'medicine', 'crane', 'roadBuilding', 'diplomat', 'commercialHarbor', 'merchant');
    expect(legalActions(s, 0).filter((a) => a.type === 'playProgress')).toEqual([]);
    const errors: Record<string, RegExp> = {
      mining: /no building next to mountains/,
      irrigation: /no building next to fields/,
      warlord: /no knights/,
      smith: /choose a knight/,
      deserter: /choose an opponent/,
      intrigue: /choose an opponent's knight/,
      spy: /choose an opponent/,
      wedding: /nobody with more victory points/,
      saboteur: /nobody with at least your victory points/,
      masterMerchant: /more victory points than you/,
      bishop: /until the barbarians first attack/,
      engineer: /cities without a city wall/,
      medicine: /settlements to upgrade/,
      crane: /cannot build a city improvement/,
      roadBuilding: /nowhere to build a road/,
      diplomat: /choose a road/,
      commercialHarbor: /no opponent has a commodity/,
      merchant: /choose a hex/,
    };
    for (const [card, re] of Object.entries(errors)) fail(s, { type: 'playProgress', player: 0, card: card as ProgressCardName }, re);
  });
});

// ---------------------------------------------------------------------------
// Science
// ---------------------------------------------------------------------------

describe('Progress cards: science', () => {
  it('Alchemist: before rolling, set both production dice; the event die is rolled and resolved first', () => {
    let s = bare();
    setHex(s, 0, 0, 'hills', 8);
    put(s, C(0, 0, 0), 0, 'city');
    s.ck!.players[1].improvements.science = 2; // draws on a red die up to 3
    s.ck!.decks.science = s.ck!.decks.science.filter((c) => c !== 'printer');
    hand(s, 0, 'alchemist');
    s.phase = { kind: 'preRoll' };
    const acts = legalActions(s, 0);
    expect(plays(s, 0, 'alchemist')).toHaveLength(36);
    expect(has(acts, { type: 'rollDice' })).toBe(true);
    fail(s, { type: 'playProgress', player: 0, card: 'alchemist', args: { dice: [0, 7] } }, /1-6/);
    fail(s, { type: 'playProgress', player: 0, card: 'alchemist', args: { dice: [3] } }, /both production dice/);
    s = play(withEvent(s, 'science'), 'alchemist', { dice: [5, 3] });
    expect(s.turn.dice).toEqual([5, 3]);
    expect(s.rolls!.at(-1)).toMatchObject({ by: 0, dice: [5, 3], event: 'science', chosen: true });
    expect(s.ck!.players[1].progress).toHaveLength(1); // the event: red 3 draws for level 2
    expect(s.players[0].resources.brick).toBe(2); // then production of the 8
    expect(s.ck!.decks.science[0]).toBe('alchemist');
    expect(s.phase.kind).toBe('main');
    fail(s, { type: 'rollDice', player: 0 }, /cannot roll/);
    expect(s.stats!.players[0].expected36).toBeGreaterThan(0);
  });

  it('Alchemist: only before your own roll; a 7 may be chosen; the barbarians attack before production', () => {
    const s = bare();
    hand(s, 0, 'alchemist');
    hand(s, 1, 'alchemist');
    fail(s, { type: 'playProgress', player: 0, card: 'alchemist', args: { dice: [1, 1] } }, /before rolling/);
    expect(plays(s, 0, 'alchemist')).toHaveLength(0);
    s.phase = { kind: 'preRoll' };
    fail(s, { type: 'playProgress', player: 1, card: 'alchemist', args: { dice: [1, 1] } }, /not your turn/);
    // a 7: the hands over the limit discard
    const seven = structuredClone(s);
    give(seven, 1, { brick: 9 });
    const after7 = play(withEvent(seven, 'trade'), 'alchemist', { dice: [3, 4] });
    expect(after7.phase).toMatchObject({ kind: 'discard', pending: { 1: 4 } });
    // the barbarians land first: a city is pillaged before it produces (p. 5)
    const t = structuredClone(s);
    setHex(t, 0, 0, 'hills', 5);
    put(t, C(0, 0, 0), 0, 'city');
    put(t, C(0, 0, 3), 0, 'city');
    t.ck!.barbarians = 6;
    let u = play(withEvent(t, 'ship'), 'alchemist', { dice: [2, 3] });
    expect(u.ck!.attacks).toBe(1);
    expect(u.phase).toMatchObject({ kind: 'ck', step: 'pillage' });
    expect(u.players[0].resources.brick).toBe(0);
    u = act(u, { type: 'pillageCity', player: 0, vertex: C(0, 0, 0) });
    expect(u.players[0].resources.brick).toBe(3);
  });

  it('Crane: one improvement this turn costs one commodity less (level 1 free), never two Cranes on one', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    hand(s, 0, 'crane', 'crane');
    giveC(s, 0, { cloth: 1 });
    expect(plays(s, 0, 'crane')).toHaveLength(1);
    s = play(s, 'crane');
    expect(s.ck!.turnEffects).toEqual([{ player: 0, effect: 'crane' }]);
    expect(plays(s, 0, 'crane')).toHaveLength(0); // not two on one improvement
    fail(s, { type: 'playProgress', player: 0, card: 'crane' }, /already/);
    s = act(s, { type: 'improveCity', player: 0, track: 'politics' }); // level 1 for nothing
    expect(s.ck!.players[0].improvements.politics).toBe(1);
    expect(s.ck!.turnEffects).toEqual([]);
    fail(s, { type: 'improveCity', player: 0, track: 'politics' }, /not enough coin/); // the next one costs full price
    s = play(s, 'crane');
    s = act(s, { type: 'improveCity', player: 0, track: 'trade' });
    expect(s.ck!.players[0].commodities.cloth).toBe(1); // still free (level 1)
    // a Crane lasts for the turn only
    let t = bare();
    put(t, C(0, 0, 0), 0, 'city');
    hand(t, 0, 'crane');
    t = act(play(t, 'crane'), { type: 'endTurn', player: 0 });
    expect(t.ck!.turnEffects).toEqual([]);
    // no city, or every track at level 5: nothing to lower
    const u = bare();
    hand(u, 0, 'crane');
    expect(plays(u, 0, 'crane')).toHaveLength(0);
    put(u, C(0, 0, 0), 0, 'city');
    u.ck!.players[0].improvements = { trade: 5, politics: 5, science: 5 };
    expect(plays(u, 0, 'crane')).toHaveLength(0);
    u.ck!.players[0].improvements.science = 2;
    expect(plays(u, 0, 'crane')).toHaveLength(1);
  });

  it('Engineer: a free city wall under a city without one, at most three', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    put(s, C(0, 0, 3), 0, 'city');
    put(s, C(-2, 0, 0), 0);
    s.ck!.players[0].walls = [C(0, 0, 3)];
    hand(s, 0, 'engineer');
    expect(plays(s, 0, 'engineer').map((a) => a.args)).toEqual([{ vertex: C(0, 0, 0) }]);
    fail(s, { type: 'playProgress', player: 0, card: 'engineer', args: { vertex: C(-2, 0, 0) } }, /cities without a city wall/);
    s = play(s, 'engineer', { vertex: C(0, 0, 0) });
    expect(sorted(s.ck!.players[0].walls)).toEqual(sorted([C(0, 0, 0), C(0, 0, 3)]));
    expect(s.players[0].resources.brick).toBe(0);
    const t = bare();
    for (const v of [C(0, 0, 0), C(0, 0, 3), C(-2, 0, 0), C(2, -1, 3)]) put(t, v, 0, 'city');
    t.ck!.players[0].walls = [C(0, 0, 0), C(0, 0, 3), C(-2, 0, 0)];
    hand(t, 0, 'engineer');
    expect(plays(t, 0, 'engineer')).toHaveLength(0);
    fail(t, { type: 'playProgress', player: 0, card: 'engineer', args: { vertex: C(2, -1, 3) } }, /at most 3/);
  });

  it('Inventor: swap two number tokens, never a 2, 12, 6 or 8; the robber stays on its hex', () => {
    let s = bare();
    setHex(s, 0, 0, 'forest', 3);
    setHex(s, 1, 0, 'hills', 5);
    setHex(s, 0, 1, 'fields', 9);
    setHex(s, 1, -1, 'mountains', 11);
    setHex(s, -1, 0, 'pasture', 6);
    setHex(s, -1, 1, 'pasture', 2);
    setHex(s, 0, -1, 'pasture', 8);
    setHex(s, 2, -1, 'pasture', 12);
    s.board.robber = H(0, 0);
    hand(s, 0, 'inventor');
    // no building needed next to them; 4 tokens can move, so 6 pairs
    const options = plays(s, 0, 'inventor').map((a) => a.args!.hexes as string[]);
    expect(options).toHaveLength(6);
    for (const pair of options) for (const h of pair) expect([3, 5, 9, 11]).toContain(s.board.hexes[h].token);
    for (const fixed of [H(-1, 0), H(-1, 1), H(0, -1), H(2, -1)]) {
      fail(s, { type: 'playProgress', player: 0, card: 'inventor', args: { hexes: [H(0, 0), fixed] } }, /2, 12, 6 and 8/);
    }
    fail(s, { type: 'playProgress', player: 0, card: 'inventor', args: { hexes: [H(0, 0), H(-2, 2)] } }, /number token/);
    fail(s, { type: 'playProgress', player: 0, card: 'inventor', args: { hexes: [H(0, 0)] } }, /two hexes/);
    s = play(s, 'inventor', { hexes: [H(0, 1), H(0, 0)] });
    expect(s.board.hexes[H(0, 0)]).toMatchObject({ terrain: 'forest', token: 9 });
    expect(s.board.hexes[H(0, 1)]).toMatchObject({ terrain: 'fields', token: 3 });
    expect(s.board.robber).toBe(H(0, 0)); // FAQ 107: the robber now blocks the 9
    // two equal numbers would change nothing
    const t = bare();
    setHex(t, 0, 0, 'forest', 4);
    setHex(t, 1, 0, 'hills', 4);
    hand(t, 0, 'inventor');
    expect(plays(t, 0, 'inventor')).toHaveLength(0);
    fail(t, { type: 'playProgress', player: 0, card: 'inventor', args: { hexes: [H(0, 0), H(1, 0)] } }, /different numbers/);
  });

  it('Irrigation: 2 grain per fields hex next to your buildings, not more for cities (the Almanac example)', () => {
    let s = bare();
    setHex(s, 0, 0, 'fields', 8);
    setHex(s, -2, 2, 'fields', 4);
    put(s, C(0, 0, 0), 0, 'city'); // two cities on the same fields
    put(s, C(0, 0, 3), 0, 'city');
    put(s, C(-2, 2, 0), 0); // a settlement on another
    put(s, C(0, 0, 1), 1); // another player's building changes nothing
    s.board.robber = H(0, 0); // the robber does not stop it
    hand(s, 0, 'irrigation');
    s = play(s, 'irrigation');
    expect(s.players[0].resources.grain).toBe(4);
    expect(s.players[1].resources.grain).toBe(0);
    // with too few in the bank, what is left (2025)
    const t = bare();
    setHex(t, 0, 0, 'fields', 8);
    put(t, C(0, 0, 0), 0);
    give(t, 1, { grain: 18 });
    hand(t, 0, 'irrigation');
    expect(play(t, 'irrigation').players[0].resources.grain).toBe(1);
    give(t, 1, { grain: 1 });
    expect(plays(t, 0, 'irrigation')).toHaveLength(0);
    fail(t, { type: 'playProgress', player: 0, card: 'irrigation' }, /bank has no grain/);
  });

  it('Mining: 2 ore per mountains hex next to your buildings (the Almanac example)', () => {
    let s = bare();
    setHex(s, 0, 0, 'mountains', 8);
    setHex(s, -2, 2, 'mountains', 4);
    setHex(s, 1, 0, 'fields', 4);
    put(s, C(0, 0, 0), 0); // two settlements on one mountains hex
    put(s, C(0, 0, 3), 0);
    put(s, C(-2, 2, 0), 0, 'city'); // a city on another
    hand(s, 0, 'mining');
    s = play(s, 'mining');
    expect(s.players[0].resources.ore).toBe(4);
    expect(s.players[0].resources.grain).toBe(0);
  });

  it('Medicine: a settlement becomes a city for 2 ore and 1 grain', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0);
    put(s, C(0, 0, 3), 1);
    hand(s, 0, 'medicine', 'medicine');
    give(s, 0, { ore: 2 });
    expect(plays(s, 0, 'medicine')).toHaveLength(0);
    fail(s, { type: 'playProgress', player: 0, card: 'medicine', args: { vertex: C(0, 0, 0) } }, /2 ore and 1 grain/);
    give(s, 0, { grain: 1 });
    expect(plays(s, 0, 'medicine').map((a) => a.args)).toEqual([{ vertex: C(0, 0, 0) }]);
    fail(s, { type: 'playProgress', player: 0, card: 'medicine', args: { vertex: C(0, 0, 3) } }, /your settlements/);
    s = play(s, 'medicine', { vertex: C(0, 0, 0) });
    expect(s.board.buildings[C(0, 0, 0)]).toEqual({ owner: 0, type: 'city' });
    expect(s.players[0].resources).toMatchObject({ ore: 0, grain: 0 });
    expect(s.players[0].supply).toMatchObject({ settlements: 5, cities: 3 });
    expect(publicVP(s, 0)).toBe(2);
    expect(plays(s, 0, 'medicine')).toHaveLength(0); // one card per city; nothing left to upgrade
    // a city pillaged onto its side is rebuilt first, with its own piece
    const t = bare();
    for (const v of [C(-2, 0, 0), C(-2, 2, 0), C(2, -1, 3), C(0, -2, 4), C(1, 1, 5)]) put(t, v, 0);
    t.ck!.tipped = [C(1, 1, 5)];
    t.players[0].supply.cities = 3;
    give(t, 0, { ore: 2, grain: 1 });
    hand(t, 0, 'medicine');
    expect(plays(t, 0, 'medicine').map((a) => a.args)).toEqual([{ vertex: C(1, 1, 5) }]);
    const u = play(t, 'medicine', { vertex: C(1, 1, 5) });
    expect(u.ck!.tipped).toEqual([]);
    expect(u.players[0].supply).toMatchObject({ settlements: 0, cities: 3 });
  });

  it('Road Building: two roads for free, following the building rules', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0);
    hand(s, 0, 'roadBuilding');
    s = play(s, 'roadBuilding');
    expect(s.phase).toMatchObject({ kind: 'roadBuilding', remaining: 2 });
    expect(legalActions(s, 0).every((a) => a.type === 'buildRoad' || a.type === 'endRoadBuilding')).toBe(true);
    const [e1, e2] = trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2)]);
    fail(s, { type: 'buildRoad', player: 0, edge: e2 }, /connect/);
    s = act(s, { type: 'buildRoad', player: 0, edge: e1 });
    s = act(s, { type: 'buildRoad', player: 0, edge: e2 });
    expect(s.phase.kind).toBe('main');
    expect(s.players[0].supply.roads).toBe(13);
    expect(s.players[0].resources).toMatchObject({ brick: 0, lumber: 0 });
    // the player may stop after one
    let t = bare();
    put(t, C(0, 0, 0), 0);
    hand(t, 0, 'roadBuilding');
    t = act(act(play(t, 'roadBuilding'), { type: 'buildRoad', player: 0, edge: e1 }), { type: 'endRoadBuilding', player: 0 });
    expect(t.phase.kind).toBe('main');
    // no road left in the supply: nothing to build
    const u = bare();
    put(u, C(0, 0, 0), 0);
    u.players[0].supply.roads = 0;
    hand(u, 0, 'roadBuilding');
    expect(plays(u, 0, 'roadBuilding')).toHaveLength(0);
  });

  it('Smith: up to two knights one level each for free, status kept, normal promotion rules', () => {
    let s = bare();
    knight(s, C(0, 0, 1), 0, 1, true);
    knight(s, C(0, 0, 2), 0, 2, false);
    knight(s, C(0, 0, 3), 0, 3, true);
    knight(s, C(-2, 0, 0), 1, 1, false);
    hand(s, 0, 'smith', 'smith');
    // strong to mighty only with the Fortress; mighty knights no further; only your own
    expect(plays(s, 0, 'smith').map((a) => a.args)).toEqual([{ vertex: C(0, 0, 1) }]);
    fail(s, { type: 'playProgress', player: 0, card: 'smith', args: { vertex: C(0, 0, 2) } }, /Fortress/);
    s.ck!.players[0].improvements.politics = 3;
    expect(sorted(plays(s, 0, 'smith').map((a) => a.args!.vertex as string))).toEqual(sorted([C(0, 0, 1), C(0, 0, 2)]));
    s = play(s, 'smith', { vertex: C(0, 0, 2) });
    expect(s.ck!.knights[C(0, 0, 2)]).toMatchObject({ level: 3, active: false });
    expect(cardStep(s)).toMatchObject({ card: 'smith', player: 0, stage: 'promote' });
    expect(playersToAct(s)).toEqual([0]);
    expect(choices(s, 0)).toEqual([{ vertex: C(0, 0, 1) }, undefined]);
    fail(s, { type: 'progressChoice', player: 0, args: { vertex: C(0, 0, 2) } }, /mighty knights cannot be promoted/);
    fail(s, { type: 'progressChoice', player: 1, args: { vertex: C(-2, 0, 0) } }, /not yours/);
    s = answer(s, 0, { vertex: C(0, 0, 1) });
    expect(s.ck!.knights[C(0, 0, 1)]).toMatchObject({ level: 2, active: true });
    expect(s.phase.kind).toBe('main');
    expect(s.players[0].resources).toMatchObject({ wool: 0, ore: 0 });
    // the second Smith finds no knight it may promote again this turn
    expect(plays(s, 0, 'smith')).toHaveLength(0);
    fail(s, { type: 'playProgress', player: 0, card: 'smith', args: { vertex: C(0, 0, 1) } }, /once per turn/);
    // stopping after one
    let t = bare();
    knight(t, C(0, 0, 1), 0, 1);
    knight(t, C(0, 0, 2), 0, 1);
    hand(t, 0, 'smith');
    t = play(t, 'smith', { vertex: C(0, 0, 1) });
    t = answer(t, 0);
    expect(t.phase.kind).toBe('main');
    expect(t.ck!.knights[C(0, 0, 2)].level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Politics
// ---------------------------------------------------------------------------

describe('Progress cards: politics', () => {
  it('Bishop: only once the robber is active; robs one card from every player next to its new hex', () => {
    let s = bare();
    put(s, C(0, 0, 0), 1);
    put(s, C(0, 0, 3), 1, 'city'); // two buildings: still one card
    put(s, C(0, 0, 1), 2);
    put(s, C(0, 0, 5), 0); // the Bishop's own building
    give(s, 1, { brick: 3 });
    giveC(s, 2, { coin: 1 });
    give(s, 0, { ore: 1 });
    hand(s, 0, 'bishop');
    // the robber is inactive until the barbarians first attack (p. 5; 2025: on the card)
    expect(plays(s, 0, 'bishop')).toHaveLength(0);
    fail(s, { type: 'playProgress', player: 0, card: 'bishop' }, /until the barbarians first attack/);
    s.ck!.attacks = 1;
    s = play(s, 'bishop');
    expect(s.phase).toMatchObject({ kind: 'robber', reason: 'bishop', piece: 'robber' });
    const moves = legalActions(s, 0);
    expect(moves.every((a) => a.type === 'moveRobber' && a.victim === undefined && a.piece === 'robber')).toBe(true);
    expect(has(moves, { type: 'moveRobber', hex: H(-2, 0) })).toBe(true); // a hex nobody is next to (FAQ 75)
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(0, 0), victim: 1 }, /every player/);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(0, 0) });
    expect(s.board.robber).toBe(H(0, 0));
    expect(s.players[1].resources.brick).toBe(2);
    expect(s.ck!.players[2].commodities.coin).toBe(0);
    expect(s.players[0].resources).toMatchObject({ brick: 1, ore: 1 });
    expect(s.ck!.players[0].commodities.coin).toBe(1);
    expect(s.phase.kind).toBe('main');
    // what was taken is told to the two players only
    expect(viewFor(s, 0).log.filter((l) => /stolen card is/.test(l.msg))).toHaveLength(2);
    expect(viewFor(s, 1).log.filter((l) => /stolen card is/.test(l.msg))).toHaveLength(1);
  });

  it('Deserter: the opponent removes a knight of their choice; you may place one of equal strength with its status', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0);
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2)]), 0);
    knight(s, C(-2, 0, 0), 1, 2, true);
    knight(s, C(-2, 2, 0), 1, 1, false);
    knight(s, C(2, -1, 3), 2, 1, false);
    hand(s, 0, 'deserter');
    expect(sorted(plays(s, 0, 'deserter').map((a) => a.args!.target))).toEqual([1, 2]);
    fail(s, { type: 'playProgress', player: 0, card: 'deserter', args: { target: 0 } }, /opponent/);
    s = play(s, 'deserter', { target: 1 });
    expect(cardStep(s)).toMatchObject({ card: 'deserter', player: 0, stage: 'desert', target: 1, pending: { 1: 1 } });
    expect(playersToAct(s)).toEqual([1]);
    expect(legalActions(s, 0)).toEqual([]);
    expect(sorted(choices(s, 1).map((c) => c!.vertex as string))).toEqual(sorted([C(-2, 0, 0), C(-2, 2, 0)]));
    fail(s, { type: 'progressChoice', player: 1, args: { vertex: C(2, -1, 3) } }, /your knights/);
    s = answer(s, 1, { vertex: C(-2, 0, 0) }); // the active strong knight
    expect(s.ck!.knights[C(-2, 0, 0)]).toBeUndefined();
    expect(cardStep(s)).toMatchObject({ stage: 'place', player: 0, target: 1, data: { level: 2, active: true } });
    expect(playersToAct(s)).toEqual([0]);
    const spots = choices(s, 0);
    expect(spots.at(-1)).toBeUndefined(); // or place none
    expect(sorted(spots.slice(0, -1).map((c) => c!.vertex as string))).toEqual(sorted([C(0, 0, 1), C(0, 0, 2)]));
    fail(s, { type: 'progressChoice', player: 0, args: { vertex: C(0, 0, 0) } }, /occupied/);
    s = answer(s, 0, { vertex: C(0, 0, 2) });
    expect(s.ck!.knights[C(0, 0, 2)]).toEqual({ owner: 0, level: 2, active: true, activatedPart: -1, promotedPart: -1 });
    expect(knightCanAct(s, s.ck!.knights[C(0, 0, 2)])).toBe(true); // FAQ 83
    expect(s.phase.kind).toBe('main');
  });

  it('Deserter: a basic knight when none of that strength is left, a mighty one without the Fortress; the knight goes even if none can be placed', () => {
    const base = bare();
    put(base, C(0, 0, 0), 0);
    road(base, trail(base, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2)]), 0);
    knight(base, C(-2, 0, 0), 1, 3, false); // the only knight: removed at once
    hand(base, 0, 'deserter');
    let s = play(structuredClone(base), 'deserter', { target: 1 });
    expect(s.ck!.knights[C(-2, 0, 0)]).toBeUndefined();
    expect(cardStep(s)).toMatchObject({ stage: 'place', data: { level: 3, active: false } }); // no Fortress needed
    s = answer(s, 0, { vertex: C(0, 0, 1) });
    expect(s.ck!.knights[C(0, 0, 1)]).toMatchObject({ owner: 0, level: 3, active: false });
    // both mighty knights out: a basic one instead
    const t = structuredClone(base);
    knight(t, C(2, -1, 3), 0, 3);
    knight(t, C(1, 1, 5), 0, 3);
    const u = play(t, 'deserter', { target: 1 });
    expect(cardStep(u)).toMatchObject({ stage: 'place', data: { level: 1 } });
    expect(answer(u, 0).phase.kind).toBe('main'); // declined
    // no basic knight either: the opponent's knight still goes (p. 16, FAQ 82)
    const v = structuredClone(t);
    knight(v, C(0, -2, 4), 0, 1);
    knight(v, C(-1, -1, 1), 0, 1);
    const w = play(v, 'deserter', { target: 1 });
    expect(w.ck!.knights[C(-2, 0, 0)]).toBeUndefined();
    expect(w.phase.kind).toBe('main');
    expect(w.log.some((l) => /no knight of that strength or basic knight left/.test(l.msg))).toBe(true);
    // nowhere to place one: the same
    const y = structuredClone(base);
    y.board.pieces = {};
    y.players[0].supply.roads = 15;
    const z = play(y, 'deserter', { target: 1 });
    expect(z.phase.kind).toBe('main');
    expect(z.log.some((l) => /nowhere to place a knight/.test(l.msg))).toBe(true);
    // no opposing knights at all: not playable
    const x = bare();
    knight(x, C(0, 0, 1), 0, 1);
    hand(x, 0, 'deserter');
    expect(plays(x, 0, 'deserter')).toHaveLength(0);
    fail(x, { type: 'playProgress', player: 0, card: 'deserter', args: { target: 1 } }, /has no knights/);
  });

  it('Diplomat: removes an open road; your own may go back elsewhere at once, for free', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0);
    const [r01, r12] = trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2)]);
    road(s, [r01, r12], 0);
    put(s, C(-2, 0, 0), 1);
    const [r1] = trail(s, [C(-2, 0, 0), topo(s).vertexNeighbors[C(-2, 0, 0)][0]]);
    road(s, r1, 1);
    hand(s, 0, 'diplomat', 'diplomat');
    // open: nothing of its colour at one end (p. 16)
    expect(sorted(plays(s, 0, 'diplomat').map((a) => a.args!.edge as string))).toEqual(sorted([r12, r1]));
    fail(s, { type: 'playProgress', player: 0, card: 'diplomat', args: { edge: r01 } }, /not open/);
    // an opponent's road goes back to their supply
    const t = play(structuredClone(s), 'diplomat', { edge: r1 });
    expect(t.board.pieces[r1]).toBeUndefined();
    expect(t.players[1].supply.roads).toBe(15);
    expect(t.phase.kind).toBe('main');
    // your own: placed again elsewhere (stage 'rebuild'), never on the same spot
    s = play(s, 'diplomat', { edge: r12 });
    expect(s.board.pieces[r12]).toBeUndefined();
    expect(cardStep(s)).toMatchObject({ card: 'diplomat', stage: 'rebuild', data: { edge: r12, kind: 'road' } });
    const spots = choices(s, 0);
    expect(spots).toContainEqual(undefined);
    expect(spots).not.toContainEqual({ edge: r12 });
    const [r05] = trail(s, [C(0, 0, 0), C(0, 0, 5)]);
    expect(spots).toContainEqual({ edge: r05 });
    fail(s, { type: 'progressChoice', player: 0, args: { edge: r12 } }, /cannot build a road there/);
    s = answer(s, 0, { edge: r05 });
    expect(s.board.pieces[r05]).toMatchObject({ owner: 0, type: 'road' });
    expect(s.players[0].supply.roads).toBe(13);
    expect(s.phase.kind).toBe('main');
    expect(s.players[0].resources).toMatchObject({ brick: 0, lumber: 0 });
  });

  it('Diplomat: a road with a knight, settlement or road of its colour at both ends is not open; an opponent at the end does not close it', () => {
    const s = bare();
    put(s, C(0, 0, 0), 0);
    const [r01, r12, r23] = trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2), C(0, 0, 3)]);
    road(s, [r01, r12, r23], 0);
    knight(s, C(0, 0, 3), 0, 1); // its own knight closes the end
    hand(s, 0, 'diplomat');
    expect(plays(s, 0, 'diplomat')).toHaveLength(0);
    // an opponent's knight at the end does not close it
    delete s.ck!.knights[C(0, 0, 3)];
    knight(s, C(0, 0, 3), 1, 1);
    expect(plays(s, 0, 'diplomat').map((a) => a.args!.edge)).toEqual([r23]);
    // nor does an opponent's piece in the middle of the road (FAQ 89)
    delete s.ck!.knights[C(0, 0, 3)];
    put(s, C(0, 0, 3), 0);
    knight(s, C(0, 0, 1), 1, 1);
    expect(plays(s, 0, 'diplomat')).toHaveLength(0);
    // never a road whose removal leaves a knight of its colour without a road (FAQ 90)
    const t = bare();
    const [lone] = trail(t, [C(0, 0, 4), C(0, 0, 5)]);
    road(t, lone, 1);
    knight(t, C(0, 0, 4), 1, 1);
    hand(t, 0, 'diplomat');
    expect(plays(t, 0, 'diplomat')).toHaveLength(0);
    fail(t, { type: 'playProgress', player: 0, card: 'diplomat', args: { edge: lone } }, /cut off a knight/);
  });

  it('Diplomat: moving one of your Longest Road keeps it if the road is as long again (FAQ 88)', () => {
    const s = bare();
    put(s, C(0, 0, 0), 0);
    const ring = [0, 1, 2, 3, 4, 5].map((i) => C(0, 0, i));
    road(s, trail(s, ring), 0); // 5 roads, C5 open
    road(s, trail(s, [0, 1, 2, 3, 4, 5].map((i) => C(-2, 0, i))), 1); // 5 roads too
    s.longestRoute = { holder: 0, lengths: [5, 5, 0] };
    hand(s, 0, 'diplomat');
    const [open] = trail(s, [C(0, 0, 4), C(0, 0, 5)]);
    const [closing] = trail(s, [C(0, 0, 5), C(0, 0, 0)]);
    let t = play(structuredClone(s), 'diplomat', { edge: open });
    expect(t.longestRoute.holder).toBe(0); // not settled while the road is in hand
    t = answer(t, 0, { edge: closing });
    expect(longestRouteLength(t, 0)).toBe(5);
    expect(t.longestRoute.holder).toBe(0);
    let u = play(structuredClone(s), 'diplomat', { edge: open });
    u = answer(u, 0); // kept in the supply
    expect(u.longestRoute.holder).toBe(1);
  });

  it("Intrigue: displaces an opponent's knight on your road without a knight of your own; it retreats or leaves", () => {
    let s = bare();
    put(s, C(0, 0, 0), 0);
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1)]), 0);
    knight(s, C(0, 0, 1), 1, 3, true); // even a mighty knight
    knight(s, C(0, 0, 3), 1, 1, false); // not on a road of player 0
    knight(s, C(-2, 0, 0), 0, 1, true);
    const away = outward(s, C(0, 0, 1), C(0, 0, 0), C(0, 0, 2));
    road(s, trail(s, [C(0, 0, 1), away]), 1);
    hand(s, 0, 'intrigue', 'intrigue');
    expect(plays(s, 0, 'intrigue').map((a) => a.args)).toEqual([{ vertex: C(0, 0, 1) }]);
    fail(s, { type: 'playProgress', player: 0, card: 'intrigue', args: { vertex: C(0, 0, 3) } }, /touching your road/);
    fail(s, { type: 'playProgress', player: 0, card: 'intrigue', args: { vertex: C(-2, 0, 0) } }, /opponent/);
    s = play(s, 'intrigue', { vertex: C(0, 0, 1) });
    expect(s.ck!.knights[C(0, 0, 1)]).toBeUndefined();
    expect(s.phase).toMatchObject({ kind: 'ck', step: 'retreat', player: 1, from: C(0, 0, 1) });
    expect(playersToAct(s)).toEqual([1]);
    expect(legalActions(s, 1)).toEqual([{ type: 'retreatKnight', player: 1, to: away }]);
    s = act(s, { type: 'retreatKnight', player: 1, to: away });
    expect(s.ck!.knights[away]).toMatchObject({ owner: 1, level: 3, active: true });
    expect(s.ck!.knights[C(0, 0, 1)]).toBeUndefined(); // no free knight for the Intrigue's player
    expect(s.phase.kind).toBe('main');
    // with nowhere to go, it leaves the board
    let t = bare();
    put(t, C(0, 0, 0), 0);
    road(t, trail(t, [C(0, 0, 0), C(0, 0, 1)]), 0);
    knight(t, C(0, 0, 1), 1, 2, true);
    hand(t, 0, 'intrigue');
    t = play(t, 'intrigue', { vertex: C(0, 0, 1) });
    expect(t.ck!.knights).toEqual({});
    expect(t.phase.kind).toBe('main');
    // the vacated intersection can then be built on normally (paid)
    give(t, 0, { wool: 1, ore: 1 });
    t = act(t, { type: 'buildKnight', player: 0, vertex: C(0, 0, 1) });
    expect(t.players[0].resources).toMatchObject({ wool: 0, ore: 0 });
  });

  it('Saboteur: everyone with at least your VP discards half their cards, of their choice', () => {
    let s = bare(4);
    put(s, C(0, 0, 0), 0); // 1 VP
    put(s, C(-2, 0, 0), 1, 'city'); // 2 VP
    put(s, C(2, -1, 3), 2); // 1 VP: as many as the Saboteur
    give(s, 1, { brick: 3, ore: 2, wool: 2 });
    giveC(s, 1, { paper: 2 }); // 9 cards: 4 to discard
    give(s, 2, { wool: 3 }); // one kind: discarded at once
    give(s, 3, { ore: 4 }); // 0 VP: not affected
    give(s, 0, { grain: 6 });
    hand(s, 0, 'saboteur');
    s = play(s, 'saboteur');
    expect(s.players[2].resources.wool).toBe(2);
    expect(s.players[3].resources.ore).toBe(4);
    expect(s.players[0].resources.grain).toBe(6);
    expect(cardStep(s)).toMatchObject({ card: 'saboteur', stage: 'discard', pending: { 1: 4 } });
    expect(playersToAct(s)).toEqual([1]);
    const opts = choices(s, 1);
    expect(opts.length).toBeGreaterThan(10);
    expect(opts.every((o) => Object.values(o!.cards as object).reduce((a: number, b) => a + (b as number), 0) === 4)).toBe(true);
    fail(s, { type: 'progressChoice', player: 1, args: { cards: { brick: 3 } } }, /exactly 4/);
    fail(s, { type: 'progressChoice', player: 1, args: { cards: { grain: 4 } } }, /not in the hand/);
    s = answer(s, 1, { cards: { paper: 2, brick: 2 } });
    expect(s.ck!.players[1].commodities.paper).toBe(0);
    expect(s.ck!.bank.paper).toBe(12);
    expect(s.players[1].resources).toMatchObject({ brick: 1, ore: 2, wool: 2 });
    expect(s.phase.kind).toBe('main');
    expect(s.stats!.players[1].discarded).toBe(4);
    // nobody to sabotage
    const t = bare();
    put(t, C(0, 0, 0), 0);
    give(t, 1, { brick: 4 });
    hand(t, 0, 'saboteur');
    expect(plays(t, 0, 'saboteur')).toHaveLength(0);
  });

  it('Saboteur: several players answer in parallel', () => {
    let s = bare();
    give(s, 1, { brick: 2, ore: 2 });
    give(s, 2, { wool: 1, grain: 1 });
    hand(s, 0, 'saboteur');
    s = play(s, 'saboteur');
    expect(cardStep(s).pending).toEqual({ 1: 2, 2: 1 });
    expect(playersToAct(s)).toEqual([1, 2]);
    s = answer(s, 2, { cards: { grain: 1 } });
    expect(playersToAct(s)).toEqual([1]);
    s = answer(s, 1, { cards: { brick: 1, ore: 1 } });
    expect(s.phase.kind).toBe('main');
  });

  it("Spy: look at another player's progress cards (you only) and take one, never a VP card", () => {
    let s = bare();
    hand(s, 1, 'bishop', 'spy');
    s.ck!.players[1].vpCards = ['constitution'];
    s.ck!.decks.politics = s.ck!.decks.politics.filter((c) => c !== 'constitution');
    hand(s, 0, 'spy');
    expect(plays(s, 0, 'spy').map((a) => a.args)).toEqual([{ target: 1 }]); // player 2 has none
    s = play(s, 'spy', { target: 1 });
    expect(cardStep(s)).toMatchObject({ card: 'spy', player: 0, stage: 'take', target: 1, data: { cards: ['bishop', 'spy'] } });
    expect(viewFor(s, 0).phase).toMatchObject({ data: { cards: ['bishop', 'spy'] } });
    for (const viewer of [1, 2, null]) {
      expect((viewFor(s, viewer).phase as { data?: unknown }).data).toBeUndefined();
      if (viewer !== 1) expect(JSON.stringify(viewFor(s, viewer))).not.toMatch(/"bishop"/);
    }
    expect(choices(s, 0)).toEqual([{ card: 'bishop' }, { card: 'spy' }, undefined]);
    fail(s, { type: 'progressChoice', player: 0, args: { card: 'constitution' } }, /does not have/);
    s = answer(s, 0, { card: 'spy' });
    expect(s.ck!.players[0].progress).toEqual(['spy']);
    expect(s.ck!.players[1].progress).toEqual(['bishop']);
    expect(s.ck!.players[1].vpCards).toEqual(['constitution']);
    expect(viewFor(s, 2).log.some((l) => /took Spy/.test(l.msg))).toBe(false);
    expect(viewFor(s, 1).log.some((l) => /took Spy/.test(l.msg))).toBe(true);
    // a stolen Spy may be played at once
    s = play(s, 'spy', { target: 1 });
    s = answer(s, 0); // takes nothing
    expect(s.ck!.players[1].progress).toEqual(['bishop']);
    expect(s.phase.kind).toBe('main');
  });

  it('Warlord: activates every knight for free; they cannot act this turn', () => {
    let s = bare();
    knight(s, C(0, 0, 1), 0, 1, false);
    knight(s, C(0, 0, 3), 0, 2, false);
    knight(s, C(-2, 0, 0), 0, 1, true);
    knight(s, C(2, -1, 3), 1, 1, false);
    hand(s, 0, 'warlord');
    s = play(s, 'warlord');
    for (const v of [C(0, 0, 1), C(0, 0, 3)]) {
      expect(s.ck!.knights[v].active).toBe(true);
      expect(knightCanAct(s, s.ck!.knights[v])).toBe(false);
    }
    expect(knightCanAct(s, s.ck!.knights[C(-2, 0, 0)])).toBe(true);
    expect(s.ck!.knights[C(2, -1, 3)].active).toBe(false);
    expect(s.players[0].resources.grain).toBe(0);
    s = laterTurn(s);
    expect(knightCanAct(s, s.ck!.knights[C(0, 0, 1)])).toBe(true);
    const t = bare();
    knight(t, C(0, 0, 1), 0, 1, true);
    hand(t, 0, 'warlord');
    expect(plays(t, 0, 'warlord')).toHaveLength(0);
    fail(t, { type: 'playProgress', player: 0, card: 'warlord' }, /already active|all your knights/);
  });

  it('Wedding: everyone with more VP gives you 2 cards of their choice (1 if that is all they have)', () => {
    let s = bare(4);
    put(s, C(0, 0, 0), 0); // 1 VP
    put(s, C(-2, 0, 0), 1, 'city'); // 2 VP
    put(s, C(2, -1, 3), 2, 'city'); // 2 VP, one card
    put(s, C(1, 1, 5), 3); // 1 VP: as many, not affected
    give(s, 1, { brick: 2, ore: 1 });
    giveC(s, 1, { coin: 1 });
    give(s, 2, { wool: 1 });
    give(s, 3, { grain: 3 });
    hand(s, 0, 'wedding');
    s = play(s, 'wedding');
    expect(s.players[0].resources.wool).toBe(1); // player 2's only card, given at once
    expect(cardStep(s)).toMatchObject({ card: 'wedding', stage: 'give', pending: { 1: 2 } });
    expect(playersToAct(s)).toEqual([1]);
    s = answer(s, 1, { cards: { brick: 1, coin: 1 } });
    expect(s.players[0].resources).toMatchObject({ brick: 1, wool: 1 });
    expect(s.ck!.players[0].commodities.coin).toBe(1);
    expect(s.players[3].resources.grain).toBe(3);
    expect(s.phase.kind).toBe('main');
    // the cards are told to the two players only
    expect(viewFor(s, 3).log.some((l) => /1 brick/.test(l.msg))).toBe(false);
    expect(viewFor(s, 1).log.some((l) => /1 brick/.test(l.msg))).toBe(true);
    // a richer player with no cards gives nothing; nobody richer: not playable
    const t = bare();
    put(t, C(-2, 0, 0), 1, 'city');
    hand(t, 0, 'wedding');
    expect(plays(t, 0, 'wedding')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

describe('Progress cards: trade', () => {
  it('Commercial Harbor: offer each opponent once a resource for a commodity of their choice, during the turn', () => {
    let s = bare();
    give(s, 0, { brick: 1, wool: 2 });
    giveC(s, 1, { paper: 1, cloth: 1 });
    giveC(s, 2, { coin: 2 }); // one kind: answered at once
    hand(s, 0, 'commercialHarbor');
    s = play(s, 'commercialHarbor');
    expect(s.ck!.turnEffects).toEqual([{ player: 0, effect: 'commercialHarbor', data: { offered: [] } }]);
    const offers = legalActions(s, 0).filter((a) => a.type === 'progressChoice');
    expect(offers.map((a) => (a as { args: unknown }).args)).toEqual([
      { card: 'commercialHarbor', to: 1, resource: 'brick' },
      { card: 'commercialHarbor', to: 1, resource: 'wool' },
      { card: 'commercialHarbor', to: 2, resource: 'brick' },
      { card: 'commercialHarbor', to: 2, resource: 'wool' },
    ]);
    fail(s, { type: 'progressChoice', player: 0, args: { card: 'commercialHarbor', to: 1, resource: 'ore' } }, /no ore/);
    fail(s, { type: 'progressChoice', player: 1, args: { card: 'commercialHarbor', to: 0, resource: 'ore' } }, /not your turn/);
    s = act(s, { type: 'progressChoice', player: 0, args: { card: 'commercialHarbor', to: 1, resource: 'wool' } });
    expect(cardStep(s)).toMatchObject({ card: 'commercialHarbor', player: 0, stage: 'exchange', target: 1, pending: { 1: 1 } });
    expect(viewFor(s, 0).phase).toMatchObject({ data: { resource: 'wool' } });
    expect((viewFor(s, 1).phase as { data?: unknown }).data).toBeUndefined(); // handed over face down
    expect(playersToAct(s)).toEqual([1]);
    expect(choices(s, 1)).toEqual([{ commodity: 'paper' }, { commodity: 'cloth' }]);
    fail(s, { type: 'progressChoice', player: 1, args: { commodity: 'coin' } }, /no coin/);
    s = answer(s, 1, { commodity: 'cloth' });
    expect(s.players[0].resources.wool).toBe(1);
    expect(s.players[1].resources.wool).toBe(1);
    expect(s.ck!.players[0].commodities.cloth).toBe(1);
    expect(s.ck!.players[1].commodities.cloth).toBe(0);
    expect(s.phase.kind).toBe('main');
    fail(s, { type: 'progressChoice', player: 0, args: { card: 'commercialHarbor', to: 1, resource: 'brick' } }, /already/);
    s = act(s, { type: 'progressChoice', player: 0, args: { card: 'commercialHarbor', to: 2, resource: 'brick' } });
    expect(s.ck!.players[0].commodities.coin).toBe(1);
    expect(s.players[2].resources.brick).toBe(1);
    expect(s.phase.kind).toBe('main');
    expect(legalActions(s, 0).some((a) => a.type === 'progressChoice')).toBe(false);
    expect(s.stats!.players[2].trades).toBe(1);
    // over at the end of the turn
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.ck!.turnEffects).toEqual([]);
    // nobody holds a commodity: not playable
    const t = bare();
    give(t, 0, { brick: 1 });
    hand(t, 0, 'commercialHarbor');
    expect(plays(t, 0, 'commercialHarbor')).toHaveLength(0);
  });

  it('Master Merchant: look at the hand of a player with more VP (you only) and take 2 cards', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0);
    put(s, C(-2, 0, 0), 1, 'city');
    put(s, C(2, -1, 3), 2); // as many VP: not a target
    give(s, 1, { ore: 2, wool: 1 });
    giveC(s, 1, { paper: 1 });
    give(s, 2, { brick: 3 });
    hand(s, 0, 'masterMerchant');
    expect(plays(s, 0, 'masterMerchant').map((a) => a.args)).toEqual([{ target: 1 }]);
    fail(s, { type: 'playProgress', player: 0, card: 'masterMerchant', args: { target: 2 } }, /more victory points/);
    s = play(s, 'masterMerchant', { target: 1 });
    expect(cardStep(s)).toMatchObject({ stage: 'take', target: 1 });
    expect(viewFor(s, 0).phase).toMatchObject({ data: { hand: { ore: 2, wool: 1, paper: 1, brick: 0 } } });
    expect((viewFor(s, 2).phase as { data?: unknown }).data).toBeUndefined();
    expect((viewFor(s, 1).phase as { data?: unknown }).data).toBeUndefined();
    expect(choices(s, 0)).toHaveLength(4); // 2 ore, ore + wool, ore + paper, wool + paper
    fail(s, { type: 'progressChoice', player: 0, args: { cards: { ore: 3 } } }, /exactly 2/);
    s = answer(s, 0, { cards: { ore: 1, paper: 1 } });
    expect(s.players[0].resources.ore).toBe(1);
    expect(s.ck!.players[0].commodities.paper).toBe(1);
    expect(s.players[1].resources).toMatchObject({ ore: 1, wool: 1 });
    expect(s.stats!.players[0].stole).toBe(2);
    // a single card: taken at once
    const t = bare();
    put(t, C(-2, 0, 0), 1);
    give(t, 1, { grain: 1 });
    hand(t, 0, 'masterMerchant');
    const u = play(t, 'masterMerchant', { target: 1 });
    expect(u.players[0].resources.grain).toBe(1);
    expect(u.phase.kind).toBe('main');
  });

  it('Merchant: on a land hex next to your building; 2:1 for its resource and 1 VP while you hold it', () => {
    let s = bare();
    setHex(s, 0, 0, 'forest', 8);
    put(s, C(0, 0, 0), 0);
    put(s, C(0, 0, 3), 1);
    s.ck!.merchant = { hex: H(0, 0), owner: 1 };
    hand(s, 0, 'merchant', 'merchant');
    const hexes = plays(s, 0, 'merchant').map((a) => a.args!.hex as string);
    expect(sorted(hexes)).toEqual(sorted(topo(s).vertexHexes[C(0, 0, 0)].filter((h) => s.board.hexes[h].terrain !== 'sea')));
    fail(s, { type: 'playProgress', player: 0, card: 'merchant', args: { hex: H(-2, 0) } }, /next to one of your/);
    const vp0 = publicVP(s, 0);
    const vp1 = publicVP(s, 1);
    s = play(s, 'merchant', { hex: H(0, 0) }); // takes it over where it stands
    expect(s.ck!.merchant).toEqual({ hex: H(0, 0), owner: 0 });
    expect(publicVP(s, 0)).toBe(vp0 + 1);
    expect(publicVP(s, 1)).toBe(vp1 - 1);
    expect(cardRates(s, 0).lumber).toBe(2);
    expect(cardRates(s, 0).paper).toBe(4); // resources only
    // not again where it already is yours
    expect(plays(s, 0, 'merchant').map((a) => a.args!.hex)).not.toContain(H(0, 0));
    fail(s, { type: 'playProgress', player: 0, card: 'merchant', args: { hex: H(0, 0) } }, /already yours/);
  });

  it('Merchant Fleet: one resource or commodity 2:1 with the bank for the rest of the turn', () => {
    let s = bare();
    give(s, 0, { ore: 4 });
    giveC(s, 0, { cloth: 2 });
    hand(s, 0, 'merchantFleet', 'merchantFleet');
    expect(plays(s, 0, 'merchantFleet')).toHaveLength(8);
    s = play(s, 'merchantFleet', { resource: 'ore' });
    expect(cardRates(s, 0).ore).toBe(2);
    expect(plays(s, 0, 'merchantFleet').map((a) => a.args)).not.toContainEqual({ resource: 'ore' });
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 2 }, get: { brick: 1 } });
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 2 }, get: { paper: 1 } }); // for a commodity too
    fail(s, { type: 'playProgress', player: 0, card: 'merchantFleet', args: { resource: 'gold' } }, /resource or a commodity/);
    fail(s, { type: 'playProgress', player: 0, card: 'merchantFleet', args: { resource: 'ore' } }, /already trade ore 2:1/);
    s = play(s, 'merchantFleet', { commodity: 'cloth' });
    s = act(s, { type: 'bankTrade', player: 0, give: { cloth: 2 }, get: { grain: 1 } });
    expect(s.players[0].resources).toMatchObject({ ore: 0, brick: 1, grain: 1 });
    s = act(s, { type: 'endTurn', player: 0 });
    expect(cardRates(s, 0).ore).toBe(4);
  });

  it('Resource Monopoly: 2 of a resource from each other player (1 if they have 1); Trade Monopoly: 1 of a commodity', () => {
    let s = bare();
    give(s, 1, { ore: 3 });
    give(s, 2, { ore: 1 });
    giveC(s, 1, { paper: 2 });
    hand(s, 0, 'resourceMonopoly', 'tradeMonopoly');
    expect(plays(s, 0, 'resourceMonopoly')).toHaveLength(5);
    expect(plays(s, 0, 'tradeMonopoly')).toHaveLength(3);
    s = play(s, 'resourceMonopoly', { resource: 'ore' });
    expect(s.players.map((p) => p.resources.ore)).toEqual([3, 1, 0]);
    s = play(s, 'tradeMonopoly', { commodity: 'paper' });
    expect(s.ck!.players.map((p) => p.commodities.paper)).toEqual([1, 1, 0]);
    expect(s.stats!.players[0].stole).toBe(4);
    fail(s, { type: 'playProgress', player: 0, card: 'resourceMonopoly', args: { resource: 'paper' } }, /do not have|name a resource/);
  });
});

// ---------------------------------------------------------------------------

describe('Progress cards: the fallback computer player', () => {
  /** The bot's move for `p`, which must be one of the legal moves. */
  function botMove(s: GameState, p: PlayerId): Action {
    const a = heuristicAction(s, p);
    expect(a, `a move for ${p}`).not.toBeNull();
    expect(legalActions(s, p)).toContainEqual(a);
    return a!;
  }

  /** Lets the bots answer until the card's choices are done. */
  function settle(s: GameState): GameState {
    for (let i = 0; i < 10 && s.phase.kind !== 'main'; i++) {
      const p = playersToAct(s)[0];
      s = act(s, botMove(s, p));
    }
    expect(s.phase.kind).toBe('main');
    return s;
  }

  it('answers every choice a card asks with a legal move', () => {
    const stages = new Set<string>();
    const note = (s: GameState) => {
      const ph = s.phase;
      if (ph.kind === 'ck' && ph.step === 'card') stages.add(`${ph.card}:${ph.stage}`);
      if (ph.kind === 'ck' && ph.step === 'retreat') stages.add('retreat');
      if (ph.kind === 'robber') stages.add(`robber:${ph.reason}`);
      return s;
    };
    // Smith, Deserter (both stages), Diplomat, Spy
    let s = bare();
    put(s, C(0, 0, 0), 0);
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2)]), 0);
    knight(s, C(0, 0, 1), 0, 1);
    knight(s, C(0, 0, 2), 0, 1);
    knight(s, C(-2, 0, 0), 1, 2, true);
    knight(s, C(-2, 2, 0), 1, 1);
    hand(s, 0, 'smith', 'deserter', 'diplomat', 'spy');
    hand(s, 1, 'bishop', 'wedding');
    s = settle(note(play(s, 'smith', { vertex: C(0, 0, 1) })));
    delete s.ck!.knights[C(0, 0, 2)];
    s = note(play(s, 'deserter', { target: 1 }));
    s = note(act(s, botMove(s, 1)));
    s = settle(note(s));
    for (const [v, k] of Object.entries(s.ck!.knights)) if (k.owner === 0) delete s.ck!.knights[v];
    s = settle(note(play(s, 'diplomat', { edge: trail(s, [C(0, 0, 1), C(0, 0, 2)])[0] })));
    s = settle(note(play(s, 'spy', { target: 1 })));
    expect(s.ck!.players[0].progress).toHaveLength(1); // it took one
    // Saboteur, Wedding, Master Merchant, Commercial Harbor (offers and answers), Bishop, Intrigue's retreat
    let t = bare();
    put(t, C(-2, 0, 0), 1, 'city');
    put(t, C(0, 0, 0), 2, 'city');
    give(t, 1, { brick: 3, ore: 2 });
    give(t, 2, { wool: 2, grain: 2 });
    giveC(t, 1, { paper: 1, cloth: 1 });
    give(t, 0, { lumber: 2 });
    road(t, trail(t, [C(0, 0, 0), C(0, 0, 1)]), 0);
    knight(t, C(0, 0, 1), 2, 1);
    road(t, trail(t, [C(0, 0, 1), outward(t, C(0, 0, 1), C(0, 0, 0), C(0, 0, 2))]), 2);
    t.ck!.attacks = 1;
    hand(t, 0, 'saboteur', 'wedding', 'masterMerchant', 'commercialHarbor', 'bishop', 'intrigue');
    for (const card of ['saboteur', 'wedding', 'bishop'] as const) t = settle(note(play(t, card)));
    give(t, 1, { ore: 1, wool: 1, grain: 1 });
    t = settle(note(play(t, 'masterMerchant', { target: 1 })));
    for (const q of [1, 2]) giveC(t, q, { paper: 1, cloth: 1 });
    t = play(t, 'commercialHarbor');
    t = settle(note(act(t, botMove(t, 0)))); // an offer, then the answer
    t = settle(note(play(t, 'intrigue', { vertex: C(0, 0, 1) })));
    expect([...stages].sort()).toEqual(
      [
        'smith:promote',
        'deserter:desert',
        'deserter:place',
        'diplomat:rebuild',
        'spy:take',
        'saboteur:discard',
        'wedding:give',
        'robber:bishop',
        'masterMerchant:take',
        'commercialHarbor:exchange',
        'retreat',
      ].sort(),
    );
  });

  it('plays a card when it plainly helps: the Alchemist on its best number, a harvest, a monopoly', () => {
    const s = bare();
    setHex(s, 0, 0, 'fields', 9);
    setHex(s, 1, 0, 'hills', 9);
    put(s, C(0, 0, 0), 0, 'city');
    hand(s, 0, 'alchemist', 'irrigation');
    s.phase = { kind: 'preRoll' };
    const before = botMove(s, 0);
    expect(before).toMatchObject({ type: 'playProgress', card: 'alchemist' });
    const dice = (before as Extract<Action, { type: 'playProgress' }>).args!.dice as number[];
    expect(dice[0] + dice[1]).toBe(9);
    expect(dice[1]).toBe(3); // the lowest red die for that number
    s.phase = { kind: 'main' };
    expect(botMove(s, 0)).toMatchObject({ type: 'playProgress', card: 'irrigation' });
    const t = bare();
    hand(t, 0, 'resourceMonopoly');
    expect(botMove(t, 0)).toMatchObject({ type: 'playProgress', card: 'resourceMonopoly' });
  });
});

// ---------------------------------------------------------------------------

describe('Progress cards: hidden information', () => {
  it('a choice a card reveals stays with its player, even in a phase waiting further down', () => {
    const s = bare();
    s.phase = {
      kind: 'discard',
      pending: { 1: 1 },
      resume: { kind: 'ck', step: 'card', card: 'spy', player: 0, stage: 'take', target: 1, data: { cards: ['bishop'] }, resume: { kind: 'main' } },
    };
    expect(JSON.stringify(viewFor(s, 0).phase)).toMatch(/bishop/);
    for (const viewer of [1, 2, null]) expect(JSON.stringify(viewFor(s, viewer).phase)).not.toMatch(/bishop/);
  });
});
