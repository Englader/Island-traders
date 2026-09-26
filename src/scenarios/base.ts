import { baseCells, harborAt, islandWithSeaRing, type MapSpec } from '../board/mapSpec.js';
import {
  BANK_5_6,
  BANK_BASE,
  DEV_DECK_5_6,
  DEV_DECK_BASE,
  HARBORS_5_6,
  HARBORS_BASE,
  TERRAIN_5_6,
  TERRAIN_BASE,
  TOKENS_28,
  TOKENS_BASE_SPIRAL,
} from '../core/constants.js';
import { baseRules, type ScenarioDef } from './types.js';

/**
 * "Starting Set-up for Beginners": Illustration A of the 5th-edition base
 * rules (Game Rules & Almanac, 2020, page 3), with the harbors printed on the
 * frame. The starting settlements shown there are not pre-placed.
 */
const BEGINNERS_3_4: MapSpec = {
  rows: [
    '.   .   ~   ~   ~   ~',
    '.   ~   m10 p2  f9  ~',
    '.   ~   g12 h6  p4  h10 ~',
    '~   g9  f11 d   f3  m8  ~',
    '.   ~   f8  m3  g4  p5  ~',
    '.   ~   h5  g6  p11 ~',
    '.   .   ~   ~   ~   ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('2,1', 'NW', 'generic'),
      harborAt('3,1', 'NE', 'grain'),
      harborAt('5,2', 'NE', 'ore'),
      harborAt('5,3', 'E', 'generic'),
      harborAt('5,4', 'SE', 'wool'),
      harborAt('3,5', 'SE', 'generic'),
      harborAt('2,5', 'SW', 'generic'),
      harborAt('2,4', 'W', 'brick'),
      harborAt('2,2', 'W', 'lumber'),
    ],
    pool: [],
  },
  robber: 'desert',
  pirate: null,
};

/**
 * "Starting Set-up for 5-6 New Players" of the CATAN 5-6 rules (2022,
 * page 5): the 30 hexes and the 11 harbors of the frame with its four small
 * pieces (the 2:1 wool piece at the "3-3" joint, the 3:1 piece at "5-5").
 */
const BEGINNERS_5_6: MapSpec = {
  rows: [
    '.   .   ~   ~   ~   ~',
    '.   ~   h10 p6  d   ~',
    '.   ~   h6  g2  m9  h11 ~',
    '~   f3  m11 f5  g10 p4  ~',
    '~   d   p5  g4  m6  p3  g8  ~',
    '~   f12 m10 p2  h4  f11 ~',
    '.   ~   f8  g3  f9  g5  ~',
    '.   ~   h9  p12 m8  ~',
    '.   .   ~   ~   ~   ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('2,1', 'NW', 'generic'),
      harborAt('3,1', 'NE', 'wool'),
      harborAt('5,2', 'NE', 'generic'),
      harborAt('6,4', 'E', 'generic'),
      harborAt('5,5', 'SE', 'brick'),
      harborAt('4,7', 'E', 'wool'),
      harborAt('3,7', 'SE', 'lumber'),
      harborAt('2,7', 'SW', 'generic'),
      harborAt('2,6', 'W', 'grain'),
      harborAt('1,4', 'SW', 'generic'),
      harborAt('1,3', 'W', 'ore'),
    ],
    pool: [],
  },
  robber: 'desert',
  pirate: null,
};

/**
 * "Scenario 0": the base game. 3-4 players use the 19-hex island, 5-6
 * players the 30-hex board of the 5-6 extension. The official maps are the
 * beginners' set-ups; the random set-up is the rulebooks' variable set-up
 * (the A-R spiral or random tokens; 28 tokens and 11 harbors for 5-6).
 */
export const baseGame: ScenarioDef = {
  id: 'base',
  name: 'Base game',
  expansion: 'base',
  description: 'The standard island. 10 VP to win.',
  minPlayers: 3,
  maxPlayers: 6,
  victoryPoints: () => 10,
  officialMap: (players) => (players >= 5 ? BEGINNERS_5_6 : BEGINNERS_3_4),
  map(players): MapSpec {
    if (players >= 5) {
      return {
        cells: islandWithSeaRing([3, 4, 5, 6, 5, 4, 3]),
        pools: { default: { terrains: TERRAIN_5_6, tokens: TOKENS_28 } },
        harbors: { spots: 'auto', pool: HARBORS_5_6 },
        robber: 'desert',
        pirate: null,
      };
    }
    return {
      cells: baseCells(),
      pools: { default: { terrains: TERRAIN_BASE, tokens: TOKENS_BASE_SPIRAL } },
      harbors: { spots: 'ring', pool: HARBORS_BASE },
      robber: 'desert',
      pirate: null,
      spiral: true,
    };
  },
  bankSize: (players) => (players >= 5 ? BANK_5_6 : BANK_BASE),
  devDeck: (players) => (players >= 5 ? DEV_DECK_5_6 : DEV_DECK_BASE),
  rules: baseRules(),
  hooks: {},
};
