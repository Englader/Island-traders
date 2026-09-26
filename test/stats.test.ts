import { describe, expect, it } from 'vitest';
import {
  RESOURCES,
  applyAction,
  createGame,
  getScenario,
  simulateHeuristic,
  topo,
  totalVP,
  viewFor,
  type GameState,
  type PlayerStats,
} from '../src/index.js';
import { act, blank, give, put, withDice } from './helpers.js';

const stats = (s: GameState, p: number): PlayerStats => s.stats!.players[p];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const producedTotal = (ps: PlayerStats) => sum(RESOURCES.map((r) => ps.produced[r]));

describe('end-of-game statistics: counters', () => {
  it('start at zero for every player', () => {
    const s = createGame({ scenario: 'base', players: 4, seed: 'stats' });
    expect(s.stats!.players).toHaveLength(4);
    for (const ps of s.stats!.players) {
      expect(producedTotal(ps)).toBe(0);
      expect(ps.vp).toEqual([]);
      expect(ps.trades + ps.bankTrades + ps.devBought + ps.spent + ps.other).toBe(0);
    }
  });

  it('count dice production, what the dice should have given, and a VP row per turn', () => {
    let s = blank('base', 3);
    const t = topo(s);
    const hex = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].token === 8)!;
    const v = t.hexVertices[hex][0];
    put(s, v, 0, 'city');
    s = act(s, { type: 'endTurn', player: 0 });
    // the turn passed: everyone's VP is recorded
    expect(s.stats!.players.map((p) => p.vp)).toEqual([[2], [0], [0]]);
    s = withDice(s, 4, 4);
    s = act(s, { type: 'rollDice', player: 1 });
    const terrain = s.board.hexes[hex].terrain;
    const res = { hills: 'brick', forest: 'lumber', pasture: 'wool', fields: 'grain', mountains: 'ore' }[terrain as 'hills'] as 'brick';
    expect(stats(s, 0).produced[res]).toBe(2);
    expect(producedTotal(stats(s, 0))).toBe(2);
    // what the city's hexes are worth per roll, in 36ths (an 8 comes up 5 ways out of 36; a city takes 2)
    const ways = (n: number | null) => (n === null ? 0 : 6 - Math.abs(7 - n));
    const worth = sum(t.vertexHexes[v].filter((h) => h !== s.board.robber).map((h) => 2 * ways(s.board.hexes[h].token)));
    expect(worth).toBeGreaterThanOrEqual(10);
    expect(stats(s, 0).expected36).toBe(worth);
    expect(stats(s, 1).expected36).toBe(0);
    expect(stats(s, 0).other).toBe(0);
  });

  it('sort trades, bank trades, building and development cards', () => {
    let s = blank('base', 3);
    give(s, 0, { ore: 5, grain: 2, wool: 1 });
    give(s, 1, { brick: 2 });
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { lumber: 1 } });
    expect(stats(s, 0)).toMatchObject({ bankIn: 1, bankOut: 4, bankTrades: 1 });
    s = act(s, { type: 'proposeTrade', player: 0, give: { grain: 1 }, get: { brick: 2 }, to: [1] });
    s = act(s, { type: 'acceptTrade', player: 1, tradeId: 1 });
    expect(stats(s, 0).trades).toBe(0);
    s = act(s, { type: 'confirmTrade', player: 0, tradeId: 1, partner: 1 });
    expect(stats(s, 0)).toMatchObject({ tradeIn: 2, tradeOut: 1, trades: 1 });
    expect(stats(s, 1)).toMatchObject({ tradeIn: 1, tradeOut: 2, trades: 1 });
    s = act(s, { type: 'buyDevCard', player: 0 });
    expect(stats(s, 0)).toMatchObject({ spent: 3, devBought: 1 });
    expect(stats(s, 2).trades + stats(s, 2).spent).toBe(0);
  });

  it('sort discards, steals and Monopoly', () => {
    let s = blank('base', 3);
    s.phase = { kind: 'preRoll' };
    s.turn.dice = null;
    // player 1 has a settlement on a hex the robber can move to
    const t = topo(s);
    const hex = Object.keys(s.board.hexes).find((h) => h !== s.board.robber && s.board.hexes[h].token !== null)!;
    put(s, t.hexVertices[hex][0], 1);
    give(s, 1, { brick: 4, wool: 5 });
    s.players[0].devCards = [{ type: 'monopoly', boughtPart: 0 }];
    s = withDice(s, 3, 4);
    s = act(s, { type: 'rollDice', player: 0 });
    expect(s.phase.kind).toBe('discard');
    s = act(s, { type: 'discard', player: 1, cards: { wool: 4 } });
    expect(stats(s, 1).discarded).toBe(4);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex, victim: 1 });
    expect(stats(s, 0).stole).toBe(1);
    expect(stats(s, 1).stolen).toBe(1);
    const bricks = s.players[1].resources.brick;
    s = act(s, { type: 'playMonopoly', player: 0, resource: 'brick' });
    expect(stats(s, 0).stole).toBe(1 + bricks);
    expect(stats(s, 1).stolen).toBe(1 + bricks);
    expect(stats(s, 0)).toMatchObject({ devPlayed: 1, other: 0, lost: 0 });
  });

  it('are hidden in the players’ views until the game is over', () => {
    const s = createGame({ scenario: 'base', players: 3, seed: 'hidden' });
    expect(viewFor(s, 0).stats).toBeUndefined();
    expect(viewFor(s, null).stats).toBeUndefined();
    const over = { ...s, phase: { kind: 'gameOver', winner: 0, reason: 'test' } } as GameState;
    expect(viewFor(over, 1).stats?.players).toHaveLength(3);
  });

  it('are left out for games saved before they existed', () => {
    const s = blank('base', 3);
    delete s.stats;
    give(s, 0, { ore: 4 });
    const r = applyAction(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    expect(r.ok).toBe(true);
    expect(r.ok && r.state.stats).toBeUndefined();
  });
});

/** Numbers in a "2 brick, 1 ore" list. */
const cardsIn = (text: string) => sum([...text.matchAll(/(\d+) (brick|lumber|wool|grain|ore)/g)].map((m) => Number(m[1])));

describe('end-of-game statistics: a whole bot game reconciles', () => {
  const games: Array<[string, number]> = [
    ['base', 4],
    ['seafarers-1-new-shores', 3],
    ['seafarers-3-fog-islands', 4],
    ['seafarers-7-pirate-islands', 4],
    ['seafarers-8-wonders', 3],
  ];
  for (const [scenario, n] of games) {
    it(`${scenario} with ${n} players`, () => {
      const { state: s } = simulateHeuristic(createGame({ scenario, players: n, seed: `stats-${n}` }), 6000);
      expect(s.phase.kind).toBe('gameOver');
      const all = s.stats!.players;
      const bankSize = getScenario(scenario).bankSize(n) * RESOURCES.length;
      let bankFlow = 0;
      for (const [p, ps] of all.entries()) {
        const hand = sum(RESOURCES.map((r) => s.players[p].resources[r]));
        const inflow = producedTotal(ps) + ps.other + ps.tradeIn + ps.bankIn + ps.stole;
        const outflow = ps.tradeOut + ps.bankOut + ps.stolen + ps.discarded + ps.lost + ps.spent;
        expect(inflow - outflow, `${s.players[p].name}'s hand`).toBe(hand);
        bankFlow += producedTotal(ps) + ps.other + ps.bankIn - ps.bankOut - ps.discarded - ps.lost - ps.spent;
        // the log tells the same story
        const mine = (re: RegExp) => s.log.filter((e) => e.turn > 0 && e.msg.startsWith(`${s.players[p].name} `) && re.test(e.msg));
        const dealt = sum(mine(/ receives /).map((e) => cardsIn(e.msg))) + sum(mine(/\(gold\)$/).map((e) => cardsIn(e.msg)));
        expect(producedTotal(ps), 'production').toBe(dealt);
        expect(ps.bankTrades, 'bank trades').toBe(mine(/ with the bank for /).length);
        expect(ps.devBought, 'cards bought').toBe(mine(/ buys a development card$/).length);
        expect(ps.discarded, 'discards').toBe(sum(mine(/ discards /).map((e) => cardsIn(e.msg))));
        expect(ps.knights).toBe(s.players[p].playedKnights);
        // a VP row after the setup and after every turn, then the final score
        expect(ps.vp).toHaveLength(s.turn.number + 1);
        expect(ps.vp[ps.vp.length - 1]).toBe(totalVP(s, p));
      }
      expect(sum(RESOURCES.map((r) => s.bank[r]))).toBe(bankSize - bankFlow);
      expect(sum(all.map((p) => p.tradeIn))).toBe(sum(all.map((p) => p.tradeOut)));
      expect(sum(all.map((p) => p.stole))).toBe(sum(all.map((p) => p.stolen)));
      const playerTrades = s.log.filter((e) => / trades .+ to .+ for /.test(e.msg) && !/ with the bank /.test(e.msg)).length;
      expect(sum(all.map((p) => p.trades))).toBe(2 * playerTrades);
      // the dice's fair share is in the same range as what they gave
      const expected = sum(all.map((p) => p.expected36)) / 36;
      const produced = sum(all.map(producedTotal));
      expect(expected).toBeGreaterThan(0);
      expect(produced / expected).toBeGreaterThan(0.5);
      expect(produced / expected).toBeLessThan(1.6);
      // the view shows them once the game is over
      expect(viewFor(s, 0).stats).toEqual(s.stats);
    });
  }
});
