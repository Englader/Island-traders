/**
 * The hard level's Cities & Knights weights: the numbers its strategy
 * (src/bots/ckBot.ts, src/bots/ckPlan.ts) is tuned by, in one place so
 * `npm run bots:tune-ck` (scripts/bot-tune-ck.ts) can search over them and
 * `npm run bots:match` can try other values (`--w=name:value,...`).
 */
export interface CkWeights {
  // --- the barbarians -------------------------------------------------------
  /** Ship moves out from which it keeps a knight on the board ready to wake. */
  planAhead: number;
  /** How many knight levels ahead of where it stands it races for Defender of Catan (4 players or fewer; one more near the end). */
  defenderReach: number;
  /** What a Defender of Catan card is worth, in cards (1.8 times that 2 VP from the win). */
  defenderWorth: number;
  /** Share of the others' idle knights it expects them to wake before the attack. */
  idleShare: number;
  /** How many knight levels behind the best of the others it catches up to tie them, so nobody becomes Defender (3-4 players; 0: never). */
  tieReach: number;
  /** What such a tie is worth, in cards (a progress card, and the Defender's VP kept from a rival). */
  tieWorth: number;
  /** Knight levels more it ties up to when waking its idle knights is all it takes. */
  tieIdle: number;
  /** Ship moves out from which it wakes knights with spare grain. */
  earlyWake: number;
  /** Knights it keeps on the board to guard its best hexes from the robber. */
  guards: number;

  // --- improvements and builds ------------------------------------------------
  /** Tracks other than its main one: the levels it buys for their progress cards. */
  cheapLevel: number;
  /** What a progress card drawn is worth, in cards (what an improvement level's extra draws are worth). */
  cardWorth: number;
  /** Trades resources at the bank for an improvement level whose draws (ability, metropolis) are worth more than the cards, each card counted times this (0: never). */
  levelTrade: number;
  /** Above 0: those trades for a level that wins a metropolis come before what it saves for (a city or settlement apart). */
  metropolisFirst: number;
  /** The turn planner: what a settlement's or city's VP is worth, in production points. */
  buildVP: number;
  /** The turn planner: what each card spent (traded away included) costs, in production points. */
  buildCard: number;
  /** Builds a city wall with spare bricks once its hand is within this many cards of the 7 limit. */
  wallMargin: number;
  /** VP from the win within which it builds roads for Longest Road. */
  routeGap: number;
  /** The Wonders: how much sooner than other goals it saves for its wonder's next level (at 1 or more it builds a level whenever it can). */
  wonderRush: number;

  // --- progress cards -----------------------------------------------------------
  /** What a card the Saboteur makes an opponent discard is worth to the player, times how much it minds that opponent. */
  sabotage: number;
  /** Above 0: the Monopolies go by the card tracker's estimate of the other hands (src/bots/tracker.ts), not by what the others produce. */
  tracked: number;
}

export const HARD_CK_WEIGHTS: CkWeights = {
  planAhead: 5,
  defenderReach: 0,
  defenderWorth: 5,
  idleShare: 0.5,
  tieReach: 1,
  tieWorth: 4,
  tieIdle: 1,
  earlyWake: 4,
  guards: 3,
  cheapLevel: 2,
  cardWorth: 2.5,
  levelTrade: 1,
  metropolisFirst: 1,
  buildVP: 6,
  buildCard: 0.75,
  wallMargin: 2,
  routeGap: 4,
  wonderRush: 3,
  sabotage: 0.35,
  tracked: 1,
};

/** The weights' names, in a fixed order (the tuner's parameter vector). */
export const CK_WEIGHT_NAMES = Object.keys(HARD_CK_WEIGHTS) as Array<keyof CkWeights>;
