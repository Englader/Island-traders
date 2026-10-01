import { harborAt, type MapSpec } from '../board/mapSpec.js';
import type { GameOptions } from '../core/types.js';
import type { ScenarioDef } from '../scenarios/types.js';

/**
 * "Starting Map for Beginners" of the 5th-edition Cities & Knights rules
 * (2020 Game Rules & Almanac, Illustration D on page 4, repeated on the
 * Game Overview on page 20): the 19 hexes and 18 number tokens, and 9
 * harbor tokens on the frame. The rulebook prints no starting positions;
 * the snake draft is played as usual. Hexes are pointy-top as in the
 * rulebook, rows in odd-r offset like the base game's beginners' map, and
 * the harbors stand on the same frame spots as that map's, with the types
 * the C&K illustration shows. The 2025 rulebook keeps the same hexes and
 * numbers (its frame prints other harbors; not used here).
 *
 *   row 1:    hills 6   mountains 2  hills 5
 *   row 2:  forest 3  mountains 9  desert  forest 10
 *   row 3: forest 8  fields 4  hills 11  pasture 3  fields 8
 *   row 4:  pasture 10  fields 5  mountains 6  pasture 4
 *   row 5:    fields 9  pasture 12  forest 11
 */
export const CK_BEGINNERS: MapSpec = {
  rows: [
    '.   .   ~   ~   ~   ~',
    '.   ~   h6  m2  h5  ~',
    '.   ~   f3  m9  d   f10 ~',
    '~   f8  g4  h11 p3  g8  ~',
    '.   ~   p10 g5  m6  p4  ~',
    '.   ~   g9  p12 f11 ~',
    '.   .   ~   ~   ~   ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('2,1', 'NW', 'brick'),
      harborAt('3,1', 'NE', 'ore'),
      harborAt('5,2', 'NE', 'lumber'),
      harborAt('5,3', 'E', 'grain'),
      harborAt('5,4', 'SE', 'generic'),
      harborAt('3,5', 'SE', 'generic'),
      harborAt('2,5', 'SW', 'generic'),
      harborAt('2,4', 'W', 'wool'),
      harborAt('2,2', 'W', 'generic'),
    ],
    pool: [],
  },
  // The robber starts on the desert but may not move before the first barbarian attack.
  robber: 'desert',
  pirate: null,
};

/**
 * The map for a Cities & Knights game, or null to use the scenario's own:
 * the beginners' map for the base game with 3-4 players on the official
 * layout. The random layout is the base game's variable set-up ("Normally,
 * you play Cities & Knights on a random, variable game board", p. 3).
 */
export function ckMapSpec(scenario: ScenarioDef, players: number, options: GameOptions): MapSpec | null {
  if (scenario.id !== 'base' || players > 4 || options.layout === 'random') return null;
  return CK_BEGINNERS;
}
