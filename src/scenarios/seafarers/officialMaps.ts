import { harborAt, type MapSpec, type PoolSpec } from '../../board/mapSpec.js';
import { HARBORS_BASE } from '../../core/constants.js';
import type { HarborType } from '../../core/types.js';

/*
 * The set-up maps printed in the 5th-edition Seafarers rulebook ("Game Rules
 * & Scenarios", rules as of December 1, 2020, catan.com), one per scenario and
 * player count, with the page each comes from. They were read from the PDF's
 * tile images and number tokens and checked against the 2007 (4th-edition)
 * rulebook, whose maps are the same except the Fog Islands for 4 players.
 *
 * The book draws flat-topped hexes. These rows are the book turned a quarter
 * turn counter-clockwise (the book's top edge is on the left), so a phone
 * showing the board upright sees it exactly as printed. The outer ring of
 * sea is the frame.
 *
 * Harbors keep the types printed on the map. Where the map shows blank
 * harbors, the rulebook deals the types at random onto the printed spots.
 */

/** Scenario 3: the face-down stack for the unexplored hexes (tiles and numbers), 3 players. */
const FOG_STACK_3: PoolSpec = {
  terrains: { sea: 2, gold: 2, fields: 2, hills: 2, mountains: 2, pasture: 1, forest: 1 },
  tokens: [3, 3, 4, 5, 6, 8, 9, 10, 11, 12],
};

/** The same with 4 players: one 3 fewer, one 11 more. */
const FOG_STACK_4: PoolSpec = {
  terrains: { sea: 2, gold: 2, fields: 2, hills: 2, mountains: 2, pasture: 1, forest: 1 },
  tokens: [3, 4, 5, 6, 8, 9, 10, 11, 11, 12],
};

/** Scenario 7 uses 8 harbors: the five 2:1 harbors and three 3:1. */
const PIRATE_HARBORS: readonly HarborType[] = ['generic', 'generic', 'generic', 'brick', 'lumber', 'wool', 'grain', 'ore'];

/**
 * Scenario 9 (page 31): the New World frame. All 42 hexes (19 sea, 23 land)
 * are shuffled into it; the rulebook deals the whole map at random.
 */
export const NEW_WORLD_FRAME_3_4: readonly string[] = [
  '. . ~ ~ ~ ~ ~ ~',
  '. ~ ? ? ? ? ? ~',
  '. ~ ? ? ? ? ? ? ~',
  '~ ? ? ? ? ? ? ? ~',
  '. ~ ? ? ? ? ? ? ~',
  '~ ? ? ? ? ? ? ? ~',
  '. ~ ? ? ? ? ? ? ~',
  '. ~ ? ? ? ? ? ~',
  '. . ~ ~ ~ ~ ~ ~',
];

/** The 63-hex New World frame of the Seafarers 5-6 rules (2023, page 23): 21 sea and 42 land. */
export const NEW_WORLD_FRAME_5_6: readonly string[] = [
  '. . ~ ~ ~ ~ ~ ~ ~ ~ ~',
  '. ~ ? ? ? ? ? ? ? ? ~',
  '. ~ ? ? ? ? ? ? ? ? ? ~',
  '~ ? ? ? ? ? ? ? ? ? ? ~',
  '. ~ ? ? ? ? ? ? ? ? ? ~',
  '~ ? ? ? ? ? ? ? ? ? ? ~',
  '. ~ ? ? ? ? ? ? ? ? ? ~',
  '. ~ ? ? ? ? ? ? ? ? ~',
  '. . ~ ~ ~ ~ ~ ~ ~ ~ ~',
];

/** Scenario 1, 3 players (page 9). The robber starts on the hills 12, the pirate on the frame. */
export const NEW_SHORES_3: MapSpec = {
  rows: [
    '.        .        ~        ~        ~        ~        ~',
    '.        ~        h12      $5       ~        ~        ~',
    '.        ~        ~        ~        ~        p4       m9       ~',
    '~        ~        g4@main  p6@main  ~        g3       ~        ~',
    '.        ~        p2@main  m5@main  f10@main ~        $4       ~',
    '~        h8@main  p10@main p9@main  f8@main  ~        ~        ~',
    '.        ~        g11@main m3@main  h11@main ~        m8       ~',
    '.        ~        g6@main  f5@main  ~        h10      ~',
    '.        .        ~        ~        ~        ~        ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('1,5', 'NW', 'ore'),
      harborAt('1,5', 'SW', 'generic'),
      harborAt('2,7', 'W', 'brick'),
      harborAt('3,7', 'SW', 'lumber'),
      harborAt('3,7', 'E', 'generic'),
      harborAt('3,3', 'E', 'generic'),
      harborAt('4,5', 'NE', 'wool'),
      harborAt('2,3', 'W', 'grain'),
    ],
    pool: [],
  },
  robber: '2,1',
  pirate: '7,4',
};

/**
 * Scenario 1, 4 players (page 10). "Randomly place the harbor tokens": the
 * harbors are blank, their types shuffled.
 */
export const NEW_SHORES_4: MapSpec = {
  rows: [
    '.        .        ~        ~        ~        ~        ~        ~',
    '.        ~        m8       p11      ~        $4       ~        ~',
    '.        ~        ~        ~        ~        ~        h5       m2       ~',
    '~        ~        p5@main  f6@main  m4@main  ~        f9       ~        ~',
    '.        ~        g12@main h11@main g3@main  p9@main  ~        $10      ~',
    '~        h6@main  f10@main d@main   g11@main f5@main  ~        ~        ~',
    '.        ~        m3@main  p4@main  h9@main  p8@main  ~        h3       ~',
    '.        ~        g8@main  f2@main  m10@main ~        g6       ~',
    '.        .        ~        ~        ~        ~        ~        ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('2,4', 'W'),
      harborAt('2,6', 'W'),
      harborAt('2,7', 'SW'),
      harborAt('3,7', 'SE'),
      harborAt('5,6', 'SE'),
      harborAt('5,5', 'E'),
      harborAt('5,4', 'NE'),
      harborAt('2,3', 'NW'),
      harborAt('3,3', 'NE'),
    ],
    pool: HARBORS_BASE,
  },
  robber: '3,5',
  pirate: '8,4',
};

/** Scenario 2, 3 players (page 12). The robber starts on the 12. */
export const FOUR_ISLANDS_3: MapSpec = {
  rows: [
    '.   .   ~   ~   ~   ~   ~',
    '.   ~   ~   ~   g4  p3  ~',
    '.   ~   m4  f9  ~   g9  h5  ~',
    '~   p6  m10 ~   f8  h11 ~   ~',
    '.   ~   ~   ~   ~   ~   ~   ~',
    '~   g11 m8  f3  ~   h10 h6  ~',
    '.   ~   f5  p9  ~   m2  g5  ~',
    '.   ~   p12 ~   ~   ~   ~',
    '.   .   ~   ~   ~   ~   ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('5,6', 'NW', 'generic'),
      harborAt('1,5', 'SW', 'generic'),
      harborAt('5,3', 'SW', 'brick'),
      harborAt('6,5', 'SE', 'grain'),
      harborAt('1,5', 'NE', 'lumber'),
      harborAt('1,3', 'NW', 'generic'),
      harborAt('6,2', 'NE', 'generic'),
      harborAt('3,6', 'SE', 'wool'),
      harborAt('3,2', 'SE', 'ore'),
    ],
    pool: [],
  },
  robber: '2,7',
  pirate: '4,4',
};

/** Scenario 2, 4 players (page 13). The robber starts on the 12. */
export const FOUR_ISLANDS_4: MapSpec = {
  rows: [
    '.   .   ~   ~   ~   ~   ~',
    '.   ~   p8  ~   f9  f11 ~',
    '.   ~   h10 ~   m3  g12 p5  ~',
    '~   g5  f3  ~   h5  m10 ~   ~',
    '.   ~   ~   ~   f6  ~   ~   ~',
    '~   h4  p9  ~   ~   f9  p11 ~',
    '.   ~   g6  m4  h2  ~   m8  ~',
    '.   ~   p10 g11 ~   g4  ~',
    '.   .   ~   ~   ~   ~   ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('6,5', 'NW', 'ore'),
      harborAt('1,5', 'SW', 'brick'),
      harborAt('2,7', 'W', 'wool'),
      harborAt('1,3', 'SE', 'generic'),
      harborAt('3,6', 'NE', 'generic'),
      harborAt('2,2', 'W', 'grain'),
      harborAt('6,5', 'SE', 'generic'),
      harborAt('4,4', 'NW', 'generic'),
      harborAt('6,2', 'SE', 'lumber'),
    ],
    pool: [],
  },
  robber: '5,2',
  pirate: '7,4',
};

/** Scenario 3, 3 players (page 15). The x hexes start unexplored; the robber starts on the 12. */
export const FOG_ISLANDS_3: MapSpec = {
  rows: [
    '.        .        ~        ~        ~        ~        ~        ~',
    '.        ~        x        x        ~        h6@home  f11@home ~',
    '.        ~        x        x        x        ~        f5@home  g3@home  ~',
    '~        ~        ~        ~        x        ~        p8@home  p9@home  ~',
    '.        ~        f6@home  p5@home  ~        x        ~        m4@home  ~',
    '~        ~        h11@home f9@home  ~        x        ~        ~        ~',
    '.        ~        ~        m8@home  g10@home ~        x        x        ~',
    '.        ~        ~        p12@home ~        x        x        ~',
    '.        .        ~        ~        ~        ~        ~        ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('2,4', 'SW', 'ore'),
      harborAt('3,7', 'W', 'generic'),
      harborAt('4,6', 'SE', 'brick'),
      harborAt('5,1', 'NE', 'generic'),
      harborAt('2,5', 'SW', 'lumber'),
      harborAt('7,3', 'NE', 'grain'),
      harborAt('6,1', 'E', 'wool'),
      harborAt('7,4', 'E', 'generic'),
    ],
    pool: [],
  },
  robber: '3,7',
  pirate: '1,4',
  fog: FOG_STACK_3,
};

/**
 * Scenario 3, 4 players (page 16). Earlier printings differ in a few numbers
 * and swap two hexes; this version matches the scenario's component list.
 * The text puts the robber on the 12; the drawing leaves the figure on the
 * neighbouring 8, where the 12 used to be.
 */
export const FOG_ISLANDS_4: MapSpec = {
  rows: [
    '.        .        ~        ~        ~        ~        ~        ~',
    '.        ~        x        ~        h4@home  g10@home m3@home  ~',
    '.        ~        x        x        ~        p9@home  f6@home  h12@home ~',
    '~        ~        ~        x        ~        ~        p10@home m8@home  ~',
    '.        ~        m3@home  ~        x        x        ~        g11@home ~',
    '~        g6@home  f4@home  ~        x        x        ~        f5@home  ~',
    '.        ~        h9@home  p8@home  ~        x        x        ~        ~',
    '.        ~        p2@home  f5@home  ~        x        x        ~',
    '.        .        ~        ~        ~        ~        ~        ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('1,5', 'SW', 'ore'),
      harborAt('2,7', 'W', 'generic'),
      harborAt('2,7', 'SE', 'generic'),
      harborAt('4,1', 'NE', 'wool'),
      harborAt('7,5', 'NE', 'generic'),
      harborAt('6,1', 'E', 'generic'),
      harborAt('6,1', 'NW', 'grain'),
      harborAt('2,4', 'W', 'lumber'),
      harborAt('7,3', 'NE', 'brick'),
    ],
    pool: [],
  },
  robber: '7,2',
  pirate: '1,4',
  fog: FOG_STACK_4,
};

/** Scenario 4, 3 players (page 18). The strip beyond the deserts: fields 6, forest 3, gold 4. */
export const THROUGH_THE_DESERT_3: MapSpec = {
  rows: [
    '.        .        ~        ~        ~        ~        ~',
    '.        ~        $4@strip d@home   ~        m8       ~',
    '.        ~        f3@strip d@home   f4@home  ~        p11      ~',
    '~        g6@strip d@home   h5@home  p6@home  ~        ~        ~',
    '.        ~        ~        m3@home  f10@home ~        $5       ~',
    '~        f11@home h6@home  g2@home  h9@home  ~        ~        ~',
    '.        ~        m10@home g9@home  f8@home  ~        g9       ~',
    '.        ~        p8@home  p4@home  ~        m5       ~',
    '.        .        ~        ~        ~        ~        ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('2,5', 'NW', 'grain'),
      harborAt('1,5', 'SW', 'wool'),
      harborAt('4,2', 'NE', 'lumber'),
      harborAt('4,5', 'NE', 'generic'),
      harborAt('2,7', 'SE', 'brick'),
      harborAt('4,5', 'SE', 'generic'),
      harborAt('2,7', 'W', 'ore'),
      harborAt('3,7', 'E', 'generic'),
    ],
    pool: [],
  },
  robber: '3,2',
  pirate: '7,4',
};

/** Scenario 4, 4 players (page 19). The strip beyond the deserts: fields 8, mountains 11, gold 10. */
export const THROUGH_THE_DESERT_4: MapSpec = {
  rows: [
    '.         .         ~         ~         ~         ~         ~         ~',
    '.         ~         $10@strip d@home    f5@home   ~         m9        ~',
    '.         ~         m11@strip d@home    h3@home   p6@home   ~         g4        ~',
    '~         g8@strip  d@home    m8@home   g10@home  f4@home   ~         h2        ~',
    '.         ~         ~         f10@home  h11@home  p9@home   ~         ~         ~',
    '~         h12@home  h6@home   g5@home   f8@home   ~         $5        p3        ~',
    '.         ~         p3@home   p11@home  m4@home   ~         ~         ~         ~',
    '.         ~         ~         f9@home   ~         m6        g12       ~',
    '.         .         ~         ~         ~         ~         ~         ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('3,7', 'SW', 'generic'),
      harborAt('2,6', 'W', 'grain'),
      harborAt('2,6', 'SE', 'ore'),
      harborAt('5,3', 'NE', 'generic'),
      harborAt('3,7', 'E', 'lumber'),
      harborAt('3,4', 'W', 'wool'),
      harborAt('5,3', 'SE', 'generic'),
      harborAt('4,1', 'E', 'brick'),
      harborAt('4,5', 'SE', 'generic'),
    ],
    pool: [],
  },
  robber: '3,2',
  pirate: '8,4',
};

/**
 * Scenario 5, 3-4 players (page 21): 8 VP chits, 6 harbors (turned face up
 * at random) and 4 development cards on the marked coasts of the tribe
 * islands, which have no numbers.
 */
export const FORGOTTEN_TRIBE: MapSpec = {
  rows: [
    '.       .       ~       ~       ~       ~       ~       ~       ~',
    '.       ~       $@tribe m@tribe ~       d@tribe m@tribe g@tribe ~',
    '.       ~       ~       ~       ~       ~       ~       ~       ~       ~',
    '~       g6      f9      m11     h5      f6      m4      ~       p@tribe ~',
    '.       ~       p10     h8      p4      g12     f5      p2      ~       ~',
    '~       f11     g9      m3      p8      h10     g3      ~       f@tribe ~',
    '.       ~       ~       ~       ~       ~       ~       ~       ~       ~',
    '.       ~       d@tribe h@tribe ~       h@tribe d@tribe $@tribe ~',
    '.       .       ~       ~       ~       ~       ~       ~       ~',
  ],
  pools: {},
  // No harbors on the map: they are gifts of the tribe.
  harbors: null,
  robber: '6,7',
  pirate: '4,1',
  marks: {
    vp: [
      { at: '2,7', side: 'SE' },
      { at: '2,1', side: 'NE' },
      { at: '5,7', side: 'SW' },
      { at: '7,7', side: 'SE' },
      { at: '8,5', side: 'E' },
      { at: '8,3', side: 'E' },
      { at: '5,1', side: 'NE' },
      { at: '7,1', side: 'NE' },
    ],
    harbor: [
      { at: '2,7', side: 'SW' },
      { at: '2,1', side: 'NW' },
      { at: '5,7', side: 'SE' },
      { at: '8,5', side: 'SE' },
      { at: '8,3', side: 'NE' },
      { at: '5,1', side: 'NW' },
    ],
    devCard: [
      { at: '2,7', side: 'W' },
      { at: '2,1', side: 'W' },
      { at: '7,7', side: 'E' },
      { at: '7,1', side: 'E' },
    ],
  },
};

/**
 * Scenario 6, 3-4 players (page 23): two villages with their numbers on each
 * of the four tribe islands. The robber starts on the fields 12.
 */
export const CLOTH_FOR_CATAN: MapSpec = {
  rows: [
    '.      .      ~      ~      ~      ~      ~      ~',
    '.      ~      f4     p6     h5     p11    g8     ~',
    '.      ~      g3     f12    ~      ~      f3     m9     ~',
    '~      g12    ~      ~      $@isle ~      ~      ~      ~',
    '.      ~      ~      d@isle ~      ~      d@isle ~      ~',
    '~      ~      ~      ~      $@isle ~      ~      m2     ~',
    '.      ~      h9     g2     ~      ~      p11    m4     ~',
    '.      ~      p10    f6     m5     g10    h8     ~',
    '.      .      ~      ~      ~      ~      ~      ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('3,7', 'SW'),
      harborAt('2,6', 'W'),
      harborAt('2,1', 'NE'),
      harborAt('7,5', 'E'),
      harborAt('2,2', 'W'),
      harborAt('7,6', 'SE'),
      harborAt('7,2', 'E'),
      harborAt('5,7', 'SE'),
      harborAt('5,1', 'NW'),
    ],
    pool: HARBORS_BASE,
  },
  robber: '1,3',
  pirate: '8,4',
  marks: {
    village: [
      { at: '3,4', corner: 'S', value: 9 },
      { at: '3,4', corner: 'N', value: 10 },
      { at: '4,5', corner: 'S', value: 3 },
      { at: '4,5', corner: 'N', value: 6 },
      { at: '4,3', corner: 'S', value: 8 },
      { at: '4,3', corner: 'N', value: 11 },
      { at: '6,4', corner: 'S', value: 5 },
      { at: '6,4', corner: 'N', value: 4 },
    ],
  },
};

/**
 * Scenario 7, 3-4 players (page 25). Per seat, in the order orange, blue,
 * red, white (3 players leave out white): the pirate fortress, the marked
 * intersection, and the pre-placed settlement and ship. The pasture of the
 * left desert islet and the two western hills have no number. The fleet sails
 * the circuit clockwise, starting at the pirate ship.
 */
export const PIRATE_ISLANDS: MapSpec = {
  rows: [
    '.        .        ~        ~        ~        ~        ~        ~        ~',
    '.        ~        $11@way  m6@way   ~        ~        g4@main  h5@main  ~',
    '.        ~        h@way    ~        ~        d@desert ~        m9@main  f10@main ~',
    '~        g4@way   ~        ~        d@desert ~        f3@main  p8@main  f5@main  ~',
    '.        ~        ~        m8@way   ~        ~        g6@main  h9@main  p12@main ~',
    '~        g10@way  ~        ~        d@desert ~        p11@main f8@main  p9@main  ~',
    '.        ~        h@way    ~        ~        p@desert ~        m5@main  f2@main  ~',
    '.        ~        $3@way   m6@way   ~        ~        g10@main h4@main  ~',
    '.        .        ~        ~        ~        ~        ~        ~        ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('6,7', 'SE'),
      harborAt('8,5', 'SE'),
      harborAt('7,1', 'NW'),
      harborAt('6,1', 'NW'),
      harborAt('8,6', 'SE'),
      harborAt('8,2', 'E'),
      harborAt('7,1', 'E'),
      harborAt('8,4', 'E'),
    ],
    pool: PIRATE_HARBORS,
  },
  robber: 'offboard',
  pirate: '5,7',
  marks: {
    fortress: [
      { at: '2,7', corner: 'S' },
      { at: '2,6', corner: 'N' },
      { at: '2,1', corner: 'N' },
      { at: '2,2', corner: 'S' },
    ],
    waypoint: [
      { at: '3,7', corner: 'SE' },
      { at: '3,4', corner: 'S' },
      { at: '3,1', corner: 'NE' },
      { at: '3,4', corner: 'N' },
    ],
    start: [
      { at: '6,7', corner: 'N' },
      { at: '6,4', corner: 'S' },
      { at: '6,1', corner: 'S' },
      { at: '6,4', corner: 'N' },
    ],
    startShip: [
      { at: '6,7', side: 'NW' },
      { at: '6,4', side: 'SW' },
      { at: '6,1', side: 'SW' },
      { at: '6,4', side: 'NW' },
    ],
    circuit: [
      { at: '5,7' },
      { at: '4,7' },
      { at: '4,6' },
      { at: '3,5' },
      { at: '4,4' },
      { at: '3,3' },
      { at: '4,2' },
      { at: '4,1' },
      { at: '5,1' },
      { at: '6,2' },
      { at: '5,3' },
      { at: '5,4' },
      { at: '5,5' },
      { at: '6,6' },
    ],
  },
};

/**
 * Scenario 8, 3-4 players (page 29): the two strait intersections (purple
 * squares) and the five desert-wasteland intersections (brown squares). No
 * pirate.
 */
export const WONDERS_OF_CATAN: MapSpec = {
  rows: [
    '.        .        ~        ~        ~        ~        ~        ~        ~',
    '.        ~        $8       h2       ~        m10@main ~        ~        ~',
    '.        ~        ~        ~        ~        f11@main ~        d@main   ~        ~',
    '~        m12@main g6@main  h11@main g10@main p3@main  f9@main  d@main   ~        ~',
    '.        ~        m3@main  g4@main  m6@main  p5@main  h4@main  d@main   ~        ~',
    '~        h8@main  p9@main  ~        ~        h10@main ~        ~        $6       ~',
    '.        ~        ~        f3@main  ~        f8@main  g9@main  ~        f4       ~',
    '.        ~        m5@main  ~        p11@main p2@main  ~        g5       ~',
    '.        .        ~        ~        ~        ~        ~        ~        ~',
  ],
  pools: {},
  harbors: {
    spots: [
      harborAt('3,4', 'SE'),
      harborAt('6,6', 'SE'),
      harborAt('4,3', 'NW'),
      harborAt('2,3', 'NW'),
      harborAt('4,7', 'SE'),
      harborAt('2,4', 'W'),
      harborAt('5,3', 'NE'),
      harborAt('3,6', 'W'),
      harborAt('6,6', 'NE'),
    ],
    pool: HARBORS_BASE,
  },
  robber: '7,3',
  pirate: null,
  marks: {
    strait: [
      { at: '3,6', corner: 'SE' },
      { at: '4,7', corner: 'NW' },
    ],
    wasteland: [
      { at: '7,4', corner: 'SW' },
      { at: '7,4', corner: 'NW' },
      { at: '7,2', corner: 'SW' },
      { at: '7,4', corner: 'N' },
      { at: '7,2', corner: 'S' },
    ],
  },
};
