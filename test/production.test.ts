import { describe, expect, it } from 'vitest';
import { total, type GameState } from '../src/index.js';
import { C, H, act, blank, fail, give, put, setHex, withDice } from './helpers.js';

/** A board where (0,0)=forest 8, (1,0)=hills 8, (1,-1)=mountains 5, (-1,0)=pasture 6. */
function board(): GameState {
  const s = blank('base', 3);
  for (const h of Object.values(s.board.hexes)) if (h.token !== null) h.token = 12;
  setHex(s, 0, 0, 'forest', 8);
  setHex(s, 1, 0, 'hills', 8);
  setHex(s, 1, -1, 'mountains', 5);
  setHex(s, -1, 0, 'pasture', 6);
  setHex(s, -1, 1, 'fields', 3);
  s.board.robber = H(2, -2);
  s.phase = { kind: 'preRoll' };
  return s;
}

function roll(s: GameState, a: number, b: number): GameState {
  return act(withDice(s, a, b), { type: 'rollDice', player: 0 });
}

describe('production', () => {
  it('settlements take 1, cities 2, for every player regardless of whose turn', () => {
    let s = board();
    put(s, C(0, 0, 0), 0); // forest, hills, mountains
    put(s, C(0, 0, 3), 1, 'city'); // forest, pasture, fields
    s = roll(s, 4, 4);
    expect(s.players[0].resources).toMatchObject({ lumber: 1, brick: 1, ore: 0 });
    expect(s.players[1].resources).toMatchObject({ lumber: 2, wool: 0 });
    expect(s.bank.lumber).toBe(19 - 3);
    expect(s.phase.kind).toBe('main');
  });

  it('the robber blocks its hex', () => {
    let s = board();
    put(s, C(0, 0, 0), 0);
    s.board.robber = H(0, 0);
    s = roll(s, 4, 4);
    expect(s.players[0].resources).toMatchObject({ lumber: 0, brick: 1 });
  });

  it('bank shortage: nobody gets a resource the bank cannot cover for everyone', () => {
    let s = board();
    put(s, C(0, 0, 0), 0);
    put(s, C(0, 0, 3), 1, 'city');
    s.bank.lumber = 2; // demand is 3
    s = roll(s, 4, 4);
    expect(s.players[0].resources.lumber).toBe(0);
    expect(s.players[1].resources.lumber).toBe(0);
    expect(s.bank.lumber).toBe(2);
    // other resources are unaffected
    expect(s.players[0].resources.brick).toBe(1);
  });

  it('bank shortage: a single owed player takes whatever is left', () => {
    let s = board();
    put(s, C(0, 0, 0), 0, 'city');
    s.bank.lumber = 1;
    s = roll(s, 4, 4);
    expect(s.players[0].resources.lumber).toBe(1);
    expect(s.bank.lumber).toBe(0);
  });

  it('gold fields pay free choices (city 2, settlement 1), limited by the bank', () => {
    let s = board();
    setHex(s, 0, 0, 'gold', 8);
    put(s, C(0, 0, 0), 0);
    put(s, C(0, 0, 3), 1, 'city');
    s = roll(s, 4, 4);
    expect(s.phase.kind).toBe('gold');
    if (s.phase.kind === 'gold') expect(s.phase.pending).toEqual({ 0: 1, 1: 2 });
    fail(s, { type: 'rollDice', player: 0 });
    fail(s, { type: 'chooseGold', player: 1, resources: { ore: 1 } }, /exactly 2/);
    s = act(s, { type: 'chooseGold', player: 1, resources: { ore: 1, grain: 1 } });
    s = act(s, { type: 'chooseGold', player: 0, resources: { wool: 1 } });
    expect(s.phase.kind).toBe('main');
    expect(s.players[1].resources).toMatchObject({ ore: 1, grain: 1 });
    expect(s.players[0].resources).toMatchObject({ wool: 1, brick: 1 });
  });

  it('players cannot decline production', () => {
    let s = board();
    put(s, C(0, 0, 0), 1);
    s = roll(s, 4, 4);
    expect(total(s.players[1].resources)).toBe(2);
  });
});

describe('rolling a 7', () => {
  it('players with more than 7 cards discard half (rounded down), others keep theirs', () => {
    let s = board();
    give(s, 0, { ore: 8 });
    give(s, 1, { wool: 7 });
    give(s, 2, { grain: 5, brick: 4 });
    s = roll(s, 3, 4);
    expect(s.phase.kind).toBe('discard');
    if (s.phase.kind === 'discard') expect(s.phase.pending).toEqual({ 0: 4, 2: 4 });
    fail(s, { type: 'discard', player: 1, cards: { wool: 3 } }, /do not need/);
    fail(s, { type: 'discard', player: 2, cards: { grain: 3 } }, /exactly 4/);
    fail(s, { type: 'discard', player: 2, cards: { ore: 4 } }, /do not have/);
    // no trading or robber moves before the discards resolve
    fail(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(0, 0) });
    s = act(s, { type: 'discard', player: 2, cards: { grain: 2, brick: 2 } });
    s = act(s, { type: 'discard', player: 0, cards: { ore: 4 } });
    expect(s.phase.kind).toBe('robber');
    expect(total(s.players[2].resources)).toBe(5); // still discards only once
    expect(s.bank.ore).toBe(19 - 8 + 4);
  });

  it('the robber must move to a different hex and steals one random card from an adjacent opponent', () => {
    let s = board();
    put(s, C(0, 0, 0), 1);
    put(s, C(0, 0, 3), 2);
    give(s, 1, { ore: 3 });
    s.board.robber = H(0, 0);
    s = roll(s, 3, 4);
    expect(s.phase.kind).toBe('robber');
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(0, 0) }, /different hex/);
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(3, 0) }, /land hex/);
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(1, 0) }, /choose a player/);
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(1, 0), victim: 2 }, /cannot be robbed/);
    fail(s, { type: 'moveRobber', player: 0, piece: 'pirate', hex: H(3, 0) }, /no pirate/);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(1, 0), victim: 1 });
    expect(s.board.robber).toBe(H(1, 0));
    expect(s.players[1].resources.ore).toBe(2);
    expect(s.players[0].resources.ore).toBe(1);
    expect(s.phase.kind).toBe('main');
    // the thief and victim see which card; others only see that a card was stolen
    const last = s.log[s.log.length - 1];
    expect(last.visibleTo).toEqual([0, 1]);
  });

  it('robbing the desert is allowed; a victim without cards yields nothing; empty hexes need no victim', () => {
    let s = board();
    setHex(s, 1, 0, 'desert');
    put(s, C(0, 0, 0), 1);
    s = roll(s, 3, 4);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(1, 0), victim: 1 });
    expect(total(s.players[0].resources)).toBe(0);
    let t = roll(board(), 3, 4);
    fail(t, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(-2, 2), victim: 1 }, /nobody/);
    t = act(t, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(-2, 2) });
    expect(t.phase.kind).toBe('main');
  });

  it('you cannot rob yourself; the robber does not block building next to it', () => {
    let s = board();
    put(s, C(0, 0, 0), 0);
    s = roll(s, 3, 4);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(1, 0) });
    expect(s.phase.kind).toBe('main');
    give(s, 0, { ore: 3, grain: 2 });
    s = act(s, { type: 'buildCity', player: 0, vertex: C(0, 0, 0) });
    expect(s.board.buildings[C(0, 0, 0)].type).toBe('city');
  });

  it('friendly robber house rule protects players with 2 or fewer points', () => {
    let s = blank('base', 3, { friendlyRobber: true });
    s.board.robber = H(2, -2);
    put(s, C(0, 0, 0), 1);
    put(s, C(0, 0, 3), 2);
    put(s, C(-2, 2, 1), 2);
    put(s, C(2, 0, 4), 2);
    s.phase = { kind: 'robber', reason: 'seven', resume: { kind: 'main' } };
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(1, 0), victim: 1 }, /friendly/);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(-1, 0), victim: 2 });
    expect(s.board.robber).toBe(H(-1, 0));
  });
});
