import type { Card, Commodity, DevCardType, HarborType, PartialCounts, Resource, Terrain } from './types.js';

export const RESOURCES: readonly Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/** Cities & Knights commodities, and every card that can be in a hand (resources first). */
export const COMMODITIES: readonly Commodity[] = ['paper', 'cloth', 'coin'];
export const CARDS: readonly Card[] = [...RESOURCES, ...COMMODITIES];

export const TERRAIN_RESOURCE: Partial<Record<Terrain, Resource>> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
};

export const COSTS = {
  road: { brick: 1, lumber: 1 },
  ship: { lumber: 1, wool: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  devCard: { ore: 1, wool: 1, grain: 1 },
} as const satisfies Record<string, PartialCounts>;

export const PIECES_PER_PLAYER = { roads: 15, ships: 15, settlements: 5, cities: 4 } as const;

export const VP = { settlement: 1, city: 2, longestRoute: 2, largestArmy: 2, vpCard: 1 } as const;

export const LONGEST_ROUTE_MIN = 5;
export const LARGEST_ARMY_MIN = 3;

/** Base game (3-4 players): 19 of each resource. */
export const BANK_BASE = 19;
/** 5-6 extension adds 5 of each resource. */
export const BANK_5_6 = 24;

export const DEV_DECK_BASE: Record<DevCardType, number> = {
  knight: 14,
  victoryPoint: 5,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
};

/** 5-6 extension adds 6 knights and one of each progress card. */
export const DEV_DECK_5_6: Record<DevCardType, number> = {
  knight: 20,
  victoryPoint: 5,
  roadBuilding: 3,
  yearOfPlenty: 3,
  monopoly: 3,
};

/** Base game terrain tiles (19). */
export const TERRAIN_BASE: Record<string, number> = {
  forest: 4,
  pasture: 4,
  fields: 4,
  hills: 3,
  mountains: 3,
  desert: 1,
};

/** Base + 5-6 extension terrain tiles (30). */
export const TERRAIN_5_6: Record<string, number> = {
  forest: 6,
  pasture: 6,
  fields: 6,
  hills: 5,
  mountains: 5,
  desert: 2,
};

/**
 * Base number tokens in alphabetical order A-R, as laid in the variable-setup
 * spiral. A5 B2 C6 D3 E8 F10 G9 H12 I11 J4 K8 L10 M9 N4 O5 P6 Q3 R11.
 */
export const TOKENS_BASE_SPIRAL: readonly number[] = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

/** 28 tokens: base + Seafarers (or the 5-6 extension set). */
export const TOKENS_28: readonly number[] = [
  2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
];

export const HARBORS_BASE: readonly HarborType[] = [
  'generic', 'generic', 'generic', 'generic', 'brick', 'lumber', 'wool', 'grain', 'ore',
];

export const HARBORS_5_6: readonly HarborType[] = [...HARBORS_BASE, 'generic', 'wool'];

/** Seafarers ships 10 harbor tokens for its scenarios. */
export const HARBORS_SEAFARERS: readonly HarborType[] = [
  'generic', 'generic', 'generic', 'generic', 'generic', 'brick', 'lumber', 'wool', 'grain', 'ore',
];

/** Number of ways to roll each sum with 2d6 (pips on the token). */
export function pips(token: number | null): number {
  if (token === null || token < 2 || token > 12 || token === 7) return 0;
  return 6 - Math.abs(7 - token);
}

export function isRed(token: number | null): boolean {
  return token === 6 || token === 8;
}
