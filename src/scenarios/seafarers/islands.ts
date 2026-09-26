import type { MapSpec } from '../../board/mapSpec.js';
import { TERRAIN_BASE, TOKENS_28, TOKENS_BASE_SPIRAL } from '../../core/constants.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { revealFogAround, seafarersHarbors, seafarersSupply } from './common.js';
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
 * (`officialMap`, see officialMaps.ts) and a random set-up (`map`): original
 * layouts that follow the scenario's structure (main island + outlying
 * islands, desert barrier, fog area, ...) with shuffled tiles and numbers.
 */

// 1 ---------------------------------------------------------------------------

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
  map: (players): MapSpec => ({
    rows: [
      '~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~',
      '~  ~  ?  ?  ?  ~  ~  $4 ?b ~  ~',
      '~  ~  ?  ?  ?  ?  ~  ~  ~  ~  ~',
      '~  ?  ?  ?@main ?  ?  ~  ~  ?b ?b ~',
      '~  ~  ?  ?  ?  ?  ~  ~  ~  ~  ~',
      '~  ~  ?  ?  ?  ~  ~  ?b $10 ~ ~',
      '~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~',
    ],
    pools: {
      default: { terrains: TERRAIN_BASE, tokens: TOKENS_BASE_SPIRAL },
      b: { terrains: { mountains: 1, hills: 1, forest: 1, pasture: 1 }, tokens: [3, 5, 9, 11] },
    },
    harbors: { spots: 'auto', pool: seafarersHarbors(players), zones: ['main'] },
    robber: 'desert',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({ setupZones: ['main'], islandBonus: { vp: 2, home: ['main'] } }),
  hooks: {},
};

// 2 ---------------------------------------------------------------------------

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
  map: (players): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ? ? ? ~ ~ ~ ? ? ? ~',
      '~ ? ? ? ~ ~ ~ ? ? ? ~',
      '~ ~ ? ~ ~ ~ ~ ~ ? ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ? ? ? ~ ~ ~ ? ? ? ~',
      '~ ? ? ? ~ ~ ~ ? ? ? ~',
      '~ ~ ? ~ ~ ~ ~ ~ ? ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    // No desert and no gold, as in the rulebook's component list.
    pools: {
      default: {
        terrains: { forest: 6, pasture: 6, fields: 6, hills: 5, mountains: 5 },
        tokens: TOKENS_28,
      },
    },
    harbors: { spots: 'auto', pool: seafarersHarbors(Math.max(players, 4)) },
    // The robber starts on a hex with a 12.
    robber: 'token:12',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({ islandBonus: { vp: 2, home: 'setup' } }),
  hooks: {},
};

// 3 ---------------------------------------------------------------------------

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
  map: (players): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ? ? ~ ~ x x x x x ~',
      '~ ? ? ? ~ x x x x x ~',
      '~ ? ?@home ? ~ ~ x x x x ~',
      '~ ? ? ? ~ x x x x x ~',
      '~ ? ? ~ ~ x x x x x ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    // The face-up island has no desert; the robber starts on its 12.
    pools: {
      default: {
        terrains: { forest: 3, pasture: 3, fields: 3, hills: 2, mountains: 2 },
        tokens: [2, 3, 4, 4, 5, 5, 6, 8, 9, 9, 10, 11, 12],
      },
    },
    fog: {
      terrains: { forest: 2, pasture: 2, fields: 3, hills: 3, mountains: 3, gold: 2, sea: 9 },
      tokens: [2, 3, 3, 4, 4, 5, 6, 6, 8, 8, 9, 10, 10, 11, 11, 12],
    },
    harbors: { spots: 'auto', pool: seafarersHarbors(players), zones: ['home'] },
    robber: 'token:12',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({ setupZones: ['home'] }),
  hooks: {
    afterEdge(state, player, edge) {
      revealFogAround(state, player, edge);
    },
  },
};

// 4 ---------------------------------------------------------------------------

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
  map: (players): MapSpec => ({
    rows: [
      '~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~',
      '~  ~  ?s@strip ?s@strip ?s@strip ?s@strip ?s@strip ~ ~ ~ ~',
      '~  ~  d@home ~  d@home ~  d@home ~  ~  ?i ~',
      '~  ?@home ?@home ?@home ?@home ?@home ?@home ~ ~ ?i ~',
      '~  ?@home ?@home ?@home ?@home ?@home ?@home ~ ~ ~ ~',
      '~  ~  ?@home ?@home ?@home ?@home ~  ~  $4 $11 ~',
      '~  ~  ~  ~  ~  ~  ~  ~  ~  ~  ~',
    ],
    pools: {
      default: {
        terrains: { forest: 4, pasture: 3, fields: 3, hills: 3, mountains: 3 },
        tokens: [2, 3, 3, 4, 5, 6, 6, 8, 8, 9, 10, 10, 11, 12, 4, 5],
      },
      s: { terrains: { forest: 1, pasture: 1, fields: 1, hills: 1, mountains: 1 }, tokens: [3, 6, 8, 10, 11] },
      i: { terrains: { pasture: 1, fields: 1 }, tokens: [5, 9] },
    },
    harbors: { spots: 'auto', pool: seafarersHarbors(players), zones: ['home', 'strip'] },
    robber: 'desert',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({ setupZones: ['home'], islandBonus: { vp: 2, home: ['home'] } }),
  hooks: {},
};
