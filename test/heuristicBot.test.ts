import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS,
  BUILT_IN_SCENARIOS,
  createGame,
  edgeBetween,
  heuristicAction,
  legalSetupSettlements,
  simulateHeuristic,
  spotValue,
  topo,
} from '../src/index.js';
import { act, blank, give, put, road } from './helpers.js';

describe('heuristic bot', () => {
  for (const sc of BUILT_IN_SCENARIOS) {
    const counts = [...new Set([sc.minPlayers, Math.min(4, sc.maxPlayers), ...(sc.maxPlayers >= 5 ? [sc.maxPlayers] : [])])];
    for (const n of counts) {
      for (const layout of ['official', 'random'] as const) {
        it(`finishes ${sc.id} with ${n} players on the ${layout} map using only legal moves`, () => {
          const { state } = simulateHeuristic(createGame({ scenario: sc.id, players: n, seed: `bot-${n}`, options: { layout } }), 4000);
          expect(state.phase.kind).toBe('gameOver');
        });
      }
    }
  }

  for (const sc of BUILT_IN_SCENARIOS) {
    it(`finishes ${sc.id} with an easy, a medium and a hard player at one table`, () => {
      const n = Math.max(3, sc.minPlayers);
      const levels = Array.from({ length: n }, (_, i) => BOT_LEVELS[i % 3]);
      const { state } = simulateHeuristic(createGame({ scenario: sc.id, players: n, seed: `mixed-${n}` }), 6000, levels);
      expect(state.phase.kind).toBe('gameOver');
    });
  }

  it('hard beats easy, and medium beats easy, over a series of games', () => {
    const wins = { easy: 0, medium: 0, hard: 0 };
    const orders = [
      ['easy', 'medium', 'hard'],
      ['medium', 'hard', 'easy'],
      ['hard', 'easy', 'medium'],
    ] as const;
    for (let g = 0; g < 12; g++) {
      const levels = [...orders[g % 3]];
      const { state } = simulateHeuristic(createGame({ scenario: 'base', players: 3, seed: `league-${g}`, options: { firstPlayer: 0 } }), 6000, levels);
      if (state.phase.kind === 'gameOver' && state.phase.winner !== null) wins[levels[state.phase.winner]]++;
    }
    expect(wins.hard).toBeGreaterThan(wins.easy);
    expect(wins.medium).toBeGreaterThan(wins.easy);
  });

  it('medium and hard offer trades to the players who hold the card it lacks', () => {
    const s = blank('base', 3, {}, 'offers');
    s.board.harbors = [];
    const t = topo(s);
    const v = t.vertexIds.find((x) => t.vertexHexes[x].every((h) => s.board.hexes[h].terrain !== 'sea'))!;
    put(s, v, 0);
    give(s, 0, { ore: 3, grain: 1, wool: 2 });
    give(s, 1, { grain: 2, brick: 1 });
    give(s, 2, { grain: 1, lumber: 1 });
    expect(heuristicAction(s, 0, 'medium')).toMatchObject({ type: 'proposeTrade', get: { grain: 1 }, to: [1, 2] });
    expect(heuristicAction(s, 0, 'hard')).toMatchObject({ type: 'proposeTrade', get: { grain: 1 }, to: [1, 2] });
    // nobody to ask when the others have no cards
    const empty = blank('base', 3, {}, 'offers');
    empty.board.harbors = [];
    put(empty, v, 0);
    give(empty, 0, { ore: 3, grain: 1, wool: 2 });
    expect(heuristicAction(empty, 0, 'medium')?.type).not.toBe('proposeTrade');
    // hard won't offer to someone about to win
    s.players[2].bonusVP = s.victoryTarget - 2;
    expect(heuristicAction(s, 0, 'hard')).toMatchObject({ type: 'proposeTrade', to: [1] });
  });

  it('takes an offer that brings its goal closer; easy also takes a slightly bad one', () => {
    // Ada (1) saves for a development card: an ore for one of her 4 bricks is welcome at every level
    let s = blank('base', 3);
    give(s, 0, { ore: 1 });
    give(s, 1, { brick: 4 });
    s = act(s, { type: 'proposeTrade', player: 0, give: { ore: 1 }, get: { brick: 1 }, to: [1] });
    for (const level of BOT_LEVELS) expect(heuristicAction(s, 1, level)?.type, level).toBe('acceptTrade');
    // a lumber she has no use for: easy still says yes, medium and hard don't
    let b = blank('base', 3);
    give(b, 0, { lumber: 1 });
    give(b, 1, { brick: 4 });
    b = act(b, { type: 'proposeTrade', player: 0, give: { lumber: 1 }, get: { brick: 1 }, to: [1] });
    expect(heuristicAction(b, 1, 'easy')?.type).toBe('acceptTrade');
    expect(heuristicAction(b, 1, 'medium')?.type).not.toBe('acceptTrade');
    expect(heuristicAction(b, 1, 'hard')?.type).not.toBe('acceptTrade');
  });

  it('takes the most valuable starting spot', () => {
    const s = createGame({ scenario: 'base', players: 3, seed: 7, options: { firstPlayer: 0 } });
    const a = heuristicAction(s, 0);
    expect(a?.type).toBe('placeSettlement');
    const chosen = spotValue(s, 0, (a as { vertex: string }).vertex);
    for (const v of legalSetupSettlements(s, 0)) expect(spotValue(s, 0, v)).toBeLessThanOrEqual(chosen);
  });

  it('keeps the robber off its own hexes', () => {
    const s = blank('base', 3);
    const hex = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].token === 8)!;
    put(s, topo(s).hexVertices[hex][0], 0);
    s.board.robber = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].terrain === 'desert')!;
    s.phase = { kind: 'robber', reason: 'knight', resume: { kind: 'main' } };
    const a = heuristicAction(s, 0);
    expect(a?.type).toBe('moveRobber');
    expect((a as { hex: string }).hex).not.toBe(hex);
  });

  it('answers open offers with a counter-offer it can afford, or declines', () => {
    /** Ada (1) has a settlement and a road to a spot: she saves for a settlement, with bricks to spare. */
    const adaSaves = () => {
      const g = blank('base', 3);
      const t = topo(g);
      const a = t.vertexIds.find((x) => t.vertexHexes[x].every((h) => g.board.hexes[h].terrain !== 'sea'))!;
      const b = t.vertexNeighbors[a][0];
      const c = t.vertexNeighbors[b].find((x) => x !== a)!;
      put(g, a, 1);
      road(g, [edgeBetween(t, a, b)!, edgeBetween(t, b, c)!], 1);
      give(g, 1, { brick: 4 });
      return g;
    };
    let s = adaSaves();
    give(s, 0, { lumber: 1 });
    // Bo has no brick
    give(s, 2, { ore: 1 });
    // everyone saw who got what (Ada asks for a card the proposer holds, as far as she can tell)
    s.log.push({ turn: 1, msg: 'Player 1 receives 1 lumber' }, { turn: 1, msg: 'Player 3 receives 1 ore' });
    s = act(s, { type: 'proposeTrade', player: 0, give: {}, get: { brick: 1 }, to: [1, 2], open: true });
    const id = s.turn.trades[0].id;
    const ada = heuristicAction(s, 1);
    expect(ada).toMatchObject({ type: 'proposeTrade', give: { brick: 1 }, get: { lumber: 1 }, to: [0], replyTo: id });
    s = act(s, ada!);
    expect(heuristicAction(s, 2)).toMatchObject({ type: 'rejectTrade', tradeId: id });

    // "what will you give for my lumber?": Ada pays with a brick she can spare
    let o = adaSaves();
    give(o, 0, { lumber: 1 });
    o = act(o, { type: 'proposeTrade', player: 0, give: { lumber: 1 }, get: {}, to: [1, 2], open: true });
    expect(heuristicAction(o, 1)).toMatchObject({ type: 'proposeTrade', give: { brick: 1 }, get: { lumber: 1 }, replyTo: o.turn.trades[0].id });
  });


  it('trades with the bank only to complete what it is saving for', () => {
    const s = blank('base', 3, {}, 'trade');
    s.board.harbors = [];
    const t = topo(s);
    const v = t.vertexIds.find((x) => t.vertexHexes[x].every((h) => s.board.hexes[h].terrain !== 'sea'))!;
    put(s, v, 0);
    // A city needs 3 ore and 2 grain: first it asks the others for the missing grain
    // (one spare wool for it, then "who gives me grain?"), and when nobody takes
    // either, the bank gets 4 wool.
    give(s, 0, { ore: 3, grain: 1, wool: 4 });
    give(s, 1, { grain: 1, brick: 1 });
    give(s, 2, { grain: 1, lumber: 1 });
    let a = heuristicAction(s, 0)!;
    expect(a).toMatchObject({ type: 'proposeTrade', give: { wool: 1 }, get: { grain: 1 }, to: [1, 2] });
    let g = act(s, a);
    expect(heuristicAction(g, 0)).toBeNull(); // waits for the answers
    for (const q of [1, 2]) g = act(g, { type: 'rejectTrade', player: q, tradeId: g.turn.trades[0].id });
    g = act(g, heuristicAction(g, 0)!); // nobody wanted it: withdrawn
    expect(g.turn.trades).toHaveLength(0);
    a = heuristicAction(g, 0)!;
    expect(a).toMatchObject({ type: 'proposeTrade', give: {}, get: { grain: 1 }, open: true });
    g = act(g, a);
    for (const q of [1, 2]) g = act(g, { type: 'rejectTrade', player: q, tradeId: g.turn.trades[0].id });
    g = act(g, heuristicAction(g, 0)!);
    // two offers per turn at medium: now the bank
    a = heuristicAction(g, 0)!;
    expect(a).toMatchObject({ type: 'bankTrade', give: { wool: 4 }, get: { grain: 1 } });
    // an easy bot doesn't plan, so it never trades for the missing card
    expect(heuristicAction(s, 0, 'easy')?.type).not.toBe('bankTrade');
  });
});
