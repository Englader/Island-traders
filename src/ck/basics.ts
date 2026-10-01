import type { GameState, Knight, PlayerId, VertexId } from '../core/types.js';
import { MERCHANT_VP, METROPOLIS_VP, TRACKS } from './constants.js';

/**
 * Cities & Knights queries the core rules need (VP, hand size, knights on
 * paths). They depend only on the state, so rules/queries.ts and
 * rules/longestRoute.ts can use them; in games without the expansion they
 * add nothing.
 */

export function knightAt(s: GameState, v: VertexId): Knight | undefined {
  return s.ck?.knights[v];
}

/** Another player's knight blocks roads and breaks routes like a building (p. 9). */
export function opponentKnightAt(s: GameState, p: PlayerId, v: VertexId): boolean {
  const k = s.ck?.knights[v];
  return !!k && k.owner !== p;
}

/** Commodity cards in a player's hand (they count toward the hand on a 7, p. 7). */
export function commodityCount(s: GameState, p: PlayerId): number {
  const c = s.ck?.players[p].commodities;
  return c ? c.paper + c.cloth + c.coin : 0;
}

/** Public VP from the expansion: metropolises, Defender of Catan cards, VP progress cards, the merchant. */
export function ckVP(s: GameState, p: PlayerId): number {
  const ck = s.ck;
  if (!ck) return 0;
  let vp = 0;
  for (const t of TRACKS) if (ck.metropolises[t]?.owner === p) vp += METROPOLIS_VP;
  vp += ck.players[p].defenders + ck.players[p].vpCards.length;
  if (ck.merchant?.owner === p) vp += MERCHANT_VP;
  return vp;
}
