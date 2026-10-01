import { CARDS, COMMODITIES, RESOURCES, TERRAIN_RESOURCE } from '../core/constants.js';
import { hasAtLeast, isResource, sameCounts, transfer, validCounts } from '../core/resources.js';
import { nextInt } from '../core/rng.js';
import type { Card, CardCounts, Commodity, GameState, PlayerId } from '../core/types.js';
import { log, nameOf } from '../rules/helpers.js';
import { ownsBuildingAt, topo, tradeRates } from '../rules/queries.js';
import { ABILITY_LEVEL } from './constants.js';

/**
 * Cards in hand, in trades and in the bank. In Cities & Knights a hand holds
 * resources and commodities; without the expansion every helper here does
 * exactly what the resource-only code did (commodity keys are invalid).
 */

export function isCommodity(x: unknown): x is Commodity {
  return typeof x === 'string' && (COMMODITIES as readonly string[]).includes(x);
}

/** The kinds of card this game uses. */
export function cardKinds(s: GameState): readonly Card[] {
  return s.ck ? CARDS : RESOURCES;
}

export function isCardOf(s: GameState, x: unknown): x is Card {
  return isResource(x) || (!!s.ck && isCommodity(x));
}

/** Only known card kinds, as non-negative integers (commodities only in Cities & Knights). */
export function validCards(s: GameState, c: unknown): c is CardCounts {
  if (!s.ck) return validCounts(c);
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return false;
  for (const [k, v] of Object.entries(c)) {
    if (!isCardOf(s, k)) return false;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return false;
  }
  return true;
}

export function sameCards(s: GameState, a: CardCounts, b: CardCounts): boolean {
  if (!s.ck) return sameCounts(a, b);
  for (const k of CARDS) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/** A player's whole hand as counts of every card kind. */
export function handOf(s: GameState, p: PlayerId): Record<Card, number> {
  const r = s.players[p].resources;
  const c = s.ck?.players[p].commodities ?? { paper: 0, cloth: 0, coin: 0 };
  return { ...r, ...c };
}

export function bankOf(s: GameState): Record<Card, number> {
  const c = s.ck?.bank ?? { paper: 0, cloth: 0, coin: 0 };
  return { ...s.bank, ...c };
}

export function hasCards(s: GameState, p: PlayerId, need: CardCounts): boolean {
  if (!s.ck) return hasAtLeast(s.players[p].resources, need);
  const have = handOf(s, p);
  for (const k of CARDS) if ((need[k] ?? 0) > have[k]) return false;
  return true;
}

export function bankHas(s: GameState, need: CardCounts): boolean {
  if (!s.ck) return hasAtLeast(s.bank, need);
  const have = bankOf(s);
  for (const k of CARDS) if ((need[k] ?? 0) > have[k]) return false;
  return true;
}

type Pool = PlayerId | 'bank';

function commodityPool(s: GameState, at: Pool): Record<Commodity, number> {
  const ck = s.ck!;
  return at === 'bank' ? ck.bank : ck.players[at].commodities;
}

/** Moves cards between hands and the bank; throws if `from` lacks them (callers check first). */
export function moveCards(s: GameState, from: Pool, to: Pool, c: CardCounts): void {
  const res = (at: Pool) => (at === 'bank' ? s.bank : s.players[at].resources);
  transfer(res(from), res(to), c);
  if (!s.ck) return;
  const a = commodityPool(s, from);
  const b = commodityPool(s, to);
  for (const k of COMMODITIES) {
    const n = c[k] ?? 0;
    if (n === 0) continue;
    if (a[k] < n) throw new Error(`negative ${k}`);
    a[k] -= n;
    b[k] += n;
  }
}

/** Takes one random card (resource or commodity) from `victim` for `thief` (the robber in Cities & Knights). */
export function stealRandomCard(s: GameState, thief: PlayerId, victim: PlayerId): Card | null {
  const hand: Card[] = [];
  const have = handOf(s, victim);
  for (const k of CARDS) for (let i = 0; i < have[k]; i++) hand.push(k);
  if (hand.length === 0) {
    log(s, `${nameOf(s, thief)} robs ${nameOf(s, victim)}, who has no cards`);
    return null;
  }
  const card = hand[nextInt(s.rng, hand.length)];
  moveCards(s, victim, thief, { [card]: 1 });
  log(s, `${nameOf(s, thief)} steals a card from ${nameOf(s, victim)}`);
  log(s, `(the stolen card is ${card})`, [thief, victim]);
  return card;
}

/**
 * Maritime rates per card kind in Cities & Knights (p. 7-8, 12):
 * resources as in the base game (4:1, 3:1 generic harbor, 2:1 matching
 * harbor), plus 2:1 for the merchant's resource; commodities 4:1, 3:1 at a
 * generic harbor and 2:1 with the trade level-3 improvement. The 2:1
 * resource harbors never apply to commodities. Merchant Fleet (phase 2)
 * reads `turnEffects`.
 */
export function cardRates(s: GameState, p: PlayerId): Record<Card, number> {
  const base = tradeRates(s, p);
  const rates: Record<Card, number> = { ...base, paper: 4, cloth: 4, coin: 4 };
  const ck = s.ck;
  if (!ck) return rates;
  const t = topo(s);
  const generic = s.board.harbors.some(
    (h) => h.type === 'generic' && t.edgeVertices[h.edge].some((v) => ownsBuildingAt(s, p, v)),
  );
  for (const k of COMMODITIES) {
    if (generic) rates[k] = Math.min(rates[k], 3);
    if (ck.players[p].improvements.trade >= ABILITY_LEVEL) rates[k] = Math.min(rates[k], 2);
  }
  if (ck.merchant && ck.merchant.owner === p) {
    const r = TERRAIN_RESOURCE[s.board.hexes[ck.merchant.hex]?.terrain];
    if (r) rates[r] = Math.min(rates[r], 2);
  }
  for (const e of ck.turnEffects) {
    if (e.player === p && e.effect === 'merchantFleet' && isCardOf(s, e.data)) rates[e.data] = Math.min(rates[e.data], 2);
  }
  return rates;
}
