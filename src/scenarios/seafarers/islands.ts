import { styledMap } from '../../board/generator.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { revealFogAround, seafarersSupply } from './common.js';
import {
  FOG_ISLANDS_3,
  FOG_ISLANDS_4,
  FOUR_ISLANDS_3,
  FOUR_ISLANDS_4,
  NEW_SHORES_3,
  NEW_SHORES_4,
  THROUGH_THE_DESERT_3,
  THROUGH_THE_DESERT_4,
} from './officialMaps.js';

/*
 * Each scenario has the rulebook's map for 3 and for 4 players
 * (`officialMap`, see officialMaps.ts). The random layout (`map`) is a new
 * map in its style (see board/generator.ts): the same frame, the same kind
 * of islands with new shapes, and the same tiles, numbers and harbors per
 * area, dealt anew.
 */

// 1 ---------------------------------------------------------------------------

const newShoresRules = seafarersRules({ setupZones: ['main'], islandBonus: { vp: 2, home: ['main'] } });

export const headingForNewShores: ScenarioDef = {
  id: 'seafarers-1-new-shores',
  name: 'Heading for New Shores',
  expansion: 'seafarers',
  description:
    'Start on the main island. Your first settlement on each small island earns 2 VP (VP chits). 14 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 14,
  officialMap: (players) => (players <= 3 ? NEW_SHORES_3 : NEW_SHORES_4),
  map: (players) => styledMap(players <= 3 ? NEW_SHORES_3 : NEW_SHORES_4, { players, rules: newShoresRules }),
  ...seafarersSupply,
  rules: newShoresRules,
  hooks: {},
};

// 2 ---------------------------------------------------------------------------

const fourIslandsRules = seafarersRules({ islandBonus: { vp: 2, home: 'setup' } });

export const theFourIslands: ScenarioDef = {
  id: 'seafarers-2-four-islands',
  name: 'The Four Islands',
  expansion: 'seafarers',
  description:
    'Start on one or two islands of your choice; your first settlement on each other island earns 2 VP. 13 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 13,
  officialMap: (players) => (players <= 3 ? FOUR_ISLANDS_3 : FOUR_ISLANDS_4),
  map: (players) => styledMap(players <= 3 ? FOUR_ISLANDS_3 : FOUR_ISLANDS_4, { players, rules: fourIslandsRules }),
  ...seafarersSupply,
  rules: fourIslandsRules,
  hooks: {},
};

// 3 ---------------------------------------------------------------------------

const fogRules = seafarersRules({ setupZones: ['home'] });

export const theFogIslands: ScenarioDef = {
  id: 'seafarers-3-fog-islands',
  name: 'The Fog Islands',
  expansion: 'seafarers',
  description:
    'Part of the sea is unexplored. A road or ship reaching a fog hex reveals it; new land gets a random number and pays the discoverer 1 card. 12 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 12,
  officialMap: (players) => (players <= 3 ? FOG_ISLANDS_3 : FOG_ISLANDS_4),
  map: (players) => styledMap(players <= 3 ? FOG_ISLANDS_3 : FOG_ISLANDS_4, { players, rules: fogRules }),
  ...seafarersSupply,
  rules: fogRules,
  hooks: {
    afterEdge(state, player, edge) {
      revealFogAround(state, player, edge);
    },
  },
};

// 4 ---------------------------------------------------------------------------

const desertRules = seafarersRules({ setupZones: ['home'], islandBonus: { vp: 2, home: ['home'] } });

export const throughTheDesert: ScenarioDef = {
  id: 'seafarers-4-through-the-desert',
  name: 'Through the Desert',
  expansion: 'seafarers',
  description:
    'Three deserts cut off a strip of land. Your first settlement in each foreign area (the strip or an islet) earns 2 VP. 14 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 14,
  officialMap: (players) => (players <= 3 ? THROUGH_THE_DESERT_3 : THROUGH_THE_DESERT_4),
  // The three deserts stay a line that cuts the strip off from the home area.
  map: (players) =>
    styledMap(players <= 3 ? THROUGH_THE_DESERT_3 : THROUGH_THE_DESERT_4, {
      players,
      rules: desertRules,
      barrier: { zone: 'home', beyond: 'strip' },
    }),
  ...seafarersSupply,
  rules: desertRules,
  hooks: {},
};
