import type { Card, CardCounts } from 'engine';
import { CARD_INFO, CARD_LIST } from './names';

/**
 * A trade as one signed number per card (resources, and commodities in
 * Cities & Knights), seen from the player setting it up: +n means "I get n",
 * -n means "I give n", 0 (or missing) means neither.
 */
export type SignedCounts = Partial<Record<Card, number>>;

/** What one box of the row allows. */
export interface BoxRule {
  /** Lowest value: minus the most this player can give. */
  min: number;
  /** Highest value: the most this player can ask for. */
  max: number;
  /** Cards per step below zero: a bank or harbor rate (4, 3 or 2); 1 otherwise. */
  lot?: number;
  /** Fixed by the offer being answered: shown, but it can't be changed. */
  locked?: boolean;
}

/** The cards this player gives (the negative numbers) and gets (the positive ones). */
export function rowSides(row: SignedCounts): { give: CardCounts; get: CardCounts } {
  const give: CardCounts = {};
  const get: CardCounts = {};
  for (const r of CARD_LIST) {
    const v = row[r] ?? 0;
    if (v < 0) give[r] = -v;
    else if (v > 0) get[r] = v;
  }
  return { give, get };
}

/** The row for a trade in which this player gives `give` and gets `get`. */
export function rowOf(give: CardCounts, get: CardCounts): SignedCounts {
  const row: SignedCounts = {};
  for (const r of CARD_LIST) {
    const v = (get[r] ?? 0) - (give[r] ?? 0);
    if (v !== 0) row[r] = v;
  }
  return row;
}

/**
 * The kind of offer a row makes: both sides named ('offer'), only getting
 * (an open offer that leaves what I give to the others: 'give'), only giving
 * (the others say what I get: 'get'), or nothing yet ('empty'). 'give' and
 * 'get' match TradeOffer.open.
 */
export function rowKind(row: SignedCounts): 'offer' | 'give' | 'get' | 'empty' {
  const { give, get } = rowSides(row);
  const gives = Object.keys(give).length > 0;
  const gets = Object.keys(get).length > 0;
  return gives && gets ? 'offer' : gets ? 'give' : gives ? 'get' : 'empty';
}

/** The step one tap of ▲ (+1) or ▼ (-1) makes: a whole lot below zero, one card above. */
export function stepSize(v: number, dir: 1 | -1, rule: BoxRule): number {
  const lot = rule.lot ?? 1;
  return dir > 0 ? (v < 0 ? lot : 1) : v > 0 ? 1 : lot;
}

/** The value after a tap, or null when the tap is not allowed. */
export function stepValue(v: number, dir: 1 | -1, rule: BoxRule): number | null {
  if (rule.locked) return null;
  const next = v + dir * stepSize(v, dir, rule);
  return next < rule.min || next > rule.max ? null : next;
}

/** The row after a tap on one box (the same row when the tap is not allowed). */
export function stepRow(row: SignedCounts, r: Card, dir: 1 | -1, rule: BoxRule): SignedCounts {
  const next = stepValue(row[r] ?? 0, dir, rule);
  if (next === null) return row;
  const out = { ...row };
  if (next === 0) delete out[r];
  else out[r] = next;
  return out;
}

/** How many cards a row moves, both sides counted. */
export function rowCount(row: SignedCounts): number {
  return CARD_LIST.reduce((n, r) => n + Math.abs(row[r] ?? 0), 0);
}

/**
 * The boxes for picking exactly `need` cards, all on one side: discarding
 * (`sign` −1, up to what the player holds in `limit`) or taking (+1, up to
 * what the bank has). Once `need` cards are picked no box goes further, so
 * the row never holds too many.
 */
export function pickRules(row: SignedCounts, need: number, limit: CardCounts, sign: 1 | -1): Record<Card, BoxRule> {
  const full = rowCount(row) >= need;
  const out = {} as Record<Card, BoxRule>;
  for (const r of CARD_LIST) {
    const far = full ? row[r] ?? 0 : sign * (limit[r] ?? 0);
    out[r] = sign < 0 ? { min: Math.min(far, 0), max: 0 } : { min: 0, max: Math.max(far, 0) };
  }
  return out;
}

/**
 * A bank trade: `lots` is how many cards the given cards pay for at the
 * player's rates, `cards` how many are asked for. It is complete when they
 * match (and every given amount is a whole number of lots).
 */
export function bankCheck(row: SignedCounts, rates: Partial<Record<Card, number>>): { lots: number; cards: number; ok: boolean } {
  let lots = 0;
  let cards = 0;
  let whole = true;
  for (const r of CARD_LIST) {
    const v = row[r] ?? 0;
    const rate = rates[r] ?? 4;
    if (v < 0) {
      if (-v % rate !== 0) whole = false;
      lots += Math.floor(-v / rate);
    } else cards += v;
  }
  return { lots, cards, ok: whole && cards > 0 && lots === cards };
}

/** "1 brick", "1 brick and 2 wool", "1 brick, 2 wool and 3 ore". */
export function countsPhrase(c: CardCounts): string {
  const parts = CARD_LIST.filter((r) => (c[r] ?? 0) > 0).map((r) => `${c[r]} ${CARD_INFO[r].label.toLowerCase()}`);
  if (parts.length === 0) return 'nothing';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** A box's number with its sign: "+2", "−1" (a real minus sign) or "0". */
export function signed(v: number): string {
  return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
}
