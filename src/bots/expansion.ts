import type { EdgeId, GameState, PlayerId, VertexId } from '../core/types.js';
import { legalRoads, legalShips } from '../engine/placements.js';
import { longestRouteLength } from '../rules/longestRoute.js';
import {
  distanceRuleOk,
  edgeAllowsRoad,
  edgeAllowsShip,
  isBlockedVertex,
  topo,
  vertexTouchesLand,
  vertexZones,
} from '../rules/queries.js';
import { scenarioOf } from '../scenarios/registry.js';

/**
 * Target-driven roads and ships for the computer players.
 *
 * Every decision starts from the board as it is now: the settlement spots
 * that are still legal (distance rule, scenario zones, nobody's knight on
 * them), the scenario goals (Cloth villages, tribe gifts, the player's
 * fortress, fog to explore), and the shortest way to each from the
 * player's network: roads over land, ships over sea, switching only at its
 * own settlements and cities, never through another player's building,
 * knight, road or ship. A road or ship is worth building only if it shortens
 * the way to such a target; one that runs into an opponent's building,
 * closes a loop or leads where every spot is taken is worth nothing.
 * Targets an opponent can reach sooner count for less.
 *
 * Nothing is remembered between decisions, so a plan whose spot is taken
 * or cut off is dropped at once.
 */

export type EdgeKind = 'road' | 'ship';

const INF = 1 << 20;
const ROAD = 0;
const SHIP = 1;

interface Graph {
  vertices: VertexId[];
  vIndex: Map<VertexId, number>;
  edges: EdgeId[];
  eIndex: Map<EdgeId, number>;
  ea: Int32Array;
  eb: Int32Array;
  /** Edge indices at each vertex. */
  adj: number[][];
}

const graphs = new Map<string, Graph>();

function graphOf(s: GameState): Graph {
  const key = s.board.layoutKey;
  let g = graphs.get(key);
  if (g) return g;
  const t = topo(s);
  const vertices = t.vertexIds;
  const vIndex = new Map(vertices.map((v, i) => [v, i]));
  const edges = t.edgeIds;
  const eIndex = new Map(edges.map((e, i) => [e, i]));
  const ea = new Int32Array(edges.length);
  const eb = new Int32Array(edges.length);
  edges.forEach((e, i) => {
    const [a, b] = t.edgeVertices[e];
    ea[i] = vIndex.get(a)!;
    eb[i] = vIndex.get(b)!;
  });
  const adj = vertices.map((v) => t.vertexEdges[v].map((e) => eIndex.get(e)!));
  g = { vertices, vIndex, edges, eIndex, ea, eb, adj };
  graphs.set(key, g);
  return g;
}

/** The board as the searches see it, built once per decision. */
export interface Board {
  s: GameState;
  g: Graph;
  ships: boolean;
  /** Per edge: bit 1 a road may lie there, bit 2 a ship. */
  allow: Uint8Array;
  /** Per edge: the owner of the piece on it (-1: none) and its kind (ROAD/SHIP). */
  owner: Int8Array;
  kind: Int8Array;
  /** Per vertex: the owner of the building there (-1: none). */
  building: Int8Array;
  /** Per vertex: the owner of the knight there (-1: none; Cities & Knights). */
  knight: Int8Array;
}

export function boardOf(s: GameState): Board {
  const g = graphOf(s);
  const ships = scenarioOf(s).rules.ships;
  const allow = new Uint8Array(g.edges.length);
  const owner = new Int8Array(g.edges.length).fill(-1);
  const kind = new Int8Array(g.edges.length).fill(-1);
  g.edges.forEach((e, i) => {
    allow[i] = (edgeAllowsRoad(s, e) ? 1 : 0) | (ships && edgeAllowsShip(s, e) ? 2 : 0);
    const piece = s.board.pieces[e];
    if (piece) {
      owner[i] = piece.owner;
      kind[i] = piece.type === 'ship' ? SHIP : ROAD;
    }
  });
  const building = new Int8Array(g.vertices.length).fill(-1);
  for (const [v, b] of Object.entries(s.board.buildings)) {
    const i = g.vIndex.get(v);
    if (i !== undefined) building[i] = b.owner;
  }
  const knight = new Int8Array(g.vertices.length).fill(-1);
  for (const [v, k] of Object.entries(s.ck?.knights ?? {})) {
    const i = g.vIndex.get(v);
    if (i !== undefined) knight[i] = k.owner;
  }
  return { s, g, ships, allow, owner, kind, building, knight };
}

/** Another player's building or knight: a road or ship of `p` may end there but never pass. */
function blocked(b: Board, p: PlayerId, v: number): boolean {
  return (b.building[v] >= 0 && b.building[v] !== p) || (b.knight[v] >= 0 && b.knight[v] !== p);
}

/**
 * Pieces `p` still needs to reach each intersection, by road (index 2v) and
 * by ship (2v+1), from `sources` (state indices at distance 0). Its own
 * pieces cost nothing to follow; road and ship meet only at its buildings.
 */
function search(b: Board, p: PlayerId, sources: number[], maxDist: number): Int32Array {
  const { g } = b;
  const dist = new Int32Array(g.vertices.length * 2).fill(INF);
  const buckets: number[][] = [[]];
  for (const x of sources) {
    if (dist[x] === 0) continue;
    dist[x] = 0;
    buckets[0].push(x);
  }
  for (let d = 0; d < buckets.length; d++) {
    const list = buckets[d];
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (dist[x] !== d) continue;
      const v = x >> 1;
      const mode = x & 1;
      if (b.ships && b.building[v] === p) {
        const y = (v << 1) | (1 - mode);
        if (dist[y] > d) {
          dist[y] = d;
          list.push(y);
        }
      }
      const bit = mode === ROAD ? 1 : 2;
      for (const e of g.adj[v]) {
        if (!(b.allow[e] & bit)) continue;
        let cost = 1;
        if (b.owner[e] >= 0) {
          if (b.owner[e] !== p || b.kind[e] !== mode) continue;
          cost = 0;
        }
        const w = g.ea[e] === v ? g.eb[e] : g.ea[e];
        if (blocked(b, p, w)) continue;
        const nd = d + cost;
        if (nd > maxDist) continue;
        const y = (w << 1) | mode;
        if (nd < dist[y]) {
          dist[y] = nd;
          (buckets[nd] ??= []).push(y);
        }
      }
    }
  }
  return dist;
}

/** Where `p`'s network stands: its buildings, and the ends of its roads and ships that aren't cut off. */
function networkSources(b: Board, p: PlayerId): number[] {
  const { g } = b;
  const out: number[] = [];
  for (let v = 0; v < g.vertices.length; v++) {
    if (b.building[v] === p) {
      out.push(v << 1);
      if (b.ships) out.push((v << 1) | 1);
      continue;
    }
    if (blocked(b, p, v)) continue;
    for (const e of g.adj[v]) {
      if (b.owner[e] === p) out.push((v << 1) | b.kind[e]);
    }
  }
  return out;
}

const minDist = (d: Int32Array, v: number) => Math.min(d[v << 1], d[(v << 1) | 1]);

/** Could a settlement of `p` ever stand at `v` (ignoring the road connection)? */
export function openSpot(s: GameState, p: PlayerId, v: VertexId): boolean {
  if (!vertexTouchesLand(s, v) || isBlockedVertex(s, v) || !distanceRuleOk(s, v)) return false;
  const k = s.ck?.knights[v];
  if (k && k.owner !== p) return false;
  const sc = scenarioOf(s);
  if (vertexZones(s, v).some((z) => sc.rules.forbiddenZones.includes(z))) return false;
  return (sc.hooks.settlementAllowed?.(s, p, v, false) ?? null) === null;
}

export interface Target {
  vertex: VertexId;
  /** What it is worth to the player (a settlement spot's value, or a scenario goal's). */
  value: number;
  /** Pieces still needed to connect it. */
  dist: number;
  /** Pieces the nearest opponent needs (INF: none can reach it). */
  rival: number;
  /** The value after the race and the distance. */
  score: number;
  spot: boolean;
}

export interface EdgeOption {
  edge: EdgeId;
  kind: EdgeKind;
  /** The score of the best target it brings closer (0: none, a dead end). */
  gain: number;
  toward: VertexId | null;
  /** Pieces still needed to that target after this one. */
  left: number;
}

export interface ExpansionOptions {
  /** A settlement's value at `v` for the player. */
  value: (v: VertexId) => number;
  /** Scenario goals (Cloth villages, gifts, fortresses, fog) with their values. */
  goals?: Map<VertexId, number>;
  /** Score lost per piece still needed (0.75: a spot two pieces away counts 56%). */
  decay?: number;
  /** Weigh the race against the nearest opponent (easy: no). */
  race?: boolean;
  /** Targets further than this many pieces are ignored. */
  maxDist?: number;
  /** The pieces it may build: roads, and with Seafarers ships (default both). */
  kinds?: EdgeKind[];
}

export interface Expansion {
  board: Board;
  targets: Target[];
  options: EdgeOption[];
  /** The best option (null when no road or ship leads anywhere). */
  best: EdgeOption | null;
  /** Distances from the player's network (road/ship per vertex). */
  dist: Int32Array;
  /** Option lookup by `${kind}:${edge}`. */
  byEdge: Map<string, EdgeOption>;
}

/**
 * How much the race for a spot leaves of it: pieces `mine` against the
 * nearest rival's `theirs` (the player moves first on its own turn).
 */
export function raceFactor(mine: number, theirs: number): number {
  if (theirs >= INF) return 1;
  const lead = theirs - mine;
  if (lead >= 1) return 1;
  if (lead === 0) return 0.8;
  if (lead === -1) return 0.45;
  return 0.25;
}

/**
 * The player's expansion: every target with its distance and race, and every
 * legal road and ship with the target it brings closer.
 */
export function planExpansion(s: GameState, p: PlayerId, o: ExpansionOptions): Expansion {
  const board = boardOf(s);
  const { g } = board;
  const decay = o.decay ?? 0.75;
  const maxDist = o.maxDist ?? 8;
  const dist = search(board, p, networkSources(board, p), maxDist);
  const hasSettlement = s.players[p].supply.settlements > 0;
  const raw: Array<{ v: number; value: number; spot: boolean }> = [];
  for (let v = 0; v < g.vertices.length; v++) {
    if (minDist(dist, v) > maxDist) continue;
    const id = g.vertices[v];
    let value = 0;
    let spot = false;
    if (hasSettlement && openSpot(s, p, id)) {
      value = o.value(id);
      spot = true;
    }
    const goal = o.goals?.get(id) ?? 0;
    if (goal > value) {
      value = goal;
      spot = false;
    }
    if (value > 0) raw.push({ v, value, spot });
  }
  // the race: how soon the others reach each target
  const rivals: Int32Array[] = [];
  if (o.race !== false) {
    for (const pl of s.players) {
      if (pl.id === p || pl.supply.settlements <= 0) continue;
      rivals.push(search(board, pl.id, networkSources(board, pl.id), maxDist));
    }
  }
  const targets: Target[] = raw.map(({ v, value, spot }) => {
    const d = minDist(dist, v);
    const rival = spot ? Math.min(INF, ...rivals.map((r) => minDist(r, v))) : INF;
    return { vertex: g.vertices[v], value, dist: d, rival, score: value * raceFactor(d, rival) * decay ** d, spot };
  });
  targets.sort((a, b) => b.score - a.score);
  const tIndex = raw.map((x) => x.v);

  const options: EdgeOption[] = [];
  const kinds = o.kinds ?? ['road', 'ship'];
  const legal: Array<[EdgeId, EdgeKind]> = [];
  if (kinds.includes('road')) for (const e of legalRoads(s, p)) legal.push([e, 'road']);
  if (kinds.includes('ship') && board.ships) for (const e of legalShips(s, p)) legal.push([e, 'ship']);
  const scoreOf = new Map(targets.map((t) => [t.vertex, t]));
  for (const [edge, kind] of legal) {
    const e = g.eIndex.get(edge)!;
    const mode = kind === 'ship' ? SHIP : ROAD;
    const ends = [g.ea[e], g.eb[e]];
    const far = ends.filter((v) => dist[(v << 1) | mode] !== 0 && !blocked(board, p, v));
    let top = 0;
    let second = 0;
    let toward: VertexId | null = null;
    let left = 0;
    if (far.length > 0) {
      const from = search(board, p, far.map((v) => (v << 1) | mode), maxDist);
      tIndex.forEach((v, i) => {
        const now = minDist(dist, v);
        const after = Math.min(now, minDist(from, v));
        if (after >= now) return;
        const t = scoreOf.get(g.vertices[v])!;
        const sc = raw[i].value * raceFactor(after, t.rival) * decay ** after;
        if (sc > top) {
          second = top;
          top = sc;
          toward = g.vertices[v];
          left = after;
        } else if (sc > second) second = sc;
      });
    }
    options.push({ edge, kind, gain: top > 0 ? top + 0.1 * second : 0, toward, left });
  }
  options.sort((a, b) => b.gain - a.gain || (a.kind === 'road' ? -1 : 1));
  const best = options.length > 0 && options[0].gain > 0 ? options[0] : null;
  return { board, targets, options, best, dist, byEdge: new Map(options.map((x) => [`${x.kind}:${x.edge}`, x])) };
}

/** Route lengths before any new piece, per state (they are asked for every legal edge). */
const routeCache = new WeakMap<GameState, number[]>();

function routeLengths(s: GameState): number[] {
  let out = routeCache.get(s);
  if (!out) {
    out = s.players.map((x) => longestRouteLength(s, x.id));
    routeCache.set(s, out);
  }
  return out;
}

/**
 * What a road on `e` does for Longest Road (or the Longest Trade Route), in
 * VP: 2 when it takes the card, less the more pieces are still missing (it
 * counts up to two short), and up to 1.5 when it keeps the card from a rival
 * one piece behind or level; 0 when the card isn't realistically in play.
 */
export function routeValue(s: GameState, p: PlayerId, e: EdgeId, kind: EdgeKind): number {
  if (!scenarioOf(s).rules.longestRoute) return 0;
  const lengths = routeLengths(s);
  const before = lengths[p];
  const holder = s.longestRoute.holder;
  const others = Math.max(0, ...lengths.filter((_, q) => q !== p));
  // quick outs before the search: nothing to defend, or too far behind
  if (holder === p && others < before - 1) return 0;
  const need = Math.max(5, (holder === null || holder === p ? others : lengths[holder]) + 1);
  if (holder !== p && before + 1 < need - 2) return 0;
  const pieces = { ...s.board.pieces, [e]: { owner: p, type: kind, placedPart: 0 } };
  const after = longestRouteLength({ ...s, board: { ...s.board, pieces } }, p);
  if (after <= before) return 0;
  if (holder === p) return others >= before ? 1.5 : 1;
  if (after >= need) return 2;
  return need - after === 1 ? 1 : 0.6;
}

/** Edge kinds a scenario allows building. */
export function edgeKinds(s: GameState): EdgeKind[] {
  return scenarioOf(s).rules.ships ? ['road', 'ship'] : ['road'];
}
