import { describe, expect, it } from 'vitest';
import { heuristicAction, legalActions, topo, type Action, type BotLevel, type GameState, type PlayerId, type VertexId } from '../src/index.js';
import { CK, bare, giveC, hand, knight } from './ckHelpers.js';
import { C, act, blank, give, put, road, setHex, trail } from './helpers.js';

/**
 * The hard level's Cities & Knights strategy (src/bots/ckPlan.ts and the
 * weights in src/bots/ckWeights.ts): key decisions. `npm run bots:match`
 * measures it against another copy of the bot, `npm run bots:tune-ck` tunes
 * its weights.
 */

function botMove(s: GameState, p: PlayerId, level: BotLevel = 'hard'): Action {
  const a = heuristicAction(s, p, level);
  expect(a, `a move for ${p}`).not.toBeNull();
  expect(legalActions(s, p)).toContainEqual(a);
  return a!;
}

/** Three cities (barbarian strength 3), one per player, on a bare board. */
function threeCities(): GameState {
  const s = bare();
  put(s, C(0, 0, 0), 0, 'city');
  put(s, C(-2, 0, 0), 1, 'city');
  put(s, C(0, -2, 0), 2, 'city');
  return s;
}

const isKnightMove = (a: Action) => a.type === 'buildKnight' || a.type === 'activateKnight' || a.type === 'promoteKnight';

describe('hard in Cities & Knights: the barbarians', () => {
  it("doesn't over-invest in knights while the ship is far and it isn't the weakest defender", () => {
    const s = threeCities();
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1)]), 0);
    // everyone has a basic knight awake: 3 against 3 holds, and player 0 is not the weakest
    knight(s, C(0, 0, 2), 0, 1, true);
    knight(s, C(-2, 2, 0), 1, 1, true);
    knight(s, C(2, -2, 3), 2, 1, true);
    give(s, 0, { wool: 1, ore: 1, grain: 1 });
    s.ck!.barbarians = 3;
    // (the hard level of commit 4d6b857 hired a knight here, to race for Defender of Catan)
    expect(isKnightMove(botMove(s, 0))).toBe(false);
  });

  it('keeps level with the best defender (nobody gets Defender of Catan) rather than racing past it', () => {
    const s = threeCities();
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1)]), 0);
    // 2 + 2 + 1 against 3 holds; player 1's strong knight ties player 0's
    knight(s, C(0, 0, 2), 0, 2, true);
    knight(s, C(-2, 2, 0), 1, 2, true);
    knight(s, C(2, -2, 3), 2, 1, true);
    give(s, 0, { wool: 1, ore: 1, grain: 1 });
    s.ck!.barbarians = 5;
    // (the hard level of commit 4d6b857 hired a knight to become the sole best defender)
    expect(isKnightMove(botMove(s, 0))).toBe(false);
    // one level behind: it wakes a knight to tie
    s.ck!.knights[C(0, 0, 2)].level = 1;
    s.ck!.knights[C(0, 0, 3)] = { owner: 0, level: 1, active: false, activatedPart: -1, promotedPart: -1 };
    expect(botMove(s, 0)).toEqual({ type: 'activateKnight', player: 0, vertex: C(0, 0, 3) });
  });

  it('still keeps from being the weakest defender when the attack would be lost', () => {
    const s = threeCities();
    knight(s, C(-2, 2, 0), 1, 1, true);
    knight(s, C(2, -2, 3), 2, 1, true);
    knight(s, C(0, 0, 2), 0, 1);
    give(s, 0, { grain: 1 });
    s.ck!.barbarians = 6;
    expect(botMove(s, 0)).toEqual({ type: 'activateKnight', player: 0, vertex: C(0, 0, 2) });
  });
});

describe('hard in Cities & Knights: progress cards', () => {
  it('plays the Saboteur when it hits the leader hard, and keeps it while the leader holds little', () => {
    const s = threeCities();
    s.players[1].bonusVP = 6;
    give(s, 1, { brick: 3, lumber: 3, wool: 2, ore: 2 });
    give(s, 2, { grain: 1 });
    hand(s, 0, 'saboteur');
    expect(botMove(s, 0)).toEqual({ type: 'playProgress', player: 0, card: 'saboteur' });
    // the leader has two cards left: not worth the card yet
    const t = threeCities();
    t.players[1].bonusVP = 6;
    give(t, 1, { brick: 1, ore: 1 });
    give(t, 2, { grain: 1 });
    hand(t, 0, 'saboteur');
    expect(botMove(t, 0)).not.toMatchObject({ type: 'playProgress', card: 'saboteur' });
  });
});

describe('hard in Cities & Knights: city improvements', () => {
  it('buys a first level of a track it has no commodity for at the bank, for its progress cards', () => {
    const s = threeCities();
    // its main track is trade (cloth from the pasture); it has no paper and no coin
    setHex(s, 0, 0, 'pasture', 6);
    s.ck!.players[0].improvements.trade = 2;
    give(s, 0, { wool: 4 });
    const a = botMove(s, 0);
    expect(a).toMatchObject({ type: 'bankTrade', give: { wool: 4 } });
    const got = Object.keys((a as Extract<Action, { type: 'bankTrade' }>).get)[0];
    expect(['paper', 'coin']).toContain(got);
    // then buys the level
    expect(botMove(act(s, a), 0)).toMatchObject({ type: 'improveCity', track: got === 'paper' ? 'science' : 'politics' });
  });
});

describe('hard in Cities & Knights: metropolises', () => {
  it('trades at the bank for the last commodities of a metropolis it can win now, even off its main track', () => {
    const s = threeCities();
    // science is its main track (paper from the forest), level 3 like politics; nobody has a metropolis
    setHex(s, 0, 0, 'forest', 8);
    s.ck!.players[0].improvements = { trade: 0, politics: 3, science: 3 };
    giveC(s, 0, { coin: 2 });
    give(s, 0, { wool: 8 });
    // two coins short of the politics metropolis: 8 wool at the bank
    let t = s;
    for (let i = 0; i < 2; i++) {
      const a = botMove(t, 0);
      expect(a).toEqual({ type: 'bankTrade', player: 0, give: { wool: 4 }, get: { coin: 1 } });
      t = act(t, a);
    }
    expect(botMove(t, 0)).toEqual({ type: 'improveCity', player: 0, track: 'politics', vertex: C(0, 0, 0) });
  });
});

describe('hard in Cities & Knights: The Wonders', () => {
  it('puts the next level of its wonder before a city (the four levels win outright)', () => {
    const s = blank('seafarers-8-wonders', 3, CK);
    const t = topo(s);
    const land = t.vertexIds.filter((v) => t.vertexHexes[v].some((h) => s.board.hexes[h]?.zone === 'main'));
    const far = (v: VertexId, from: VertexId[]) => from.every((w) => w !== v && !t.vertexNeighbors[w].includes(v));
    const city = land[0];
    const town = land.find((v) => far(v, [city]))!;
    put(s, city, 0, 'city');
    put(s, town, 0);
    const w = s.ext.wonders as { owned: Array<string | null>; claimed: Record<string, number>; levels: number[] };
    w.owned[0] = 'cathedral';
    w.claimed.cathedral = 0;
    s.players[0].supply.ships--;
    // a level ahead of everyone already
    w.levels[0] = 1;
    // the cards for a level of the Cathedral (1 brick, 3 ore, 1 grain) or for the city (3 ore, 2 grain), not both
    give(s, 0, { brick: 1, ore: 3, grain: 2 });
    expect(legalActions(s, 0)).toContainEqual({ type: 'buildCity', player: 0, vertex: town });
    expect(botMove(s, 0)).toEqual({ type: 'scenario', player: 0, name: 'buildWonder' });
    // medium, a level ahead, builds the city
    expect(botMove(s, 0, 'medium')).toMatchObject({ type: 'buildCity' });
  });
});
