import { describe, expect, it } from 'vitest';
import { longestRouteLength, publicVP, updateLongestRoute, type GameState } from '../src/index.js';
import { C, act, blank, give, put, road, ringVertices, ship, trail } from './helpers.js';

describe('longest route length (golden positions)', () => {
  it('a 6-road ring around a hex counts 6', () => {
    const s = blank('base', 3);
    road(s, trail(s, ringVertices(0, 0)), 0);
    expect(longestRouteLength(s, 0)).toBe(6);
  });

  it('branches do not add up: the longest single trail counts', () => {
    const s = blank('base', 3);
    // 5-long path around (0,0) plus a 1-road spur from its middle
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2), C(0, 0, 3), C(0, 0, 4), C(0, 0, 5)]), 0);
    road(s, trail(s, [C(0, 0, 2), C(-1, 0, 1)]), 0); // C(-1,0,1) is the outward neighbour of C(0,0,2)
    expect(longestRouteLength(s, 0)).toBe(5);
    // a longer spur changes the best trail: 2 roads out + 3 back along the ring = 5 (not 7)
    road(s, trail(s, [C(-1, 0, 1), C(-1, 0, 2)]), 0);
    expect(longestRouteLength(s, 0)).toBe(5);
  });

  it('a ring with a tail: the trail can loop the ring and leave by the tail', () => {
    const s = blank('base', 3);
    road(s, trail(s, ringVertices(0, 0)), 0);
    road(s, trail(s, [C(0, 0, 0), C(1, -1, 5), C(1, -1, 0)]), 0);
    // 2 tail roads + 6 around the ring
    expect(longestRouteLength(s, 0)).toBe(8);
  });

  it('an opponent settlement cuts the trail; your own does not', () => {
    const s = blank('base', 3);
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2), C(0, 0, 3), C(0, 0, 4), C(0, 0, 5)]), 0);
    put(s, C(0, 0, 2), 0);
    expect(longestRouteLength(s, 0)).toBe(5);
    s.board.buildings[C(0, 0, 2)] = { owner: 1, type: 'settlement' };
    expect(longestRouteLength(s, 0)).toBe(3);
  });

  it('Seafarers: roads and ships connect only through your own settlement or city', () => {
    const s = blank('test-sea', 2);
    // island centre (2,2); ring road on its north side ending at the coast, ships beyond
    const coast = C(2, 1, 1); // north corner of f6 (2,1): touches (2,1), NE (3,0) sea, NW (2,0) sea
    road(s, trail(s, [C(2, 1, 4), C(2, 1, 5), C(2, 1, 0), coast]), 0);
    ship(s, trail(s, [coast, C(2, 1, 2), C(1, 1, 1)]), 0);
    expect(longestRouteLength(s, 0)).toBe(3);
    put(s, coast, 0);
    expect(longestRouteLength(s, 0)).toBe(5);
    s.board.buildings[coast] = { owner: 1, type: 'settlement' };
    expect(longestRouteLength(s, 0)).toBe(3);
  });
});

describe('Longest Road award', () => {
  function withPath(len: number, p: number, s: GameState, ringQ: number, ringR: number) {
    const vs = ringVertices(ringQ, ringR).slice(0, len + 1);
    road(s, trail(s, vs), p);
  }

  it('needs at least 5; a tie does not take it', () => {
    const s = blank('base', 3);
    withPath(4, 0, s, 0, 0);
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBeNull();
    road(s, trail(s, [C(0, 0, 4), C(0, 0, 5)]), 0);
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(0);
    withPath(5, 1, s, -2, 2);
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(0);
    road(s, trail(s, [ringVertices(-2, 2)[5], ringVertices(-2, 2)[6]]), 1);
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(1);
  });

  it('broken road: holder keeps it while still tied for longest', () => {
    let s = blank('base', 3);
    withPath(6, 0, s, 0, 0); // ring of 6
    withPath(5, 1, s, 2, -2);
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(0);
    // player 2 settles on the ring: player 0's ring becomes a 6-trail through... (a ring cut at one vertex is still 6)
    s.board.buildings[C(0, 0, 3)] = { owner: 2, type: 'settlement' };
    updateLongestRoute(s);
    expect(s.longestRoute.lengths[0]).toBe(6);
    // a second cut leaves 3+3 -> 3; player 1 (5) becomes uniquely longest
    s.board.buildings[C(0, 0, 0)] = { owner: 2, type: 'settlement' };
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(1);
    // whoever reaches 5 first holds it through a later tie
    s = blank('base', 3);
    withPath(5, 0, s, 0, 0);
    updateLongestRoute(s);
    withPath(5, 1, s, 2, -2);
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(0);
  });

  it('broken road: set aside when several others tie or nobody has 5', () => {
    const s = blank('base', 4);
    withPath(6, 0, s, 0, 0);
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(0);
    withPath(5, 1, s, 2, -2);
    withPath(5, 2, s, -2, 2);
    updateLongestRoute(s);
    s.board.buildings[C(0, 0, 3)] = { owner: 3, type: 'settlement' };
    s.board.buildings[C(0, 0, 0)] = { owner: 3, type: 'settlement' };
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBeNull();
    // once someone is uniquely longest it is awarded again
    road(s, trail(s, [ringVertices(2, -2)[5], ringVertices(2, -2)[6]]), 1);
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(1);
  });

  it('building a settlement that breaks a road re-evaluates the card', () => {
    let s = blank('base', 3);
    withPath(5, 1, s, 0, 0); // corners 0..5 of (0,0)
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(1);
    // player 0 reaches corner 2 by a road from outside and settles on it
    put(s, C(-1, 0, 2), 0);
    road(s, trail(s, [C(-1, 0, 2), C(-1, 0, 1), C(0, 0, 2)]), 0);
    give(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    s = act(s, { type: 'buildSettlement', player: 0, vertex: C(0, 0, 2) });
    expect(s.longestRoute.lengths[1]).toBe(3);
    expect(s.longestRoute.holder).toBeNull();
  });

  it('is worth 2 VP', () => {
    const s = blank('base', 3);
    withPath(5, 0, s, 0, 0);
    expect(publicVP(s, 0)).toBe(0);
    updateLongestRoute(s);
    expect(publicVP(s, 0)).toBe(2);
  });
});
