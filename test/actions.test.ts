import { describe, expect, it } from 'vitest';
import { harborEdgeError, topo, total, tradeRates, viewFor, type GameState } from '../src/index.js';
import { C, H, S, act, blank, clearHand, fail, give, put, road, trail } from './helpers.js';

describe('domestic trade', () => {
  it('active player offers, a target accepts, the proposer confirms', () => {
    let s = blank('base', 3);
    give(s, 0, { ore: 2 });
    give(s, 1, { wool: 1 });
    give(s, 2, { wool: 1 });
    s = act(s, { type: 'proposeTrade', player: 0, give: { ore: 1 }, get: { wool: 1 }, to: [1, 2] });
    const id = s.turn.trades[0].id;
    s = act(s, { type: 'acceptTrade', player: 2, tradeId: id });
    fail(s, { type: 'confirmTrade', player: 0, tradeId: id, partner: 1 }, /not accepted/);
    s = act(s, { type: 'confirmTrade', player: 0, tradeId: id, partner: 2 });
    expect(s.players[0].resources).toMatchObject({ ore: 1, wool: 1 });
    expect(s.players[2].resources).toMatchObject({ ore: 1, wool: 0 });
    expect(s.turn.trades).toHaveLength(0);
  });

  it('counter-offers go to the active player and complete on acceptance', () => {
    let s = blank('base', 3);
    give(s, 0, { grain: 2 });
    give(s, 1, { brick: 1 });
    s = act(s, { type: 'proposeTrade', player: 1, give: { brick: 1 }, get: { grain: 2 }, to: [0] });
    s = act(s, { type: 'acceptTrade', player: 0, tradeId: s.turn.trades[0].id });
    expect(s.players[0].resources).toMatchObject({ brick: 1, grain: 0 });
    expect(s.players[1].resources).toMatchObject({ grain: 2, brick: 0 });
  });

  it('open offer "who has a brick for me?": others answer with counter-offers, the active player takes one', () => {
    let s = blank('base', 3);
    give(s, 0, { wool: 1, grain: 1 });
    give(s, 1, { brick: 1 });
    give(s, 2, { brick: 1 });
    s = act(s, { type: 'proposeTrade', player: 0, give: {}, get: { brick: 1 }, to: [1, 2], open: true });
    const ask = s.turn.trades[0];
    expect(ask.open).toBe('give');
    // it can't be accepted as is, only answered
    fail(s, { type: 'acceptTrade', player: 1, tradeId: ask.id }, /make an offer/);
    // the answer has to keep the asked-for side
    fail(s, { type: 'proposeTrade', player: 1, give: { brick: 1, wool: 0 }, get: {}, to: [0], replyTo: ask.id }, /gifts/);
    fail(s, { type: 'proposeTrade', player: 1, give: { ore: 1 }, get: { wool: 1 }, to: [0], replyTo: ask.id }, /must give 1 brick/);
    s = act(s, { type: 'proposeTrade', player: 1, give: { brick: 1 }, get: { wool: 1 }, to: [0], replyTo: ask.id });
    s = act(s, { type: 'proposeTrade', player: 2, give: { brick: 1 }, get: { grain: 1 }, to: [0], replyTo: ask.id });
    // answering counts as a reply: nobody is waited for any more
    expect(s.turn.trades.find((t) => t.id === ask.id)!.rejected).toEqual([1, 2]);
    const fromChen = s.turn.trades.find((t) => t.from === 2)!;
    s = act(s, { type: 'acceptTrade', player: 0, tradeId: fromChen.id });
    expect(s.players[0].resources).toMatchObject({ brick: 1, grain: 0, wool: 1 });
    expect(s.players[2].resources).toMatchObject({ brick: 0, grain: 1 });
    // the open offer and the other answer are closed
    expect(s.turn.trades).toHaveLength(0);
  });

  it('open offer "what will you give for my brick?"; withdrawing it closes the answers; declining an answer removes it', () => {
    let s = blank('base', 3);
    give(s, 0, { brick: 2 });
    give(s, 1, { ore: 1 });
    give(s, 2, { wool: 2 });
    fail(s, { type: 'proposeTrade', player: 0, give: { brick: 1 }, get: { ore: 1 }, to: [1, 2], open: true }, /only what you give or only what you want/);
    fail(s, { type: 'proposeTrade', player: 0, give: { brick: 3 }, get: {}, to: [1, 2], open: true }, /do not have/);
    s = act(s, { type: 'proposeTrade', player: 0, give: { brick: 1 }, get: {}, to: [1, 2], open: true });
    const offer = s.turn.trades[0];
    expect(offer.open).toBe('get');
    fail(s, { type: 'proposeTrade', player: 1, give: { ore: 1 }, get: { brick: 2 }, to: [0], replyTo: offer.id }, /must ask for 1 brick/);
    s = act(s, { type: 'proposeTrade', player: 1, give: { ore: 1 }, get: { brick: 1 }, to: [0], replyTo: offer.id });
    s = act(s, { type: 'proposeTrade', player: 2, give: { wool: 2 }, get: { brick: 1 }, to: [0], replyTo: offer.id });
    const ore = s.turn.trades.find((t) => t.from === 1)!;
    s = act(s, { type: 'rejectTrade', player: 0, tradeId: ore.id });
    expect(s.turn.trades.map((t) => t.from)).toEqual([0, 2]);
    s = act(s, { type: 'cancelTrade', player: 0, tradeId: offer.id });
    expect(s.turn.trades).toHaveLength(0);
    expect(s.players[0].resources.brick).toBe(2);
  });

  it('only the active player can make an open offer', () => {
    let s = blank('base', 3);
    give(s, 1, { wool: 1 });
    fail(s, { type: 'proposeTrade', player: 1, give: { wool: 1 }, get: {}, to: [0], open: true }, /only the active player/);
  });

  it('forbids gifts, like-for-like, triangular trades, and trading outside the main phase', () => {
    let s = blank('base', 3);
    give(s, 0, { ore: 2, wool: 1 });
    give(s, 1, { wool: 2 });
    fail(s, { type: 'proposeTrade', player: 0, give: { ore: 1 }, get: {}, to: [1] }, /gifts/);
    fail(s, { type: 'proposeTrade', player: 0, give: { wool: 1 }, get: { wool: 1 }, to: [1] }, /same resource/);
    fail(s, { type: 'proposeTrade', player: 1, give: { wool: 1 }, get: { ore: 1 }, to: [2] }, /active player/);
    fail(s, { type: 'proposeTrade', player: 0, give: { ore: 5 }, get: { wool: 1 }, to: [1] }, /do not have/);
    s.phase = { kind: 'preRoll' };
    fail(s, { type: 'proposeTrade', player: 0, give: { ore: 1 }, get: { wool: 1 }, to: [1] });
  });

  it('separate trade/build phases: no trading once building has started', () => {
    let s = blank('base', 3, { tradeBuildMode: 'separate' });
    put(s, C(0, 0, 0), 0);
    give(s, 0, { brick: 1, lumber: 1, ore: 4 });
    give(s, 1, { wool: 1 });
    s = act(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 1) });
    fail(s, { type: 'proposeTrade', player: 0, give: { ore: 1 }, get: { wool: 1 }, to: [1] }, /trade phase is over/);
    fail(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } }, /trade phase is over/);
    // combined mode (default) allows it
    let c = blank('base', 3);
    put(c, C(0, 0, 0), 0);
    give(c, 0, { brick: 1, lumber: 1, ore: 4 });
    c = act(c, { type: 'buildRoad', player: 0, edge: S(0, 0, 1) });
    c = act(c, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    expect(c.players[0].resources.wool).toBe(1);
  });
});

describe('maritime trade', () => {
  function harborState(type: 'generic' | 'ore'): { s: GameState; v: string } {
    const s = blank('base', 3);
    s.board.harbors = [{ edge: S(2, 0, 0), type }];
    const v = topo(s).edgeVertices[S(2, 0, 0)][0];
    return { s, v };
  }

  it('4:1 by default, in multiples', () => {
    let s = blank('base', 3);
    s.board.harbors = [];
    give(s, 0, { ore: 8 });
    fail(s, { type: 'bankTrade', player: 0, give: { ore: 3 }, get: { wool: 1 } }, /4:1/);
    fail(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 2 } }, /pays for 1/);
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 8 }, get: { wool: 1, brick: 1 } });
    expect(s.players[0].resources).toMatchObject({ ore: 0, wool: 1, brick: 1 });
  });

  it('3:1 at a generic harbor you own', () => {
    let { s, v } = harborState('generic');
    give(s, 0, { grain: 3 });
    fail(s, { type: 'bankTrade', player: 0, give: { grain: 3 }, get: { ore: 1 } }, /4:1/);
    put(s, v, 0);
    expect(tradeRates(s, 0)).toMatchObject({ grain: 3, ore: 3 });
    s = act(s, { type: 'bankTrade', player: 0, give: { grain: 3 }, get: { ore: 1 } });
    expect(s.players[0].resources.ore).toBe(1);
  });

  it('2:1 at a special harbor only for its resource (no 3:1 for others)', () => {
    let { s, v } = harborState('ore');
    put(s, v, 0);
    expect(tradeRates(s, 0)).toEqual({ brick: 4, lumber: 4, wool: 4, grain: 4, ore: 2 });
    give(s, 0, { ore: 4, grain: 3 });
    fail(s, { type: 'bankTrade', player: 0, give: { grain: 3 }, get: { ore: 1 } }, /4:1/);
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1, grain: 1 } });
    expect(s.players[0].resources).toMatchObject({ ore: 0, wool: 1, grain: 4 });
  });

  it('the bank must have the cards', () => {
    const s = blank('base', 3);
    give(s, 0, { ore: 4 });
    s.bank.wool = 0;
    fail(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } }, /bank does not/);
  });
});

describe('building', () => {
  it('road: must connect, costs brick+lumber, cannot pass through an opponent building', () => {
    let s = blank('base', 3);
    put(s, C(0, 0, 0), 0);
    road(s, S(0, 0, 1), 0); // C0-C1... edge S1 joins corners 0 and 1
    fail(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 2) }, /not enough/);
    give(s, 0, { brick: 3, lumber: 3 });
    fail(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 4) }, /connect/);
    s = act(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 2) });
    expect(s.players[0].resources).toMatchObject({ brick: 2, lumber: 2 });
    // opponent settlement at corner 2 blocks extending past it
    put(s, C(0, 0, 2), 1);
    fail(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 3) }, /connect/);
    fail(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 2) }, /occupied/);
    fail(s, { type: 'buildRoad', player: 0, edge: S(3, 0, 0) });
  });

  it('settlement: needs your road, distance rule, and the cost', () => {
    let s = blank('base', 3);
    put(s, C(0, 0, 0), 0);
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2)]), 0);
    give(s, 0, { brick: 2, lumber: 2, wool: 2, grain: 2 });
    fail(s, { type: 'buildSettlement', player: 0, vertex: C(0, 0, 1) }, /distance/);
    fail(s, { type: 'buildSettlement', player: 0, vertex: C(0, 0, 4) }, /connect/);
    s = act(s, { type: 'buildSettlement', player: 0, vertex: C(0, 0, 2) });
    expect(s.players[0].supply.settlements).toBe(3);
  });

  it('city: replaces your settlement, returns the settlement piece, needs a free city piece', () => {
    let s = blank('base', 3);
    put(s, C(0, 0, 0), 0);
    put(s, C(0, 0, 3), 1);
    give(s, 0, { ore: 6, grain: 4 });
    fail(s, { type: 'buildCity', player: 0, vertex: C(0, 0, 3) }, /your settlements/);
    s = act(s, { type: 'buildCity', player: 0, vertex: C(0, 0, 0) });
    expect(s.players[0].supply).toMatchObject({ settlements: 5, cities: 3 });
    fail(s, { type: 'buildCity', player: 0, vertex: C(0, 0, 0) }, /your settlements/);
    s.players[0].supply.cities = 0;
    put(s, C(2, -2, 4), 0);
    fail(s, { type: 'buildCity', player: 0, vertex: C(2, -2, 4) }, /no cities/);
  });

  it('piece supply is a hard cap', () => {
    const s = blank('base', 3);
    put(s, C(0, 0, 0), 0);
    give(s, 0, { brick: 1, lumber: 1 });
    s.players[0].supply.roads = 0;
    fail(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 1) }, /no roads/);
  });

  it('cannot build before rolling or on another player\'s turn', () => {
    const s = blank('base', 3);
    put(s, C(0, 0, 0), 1);
    give(s, 1, { brick: 1, lumber: 1 });
    fail(s, { type: 'buildRoad', player: 1, edge: S(0, 0, 1) }, /not your turn/);
    s.phase = { kind: 'preRoll' };
    put(s, C(2, -2, 4), 0);
    give(s, 0, { brick: 1, lumber: 1 });
    fail(s, { type: 'buildRoad', player: 0, edge: topo(s).vertexEdges[C(2, -2, 4)][0] }, /roll/);
    fail(s, { type: 'endTurn', player: 0 }, /roll/);
  });
});

describe('development cards', () => {
  function withCards(...types: Array<'knight' | 'victoryPoint' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly'>): GameState {
    const s = blank('base', 3);
    s.players[0].devCards = types.map((type) => ({ type, boughtPart: 0 }));
    return s;
  }

  it('buying draws the top card and costs ore+wool+grain; the deck can run out', () => {
    let s = blank('base', 3);
    give(s, 0, { ore: 2, wool: 2, grain: 2 });
    const top = s.devDeck[s.devDeck.length - 1];
    s = act(s, { type: 'buyDevCard', player: 0 });
    expect(s.players[0].devCards[0].type).toBe(top);
    expect(s.devDeck).toHaveLength(24);
    s.devDeck = [];
    fail(s, { type: 'buyDevCard', player: 0 }, /empty/);
  });

  it('cannot play a card bought this turn; only one per turn; may play before rolling', () => {
    let s = blank('base', 3);
    s.phase = { kind: 'preRoll' };
    s.players[0].devCards = [
      { type: 'monopoly', boughtPart: 1 },
      { type: 'yearOfPlenty', boughtPart: 0 },
      { type: 'monopoly', boughtPart: 0 },
    ];
    s = act(s, { type: 'playYearOfPlenty', player: 0, resources: ['ore', 'ore'] });
    expect(s.players[0].resources.ore).toBe(2);
    expect(s.phase.kind).toBe('preRoll');
    fail(s, { type: 'playMonopoly', player: 0, resource: 'ore' }, /one development card/);
    let t = blank('base', 3);
    t.players[0].devCards = [{ type: 'monopoly', boughtPart: 1 }];
    fail(t, { type: 'playMonopoly', player: 0, resource: 'ore' }, /bought/);
    t.turn.part = 2;
    t = act(t, { type: 'playMonopoly', player: 0, resource: 'ore' });
    expect(t.players[0].devCards).toHaveLength(0);
  });

  it('knight: robber move and steal without discards; counts toward Largest Army', () => {
    let s = withCards('knight');
    s.phase = { kind: 'preRoll' };
    give(s, 1, { ore: 10 });
    put(s, C(0, 0, 0), 1);
    s = act(s, { type: 'playKnight', player: 0 });
    expect(s.phase.kind).toBe('robber');
    const robberHex = s.board.robber === H(0, 0) ? H(1, 0) : H(0, 0);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: robberHex, victim: 1 });
    expect(s.players[1].resources.ore).toBe(9);
    expect(s.phase.kind).toBe('preRoll');
    expect(s.players[0].playedKnights).toBe(1);
  });

  it('Largest Army: first to 3 knights, taken only with strictly more', () => {
    const s = blank('base', 3);
    const play = (st: GameState, p: number) => {
      st.turn.actor = p;
      st.turn.current = p;
      st.turn.devCardPlayed = false;
      st.phase = { kind: 'main' };
      st.players[p].devCards.push({ type: 'knight', boughtPart: 0 });
      let n = act(st, { type: 'playKnight', player: p });
      const hex = n.board.robber === H(-2, 2) ? H(-2, 1) : H(-2, 2);
      n = act(n, { type: 'moveRobber', player: p, piece: 'robber', hex });
      return n;
    };
    let t = play(play(s, 0), 0);
    expect(t.largestArmy.holder).toBeNull();
    t = play(t, 0);
    expect(t.largestArmy.holder).toBe(0);
    t = play(play(play(t, 1), 1), 1);
    expect(t.largestArmy.holder).toBe(0); // tie does not take it
    t = play(t, 1);
    expect(t.largestArmy.holder).toBe(1);
  });

  it('Road Building places two free roads (fewer if you stop)', () => {
    let s = withCards('roadBuilding');
    put(s, C(0, 0, 0), 0);
    s = act(s, { type: 'playRoadBuilding', player: 0 });
    expect(s.phase.kind).toBe('roadBuilding');
    fail(s, { type: 'buildSettlement', player: 0, vertex: C(0, 0, 2) });
    s = act(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 1) });
    s = act(s, { type: 'buildRoad', player: 0, edge: S(0, 0, 2) });
    expect(s.phase.kind).toBe('main');
    expect(s.players[0].supply.roads).toBe(13);
    expect(total(s.players[0].resources)).toBe(0);
    let t = withCards('roadBuilding');
    put(t, C(0, 0, 0), 0);
    t = act(t, { type: 'playRoadBuilding', player: 0 });
    t = act(t, { type: 'buildRoad', player: 0, edge: S(0, 0, 1) });
    t = act(t, { type: 'endRoadBuilding', player: 0 });
    expect(t.phase.kind).toBe('main');
  });

  it('Year of Plenty takes any two (same or different); Monopoly takes every card of a type', () => {
    let s = withCards('yearOfPlenty');
    fail(s, { type: 'playYearOfPlenty', player: 0, resources: ['ore'] }, /choose 2/);
    s = act(s, { type: 'playYearOfPlenty', player: 0, resources: ['brick', 'wool'] });
    expect(s.players[0].resources).toMatchObject({ brick: 1, wool: 1 });
    let m = withCards('monopoly');
    give(m, 1, { grain: 3, ore: 1 });
    give(m, 2, { grain: 2 });
    m = act(m, { type: 'playMonopoly', player: 0, resource: 'grain' });
    expect(m.players[0].resources.grain).toBe(5);
    expect(m.players[1].resources).toMatchObject({ grain: 0, ore: 1 });
  });

  it('victory point cards are never "played"', () => {
    const s = withCards('victoryPoint');
    const view = viewFor(s, 1);
    expect(view.players[0].devCardCount).toBe(1);
    expect(view.players[0].devCards).toBeUndefined();
    expect(view.players[0].publicVP).toBe(0);
  });
});

describe('player-placed harbors', () => {
  it('harbor spots must be coastal, not facing a desert, and not touching another harbor', () => {
    const s = blank('base', 3);
    s.board.harbors = [{ edge: S(2, 0, 0), type: 'generic' }];
    expect(harborEdgeError(s, S(0, 0, 0), null)).toMatch(/coast/);
    expect(harborEdgeError(s, S(2, 0, 1), null)).toMatch(/another harbor/);
    expect(harborEdgeError(s, S(2, -2, 1), null)).toBeNull();
    clearHand(s, 0);
  });
});
