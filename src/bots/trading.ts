import { TRACK_COMMODITY, TRACKS } from '../ck/constants.js';
import { CARDS, COSTS } from '../core/constants.js';
import type { Action, Card, CardCounts, GameState, PlayerId, TradeOffer } from '../core/types.js';
import { legalCities, legalSettlements } from '../engine/placements.js';
import { handSize, publicVP } from '../rules/queries.js';
import type { Profile } from './heuristicBot.js';
import { countsAt, countsUpTo, emptyHand, handEstimates, nameAt, namesOf, producedShares, type Hand } from './tracker.js';

/**
 * Trading with other players, for the base game and Cities & Knights alike
 * (commodities are cards like any other here). Everything is decided from
 * what the bot's seat can see: its own hand, the card tracker's estimates of
 * the other hands (src/bots/tracker.ts), the board, and the offers made in
 * public.
 *
 * - Value: a card is worth the bot's base want for it, plus a boost for each
 *   goal (what it saves for) while it lacks that card. A trade is worth what
 *   it adds to the hand's value.
 * - Partners: what a trade does for the other side is weighed too, by how
 *   far ahead that player is, and a trade that completes a city or
 *   settlement for the leader (hard: for anyone level or ahead) is refused.
 *   Players behind get a little more.
 * - Answers: accept, or (medium, hard) a counter-offer it would take itself,
 *   built from what the proposer asked for and what the tracker says they
 *   hold; open offers get a concrete counter-offer.
 * - Its own offers aim at a goal: a card for a card to the players likely to
 *   hold the one it needs, two for two toward a build, an open offer, and
 *   (when a card completes a build, or before a 7 can take half a big hand)
 *   two for one. It remembers what was turned down this turn and on its last
 *   turn, and doesn't offer the same again.
 */

export type { Hand } from './tracker.js';

/** A goal: its cards count `boost` more while the bot lacks them. */
export interface TradeGoal {
  cost: CardCounts;
  boost: number;
}

/** What a bot brings to a trade decision. */
export interface TradeView {
  s: GameState;
  p: PlayerId;
  pr: Profile;
  /** The kinds of card in play (resources, and commodities in Cities & Knights). */
  kinds: readonly Card[];
  hand: Hand;
  /** How much it wants one more card of each kind now (goal boosts included). */
  wants: Hand;
  /** The goals the boosts in `wants` come from. */
  goals: TradeGoal[];
  /** Never a trade that gets no build closer and costs cards or sets one back. */
  ok(give: CardCounts, get: CardCounts): boolean;
  /** Bank and harbor rates. */
  rates: Record<Card, number>;
}

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

const cardsOf = (c: CardCounts) => CARDS.reduce((n, k) => n + (c[k] ?? 0), 0);

function hasAll(h: Hand, c: CardCounts): boolean {
  return CARDS.every((k) => (c[k] ?? 0) <= h[k] + 1e-9);
}

function sameCounts(a: CardCounts, b: CardCounts): boolean {
  return CARDS.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

interface Valuer {
  hand: Hand;
  base: Hand;
  goals: TradeGoal[];
}

function kindValue(v: Valuer, k: Card, h: number): number {
  let x = v.base[k] * h;
  for (const g of v.goals) x += g.boost * Math.min(Math.max(0, h), g.cost[k] ?? 0);
  return x;
}

/** What receiving `get` and paying `give` adds to the hand's value. */
function gainFor(v: Valuer, give: CardCounts, get: CardCounts): number {
  let n = 0;
  for (const k of CARDS) {
    const d = (get[k] ?? 0) - (give[k] ?? 0);
    if (d !== 0) n += kindValue(v, k, v.hand[k] + d) - kindValue(v, k, v.hand[k]);
  }
  return n;
}

function valuerOf(v: TradeView): Valuer {
  const base = { ...v.wants };
  for (const k of CARDS) for (const g of v.goals) if ((g.cost[k] ?? 0) > v.hand[k]) base[k] -= g.boost;
  return { hand: v.hand, base, goals: v.goals };
}

/** What a trade is worth to the bot: it pays `give` and receives `get`. */
export function tradeGain(v: TradeView, give: CardCounts, get: CardCounts): number {
  return gainFor(valuerOf(v), give, get);
}

// ---------------------------------------------------------------------------
// The other side
// ---------------------------------------------------------------------------

interface Partner extends Valuer {
  /** Its settlement and city costs, when it has somewhere to build them. */
  vpBuilds: CardCounts[];
}

interface Table {
  est: Hand[];
  partners: Map<PlayerId, Partner>;
  /** Cards each player asked for in public lately (their offers and open offers). */
  asked: Hand[];
}

const tables = new WeakMap<TradeView, Table>();

function table(v: TradeView): Table {
  let t = tables.get(v);
  if (!t) {
    t = { est: handEstimates(v.s, v.p), partners: new Map(), asked: publicAsks(v.s) };
    tables.set(v, t);
  }
  return t;
}

/**
 * How the bot pictures `q`: its likely hand, what it saves for (from the
 * board), what it asked for (`asks`, or its offers lately), and the cards it
 * offered (`offered`: worth less to it, it wants to trade them).
 */
function partnerOf(v: TradeView, q: PlayerId, asks?: CardCounts, offered?: CardCounts): Partner {
  const t = table(v);
  const plain = !asks && !offered;
  const cached = plain ? t.partners.get(q) : undefined;
  if (cached) return cached;
  const s = v.s;
  const est = t.est[q];
  const prod = producedShares(s, q);
  const goals: TradeGoal[] = [];
  const vpBuilds: CardCounts[] = [];
  const pl = s.players[q];
  if (pl.supply.cities > 0 && legalCities(s, q).length > 0) {
    goals.push({ cost: COSTS.city, boost: 1.5 });
    vpBuilds.push(COSTS.city);
  }
  if (pl.supply.settlements > 0) {
    if (legalSettlements(s, q).length > 0) {
      goals.push({ cost: COSTS.settlement, boost: 1.5 });
      vpBuilds.push(COSTS.settlement);
    } else goals.push({ cost: COSTS.road, boost: 0.8 });
  }
  if (!s.ck && s.devDeck.length > 0) goals.push({ cost: COSTS.devCard, boost: 0.4 });
  if (s.ck) {
    // the next level of each track, its commodity
    for (const tr of TRACKS) {
      const level = s.ck.players[q].improvements[tr];
      if (level < 5) goals.push({ cost: { [TRACK_COMMODITY[tr]]: level + 1 }, boost: 0.5 });
    }
  }
  // what it asked for: that many more than it holds
  const wanted = asks ?? t.asked[q];
  if (cardsOf(wanted) > 0) {
    const more: CardCounts = {};
    for (const k of v.kinds) if (wanted[k]) more[k] = Math.ceil(est[k] - 1e-9) + wanted[k]!;
    goals.push({ cost: more, boost: 1.5 });
  }
  const base = emptyHand();
  for (const k of v.kinds) base[k] = 1 + (prod[k] === 0 ? 0.4 : 0) - (est[k] >= 4 ? 0.5 : 0) - ((offered?.[k] ?? 0) > 0 ? 0.8 : 0);
  const out: Partner = { hand: est, base, goals, vpBuilds };
  if (plain) t.partners.set(q, out);
  return out;
}

/** Cards each player asked for in their offers this round (public). */
function publicAsks(s: GameState): Hand[] {
  const out = s.players.map(() => emptyHand());
  const names = namesOf(s);
  const since = s.turn.number - s.players.length + 1;
  for (let i = s.log.length - 1; i >= 0; i--) {
    const e = s.log[i];
    if (e.turn < since) break;
    if (e.visibleTo) continue;
    const o = parseOffer(names, e.msg);
    if (o) for (const k of CARDS) out[o.who][k] = Math.max(out[o.who][k], o.get[k] ?? 0);
  }
  for (const t of s.turn.trades) for (const k of CARDS) out[t.from][k] = Math.max(out[t.from][k], t.get[k] ?? 0);
  return out;
}

/** How far ahead of the bot `q` is, as a weight (the leader most; players behind little). */
function threat(v: TradeView, q: PlayerId): number {
  const s = v.s;
  const mine = publicVP(s, v.p);
  const theirs = publicVP(s, q);
  let w = 1 + (theirs - mine) * 0.35 + (theirs / Math.max(1, s.victoryTarget)) * 0.6;
  if (s.players.every((o) => o.id === q || publicVP(s, o.id) < theirs)) w += 0.3;
  return Math.min(3, Math.max(0.25, w));
}

/** `q`'s part of the bot's opponents, by threat (1 / (players - 1) when all are level). */
function threatShare(v: TradeView, q: PlayerId): number {
  let all = 0;
  for (const o of v.s.players) if (o.id !== v.p) all += threat(v, o.id);
  return all > 0 ? threat(v, q) / all : 0;
}

/** Shortfall of an (estimated) hand for a cost. */
function short(h: Hand, cost: CardCounts): number {
  let n = 0;
  for (const k of CARDS) n += Math.max(0, (cost[k] ?? 0) - h[k]);
  return n;
}

/** Would `q` receiving `receive` and paying `pay` (likely) complete a settlement or city it could not build before? */
export function completesBuild(v: TradeView, q: PlayerId, receive: CardCounts, pay: CardCounts): boolean {
  const m = partnerOf(v, q);
  const after = { ...m.hand };
  for (const k of CARDS) after[k] = Math.max(0, after[k] + (receive[k] ?? 0) - (pay[k] ?? 0));
  return m.vpBuilds.some((c) => {
    const before = short(m.hand, c);
    const now = short(after, c);
    return now <= 0.5 && before - now >= 0.5;
  });
}

/** Won't trade with someone this close to winning (VP short of the target). */
function nearWin(v: TradeView, q: PlayerId): boolean {
  return v.pr.leaderGuard >= 0 && publicVP(v.s, q) >= v.s.victoryTarget - v.pr.leaderGuard;
}

/** The trade gives `q` a settlement or city it shouldn't have: its win, or (by level) the leader's or a rival's build. */
function blocked(v: TradeView, q: PlayerId, receive: CardCounts, pay: CardCounts): boolean {
  if (nearWin(v, q)) return true;
  if (!completesBuild(v, q, receive, pay)) return false;
  const s = v.s;
  const theirs = publicVP(s, q);
  const mine = publicVP(s, v.p);
  if (theirs + 1 >= s.victoryTarget) return true;
  switch (v.pr.trade.guard) {
    case 'win':
      return false;
    case 'leader':
      return theirs > mine || theirs + 1 >= s.victoryTarget - 2;
    case 'rivals':
      return theirs >= mine || theirs + 1 >= s.victoryTarget - 3;
  }
}

/** What a trade is worth to `q` (it receives `receive`, pays `pay`), by its estimated hand and what it saves for. */
function partnerGain(v: TradeView, q: PlayerId, receive: CardCounts, pay: CardCounts, asks?: CardCounts, offered?: CardCounts): number {
  return gainFor(partnerOf(v, q, asks, offered), pay, receive);
}

/** How likely `q` holds the cards of `c`, 0..1 (the least likely kind counts). */
function holds(v: TradeView, q: PlayerId, c: CardCounts): number {
  const est = table(v).est[q];
  let p = 1;
  for (const k of CARDS) {
    const n = c[k] ?? 0;
    if (n > 0) p = Math.min(p, est[k] >= n ? 1 : Math.max(0, est[k] - (n - 1)));
  }
  return p;
}

/**
 * How likely `q` says yes to receiving `receive` for `pay`: by what it gains
 * as the bot pictures it, less for every card it pays beyond what it gets
 * (people rarely take two for one). `asks` and `offered`: what it asked
 * for and offered, if it did.
 */
function acceptance(v: TradeView, q: PlayerId, receive: CardCounts, pay: CardCounts, asks?: CardCounts, offered?: CardCounts): number {
  const g = partnerGain(v, q, receive, pay, asks, offered);
  let p = 1 / (1 + Math.exp(-2 * (g - 0.5)));
  const extra = cardsOf(pay) - cardsOf(receive);
  if (extra > 0) p *= 0.55 ** extra;
  return p;
}

/**
 * The bot's verdict on a trade with `q` in which it pays `give` and receives
 * `get`: worth taking (and how much), or not. Everything a level weighs:
 * its own gain, the bar, the partner's gain and standing.
 */
export function judge(v: TradeView, q: PlayerId, give: CardCounts, get: CardCounts): { ok: boolean; score: number } {
  const no = { ok: false, score: -Infinity };
  if (!hasAll(v.hand, give) || !v.ok(give, get) || blocked(v, q, give, get)) return no;
  const mine = tradeGain(v, give, get);
  const theirs = partnerGain(v, q, give, get);
  let score = mine - v.pr.trade.partner * Math.max(0, theirs) * threatShare(v, q);
  if (publicVP(v.s, q) <= publicVP(v.s, v.p) - 2) score += v.pr.trade.generous;
  return { ok: score > v.pr.acceptGain, score };
}

// ---------------------------------------------------------------------------
// Offers in the log: what was asked for, and what the bot already tried
// ---------------------------------------------------------------------------

interface Said {
  who: PlayerId;
  give: CardCounts;
  get: CardCounts;
  open?: 'give' | 'get';
}

/** An offer as the engine logs it, or null. */
function parseOffer(names: ReturnType<typeof namesOf>, msg: string): Said | null {
  const w = nameAt(names, msg, 0);
  if (!w) return null;
  const [who, end] = w;
  if (msg.startsWith(' asks for ', end)) {
    const get = countsUpTo(msg, end + 10, [': what will you give?']);
    return get ? { who, give: {}, get, open: 'give' } : null;
  }
  if (!msg.startsWith(' offers ', end)) return null;
  const give = countsAt(msg, end + 8);
  if (!give) return null;
  const rest = msg.slice(give.end);
  if (rest === ': what will you give for it?') return { who, give: give.counts, get: {}, open: 'get' };
  if (!rest.startsWith(' for ')) return null;
  const get = countsUpTo(msg, give.end + 5);
  return get ? { who, give: give.counts, get } : null;
}

/** An offer the bot made: what it was and whether a trade came of it. */
export interface PastOffer {
  give: CardCounts;
  get: CardCounts;
  open?: 'give' | 'get';
  traded: boolean;
}

/**
 * The bot's own offers this turn (counter-offers on others' turns included)
 * and on its last turn, from the public log; an offer counts as traded when a
 * trade of the bot's followed before its next offer.
 */
export function pastOffers(s: GameState, p: PlayerId): { now: PastOffer[]; last: PastOffer[] } {
  const names = namesOf(s);
  const log = s.log;
  const header = `: ${s.players[p].name} ---`;
  // where this turn starts, and where the bot's last turn of its own started and ended
  let i = log.length;
  while (i > 0 && log[i - 1].turn === s.turn.number) i--;
  const nowFrom = i;
  let lastFrom = -1;
  let lastTo = -1;
  for (let j = nowFrom - 1; j >= 0 && log[j].turn >= s.turn.number - s.players.length - 1; j--) {
    const e = log[j];
    if (e.msg.startsWith('--- Turn ') && e.msg.endsWith(header)) {
      lastFrom = j;
      lastTo = j + 1;
      while (lastTo < log.length && log[lastTo].turn === e.turn) lastTo++;
      break;
    }
  }
  const collect = (from: number, to: number): PastOffer[] => {
    const out: PastOffer[] = [];
    for (let k = from; k < to; k++) {
      const e = log[k];
      if (e.visibleTo) continue;
      const o = parseOffer(names, e.msg);
      if (o) {
        if (o.who === p) out.push({ give: o.give, get: o.get, open: o.open, traded: false });
        continue;
      }
      if (out.length === 0) continue;
      const w = nameAt(names, e.msg, 0);
      if (!w || !e.msg.startsWith(' trades ', w[1]) || e.msg.includes(' with the bank for ')) continue;
      const to2 = e.msg.indexOf(' to ', w[1]);
      if (w[0] === p || (to2 >= 0 && nameAt(names, e.msg, to2 + 4)?.[0] === p)) out[out.length - 1].traded = true;
    }
    return out;
  };
  return { now: collect(nowFrom, log.length), last: lastFrom >= 0 ? collect(lastFrom, lastTo) : [] };
}

/** The offer (as the bot would make it) was already made this turn, or turned down on its last turn. */
function tried(past: { now: PastOffer[]; last: PastOffer[] }, give: CardCounts, get: CardCounts, open?: 'give' | 'get'): boolean {
  const same = (o: PastOffer) => (o.open ?? null) === (open ?? null) && sameCounts(o.give, give) && sameCounts(o.get, get);
  return past.now.some(same) || past.last.some((o) => !o.traded && same(o));
}

// ---------------------------------------------------------------------------
// Answering offers
// ---------------------------------------------------------------------------

/** All ways of picking `n` cards of the given kinds, at most `cap[k]` of each. */
function picks(kinds: readonly Card[], n: number, cap: (k: Card) => number): CardCounts[] {
  const out: CardCounts[] = [];
  const rec = (i: number, left: number, acc: CardCounts) => {
    if (left === 0) {
      out.push({ ...acc });
      return;
    }
    if (i >= kinds.length) return;
    const k = kinds[i];
    for (let m = Math.min(left, Math.floor(cap(k))); m >= 0; m--) {
      if (m > 0) acc[k] = m;
      else delete acc[k];
      rec(i + 1, left - m, acc);
    }
    delete acc[k];
  };
  rec(0, n, {});
  return out;
}

function offerAction(p: PlayerId, give: CardCounts, get: CardCounts, to: PlayerId[], extra: Partial<Extract<Action, { type: 'proposeTrade' }>> = {}): Action {
  return { type: 'proposeTrade', player: p, give: { ...give }, get: { ...get }, to, ...extra };
}

/**
 * A counter-offer to `t` (from the player whose turn it is): one the bot
 * would take itself, that keeps what the proposer asked for where it can,
 * and asks for cards the proposer likely holds. Null when there is none.
 */
export function counterOffer(v: TradeView, t: TradeOffer): Action | null {
  const { s, p, pr } = v;
  const q = t.from;
  if (nearWin(v, q)) return null;
  const past = pastOffers(s, p);
  const kinds = v.kinds;
  const asks = t.open === 'get' ? undefined : t.get;
  type Option = { give: CardCounts; get: CardCounts };
  const options: Option[] = [];
  const extra = pr.counterExtra;
  // (only cards they may well hold are worth asking for: what they offered, or what the tracker expects at least half a card of)
  const est = table(v).est[q];
  const askable = (k: Card) => (t.give[k] ?? 0) > 0 || est[k] >= 0.5;
  if (t.open === 'give') {
    // "who gives me W?": give exactly W, ask for something in return
    const n = cardsOf(t.get);
    if (!hasAll(v.hand, t.get)) return null;
    for (let m = Math.max(1, n - 1); m <= n + 1 + extra; m++) {
      for (const get of picks(kinds.filter((k) => !(t.get[k] ?? 0) && askable(k)), m, (k) => Math.min(m, 3))) options.push({ give: t.get, get });
    }
  } else if (t.open === 'get') {
    // "what will you give for G?": pay with cards it can spare
    const n = cardsOf(t.give);
    for (let m = Math.max(1, n - 1); m <= n; m++) {
      for (const give of picks(kinds.filter((k) => !(t.give[k] ?? 0)), m, (k) => v.hand[k])) options.push({ give, get: t.give });
    }
  } else {
    if (!pr.trade.counters) return null;
    const n = cardsOf(t.get);
    const m = cardsOf(t.give);
    // the cards they want, for something else
    if (hasAll(v.hand, t.get)) {
      for (let k = Math.max(1, m - 1); k <= m + extra; k++) {
        for (const get of picks(kinds.filter((x) => !(t.get[x] ?? 0) && askable(x)), k, () => 3)) options.push({ give: t.get, get });
      }
    }
    // fewer of the cards they want for what they offer
    if (n >= 2) for (const give of picks(kinds, n - 1, (x) => Math.min(t.get[x] ?? 0, v.hand[x]))) options.push({ give, get: t.give });
    // other cards for what they offer
    for (const give of picks(kinds.filter((x) => !(t.give[x] ?? 0)), n, (x) => v.hand[x])) options.push({ give, get: t.give });
  }
  let top: Option | null = null;
  let topScore = -Infinity;
  for (const o of options) {
    if (cardsOf(o.give) === 0 || cardsOf(o.get) === 0) continue;
    if (kinds.some((k) => (o.give[k] ?? 0) > 0 && (o.get[k] ?? 0) > 0)) continue;
    // (the offer as it stands is answered with yes or no, not with itself)
    if (!t.open && sameCounts(o.give, t.get) && sameCounts(o.get, t.give)) continue;
    if (tried(past, o.give, o.get)) continue;
    // (what they offered they hold: the engine checked)
    const likely = CARDS.every((k) => (o.get[k] ?? 0) <= (t.give[k] ?? 0)) ? 1 : holds(v, q, o.get);
    if (likely < 0.5) continue;
    const j = judge(v, q, o.give, o.get);
    if (!j.ok || j.score <= pr.counterGain) continue;
    // what it can expect: its gain if they say yes, times how likely they are to (the cards they asked for count most)
    const yes = acceptance(v, q, o.give, o.get, asks, t.give) * likely;
    // (a counter-offer they would likely turn down is no answer)
    if (yes < 0.35) continue;
    const score = j.score * yes - cardsOf(o.give) * 0.01;
    if (score > topScore) {
      topScore = score;
      top = o;
    }
  }
  if (!top) return null;
  return offerAction(p, top.give, top.get, [q], { replyTo: t.id });
}

/**
 * The bot's answer to an offer made to it on another player's turn: take it,
 * counter it (open offers always, others at medium and hard), or decline.
 */
export function answerOffer(v: TradeView, t: TradeOffer, acts: Action[]): Action | null {
  const accept = acts.find((a) => a.type === 'acceptTrade' && a.tradeId === t.id);
  const reject = acts.find((a) => a.type === 'rejectTrade' && a.tradeId === t.id) ?? null;
  if (!t.open && accept && judge(v, t.from, t.get, t.give).ok) return accept;
  const counter = counterOffer(v, t);
  return counter ?? reject;
}

// ---------------------------------------------------------------------------
// The bot's own offers, on its turn
// ---------------------------------------------------------------------------

/**
 * The active bot's trade business: confirm an offer someone took, wait for
 * answers, take the best counter-offer worth taking, turn down the others,
 * withdraw what nobody wanted. `null`: wait; `undefined`: nothing to do.
 */
export function settleTrades(v: TradeView, acts: Action[]): Action | null | undefined {
  const { s, p } = v;
  const own = s.turn.trades.filter((t) => t.from === p);
  for (const t of own) {
    if (t.accepted.length > 0) {
      const ok = t.accepted.filter((q) => !blocked(v, q, t.give, t.get));
      const partner = (ok.length > 0 ? ok : t.accepted).reduce((a, b) => (threat(v, b) < threat(v, a) ? b : a));
      return { type: 'confirmTrade', player: p, tradeId: t.id, partner };
    }
  }
  if (own.some((t) => t.to.some((q) => !t.rejected.includes(q)))) return null;
  const counters = s.turn.trades.filter((t) => t.from !== p && t.to.includes(p));
  let top: { t: TradeOffer; score: number } | null = null;
  for (const t of counters) {
    if (!acts.some((a) => a.type === 'acceptTrade' && a.tradeId === t.id)) continue;
    const j = judge(v, t.from, t.get, t.give);
    if (j.ok && (!top || j.score > top.score)) top = { t, score: j.score };
  }
  if (top) return { type: 'acceptTrade', player: p, tradeId: top.t.id };
  if (counters.length > 0) return { type: 'rejectTrade', player: p, tradeId: counters[0].id };
  if (own.length > 0) return { type: 'cancelTrade', player: p, tradeId: own[0].id };
  return undefined;
}

/** What an own offer aims at: the cost of the build it saves for, and whether the card is badly needed. */
export interface OfferGoal {
  cost: CardCounts;
  /** Cards it keeps back (the goal's and any other it protects). */
  keep: CardCounts;
  /** A settlement or city this turn hinges on it (or, at hard, a big hand before a 7). */
  urgent: boolean;
}

/**
 * An offer to the other players toward `goal`, or null: by level, what was
 * already tried, and who likely holds the cards.
 *
 * - easy: now and then one spare card for the one card a settlement or city
 *   lacks, to everyone;
 * - medium, hard: a card for a card (two for two when two are missing) to
 *   the players likely to hold it, then an open offer ("who gives me ore?"),
 *   then (urgent) two for one; never the same offer twice in a turn, nor one
 *   turned down on its last turn.
 */
export function ownOffer(v: TradeView, goal: OfferGoal): Action | null {
  const { s, p, pr } = v;
  const made = s.turn.offers ?? 0;
  if (made >= pr.offersPerTurn || s.turn.role !== 'active' || s.phase.kind !== 'main' || s.turn.actor !== p) return null;
  if (s.options.tradeBuildMode === 'separate' && s.turn.buildingStarted) return null;
  if (s.turn.trades.some((t) => t.from === p)) return null;
  const kinds = v.kinds;
  const need: CardCounts = {};
  for (const k of kinds) {
    const m = (goal.cost[k] ?? 0) - v.hand[k];
    if (m > 0) need[k] = m;
  }
  const missing = cardsOf(need);
  const simple = pr.trade.offers === 'simple';
  if (missing === 0 || missing > (simple ? 1 : 3)) return null;
  const spare = (k: Card) => v.hand[k] - Math.max(goal.cost[k] ?? 0, goal.keep[k] ?? 0);
  const spares = kinds.filter((k) => !(need[k] ?? 0) && spare(k) >= 1);
  if (spares.length === 0) return null;
  const others = s.players.map((x) => x.id).filter((q) => q !== p && handSize(s, q) > 0 && !nearWin(v, q));
  if (others.length === 0) return null;
  const past = pastOffers(s, p);
  const wanted = kinds.filter((k) => (need[k] ?? 0) > 0);
  type Cand = { give: CardCounts; get: CardCounts; open?: 'give'; to: PlayerId[]; rank: number; score: number };
  const cands: Cand[] = [];
  // players who will likely say yes: they hold the cards, and the trade gives them nothing they shouldn't have
  const audience = (give: CardCounts, get: CardCounts, bar: number) =>
    others.filter((q) => holds(v, q, get) >= bar && !blocked(v, q, give, get));
  const refusedFor = (k: Card) => past.now.some((o) => !o.traded && (o.get[k] ?? 0) > 0);
  // its spare cards, the ones it minds least first
  const cheapest = [...spares].sort((a, b) => v.wants[a] - v.wants[b] || spare(b) - spare(a));
  const consider = (give: CardCounts, get: CardCounts, rank: number, open?: 'give') => {
    if (tried(past, open ? {} : give, get, open)) return;
    if (!open && !v.ok(give, get)) return;
    const gain = open ? tradeGain(v, { [cheapest[0]]: cardsOf(get) }, get) : tradeGain(v, give, get);
    if (gain <= 0) return;
    const to = open ? others.filter((q) => holds(v, q, get) >= 0.3) : simple ? others.filter((q) => !blocked(v, q, give, get)) : audience(give, get, 0.5);
    if (to.length === 0) return;
    // the chance someone says yes (an offer few would take isn't worth a round of asking)
    let no = 1;
    for (const q of to) no *= 1 - (open ? 0.5 * holds(v, q, get) : acceptance(v, q, give, get) * holds(v, q, get));
    if (1 - no < pr.trade.chance) return;
    cands.push({ give: open ? {} : give, get, open, to, rank, score: gain * (1 - no) });
  };
  for (const w of wanted) {
    const get = { [w]: 1 };
    // a card for a card (after one was turned down for this card, an open offer and two for one come first)
    for (const g of cheapest) consider({ [g]: 1 }, get, refusedFor(w) ? 3 : 0);
    if (simple) continue;
    // "who gives me W?": the others pick what they want for it
    if (spares.length >= 2 || spare(cheapest[0]) >= 2) consider({}, get, 1, 'give');
    // two for one when it matters now (and the harbors don't do as well)
    if (pr.trade.sweeten && goal.urgent && cheapest.every((k) => v.rates[k] >= 3)) {
      const two = picks(cheapest, 2, (k) => spare(k)).sort((a, b) => tradeGain(v, b, get) - tradeGain(v, a, get))[0];
      if (two) consider(two, get, 2);
    }
  }
  if (!simple && missing >= 2 && wanted.length >= 1) {
    // two for two toward the build
    const get: CardCounts = {};
    let n = 0;
    for (const k of wanted) {
      const m = Math.min(need[k]!, 2 - n);
      if (m > 0) get[k] = m;
      n += m;
      if (n >= 2) break;
    }
    if (n === 2) {
      const give = picks(cheapest, 2, (k) => spare(k)).sort((a, b) => tradeGain(v, b, get) - tradeGain(v, a, get))[0];
      if (give) consider(give, get, 0);
    }
  }
  // (a third offer in a turn only to sweeten one that matters now: two cards for one)
  const left = made >= 2 ? cands.filter((c) => c.rank === 2) : cands;
  if (left.length === 0) return null;
  left.sort((a, b) => a.rank - b.rank || b.score - a.score);
  const c = left[0];
  return offerAction(p, c.give, c.get, c.to, c.open ? { open: true } : {});
}

