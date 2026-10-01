import type {
  Commodity,
  EventFace,
  ImprovementTrack,
  PartialCounts,
  ProgressCardName,
  Terrain,
} from '../core/types.js';

/**
 * Cities & Knights data, from the 5th-edition "Game Rules & Almanac" (2020,
 * catan_c_k_2020_rule_book_200708.pdf). Page numbers are that booklet's;
 * docs/cities-and-knights.md has the full rules as implemented.
 */

export const TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

/** Each track is paid with one commodity (p. 7, Illustrations J and L). */
export const TRACK_COMMODITY: Record<ImprovementTrack, Commodity> = {
  trade: 'cloth',
  politics: 'coin',
  science: 'paper',
};

/** Colour of each track's flag, city gate and flip-chart section. */
export const TRACK_COLOR: Record<ImprovementTrack, 'yellow' | 'blue' | 'green'> = {
  trade: 'yellow',
  politics: 'blue',
  science: 'green',
};

/**
 * The five improvements of each track, levels 1-5 (flip-chart, p. 8
 * Illustration L; level 5 names from the 2025 rulebook's improvement board).
 */
export const IMPROVEMENT_NAMES: Record<ImprovementTrack, readonly string[]> = {
  trade: ['Market', 'Trading House', 'Merchant Guild', 'Bank', 'Great Exchange'],
  politics: ['Town Hall', 'Church', 'Fortress', 'Cathedral', 'High Assembly'],
  science: ['Abbey', 'Library', 'Aqueduct', 'Theater', 'University'],
};

/** Level 3 of each track gives its ability: 2:1 commodity trades, mighty knights, the aqueduct pick (p. 8). */
export const ABILITY_LEVEL = 3;
/** The first player to reach level 4 of a track takes its metropolis; level 5 takes it from a level-4 holder (p. 8). */
export const METROPOLIS_LEVEL = 4;
export const MAX_IMPROVEMENT = 5;

/** A city's commodity on these terrains (p. 5 Illustration G, p. 20 "City Production"). */
export const TERRAIN_COMMODITY: Partial<Record<Terrain, Commodity>> = {
  forest: 'paper',
  pasture: 'cloth',
  mountains: 'coin',
};

export const CK_COSTS = {
  /** Hire a basic knight (p. 6). */
  knight: { wool: 1, ore: 1 },
  /** Activate a knight (p. 6). */
  activate: { grain: 1 },
  /** Promote a knight one level (p. 6). */
  promote: { wool: 1, ore: 1 },
  /** City wall (p. 6). */
  cityWall: { brick: 2 },
} as const satisfies Record<string, PartialCounts>;

/** Level n of a track costs n of its commodity (p. 7). */
export function improvementCost(level: number): number {
  return level;
}

/** 13 VP to win (p. 12). */
export const CK_VICTORY_POINTS = 13;
/** Spaces the barbarian ship sails from its start to the shore of Catan (the barbarian tile, p. 4). */
export const BARBARIAN_TRACK = 7;
/** 12 of each commodity (p. 2). */
export const COMMODITY_BANK = 12;
/** "Defender of Catan" VP cards (p. 2). */
export const DEFENDER_CARDS = 6;
/**
 * The 5-6 Player Extension (2020 rules p. 1; 2023 p. 1; 2025 p. 2) adds 6
 * coin, 6 paper and 6 cloth, and 2 Defender of Catan cards (2025: VP
 * tokens). Its knights and city walls are the two new colours' own pieces;
 * the progress decks and the metropolises stay as they are.
 */
export const COMMODITY_BANK_5_6 = 18;
export const DEFENDER_CARDS_5_6 = 8;

/** Commodities of each kind in the bank for this many players. */
export function commodityBank(players: number): number {
  return players >= 5 ? COMMODITY_BANK_5_6 : COMMODITY_BANK;
}

/** Defender of Catan cards for this many players. */
export function defenderCards(players: number): number {
  return players >= 5 ? DEFENDER_CARDS_5_6 : DEFENDER_CARDS;
}

/** Each player has 2 basic, 2 strong and 2 mighty knights (p. 4; the 5-6 extension's two colours the same). */
export const KNIGHTS_PER_LEVEL = 2;
export const MAX_CITY_WALLS = 3;
/** Each city wall raises the hand limit on a 7 by 2 (p. 6). */
export const WALL_HAND_BONUS = 2;
/** Progress cards a player may hold (VP cards excepted; p. 9). */
export const PROGRESS_HAND_LIMIT = 4;
export const METROPOLIS_VP = 2;
export const MERCHANT_VP = 1;

/** The event die: 3 ship faces and one city gate per track (p. 2, p. 5). */
export const EVENT_DIE: readonly EventFace[] = ['ship', 'ship', 'ship', 'trade', 'politics', 'science'];

/**
 * Engine choice: the knight's chase takes the robber "to any numbered hex"
 * (p. 10), so not to the desert. A robber moved on a 7 follows the base rules.
 */
export const CHASED_ROBBER_NEEDS_NUMBER = true;

export interface ProgressCardInfo {
  deck: ImprovementTrack;
  /** Copies in the deck (Almanac, pp. 14-18). */
  count: number;
  title: string;
  /** Victory point card: played face up at once, worth 1 VP, not part of the hand. */
  vp?: true;
  /** May only be played before rolling (the Alchemist). */
  beforeRoll?: true;
}

/** The 54 progress cards: 18 per deck (Almanac, pp. 14-18). */
export const PROGRESS_CARDS: Record<ProgressCardName, ProgressCardInfo> = {
  alchemist: { deck: 'science', count: 2, title: 'Alchemist', beforeRoll: true },
  crane: { deck: 'science', count: 2, title: 'Crane' },
  engineer: { deck: 'science', count: 1, title: 'Engineer' },
  inventor: { deck: 'science', count: 2, title: 'Inventor' },
  irrigation: { deck: 'science', count: 2, title: 'Irrigation' },
  medicine: { deck: 'science', count: 2, title: 'Medicine' },
  mining: { deck: 'science', count: 2, title: 'Mining' },
  printer: { deck: 'science', count: 1, title: 'Printer', vp: true },
  roadBuilding: { deck: 'science', count: 2, title: 'Road Building' },
  smith: { deck: 'science', count: 2, title: 'Smith' },

  bishop: { deck: 'politics', count: 2, title: 'Bishop' },
  constitution: { deck: 'politics', count: 1, title: 'Constitution', vp: true },
  deserter: { deck: 'politics', count: 2, title: 'Deserter' },
  diplomat: { deck: 'politics', count: 2, title: 'Diplomat' },
  intrigue: { deck: 'politics', count: 2, title: 'Intrigue' },
  saboteur: { deck: 'politics', count: 2, title: 'Saboteur' },
  spy: { deck: 'politics', count: 3, title: 'Spy' },
  warlord: { deck: 'politics', count: 2, title: 'Warlord' },
  wedding: { deck: 'politics', count: 2, title: 'Wedding' },

  commercialHarbor: { deck: 'trade', count: 2, title: 'Commercial Harbor' },
  masterMerchant: { deck: 'trade', count: 2, title: 'Master Merchant' },
  merchant: { deck: 'trade', count: 6, title: 'Merchant' },
  merchantFleet: { deck: 'trade', count: 2, title: 'Merchant Fleet' },
  resourceMonopoly: { deck: 'trade', count: 4, title: 'Resource Monopoly' },
  tradeMonopoly: { deck: 'trade', count: 2, title: 'Trade Monopoly' },
};

export const PROGRESS_CARD_NAMES = Object.keys(PROGRESS_CARDS) as ProgressCardName[];

/** Red die results that let a player at `level` of a track draw: level 1 shows two red dice (1-2), each level one more (p. 8-9). */
export function drawsOn(level: number, red: number): boolean {
  return level >= 1 && red <= level + 1;
}
