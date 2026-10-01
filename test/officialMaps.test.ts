import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SCENARIOS,
  HARBORS_5_6,
  HARBORS_BASE,
  TOKENS_28,
  createGame,
  currentSetupPlayer,
  hexCenter,
  isLandHex,
  legalSetupSettlements,
  parseHexId,
  seedRng,
  simulate,
  topo,
  viewFor,
  vertexZones,
  type GameState,
  type HexId,
  type HexState,
} from '../src/index.js';
import { TRIBE_HARBORS } from '../src/scenarios/seafarers/tribes.js';
import { straitVertices, wastelandVertices } from '../src/scenarios/seafarers/wonders.js';

const CODE: Record<string, string> = { sea: '~', hills: 'h', forest: 'f', pasture: 'p', fields: 'g', mountains: 'm', desert: 'd', gold: '$', fog: 'x' };
const code = (h: HexState) => CODE[h.terrain] + (h.token ?? '');
const official = (scenario: string, players: number, seed: string | number = 'official') =>
  createGame({ scenario, players, seed, options: { layout: 'official' } });

/*
 * The Seafarers set-up maps as printed in the 5th-edition rulebook (2020
 * rules), and for 5-6 players in the Seafarers 5-6 rules (2023), read column
 * by column from left to right. "2: g6 f5" means the column's first hex is 2
 * half-rows down from the top row, then fields 6 and forest 5 below it; "?"
 * is a hex the rulebook deals at random (New Shores' main island with 5-6
 * players). Harbors are "column,half-row side [type]" with the sides as
 * printed (N is up the page); a harbor without a type is dealt at random.
 */
const BOOK: Record<string, { columns: string[]; harbors: string[] }> = {
  // page 9
  'seafarers-1-new-shores/3': {
    columns: [
      '2: g6 f5 ~ h10',
      '1: g11 m3 h11 ~ m8',
      '0: h8 p10 p9 f8 ~ ~',
      '1: p2 m5 f10 ~ $4',
      '0: ~ g4 p6 ~ g3 ~',
      '1: ~ ~ ~ p4 m9',
      '2: h12 $5 ~ ~',
    ],
    harbors: ['0,2 N brick', '0,4 NW lumber', '0,4 S generic', '2,0 NE ore', '2,0 NW generic', '2,6 SE wool', '4,2 N grain', '4,4 S generic'],
  },
  // page 10
  'seafarers-1-new-shores/4': {
    columns: [
      '2: g8 f2 m10 ~ g6',
      '1: m3 p4 h9 p8 ~ h3',
      '0: h6 f10 d g11 f5 ~ ~',
      '1: g12 h11 g3 p9 ~ $10',
      '0: ~ p5 f6 m4 ~ f9 ~',
      '1: ~ ~ ~ ~ h5 m2',
      '2: m8 p11 ~ $4 ~',
    ],
    harbors: ['0,2 NW', '0,4 SW', '1,1 N', '1,7 SW', '2,8 S', '3,1 N', '3,7 SE', '4,2 NE', '4,4 SE'],
  },
  // page 12
  'seafarers-2-four-islands/3': {
    columns: [
      '2: p12 ~ ~ ~',
      '1: f5 p9 ~ m2 g5',
      '0: g11 m8 f3 ~ h10 h6',
      '1: ~ ~ ~ ~ ~',
      '0: p6 m10 ~ f8 h11 ~',
      '1: m4 f9 ~ g9 h5',
      '2: ~ ~ g4 p3',
    ],
    harbors: ['1,3 SW wool', '1,7 NE generic', '2,0 NW generic', '2,0 SE lumber', '2,10 SW grain', '4,0 NE generic', '4,8 NW brick', '5,3 SW ore', '5,9 SE generic'],
  },
  // page 13
  'seafarers-2-four-islands/4': {
    columns: [
      '2: p10 g11 ~ g4',
      '1: g6 m4 h2 ~ m8',
      '0: h4 p9 ~ ~ f9 p11',
      '1: ~ ~ f6 ~ ~',
      '0: g5 f3 ~ h5 m10 ~',
      '1: h10 ~ m3 g12 p5',
      '2: p8 ~ f9 f11',
    ],
    harbors: ['0,2 N wool', '1,3 SE generic', '2,0 NW brick', '2,10 NE ore', '2,10 SW generic', '3,5 NE generic', '4,0 SW generic', '5,1 N grain', '5,9 SW lumber'],
  },
  // page 15
  'seafarers-3-fog-islands/3': {
    columns: [
      '2: ~ p12 ~ x x',
      '1: ~ m8 g10 ~ x x',
      '0: ~ h11 f9 ~ x ~ ~',
      '1: f6 p5 ~ x ~ m4',
      '0: ~ ~ ~ x ~ p8 p9',
      '1: x x x ~ f5 g3',
      '2: x x ~ h6 f11',
    ],
    harbors: ['0,4 N generic', '1,5 SW brick', '2,2 NW lumber', '3,1 NW ore', '3,11 S generic', '4,12 SE grain', '6,10 S wool', '6,8 SE generic'],
  },
  // page 16
  'seafarers-3-fog-islands/4': {
    columns: [
      '2: p2 f5 ~ x x',
      '1: h9 p8 ~ x x ~',
      '0: g6 f4 ~ x x ~ f5',
      '1: m3 ~ x x ~ g11',
      '0: ~ ~ x ~ ~ p10 m8',
      '1: x x ~ p9 f6 h12',
      '2: x ~ h4 g10 m3',
    ],
    harbors: ['0,2 N generic', '0,2 SW generic', '2,0 NW ore', '2,12 SE generic', '3,1 N lumber', '4,12 SE brick', '6,10 NE grain', '6,10 S generic', '6,6 SE wool'],
  },
  // page 18
  'seafarers-4-through-the-desert/3': {
    columns: [
      '2: p8 p4 ~ m5',
      '1: m10 g9 f8 ~ g9',
      '0: f11 h6 g2 h9 ~ ~',
      '1: ~ m3 f10 ~ $5',
      '0: g6 d h5 p6 ~ ~',
      '1: f3 d f4 ~ p11',
      '2: $4 d ~ m8',
    ],
    harbors: ['0,2 N ore', '0,2 SW brick', '0,4 S generic', '2,0 NW wool', '2,2 NE grain', '2,6 SE generic', '2,6 SW generic', '5,5 SE lumber'],
  },
  // page 19
  'seafarers-4-through-the-desert/4': {
    columns: [
      '2: ~ f9 ~ m6 g12',
      '1: p3 p11 m4 ~ ~ ~',
      '0: h12 h6 g5 f8 ~ $5 p3',
      '1: ~ f10 h11 p9 ~ ~',
      '0: g8 d m8 g10 f4 ~ h2',
      '1: m11 d h3 p6 ~ g4',
      '2: $10 d f5 ~ m9',
    ],
    harbors: ['0,4 NW generic', '0,4 S lumber', '1,1 N grain', '1,1 SW ore', '2,6 SW generic', '3,3 N wool', '4,8 SE generic', '4,8 SW generic', '6,6 S brick'],
  },
  // Seafarers 5-6, page 7: the blank main island is built by the CATAN 5-6 variable set-up
  'seafarers-1-new-shores/5-6': {
    columns: [
      '2: $5 ~ ? ? ? ~ $10',
      '1: f2 ~ ? ? ? ? ~ ~',
      '0: h4 ~ ? ? ? ? ? ~ g3',
      '1: ~ ? ? ? ? ? ? ~',
      '0: p8 ~ ? ? ? ? ? ~ h12',
      '1: m11 ~ ? ? ? ? ~ ~',
      '2: $9 ~ ? ? ? ~ m6',
    ],
    harbors: ['0,8 NW', '0,10 SW', '1,5 NW', '1,11 S', '3,3 NW', '3,13 SW', '4,4 N', '4,12 S', '5,5 NE', '5,11 SE', '6,8 SE'],
  },
  // Seafarers 5-6, page 9: The Six Islands
  'seafarers-2-four-islands/5-6': {
    columns: [
      '2: p5 m6 ~ p2 ~ h5 g2',
      '1: f9 g12 ~ g5 m3 ~ h8 p9',
      '0: ~ h4 ~ ~ p8 f10 ~ f5 g6',
      '1: ~ ~ ~ ~ ~ ~ ~ ~',
      '0: h11 g9 ~ p3 f4 ~ ~ f4 ~',
      '1: f8 m10 ~ m11 h10 ~ g3 h10',
      '2: p12 m4 ~ f6 ~ m9 p6',
    ],
    harbors: ['0,4 SE', '0,12 NW', '1,1 N', '1,7 NW', '1,15 S', '4,2 NW', '5,3 SW', '5,13 NW', '6,4 NE', '6,8 SE', '6,14 SE'],
  },
  // Seafarers 5-6, page 11: The Fog Island
  'seafarers-3-fog-islands/5-6': {
    columns: [
      '2: $4 x x x x x x $10',
      '1: x x x x x x x x x',
      '0: x x x ~ ~ ~ ~ x x x',
      '1: x ~ ~ f5 g11 p8 ~ ~ x',
      '0: x ~ f8 g9 h3 m12 g10 f3 ~ x',
      '1: ~ g2 p4 m6 m10 p9 h12 f4 ~',
      '2: h5 p6 m3 d h11 h8 m11 g6',
    ],
    harbors: ['3,9 SW', '4,6 NW', '4,12 SW', '5,3 N', '5,15 S', '6,2 SE', '6,6 NE', '6,10 SE', '6,16 NE'],
  },
  // Seafarers 5-6, page 13 (10 harbor spots on the diagram)
  'seafarers-4-through-the-desert/5-6': {
    columns: [
      '2: p6 ~ p8 g2 ~ $4 ~ g9',
      '1: h9 m11 ~ ~ ~ ~ ~ p11 f3',
      '0: p12 g3 h12 m6 h11 m3 g9 ~ ~ m8',
      '1: m4 f5 g10 h5 p10 f4 h8 ~ ~',
      '0: ~ ~ ~ g2 f8 p9 f10 ~ ~ $10',
      '1: f5 p2 d d d d d ~ ~',
      '2: $4 m6 h11 ~ f12 g5 m3 h6',
    ],
    harbors: ['0,2 NW', '1,1 N', '1,3 SW', '2,4 SW', '2,8 NW', '2,12 NW', '3,1 NE', '3,5 NE', '3,13 SW', '4,12 S'],
  },
  // page 21 (the harbors are the tribe's gifts)
  'seafarers-5-forgotten-tribe': {
    columns: [
      '2: d h ~ h d $',
      '1: ~ ~ ~ ~ ~ ~ ~',
      '0: f11 g9 m3 p8 h10 g3 ~ f',
      '1: p10 h8 p4 g12 f5 p2 ~',
      '0: g6 f9 m11 h5 f6 m4 ~ p',
      '1: ~ ~ ~ ~ ~ ~ ~',
      '2: $ m ~ d m g',
    ],
    harbors: ['0,2 NW', '0,8 SW', '2,14 SW', '4,14 SE', '6,2 NE', '6,8 NE'],
  },
  // page 23
  'seafarers-6-cloth-trade': {
    columns: [
      '2: p10 f6 m5 g10 h8',
      '1: h9 g2 ~ ~ p11 m4',
      '0: ~ ~ ~ $ ~ ~ m2',
      '1: ~ d ~ ~ d ~',
      '0: g12 ~ ~ $ ~ ~ ~',
      '1: g3 f12 ~ ~ f3 m9',
      '2: f4 p6 h5 p11 g8',
    ],
    harbors: ['0,4 NW', '0,8 SW', '1,1 N', '1,11 SW', '2,12 S', '5,1 N', '5,11 S', '6,2 SE', '6,8 NE'],
  },
  // page 25
  'seafarers-7-pirate-islands': {
    columns: [
      '2: $3 m6 ~ ~ g10 h4',
      '1: h ~ ~ p ~ m5 f2',
      '0: g10 ~ ~ d ~ p11 f8 p9',
      '1: ~ m8 ~ ~ g6 h9 p12',
      '0: g4 ~ ~ d ~ f3 p8 f5',
      '1: h ~ ~ d ~ m9 f10',
      '2: $11 m6 ~ ~ g4 h5',
    ],
    harbors: ['0,10 SW', '1,13 SW', '2,14 SW', '3,13 S', '5,13 S', '6,10 NE', '6,12 NE', '6,12 S'],
  },
  // page 29
  'seafarers-8-wonders': {
    columns: [
      '2: m5 ~ p11 p2 ~ g5',
      '1: ~ f3 ~ f8 g9 ~ f4',
      '0: h8 p9 ~ ~ h10 ~ ~ $6',
      '1: m3 g4 m6 p5 h4 d ~',
      '0: m12 g6 h11 g10 p3 f9 d ~',
      '1: ~ ~ ~ f11 ~ d ~',
      '2: $8 h2 ~ m10 ~ ~',
    ],
    harbors: ['0,6 SW', '1,3 N', '1,9 SE', '1,9 SW', '3,1 N', '3,3 SW', '4,2 NE', '4,6 NE', '4,8 SE'],
  },
};

const BOOK_KEYS: Array<[string, number, string]> = [
  ['seafarers-1-new-shores', 3, 'seafarers-1-new-shores/3'],
  ['seafarers-1-new-shores', 4, 'seafarers-1-new-shores/4'],
  ['seafarers-2-four-islands', 3, 'seafarers-2-four-islands/3'],
  ['seafarers-2-four-islands', 4, 'seafarers-2-four-islands/4'],
  ['seafarers-3-fog-islands', 3, 'seafarers-3-fog-islands/3'],
  ['seafarers-3-fog-islands', 4, 'seafarers-3-fog-islands/4'],
  ['seafarers-4-through-the-desert', 3, 'seafarers-4-through-the-desert/3'],
  ['seafarers-4-through-the-desert', 4, 'seafarers-4-through-the-desert/4'],
  ...[5, 6].flatMap((n) =>
    ['seafarers-1-new-shores', 'seafarers-2-four-islands', 'seafarers-3-fog-islands', 'seafarers-4-through-the-desert'].map(
      (id): [string, number, string] => [id, n, `${id}/5-6`],
    ),
  ),
  ...[3, 4].flatMap((n) =>
    ['seafarers-5-forgotten-tribe', 'seafarers-6-cloth-trade', 'seafarers-7-pirate-islands', 'seafarers-8-wonders'].map(
      (id): [string, number, string] => [id, n, id],
    ),
  ),
];

/**
 * Reads a board the way the book prints it: turned a quarter turn clockwise
 * (flat-topped hexes), as "column,half-row" positions counted from the top
 * left hex inside the frame (the outer ring of sea).
 */
function bookPositions(s: GameState): Map<string, HexId> {
  const cells = Object.entries(s.board.hexes).map(([id, h]) => {
    const c = hexCenter(h);
    return { id, x: -c.y, y: c.x };
  });
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const out = new Map<string, HexId>();
  for (const c of cells) {
    const col = Math.round((c.x - minX) / 1.5) - 1;
    const row = Math.round((c.y - minY) / (Math.sqrt(3) / 2)) - 2;
    out.set(`${col},${row}`, c.id);
  }
  return out;
}

/** The side of a hex facing its neighbour, as printed in the book (N is up the page). */
function bookSide(from: HexId, to: HexId): string {
  const a = hexCenter(parseHexId(from));
  const b = hexCenter(parseHexId(to));
  const deg = (Math.atan2(-(b.x - a.x), -(b.y - a.y)) * 180) / Math.PI; // book up = engine left
  const names: Array<[number, string]> = [[90, 'N'], [30, 'NE'], [-30, 'SE'], [-90, 'S'], [-150, 'SW'], [150, 'NW'], [-210, 'NW']];
  return names.reduce((best, n) => (Math.abs(n[0] - deg) < Math.abs(best[0] - deg) ? n : best))[1];
}

describe('official maps: Seafarers, as printed', () => {
  for (const [scenario, n, key] of BOOK_KEYS) {
    it(`${scenario} with ${n} players matches the rulebook hex by hex`, () => {
      const s = official(scenario, n);
      const at = bookPositions(s);
      const idOf = new Map([...at].map(([pos, id]) => [id, pos]));
      const book = BOOK[key];
      const printed = new Set<HexId>();
      book.columns.forEach((colText, col) => {
        const [first, hexes] = colText.split(': ');
        hexes.split(' ').forEach((want, k) => {
          const id = at.get(`${col},${Number(first) + 2 * k}`);
          expect(id, `${key} column ${col} hex ${k}`).toBeDefined();
          // a hex the rulebook deals at random: land of the main island
          if (want === '?') expect(s.board.hexes[id!].zone, `${key} column ${col} hex ${k}`).toBe('main');
          else expect(code(s.board.hexes[id!]), `${key} column ${col} hex ${k}`).toBe(want);
          printed.add(id!);
        });
      });
      // everything else is the sea of the frame
      for (const [id, h] of Object.entries(s.board.hexes)) if (!printed.has(id)) expect(h.terrain, `${key} ${id}`).toBe('sea');
      // harbors: position, side and (where printed) type
      const tribe = s.ext.tribe as { gifts: Record<string, string> } | undefined;
      const harbors = tribe
        ? Object.entries(tribe.gifts)
            .filter(([, g]) => g === 'harbor')
            .map(([edge]) => ({ edge, type: null as string | null }))
        : s.board.harbors.map((h) => ({ edge: h.edge, type: h.type as string | null }));
      const typed = book.harbors.some((h) => h.split(' ').length === 3);
      const got = harbors
        .map(({ edge, type }) => {
          const [a, b] = topo(s).edgeHexes[edge];
          const land = isLandHex(s, a) ? a : b;
          const sea = land === a ? b : a;
          return `${idOf.get(land)} ${bookSide(land, sea)}${typed ? ` ${type}` : ''}`;
        })
        .sort();
      expect(got).toEqual([...book.harbors].sort());
    });
  }
});

/** The rulebooks' component lists: terrain hexes (sea counted inside the frame) and number tokens. */
const COMPONENTS: Array<[string, number, Record<string, number>, string, number]> = [
  // scenario, players, hexes, numbers "2,3,...", harbors
  ['seafarers-1-new-shores', 3, { sea: 13, fields: 4, hills: 4, mountains: 4, pasture: 5, forest: 3, gold: 2 }, '2 3 3 4 4 4 5 5 5 6 6 8 8 8 9 9 10 10 10 11 11 12', 8],
  ['seafarers-1-new-shores', 4, { sea: 14, desert: 1, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5, gold: 2 }, '2 2 3 3 3 4 4 4 5 5 5 6 6 6 8 8 8 9 9 9 10 10 10 11 11 11 12', 9],
  ['seafarers-2-four-islands', 3, { sea: 15, fields: 4, hills: 4, mountains: 4, pasture: 4, forest: 4 }, '2 3 3 4 4 5 5 5 6 6 8 8 9 9 9 10 10 11 11 12', 9],
  ['seafarers-2-four-islands', 4, { sea: 12, fields: 5, hills: 4, mountains: 4, pasture: 5, forest: 5 }, '2 3 3 4 4 4 5 5 5 6 6 8 8 9 9 9 10 10 10 11 11 11 12', 9],
  ['seafarers-3-fog-islands', 3, { sea: 16, fields: 2, hills: 2, mountains: 2, pasture: 4, forest: 4, fog: 12 }, '3 4 5 5 6 6 8 8 9 9 10 11 11 12', 8],
  ['seafarers-3-fog-islands', 4, { sea: 13, fields: 3, hills: 3, mountains: 3, pasture: 4, forest: 4, fog: 12 }, '2 3 3 4 4 5 5 6 6 8 8 9 9 10 10 11 12', 9],
  ['seafarers-4-through-the-desert', 3, { sea: 10, desert: 3, gold: 2, fields: 4, hills: 3, mountains: 4, pasture: 4, forest: 5 }, '2 3 3 4 4 4 5 5 5 6 6 6 8 8 8 9 9 9 10 10 11 11', 8],
  ['seafarers-4-through-the-desert', 4, { sea: 12, desert: 3, gold: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 }, '2 3 3 3 4 4 4 5 5 5 6 6 6 8 8 8 9 9 9 10 10 10 11 11 11 12 12', 9],
  // Seafarers 5-6 (pages 6, 8, 10, 12); the same map for 5 and 6 players
  ...[5, 6].flatMap((n): Array<[string, number, Record<string, number>, string, number]> => [
    // New Shores: the 30 hexes and 28 numbers of CATAN and CATAN 5-6, plus 26 hexes and 10 numbers
    ['seafarers-1-new-shores', n, { sea: 16, desert: 2, gold: 3, fields: 7, hills: 7, mountains: 7, pasture: 7, forest: 7 }, '2 2 2 3 3 3 3 4 4 4 4 5 5 5 5 6 6 6 6 8 8 8 8 9 9 9 9 10 10 10 10 11 11 11 11 12 12 12', 11],
    ['seafarers-2-four-islands', n, { sea: 24, fields: 6, hills: 6, mountains: 6, pasture: 7, forest: 7 }, '2 2 3 3 3 4 4 4 4 5 5 5 5 6 6 6 6 8 8 8 9 9 9 9 10 10 10 10 11 11 12 12', 11],
    // the face-up hexes; the face-down stack is checked below
    ['seafarers-3-fog-islands', n, { sea: 12, desert: 1, gold: 2, fields: 5, hills: 5, mountains: 5, pasture: 4, forest: 4, fog: 25 }, '2 3 3 3 4 4 4 5 5 6 6 6 8 8 8 9 9 10 10 10 11 11 11 12 12', 9],
    // 11 harbor tokens listed, 10 spots on the diagram
    ['seafarers-4-through-the-desert', n, { sea: 20, desert: 5, gold: 3, fields: 7, hills: 7, mountains: 7, pasture: 7, forest: 7 }, '2 2 2 3 3 3 3 4 4 4 4 5 5 5 5 6 6 6 6 8 8 8 8 9 9 9 9 10 10 10 10 11 11 11 11 12 12 12', 10],
  ]),
  ['seafarers-5-forgotten-tribe', 4, { sea: 19, desert: 3, gold: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 }, '2 3 3 4 4 5 5 6 6 8 8 9 9 10 10 11 11 12', 0],
  // Cloth for Catan: 20 numbers on the hexes, 8 more on the villages
  ['seafarers-6-cloth-trade', 4, { sea: 18, desert: 2, gold: 2, fields: 5, hills: 3, mountains: 4, pasture: 4, forest: 4 }, '2 2 3 3 3 4 4 4 5 5 5 6 6 6 8 8 8 9 9 9 10 10 10 11 11 11 12 12', 9],
  ['seafarers-7-pirate-islands', 4, { sea: 19, desert: 3, gold: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 }, '2 3 3 4 4 4 5 5 5 6 6 6 8 8 8 9 9 9 10 10 10 11 11 12', 8],
  ['seafarers-8-wonders', 4, { sea: 19, desert: 3, gold: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 }, '2 2 3 3 3 4 4 4 5 5 5 6 6 6 8 8 8 9 9 9 10 10 10 11 11 11 12', 9],
];

describe('official maps use exactly the components the rulebook lists', () => {
  for (const [scenario, n, hexes, numbers, harbors] of COMPONENTS) {
    it(`${scenario} with ${n} players`, () => {
      const s = official(scenario, n);
      const key = BOOK_KEYS.find(([id, m]) => id === scenario && m === n)![2];
      const inFrame = BOOK[key].columns.reduce((sum, c) => sum + c.split(': ')[1].split(' ').length, 0);
      const count: Record<string, number> = {};
      for (const h of Object.values(s.board.hexes)) if (h.terrain !== 'sea') count[h.terrain] = (count[h.terrain] ?? 0) + 1;
      const land = Object.values(count).reduce((a, b) => a + b, 0);
      expect({ ...count, sea: inFrame - land }).toEqual(hexes);
      const cloth = s.ext.cloth as { villages: Record<string, { token: number }> } | undefined;
      const tokens = [
        ...Object.values(s.board.hexes).map((h) => h.token),
        ...Object.values(cloth?.villages ?? {}).map((v) => v.token),
      ]
        .filter((t): t is number => t !== null)
        .sort((a, b) => a - b);
      expect(tokens.join(' ')).toBe(numbers);
      expect(s.board.harbors).toHaveLength(harbors);
    });
  }
});

describe('official maps: base game', () => {
  const rows = (s: GameState) => {
    const land = Object.values(s.board.hexes).filter((h) => h.terrain !== 'sea');
    const byRow = new Map<number, HexState[]>();
    for (const h of land) byRow.set(h.r, [...(byRow.get(h.r) ?? []), h]);
    return [...byRow.keys()].sort((a, b) => a - b).map((r) => byRow.get(r)!.sort((a, b) => a.q - b.q).map(code).join(' '));
  };
  /** Harbors as "row.position side type", both counted from 1, reading the board like a page. */
  const harbors = (s: GameState) => {
    const land = Object.values(s.board.hexes).filter((h) => h.terrain !== 'sea');
    const rowsOf = [...new Set(land.map((h) => h.r))].sort((a, b) => a - b);
    const dirs = ['E', 'NE', 'NW', 'W', 'SW', 'SE'];
    const deltas = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return s.board.harbors
      .map((hb) => {
        const [a, b] = topo(s).edgeHexes[hb.edge];
        const l = isLandHex(s, a) ? s.board.hexes[a] : s.board.hexes[b];
        const sea = isLandHex(s, a) ? s.board.hexes[b] : s.board.hexes[a];
        const row = land.filter((h) => h.r === l.r).sort((x, y) => x.q - y.q);
        const d = dirs[deltas.findIndex(([dq, dr]) => l.q + dq === sea.q && l.r + dr === sea.r)];
        return `${rowsOf.indexOf(l.r) + 1}.${row.indexOf(l) + 1} ${d} ${hb.type}`;
      })
      .sort();
  };

  it('3-4 players: the starting set-up for beginners (Game Rules & Almanac, 2020, page 3)', () => {
    for (const n of [3, 4]) {
      const s = official('base', n);
      expect(rows(s)).toEqual(['m10 p2 f9', 'g12 h6 p4 h10', 'g9 f11 d f3 m8', 'f8 m3 g4 p5', 'h5 g6 p11']);
      expect(harbors(s)).toEqual(
        ['1.1 NW generic', '1.2 NE grain', '2.4 NE ore', '3.5 E generic', '4.4 SE wool', '5.2 SE generic', '5.1 SW generic', '4.1 W brick', '2.1 W lumber'].sort(),
      );
      expect(s.board.hexes[s.board.robber!].terrain).toBe('desert');
    }
  });

  it('5-6 players: the starting set-up for new players (CATAN 5-6 rules, 2022, page 5)', () => {
    for (const n of [5, 6]) {
      const s = official('base', n);
      expect(rows(s)).toEqual([
        'h10 p6 d',
        'h6 g2 m9 h11',
        'f3 m11 f5 g10 p4',
        'd p5 g4 m6 p3 g8',
        'f12 m10 p2 h4 f11',
        'f8 g3 f9 g5',
        'h9 p12 m8',
      ]);
      expect(harbors(s)).toEqual(
        [
          '1.1 NW generic', '1.2 NE wool', '2.4 NE generic', '4.6 E generic', '5.5 SE brick', '7.3 E wool',
          '7.2 SE lumber', '7.1 SW generic', '6.1 W grain', '4.1 SW generic', '3.1 W ore',
        ].sort(),
      );
    }
  });
});

describe('official maps: what stays fixed and what the rulebook shuffles', () => {
  for (const sc of BUILT_IN_SCENARIOS) {
    for (let n = sc.minPlayers; n <= sc.maxPlayers; n++) {
      it(`${sc.id} with ${n} players`, () => {
        const a = official(sc.id, n, 'seed-a');
        const b = official(sc.id, n, 'seed-b');
        if (sc.id === 'seafarers-9-new-world') {
          // The rulebook deals the whole New World at random into its fixed frame.
          expect(Object.keys(a.board.hexes).sort()).toEqual(Object.keys(b.board.hexes).sort());
          expect(Object.values(a.board.hexes).map(code)).not.toEqual(Object.values(b.board.hexes).map(code));
          return;
        }
        const fiveSix = n >= 5 && sc.expansion === 'seafarers';
        if (sc.id === 'seafarers-1-new-shores' && fiveSix) {
          // The main island is built by the CATAN 5-6 variable set-up: its 30 hexes and 28 numbers shuffled.
          const main = (s: GameState) => Object.entries(s.board.hexes).filter(([, h]) => h.zone === 'main');
          const rest = (s: GameState) => Object.fromEntries(Object.entries(s.board.hexes).filter(([, h]) => h.zone !== 'main' || h.terrain === 'sea'));
          expect(rest(a)).toEqual(rest(b));
          expect(main(a).map(([id]) => id)).toEqual(main(b).map(([id]) => id));
          expect(main(a).map(([, h]) => code(h))).not.toEqual(main(b).map(([, h]) => code(h)));
          for (const s of [a, b]) {
            const tiles = main(s).map(([, h]) => h.terrain);
            const count = (t: string) => tiles.filter((x) => x === t).length;
            expect([count('forest'), count('pasture'), count('fields'), count('hills'), count('mountains'), count('desert')]).toEqual([6, 6, 6, 5, 5, 2]);
            expect(main(s).map(([, h]) => h.token).filter((t) => t !== null).sort((x, y) => x! - y!).join(' ')).toBe(TOKENS_28.join(' '));
            for (const [id, h] of main(s)) {
              if (h.token === 6 || h.token === 8) for (const x of topo(s).hexNeighbors[id]) expect([6, 8]).not.toContain(s.board.hexes[x].token);
            }
          }
        } else expect(a.board.hexes).toEqual(b.board.hexes);
        expect(a.board.robber).toBe(b.board.robber);
        expect(a.board.pirate).toBe(b.board.pirate);
        // harbors always sit on the printed spots; blank ones get shuffled types (the 5-6 maps' are all blank)
        expect(a.board.harbors.map((h) => h.edge)).toEqual(b.board.harbors.map((h) => h.edge));
        const blank = ['seafarers-6-cloth-trade', 'seafarers-7-pirate-islands', 'seafarers-8-wonders'].includes(sc.id) || (sc.id === 'seafarers-1-new-shores' && n === 4) || fiveSix;
        if (!blank) expect(a.board.harbors).toEqual(b.board.harbors);
        else {
          const types = (seed: number) => official(sc.id, n, seed).board.harbors.map((h) => h.type).join();
          expect(new Set(Array.from({ length: 12 }, (_, i) => types(i))).size).toBeGreaterThan(1);
        }
        // the tokens come from the scenario's harbor list (Through the Desert 5-6: 11 tokens for 10 spots)
        const pool = fiveSix ? (sc.id === 'seafarers-3-fog-islands' ? HARBORS_BASE : HARBORS_5_6) : null;
        if (pool) {
          for (const s of [a, b]) {
            const left = [...pool];
            for (const h of s.board.harbors) {
              expect(left).toContain(h.type);
              left.splice(left.indexOf(h.type), 1);
            }
            expect(left).toHaveLength(pool.length - s.board.harbors.length);
          }
        } else expect(a.board.harbors.map((h) => h.type).sort()).toEqual(b.board.harbors.map((h) => h.type).sort());
        // the unexplored hexes: fixed places, a shuffled face-down stack
        if (sc.id === 'seafarers-3-fog-islands') {
          const fog = (s: GameState) => s.ext.fog as { terrains: string[]; tokens: number[] };
          expect(fog(a).terrains.length).toBe(fiveSix ? 25 : 12);
          expect(fog(a).tokens.length).toBe(fiveSix ? 13 : 10);
          expect([...fog(a).terrains].sort()).toEqual([...fog(b).terrains].sort());
          expect(fog(a)).not.toEqual(fog(b));
        }
      });
    }
  }
});

describe('official maps: scenario markings', () => {
  it('New Shores, Four Islands, Fog Islands: the robber starts on the 12 where the rulebook says so', () => {
    for (const [id, n] of [['seafarers-1-new-shores', 3], ['seafarers-2-four-islands', 3], ['seafarers-2-four-islands', 4], ['seafarers-3-fog-islands', 3], ['seafarers-3-fog-islands', 4]] as const) {
      const s = official(id, n);
      expect(s.board.hexes[s.board.robber!].token, `${id} ${n}`).toBe(12);
      expect(s.board.hexes[s.board.pirate!].terrain).toBe('sea');
    }
    const s = official('seafarers-1-new-shores', 4);
    expect(s.board.hexes[s.board.robber!].terrain).toBe('desert');
  });

  it('Through the Desert: the strip beyond the deserts is its own area', () => {
    const strip = (n: number, zone = 'strip') =>
      Object.values(official('seafarers-4-through-the-desert', n).board.hexes)
        .filter((h) => h.zone === zone)
        .map(code)
        .sort();
    expect(strip(3)).toEqual(['$4', 'f3', 'g6']);
    expect(strip(4)).toEqual(['$10', 'g8', 'm11']);
    // 5-6 players: five deserts cut off two strips, a sea hex apart
    for (const n of [5, 6]) {
      expect(strip(n)).toEqual(['$4', 'f5', 'h11', 'm6', 'p2']);
      expect(strip(n, 'strip2')).toEqual(['f12', 'g5', 'h6', 'm3']);
      const s = official('seafarers-4-through-the-desert', n);
      for (const [id, h] of Object.entries(s.board.hexes)) {
        if (h.zone !== 'strip' && h.zone !== 'strip2') continue;
        for (const x of topo(s).hexNeighbors[id]) {
          const o = s.board.hexes[x];
          if (o.zone === 'home') expect(o.terrain).toBe('desert');
          expect(o.zone === 'strip' || o.zone === 'strip2' ? o.zone : h.zone).toBe(h.zone);
        }
      }
      // the five deserts: one straight line, the robber on the middle one
      const deserts = Object.keys(s.board.hexes).filter((h) => s.board.hexes[h].terrain === 'desert');
      expect(deserts).toHaveLength(5);
      expect(new Set(deserts.map((h) => s.board.hexes[h].r)).size).toBe(1);
      const qs = deserts.map((h) => s.board.hexes[h].q).sort((x, y) => x - y);
      expect(s.board.hexes[s.board.robber!].q).toBe(qs[2]);
      expect(s.board.hexes[s.board.robber!].r).toBe(s.board.hexes[deserts[0]].r);
    }
  });

  it('5-6 players: where the robber and pirate start, and the areas of each map', () => {
    for (const n of [5, 6]) {
      // New Shores: the robber on the hills 12 of a small island, as drawn; start on the main island
      let s = official('seafarers-1-new-shores', n);
      expect(code(s.board.hexes[s.board.robber!])).toBe('h12');
      expect(s.board.hexes[s.board.robber!].zone).not.toBe('main');
      expect(s.board.hexes[s.board.pirate!].terrain).toBe('sea');
      const sizes = (st: GameState, skip: string[]) => {
        const by: Record<string, number> = {};
        for (const h of Object.values(st.board.hexes)) if (isLandHex(st, `${h.q},${h.r}`) && !skip.includes(h.zone!)) by[h.zone!] = (by[h.zone!] ?? 0) + 1;
        return Object.values(by).sort((a, b) => a - b);
      };
      expect(sizes(s, ['main'])).toEqual([1, 1, 1, 1, 3, 3]);
      for (const v of legalSetupSettlements(s, currentSetupPlayer(s)!)) expect(vertexZones(s, v)).toEqual(['main']);
      // The Six Islands: the robber stands on the pasture 2 in the diagram
      s = official('seafarers-2-four-islands', n);
      expect(code(s.board.hexes[s.board.robber!])).toBe('p2');
      expect(sizes(s, [])).toEqual([5, 5, 5, 5, 6, 6]);
      // The Fog Island: the robber on the face-up island's desert; two gold islets among the unexplored hexes
      s = official('seafarers-3-fog-islands', n);
      expect(s.board.hexes[s.board.robber!].terrain).toBe('desert');
      expect(s.board.hexes[s.board.robber!].zone).toBe('home');
      expect(s.board.hexes[s.board.pirate!].terrain).toBe('sea');
      expect(sizes(s, ['home'])).toEqual([1, 1]);
      for (const v of legalSetupSettlements(s, currentSetupPlayer(s)!)) expect(vertexZones(s, v)).toEqual(['home']);
      const fog = s.ext.fog as { terrains: string[]; tokens: number[] };
      const tally: Record<string, number> = {};
      for (const t of fog.terrains) tally[t] = (tally[t] ?? 0) + 1;
      expect(tally).toEqual({ sea: 12, gold: 1, fields: 2, hills: 2, mountains: 2, pasture: 3, forest: 3 });
      expect([...fog.tokens].sort((a, b) => a - b)).toEqual([2, 2, 3, 4, 5, 5, 6, 8, 9, 9, 10, 11, 12]);
      // Through the Desert: the pirate at sea
      s = official('seafarers-4-through-the-desert', n);
      expect(s.board.hexes[s.board.pirate!].terrain).toBe('sea');
      expect(sizes(s, ['home', 'strip', 'strip2'])).toEqual([1, 1, 2, 4]);
    }
  });

  it('The Forgotten Tribe: 8 VP chits, 4 development cards and 6 harbors on the printed coasts', () => {
    const s = official('seafarers-5-forgotten-tribe', 4);
    const tribe = s.ext.tribe as { gifts: Record<string, string>; harborAt: Record<string, string>; giftCards: string[] };
    const kinds = Object.values(tribe.gifts);
    expect(kinds.filter((g) => g === 'vp')).toHaveLength(8);
    expect(kinds.filter((g) => g === 'devCard')).toHaveLength(4);
    expect(kinds.filter((g) => g === 'harbor')).toHaveLength(6);
    expect(tribe.giftCards).toHaveLength(4);
    expect(Object.values(tribe.harborAt).sort()).toEqual([...TRIBE_HARBORS].sort());
    // every gift lies on a coast of a tribe island, and the tribe islands have no numbers
    for (const e of Object.keys(tribe.gifts)) {
      expect(topo(s).edgeHexes[e].some((h) => s.board.hexes[h].zone === 'tribe')).toBe(true);
    }
    for (const h of Object.values(s.board.hexes)) if (h.zone === 'tribe') expect(h.token).toBeNull();
    expect(s.board.hexes[s.board.robber!].terrain).toBe('desert');
  });

  it('Cloth for Catan: 8 villages with their printed numbers on the four tribe islands', () => {
    const s = official('seafarers-6-cloth-trade', 3);
    const villages = (s.ext.cloth as { villages: Record<string, { token: number; cloth: number }> }).villages;
    expect(Object.values(villages).map((v) => v.token).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 8, 9, 10, 11]);
    for (const [v, vil] of Object.entries(villages)) {
      expect(vil.cloth).toBe(5);
      expect(topo(s).vertexHexes[v].some((h) => s.board.hexes[h].zone === 'isle')).toBe(true);
    }
    // the two villages of an island are its two ends
    const isles = Object.entries(s.board.hexes).filter(([, h]) => h.zone === 'isle');
    expect(isles).toHaveLength(4);
    for (const [id] of isles) expect(Object.keys(villages).filter((v) => topo(s).vertexHexes[v].includes(id))).toHaveLength(2);
    expect(s.board.hexes[s.board.robber!].token).toBe(12);
  });

  it('The Pirate Islands: fortresses, marked intersections, starting pieces and the fleet circuit', () => {
    for (const n of [3, 4]) {
      const s = official('seafarers-7-pirate-islands', n);
      const pi = s.ext.pirateIslands as { circuit: string[]; fortresses: Array<{ vertex: string; waypoint: string }> };
      expect(pi.fortresses).toHaveLength(n);
      for (const f of pi.fortresses) {
        expect(vertexZones(s, f.vertex)).toEqual(['way']);
        expect(vertexZones(s, f.waypoint)).toEqual(['way']);
      }
      // one pre-placed coastal settlement and ship per player on the eastern island
      const buildings = Object.entries(s.board.buildings);
      expect(buildings.map(([, b]) => b.owner).sort()).toEqual(Array.from({ length: n }, (_, i) => i));
      for (const [v] of buildings) expect(vertexZones(s, v)).toEqual(['main']);
      for (const [e, piece] of Object.entries(s.board.pieces)) {
        expect(piece.type).toBe('ship');
        const home = buildings.find(([, b]) => b.owner === piece.owner)![0];
        expect(topo(s).edgeVertices[e]).toContain(home);
      }
      // the circuit: 14 sea hexes, each next to the following one, closing the loop
      expect(pi.circuit).toHaveLength(14);
      pi.circuit.forEach((h, i) => {
        expect(s.board.hexes[h].terrain).toBe('sea');
        expect(topo(s).hexNeighbors[h]).toContain(pi.circuit[(i + 1) % 14]);
      });
      expect(s.board.pirate).toBe(pi.circuit[0]);
      // unnumbered: the pasture of the left desert islet and the two western hills
      const unnumbered = Object.values(s.board.hexes).filter((h) => isLandHex(s, `${h.q},${h.r}`) && h.terrain !== 'desert' && h.token === null);
      expect(unnumbered.map((h) => `${h.terrain}@${h.zone}`).sort()).toEqual(['hills@way', 'hills@way', 'pasture@desert']);
    }
  });

  it('The Wonders: the printed strait and wasteland intersections, closed at setup', () => {
    const s = official('seafarers-8-wonders', 3);
    const strait = straitVertices(s);
    const wasteland = wastelandVertices(s);
    expect(strait).toHaveLength(2);
    expect(topo(s).vertexNeighbors[strait[0]]).toContain(strait[1]);
    expect(wasteland).toHaveLength(5);
    for (const v of wasteland) expect(topo(s).vertexHexes[v].some((h) => s.board.hexes[h].terrain === 'desert')).toBe(true);
    const legal = legalSetupSettlements(s, currentSetupPlayer(s)!);
    for (const v of [...strait, ...wasteland, ...strait.flatMap((v) => topo(s).vertexNeighbors[v])]) expect(legal).not.toContain(v);
    for (const v of legal) expect(vertexZones(s, v)).toEqual(['main']);
    expect(s.board.hexes[s.board.robber!].terrain).toBe('desert');
  });

  it('New World: the frame holds 42 hexes (63 with 5-6 players) dealt from the rulebook mix', () => {
    for (const [n, frame, land] of [[3, 42, 23], [4, 42, 23], [5, 63, 42], [6, 63, 42]]) {
      const s = official('seafarers-9-new-world', n);
      const hexes = Object.values(s.board.hexes);
      // the frame positions are every hex not on the outer ring
      const inner = Object.keys(s.board.hexes).filter((id) => topo(s).hexNeighbors[id].length === 6);
      expect(inner).toHaveLength(frame);
      expect(hexes.filter((h) => h.terrain !== 'sea')).toHaveLength(land);
      expect(s.board.robber).toBeNull();
      expect(s.board.pirate).toBeNull();
    }
  });
});

describe('games saved before the layout option', () => {
  it('load and keep playing: the board is in the state, and old saves were random maps', () => {
    for (const sc of BUILT_IN_SCENARIOS) {
      const fresh = createGame({ scenario: sc.id, players: sc.minPlayers, seed: `old-${sc.id}`, options: { layout: 'random' } });
      const old = JSON.parse(JSON.stringify(fresh)) as GameState;
      delete (old.options as Partial<GameState['options']>).layout;
      const r = simulate(old, seedRng(`old-${sc.id}`), 400);
      expect(r.state.turn.number, sc.id).toBeGreaterThan(0);
      expect(() => viewFor(r.state, 0)).not.toThrow();
    }
  });
});
