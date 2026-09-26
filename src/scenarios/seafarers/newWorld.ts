import { styledMap } from '../../board/generator.js';
import type { MapSpec } from '../../board/mapSpec.js';
import { HARBORS_5_6, HARBORS_BASE } from '../../core/constants.js';
import { shuffle } from '../../core/rng.js';
import type { HarborType, Terrain } from '../../core/types.js';
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

/** The rulebook's New World: every hex of the frame, sea included, is dealt at random. */
const OFFICIAL: Record<'small' | 'big', MapSpec> = {
  small: {
    rows: NEW_WORLD_FRAME_3_4,
    pools: { default: { terrains: { ...terrainsFor(4), sea: 19 }, tokens: newWorldTokens(4) } },
    harbors: null,
    robber: 'offboard',
    pirate: 'offboard',
  },
  big: {
    rows: NEW_WORLD_FRAME_5_6,
    pools: { default: { terrains: { ...terrainsFor(6), sea: 21 }, tokens: newWorldTokens(6) } },
    harbors: null,
    robber: 'offboard',
    pirate: 'offboard',
  },
};

const rules = seafarersRules({ islandBonus: { vp: 1, home: 'setup' }, playersPlaceHarbors: true });

export const newWorld: ScenarioDef = {
  id: 'seafarers-9-new-world',
  name: 'New World',
  expansion: 'seafarers',
  description:
    'A random archipelago. Players first place the harbors, then start anywhere. Your first settlement on each other island earns 1 VP. The robber and pirate start off the board. 12 VP to win.',
  minPlayers: 3,
  maxPlayers: 6,
  victoryPoints: () => 12,
  officialMap: (players) => OFFICIAL[players >= 5 ? 'big' : 'small'],
  // The random layout: an archipelago in the same frame, its islands a sea hex apart.
  map: (players) => styledMap(OFFICIAL[players >= 5 ? 'big' : 'small'], { players, rules, archipelago: { islands: players >= 5 ? [4, 6] : [4, 6] } }),
  ...seafarersSupply,
  rules,
  hooks: {
    init(state) {
      // 9 harbors (5 special, 4 generic); 11 with 5-6 players (a second wool and a fifth generic).
      const pool: HarborType[] = state.players.length >= 5 ? [...HARBORS_5_6] : [...HARBORS_BASE];
      state.ext.harborPool = shuffle(state.rng, pool);
    },
  },
};

