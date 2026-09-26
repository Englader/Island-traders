import { baseCells, islandWithSeaRing, type MapSpec } from '../board/mapSpec.js';
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
 * "Scenario 0": the base game. 3-4 players use the 19-hex island with the
 * official A-R spiral (or random tokens); 5-6 players use the 30-hex board of
 * the 5-6 extension with 28 tokens and 11 harbors.
 */
export const baseGame: ScenarioDef = {
  id: 'base',
  name: 'Catan (base game)',
  expansion: 'base',
  description: 'Standard island with variable setup. 10 VP to win.',
  minPlayers: 3,
  maxPlayers: 6,
  victoryPoints: () => 10,
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
