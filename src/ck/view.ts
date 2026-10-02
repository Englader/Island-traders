import type {
  CkState,
  CommodityCounts,
  EventFace,
  GameState,
  HexId,
  ImprovementTrack,
  Knight,
  PlayerId,
  ProgressCardName,
  VertexId,
} from '../core/types.js';
import { BARBARIAN_TRACK } from './constants.js';

export interface CkPlayerView {
  /** Commodity cards in hand (public, like the hand size). */
  commodityCount: number;
  /** The commodities themselves: own seat only (or once the game is over). */
  commodities?: CommodityCounts;
  progressCount: number;
  /** Progress cards in hand: own seat only (or once the game is over). */
  progress?: ProgressCardName[];
  improvements: Record<ImprovementTrack, number>;
  walls: VertexId[];
  /** VP progress cards played face up (public). */
  vpCards: ProgressCardName[];
  /** Defender of Catan cards (public). */
  defenders: number;
}

/** What a seat sees of the Cities & Knights state. */
export interface CkView {
  bank: CommodityCounts;
  barbarians: number;
  /** Length of the barbarian track. */
  track: number;
  attacks: number;
  /** The robber (and pirate) may move: the barbarians have attacked. */
  robberActive: boolean;
  /** Cards left in each progress deck (their order is hidden). */
  decks: Record<ImprovementTrack, number>;
  defenderCards: number;
  knights: Record<VertexId, Knight>;
  metropolises: CkState['metropolises'];
  merchant: { hex: HexId; owner: PlayerId } | null;
  tipped: VertexId[];
  event: EventFace | null;
  turnEffects: CkState['turnEffects'];
  /** Progress cards played so far, oldest first (played cards are public). */
  played: NonNullable<CkState['played']>;
  /** Seafarers: the robber and pirate waiting by the barbarian track, and where they will start (public). */
  asleep?: NonNullable<CkState['asleep']>;
  players: CkPlayerView[];
}

/**
 * The Cities & Knights part of `viewFor`: other players' commodities and
 * progress cards are counts only, deck order is hidden; played progress
 * cards, VP progress cards, Defender of Catan cards, knights, improvements
 * and walls are public. (What a Spy or Master Merchant sees is in the card's
 * phase `data`, which `viewFor` shows to that player only.)
 */
export function ckViewFor(s: GameState, viewer: PlayerId | null): CkView | undefined {
  const ck = s.ck;
  if (!ck) return undefined;
  const open = s.phase.kind === 'gameOver';
  return {
    bank: { ...ck.bank },
    barbarians: ck.barbarians,
    track: BARBARIAN_TRACK,
    attacks: ck.attacks,
    robberActive: ck.attacks > 0,
    decks: { trade: ck.decks.trade.length, politics: ck.decks.politics.length, science: ck.decks.science.length },
    defenderCards: ck.defenderCards,
    knights: structuredClone(ck.knights),
    metropolises: structuredClone(ck.metropolises),
    merchant: ck.merchant ? { ...ck.merchant } : null,
    tipped: [...ck.tipped],
    event: ck.event,
    turnEffects: structuredClone(ck.turnEffects),
    played: structuredClone(ck.played ?? []),
    ...(ck.asleep ? { asleep: { ...ck.asleep } } : {}),
    players: ck.players.map((pl, id) => {
      const own = open || viewer === id;
      const c = pl.commodities;
      const v: CkPlayerView = {
        commodityCount: c.paper + c.cloth + c.coin,
        progressCount: pl.progress.length,
        improvements: { ...pl.improvements },
        walls: [...pl.walls],
        vpCards: [...pl.vpCards],
        defenders: pl.defenders,
      };
      if (own) {
        v.commodities = { ...c };
        v.progress = [...pl.progress];
      }
      return v;
    }),
  };
}
