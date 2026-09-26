import type { GeneratedMap, MapSpec } from '../board/mapSpec.js';
import type {
  Action,
  DevCardType,
  EdgeId,
  GameOptions,
  GameState,
  Phase,
  PlayerId,
  VertexId,
} from '../core/types.js';

export interface SetupRound {
  /** forward = clockwise from the first player; reverse = counter-clockwise from the last. */
  order: 'forward' | 'reverse';
  /** Take one resource per adjacent terrain hex for this round's settlement. */
  collect: boolean;
}

export interface ScenarioRules {
  ships: boolean;
  robber: boolean;
  pirate: boolean;
  /** Longest Road (base) / Longest Trade Route (Seafarers) special card. */
  longestRoute: boolean;
  largestArmy: boolean;
  shipMoves: boolean;
  setupRounds: SetupRound[];
  /** Zones allowed for starting settlements; null = anywhere. */
  setupZones: string[] | null;
  /** Zones on which settlements may never be built. */
  forbiddenZones: string[];
  /** Zones the robber may not be moved to. */
  robberForbiddenZones: string[];
  /** The robber may only be moved to hexes with a number token (Forgotten Tribe). */
  robberNeedsToken: boolean;
  /**
   * VP chits for the first settlement in each foreign zone. `home` is either
   * a fixed list of home zones or 'setup' (zones of each player's starting settlements).
   */
  islandBonus: { vp: number; home: 'setup' | string[] } | null;
  /** New World: players place the harbor tokens after the starting placement. */
  playersPlaceHarbors: boolean;
}

export interface EndResult {
  winner: PlayerId | null;
  reason: string;
}

/**
 * Rule hooks. All of them receive a mutable (already cloned) state and must
 * only use the seeded RNG in `state.rng`.
 */
export interface ScenarioHooks {
  /** Set up `state.ext` after the board is generated (`map.marks` holds the map's printed spots). */
  init?(state: GameState, map: GeneratedMap): void;
  afterSettlement?(state: GameState, player: PlayerId, vertex: VertexId, setup: boolean): void;
  afterEdge?(state: GameState, player: PlayerId, edge: EdgeId, kind: 'road' | 'ship', setup: boolean): void;
  /**
   * Runs right after the dice are rolled, before production or the 7 (Pirate
   * Islands fleet). Returns free resource choices owed; on a 7 they are picked
   * before the discards.
   */
  beforeProduction?(state: GameState, dice: [number, number]): Record<number, number> | void;
  /** Runs after the dice are rolled, after normal production (or the 7 discard set-up). */
  afterRoll?(state: GameState, dice: [number, number]): void;
  /** May this player move the pirate now? (Cloth: only after reaching a village.) */
  canMovePirate?(state: GameState, player: PlayerId): boolean;
  /** Non-resource things a thief may take instead of a card (Cloth: 'cloth'). */
  stealChoices?(state: GameState, thief: PlayerId, victim: PlayerId, piece: 'robber' | 'pirate'): string[];
  /** Performs a steal of one of the `stealChoices`. */
  steal?(state: GameState, thief: PlayerId, victim: PlayerId, take: string): void;
  /** Neutral intersections that end trade routes (Cloth villages): a route reaching one is closed. */
  routeAnchors?(state: GameState): VertexId[];
  /** Replaces the knight's robber move; return the phase to enter. */
  onKnight?(state: GameState, player: PlayerId, resume: Phase): Phase | null;
  /** Extra constraint for ship placement (e.g. single unbranched route). */
  shipAllowed?(state: GameState, player: PlayerId, edge: EdgeId, movingFrom: EdgeId | null): string | null;
  /** Extra constraint for settlement placement. */
  settlementAllowed?(state: GameState, player: PlayerId, vertex: VertexId, setup: boolean): string | null;
  /** Scenario victory points (public). */
  extraVP?(state: GameState, player: PlayerId): number;
  /** Additional condition that must hold to win on points (e.g. fortress captured). */
  canWin?(state: GameState, player: PlayerId): boolean;
  /** Alternative win on the player's own turn regardless of points (e.g. finished wonder). */
  instantWin?(state: GameState, player: PlayerId): string | null;
  /** Game-ending condition checked after every action (e.g. villages ran out of cloth). */
  checkEnd?(state: GameState): EndResult | null;
  /**
   * Handles `{type:'scenario'}` actions; returns an error string or null.
   * Setting `state.ext.forceEndTurn = true` ends the acting player's turn afterwards.
   */
  action?(state: GameState, action: Extract<Action, { type: 'scenario' }>): string | null;
  /** Scenario actions currently legal for `player` (used by bots and UIs). */
  legalActions?(state: GameState, player: PlayerId): Action[];
  /** Hide scenario secrets in a player's view (viewer null = spectator). */
  redact?(state: GameState, viewer: PlayerId | null): void;
}

export interface ScenarioDef {
  id: string;
  name: string;
  expansion: 'base' | 'seafarers';
  description: string;
  minPlayers: number;
  maxPlayers: number;
  victoryPoints(players: number): number;
  /**
   * The set-up map printed in the rulebook for this player count (layout
   * 'official'), or null when the rulebook has none; `map` is used then.
   */
  officialMap?(players: number, options: GameOptions): MapSpec | null;
  /** The random set-up (layout 'random'): shuffled tiles, numbers and harbors. */
  map(players: number, options: GameOptions): MapSpec;
  bankSize(players: number): number;
  devDeck(players: number): Record<DevCardType, number>;
  rules: ScenarioRules;
  hooks: ScenarioHooks;
}

export const DEFAULT_SETUP: SetupRound[] = [
  { order: 'forward', collect: false },
  { order: 'reverse', collect: true },
];

export function baseRules(overrides: Partial<ScenarioRules> = {}): ScenarioRules {
  return {
    ships: false,
    robber: true,
    pirate: false,
    longestRoute: true,
    largestArmy: true,
    shipMoves: false,
    setupRounds: DEFAULT_SETUP,
    setupZones: null,
    forbiddenZones: [],
    robberForbiddenZones: [],
    robberNeedsToken: false,
    islandBonus: null,
    playersPlaceHarbors: false,
    ...overrides,
  };
}

export function seafarersRules(overrides: Partial<ScenarioRules> = {}): ScenarioRules {
  return baseRules({ ships: true, pirate: true, shipMoves: true, ...overrides });
}
