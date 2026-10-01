import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, viewFor, type Action, type GameState } from '../src/index.js';
import { askFor } from '../web/src/game/ask.js';
import { barbarianState, drawRange, drawersFor, eventText, spotLabel, unlocks } from '../web/src/game/ck.js';
import { mustAct } from '../web/src/game/seats.js';
import { bankCheck, countsPhrase, rowSides } from '../web/src/game/trade.js';
import { fxFor } from '../web/src/game/fx.js';
import { ckAfterSetup, ckMain, cityOf, giveCards, knightSpots, loadDice, makeCity, placeKnight, setLevels } from '../e2e/ckState.js';

/** Sam's turn after the roll, on the beginners' map, with `hand`. */
function main(hand: Parameters<typeof ckMain>[1] = {}): GameState {
  return ckMain(ckAfterSetup('ck-web'), hand);
}

const find = <T extends Action['type']>(s: GameState, type: T, p = 0) =>
  legalActions(s, p).filter((a): a is Extract<Action, { type: T }> => a.type === type);

describe('Cities & Knights in the browser: asking before building', () => {
  it('a knight: its cost, that it starts inactive, and the hand left', () => {
    const s = main({ wool: 1, ore: 1 });
    const a = find(s, 'buildKnight')[0];
    const ask = askFor([a], viewFor(s, 0), 0)!;
    expect(ask.title).toBe('Hire a basic knight here?');
    expect(ask.choices[0].art).toBe('knight-1');
    expect(ask.cost).toEqual({ wool: 1, ore: 1 });
    expect(ask.notes[0]).toMatch(/starts inactive/);
  });

  it('activating and promoting a knight', () => {
    const s = main({ grain: 1, wool: 1, ore: 1 });
    placeKnight(s, 0, knightSpots(s, 0)[0], 1, false);
    const act = askFor([find(s, 'activateKnight')[0]], viewFor(s, 0), 0)!;
    expect(act.title).toBe('Activate this basic knight?');
    expect(act.cost).toEqual({ grain: 1 });
    expect(act.choices[0].art).toBe('knight-1-on');
    const pro = askFor([find(s, 'promoteKnight')[0]], viewFor(s, 0), 0)!;
    expect(pro.title).toBe('Promote it to a strong knight?');
    expect(pro.notes).toContain('Strength 1 → 2');
  });

  it('a city wall raises the hand limit', () => {
    const s = main({ brick: 2 });
    const ask = askFor([find(s, 'buildCityWall')[0]], viewFor(s, 0), 0)!;
    expect(ask.title).toBe('Build a city wall here?');
    expect(ask.cost).toEqual({ brick: 2 });
    expect(ask.notes[0]).toBe('Your hand limit on a 7 goes from 7 to 9 cards');
  });

  it('a city improvement: paid in commodities, with the cards it draws and the ability at level 3', () => {
    const s = main({ cloth: 3 });
    setLevels(s, 0, { trade: 2 });
    const ask = askFor([find(s, 'improveCity')[0]], viewFor(s, 0), 0)!;
    expect(ask.title).toBe('Build the Merchant Guild?');
    expect(ask.cost).toEqual({ cloth: 3 });
    expect(ask.left).toEqual([{ r: 'cloth', n: 0 }]);
    expect(ask.notes).toContain('Yellow gate: you draw a trade card on a red 1–4');
    expect(ask.notes).toContain('Merchant Guild: Trade any commodity with the bank 2:1.');
  });

  it('a metropolis asks which city, one choice per city, at one price', () => {
    const s = main({ coin: 4 });
    setLevels(s, 0, { politics: 3 });
    makeCity(s, 0);
    const acts = find(s, 'improveCity');
    expect(acts).toHaveLength(2);
    const ask = askFor(acts, viewFor(s, 0), 0)!;
    expect(ask.title).toBe('Build the Cathedral and a metropolis: on which city?');
    expect(ask.cost).toEqual({ coin: 4 });
    expect(ask.choices.map((c) => c.art)).toEqual(['metro-politics', 'metro-politics']);
    expect(ask.choices[0].label).toMatch(/^\d+( · \d+)*$/);
    expect(ask.notes).toContain('The politics metropolis is yours: +2 VP');
  });

  it('the second starting piece is a city', () => {
    let s = ckAfterSetup('ck-web');
    // back to a fresh game, played up to the city round
    const fresh = viewFor(s, 0);
    expect(fresh.ck).toBeDefined();
    s = structuredClone(s);
    s.phase = { kind: 'setup', round: 1, index: 0, step: 'settlement', vertex: null };
    const a: Action = { type: 'placeSettlement', player: 0, vertex: knightSpots(s, 0)[0] };
    const ask = askFor([a], viewFor(s, 0), 0)!;
    expect(ask.title).toBe('Place your city here?');
    expect(ask.choices[0].art).toBe('city');
  });
});

describe('Cities & Knights in the browser: the event die and the barbarians', () => {
  it('the red results each level draws on (level L: red up to L + 1)', () => {
    expect([0, 1, 2, 3, 4, 5].map(drawRange)).toEqual(['–', '1–2', '1–3', '1–4', '1–5', '1–6']);
  });

  it('a city gate names who draws, in turn order', () => {
    const s = main();
    setLevels(s, 1, { science: 2 });
    setLevels(s, 2, { science: 1 });
    const v = viewFor(s, 0);
    expect(drawersFor(v, 'science', 3)).toEqual([1]);
    expect(drawersFor(v, 'science', 2)).toEqual([1, 2]);
    expect(eventText(v, 'science', 3, 0)).toEqual({ title: 'Green gate: science cards for level 2+', sub: 'Red 3: Ada draws a science card' });
    expect(eventText(v, 'trade', 1, 0).sub).toBe('Red 1: nobody draws');
  });

  it('the ship: how far it has to go, and when it attacks', () => {
    const s = main();
    s.ck!.barbarians = 3;
    expect(eventText(viewFor(s, 0), 'ship', 4, 0)).toEqual({ title: 'Barbarians advance', sub: 'The ship is 4 spaces from Catan' });
    s.ck!.barbarians = 0;
    s.ck!.attacks = 1;
    expect(eventText(viewFor(s, 0), 'ship', 4, 0).title).toBe('The barbarians attack!');
  });

  it('both sides of the coming fight', () => {
    const s = main();
    placeKnight(s, 0, knightSpots(s, 0)[0], 2, true);
    placeKnight(s, 1, knightSpots(s, 1)[0], 1, false);
    const b = barbarianState(viewFor(s, 2))!;
    expect(b.barbarians).toBe(3);
    expect(b.knights).toBe(2);
    expect(b.perPlayer).toEqual([2, 0, 0]);
    expect(b.active).toEqual([1, 0, 0]);
    expect(b.total).toEqual([1, 1, 0]);
    expect(spotLabel(viewFor(s, 0), cityOf(s, 0))).toMatch(/^\d+( · \d+)*$/);
  });

  it('the attack as a moment: the strength of both sides and who pays', () => {
    const s = ckAfterSetup('ck-web');
    s.ck!.barbarians = 6;
    makeCity(s, 0);
    loadDice(s, { event: 'ship', sum: 9 });
    const before = viewFor(s, 0);
    const r = applyAction(s, { type: 'rollDice', player: 0 });
    if (!r.ok) throw new Error(r.error);
    const fx = fxFor({ type: 'rollDice', player: 0 }, before, viewFor(r.state, 0), 0)!;
    expect(fx.kind).toBe('attack');
    if (fx.kind !== 'attack') return;
    expect(fx.barbarians).toBe(4);
    expect(fx.knights).toBe(0);
    expect(fx.won).toBe(false);
    expect(fx.outcome).toBe('The barbarians win: Ada and Björn lose a city; you choose a city to lose');
    // and Sam is the one the game waits for
    expect(mustAct(viewFor(r.state, 0))).toEqual([0]);
  });

  it('cards drawn on a city gate: your own face up, the others face down', () => {
    const s = ckAfterSetup('ck-web');
    setLevels(s, 0, { trade: 2 });
    setLevels(s, 1, { trade: 1 });
    loadDice(s, { event: 'trade', red: 2 });
    const before = viewFor(s, 0);
    const r = applyAction(s, { type: 'rollDice', player: 0 });
    if (!r.ok) throw new Error(r.error);
    const fx = fxFor({ type: 'rollDice', player: 0 }, before, viewFor(r.state, 0), 0)!;
    expect(fx.kind).toBe('draw');
    if (fx.kind !== 'draw') return;
    expect(fx.draws.map((d) => d.p)).toEqual([0, 1]);
    expect(fx.draws[0].card).not.toBeNull();
    // Ada's card stays hidden unless it is a victory point card (played face up)
    const ada = fx.draws[1];
    expect(ada.card === null || ada.card === 'constitution' || ada.card === 'printer').toBe(true);
  });
});

describe('Cities & Knights in the browser: whose move, and trading commodities', () => {
  it('the players a decision waits for', () => {
    const s = main();
    s.phase = { kind: 'ck', step: 'progressDiscard', pending: { 2: 1, 1: 1 }, resume: { kind: 'main' } };
    expect(mustAct(viewFor(s, null))).toEqual([1, 2]);
    s.phase = { kind: 'ck', step: 'defenderDraw', queue: [2, 0], resume: { kind: 'main' } };
    expect(mustAct(viewFor(s, null))).toEqual([2]);
    s.phase = { kind: 'ck', step: 'aqueduct', pending: { 1: 1 }, resume: { kind: 'main' } };
    expect(mustAct(viewFor(s, null))).toEqual([1]);
  });

  it('a trade row with commodities, at their own rates', () => {
    expect(rowSides({ paper: -2, brick: 1 })).toEqual({ give: { paper: 2 }, get: { brick: 1 } });
    expect(countsPhrase({ cloth: 1, coin: 2 })).toBe('1 cloth and 2 coin');
    // Merchant Guild: commodities 2:1, the resources at 4:1
    const rates = { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4, paper: 2, cloth: 2, coin: 2 };
    expect(bankCheck({ paper: -2, ore: 1 }, rates)).toEqual({ lots: 1, cards: 1, ok: true });
    expect(bankCheck({ paper: -1, ore: 1 }, rates).ok).toBe(false);
  });

  it('the guest sees their own commodities and only counts for the others', () => {
    const s = main();
    giveCards(s, 1, { paper: 2 });
    giveCards(s, 2, { coin: 3 });
    const v = viewFor(s, 1);
    expect(v.ck!.players[1].commodities).toEqual({ paper: 2, cloth: 0, coin: 0 });
    expect(v.ck!.players[2].commodities).toBeUndefined();
    expect(v.ck!.players[2].commodityCount).toBe(3);
    expect(v.ck!.players[2].progress).toBeUndefined();
  });

  it('the level-3 abilities and metropolis lines of the flip chart', () => {
    const s = main();
    setLevels(s, 1, { science: 4 });
    s.ck!.metropolises.science = { owner: 1, vertex: cityOf(s, 1) };
    const v = viewFor(s, 0);
    expect(unlocks(v, 0, 'science', 3)).toContain('Aqueduct: A roll that gives you nothing (not a 7): take a resource of your choice.');
    expect(unlocks(v, 0, 'science', 4)).toContain('Ada holds the metropolis: level 5 takes it');
    expect(unlocks(v, 0, 'science', 5)).toContain('You take the science metropolis from Ada: +2 VP');
  });
});
