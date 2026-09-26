/**
 * Core data model. Everything in `GameState` is plain JSON so a game can be
 * serialised, sent over the wire, stored and replayed. Static board topology
 * (vertex/edge adjacency) is derived from the hex layout and cached outside the
 * state (see board/topology.ts).
 */

export type Resource = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
export type ResourceCounts = Record<Resource, number>;
export type PartialCounts = Partial<Record<Resource, number>>;

/** Producing terrains map 1:1 onto resources; the rest are special. */
export type Terrain =
  | 'hills'
  | 'forest'
  | 'pasture'
  | 'fields'
  | 'mountains'
  | 'desert'
  | 'gold'
  | 'sea'
  | 'fog';

export type HexId = string; // "q,r" (axial)
export type VertexId = string; // sorted three hex ids joined with "|"
export type EdgeId = string; // sorted two hex ids joined with "|"
export type PlayerId = number; // seat index 0..n-1

export type DevCardType = 'knight' | 'victoryPoint' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';

export type HarborType = Resource | 'generic';

export interface HexState {
  q: number;
  r: number;
  terrain: Terrain;
  /** Number token (2-12, never 7) or null. */
  token: number | null;
  /** Region label used by scenario rules (islands, home area, tribe islands, ...). */
  zone: string | null;
}

export interface HarborState {
  edge: EdgeId;
  type: HarborType;
}

export interface Building {
  owner: PlayerId;
  type: 'settlement' | 'city';
}

export interface EdgePiece {
  owner: PlayerId;
  type: 'road' | 'ship';
  /** Turn part in which the piece was placed (ships built this turn may not move). */
  placedPart: number;
  /** Pirate Islands: a ship upgraded by a knight. */
  warship?: boolean;
}

export interface BoardState {
  /** Key into the topology cache (derived from the set of hex ids). */
  layoutKey: string;
  hexes: Record<HexId, HexState>;
  harbors: HarborState[];
  buildings: Record<VertexId, Building>;
  pieces: Record<EdgeId, EdgePiece>;
  /** null = off-board (Seafarers scenarios without a desert). */
  robber: HexId | null;
  pirate: HexId | null;
}

export interface DevCardInHand {
  type: DevCardType;
  /** Turn part in which it was bought; it may not be played in that part. */
  boughtPart: number;
}

export interface PieceSupply {
  roads: number;
  ships: number;
  settlements: number;
  cities: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  resources: ResourceCounts;
  devCards: DevCardInHand[];
  playedKnights: number;
  /** Progress cards that have been played (they leave the game). */
  playedProgress: DevCardType[];
  supply: PieceSupply;
  /** VP chits and other scenario bonus VP. */
  bonusVP: number;
  /** Zones for which this player has already received the island/area bonus. */
  bonusZones: string[];
  /** Zones where the player placed starting settlements ("home" islands). */
  homeZones: string[];
}

export type TurnRole = 'active' | 'paired' | 'specialBuild';

export interface TradeOffer {
  id: number;
  from: PlayerId;
  /** Players the offer is addressed to. */
  to: PlayerId[];
  /** What `from` gives. */
  give: PartialCounts;
  /** What `from` receives. */
  get: PartialCounts;
  accepted: PlayerId[];
  rejected: PlayerId[];
  /**
   * An open offer names only one side and asks the others what they would
   * trade: 'give' when the proposer leaves what they give open ("who has a
   * brick for me?"), 'get' when they leave what they get open ("what will you
   * give for my brick?"). It can't be accepted as is, only answered with a
   * counter-offer.
   */
  open?: 'give' | 'get';
  /** A counter-offer: the id of the offer it answers. */
  replyTo?: number;
}

export interface TurnState {
  /** Increments each time the dice-rolling player changes. */
  number: number;
  /** Player 1 / the player who rolls this turn. */
  current: PlayerId;
  /** Player whose part of the turn is running (current, paired player 2, or special builder). */
  actor: PlayerId;
  role: TurnRole;
  /** Globally unique counter for "this turn" checks (dev cards, ship moves). */
  part: number;
  dice: [number, number] | null;
  devCardPlayed: boolean;
  shipMoved: boolean;
  /** Separate-phase mode: once the player builds, trading is over for the turn. */
  buildingStarted: boolean;
  trades: TradeOffer[];
  nextTradeId: number;
  /** Trade offers the actor has made in this part of the turn (computer players limit themselves). */
  offers?: number;
}

export type Phase =
  | { kind: 'harborPlacement'; queue: PlayerId[] }
  | { kind: 'setup'; round: number; index: number; step: 'settlement' | 'edge'; vertex: VertexId | null }
  | { kind: 'preRoll' }
  /** `lazy`: amounts are computed when the phase is reached (after a free pick on a 7). */
  | { kind: 'discard'; pending: Record<string, number>; resume: Phase; lazy?: boolean }
  | { kind: 'robber'; reason: 'seven' | 'knight'; resume: Phase }
  | { kind: 'gold'; pending: Record<string, number>; resume: Phase }
  | { kind: 'main' }
  | { kind: 'roadBuilding'; remaining: number; resume: Phase }
  | { kind: 'specialBuild'; queue: PlayerId[] }
  | { kind: 'scenario'; step: string; player: PlayerId; data?: unknown; resume: Phase }
  | { kind: 'gameOver'; winner: PlayerId | null; reason: string };

export interface LogEntry {
  turn: number;
  msg: string;
  /** When set, only these players (and omniscient viewers) see the entry. */
  visibleTo?: PlayerId[];
}

export interface RngState {
  s: number;
}

export type TradeBuildMode = 'combined' | 'separate';
export type FiveSixMode = 'paired' | 'specialBuild';

/**
 * Which board a game is played on:
 * - 'official': the set-up map printed in the rulebook (default). Only what
 *   the rulebook itself shuffles (fog tiles, some harbor types, New World) varies.
 * - 'random': the scenario's shuffled set-up (tiles, numbers and harbors).
 */
export type MapLayout = 'official' | 'random';

export interface GameOptions {
  /** The rulebook's map (default) or a random one. Games saved before this option existed were random. */
  layout: MapLayout;
  /** Trade and build interleave freely (default) or trade strictly precedes build. */
  tradeBuildMode: TradeBuildMode;
  /** 5-6 players: 2021 paired-player rule (default) or the legacy Special Build Phase. */
  fiveSixMode: FiveSixMode;
  /** Number-token placement for random maps. 'spiral' only applies to the random base 3-4 board. */
  tokenPlacement: 'spiral' | 'random';
  /** Forbid adjacent 6/8 tokens (on by default). */
  noAdjacentRed: boolean;
  /** House rule: forbid adjacent 2/12 tokens. */
  noAdjacent2and12: boolean;
  /** House rule: forbid identical adjacent tokens. */
  noAdjacentSameNumber: boolean;
  /** House rule: the robber may not target players with 2 or fewer public VP. */
  friendlyRobber: boolean;
  /** Hand size above which a 7 forces a discard. */
  discardLimit: number;
  /** Gold hexes adjacent to the second starting settlement pay a chosen resource. */
  setupGoldYield: 'choose' | 'none';
  /** Overrides the scenario's victory point target. */
  victoryPoints?: number;
  /** Fix the starting player instead of rolling for it. */
  firstPlayer?: PlayerId;
}

export interface GameConfig {
  scenario: string;
  players: string[] | number;
  seed: string | number;
  options?: Partial<GameOptions>;
}

export interface DiceRoll {
  by: PlayerId;
  dice: [number, number];
  turn: number;
}

export interface GameState {
  version: 1;
  scenario: string;
  seed: string;
  options: GameOptions;
  victoryTarget: number;
  rng: RngState;
  board: BoardState;
  players: PlayerState[];
  bank: ResourceCounts;
  /** Hidden draw pile, top of the deck is the last element. */
  devDeck: DevCardType[];
  /** Every roll of the dice, in order (public; older saves may lack it). */
  rolls?: DiceRoll[];
  longestRoute: { holder: PlayerId | null; lengths: number[] };
  largestArmy: { holder: PlayerId | null };
  turn: TurnState;
  phase: Phase;
  /** Order in which players take their first turn (index 0 starts). */
  firstPlayer: PlayerId;
  /** Scenario-owned state (fog stacks, gifts, cloth, fortresses, wonders...). */
  ext: Record<string, unknown>;
  log: LogEntry[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'placeHarbor'; player: PlayerId; edge: EdgeId; index?: number }
  | { type: 'placeSettlement'; player: PlayerId; vertex: VertexId }
  | { type: 'placeRoad'; player: PlayerId; edge: EdgeId }
  | { type: 'placeShip'; player: PlayerId; edge: EdgeId }
  | { type: 'rollDice'; player: PlayerId }
  | { type: 'discard'; player: PlayerId; cards: PartialCounts }
  /** `take` defaults to a random resource card; scenarios may offer more (Cloth: 'cloth'). */
  | { type: 'moveRobber'; player: PlayerId; piece: 'robber' | 'pirate'; hex: HexId; victim?: PlayerId; take?: string }
  | { type: 'chooseGold'; player: PlayerId; resources: PartialCounts }
  | { type: 'buildRoad'; player: PlayerId; edge: EdgeId }
  | { type: 'buildShip'; player: PlayerId; edge: EdgeId }
  | { type: 'moveShip'; player: PlayerId; from: EdgeId; to: EdgeId }
  | { type: 'buildSettlement'; player: PlayerId; vertex: VertexId }
  | { type: 'buildCity'; player: PlayerId; vertex: VertexId }
  | { type: 'buyDevCard'; player: PlayerId }
  | { type: 'playKnight'; player: PlayerId }
  | { type: 'playRoadBuilding'; player: PlayerId }
  | { type: 'playYearOfPlenty'; player: PlayerId; resources: Resource[] }
  | { type: 'playMonopoly'; player: PlayerId; resource: Resource }
  | { type: 'endRoadBuilding'; player: PlayerId }
  | {
      type: 'proposeTrade';
      player: PlayerId;
      give: PartialCounts;
      get: PartialCounts;
      to: PlayerId[];
      /** Active player only: leave `give` or `get` empty and let the others offer the other side. */
      open?: boolean;
      /** Counter-offer to this offer (addressed to its proposer); an open offer's fixed side must be kept. */
      replyTo?: number;
    }
  | { type: 'acceptTrade'; player: PlayerId; tradeId: number }
  | { type: 'rejectTrade'; player: PlayerId; tradeId: number }
  | { type: 'confirmTrade'; player: PlayerId; tradeId: number; partner: PlayerId }
  | { type: 'cancelTrade'; player: PlayerId; tradeId: number }
  | { type: 'bankTrade'; player: PlayerId; give: PartialCounts; get: PartialCounts }
  | { type: 'endTurn'; player: PlayerId }
  /** Scenario-specific actions (claim wonder, attack fortress, convert warship, ...). */
  | { type: 'scenario'; player: PlayerId; name: string; args?: Record<string, unknown> };

export type ActionType = Action['type'];

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };
