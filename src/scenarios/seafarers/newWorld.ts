import { axialToOffset, neighbor, offsetToAxial } from '../../board/hex.js';
import { expandTerrains, type CellSpec, type MapSpec } from '../../board/mapSpec.js';
import { HARBORS_5_6, HARBORS_BASE } from '../../core/constants.js';
import { nextInt, shuffle } from '../../core/rng.js';
import type { HarborType, RngState, Terrain } from '../../core/types.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { seafarersSupply } from './common.js';
import { NEW_WORLD_FRAME_3_4, NEW_WORLD_FRAME_5_6 } from './officialMaps.js';

/** Land tiles from the rulebooks' component lists (no desert or gold with 3-4 players). */
function terrainsFor(players: number): Partial<Record<Terrain, number>> {
  return players >= 5
    ? { forest: 7, pasture: 7, fields: 7, hills: 7, mountains: 7, gold: 4, desert: 3 }
    : { forest: 5, pasture: 5, fields: 5, hills: 4, mountains: 4 };
}

/** Number tokens: 23 for 3-4 players; 39 for 5-6 (one per producing hex). */
export function newWorldTokens(players: number): number[] {
  const counts: Record<number, number> =
    players >= 5
      ? { 2: 2, 3: 3, 4: 4, 5: 5, 6: 5, 8: 5, 9: 5, 10: 4, 11: 4, 12: 2 }
      : { 2: 1, 3: 3, 4: 3, 5: 3, 6: 2, 8: 2, 9: 3, 10: 3, 11: 2, 12: 1 };
  return Object.entries(counts).flatMap(([t, n]) => Array<number>(n).fill(Number(t)));
}

/**
 * Random archipelago: several islands grown from random seeds inside a sea
 * frame, never touching each other (every island is separated by sea).
 */
export function newWorldCells(players: number, rng: RngState): CellSpec[] {
  const big = players >= 5;
  const W = big ? 16 : 12;
  const H = big ? 10 : 8;
  const landCount = expandTerrains(terrainsFor(players)).length;
  const key = (c: number, r: number) => `${c},${r}`;
  const interior: Array<[number, number]> = [];
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) interior.push([c, r]);
  const inInterior = new Set(interior.map(([c, r]) => key(c, r)));
  const neighbors = (c: number, r: number): Array<[number, number]> => {
    const a = offsetToAxial(c, r);
    return Array.from({ length: 6 }, (_, d) => {
      const n = neighbor(a, d);
      const o = axialToOffset(n);
      return [o.col, o.row] as [number, number];
    });
  };

  for (let attempt = 0; attempt < 500; attempt++) {
    const owner = new Map<string, number>();
    const k = big ? 7 + nextInt(rng, 3) : 5 + nextInt(rng, 2);
    const sizes = Array.from({ length: k }, () => 2);
    for (let left = landCount - 2 * k; left > 0; left--) {
      sizes[nextInt(rng, 10) < 4 ? 0 : nextInt(rng, k)]++;
    }
    const free = (c: number, r: number, island: number) =>
      inInterior.has(key(c, r)) &&
      !owner.has(key(c, r)) &&
      neighbors(c, r).every(([nc, nr]) => {
        const o = owner.get(key(nc, nr));
        return o === undefined || o === island;
      });
    let ok = true;
    for (let i = 0; i < k && ok; i++) {
      const seeds = interior.filter(([c, r]) => free(c, r, i));
      if (seeds.length === 0) {
        ok = false;
        break;
      }
      const [sc, sr] = seeds[nextInt(rng, seeds.length)];
      owner.set(key(sc, sr), i);
      const cells: Array<[number, number]> = [[sc, sr]];
      while (cells.length < sizes[i]) {
        const frontier: Array<[number, number]> = [];
        for (const [c, r] of cells) for (const [nc, nr] of neighbors(c, r)) if (free(nc, nr, i)) frontier.push([nc, nr]);
        if (frontier.length === 0) {
          ok = false;
          break;
        }
        const [fc, fr] = frontier[nextInt(rng, frontier.length)];
        owner.set(key(fc, fr), i);
        cells.push([fc, fr]);
      }
    }
    if (!ok) continue;
    const out: CellSpec[] = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const { q, r: rr } = offsetToAxial(c, r);
        const land = owner.has(key(c, r));
        out.push({
          q,
          r: rr,
          terrain: land ? 'random' : 'sea',
          pool: 'default',
          token: land ? 'random' : null,
          zone: null,
        });
      }
    }
    return out;
  }
  throw new Error('could not generate a New World map');
}

export const newWorld: ScenarioDef = {
  id: 'seafarers-9-new-world',
  name: 'New World',
  expansion: 'seafarers',
  description:
    'A random archipelago. Players first place the harbors, then start anywhere. Your first settlement on each other island earns 1 VP. The robber and pirate start off the board. 12 VP to win.',
  minPlayers: 3,
  maxPlayers: 6,
  victoryPoints: () => 12,
  // The rulebook's New World: every hex of the frame, sea included, is dealt at random.
  officialMap: (players): MapSpec => {
    const big = players >= 5;
    return {
      rows: big ? NEW_WORLD_FRAME_5_6 : NEW_WORLD_FRAME_3_4,
      pools: { default: { terrains: { ...terrainsFor(players), sea: big ? 21 : 19 }, tokens: newWorldTokens(players) } },
      harbors: null,
      robber: 'offboard',
      pirate: 'offboard',
    };
  },
  map: (players): MapSpec => ({
    generate: (rng) => newWorldCells(players, rng),
    pools: { default: { terrains: terrainsFor(players), tokens: newWorldTokens(players) } },
    harbors: null,
    // Both enter play when first moved.
    robber: 'offboard',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({ islandBonus: { vp: 1, home: 'setup' }, playersPlaceHarbors: true }),
  hooks: {
    init(state) {
      // 9 harbors (5 special, 4 generic); 11 with 5-6 players (a second wool and a fifth generic).
      const pool: HarborType[] = state.players.length >= 5 ? [...HARBORS_5_6] : [...HARBORS_BASE];
      state.ext.harborPool = shuffle(state.rng, pool);
    },
  },
};

