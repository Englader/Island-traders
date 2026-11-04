import { TERRAIN_RESOURCE, pips } from '../core/constants.js';
import type { EdgeId, GameState, HexId, PlayerId, VertexId } from '../core/types.js';
import { legalRoads, legalShips } from '../engine/placements.js';
import { longestRouteLength } from '../rules/longestRoute.js';
import {
  distanceRuleOk,
  edgeAllowsRoad,
  edgeAllowsShip,
  isBlockedVertex,
  topo,
  totalVP,
  vertexLandHexes,
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
 *
 * Spots on sand (sandSpot) are worth nothing to plan toward. With
 * Seafarers, a ship that the engine lets move goes where a new ship would
 * do more for these targets than it does where it stands (planShipMove).
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

/** The pips a hex pays out (resources and gold; desert, sea, fog and unnumbered land pay nothing). */
export function hexPips(s: GameState, h: HexId): number {
  const hex = s.board.hexes[h];
  if (!hex || !(TERRAIN_RESOURCE[hex.terrain] || hex.terrain === 'gold')) return 0;
  return pips(hex.token);
}

/** The Seafarers island chits (VP) a settlement of `p` at `v` would earn: its first in a new area. */
export function islandChitsAt(s: GameState, p: PlayerId, v: VertexId): number {
  const bonus = scenarioOf(s).rules.islandBonus;
  if (!bonus || s.phase.kind === 'setup') return 0;
  const pl = s.players[p];
  const home = bonus.home === 'setup' ? pl.homeZones : bonus.home;
  return vertexZones(s, v).filter((z) => !home.includes(z) && !pl.bonusZones.includes(z)).length * bonus.vp;
}

/**
 * A spot on sand: its land is mostly or wholly desert (or other land that
 * pays nothing), it pays two pips or fewer, and neither a harbor nor island
 * chits make up for that. A settlement there is a VP for four cards and a
 * piece, and nothing more; the computer players build one only within two
 * VP of winning, and never plan roads or ships toward one.
 */
export function sandSpot(s: GameState, p: PlayerId, v: VertexId): boolean {
  const land = vertexLandHexes(s, v);
  let paying = 0;
  let n = 0;
  for (const h of land) {
    const x = hexPips(s, h);
    if (x > 0) paying++;
    n += x;
  }
  if (land.length - paying < Math.max(1, paying) || n > 2) return false;
  if (s.board.harbors.some((hb) => topo(s).edgeVertices[hb.edge].includes(v))) return false;
  return islandChitsAt(s, p, v) === 0;
}

/** Close enough to winning (two VP or less) that any settlement's VP is worth it. */
export function closeToWin(s: GameState, p: PlayerId): boolean {
  return totalVP(s, p) >= s.victoryTarget - 2;
}

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
  /** What a target at each intersection is worth (computed on demand), and the nearest rival's distance to it. */
  valueAt: (v: number) => { value: number; spot: boolean };
  rivalAt: (v: number) => number;
  decay: number;
  maxDist: number;
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
  const cache = new Map<number, { value: number; spot: boolean }>();
  const valueAt = (v: number) => {
    let out = cache.get(v);
    if (out) return out;
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
    out = { value, spot };
    cache.set(v, out);
    return out;
  };
  const raw: Array<{ v: number; value: number; spot: boolean }> = [];
  for (let v = 0; v < g.vertices.length; v++) {
    if (minDist(dist, v) > maxDist) continue;
    const t = valueAt(v);
    if (t.value > 0) raw.push({ v, ...t });
  }
  // the race: how soon the others reach each target
  const rivals: Int32Array[] = [];
  if (o.race !== false) {
    for (const pl of s.players) {
      if (pl.id === p || pl.supply.settlements <= 0) continue;
      rivals.push(search(board, pl.id, networkSources(board, pl.id), maxDist));
    }
  }
  const rivalAt = (v: number) => Math.min(INF, ...rivals.map((r) => minDist(r, v)));
  const targets: Target[] = raw.map(({ v, value, spot }) => {
    const d = minDist(dist, v);
    const rival = spot ? rivalAt(v) : INF;
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
  return { board, targets, options, best, dist, byEdge: new Map(options.map((x) => [`${x.kind}:${x.edge}`, x])), valueAt, rivalAt, decay, maxDist };
}

export interface ShipMove {
  from: EdgeId;
  to: EdgeId;
  /** What a ship at `to` would do for the player's targets, less what it does at `from` (planner gains). */
  gain: number;
}

/**
 * What a road or ship (`mode`) on edge `e` would gain, as planExpansion
 * scores an option: the best target it brings closer, plus a tenth of the
 * next, on the board `b` with the player's distances `dist`.
 */
function edgeGain(x: Expansion, b: Board, p: PlayerId, dist: Int32Array, e: number, mode: number): number {
  const g = b.g;
  const far = [g.ea[e], g.eb[e]].filter((v) => dist[(v << 1) | mode] !== 0 && !blocked(b, p, v));
  if (far.length === 0) return 0;
  const from = search(b, p, far.map((v) => (v << 1) | mode), x.maxDist);
  let top = 0;
  let second = 0;
  for (let v = 0; v < g.vertices.length; v++) {
    const now = minDist(dist, v);
    const after = minDist(from, v);
    if (after >= now) continue;
    const t = x.valueAt(v);
    if (t.value <= 0) continue;
    const sc = t.value * raceFactor(after, t.spot ? x.rivalAt(v) : INF) * x.decay ** after;
    if (sc > top) {
      second = top;
      top = sc;
    } else if (sc > second) second = sc;
  }
  return top > 0 ? top + 0.1 * second : 0;
}

/**
 * The ship move that does most for the player's plans (Seafarers: one ship a
 * turn, the open end of a route, see src/rules/ships.ts). With the ship
 * lifted, a ship where it stood and a ship where it could go are scored as
 * the planner scores a new one: the move is worth the difference, and it
 * costs no cards (a dead-end ship, which brings nothing closer, is worth
 * moving wherever a new ship would be worth building). `moves` are the
 * legal moves: the engine decides what may move where. Null when no move
 * gains at least `min`, or when the only ones that do would cost the player
 * Longest Trade Route (held, or within two ships of it).
 */
export function planShipMove(s: GameState, p: PlayerId, x: Expansion, moves: Array<{ from: EdgeId; to: EdgeId }>, min = 0.5): ShipMove | null {
  if (moves.length === 0) return null;
  const b = x.board;
  const g = b.g;
  // where a new ship would lead somewhere, best first (a ship moved anywhere else leads nowhere)
  const good = new Map<EdgeId, number>();
  for (const op of x.options) if (op.kind === 'ship' && op.gain > 0) good.set(op.edge, op.gain);
  const byFrom = new Map<EdgeId, EdgeId[]>();
  for (const m of moves) if (good.has(m.to)) byFrom.set(m.from, [...(byFrom.get(m.from) ?? []), m.to]);
  const found: ShipMove[] = [];
  for (const [from, tos] of byFrom) {
    const fi = g.eIndex.get(from)!;
    const owner = b.owner.slice();
    const kind = b.kind.slice();
    owner[fi] = -1;
    kind[fi] = -1;
    const lifted: Board = { ...b, owner, kind };
    const dist = search(lifted, p, networkSources(lifted, p), x.maxDist);
    const here = edgeGain(x, lifted, p, dist, fi, SHIP);
    for (const to of tos.sort((a, c) => good.get(c)! - good.get(a)!).slice(0, 8)) {
      const gain = edgeGain(x, lifted, p, dist, g.eIndex.get(to)!, SHIP) - here;
      if (gain >= min) found.push({ from, to, gain });
    }
  }
  found.sort((a, c) => c.gain - a.gain);
  return found.find((m) => !costsRoute(s, p, m)) ?? null;
}

/**
 * Would the move cost the player Longest Trade Route: shorten its route while
 * it holds the card with a rival within two of it, or while it is within two
 * pieces of taking it?
 */
function costsRoute(s: GameState, p: PlayerId, m: ShipMove): boolean {
  if (!scenarioOf(s).rules.longestRoute) return false;
  const before = longestRouteLength(s, p);
  const pieces = { ...s.board.pieces, [m.to]: s.board.pieces[m.from] };
  delete pieces[m.from];
  const after = longestRouteLength({ ...s, board: { ...s.board, pieces } }, p);
  if (after >= before) return false;
  const holder = s.longestRoute.holder;
  const others = Math.max(0, ...s.players.filter((q) => q.id !== p).map((q) => longestRouteLength(s, q.id)));
  if (holder === p) return after <= others + 2;
  const need = Math.max(5, (holder === null ? others : longestRouteLength(s, holder)) + 1);
  return before >= need - 2;
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
