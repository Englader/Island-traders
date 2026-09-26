import { axialToOffset, neighbor, offsetToAxial } from '../../board/hex.js';
import { expandTerrains, type CellSpec, type MapSpec } from '../../board/mapSpec.js';
import { HARBORS_SEAFARERS, TOKENS_28 } from '../../core/constants.js';
import { nextInt, shuffle } from '../../core/rng.js';
import type { HarborType, RngState, Terrain } from '../../core/types.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { seafarersSupply } from './common.js';

function terrainsFor(players: number): Partial<Record<Terrain, number>> {
  return players >= 5
    ? { forest: 6, pasture: 6, fields: 6, hills: 5, mountains: 5, gold: 2, desert: 2 }
    : { forest: 4, pasture: 4, fields: 4, hills: 4, mountains: 4, gold: 2, desert: 1 };
}

/**
 * Random archipelago: several islands grown from random seeds inside a sea
 * frame, never touching each other (every island is separated by sea).
 */
export function newWorldCells(players: number, rng: RngState): CellSpec[] {
  const big = players >= 5;
  const W = big ? 14 : 12;
  const H = big ? 9 : 8;
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
    'A random archipelago. Start anywhere; after the starting placement players place the harbors. Your first settlement on each other island earns 1 VP. 12 VP to win.',
  minPlayers: 3,
  maxPlayers: 6,
  victoryPoints: () => 12,
  map: (players): MapSpec => ({
    generate: (rng) => newWorldCells(players, rng),
    pools: {
      default: {
        terrains: terrainsFor(players),
        tokens: players >= 5 ? [...TOKENS_28, 4, 10] : TOKENS_28,
      },
    },
    harbors: null,
    robber: 'desert',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({ islandBonus: { vp: 1, home: 'setup' }, playersPlaceHarbors: true }),
  hooks: {
    init(state) {
      const pool: HarborType[] = [...HARBORS_SEAFARERS];
      if (state.players.length >= 5) pool.push('generic');
      state.ext.harborPool = shuffle(state.rng, pool);
    },
  },
};

