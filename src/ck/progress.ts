import { shuffle } from '../core/rng.js';
import type { GameState, ImprovementTrack, PlayerId, ProgressCardName, RngState } from '../core/types.js';
import { log, nameOf } from '../rules/helpers.js';
import { PROGRESS_CARD_NAMES, PROGRESS_CARDS, PROGRESS_HAND_LIMIT, TRACKS } from './constants.js';

/**
 * Progress cards (5th-edition rules pp. 9-10, Almanac pp. 14-18): three
 * shuffled decks of 18, drawn from by the event die or as a tied Defender of
 * Catan. A hand holds at most 4 (VP cards are played face up at once and do
 * not count); a player over the limit outside their own turn discards at
 * once, the player whose turn it is by the end of the turn. Played and
 * discarded cards go face down under their deck.
 *
 * The card effects are phase 2: they register here with
 * `registerProgressEffect`, and the engine offers and plays only the cards
 * that have an effect.
 */

export function newDecks(rng: RngState): Record<ImprovementTrack, ProgressCardName[]> {
  const decks: Record<ImprovementTrack, ProgressCardName[]> = { trade: [], politics: [], science: [] };
  for (const name of PROGRESS_CARD_NAMES) {
    const info = PROGRESS_CARDS[name];
    for (let i = 0; i < info.count; i++) decks[info.deck].push(name);
  }
  for (const t of TRACKS) shuffle(rng, decks[t]);
  return decks;
}

/**
 * Draws the top card of a deck. A VP card is played face up at once; any
 * other card goes to the hand (hidden). Returns the card, or null when the
 * deck is empty.
 */
export function drawProgress(s: GameState, p: PlayerId, deck: ImprovementTrack): ProgressCardName | null {
  const ck = s.ck!;
  const card = ck.decks[deck].pop();
  if (!card) {
    log(s, `The ${deck} deck is empty: ${nameOf(s, p)} draws nothing`);
    return null;
  }
  const info = PROGRESS_CARDS[card];
  if (info.vp) {
    ck.players[p].vpCards.push(card);
    log(s, `${nameOf(s, p)} draws ${info.title}: 1 victory point`);
  } else {
    ck.players[p].progress.push(card);
    log(s, `${nameOf(s, p)} draws a ${deck} progress card`);
    log(s, `(${nameOf(s, p)} drew ${info.title})`, [p]);
  }
  return card;
}

/** Puts a card face down under its deck (played or discarded). */
export function returnToDeck(s: GameState, card: ProgressCardName): void {
  s.ck!.decks[PROGRESS_CARDS[card].deck].unshift(card);
}

/** Removes one copy of `card` from the player's hand; false if they have none. */
export function takeFromHand(s: GameState, p: PlayerId, card: ProgressCardName): boolean {
  const hand = s.ck!.players[p].progress;
  const i = hand.indexOf(card);
  if (i < 0) return false;
  hand.splice(i, 1);
  return true;
}

/** Cards over the hand limit. */
export function progressExcess(s: GameState, p: PlayerId): number {
  return Math.max(0, s.ck!.players[p].progress.length - PROGRESS_HAND_LIMIT);
}

/** Players other than the one whose turn it is who must discard down to the limit now. */
export function progressDiscardsDue(s: GameState): Record<string, number> {
  const pending: Record<string, number> = {};
  for (const pl of s.players) {
    if (pl.id === s.turn.actor) continue;
    const n = progressExcess(s, pl.id);
    if (n > 0) pending[pl.id] = n;
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Effects (phase 2)
// ---------------------------------------------------------------------------

export type ProgressArgs = Record<string, unknown> | undefined;

/**
 * A progress card's effect. The engine checks the timing (after the roll on
 * your own turn; before it for `beforeRoll` cards), takes the card from the
 * hand and puts it under its deck, then calls `play` on the cloned state.
 * Returning an error rejects the whole action.
 *
 * A card that needs other players' choices (Spy, Deserter, Commercial
 * Harbor, Saboteur...) sets the phase to `{ kind: 'ck', step: 'card', ... }`
 * and answers the `progressChoice` actions in `respond`; `choices` lists them.
 */
export interface ProgressEffect {
  /** Every legal `args` for playing the card now (empty: not playable now). */
  options(s: GameState, p: PlayerId): ProgressArgs[];
  play(s: GameState, p: PlayerId, args: ProgressArgs): string | null;
  respond?(s: GameState, p: PlayerId, args: ProgressArgs): string | null;
  choices?(s: GameState, p: PlayerId): ProgressArgs[];
}

const EFFECTS: Partial<Record<ProgressCardName, ProgressEffect>> = {};

export function registerProgressEffect(card: ProgressCardName, effect: ProgressEffect): void {
  EFFECTS[card] = effect;
}

export function progressEffect(card: ProgressCardName): ProgressEffect | undefined {
  return EFFECTS[card];
}
