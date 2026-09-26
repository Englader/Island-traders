import type { MapSpec } from '../../board/mapSpec.js';
import { HARBORS_BASE, HARBORS_SEAFARERS, TERRAIN_BASE, TOKENS_28, TOKENS_BASE_SPIRAL } from '../../core/constants.js';
import { seafarersRules, type ScenarioDef } from '../types.js';
import { revealFogAround, seafarersSupply } from './common.js';

/*
 * Maps below are original layouts that follow each scenario's structure (main
 * island + outlying islands, desert barrier, fog area, ...). Official
 * layouts can be dropped in as MapSpec data without code changes.
 */

// 1 ---------------------------------------------------------------------------

export const headingForNewShores: ScenarioDef = {
  id: 'seafarers-1-new-shores',
  name: 'Heading for New Shores',
  expansion: 'seafarers',
  description:
    'Start on the main island. Your first settlement on each small island earns 2 VP (Catan chits). 14 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 14,
  map: (): MapSpec => ({
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
    harbors: { spots: 'auto', pool: HARBORS_BASE, zones: ['main'] },
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
  map: (): MapSpec => ({
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
    pools: {
      default: {
        terrains: { forest: 5, pasture: 5, fields: 5, hills: 5, mountains: 5, gold: 2, desert: 1 },
        tokens: TOKENS_28,
      },
    },
    harbors: { spots: 'auto', pool: HARBORS_SEAFARERS },
    robber: 'desert',
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
    'The east is unexplored. A road or ship touching a fog hex reveals it; new land gets a random number and pays the discoverer 1 card. 12 VP to win.',
  minPlayers: 3,
  maxPlayers: 4,
  victoryPoints: () => 12,
  map: (): MapSpec => ({
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      '~ ? ? ~ ~ x x x x x ~',
      '~ ? ? ? ~ x x x x x ~',
      '~ ? ?@home ? ~ ~ x x x x ~',
      '~ ? ? ? ~ x x x x x ~',
      '~ ? ? ~ ~ x x x x x ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      default: {
        terrains: { forest: 3, pasture: 3, fields: 2, hills: 2, mountains: 2, desert: 1 },
        tokens: [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 5, 9],
      },
    },
    fog: {
      terrains: { forest: 2, pasture: 2, fields: 3, hills: 3, mountains: 3, gold: 2, sea: 9 },
      tokens: [2, 3, 3, 4, 4, 5, 6, 6, 8, 8, 9, 10, 10, 11, 11, 12],
    },
    harbors: { spots: 'auto', pool: ['generic', 'generic', 'lumber', 'grain', 'ore'], zones: ['home'] },
    robber: 'desert',
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
  map: (): MapSpec => ({
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
    harbors: { spots: 'auto', pool: HARBORS_BASE, zones: ['home', 'strip'] },
    robber: 'desert',
    pirate: 'offboard',
  }),
  ...seafarersSupply,
  rules: seafarersRules({ setupZones: ['home'], islandBonus: { vp: 2, home: ['home'] } }),
  hooks: {},
};
