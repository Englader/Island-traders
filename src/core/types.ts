/**
 * Core data model. Everything in `GameState` is plain JSON so a game can be
 * serialised, sent over the wire, stored and replayed. Static board topology
 * (vertex/edge adjacency) is derived from the hex layout and cached outside the
 * state (see board/topology.ts).
 */

export type Resource = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
export type ResourceCounts = Record<Resource, number>;
export type PartialCounts = Partial<Record<Resource, number>>;

/** Cities & Knights: the refined goods cities make on forest, pasture and mountains. */
export type Commodity = 'paper' | 'cloth' | 'coin';
export type CommodityCounts = Record<Commodity, number>;
/** A card in hand: a resource, or (Cities & Knights) a commodity. */
export type Card = Resource | Commodity;
/**
 * Cards in trades, discards and costs. Commodity keys are only valid in
 * Cities & Knights games; elsewhere the engine rejects them.
 */
export type CardCounts = Partial<Record<Card, number>>;

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
  give: CardCounts;
  /** What `from` receives. */
  get: CardCounts;
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
  /**
   * `piece` limits the move to the robber or the pirate. `chase`: a Cities &
   * Knights knight chases the piece away (the robber goes to a numbered hex).
   */
  | { kind: 'robber'; reason: 'seven' | 'knight' | 'chase'; resume: Phase; piece?: 'robber' | 'pirate' }
  | { kind: 'gold'; pending: Record<string, number>; resume: Phase }
  | { kind: 'main' }
  | { kind: 'roadBuilding'; remaining: number; resume: Phase }
  | { kind: 'specialBuild'; queue: PlayerId[] }
  | { kind: 'scenario'; step: string; player: PlayerId; data?: unknown; resume: Phase }
  | CkPhase
  | { kind: 'gameOver'; winner: PlayerId | null; reason: string };

/**
 * Cities & Knights decision points that interrupt the turn (src/ck). Each
 * resumes `resume` when done; `pending` maps a player to how many choices
 * they still owe.
 */
export type CkPhase =
  /** Resolves production (or the 7) for the roll once the event die is done; nobody acts. */
  | { kind: 'ck'; step: 'production'; resume: Phase }
  /** Barbarians won: each listed player picks one of their cities to be pillaged. */
  | { kind: 'ck'; step: 'pillage'; pending: Record<string, number>; resume: Phase }
  /** Barbarians beaten with a tie for the most knights: the tied players pick a progress deck to draw from, in turn order. */
  | { kind: 'ck'; step: 'defenderDraw'; queue: PlayerId[]; resume: Phase }
  /** Players other than the active one discard progress cards down to the limit. `lazy`: counted when reached. */
  | { kind: 'ck'; step: 'progressDiscard'; pending: Record<string, number>; resume: Phase; lazy?: boolean }
  /** Aqueduct: players who got nothing from a production roll may take one resource. */
  | { kind: 'ck'; step: 'aqueduct'; pending: Record<string, number>; resume: Phase }
  /** A displaced knight's owner moves it along their own roads (it left `from`). */
  | { kind: 'ck'; step: 'retreat'; player: PlayerId; from: VertexId; knight: Knight; resume: Phase }
  /**
   * A progress card waiting on a player's choice (phase 2: Spy, Deserter,
   * Commercial Harbor...). The card's effect owns `data` and answers
   * `progressChoice` actions from `player` (or the `pending` players).
   */
  | {
      kind: 'ck';
      step: 'card';
      card: ProgressCardName;
      player: PlayerId;
      pending?: Record<string, number>;
      data?: unknown;
      resume: Phase;
    };

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
  /**
   * Play with the Cities & Knights rules (state in `GameState.ck`). A rules
   * module, not a scenario: it applies on top of the chosen scenario. Absent
   * in games without it, so their state is unchanged.
   */
  citiesAndKnights?: boolean;
}

export interface GameConfig {
  scenario: string;
  players: string[] | number;
  seed: string | number;
  options?: Partial<GameOptions>;
}

export interface DiceRoll {
  by: PlayerId;
  /** Cities & Knights: [yellow, red]. */
  dice: [number, number];
  turn: number;
  /** Cities & Knights: the event die. */
  event?: EventFace;
}

/**
 * Per-player counters for the end-of-game statistics, kept by applyAction
 * (engine/stats.ts). Card counts are numbers of resource cards.
 */
export interface PlayerStats {
  /** Cards from dice production, gold-field picks included, by resource. */
  produced: ResourceCounts;
  /** What the dice should have produced on average (sum over rolls), in 36ths of a card. */
  expected36: number;
  /** Cards received from and given to other players in trades. */
  tradeIn: number;
  tradeOut: number;
  /** Cards received from and given to the bank in maritime trades. */
  bankIn: number;
  bankOut: number;
  /** Cards taken from others with the robber, the pirate or Monopoly, and cards lost to them. */
  stole: number;
  stolen: number;
  /** Cards discarded on a 7. */
  discarded: number;
  /** Cards lost to the bank in other ways (pirate fleet raids). */
  lost: number;
  /** Cards paid for pieces, development cards and scenario builds. */
  spent: number;
  /** Cards received in other ways: starting resources, Year of Plenty, discoveries. */
  other: number;
  /** Trades completed with other players, and with the bank. */
  trades: number;
  bankTrades: number;
  devBought: number;
  devPlayed: number;
  knights: number;
  /** VP (VP cards included) after the setup and after every turn; the last entry is the final score. */
  vp: number[];
  /** Cities & Knights: commodities from dice production. */
  producedCommodities?: CommodityCounts;
}

export interface GameStats {
  players: PlayerStats[];
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
  /** End-of-game statistics (hidden until the game is over; older saves lack it). */
  stats?: GameStats;
  longestRoute: { holder: PlayerId | null; lengths: number[] };
  largestArmy: { holder: PlayerId | null };
  turn: TurnState;
  phase: Phase;
  /** Order in which players take their first turn (index 0 starts). */
  firstPlayer: PlayerId;
  /** Scenario-owned state (fog stacks, gifts, cloth, fortresses, wonders...). */
  ext: Record<string, unknown>;
  /** Cities & Knights state; present only when `options.citiesAndKnights` is on. */
  ck?: CkState;
  log: LogEntry[];
}

// ---------------------------------------------------------------------------
// Cities & Knights
// ---------------------------------------------------------------------------

/** The three city improvement tracks: trade (yellow, cloth), politics (blue, coin), science (green, paper). */
export type ImprovementTrack = 'trade' | 'politics' | 'science';

/** Faces of the event die: the barbarian ship (3 faces) or a city gate of a track's colour. */
export type EventFace = 'ship' | ImprovementTrack;

export type ProgressCardName =
  // science (green)
  | 'alchemist'
  | 'crane'
  | 'engineer'
  | 'inventor'
  | 'irrigation'
  | 'medicine'
  | 'mining'
  | 'printer'
  | 'roadBuilding'
  | 'smith'
  // politics (blue)
  | 'bishop'
  | 'constitution'
  | 'deserter'
  | 'diplomat'
  | 'intrigue'
  | 'saboteur'
  | 'spy'
  | 'warlord'
  | 'wedding'
  // trade (yellow)
  | 'commercialHarbor'
  | 'masterMerchant'
  | 'merchant'
  | 'merchantFleet'
  | 'resourceMonopoly'
  | 'tradeMonopoly';

/** 1 basic, 2 strong, 3 mighty: also the knight's strength. */
export type KnightLevel = 1 | 2 | 3;

export interface Knight {
  owner: PlayerId;
  level: KnightLevel;
  active: boolean;
  /** Turn part in which it was last activated: it may not act in that part. */
  activatedPart: number;
  /** Turn part in which it was last promoted (once per turn). */
  promotedPart: number;
}

export interface CkPlayerState {
  /** Commodity cards in hand (hidden like resources). */
  commodities: CommodityCounts;
  /** City improvement level per track, 0-5. */
  improvements: Record<ImprovementTrack, number>;
  /** Cities with a city wall (at most 3). */
  walls: VertexId[];
  /** Progress cards in hand (hidden). */
  progress: ProgressCardName[];
  /** Victory point progress cards played face up (Constitution, Printer). */
  vpCards: ProgressCardName[];
  /** "Defender of Catan" VP cards. */
  defenders: number;
}

export interface CkState {
  /** The commodity supply. */
  bank: CommodityCounts;
  /** Spaces the barbarian ship has moved toward Catan (it attacks on reaching the end of the track). */
  barbarians: number;
  /** Barbarian attacks so far; the robber (and pirate) only move after the first. */
  attacks: number;
  /** Face-down progress decks; the top card is the last element (hidden). */
  decks: Record<ImprovementTrack, ProgressCardName[]>;
  /** Defender of Catan cards left. */
  defenderCards: number;
  knights: Record<VertexId, Knight>;
  /** Who holds each metropolis, and on which city. */
  metropolises: Record<ImprovementTrack, { owner: PlayerId; vertex: VertexId } | null>;
  /** Placed by a Merchant progress card: its owner trades the hex's resource 2:1 and holds 1 VP. */
  merchant: { hex: HexId; owner: PlayerId } | null;
  /**
   * Cities pillaged while their owner had no settlement left: the city piece
   * lies on its side as a settlement and must be the next one upgraded.
   */
  tipped: VertexId[];
  /** The event die of the current turn (null before the roll). */
  event: EventFace | null;
  /**
   * Effects that last for the rest of a part of a turn (phase 2: Crane,
   * Merchant Fleet, Commercial Harbor). Cleared when a part begins.
   */
  turnEffects: Array<{ player: PlayerId; effect: string; data?: unknown }>;
  players: CkPlayerState[];
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
  | { type: 'discard'; player: PlayerId; cards: CardCounts }
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
      give: CardCounts;
      get: CardCounts;
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
  | { type: 'bankTrade'; player: PlayerId; give: CardCounts; get: CardCounts }
  | { type: 'endTurn'; player: PlayerId }
  // --- Cities & Knights -------------------------------------------------------
  /** Hire a basic knight (1 wool, 1 ore) on an empty intersection on your road. */
  | { type: 'buildKnight'; player: PlayerId; vertex: VertexId }
  /** Activate an inactive knight (1 grain). */
  | { type: 'activateKnight'; player: PlayerId; vertex: VertexId }
  /** Promote a knight one level (1 wool, 1 ore; mighty needs the politics level 3). */
  | { type: 'promoteKnight'; player: PlayerId; vertex: VertexId }
  /** Move an active knight along your roads to an empty intersection. */
  | { type: 'moveKnight'; player: PlayerId; from: VertexId; to: VertexId }
  /** Move an active knight onto a weaker opposing knight, which must retreat. */
  | { type: 'displaceKnight'; player: PlayerId; from: VertexId; to: VertexId }
  /** The displaced knight's owner moves it to an empty intersection on their roads. */
  | { type: 'retreatKnight'; player: PlayerId; to: VertexId }
  /** An active knight next to the robber (or pirate) chases it away: then move it with moveRobber. */
  | { type: 'chaseRobber'; player: PlayerId; vertex: VertexId; piece: 'robber' | 'pirate' }
  /** Build a city wall (2 brick) under one of your cities. */
  | { type: 'buildCityWall'; player: PlayerId; vertex: VertexId }
  /**
   * Buy the next city improvement of a track with its commodity. `vertex`:
   * the city that takes the metropolis, when this improvement wins one.
   */
  | { type: 'improveCity'; player: PlayerId; track: ImprovementTrack; vertex?: VertexId }
  /** Barbarians won: the city you lose. */
  | { type: 'pillageCity'; player: PlayerId; vertex: VertexId }
  /** Tied Defenders of Catan: the deck you draw from. */
  | { type: 'drawProgress'; player: PlayerId; deck: ImprovementTrack }
  /** Over the hand limit of progress cards: the card you put under its deck. */
  | { type: 'discardProgress'; player: PlayerId; card: ProgressCardName }
  /** Aqueduct: the resource you take after a roll that gave you nothing (none: decline). */
  | { type: 'aqueduct'; player: PlayerId; resource?: Resource }
  /** Play a progress card; `args` depend on the card (effects: src/ck/progress.ts). */
  | { type: 'playProgress'; player: PlayerId; card: ProgressCardName; args?: Record<string, unknown> }
  /** Answer a progress card that waits on your choice (phase 'ck', step 'card'). */
  | { type: 'progressChoice'; player: PlayerId; args?: Record<string, unknown> }
  /** Scenario-specific actions (claim wonder, attack fortress, convert warship, ...). */
  | { type: 'scenario'; player: PlayerId; name: string; args?: Record<string, unknown> };

export type ActionType = Action['type'];

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };
