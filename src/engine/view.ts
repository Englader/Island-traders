import type {
  BoardState,
  DevCardInHand,
  GameOptions,
  GameState,
  GameStats,
  DiceRoll,
  LogEntry,
  Phase,
  PieceSupply,
  PlayerId,
  ResourceCounts,
  TurnState,
} from '../core/types.js';
import { handSize, publicVP, totalVP } from '../rules/queries.js';
import { scenarioOf } from '../scenarios/registry.js';

export interface PlayerPublicView {
  id: PlayerId;
  name: string;
  /** Hand size is public; players must answer truthfully when asked. */
  resourceCount: number;
  /** Only present for the viewer's own seat (or omniscient views). */
  resources?: ResourceCounts;
  devCardCount: number;
  devCards?: DevCardInHand[];
  playedKnights: number;
  playedProgress: string[];
  supply: PieceSupply;
  publicVP: number;
  /** Including hidden VP cards; own seat only. */
  totalVP?: number;
  bonusVP: number;
  bonusZones: string[];
  homeZones: string[];
}

export interface GameView {
  viewer: PlayerId | null;
  scenario: string;
  options: GameOptions;
  victoryTarget: number;
  board: BoardState;
  bank: ResourceCounts;
  devDeckCount: number;
  longestRoute: GameState['longestRoute'];
  largestArmy: GameState['largestArmy'];
  turn: TurnState;
  phase: Phase;
  firstPlayer: PlayerId;
  players: PlayerPublicView[];
  ext: Record<string, unknown>;
  log: LogEntry[];
  /** Every roll so far: who rolled and what (for the dice statistics). */
  rolls: DiceRoll[];
  /**
   * End-of-game statistics, only once the game is over (they include steals
   * and hands, which are hidden during play). Missing for older saves.
   */
  stats?: GameStats;
}

/**
 * The information one seat is allowed to see. Hidden state (other hands,
 * development card identities, deck order, RNG state, fog stack, face-down
 * scenario tokens) is removed. `viewer = null` gives a spectator view.
 */
export function viewFor(state: GameState, viewer: PlayerId | null): GameView {
  const s = structuredClone(state);
  scenarioOf(s).hooks.redact?.(s, viewer);
  const ext = { ...s.ext };
  if (ext.fog && typeof ext.fog === 'object') {
    const fog = ext.fog as { terrains: unknown[]; tokens: unknown[] };
    ext.fog = { terrainsLeft: fog.terrains.length, tokensLeft: fog.tokens.length };
  }
  if (Array.isArray(ext.harborPool)) {
    // The next harbor to place is shown to everyone; the rest stay face down.
    const pool = ext.harborPool as unknown[];
    ext.harborPool = { remaining: pool.length, next: pool[pool.length - 1] ?? null };
  }
  const gameOver = s.phase.kind === 'gameOver';
  return {
    viewer,
    scenario: s.scenario,
    options: s.options,
    victoryTarget: s.victoryTarget,
    board: s.board,
    bank: s.bank,
    devDeckCount: s.devDeck.length,
    longestRoute: s.longestRoute,
    largestArmy: s.largestArmy,
    turn: s.turn,
    phase: s.phase,
    firstPlayer: s.firstPlayer,
    players: s.players.map((pl) => {
      const own = viewer === pl.id || gameOver;
      const v: PlayerPublicView = {
        id: pl.id,
        name: pl.name,
        resourceCount: handSize(s, pl.id),
        devCardCount: pl.devCards.length,
        playedKnights: pl.playedKnights,
        playedProgress: [...pl.playedProgress],
        supply: pl.supply,
        publicVP: publicVP(s, pl.id),
        bonusVP: pl.bonusVP,
        bonusZones: pl.bonusZones,
        homeZones: pl.homeZones,
      };
      if (own) {
        v.resources = pl.resources;
        v.devCards = pl.devCards;
        v.totalVP = totalVP(s, pl.id);
      }
      return v;
    }),
    ext,
    log: s.log.filter((e) => !e.visibleTo || (viewer !== null && e.visibleTo.includes(viewer))),
    rolls: s.rolls ?? [],
    ...(gameOver && s.stats ? { stats: s.stats } : {}),
  };
}
