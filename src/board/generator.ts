import { isRed, pips, TERRAIN_RESOURCE } from '../core/constants.js';
import { nextFloat, nextInt, seedRng, shuffle } from '../core/rng.js';
import type { HarborType, HexId, RngState, Terrain } from '../core/types.js';
import { DIR_NAMES, axialToOffset, cornerVertex, edgeKey, edgeMidpoint, hexId, neighbor, offsetToAxial, parseHexId, sideEdge } from './hex.js';
import {
  generateMap,
  isLandTerrain,
  isProducing,
  parseRows,
  type CellSpec,
  type CornerName,
  type HarborSpot,
  type MapMark,
  type MapSpec,
  type PoolSpec,
  type TokenRules,
} from './mapSpec.js';
import { getTopologyFor, layoutKeyFor, type Topology } from './topology.js';

/*
 * Procedural maps in the style of a scenario's printed map.
 *
 * The printed map is read as a template: its frame (which stays, so the board
 * fits the screen the same way), its islands (a home island of so many hexes,
 * outer islands of so many, the fog area, the desert line...), which tiles and
 * numbers each area holds, its harbors, and where the robber and pirate
 * start. A new map keeps all of that and redraws the rest from the seed:
 *
 * 1. The template may be mirrored (left-right, top-bottom) where the frame
 *    allows it.
 * 2. Islands of one area trade a hex (their total stays), then every island
 *    grows from a seed near where the printed one lies: a random, compact but
 *    irregular blob that keeps to its part of the map and at least one hex of
 *    sea from every other island. Zones the rules depend on stay as printed.
 * 3. Each area's tiles are dealt onto its hexes (gold only where the printed
 *    map has gold, and so on), avoiding clumps of one terrain.
 * 4. Each area's numbers are dealt by a small local search: no 6 next to an
 *    8 (the red-number rule), no equal numbers side by side, no intersection
 *    worth too many pips, and each island's share of pips close to fair.
 * 5. Scenario spots are placed by the scenario (gifts, villages) or kept with
 *    the parts of the map they belong to.
 * 6. Harbors go on coasts of the areas the printed ones serve, spread out by
 *    farthest-point sampling, never two on one intersection or on a spot.
 *
 * Every candidate is checked (starting placement fits, islands stay apart,
 * numbers and harbors as the template says, marks on valid spots); a failed
 * one is redrawn from the next sub-seed, each round keeping a little closer
 * to the printed shapes (tight frames need that), and after too many failures
 * the printed map is used with its tiles and numbers re-dealt. Everything
 * comes from the seed, so a preview, the game and every online guest see one
 * map.
 */

/** The starting-placement rules a new map must leave room for (a scenario's rules fit this). */
export interface StyleRules {
  setupZones: readonly string[] | null;
  forbiddenZones: readonly string[];
  setupRounds: readonly unknown[];
}

/** How a scenario's printed map becomes a template for new maps. */
export interface MapStyle {
  players: number;
  rules: StyleRules;
  /**
   * Zones whose shape the scenario's rules depend on: their hexes, and the
   * marks on them, stay as printed. Their tiles and numbers are re-dealt among
   * them; deserts and unnumbered tiles stay put.
   */
  fixedZones?: readonly string[];
  /**
   * The deserts of `zone` form a straight line that cuts the `beyond` zones
   * (strips, each a body of land touching the line) off from the rest of
   * `zone` (Through the Desert).
   */
  barrier?: { zone: string; beyond: readonly string[] };
  /** Places the scenario's spots on a new map (null: they do not fit, draw another map). */
  marks?: (map: DraftMap, rng: RngState) => Record<string, MapMark[]> | null;
  /** New World: no printed islands to follow, an archipelago of this many islands anywhere in the frame. */
  archipelago?: { islands: readonly [number, number] };
}

/** A new map before it becomes a map spec, for scenario mark placement. */
export interface DraftMap {
  hexes: Record<HexId, { terrain: Terrain; token: number | null; zone: string | null }>;
  topology: Topology;
  /** The islands (and the fog area) as lists of hexes, with their zone. */
  bodies: Array<{ zone: string | null; kind: BodyKind; cells: HexId[] }>;
}

type BodyKind = 'land' | 'fog' | 'barrier';

interface Body {
  kind: BodyKind;
  zone: string | null;
  /** Pool of tiles and numbers it is dealt from. */
  region: string;
  /** Printed hexes. */
  cells: HexId[];
  fixed: boolean;
  /** An islet printed inside the fog area (it may touch the fog). */
  inFog?: boolean;
  /** Smallest and largest size when the islands of an area trade hexes. */
  min: number;
  max: number;
  /** How compact it grows (higher: rounder). */
  compact: number;
}

interface Printed {
  terrain: Terrain;
  token: number | null;
  zone: string | null;
}

/** A printed map read as the template for new ones. */
interface Template {
  frame: HexId[];
  interior: Set<HexId>;
  printed: Record<HexId, Printed>;
  bodies: Body[];
  pools: Record<string, { terrains: Terrain[]; tokens: number[] }>;
  harbors: { printed: HarborSpot[]; types: HarborType[]; regions: string[] } | null;
  robber: string;
  pirate: HexId | 'offboard' | null;
  marks?: Record<string, MapMark[]>;
  fog?: PoolSpec;
  transforms: Transform[];
  grid: Grid;
  /** Growth guides per transform (see `guideFor`). */
  guides: Map<number, Guide>;
  /** Starting settlements the map must have room for. */
  seats: number;
}

/** Candidate maps drawn before falling back to the printed map. */
const ATTEMPTS = 60;

/**
 * A map spec for the scenario's random layout: a new map in the style of
 * `official`, built from the game's RNG when the board is generated. The
 * concrete spec it builds records in `generated` how many candidates it took.
 */
export function styledMap(official: MapSpec, style: MapStyle): MapSpec {
  return {
    ...official,
    procedural: (rng, rules) => {
      const template = templateFor(official, style);
      // One draw from the game's RNG picks the sub-seeds, so the rest of the set-up does not depend on retries.
      const base = nextInt(rng, 0x7fffffff);
      for (let i = 0; i < ATTEMPTS; i++) {
        const spec = attempt(template, style, seedRng(`${base}/${i}`), rules, i);
        if (spec) return { ...spec, generated: { attempts: i + 1, fallback: false } };
      }
      // No candidate passed: the printed map, its tiles and numbers re-dealt.
      const spec = attempt(template, style, seedRng(`${base}/fallback`), rules, -1) ?? { ...official, procedural: undefined };
      return { ...spec, generated: { attempts: ATTEMPTS, fallback: true } };
    },
  };
}

// --- template ---------------------------------------------------------------------

const templates = new WeakMap<MapSpec, Map<string, Template>>();

/** Templates are derived once per printed map and style. */
function templateFor(official: MapSpec, style: MapStyle): Template {
  let byStyle = templates.get(official);
  if (!byStyle) templates.set(official, (byStyle = new Map()));
  const key = JSON.stringify([style.players, style.fixedZones, style.barrier, style.archipelago, style.rules.setupRounds.length]);
  let t = byStyle.get(key);
  if (!t) byStyle.set(key, (t = deriveTemplate(official, style)));
  return t;
}

function deriveTemplate(official: MapSpec, style: MapStyle): Template {
  const cells = official.cells ?? parseRows(official.rows ?? []);
  const frame = cells.map((c) => hexId(c.q, c.r)).sort();
  const onBoard = new Set(frame);
  const interior = new Set(
    frame.filter((id) => {
      const a = parseHexId(id);
      return Array.from({ length: 6 }, (_, d) => neighbor(a, d)).every((n) => onBoard.has(hexId(n.q, n.r)));
    }),
  );
  const seats = style.players * style.rules.setupRounds.length;
  const transforms = frameTransforms(frame);

  if (style.archipelago) return archipelagoTemplate(official, frame, interior, seats, transforms);

  // Hexes the rulebook itself deals at random (New Shores' main island with
  // 5-6 players) are dealt once, from a fixed seed: the template only needs
  // which tiles and numbers their area holds.
  const dealt = cells.some((c) => c.terrain === 'random')
    ? generateMap({ ...official, procedural: undefined }, seedRng('template'), TEMPLATE_RULES, false).hexes
    : null;
  const printed: Record<HexId, Printed> = {};
  for (const c of cells) {
    const id = hexId(c.q, c.r);
    if (c.terrain === 'random') printed[id] = { terrain: dealt![id].terrain, token: dealt![id].token, zone: c.zone };
    else printed[id] = { terrain: c.terrain, token: typeof c.token === 'number' ? c.token : null, zone: c.zone };
  }
  const fixedZones = new Set(style.fixedZones ?? []);
  const kindOf = (p: Printed): BodyKind | null => {
    if (p.terrain === 'sea') return null;
    if (p.terrain === 'fog') return 'fog';
    if (style.barrier && p.terrain === 'desert' && p.zone === style.barrier.zone) return 'barrier';
    return 'land';
  };
  // bodies: connected hexes of one kind and zone
  const bodies: Body[] = [];
  const seen = new Set<HexId>();
  for (const id of frame) {
    const kind = kindOf(printed[id]);
    if (!kind || seen.has(id)) continue;
    const zone = printed[id].zone;
    const comp: HexId[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const n of neighbours(x)) {
        const p = printed[n];
        if (p && !seen.has(n) && kindOf(p) === kind && p.zone === zone) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    comp.sort();
    const fixed = kind !== 'fog' && zone !== null && fixedZones.has(zone);
    const region = kind === 'fog' ? 'fog' : kind === 'barrier' ? 'barrier' : fixed ? `fixed:${zone}` : (zone ?? 'isles');
    const inFog = kind === 'land' && comp.some((x) => neighbours(x).some((n) => printed[n]?.terrain === 'fog'));
    bodies.push({ kind, zone: kind === 'fog' ? null : zone, region, cells: comp, fixed, inFog, min: comp.length, max: comp.length, compact: compactness(comp) });
  }
  // Islands of an area with two or more may trade a hex.
  for (const b of bodies) {
    if (b.fixed || b.kind !== 'land' || b.cells.length < 2) continue;
    if (bodies.filter((o) => o.region === b.region && !o.fixed && o.kind === 'land').length < 2) continue;
    b.min = Math.max(2, b.cells.length - 1);
    b.max = b.cells.length + 1;
  }
  // pools: the region's tiles and numbers (fixed zones keep deserts and unnumbered tiles in place)
  const pools: Template['pools'] = {};
  for (const b of bodies) {
    if (b.kind !== 'land') continue;
    const pool = (pools[b.region] ??= { terrains: [], tokens: [] });
    for (const id of b.cells) {
      const p = printed[id];
      if (b.fixed && keptInPlace(p)) continue;
      pool.terrains.push(p.terrain);
      if (p.token !== null) pool.tokens.push(p.token);
    }
  }
  for (const [region, pool] of Object.entries(pools)) {
    const producing = pool.terrains.filter(isProducing).length;
    if (pool.tokens.length !== 0 && pool.tokens.length !== producing) {
      throw new Error(`area "${region}" mixes numbered and unnumbered tiles; list its zone in fixedZones`);
    }
  }
  let harbors: Template['harbors'] = null;
  if (official.harbors) {
    const spots = official.harbors.spots;
    if (!Array.isArray(spots)) throw new Error('a styled map needs printed harbor spots');
    const types = spots.every((s) => s.type) ? spots.map((s) => s.type!) : [...official.harbors.pool];
    const regionOf = new Map(bodies.flatMap((b) => b.cells.map((c) => [c, b.region] as const)));
    const regions = [...new Set(spots.map((s) => regionOf.get(s.land)!))].sort();
    // (a pool larger than the spots leaves some tokens in the box)
    harbors = { printed: spots, types, regions };
  }
  let robber = official.robber;
  if (robber !== 'desert' && robber !== 'offboard' && !robber.startsWith('token:')) {
    const p = printed[offsetHex(robber)];
    robber = p.terrain === 'desert' ? 'desert' : `token:${p.token}`;
  }
  const pirate = official.pirate === null || official.pirate === 'offboard' ? official.pirate : offsetHex(official.pirate);
  return { frame, interior, printed, bodies, pools, harbors, robber, pirate, marks: official.marks, fog: official.fog, transforms, grid: gridOf(frame, interior), guides: new Map(), seats };
}

/** Number rules for dealing a template's random hexes once (only their tiles and numbers matter). */
const TEMPLATE_RULES: TokenRules = { noAdjacentRed: true, noAdjacent2and12: false, noAdjacentSameNumber: false };

/** Deserts and unnumbered producing tiles of a fixed zone stay where they are printed. */
function keptInPlace(p: Printed): boolean {
  return p.terrain === 'desert' || (isProducing(p.terrain) && p.token === null) || !isLandTerrain(p.terrain);
}

/** New World: no printed islands, only the frame and the tiles and numbers to deal. */
function archipelagoTemplate(
  official: MapSpec,
  frame: HexId[],
  interior: Set<HexId>,
  seats: number,
  transforms: Transform[],
): Template {
  const pool = official.pools.default;
  const terrains = Object.entries(pool.terrains).flatMap(([t, n]) => (t === 'sea' ? [] : Array<Terrain>(n ?? 0).fill(t as Terrain)));
  const printed: Record<HexId, Printed> = {};
  for (const id of frame) printed[id] = { terrain: 'sea', token: null, zone: null };
  return {
    frame,
    interior,
    printed,
    bodies: [],
    pools: { isles: { terrains, tokens: [...pool.tokens] } },
    harbors: null,
    robber: official.robber,
    pirate: official.pirate === null || official.pirate === 'offboard' ? official.pirate : offsetHex(official.pirate),
    transforms,
    grid: gridOf(frame, interior),
    guides: new Map(),
    seats,
  };
}

/** Average number of same-island neighbours per hex. */
function compactness(cells: HexId[]): number {
  const set = new Set(cells);
  let links = 0;
  for (const c of cells) for (const n of neighbours(c)) if (set.has(n)) links++;
  return links / cells.length;
}

// --- symmetries of the frame ------------------------------------------------------

/** A mirror of the board: hexes, directions (sides) and corners. */
interface Transform {
  hex(id: HexId): HexId;
  dir(d: number): number;
  corner(c: number): number;
  /** Mirrors reverse the sense of rotation. */
  flips: boolean;
}

const IDENTITY: Transform = { hex: (id) => id, dir: (d) => d, corner: (c) => c, flips: false };

/** Identity plus the left-right, top-bottom and half-turn mirrors that map the frame onto itself. */
function frameTransforms(frame: HexId[]): Transform[] {
  const pts = frame.map((id) => {
    const a = parseHexId(id);
    return { x: 2 * a.q + a.r, y: a.r };
  });
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const set = new Set(frame);
  const out: Transform[] = [IDENTITY];
  for (const [sx, sy] of [
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const ax = sx < 0 ? minX + maxX : 0;
    const ay = sy < 0 ? minY + maxY : 0;
    const map = (id: HexId): HexId | null => {
      const a = parseHexId(id);
      const x = sx * (2 * a.q + a.r) + ax;
      const y = sy * a.r + ay;
      if ((((x - y) % 2) + 2) % 2 !== 0) return null;
      return hexId((x - y) / 2, y);
    };
    if (!frame.every((id) => set.has(map(id) ?? ''))) continue;
    const dirX = (d: number) => (sx < 0 ? (9 - d) % 6 : d); // E<->W, NE<->NW, SE<->SW
    const dirY = (d: number) => (sy < 0 ? (6 - d) % 6 : d); // NE<->SE, NW<->SW
    const cornerX = (c: number) => (sx < 0 ? (8 - c) % 6 : c);
    const cornerY = (c: number) => (sy < 0 ? (11 - c) % 6 : c);
    out.push({
      hex: (id) => map(id)!,
      dir: (d) => dirY(dirX(d)),
      corner: (c) => cornerY(cornerX(c)),
      flips: sx * sy < 0,
    });
  }
  return out;
}

const CORNER_NAMES: CornerName[] = ['NE', 'N', 'NW', 'SW', 'S', 'SE'];

function offsetHex(at: string): HexId {
  const [col, row] = at.split(',').map(Number);
  const a = offsetToAxial(col, row);
  return hexId(a.q, a.r);
}

function offsetOf(id: HexId): string {
  const { col, row } = axialToOffset(parseHexId(id));
  return `${col},${row}`;
}

/** The intersection a corner mark names. */
function markCorner(m: MapMark): string {
  return cornerVertex(parseHexId(offsetHex(m.at)), CORNER_NAMES.indexOf(m.corner!));
}

function transformMark(m: MapMark, tf: Transform): MapMark {
  const out: MapMark = { at: offsetOf(tf.hex(offsetHex(m.at))) };
  if (m.corner) out.corner = CORNER_NAMES[tf.corner(CORNER_NAMES.indexOf(m.corner))];
  if (m.side) out.side = DIR_NAMES[tf.dir(DIR_NAMES.indexOf(m.side))];
  if (m.value !== undefined) out.value = m.value;
  return out;
}

function transformMarks(marks: Record<string, MapMark[]>, tf: Transform): Record<string, MapMark[]> {
  const out: Record<string, MapMark[]> = {};
  for (const [kind, list] of Object.entries(marks)) {
    let moved = list.map((m) => transformMark(m, tf));
    // A circuit sailed clockwise stays clockwise in a mirror: same start, reversed order.
    if (kind === 'circuit' && tf.flips && moved.length > 1) moved = [moved[0], ...moved.slice(1).reverse()];
    out[kind] = moved;
  }
  return out;
}

// --- one candidate map ------------------------------------------------------------

interface Hex {
  terrain: Terrain;
  token: number | null;
  zone: string | null;
  body: number;
}

/**
 * One candidate map (`round` 0, 1, ...: each round keeps a little closer to
 * the printed shapes, so tight frames still find room; -1: the printed map
 * re-dealt).
 */
function attempt(t: Template, style: MapStyle, rng: RngState, rules: TokenRules, round: number): MapSpec | null {
  const fallback = round < 0;
  const pull = PULL * (1 + Math.max(0, round) / 3);
  const tfIndex = fallback ? 0 : nextInt(rng, t.transforms.length);
  const tf = t.transforms[tfIndex];
  const bodies: Body[] = t.bodies.map((b) => ({ ...b, cells: b.cells.map(tf.hex).sort() }));
  const printed: Record<HexId, Printed> = {};
  for (const [id, p] of Object.entries(t.printed)) printed[tf.hex(id)] = p;

  // 1. shape
  let owner: Map<HexId, number> | null;
  if (fallback) {
    owner = new Map(bodies.flatMap((b, i) => b.cells.map((c) => [c, i] as const)));
  } else if (style.archipelago) {
    const land = t.pools.isles.terrains.length;
    const [lo, hi] = style.archipelago.islands;
    const k = lo + nextInt(rng, hi - lo + 1);
    const sizes = Array<number>(k).fill(2);
    for (let left = land - 2 * k; left > 0; left--) sizes[nextInt(rng, 10) < 4 ? 0 : nextInt(rng, k)]++;
    sizes.sort((a, b) => b - a);
    for (const size of sizes) {
      bodies.push({ kind: 'land', zone: null, region: 'isles', cells: [], fixed: false, min: size, max: size, compact: 3 });
    }
    owner = grow(t, bodies, sizes, rng, style, pull, guideFor(t, tfIndex, bodies));
  } else {
    owner = grow(t, bodies, jitterSizes(bodies, rng), rng, style, pull, guideFor(t, tfIndex, bodies));
  }
  if (!owner) return null;
  const members: HexId[][] = bodies.map(() => []);
  for (const [id, b] of owner) members[b].push(id);
  members.forEach((m) => m.sort());

  // 2. tiles, per area
  const hexes: Record<HexId, Hex> = {};
  for (const id of t.frame) hexes[id] = { terrain: 'sea', token: null, zone: null, body: -1 };
  const slots = new Map<string, HexId[]>();
  bodies.forEach((b, i) => {
    for (const id of members[i]) {
      const h = hexes[id];
      h.body = i;
      h.zone = b.kind === 'fog' ? null : b.zone;
      if (b.kind === 'fog') h.terrain = 'fog';
      else if (b.kind === 'barrier') h.terrain = 'desert';
      else if (b.fixed && keptInPlace(printed[id])) {
        h.terrain = printed[id].terrain;
        h.token = printed[id].token;
      } else {
        if (!slots.has(b.region)) slots.set(b.region, []);
        slots.get(b.region)!.push(id);
      }
    }
  });
  const regions = [...slots.keys()].sort();
  for (const region of regions) dealTerrains(hexes, slots.get(region)!, t.pools[region].terrains, members, rng);

  // 3. numbers, per area
  for (const region of regions) {
    const pool = t.pools[region].tokens;
    if (pool.length === 0) continue;
    const cells = slots.get(region)!.filter((id) => isProducing(hexes[id].terrain));
    if (cells.length !== pool.length) return null;
    if (!dealTokens(hexes, cells, pool, members, rng, rules)) return null;
  }

  const topology = getTopologyFor(layoutKeyFor(t.frame));

  // 4. scenario spots
  let marks = t.marks ? transformMarks(t.marks, tf) : undefined;
  if (style.marks && !fallback) {
    const draft: DraftMap = {
      hexes,
      topology,
      bodies: bodies.map((b, i) => ({ zone: b.zone, kind: b.kind, cells: members[i] })),
    };
    const own = style.marks(draft, rng);
    if (!own) return null;
    marks = { ...(marks ?? {}), ...own };
  }

  // 5. harbors, never on a scenario spot
  let spots: HarborSpot[] | null = null;
  if (t.harbors) {
    const types = shuffle(rng, [...t.harbors.types]).slice(0, t.harbors.printed.length);
    if (fallback) {
      spots = t.harbors.printed.map((s, i) => ({ sea: s.sea, land: s.land, type: s.type ?? types[i] }));
    } else {
      const reserved = new Set<string>();
      for (const list of Object.values(marks ?? {})) for (const m of list) if (m.corner) reserved.add(markCorner(m));
      const picked = placeHarbors(hexes, topology, bodies, t.harbors.regions, types.length, reserved, rng);
      if (!picked) return null;
      spots = picked.map((s, i) => ({ ...s, type: types[i] }));
    }
  }

  // 6. robber and pirate
  if (t.robber === 'desert' && !Object.values(hexes).some((h) => h.terrain === 'desert')) return null;
  if (t.robber.startsWith('token:') && !Object.values(hexes).some((h) => h.token === Number(t.robber.slice(6)))) return null;
  let pirate: string | null = null;
  if (t.pirate === 'offboard') pirate = 'offboard';
  else if (t.pirate) {
    const sea = nearestSea(hexes, tf.hex(t.pirate));
    if (!sea) return null;
    pirate = offsetOf(sea);
  }

  if (!valid(t, style, hexes, topology, bodies, members, spots, marks)) return null;

  const cells: CellSpec[] = t.frame.map((id) => {
    const a = parseHexId(id);
    const h = hexes[id];
    return { q: a.q, r: a.r, terrain: h.terrain, pool: 'default', token: h.token, zone: h.zone };
  });
  const spec: MapSpec = {
    cells,
    pools: {},
    harbors: spots ? { spots, pool: [] } : null,
    robber: t.robber,
    pirate,
  };
  if (marks) spec.marks = marks;
  if (t.fog) spec.fog = t.fog;
  return spec;
}

/**
 * Islands of a new map keep a sea hex apart, except the desert line and the
 * land it joins, and the fog area and the islets printed inside it.
 */
function mayTouch(a: Body, b: Body, style: MapStyle): boolean {
  if (a.kind === 'barrier' || b.kind === 'barrier') {
    const [x, y] = a.kind === 'barrier' ? [a, b] : [b, a];
    const zone = y.zone ?? '';
    return x.kind === 'barrier' && y.kind === 'land' && (zone === style.barrier?.zone || !!style.barrier?.beyond.includes(zone));
  }
  return (a.kind === 'fog' && !!b.inFog) || (b.kind === 'fog' && !!a.inFog);
}

function neighbours(id: HexId): HexId[] {
  const a = parseHexId(id);
  return Array.from({ length: 6 }, (_, d) => {
    const n = neighbor(a, d);
    return hexId(n.q, n.r);
  });
}

/** Outer islands of one area trade hexes; the area's total stays the same. */
function jitterSizes(bodies: Body[], rng: RngState): number[] {
  const sizes = bodies.map((b) => b.cells.length);
  const open = bodies.map((_, i) => i).filter((i) => bodies[i].max > bodies[i].min);
  if (open.length < 2) return sizes;
  for (let k = 0; k < 3; k++) {
    const from = open[nextInt(rng, open.length)];
    const to = open[nextInt(rng, open.length)];
    if (from === to || bodies[from].region !== bodies[to].region) continue;
    if (sizes[from] - 1 < bodies[from].min || sizes[to] + 1 > bodies[to].max) continue;
    sizes[from]--;
    sizes[to]++;
  }
  return sizes;
}

// --- growing islands --------------------------------------------------------------

/** Times the smaller islands are placed again before a candidate map is given up. */
const RETRIES = 6;
/** How strongly a growing island keeps to its printed place (per hex away; it grows with each round). */
const PULL = 1.2;
/** How round islands grow, per neighbour of their own, relative to how compact the printed one is. */
const BEND = 0.4;
/** Extra pull away from hexes nearer to another island's printed place. */
const TERRITORY = 1;

/** The frame's hexes numbered, with their neighbours, for growing islands quickly. */
interface Grid {
  ids: HexId[];
  index: Map<HexId, number>;
  nbrs: number[][];
  /** 1 where land may go (all six neighbours on the board). */
  interior: Uint8Array;
}

function gridOf(frame: HexId[], interior: Set<HexId>): Grid {
  const index = new Map(frame.map((id, i) => [id, i]));
  return {
    ids: frame,
    index,
    nbrs: frame.map((id) => neighbours(id).filter((n) => index.has(n)).map((n) => index.get(n)!)),
    interior: Uint8Array.from(frame, (id) => (interior.has(id) ? 1 : 0)),
  };
}

/**
 * Grows every island (and the fog area) inside the frame: fixed ones as
 * printed, then the others one by one, largest first, each from a seed near
 * its printed place and one hex at a time. A hex is open to an island when it
 * lies inside the frame, is free, and is not next to another island (unless
 * the two belong together, like the desert line and the land on both sides of
 * it).
 */
function grow(
  t: Template,
  bodies: Body[],
  sizes: number[],
  rng: RngState,
  style: MapStyle,
  strength: number,
  guide: Guide,
): Map<HexId, number> | null {
  const { ids, index, nbrs, interior } = t.grid;
  const n = ids.length;
  const nb = bodies.length;
  const owner = new Int32Array(n).fill(-1);
  // which islands may touch: the desert line and the land on both sides of
  // it, and the fog area and the islets printed inside it
  const touch = new Uint8Array(nb * nb);
  for (let a = 0; a < nb; a++) {
    for (let b = 0; b < nb; b++) touch[a * nb + b] = mayTouch(bodies[a], bodies[b], style) ? 1 : 0;
  }
  const open = (i: number, b: number): boolean => {
    if (!interior[i] || owner[i] >= 0) return false;
    for (const x of nbrs[i]) {
      const o = owner[x];
      if (o >= 0 && o !== b && !touch[b * nb + o]) return false;
    }
    return true;
  };
  const { affinity, cores } = guide;
  const aff = (b: number, i: number) => affinity[b]?.[i] ?? 0;

  bodies.forEach((b, i) => {
    if (b.fixed) for (const c of b.cells) owner[index.get(c)!] = i;
  });

  /** Grows island b from `seed` to its size. */
  const growFrom = (b: number, seed: number): boolean => {
    const pull = bodies[b].cells.length ? strength : 0;
    const bend = BEND * bodies[b].compact;
    owner[seed] = b;
    const frontier: number[] = [];
    const listed = new Uint8Array(n);
    const reach = (c: number) => {
      for (const x of nbrs[c]) {
        if (!listed[x] && open(x, b)) {
          listed[x] = 1;
          frontier.push(x);
        }
      }
    };
    reach(seed);
    for (let size = 1; size < sizes[b]; size++) {
      if (frontier.length === 0) return false;
      // compact islands prefer hexes with more neighbours of their own; all prefer their printed place
      const weights = frontier.map((x) => {
        let own = 0;
        for (const y of nbrs[x]) if (owner[y] === b) own++;
        return Math.exp(bend * (own - 1) - pull * aff(b, x));
      });
      const k = weightedPick(weights, rng);
      const next = frontier[k];
      frontier.splice(k, 1);
      owner[next] = b;
      reach(next);
    }
    return true;
  };
  /**
   * Seeds (near its printed place when possible) and grows island b. Only
   * seeds in a pocket of open hexes big enough for the island qualify, so the
   * growth cannot get boxed in (other islands decide what is open, not b).
   */
  const place = (b: number, cands: readonly number[]): boolean => {
    const pocket = new Int32Array(n);
    for (const start of cands) {
      if (pocket[start] || !open(start, b)) continue;
      const seen = [start];
      pocket[start] = -1;
      for (let i = 0; i < seen.length; i++) {
        for (const x of nbrs[seen[i]]) {
          if (!pocket[x] && open(x, b)) {
            pocket[x] = -1;
            seen.push(x);
          }
        }
      }
      for (const c of seen) pocket[c] = seen.length;
    }
    const roomy = cands.filter((i) => pocket[i] >= sizes[b]);
    // big islands start from the heart of their printed shape, small ones anywhere near it
    const core = cores[b];
    if (core && sizes[b] >= 7) {
      const pick = roomy.filter((i) => core[i]);
      if (pick.length) return growFrom(b, pick[nextInt(rng, pick.length)]);
    }
    for (const limit of [1, 2, Infinity]) {
      const pick = roomy.filter((i) => aff(b, i) <= limit);
      if (pick.length) return growFrom(b, pick[nextInt(rng, pick.length)]);
    }
    return false;
  };
  const all = ids.map((_, i) => i);

  const free = bodies.map((_, i) => i).filter((i) => !bodies[i].fixed);
  const placed = new Set<number>();
  // the desert line, then the strips beyond it and the land before it
  const barrier = free.find((i) => bodies[i].kind === 'barrier');
  if (barrier !== undefined) {
    const strips = free.filter((i) => bodies[i].kind === 'land' && style.barrier!.beyond.includes(bodies[i].zone ?? ''));
    const home = free.find((i) => bodies[i].kind === 'land' && bodies[i].zone === style.barrier!.zone);
    if (strips.length === 0 || home === undefined) throw new Error('a barrier needs land on both sides');
    // a straight line as long as the printed one (centred on hex a)
    const length = bodies[barrier].cells.length;
    const from = -Math.floor((length - 1) / 2);
    const lines: number[][] = [];
    for (const i of all) {
      if (aff(barrier, i) > 1) continue;
      const a = parseHexId(ids[i]);
      for (let d = 0; d < 3; d++) {
        const step = neighbor({ q: 0, r: 0 }, d);
        const line = Array.from({ length }, (_, k) => index.get(hexId(a.q + (from + k) * step.q, a.r + (from + k) * step.r)) ?? -1);
        if (line.every((c) => c >= 0 && aff(barrier, c) <= 1 && open(c, barrier))) lines.push(line);
      }
    }
    if (lines.length === 0) return null;
    const line = lines[nextInt(rng, lines.length)];
    for (const c of line) owner[c] = barrier;
    // each strip starts next to the line, on the side where it is printed
    const shore = [...new Set(line.flatMap((c) => nbrs[c]))].sort((a, b) => a - b);
    for (const strip of strips) {
      const cands = shore.filter((c) => open(c, strip));
      if (cands.length === 0) return null;
      const best = Math.min(...cands.map((c) => aff(strip, c)));
      if (!place(strip, cands.filter((c) => aff(strip, c) <= best + 1))) return null;
      placed.add(strip);
    }
    // the rest of the area grows from its heart and must reach the line
    if (!place(home, all)) return null;
    if (!shore.some((c) => owner[c] === home)) return null;
    placed.add(barrier).add(home);
  }
  // Largest first. When a smaller island finds no room, the smaller ones are
  // taken back and placed again (the frames are tight), keeping the largest.
  const order = free.filter((i) => !placed.has(i)).sort((a, b) => sizes[b] - sizes[a] || a - b);
  const keep = barrier === undefined ? 1 : 0;
  for (const b of order.slice(0, keep)) if (!place(b, all)) return null;
  const rest = order.slice(keep);
  let done = false;
  for (let k = 0; k < RETRIES && !done; k++) {
    done = rest.every((b) => place(b, all));
    if (!done) for (let i = 0; i < n; i++) if (rest.includes(owner[i])) owner[i] = -1;
  }
  if (!done) return null;

  // all sea (and fog) must be one open sea: no lakes
  const wet = (i: number) => owner[i] < 0 || bodies[owner[i]].kind === 'fog';
  const reached = new Uint8Array(n);
  const stack = all.filter((i) => !interior[i]);
  for (const i of stack) reached[i] = 1;
  while (stack.length) {
    const x = stack.pop()!;
    for (const y of nbrs[x]) {
      if (reached[y] || !wet(y)) continue;
      reached[y] = 1;
      stack.push(y);
    }
  }
  if (all.some((i) => wet(i) && !reached[i])) return null;
  const out = new Map<HexId, number>();
  for (let i = 0; i < n; i++) if (owner[i] >= 0) out.set(ids[i], owner[i]);
  return out;
}

/** Where each island is printed, for growing a new one (per mirror of the template). */
interface Guide {
  /**
   * How far each hex is from the island's printed place, plus a penalty where
   * another island's printed place is nearer: each keeps to its own part of the map.
   */
  affinity: Array<Float64Array | null>;
  /** The printed hexes farthest from the printed coast (big islands start there). */
  cores: Array<Uint8Array | null>;
}

function guideFor(t: Template, tfIndex: number, bodies: Body[]): Guide {
  let g = t.guides.get(tfIndex);
  if (g) return g;
  const { ids, index } = t.grid;
  const printedAt = bodies.map((b) => (b.cells.length ? distances(t.grid, b.cells.map((c) => index.get(c)!)) : null));
  const affinity = bodies.map((b, i) => {
    const own = printedAt[i];
    if (!own || b.fixed) return null;
    return Float64Array.from(ids, (_, x) => {
      let other = 99;
      printedAt.forEach((m, j) => {
        if (m && j !== i) other = Math.min(other, m[x]);
      });
      return own[x] + TERRITORY * Math.max(0, own[x] - other);
    });
  });
  const cores = bodies.map((b) => {
    if (b.fixed || b.cells.length === 0) return null;
    const printed = new Set(b.cells.map((c) => index.get(c)!));
    const depth = distances(t.grid, ids.map((_, i) => i).filter((i) => !printed.has(i)));
    const deepest = Math.max(...[...printed].map((i) => depth[i]));
    return Uint8Array.from(ids, (_, i) => (printed.has(i) && depth[i] === deepest ? 1 : 0));
  });
  g = { affinity, cores };
  t.guides.set(tfIndex, g);
  return g;
}

/** Hex distance from `cells`, walking over the frame (99: out of reach). */
function distances(grid: Grid, cells: number[]): Int32Array {
  const d = new Int32Array(grid.ids.length).fill(99);
  const queue = [...cells];
  for (const c of cells) d[c] = 0;
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i];
    for (const y of grid.nbrs[x]) {
      if (d[y] <= d[x] + 1) continue;
      d[y] = d[x] + 1;
      queue.push(y);
    }
  }
  return d;
}

function weightedPick(weights: number[], rng: RngState): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = nextFloat(rng) * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

// --- tiles and numbers ------------------------------------------------------------

/**
 * A deal's cost as a sum of small terms, each depending on a few of the
 * area's hexes, so a swap is scored by re-evaluating only the terms it touches.
 */
class Score {
  readonly terms: Array<() => number> = [];
  readonly termsOf: number[][];
  constructor(n: number) {
    this.termsOf = Array.from({ length: n }, () => []);
  }
  add(cells: readonly number[], term: () => number): void {
    const k = this.terms.push(term) - 1;
    for (const i of new Set(cells)) this.termsOf[i].push(k);
  }
  total(): number {
    return this.terms.reduce((s, f) => s + f(), 0);
  }
}

/**
 * Improves a deal (one value per area hex) by random swaps that do not raise
 * its cost; returns the final cost.
 */
function improve<T>(values: T[], score: Score, rng: RngState, rounds: number): number {
  let current = score.total();
  const n = values.length;
  const mark = new Int32Array(score.terms.length).fill(-1);
  for (let k = 0; k < rounds && current > 0 && n > 1; k++) {
    const a = nextInt(rng, n);
    const b = nextInt(rng, n);
    if (values[a] === values[b]) continue;
    const touched: number[] = [];
    for (const t of [...score.termsOf[a], ...score.termsOf[b]]) {
      if (mark[t] === k) continue;
      mark[t] = k;
      touched.push(t);
    }
    let before = 0;
    for (const t of touched) before += score.terms[t]();
    [values[a], values[b]] = [values[b], values[a]];
    let after = 0;
    for (const t of touched) after += score.terms[t]();
    if (after <= before) current += after - before;
    else [values[a], values[b]] = [values[b], values[a]];
  }
  return current;
}

/** An area's hexes as indexes: neighbour pairs inside it, and its hexes per island. */
function areaGraph(hexes: Record<HexId, Hex>, cells: HexId[], members: HexId[][]) {
  const index = new Map(cells.map((id, i) => [id, i]));
  const pairs: Array<[number, number]> = [];
  cells.forEach((id, i) => {
    for (const n of neighbours(id)) {
      const j = index.get(n);
      if (j !== undefined && j > i) pairs.push([i, j]);
    }
  });
  const bodies = [...new Set(cells.map((c) => hexes[c].body))].sort((a, b) => a - b);
  const groups = bodies.map((b) => members[b].filter((id) => index.has(id)).map((id) => index.get(id)!));
  return { index, pairs, groups };
}

/**
 * Deals an area's tiles onto its hexes, then swaps pairs while that lowers the
 * clumping: equal neighbours (worse for gold and desert), small islands with
 * a repeated terrain, big islands missing a resource the area has.
 */
function dealTerrains(hexes: Record<HexId, Hex>, cells: HexId[], tiles: Terrain[], members: HexId[][], rng: RngState): void {
  const g = areaGraph(hexes, cells, members);
  const deal = shuffle(rng, [...tiles]).slice(0, cells.length);
  const resources = [...new Set(tiles.filter((x) => TERRAIN_RESOURCE[x]))];
  const score = new Score(cells.length);
  for (const [i, j] of g.pairs) score.add([i, j], () => (deal[i] !== deal[j] ? 0 : deal[i] === 'gold' || deal[i] === 'desert' ? 4 : 1));
  for (const grp of g.groups) {
    score.add(grp, () => {
      const kinds = new Set(grp.map((i) => deal[i]));
      if (grp.length <= 5) return grp.length - kinds.size;
      return 3 * resources.filter((r) => !kinds.has(r)).length;
    });
  }
  improve(deal, score, rng, 30 * cells.length);
  cells.forEach((id, i) => (hexes[id].terrain = deal[i]));
}

/**
 * Deals an area's number tokens onto its producing hexes and improves the
 * deal by swapping pairs. Hard rules (from the game options; 6 and 8 apart by
 * default) must end up satisfied; softer ones are weighed: equal numbers side
 * by side, a 6 or 8 on gold, intersections worth more than 11 pips, and
 * islands whose average is far from the area's.
 */
function dealTokens(
  hexes: Record<HexId, Hex>,
  cells: HexId[],
  tokens: readonly number[],
  members: HexId[][],
  rng: RngState,
  rules: TokenRules,
): boolean {
  const HARD = 1000;
  const g = areaGraph(hexes, cells, members);
  const deal = shuffle(rng, [...tokens]);
  const score = new Score(cells.length);
  const pair = (a: number, b: number) => {
    let c = 0;
    if (rules.noAdjacentRed && isRed(a) && isRed(b)) c += HARD;
    if (rules.noAdjacent2and12 && (a === 2 || a === 12) && (b === 2 || b === 12)) c += HARD;
    if (a === b) c += rules.noAdjacentSameNumber ? HARD : 6;
    return c;
  };
  cells.forEach((id, i) => {
    // a 6 or 8 on gold, and numbers already on the board next to the area (other areas, fixed hexes)
    const gold = hexes[id].terrain === 'gold';
    const outside = neighbours(id)
      .filter((n) => !g.index.has(n) && hexes[n]?.token != null)
      .map((n) => hexes[n].token!);
    score.add([i], () => (gold && isRed(deal[i]) ? 3 : 0) + outside.reduce((s, o) => s + pair(deal[i], o), 0));
  });
  for (const [i, j] of g.pairs) score.add([i, j], () => pair(deal[i], deal[j]));
  // intersections touching the area: its hexes there, plus pips from numbers outside it
  const seen = new Set<string>();
  for (const id of cells) {
    for (let c = 0; c < 6; c++) {
      const v = cornerVertex(parseHexId(id), c);
      if (seen.has(v)) continue;
      seen.add(v);
      const hs = v.split('|');
      const at = hs.filter((h) => g.index.has(h)).map((h) => g.index.get(h)!);
      const extra = hs.filter((h) => !g.index.has(h)).reduce((s, h) => s + pips(hexes[h]?.token ?? null), 0);
      if (at.length + (extra > 0 ? 1 : 0) < 2) continue;
      score.add(at, () => {
        const sum = at.reduce((s, i) => s + pips(deal[i]), extra);
        return sum > 11 ? 2 * (sum - 11) : 0;
      });
    }
  }
  const mean = tokens.reduce((s, x) => s + pips(x), 0) / tokens.length;
  for (const grp of g.groups) {
    if (grp.length < 2) continue;
    score.add(grp, () => grp.length * (grp.reduce((s, i) => s + pips(deal[i]), 0) / grp.length - mean) ** 2);
  }
  const final = improve(deal, score, rng, 60 * cells.length);
  cells.forEach((id, i) => (hexes[id].token = deal[i]));
  return final < HARD;
}

// --- harbors ----------------------------------------------------------------------

/**
 * Harbor spots on the coasts of the given areas (producing land next to
 * sea): a random first spot, then each next one among the farthest from those
 * already chosen. Two harbors never share an intersection; where the coast
 * allows, there is at least one free intersection between them.
 */
function placeHarbors(
  hexes: Record<HexId, Hex>,
  topology: Topology,
  bodies: Body[],
  regions: string[],
  count: number,
  reserved: Set<string>,
  rng: RngState,
): HarborSpot[] | null {
  const cands: HarborSpot[] = [];
  for (const e of topology.edgeIds) {
    if (topology.edgeVertices[e].some((v) => reserved.has(v))) continue;
    const [a, b] = topology.edgeHexes[e];
    for (const [sea, land] of [
      [a, b],
      [b, a],
    ]) {
      const l = hexes[land];
      if (hexes[sea].terrain !== 'sea' || !isProducing(l.terrain) || l.body < 0 || !regions.includes(bodies[l.body].region)) continue;
      cands.push({ sea, land });
    }
  }
  const picked = spreadEdges(
    topology,
    cands.map((c) => edgeKey(c.sea, c.land)),
    count,
    rng,
  );
  return picked && picked.map((i) => cands[i]);
}

/**
 * Picks `count` of the given edges spread over the map: a random first one,
 * then each next one among the farthest from those already picked. Picked
 * edges never share an intersection; where possible they also leave a free
 * intersection between them. Returns the indexes picked, or null.
 */
export function spreadEdges(topology: Topology, edges: string[], count: number, rng: RngState): number[] | null {
  if (edges.length < count) return null;
  const at = edges.map((e) => edgeMidpoint(e));
  for (const spacing of [true, false]) {
    const chosen = [nextInt(rng, edges.length)];
    const blocked = new Set<string>();
    const block = (i: number) => {
      for (const v of topology.edgeVertices[edges[i]]) {
        blocked.add(v);
        if (spacing) for (const n of topology.vertexNeighbors[v]) blocked.add(n);
      }
    };
    block(chosen[0]);
    while (chosen.length < count) {
      const open = edges.map((_, i) => i).filter((i) => !topology.edgeVertices[edges[i]].some((v) => blocked.has(v)));
      if (open.length === 0) break;
      const d = open.map((i) => Math.min(...chosen.map((o) => (at[o].x - at[i].x) ** 2 + (at[o].y - at[i].y) ** 2)));
      const far = Math.max(...d);
      const near = open.filter((_, k) => d[k] >= 0.7 * far);
      const next = near[nextInt(rng, near.length)];
      chosen.push(next);
      block(next);
    }
    if (chosen.length === count) return chosen;
  }
  return null;
}

// --- checks -----------------------------------------------------------------------

function nearestSea(hexes: Record<HexId, Hex>, from: HexId): HexId | null {
  const seen = new Set([from]);
  let layer = [from];
  while (layer.length) {
    const sea = layer.filter((id) => hexes[id]?.terrain === 'sea').sort();
    if (sea.length) return sea[0];
    const next: HexId[] = [];
    for (const id of layer) for (const n of neighbours(id)) if (hexes[n] && !seen.has(n)) (seen.add(n), next.push(n));
    layer = next;
  }
  return null;
}

/**
 * The candidate passes when: the islands stayed apart (one land mass per
 * island, the desert line together with what it joins), there is room for
 * every starting settlement (and a coastal one per player) in the starting
 * area, the harbors sit on coasts without sharing an intersection, and every
 * mark lies on the board where its kind needs it.
 */
function valid(
  t: Template,
  style: MapStyle,
  hexes: Record<HexId, Hex>,
  topology: Topology,
  bodies: Body[],
  members: HexId[][],
  spots: HarborSpot[] | null,
  marks: Record<string, MapMark[]> | undefined,
): boolean {
  const land = (id: HexId) => !!hexes[id] && isLandTerrain(hexes[id].terrain);
  // islands: every body is one connected piece, and land of different bodies only meets across a barrier
  for (let b = 0; b < bodies.length; b++) {
    const cells = members[b];
    if (cells.length === 0) return false;
    const set = new Set(cells);
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
      const x = stack.pop()!;
      for (const n of neighbours(x)) if (set.has(n) && !seen.has(n)) (seen.add(n), stack.push(n));
    }
    if (seen.size !== cells.length) return false;
    for (const c of cells) {
      if (!t.interior.has(c)) return false;
      for (const n of neighbours(c)) {
        const o = hexes[n]?.body ?? -1;
        if (o < 0 || o === b) continue;
        if (mayTouch(bodies[b], bodies[o], style)) continue;
        const pair = [bodies[b].kind, bodies[o].kind];
        if (!pair.includes('barrier')) {
          // printed fixed islands may touch as printed
          if (bodies[b].fixed && bodies[o].fixed) continue;
          return false;
        }
      }
    }
  }
  if (style.barrier) {
    // a strip meets the rest of its zone only across the deserts
    for (const [id, h] of Object.entries(hexes)) {
      if (!style.barrier.beyond.includes(h.zone ?? '')) continue;
      for (const n of neighbours(id)) if (hexes[n]?.zone === style.barrier.zone && hexes[n].terrain !== 'desert') return false;
    }
  }
  // starting placement: a greedy set of intersections the distance rule allows
  const { setupZones, forbiddenZones } = style.rules;
  const allowed = topology.vertexIds.filter((v) => {
    const zones = topology.vertexHexes[v].filter(land).map((h) => hexes[h].zone ?? '');
    if (zones.length === 0) return false;
    if (zones.some((z) => forbiddenZones.includes(z))) return false;
    return !setupZones || zones.every((z) => setupZones.includes(z));
  });
  const taken = new Set<string>();
  let coastal = 0;
  let count = 0;
  for (const v of allowed) {
    if (taken.has(v) || topology.vertexNeighbors[v].some((n) => taken.has(n))) continue;
    taken.add(v);
    count++;
    if (topology.vertexHexes[v].some((h) => hexes[h].terrain === 'sea')) coastal++;
  }
  if (count < t.seats || coastal < style.players) return false;
  // harbors
  if (spots) {
    const used = new Set<string>();
    for (const s of spots) {
      if (hexes[s.sea]?.terrain !== 'sea' || !land(s.land)) return false;
      const e = edgeKey(s.sea, s.land);
      if (!topology.edgeVertices[e]) return false;
      for (const v of topology.edgeVertices[e]) {
        if (used.has(v)) return false;
        used.add(v);
      }
    }
  }
  // marks
  for (const [kind, list] of Object.entries(marks ?? {})) {
    for (const m of list) {
      const id = offsetHex(m.at);
      if (!hexes[id]) return false;
      const a = parseHexId(id);
      if (kind === 'circuit' && hexes[id].terrain !== 'sea') return false;
      if (m.corner) {
        const v = cornerVertex(a, CORNER_NAMES.indexOf(m.corner));
        if (!topology.vertexEdges[v] || !topology.vertexHexes[v].some(land)) return false;
      }
      if (m.side) {
        const e = sideEdge(a, DIR_NAMES.indexOf(m.side));
        if (!topology.edgeHexes[e] || !topology.edgeHexes[e].some(land)) return false;
      }
    }
  }
  return true;
}
