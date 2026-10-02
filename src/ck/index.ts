/**
 * Cities & Knights: a rules module that applies on top of a scenario
 * (`GameOptions.citiesAndKnights`), with its state in `GameState.ck`.
 * docs/cities-and-knights.md describes the rules as implemented.
 */
export * from './constants.js';
export { ckVP, commodityCount, knightAt, opponentKnightAt } from './basics.js';
export {
  bankHas,
  bankOf,
  cardKinds,
  cardRates,
  handOf,
  hasCards,
  isCardOf,
  isCommodity,
  moveCards,
  sameCards,
  stealRandomCard,
  validCards,
} from './cards.js';
export {
  barbarianAttack,
  barbarianStrength,
  citiesOf,
  ckRollDice,
  improvementError,
  improvementPrice,
  initCk,
  isMetropolis,
  isTipped,
  merchantHexError,
  metropolisSites,
  pillage,
  pillageableCities,
  placeMerchant,
  produceCards,
  progressTimingError,
  robberActive,
  setupPlacesCity,
  sevenLimit,
  winsMetropolis,
} from './engine.js';
export {
  KNIGHT_NAMES,
  activeStrength,
  chaseError,
  displaceError,
  knightCanAct,
  knightPlacementError,
  knightReach,
  knightSiteError,
  knightsInSupply,
  knightsOf,
  moveKnightError,
  onOwnRoute,
  promoteError,
  retreatSpots,
} from './knights.js';
export { cardCombinations, ckBankTradeActions, ckBuildActions, knightActions, progressPlays, progressTurnChoices } from './legal.js';
export { openRoadError } from './effects.js';
export { CK_BEGINNERS, ckMapSpec } from './map.js';
export { CK_BLOCKED_SCENARIOS, CK_SEAFARERS_VP_BONUS, ckCombines, ckScenarioError, ckSeafarers, ckVictoryPoints } from './seafarers.js';
export {
  drawProgress,
  effectCards,
  newDecks,
  progressDiscardsDue,
  progressEffect,
  progressExcess,
  registerProgressEffect,
  returnToDeck,
  takeFromHand,
  type ProgressArgs,
  type ProgressEffect,
} from './progress.js';
export { ckViewFor, type CkPlayerView, type CkView } from './view.js';
