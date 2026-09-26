import { expect } from 'vitest';
import {
  applyAction,
  cornerVertex,
  createGame,
  edgeBetween,
  emptyCounts,
  registerScenario,
  rollDie,
  seafarersRules,
  sideEdge,
  topo,
  vertexKey,
  type Action,
  type EdgeId,
  type GameOptions,
  type GameState,
  type PartialCounts,
  type PlayerId,
  type VertexId,
} from '../src/index.js';

/** Corner i of hex (q,r): between direction i and i+1 (E, NE, NW, W, SW, SE). */
export const C = (q: number, r: number, i: number): VertexId => cornerVertex({ q, r }, i);
/** Side of hex (q,r) facing direction i. */
export const S = (q: number, r: number, i: number): EdgeId => sideEdge({ q, r }, i);
export const H = (q: number, r: number) => `${q},${r}`;
/** Vertex where three hexes meet. */
export const V = (a: [number, number], b: [number, number], c: [number, number]): VertexId =>
  vertexKey(H(...a), H(...b), H(...c));

/** Edges along a walk of adjacent vertices. */
export function trail(s: GameState, vs: VertexId[]): EdgeId[] {
  const t = topo(s);
  const out: EdgeId[] = [];
  for (let i = 1; i < vs.length; i++) {
    const e = edgeBetween(t, vs[i - 1], vs[i]);
    if (!e) throw new Error(`vertices not adjacent: ${vs[i - 1]} / ${vs[i]}`);
    out.push(e);
  }
  return out;
}

/** The six corners of a hex in order, closed back to the start. */
export function ringVertices(q: number, r: number): VertexId[] {
  return [0, 1, 2, 3, 4, 5, 0].map((i) => C(q, r, i));
}

/**
 * A game with setup skipped: player 0's turn 1, dice already rolled (main
 * phase), empty board, empty hands. Rule tests use fixed boards unless told
 * otherwise: the base game's variable set-up (the island centred on hex 0,0,
 * which base-game coordinates are written against) and the Seafarers
 * scenarios' rulebook maps.
 */
export function blank(
  scenario = 'base',
  players = 3,
  options: Partial<GameOptions> = {},
  seed: string | number = 'test',
): GameState {
  const layout = scenario === 'base' ? 'random' : 'official';
  const s = createGame({ scenario, players, seed, options: { firstPlayer: 0, layout, ...options } });
  s.turn.number = 1;
  s.turn.part = 1;
  s.turn.current = 0;
  s.turn.actor = 0;
  s.turn.role = 'active';
  s.turn.dice = [3, 4];
  s.phase = { kind: 'main' };
  return s;
}

export function give(s: GameState, p: PlayerId, c: PartialCounts): void {
  for (const [r, n] of Object.entries(c)) {
    const k = r as keyof typeof s.bank;
    s.bank[k] -= n!;
    s.players[p].resources[k] += n!;
  }
}

export function clearHand(s: GameState, p: PlayerId): void {
  for (const [r, n] of Object.entries(s.players[p].resources)) {
    s.bank[r as keyof typeof s.bank] += n;
  }
  s.players[p].resources = emptyCounts();
}

export function put(s: GameState, v: VertexId, p: PlayerId, type: 'settlement' | 'city' = 'settlement'): void {
  if (!topo(s).vertexEdges[v]) throw new Error(`no vertex ${v}`);
  s.board.buildings[v] = { owner: p, type };
  s.players[p].supply.settlements--;
  if (type === 'city') {
    s.players[p].supply.cities--;
    s.players[p].supply.settlements++;
  }
}

export function road(s: GameState, e: EdgeId | EdgeId[], p: PlayerId, type: 'road' | 'ship' = 'road'): void {
  for (const x of Array.isArray(e) ? e : [e]) {
    if (!topo(s).edgeHexes[x]) throw new Error(`no edge ${x}`);
    s.board.pieces[x] = { owner: p, type, placedPart: 0 };
    if (type === 'road') s.players[p].supply.roads--;
    else s.players[p].supply.ships--;
  }
}

export function ship(s: GameState, e: EdgeId | EdgeId[], p: PlayerId): void {
  road(s, e, p, 'ship');
}

/** Applies an action that must succeed. */
export function act(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type} failed: ${r.error}`);
  return r.state;
}

/** Applies an action that must fail; returns the error. */
export function fail(s: GameState, a: Action, match?: RegExp): string {
  const r = applyAction(s, a);
  expect(r.ok, `${a.type} should fail`).toBe(false);
  const err = (r as { error: string }).error;
  if (match) expect(err).toMatch(match);
  return err;
}

/** Forces the next two die rolls by picking an RNG state that produces them. */
export function withDice(s: GameState, d1: number, d2: number): GameState {
  for (let seed = 1; seed < 1_000_000; seed++) {
    const probe = { s: seed };
    if (rollDie(probe) === d1 && rollDie(probe) === d2) {
      s.rng = { s: seed };
      return s;
    }
  }
  throw new Error('no seed found');
}

/** Forces the next single die roll (e.g. a fortress battle). */
export function withNextDie(s: GameState, d: number): GameState {
  for (let seed = 1; seed < 1_000_000; seed++) {
    if (rollDie({ s: seed }) === d) {
      s.rng = { s: seed };
      return s;
    }
  }
  throw new Error('no seed found');
}

/** Marks a hex's terrain and token. */
export function setHex(s: GameState, q: number, r: number, terrain: GameState['board']['hexes'][string]['terrain'], token: number | null = null): void {
  const h = s.board.hexes[H(q, r)];
  if (!h) throw new Error(`no hex ${q},${r}`);
  h.terrain = terrain;
  h.token = token;
}

// --- a small, fully known Seafarers test map ------------------------------------

/**
 * "test-sea": a 7-hex island in open sea with a 1-hex islet to the east.
 *
 *   row0  ~  ~  ~  ~  ~  ~  ~  ~
 *   row1    ~  ~  f6 p8 ~  ~  ~  ~
 *   row2  ~  ~  h5 m9 g4 ~  ~  ~
 *   row3    ~  ~  f10 p3 ~  ~  g11 ~
 *   row4  ~  ~  ~  ~  ~  ~  ~  ~
 */
registerScenario({
  id: 'test-sea',
  name: 'Test sea',
  expansion: 'seafarers',
  description: 'test map',
  minPlayers: 2,
  maxPlayers: 6,
  victoryPoints: () => 10,
  map: () => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~',
      '~ ~ f6@home p8 ~ ~ ~ ~',
      '~ ~ h5 m9 g4 ~ ~ ~',
      '~ ~ f10 p3 ~ ~ g11 ~',
      '~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {},
    harbors: null,
    robber: 'offboard',
    pirate: 'offboard',
  }),
  bankSize: () => 19,
  devDeck: () => ({ knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 }),
  rules: seafarersRules(),
  hooks: {},
});
