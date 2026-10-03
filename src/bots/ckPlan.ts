import type { GameState } from '../core/types.js';
import { publicVP } from '../rules/queries.js';

/**
 * Estimates the hard level's Cities & Knights strategy plans with
 * (src/bots/ckBot.ts), from public information only.
 */

/**
 * Progress cards per roll that level `level` of a track draws beyond the
 * level below it: a city gate of its colour (1 in 6) with the red die on one
 * of the level + 1 faces it draws on, so two faces at level 1 and one more
 * at each level after.
 */
export function drawGain(level: number): number {
  return level <= 0 ? 0 : level === 1 ? 2 / 36 : 1 / 36;
}

/**
 * Rolls the game likely has left: the player closest to the target gains
 * about a VP every two rounds of turns (at least two rounds).
 */
export function remainingRolls(s: GameState): number {
  let gap = Infinity;
  for (const pl of s.players) gap = Math.min(gap, s.victoryTarget - publicVP(s, pl.id));
  return Math.max(2, gap * 1.7) * s.players.length;
}
