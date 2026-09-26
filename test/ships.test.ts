import { describe, expect, it } from 'vitest';
import { isShipOnClosedRoute, movableShips, updateLongestRoute, type GameState } from '../src/index.js';
import { C, H, S, act, blank, fail, give, put, road, ship, trail } from './helpers.js';

/*
 * test-sea: island centred on (2,2) [ring: (3,2) (3,1) (2,1) (1,2) (1,3) (2,3)],
 * islet (5,3), sea everywhere else.
 *
 * ROUTE: east coast of (3,2) -> sea -> west corner of the islet (5,3).
 */
const EAST = C(3, 2, 0); // (3,2) + sea (4,2), (4,1)
const ROUTE = [EAST, C(3, 2, 5), C(3, 3, 0), C(4, 3, 1), C(5, 3, 2)];

function sea(): GameState {
  const s = blank('test-sea', 3);
  s.board.pirate = null;
  return s;
}

function nextPart(s: GameState): GameState {
  s.turn.part++;
  s.turn.shipMoved = false;
  return s;
}

describe('ship placement', () => {
  it('ships go on sea or coastal paths, costing lumber + wool', () => {
    let s = sea();
    put(s, EAST, 0);
    give(s, 0, { lumber: 5, wool: 5 });
    fail(s, { type: 'buildShip', player: 0, edge: S(2, 2, 0) }, /sea or along a coast/);
    const e = trail(s, ROUTE);
    for (const x of e) s = act(s, { type: 'buildShip', player: 0, edge: x });
    expect(s.players[0].supply.ships).toBe(11);
    expect(s.players[0].resources).toMatchObject({ lumber: 1, wool: 1 });
  });

  it('a ship route that reaches a coast lets you settle there', () => {
    let s = sea();
    put(s, EAST, 0);
    ship(s, trail(s, ROUTE), 0);
    give(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    s = act(s, { type: 'buildSettlement', player: 0, vertex: C(5, 3, 2) });
    expect(s.board.buildings[C(5, 3, 2)].owner).toBe(0);
  });

  it('roads and ships connect only through your own settlement or city', () => {
    let s = sea();
    put(s, C(2, 2, 0), 0); // interior corner
    road(s, trail(s, [C(2, 2, 0), C(3, 2, 1)]), 0); // ends on the coast at an empty vertex
    give(s, 0, { lumber: 2, wool: 2, brick: 2 });
    fail(s, { type: 'buildShip', player: 0, edge: S(3, 2, 1) }, /connect/);
    // a building there joins them
    put(s, C(3, 2, 1), 0);
    s = act(s, { type: 'buildShip', player: 0, edge: S(3, 2, 1) });
    // and a road may not continue from a ship at an empty intersection
    fail(s, { type: 'buildRoad', player: 0, edge: S(3, 2, 0) }, /connect/);
  });

  it('a coastal path holds a road or a ship, never both', () => {
    let s = sea();
    put(s, EAST, 0);
    road(s, S(3, 2, 0), 0);
    give(s, 0, { lumber: 1, wool: 1 });
    fail(s, { type: 'buildShip', player: 0, edge: S(3, 2, 0) }, /occupied/);
  });

  it('ships cannot be built next to the pirate', () => {
    const s = sea();
    put(s, EAST, 0);
    s.board.pirate = H(4, 2);
    give(s, 0, { lumber: 1, wool: 1 });
    fail(s, { type: 'buildShip', player: 0, edge: trail(s, ROUTE)[0] }, /pirate/);
  });
});

describe('moving ships', () => {
  it('only the end ship of an open route, not built this turn, one per turn', () => {
    let s = sea();
    put(s, EAST, 0);
    const edges = trail(s, ROUTE.slice(0, 4)); // three ships, open at C(4,3,1)
    ship(s, edges, 0);
    nextPart(s);
    expect(movableShips(s, 0)).toEqual([edges[2]]);
    fail(s, { type: 'moveShip', player: 0, from: edges[1], to: trail(s, [C(4, 3, 1), C(5, 3, 2)])[0] }, /last ship/);
    // move the end ship somewhere a new ship could go
    const dest = trail(s, [C(3, 3, 0), C(3, 3, 5)])[0];
    s = act(s, { type: 'moveShip', player: 0, from: edges[2], to: dest });
    expect(s.board.pieces[dest]).toMatchObject({ owner: 0, type: 'ship' });
    expect(s.board.pieces[edges[2]]).toBeUndefined();
    fail(s, { type: 'moveShip', player: 0, from: dest, to: edges[2] }, /one ship/);
    // a ship built this turn cannot move
    let t = sea();
    put(t, EAST, 0);
    give(t, 0, { lumber: 1, wool: 1 });
    t = act(t, { type: 'buildShip', player: 0, edge: edges[0] });
    fail(t, { type: 'moveShip', player: 0, from: edges[0], to: trail(t, [EAST, C(3, 2, 1)])[0] }, /built this turn/);
  });

  it('ships are moved in the build phase, never before rolling', () => {
    const s = sea();
    put(s, EAST, 0);
    const edges = trail(s, ROUTE.slice(0, 3));
    ship(s, edges, 0);
    nextPart(s);
    s.phase = { kind: 'preRoll' };
    fail(s, { type: 'moveShip', player: 0, from: edges[1], to: trail(s, [C(3, 3, 0), C(3, 3, 5)])[0] }, /roll/);
  });

  it('a route between two of your settlements is closed; it stays closed if an opponent settles on it', () => {
    const s = sea();
    put(s, EAST, 0);
    put(s, C(5, 3, 2), 0);
    const edges = trail(s, ROUTE);
    ship(s, edges, 0);
    nextPart(s);
    for (const e of edges) expect(isShipOnClosedRoute(s, 0, e)).toBe(true);
    expect(movableShips(s, 0)).toEqual([]);
    s.board.buildings[C(3, 2, 5)] = { owner: 1, type: 'settlement' };
    expect(movableShips(s, 0)).toEqual([]);
  });

  it('a line that returns to the same settlement is open', () => {
    const s = sea();
    put(s, EAST, 0); // EAST is corner 2 of sea hex (4,2)
    const ring = [0, 1, 2, 3, 4, 5, 0].map((i) => C(4, 2, (i + 2) % 6));
    const edges = trail(s, ring);
    ship(s, edges, 0);
    nextPart(s);
    const movable = movableShips(s, 0);
    expect(movable).toContain(edges[0]);
    expect(movable).toContain(edges[5]);
  });

  it('a ring touching no settlement: every ship is open', () => {
    const s = sea();
    const ring = [0, 1, 2, 3, 4, 5, 0].map((i) => C(5, 1, i));
    const edges = trail(s, ring);
    ship(s, edges, 0);
    nextPart(s);
    expect(movableShips(s, 0).sort()).toEqual([...edges].sort());
  });

  it('ships next to the pirate cannot move', () => {
    const s = sea();
    put(s, EAST, 0);
    const edges = trail(s, ROUTE.slice(0, 3));
    ship(s, edges, 0);
    nextPart(s);
    expect(movableShips(s, 0)).toEqual([edges[1]]);
    s.board.pirate = H(3, 3);
    expect(movableShips(s, 0)).toEqual([]);
  });

  it('moving keeps the Longest Trade Route when the route is at least as long', () => {
    let s = sea();
    put(s, EAST, 0);
    const edges = trail(s, ROUTE); // 4 ships
    ship(s, edges, 0);
    ship(s, trail(s, [C(5, 3, 2), C(5, 3, 3)]), 0); // 5th ship past the islet corner
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(0);
    // player 1 ties at 5 with roads on the island
    put(s, C(2, 3, 4), 1);
    road(s, trail(s, [C(2, 3, 4), C(2, 3, 5), C(2, 3, 0), C(2, 2, 5), C(2, 2, 4), C(2, 2, 3)]), 1);
    updateLongestRoute(s);
    expect(s.longestRoute.lengths).toEqual([5, 5, 0]);
    nextPart(s);
    // move the last ship to the other side of the islet corner: still 5 long
    const last = trail(s, [C(5, 3, 2), C(5, 3, 3)])[0];
    const dest = trail(s, [C(5, 3, 2), C(5, 3, 1)])[0];
    s = act(s, { type: 'moveShip', player: 0, from: last, to: dest });
    expect(s.longestRoute.holder).toBe(0);
  });
});

describe('the pirate', () => {
  it('a 7 lets you move the robber or the pirate; the pirate robs ships, not coastal settlements', () => {
    let s = sea();
    s.board.robber = H(2, 2);
    put(s, EAST, 1); // coastal settlement next to sea hex (4,2)
    ship(s, trail(s, [C(3, 3, 0), C(4, 3, 1)]), 2); // edge (4,2)|(4,3): a side of sea hex (4,2)
    give(s, 1, { ore: 3 });
    give(s, 2, { wool: 2 });
    s.phase = { kind: 'robber', reason: 'seven', resume: { kind: 'main' } };
    fail(s, { type: 'moveRobber', player: 0, piece: 'pirate', hex: H(2, 2) }, /sea hex/);
    fail(s, { type: 'moveRobber', player: 0, piece: 'pirate', hex: H(4, 2), victim: 1 }, /cannot be robbed/);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'pirate', hex: H(4, 2), victim: 2 });
    expect(s.board.pirate).toBe(H(4, 2));
    expect(s.players[0].resources.wool).toBe(1);
    expect(s.board.robber).toBe(H(2, 2));
  });

  it('the pirate does not block roads, settlements or harbors', () => {
    let s = sea();
    s.board.pirate = H(4, 2);
    put(s, C(2, 2, 0), 0);
    road(s, trail(s, [C(2, 2, 0), C(3, 2, 1)]), 0);
    give(s, 0, { brick: 3, lumber: 3, wool: 1, grain: 1 });
    s = act(s, { type: 'buildRoad', player: 0, edge: S(3, 2, 1) });
    s = act(s, { type: 'buildSettlement', player: 0, vertex: EAST }); // touches the pirate's hex
    s = act(s, { type: 'buildRoad', player: 0, edge: S(3, 2, 0) }); // coastal road on the pirate's hex
    expect(s.board.buildings[EAST].owner).toBe(0);
    expect(s.board.pieces[S(3, 2, 0)].type).toBe('road');
  });

  it('Road Building in Seafarers may place ships', () => {
    let s = sea();
    put(s, EAST, 0);
    s.players[0].devCards = [{ type: 'roadBuilding', boughtPart: 0 }];
    s = act(s, { type: 'playRoadBuilding', player: 0 });
    const [e1, e2] = trail(s, ROUTE.slice(0, 3));
    s = act(s, { type: 'buildShip', player: 0, edge: e1 });
    s = act(s, { type: 'buildShip', player: 0, edge: e2 });
    expect(s.phase.kind).toBe('main');
    expect(s.players[0].supply.ships).toBe(13);
  });
});
