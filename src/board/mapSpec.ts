import { TERRAIN_RESOURCE, isRed } from '../core/constants.js';
import { nextInt, shuffle } from '../core/rng.js';
import type { EdgeId, HarborState, HarborType, HexId, HexState, RngState, Terrain, VertexId } from '../core/types.js';
import {
  type Axial,
  DIR_NAMES,
  cornerVertex,
  edgeKey,
  edgeMidpoint,
  hexId,
  hexagon,
  neighbor,
  offsetToAxial,
  parseHexId,
  ring,
  sideEdge,
} from './hex.js';
import { buildTopology } from './topology.js';

/**
 * Scenario maps are data. A map is described by an ASCII grid of odd-r offset
 * rows (odd rows are shifted half a hex to the right) or by an explicit list of
 * cells. Each cell is one whitespace-separated token:
 *
 *   .      no hex (outside the frame)
 *   ~      sea
 *   h f p g m d $    hills, forest, pasture, fields, mountains, desert, gold
 *   x      fog (unexplored; revealed from the scenario's fog stack)
 *   ?      random terrain from the default pool;  ?b  random from pool "b"
 *
 * followed optionally by a number token (`m8`, `$10`) or `#` (random token from
 * the cell's pool), and optionally by `@zone` (`h5@home`, `p@tribe`).
 * Cells from `?` pools get a random token automatically if they produce.
 */

export interface PoolSpec {
  /** Terrain tiles shuffled onto the pool's `?` cells. */
  terrains: Partial<Record<Terrain, number>>;
  /** Number tokens shuffled onto the pool's producing cells (and its `#` cells). */
  tokens: readonly number[];
}

export interface CellSpec {
  q: number;
  r: number;
  terrain: Terrain | 'random';
  pool: string;
  token: number | 'random' | null;
  zone: string | null;
}

export interface HarborSpot {
  /** The sea hex the harbor sits in, as axial "q,r". */
  sea: HexId;
  /** The land hex it serves. */
  land: HexId;
  /** A harbor printed on the map; spots without a type draw one from the shuffled pool. */
  type?: HarborType;
}

export interface HarborSpec {
  /** Fixed spots, or 'auto' (well-spread coastal spots), or 'ring' (standard base frame). */
  spots: HarborSpot[] | 'auto' | 'ring';
  /** Harbor types shuffled onto the spots that have no printed type. */
  pool: readonly HarborType[];
  /** Restrict auto spots to coasts of these zones. */
  zones?: string[];
}

/** Hex sides, by the direction they face (pointy-top hexes, screen y down). */
export type SideName = (typeof DIR_NAMES)[number];
/** Hex corners: top (N), upper-right (NE), lower-right (SE), bottom (S), lower-left (SW), upper-left (NW). */
export type CornerName = 'N' | 'NE' | 'SE' | 'S' | 'SW' | 'NW';
/** `cornerVertex` index of each corner name. */
const CORNER_INDEX: Record<CornerName, number> = { NE: 0, N: 1, NW: 2, SW: 3, S: 4, SE: 5 };

/**
 * A spot printed on a scenario map (a village, a gift, a fortress, a marked
 * intersection...): a hex by odd-r offset "col,row", plus one of its corners
 * (an intersection) or sides (a path). Scenario hooks read them at set-up.
 */
export interface MapMark {
  at: string;
  corner?: CornerName;
  side?: SideName;
  value?: number;
}

/** Harbor on the `side` of the land hex at offset "col,row" (the sea hex is the neighbour on that side). */
export function harborAt(at: string, side: SideName, type?: HarborType): HarborSpot {
  const land = offsetAxial(at);
  const sea = neighbor(land, DIR_NAMES.indexOf(side));
  return { sea: hexId(sea.q, sea.r), land: hexId(land.q, land.r), ...(type ? { type } : {}) };
}

function offsetAxial(at: string): Axial {
  const [col, row] = at.split(',').map(Number);
  return offsetToAxial(col, row);
}

export function markHex(m: MapMark): HexId {
  const a = offsetAxial(m.at);
  return hexId(a.q, a.r);
}

export function markVertex(m: MapMark): VertexId {
  if (!m.corner) throw new Error(`map mark at ${m.at} has no corner`);
  return cornerVertex(offsetAxial(m.at), CORNER_INDEX[m.corner]);
}

export function markEdge(m: MapMark): EdgeId {
  if (!m.side) throw new Error(`map mark at ${m.at} has no side`);
  return sideEdge(offsetAxial(m.at), DIR_NAMES.indexOf(m.side));
}

export interface MapSpec {
  rows?: readonly string[];
  cells?: CellSpec[];
  /**
   * Procedural maps: builds the concrete map (cells with their tiles and
   * numbers, harbor spots, marks) from the game's RNG when the board is
   * generated (see board/generator.ts).
   */
  procedural?: (rng: RngState, rules: TokenRules) => MapSpec;
  /** On a map built by `procedural`: how many candidate maps it drew, and whether it fell back to the printed map. */
  generated?: { attempts: number; fallback: boolean };
  pools: Record<string, PoolSpec>;
  /** Harbors fixed by the map, or null when players place them during the game. */
  harbors: HarborSpec | null;
  /**
   * 'desert' = first desert (by id), 'token:N' = first land hex (by id) with
   * number token N, 'offboard', or an offset reference "col,row".
   */
  robber: 'desert' | 'offboard' | `token:${number}` | string;
  /** null disables the pirate; 'offboard' = enters on its first move. */
  pirate: 'offboard' | string | null;
  /** Hidden stack for fog hexes. */
  fog?: PoolSpec;
  /** Base 3-4 board supports the official A-R spiral. */
  spiral?: boolean;
  /** Scenario spots printed on the map, by kind (e.g. "village", "fortress"). */
  marks?: Record<string, MapMark[]>;
}

export interface TokenRules {
  noAdjacentRed: boolean;
  noAdjacent2and12: boolean;
  noAdjacentSameNumber: boolean;
}

export interface GeneratedMap {
  hexes: Record<HexId, HexState>;
  harbors: HarborState[];
  robber: HexId | null;
  pirate: HexId | null;
  /** Remaining fog stack (terrains and tokens) for scenario state. */
  fogStack?: { terrains: Terrain[]; tokens: number[] };
  /** The map's printed scenario spots, passed on to the scenario's `init` hook. */
  marks?: Record<string, MapMark[]>;
}

const TERRAIN_CODES: Record<string, Terrain> = {
  '~': 'sea',
  h: 'hills',
  f: 'forest',
  p: 'pasture',
  g: 'fields',
  m: 'mountains',
  d: 'desert',
  $: 'gold',
  x: 'fog',
};

const CELL_RE = /^(\?[a-z]?|[~hfpgmd$x.])(\d{1,2}|#)?(?:@([A-Za-z0-9_-]+))?$/;

export function parseRows(rows: readonly string[]): CellSpec[] {
  const cells: CellSpec[] = [];
  rows.forEach((line, row) => {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    tokens.forEach((tok, col) => {
      const m = CELL_RE.exec(tok);
      if (!m) throw new Error(`bad map cell "${tok}" at row ${row} col ${col}`);
      const [, t, num, zone] = m;
      if (t === '.') return;
      const { q, r } = offsetToAxial(col, row);
      if (t.startsWith('?')) {
        cells.push({ q, r, terrain: 'random', pool: t.slice(1) || 'default', token: 'random', zone: zone ?? null });
      } else {
        const terrain = TERRAIN_CODES[t];
        let token: CellSpec['token'] = null;
        if (num === '#') token = 'random';
        else if (num) token = Number(num);
        cells.push({ q, r, terrain, pool: 'default', token, zone: zone ?? null });
      }
    });
  });
  return cells;
}

export function isLandTerrain(t: Terrain): boolean {
  return t !== 'sea' && t !== 'fog';
}

export function isProducing(t: Terrain): boolean {
  return t === 'gold' || TERRAIN_RESOURCE[t] !== undefined;
}

export function expandTerrains(spec: Partial<Record<Terrain, number>>): Terrain[] {
  const out: Terrain[] = [];
  for (const [t, n] of Object.entries(spec)) for (let i = 0; i < (n ?? 0); i++) out.push(t as Terrain);
  return out;
}

/**
 * Checks the token-adjacency constraints between land hexes. With `only`, pairs
 * of two fixed (map-authored) tokens are exempt.
 */
export function tokensOk(hexes: Record<HexId, HexState>, rules: TokenRules, only?: Set<HexId>): boolean {
  for (const [id, h] of Object.entries(hexes)) {
    if (h.token === null) continue;
    const a = parseHexId(id);
    for (let i = 0; i < 3; i++) {
      // each unordered pair checked once
      const n = neighbor(a, i);
      const nid = hexId(n.q, n.r);
      const o = hexes[nid];
      if (!o || o.token === null) continue;
      if (only && !only.has(id) && !only.has(nid)) continue;
      if (rules.noAdjacentRed && isRed(h.token) && isRed(o.token)) return false;
      if (rules.noAdjacent2and12 && (h.token === 2 || h.token === 12) && (o.token === 2 || o.token === 12)) return false;
      if (rules.noAdjacentSameNumber && h.token === o.token) return false;
    }
  }
  return true;
}

/**
 * Builds a concrete board from a map spec: shuffles terrain pools, places
 * number tokens (respecting adjacency rules via rejection sampling), assigns
 * zones and harbors, and positions robber and pirate.
 */
export function generateMap(spec: MapSpec, rng: RngState, rules: TokenRules, useSpiral: boolean): GeneratedMap {
  if (spec.procedural) return generateMap(spec.procedural(rng, rules), rng, rules, useSpiral);
  const cells = spec.cells ?? parseRows(spec.rows ?? []);
  const hexes: Record<HexId, HexState> = {};

  // 1. terrain
  const byPool = new Map<string, CellSpec[]>();
  for (const c of cells) {
    if (c.terrain === 'random') {
      if (!byPool.has(c.pool)) byPool.set(c.pool, []);
      byPool.get(c.pool)!.push(c);
    }
  }
  const terrainOf = new Map<CellSpec, Terrain>();
  for (const [pool, poolCells] of byPool) {
    const p = spec.pools[pool];
    if (!p) throw new Error(`map uses undefined pool "${pool}"`);
    const tiles = shuffle(rng, expandTerrains(p.terrains));
    if (tiles.length < poolCells.length) {
      throw new Error(`pool "${pool}" has ${tiles.length} terrains for ${poolCells.length} cells`);
    }
    poolCells.forEach((c, i) => terrainOf.set(c, tiles[i]));
  }
  for (const c of cells) {
    const terrain = c.terrain === 'random' ? terrainOf.get(c)! : c.terrain;
    const id = hexId(c.q, c.r);
    if (hexes[id]) throw new Error(`duplicate hex ${id}`);
    hexes[id] = { q: c.q, r: c.r, terrain, token: typeof c.token === 'number' ? c.token : null, zone: c.zone };
  }
  validateFrame(hexes);

  // 2. number tokens
  const slotsByPool = new Map<string, HexId[]>();
  for (const c of cells) {
    const id = hexId(c.q, c.r);
    if (c.token === 'random' && isProducing(hexes[id].terrain)) {
      if (!slotsByPool.has(c.pool)) slotsByPool.set(c.pool, []);
      slotsByPool.get(c.pool)!.push(id);
    }
  }
  if (useSpiral && spec.spiral) {
    placeSpiral(hexes, rng);
  } else {
    placeRandomTokens(hexes, slotsByPool, spec.pools, rng, rules);
  }

  // 3. zones
  assignZones(hexes);

  // 4. harbors
  const harbors: HarborState[] = [];
  if (spec.harbors) {
    let spots: HarborSpot[];
    if (spec.harbors.spots === 'ring') spots = ringHarborSpots();
    else if (spec.harbors.spots === 'auto') spots = autoHarborSpots(hexes, spec.harbors.pool.length, spec.harbors.zones);
    else spots = spec.harbors.spots;
    // Printed harbors keep their type; the other spots take the shuffled pool in order.
    const types = spots.every((s) => s.type) ? [] : shuffle(rng, [...spec.harbors.pool]);
    let next = 0;
    for (const s of spots) {
      const type = s.type ?? types[next++];
      if (type) harbors.push({ edge: edgeKey(s.sea, s.land), type });
    }
  }

  // 5. robber / pirate
  const robber = resolvePosition(hexes, spec.robber, 'desert');
  const pirate = spec.pirate === null ? null : resolvePosition(hexes, spec.pirate, 'sea');

  const out: GeneratedMap = { hexes, harbors, robber, pirate };
  if (spec.marks) out.marks = spec.marks;
  if (spec.fog) {
    out.fogStack = {
      terrains: shuffle(rng, expandTerrains(spec.fog.terrains)),
      tokens: shuffle(rng, [...spec.fog.tokens]),
    };
  }
  return out;
}

function resolvePosition(hexes: Record<HexId, HexState>, where: string, kind: 'desert' | 'sea'): HexId | null {
  if (where === 'offboard') return null;
  if (where === 'desert') {
    const d = Object.keys(hexes)
      .sort()
      .find((id) => hexes[id].terrain === 'desert');
    return d ?? null;
  }
  if (where.startsWith('token:')) {
    const n = Number(where.slice('token:'.length));
    const h = Object.keys(hexes)
      .sort()
      .find((id) => hexes[id].token === n);
    if (!h) throw new Error(`no hex with number ${n} for the start position`);
    return h;
  }
  const [col, row] = where.split(',').map(Number);
  const a = offsetToAxial(col, row);
  const id = hexId(a.q, a.r);
  if (!hexes[id]) throw new Error(`position ${where} is not on the map`);
  if (kind === 'sea' && hexes[id].terrain !== 'sea') throw new Error(`pirate start ${where} is not sea`);
  return id;
}

/** Every land or fog hex must be fully surrounded by on-board hexes (the frame is sea). */
function validateFrame(hexes: Record<HexId, HexState>): void {
  for (const [id, h] of Object.entries(hexes)) {
    if (h.terrain === 'sea') continue;
    for (let i = 0; i < 6; i++) {
      const n = neighbor(h, i);
      if (!hexes[hexId(n.q, n.r)]) throw new Error(`land hex ${id} touches the edge of the map`);
    }
  }
}

function placeRandomTokens(
  hexes: Record<HexId, HexState>,
  slotsByPool: Map<string, HexId[]>,
  pools: Record<string, PoolSpec>,
  rng: RngState,
  rules: TokenRules,
): void {
  const pairs: Array<[HexId[], number[]]> = [];
  for (const [pool, slots] of slotsByPool) {
    const p = pools[pool];
    if (!p) throw new Error(`map uses undefined pool "${pool}"`);
    if (p.tokens.length < slots.length) {
      throw new Error(`pool "${pool}" has ${p.tokens.length} tokens for ${slots.length} producing hexes`);
    }
    pairs.push([slots, [...p.tokens]]);
  }
  const random = new Set(pairs.flatMap(([slots]) => slots));
  if (random.size === 0) return;
  const assign = () => {
    for (const [slots, tokens] of pairs) {
      shuffle(rng, tokens);
      slots.forEach((id, i) => (hexes[id].token = tokens[i]));
    }
  };
  // Rejection sampling; with standard token sets a valid layout appears quickly.
  for (let attempt = 0; attempt < 5000; attempt++) {
    assign();
    if (tokensOk(hexes, rules, random)) return;
  }
  // Fall back to a repair pass that swaps tokens between random slots.
  repairTokens(hexes, [...random], rng, rules);
}

function repairTokens(hexes: Record<HexId, HexState>, slots: HexId[], rng: RngState, rules: TokenRules): void {
  if (slots.length < 2) return;
  const only = new Set(slots);
  for (let i = 0; i < 20000 && !tokensOk(hexes, rules, only); i++) {
    const a = slots[nextInt(rng, slots.length)];
    const b = slots[nextInt(rng, slots.length)];
    const t = hexes[a].token;
    hexes[a].token = hexes[b].token;
    hexes[b].token = t;
  }
}

/**
 * Official variable setup: tokens A-R laid alphabetically from a random corner,
 * spiralling counter-clockwise toward the centre and skipping the desert.
 */
export function placeSpiral(hexes: Record<HexId, HexState>, rng: RngState, startCorner = nextInt(rng, 6)): void {
  const order = spiralOrder(startCorner);
  const tokens = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
  let i = 0;
  for (const a of order) {
    const h = hexes[hexId(a.q, a.r)];
    if (!h || !isProducing(h.terrain)) continue;
    h.token = tokens[i++];
  }
}

export function spiralOrder(startCorner: number): Axial[] {
  const origin = { q: 0, r: 0 };
  return [...ring(origin, 2, startCorner), ...ring(origin, 1, startCorner), origin];
}

/**
 * Standard base-game frame: 9 harbors on alternating sea hexes of the ring
 * around the island, starting at a corner. Corner sea hexes face the single
 * land hex they touch; side sea hexes face the land hex on the island's side.
 */
export function ringHarborSpots(): HarborSpot[] {
  const seas = ring({ q: 0, r: 0 }, 3, 0);
  const spots: HarborSpot[] = [];
  seas.forEach((s, i) => {
    if (i % 2 !== 0) return;
    const land: Axial[] = [];
    for (let d = 0; d < 6; d++) {
      const n = neighbor(s, d);
      if (Math.max(Math.abs(n.q), Math.abs(n.r), Math.abs(n.q + n.r)) <= 2) land.push(n);
    }
    let target = land[0];
    if (land.length > 1) {
      target = land.find((n) => n.q !== 0 && n.r !== 0 && n.q + n.r !== 0) ?? land[0];
    }
    spots.push({ sea: hexId(s.q, s.r), land: hexId(target.q, target.r) });
  });
  return spots;
}

/**
 * Deterministic, well-spread harbor spots: farthest-point sampling over
 * coastal edges of producing land, never letting two harbors share a vertex.
 */
export function autoHarborSpots(hexes: Record<HexId, HexState>, count: number, zones?: string[]): HarborSpot[] {
  const topo = buildTopology(Object.keys(hexes));
  const cands: Array<{ spot: HarborSpot; edge: EdgeId; x: number; y: number }> = [];
  for (const e of topo.edgeIds) {
    const [a, b] = topo.edgeHexes[e];
    const ta = hexes[a].terrain;
    const tb = hexes[b].terrain;
    let sea: HexId | null = null;
    let land: HexId | null = null;
    if (ta === 'sea' && isProducing(tb)) [sea, land] = [a, b];
    else if (tb === 'sea' && isProducing(ta)) [sea, land] = [b, a];
    if (!sea || !land) continue;
    if (zones && !zones.includes(hexes[land].zone ?? '')) continue;
    const m = edgeMidpoint(e);
    cands.push({ spot: { sea, land }, edge: e, x: m.x, y: m.y });
  }
  if (cands.length === 0) return [];
  const cx = cands.reduce((s, c) => s + c.x, 0) / cands.length;
  const cy = cands.reduce((s, c) => s + c.y, 0) / cands.length;
  const chosen: typeof cands = [];
  const first = [...cands].sort((p, q) => {
    const dp = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    const dq = (q.x - cx) ** 2 + (q.y - cy) ** 2;
    return dq - dp || (p.edge < q.edge ? -1 : 1);
  })[0];
  // Pass 1 keeps harbors at least one intersection apart; pass 2 only forbids shared vertices.
  for (const spacing of [true, false]) {
    const blocked = new Set<string>();
    const block = (c: (typeof cands)[number]) => {
      for (const v of topo.edgeVertices[c.edge]) {
        blocked.add(v);
        if (spacing) for (const n of topo.vertexNeighbors[v]) blocked.add(n);
      }
    };
    if (chosen.length === 0) chosen.push(first);
    chosen.forEach(block);
    while (chosen.length < count) {
      let best: (typeof cands)[number] | null = null;
      let bestD = -1;
      for (const c of cands) {
        if (chosen.includes(c)) continue;
        if (topo.edgeVertices[c.edge].some((v) => blocked.has(v))) continue;
        const d = Math.min(...chosen.map((o) => (o.x - c.x) ** 2 + (o.y - c.y) ** 2));
        if (d > bestD + 1e-9 || (Math.abs(d - bestD) < 1e-9 && best && c.edge < best.edge)) {
          best = c;
          bestD = d;
        }
      }
      if (!best) break;
      chosen.push(best);
      block(best);
    }
    if (chosen.length >= count) break;
  }
  return chosen.map((c) => c.spot);
}

/**
 * Zones: a hex keeps an explicit `@zone`; untagged land inherits the tag of its
 * connected island (if any tagged hex is in it), otherwise gets "island-N".
 */
export function assignZones(hexes: Record<HexId, HexState>): void {
  const ids = Object.keys(hexes).sort();
  const seen = new Set<HexId>();
  let n = 0;
  for (const start of ids) {
    if (seen.has(start) || !isLandTerrain(hexes[start].terrain)) continue;
    const comp: HexId[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      const a = parseHexId(id);
      for (let d = 0; d < 6; d++) {
        const nb = neighbor(a, d);
        const nid = hexId(nb.q, nb.r);
        if (!seen.has(nid) && hexes[nid] && isLandTerrain(hexes[nid].terrain)) {
          seen.add(nid);
          stack.push(nid);
        }
      }
    }
    comp.sort();
    const tagged = comp.find((id) => hexes[id].zone !== null);
    const label = tagged ? hexes[tagged].zone! : `island-${++n}`;
    for (const id of comp) if (hexes[id].zone === null) hexes[id].zone = label;
  }
}

// --- standard layouts ----------------------------------------------------------

/** Cells for a hexagonal island of the given row lengths, centred, with a sea ring. */
export function islandWithSeaRing(rowLengths: readonly number[], pool = 'default'): CellSpec[] {
  const cells: CellSpec[] = [];
  const land = new Set<HexId>();
  const rows = rowLengths.length;
  const r0 = -Math.floor(rows / 2);
  // doubled-width x: centred row positions; parity offset chosen from the first row
  const p = (((-(rowLengths[0] - 1) - r0) % 2) + 2) % 2;
  rowLengths.forEach((len, i) => {
    const r = r0 + i;
    for (let k = 0; k < len; k++) {
      const x = -(len - 1) + 2 * k;
      const q = (x - r - p) / 2;
      if (!Number.isInteger(q)) throw new Error('row lengths must alternate parity');
      land.add(hexId(q, r));
      cells.push({ q, r, terrain: 'random', pool, token: 'random', zone: null });
    }
  });
  for (const id of [...land]) {
    const a = parseHexId(id);
    for (let d = 0; d < 6; d++) {
      const n = neighbor(a, d);
      const nid = hexId(n.q, n.r);
      if (!land.has(nid) && !cells.some((c) => c.q === n.q && c.r === n.r)) {
        cells.push({ q: n.q, r: n.r, terrain: 'sea', pool, token: null, zone: null });
      }
    }
  }
  return cells;
}

/** The 19-hex base island (radius 2) inside a ring of 18 sea hexes. */
export function baseCells(): CellSpec[] {
  const cells: CellSpec[] = hexagon(2).map((a) => ({
    q: a.q,
    r: a.r,
    terrain: 'random' as const,
    pool: 'default',
    token: 'random' as const,
    zone: null,
  }));
  for (const a of ring({ q: 0, r: 0 }, 3)) {
    cells.push({ q: a.q, r: a.r, terrain: 'sea', pool: 'default', token: null, zone: null });
  }
  return cells;
}
