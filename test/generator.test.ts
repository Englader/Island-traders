import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SCENARIOS,
  DEFAULT_OPTIONS,
  applyAction,
  createGame,
  generateMap,
  getScenario,
  buildTopology,
  hexCenter,
  isRed,
  parseHexId,
  playersToAct,
  randomAction,
  seedRng,
  styledMap,
  tokensOk,
  topo,
  vertexZones,
  type GameState,
  type GeneratedMap,
  type HexId,
  type HexState,
  type MapSpec,
  type ScenarioDef,
} from '../src/index.js';
import { TRIBE_GIFTS } from '../src/scenarios/seafarers/tribes.js';
import { straitVertices, wastelandVertices } from '../src/scenarios/seafarers/wonders.js';

/*
 * Random layouts of the Seafarers scenarios: new maps generated in the style
 * of the rulebook's map (board/generator.ts). Hundreds of seeds per scenario
 * and player count, each checked against the printed map it imitates.
 */

const SEEDS = Number(process.env.GEN_SEEDS ?? 300);
/** Every how many seeds a game is also set up and played through its starting placement. */
const GAME_EVERY = Number(process.env.GEN_GAME_EVERY ?? 10);
const RULES = { noAdjacentRed: true, noAdjacent2and12: false, noAdjacentSameNumber: false };
const RANDOM = { ...DEFAULT_OPTIONS, layout: 'random' as const };
const LAND = (h: HexState) => h.terrain !== 'sea' && h.terrain !== 'fog';
const PRODUCING = new Set(['hills', 'forest', 'pasture', 'fields', 'mountains', 'gold']);

const seafarers = BUILT_IN_SCENARIOS.filter((s) => s.expansion === 'seafarers');
/** Least number of different land layouts over the seeds, where the frame leaves little room. */
const VARIETY: Record<string, number> = {
  'seafarers-4-through-the-desert': SEEDS / 10,
  'seafarers-5-forgotten-tribe': SEEDS / 10,
  'seafarers-7-pirate-islands': 2,
  'seafarers-8-wonders': 4,
};
const counts = (sc: ScenarioDef) => Array.from({ length: sc.maxPlayers - sc.minPlayers + 1 }, (_, i) => sc.minPlayers + i);

/** The concrete map the random layout builds from `seed` (as `createGame` does), with how it came about. */
function generated(sc: ScenarioDef, n: number, seed: string): { spec: MapSpec; map: GeneratedMap } {
  const rng = seedRng(seed);
  const spec = sc.map(n, RANDOM).procedural!(rng, RULES);
  return { spec, map: generateMap(spec, rng, RULES, false) };
}

/** Areas are compared by zone: tagged zones by name, untagged islands together, the fog area apart. */
const area = (h: HexState) => (h.terrain === 'fog' ? 'fog' : h.zone && !h.zone.startsWith('island-') ? h.zone : 'islands');

/** JSON with sorted keys, for comparing plain objects quickly. */
function canon(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(',')}}`;
}

function tally<T>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of items) out[String(x)] = (out[String(x)] ?? 0) + 1;
  return out;
}

/** What a map is made of, per area: tiles, numbers, unnumbered tiles; and how many separate islands. */
function makeup(hexes: Record<HexId, HexState>) {
  const byArea: Record<string, HexState[]> = {};
  for (const h of Object.values(hexes)) if (h.terrain !== 'sea') (byArea[area(h)] ??= []).push(h);
  const areas: Record<string, { terrains: Record<string, number>; tokens: Record<string, number>; bare: number }> = {};
  for (const [a, hs] of Object.entries(byArea)) {
    areas[a] = {
      terrains: tally(hs.map((h) => h.terrain)),
      tokens: tally(hs.map((h) => h.token).filter((t) => t !== null)),
      bare: hs.filter((h) => PRODUCING.has(h.terrain) && h.token === null).length,
    };
  }
  return { areas, islands: islands(hexes).length };
}

/** Connected land masses (fog and sea excluded). */
function islands(hexes: Record<HexId, HexState>): HexId[][] {
  const seen = new Set<HexId>();
  const out: HexId[][] = [];
  for (const id of Object.keys(hexes).sort()) {
    if (seen.has(id) || !LAND(hexes[id])) continue;
    const comp: HexId[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      const a = parseHexId(x);
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
        const nid = `${a.q + dq},${a.r + dr}`;
        if (!seen.has(nid) && hexes[nid] && LAND(hexes[nid])) {
          seen.add(nid);
          stack.push(nid);
        }
      }
    }
    out.push(comp.sort());
  }
  return out;
}

/** Plays the starting placement with random legal moves: every player must be able to place every settlement. */
function playSetup(s: GameState, seed: string): GameState {
  const rng = seedRng(`setup-${seed}`);
  for (let i = 0; i < 200 && ['setup', 'gold', 'harborPlacement'].includes(s.phase.kind); i++) {
    const p = playersToAct(s)[0];
    const a = randomAction(s, p, rng);
    expect(a, `${s.scenario} ${seed}: no legal starting move for player ${p} in ${s.phase.kind}`).not.toBeNull();
    const r = applyAction(s, a!);
    expect(r.ok).toBe(true);
    if (r.ok) s = r.state;
  }
  return s;
}

/** Signed area of a closed polygon of hex centres (the sign tells the sense of rotation). */
function turning(hexes: HexId[]): number {
  const pts = hexes.map((h) => hexCenter(parseHexId(h)));
  let a = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  });
  return Math.sign(a);
}

for (const sc of seafarers) {
  describe(`generated maps: ${sc.name}`, () => {
    for (const n of counts(sc)) {
      it(`${SEEDS} seeds with ${n} players keep the printed map's concept and every rule`, () => {
        const official = createGame({ scenario: sc.id, players: n, seed: 'printed', options: { layout: 'official' } });
        const want = makeup(official.board.hexes);
        const frame = Object.keys(official.board.hexes).sort();
        const t = buildTopology(frame);
        const printedHarbors = official.board.harbors.map((h) => h.type).sort();
        const harborAreas = new Set(
          official.board.harbors.map((h) => area(official.board.hexes[t.edgeHexes[h.edge].find((x) => LAND(official.board.hexes[x]))!])),
        );
        const robberOn = official.board.robber ? official.board.hexes[official.board.robber] : null;
        const layouts = new Set<string>();
        for (let i = 0; i < SEEDS; i++) {
          const seed = `gen-${i}`;
          const { spec, map } = generated(sc, n, seed);
          const hexes = map.hexes;
          const tag = `${sc.id} ${n}p ${seed}`;
          // (problems are collected and asserted once per map: thousands of expect() calls are slow)
          const bad: string[] = [];
          const check = (ok: boolean, what: string) => ok || bad.push(what);
          // drawn, not the fallback (the printed map re-dealt)
          check(spec.generated?.fallback === false, 'fell back to the printed map');
          // the same frame; land never on its outer ring
          check(Object.keys(hexes).sort().join() === frame.join(), 'frame differs');
          for (const [id, h] of Object.entries(hexes)) if (h.terrain !== 'sea') check(t.hexNeighbors[id].length === 6, `land on the rim at ${id}`);
          // per area the same tiles, numbers and unnumbered tiles, and as many islands (the rulebook
          // deals New World at random, sea included: there any number of islands goes, a sea hex apart)
          const got = makeup(hexes);
          if (sc.id === 'seafarers-9-new-world') {
            check(canon(got.areas) === canon(want.areas), `areas ${canon(got.areas)}`);
            check(new Set(islands(hexes).flat().map((h) => hexes[h].zone)).size === got.islands, 'islands touch');
          } else check(canon(got) === canon(want), `makeup ${canon(got)}`);
          // every producing hex of a numbered area has a number; 6 and 8 never side by side
          for (const [id, h] of Object.entries(hexes)) {
            if (h.token === null) continue;
            check(PRODUCING.has(h.terrain), `number on ${h.terrain} at ${id}`);
            if (isRed(h.token)) for (const x of t.hexNeighbors[id]) check(!isRed(hexes[x].token), `6/8 side by side at ${id}`);
          }
          // harbors: the printed ones, on coasts of the areas they serve, never two on one intersection
          check(map.harbors.map((h) => h.type).sort().join() === printedHarbors.join(), 'harbor types differ');
          const used = new Set<string>();
          for (const h of map.harbors) {
            const [a, b] = t.edgeHexes[h.edge];
            const land = LAND(hexes[a]) ? a : b;
            const sea = land === a ? b : a;
            check(hexes[sea].terrain === 'sea' && PRODUCING.has(hexes[land].terrain), `harbor off the coast at ${h.edge}`);
            check(harborAreas.has(area(hexes[land])), `harbor in the wrong area at ${h.edge}`);
            for (const v of t.edgeVertices[h.edge]) {
              check(!used.has(v), `harbors share ${v}`);
              used.add(v);
            }
          }
          // robber and pirate start as on the printed map (on the desert, or on the 12)
          if (robberOn === null) check(map.robber === null, 'robber on the board');
          else if (robberOn.terrain === 'desert') check(hexes[map.robber!].terrain === 'desert', 'robber not on a desert');
          else check(hexes[map.robber!].token === robberOn.token, `robber not on the ${robberOn.token}`);
          if (official.board.pirate === null) check(map.pirate === null, 'pirate on the board');
          else check(hexes[map.pirate!].terrain === 'sea', 'pirate not at sea');
          expect(bad, tag).toEqual([]);
          layouts.add(
            Object.keys(hexes)
              .filter((id) => hexes[id].terrain !== 'sea')
              .join(),
          );

          if (i % GAME_EVERY !== 0) continue;
          // the engine builds the same board from the seed, the scenario finds its spots, and the setup can be played
          const s = createGame({ scenario: sc.id, players: n, seed, options: { layout: 'random' } });
          expect(s.board.hexes, tag).toEqual(hexes);
          checkSpots(s, official, tag);
          const done = playSetup(s, seed);
          for (let p = 0; p < n; p++) {
            const mine = Object.values(done.board.buildings).filter((b) => b.owner === p).length;
            expect(mine, `${tag} player ${p}`).toBeGreaterThanOrEqual(sc.rules.setupRounds.length);
          }
        }
        // different seeds give different maps; the tighter the frame, the fewer (the Pirate Islands and
        // the Wonders keep their printed main island and vary by mirrors and the small islands)
        expect(layouts.size, sc.id).toBeGreaterThanOrEqual(VARIETY[sc.id] ?? SEEDS / 3);
      });
    }
  });
}

/** Scenario spots on a generated map sit where the scenario's rules need them. */
function checkSpots(s: GameState, official: GameState, tag: string): void {
  const t = topo(s);
  const hexes = s.board.hexes;
  switch (s.scenario) {
    case 'seafarers-3-fog-islands': {
      const fog = s.ext.fog as { terrains: string[] };
      expect(Object.values(hexes).filter((h) => h.terrain === 'fog').length, tag).toBe(fog.terrains.length);
      break;
    }
    case 'seafarers-4-through-the-desert': {
      // the strip is cut off by the deserts: none of its hexes touches the rest of the home area
      const strip = Object.keys(hexes).filter((h) => hexes[h].zone === 'strip');
      expect(strip.length, tag).toBe(3);
      for (const h of strip) {
        for (const x of t.hexNeighbors[h]) {
          if (hexes[x].zone === 'home') expect(hexes[x].terrain, tag).toBe('desert');
        }
      }
      expect(strip.some((h) => t.hexNeighbors[h].some((x) => hexes[x].terrain === 'desert')), tag).toBe(true);
      break;
    }
    case 'seafarers-5-forgotten-tribe': {
      const tribe = s.ext.tribe as { gifts: Record<string, string> };
      expect(Object.values(tribe.gifts).sort(), tag).toEqual([...TRIBE_GIFTS].sort());
      for (const e of Object.keys(tribe.gifts)) {
        const kinds = t.edgeHexes[e].map((h) => (hexes[h].terrain === 'sea' ? 'sea' : hexes[h].zone));
        expect(kinds.sort(), tag).toEqual(['sea', 'tribe']);
      }
      break;
    }
    case 'seafarers-6-cloth-trade': {
      const villages = (s.ext.cloth as { villages: Record<string, { token: number }> }).villages;
      expect(Object.values(villages).map((v) => v.token).sort((a, b) => a - b), tag).toEqual([3, 4, 5, 6, 8, 9, 10, 11]);
      const isles = Object.keys(hexes).filter((h) => hexes[h].zone === 'isle');
      expect(isles, tag).toHaveLength(4);
      for (const h of isles) expect(Object.keys(villages).filter((v) => t.vertexHexes[v].includes(h)), tag).toHaveLength(2);
      break;
    }
    case 'seafarers-7-pirate-islands': {
      const pi = s.ext.pirateIslands as { circuit: string[]; fortresses: Array<{ vertex: string; waypoint: string }> };
      for (const f of pi.fortresses) {
        expect(vertexZones(s, f.vertex), tag).toEqual(['way']);
        expect(vertexZones(s, f.waypoint), tag).toEqual(['way']);
      }
      for (const [v] of Object.entries(s.board.buildings)) expect(vertexZones(s, v), tag).toEqual(['main']);
      pi.circuit.forEach((h, i) => {
        expect(hexes[h].terrain, tag).toBe('sea');
        expect(t.hexNeighbors[h], tag).toContain(pi.circuit[(i + 1) % pi.circuit.length]);
      });
      // mirrored or not, the fleet still sails clockwise
      const printed = (official.ext.pirateIslands as { circuit: string[] }).circuit;
      expect(turning(pi.circuit), tag).toBe(turning(printed));
      break;
    }
    case 'seafarers-8-wonders': {
      const strait = straitVertices(s);
      expect(strait, tag).toHaveLength(2);
      expect(t.vertexNeighbors[strait[0]], tag).toContain(strait[1]);
      const wasteland = wastelandVertices(s);
      expect(wasteland, tag).toHaveLength(5);
      for (const v of wasteland) expect(t.vertexHexes[v].some((h) => hexes[h].terrain === 'desert'), tag).toBe(true);
      break;
    }
  }
}

describe('generated maps: determinism and variety', () => {
  it('the same seed always gives the same map, in every scenario', () => {
    for (const sc of BUILT_IN_SCENARIOS) {
      for (const n of [sc.minPlayers, sc.maxPlayers]) {
        const a = createGame({ scenario: sc.id, players: n, seed: 'same', options: { layout: 'random' } });
        const b = createGame({ scenario: sc.id, players: n, seed: 'same', options: { layout: 'random' } });
        expect(b.board, `${sc.id} ${n}`).toEqual(a.board);
        expect(b.ext, `${sc.id} ${n}`).toEqual(a.ext);
      }
    }
  });

  it('island shapes and gold fields move from seed to seed', () => {
    for (const sc of seafarers) {
      const shapes = new Set<string>();
      const gold = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const { map } = generated(sc, 4, `vary-${i}`);
        shapes.add(islands(map.hexes).map((c) => c.join(' ')).sort().join(' / '));
        gold.add(Object.keys(map.hexes).filter((h) => map.hexes[h].terrain === 'gold').sort().join());
      }
      // (the Pirate Islands keep their printed geometry, mirrored; the Wonders' main island leaves the small
      // islands exactly their printed room; the Forgotten Tribe's frame leaves little)
      expect(shapes.size, sc.id).toBeGreaterThanOrEqual(Math.min(VARIETY[sc.id] ?? 12, 12));
      // the printed maps with gold keep it in fixed places; generated ones deal it anew
      const hasGold = Object.values(generated(sc, 4, 'vary-0').map.hexes).some((h) => h.terrain === 'gold');
      if (hasGold) expect(gold.size, sc.id).toBeGreaterThanOrEqual(10);
    }
  });

  it('the optional number rules hold too when a game switches them on', () => {
    const rules = { noAdjacentRed: true, noAdjacent2and12: true, noAdjacentSameNumber: true };
    for (const sc of seafarers) {
      for (let i = 0; i < 10; i++) {
        const s = createGame({ scenario: sc.id, players: 4, seed: `house-${i}`, options: { layout: 'random', ...rules } });
        expect(tokensOk(s.board.hexes, rules), `${sc.id} house-${i}`).toBe(true);
      }
    }
  });

  it('when no candidate fits, the printed map is used instead', () => {
    // no map leaves room for the starting settlements of 40 players
    const printed = getScenario('seafarers-1-new-shores').officialMap!(3, RANDOM)!;
    const spec = styledMap(printed, { players: 40, rules: getScenario('seafarers-1-new-shores').rules }).procedural!(seedRng('crowd'), RULES);
    expect(spec.generated).toEqual({ attempts: 60, fallback: true });
    const map = generateMap(spec, seedRng('crowd'), RULES, false);
    const official = generateMap(printed, seedRng('crowd'), RULES, false);
    expect(Object.keys(map.hexes).filter((h) => map.hexes[h].terrain !== 'sea').sort()).toEqual(
      Object.keys(official.hexes).filter((h) => official.hexes[h].terrain !== 'sea').sort(),
    );
  });

  it('the base game keeps its variable set-up: the 19 or 30 hexes of the island, re-dealt', () => {
    for (const n of [3, 4, 5, 6]) {
      const a = createGame({ scenario: 'base', players: n, seed: 'a', options: { layout: 'random' } });
      const b = createGame({ scenario: 'base', players: n, seed: 'b', options: { layout: 'random' } });
      expect(Object.keys(a.board.hexes).sort()).toEqual(Object.keys(b.board.hexes).sort());
      expect(Object.values(a.board.hexes).filter(LAND)).toHaveLength(n >= 5 ? 30 : 19);
      expect(a.board.hexes).not.toEqual(b.board.hexes);
    }
  });
});
