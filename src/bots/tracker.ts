import { commodityCount } from '../ck/basics.js';
import { CK_COSTS, TERRAIN_COMMODITY, TRACK_COMMODITY, commodityBank } from '../ck/constants.js';
import { CARDS, COMMODITIES, COSTS, RESOURCES, TERRAIN_RESOURCE, pips } from '../core/constants.js';
import type { Card, CardCounts, GameState, ImprovementTrack, LogEntry, PlayerId } from '../core/types.js';
import { handSize, topo } from '../rules/queries.js';
import { scenarioOf } from '../scenarios/registry.js';
import { WONDERS } from '../scenarios/seafarers/wonders.js';

/**
 * What one seat can know about the other hands: a card tracker built only
 * from what a player in that seat has seen.
 *
 * - The game log as that seat sees it (private lines only when they are
 *   addressed to it): production, starting cards, gold and discoveries,
 *   trades with players and the bank, discards, builds and purchases (their
 *   costs), Monopoly and Year of Plenty, and the Cities & Knights cards that
 *   move cards. A card stolen in front of the seat is known; one stolen
 *   between two others is a card of unknown kind.
 * - The public counts: every hand's size (and, in Cities & Knights, how many
 *   of its cards are commodities) and the bank's piles. The supply is fixed,
 *   so the bank says how many of each card the others hold between them.
 *
 * It never looks at another player's hand, a development card, the deck or
 * the random number generator. Hands are tracked as cards of known kind plus
 * cards of unknown kind; an estimate spreads the unknown cards by what each
 * player produces, then fits the whole to the hand sizes and to the bank.
 *
 * The log is only ever appended to, and its entries are shared between
 * successive states (cloneState copies the array, not the entries), so the
 * tracker is kept per entry and only new entries are read on each call.
 */

export type Hand = Record<Card, number>;

export function emptyHand(): Hand {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, paper: 0, cloth: 0, coin: 0 };
}

/** One player's cards as a seat has followed them. */
interface Tally {
  /** Cards of known kind (fractions after a card of unknown kind left the hand). */
  known: Hand;
  /** Cards of unknown kind: resources and commodities. */
  unR: number;
  unC: number;
  /** A Crane was played: the next improvement costs a commodity less. */
  crane: boolean;
}

function freshTally(): Tally {
  return { known: emptyHand(), unR: 0, unC: 0, crane: false };
}

function cloneTallies(ts: Tally[]): Tally[] {
  return ts.map((t) => ({ known: { ...t.known }, unR: t.unR, unC: t.unC, crane: t.crane }));
}

const isCom = (k: Card) => (COMMODITIES as readonly string[]).includes(k);

function gain(t: Tally, k: Card, n: number): void {
  t.known[k] += n;
}

function gainAll(t: Tally, c: CardCounts): void {
  for (const k of CARDS) if (c[k]) gain(t, k, c[k]!);
}

/** Specific cards leave the hand: from the known ones first, then from the unknown ones. */
function pay(t: Tally, k: Card, n: number): void {
  const known = Math.min(t.known[k], n);
  t.known[k] -= known;
  const rest = n - known;
  if (rest <= 0) return;
  if (isCom(k)) t.unC = Math.max(0, t.unC - rest);
  else t.unR = Math.max(0, t.unR - rest);
}

function payAll(t: Tally, c: CardCounts): void {
  for (const k of CARDS) if (c[k]) pay(t, k, c[k]!);
}

function size(t: Tally): number {
  let n = t.unR + t.unC;
  for (const k of CARDS) n += t.known[k];
  return n;
}

/** `n` cards of unknown kind leave the hand: each kind loses its share. Returns how many were resources. */
function loseUnknown(t: Tally, n: number): number {
  const all = size(t);
  if (all <= 0) return n;
  const f = Math.min(1, n / all);
  let res = t.unR * f;
  for (const k of CARDS) {
    const x = t.known[k] * f;
    if (!isCom(k)) res += x;
    t.known[k] -= x;
  }
  t.unR -= t.unR * f;
  t.unC -= t.unC * f;
  return res;
}

/** `n` cards of unknown kind change hands, `res` of them resources. */
function moveUnknown(from: Tally, to: Tally, n: number): void {
  const res = loseUnknown(from, n);
  to.unR += res;
  to.unC += n - res;
}

// ---------------------------------------------------------------------------
// Reading the log
// ---------------------------------------------------------------------------

/** Player names, longest first; a name two players share is ambiguous (-1). */
export type Names = Array<[string, PlayerId]>;

const namesCache = new WeakMap<GameState['players'], Names>();

export function namesOf(s: GameState): Names {
  let n = namesCache.get(s.players);
  if (n) return n;
  const count = new Map<string, number>();
  for (const pl of s.players) count.set(pl.name, (count.get(pl.name) ?? 0) + 1);
  n = s.players.map((pl): [string, PlayerId] => [pl.name, count.get(pl.name)! > 1 ? -1 : pl.id]).sort((a, b) => b[0].length - a[0].length);
  namesCache.set(s.players, n);
  return n;
}

/** The player whose name starts `msg` at `at`, and where the name ends. */
export function nameAt(names: Names, msg: string, at: number): [PlayerId, number] | null {
  for (const [name, id] of names) {
    if (name.length === 0 || !msg.startsWith(name, at)) continue;
    const next = msg.charAt(at + name.length);
    if (next !== '' && next !== ' ' && next !== "'" && next !== ',' && next !== ')') continue;
    return id < 0 ? null : [id, at + name.length];
  }
  return null;
}

const KIND = /^(\d+) (brick|lumber|wool|grain|ore|paper|cloth|coin)\b/;

/** Cards as the engine writes them ("1 brick, 2 wool"), from `at`; null if there are none. */
export function countsAt(msg: string, at: number): { counts: CardCounts; end: number } | null {
  const counts: CardCounts = {};
  let i = at;
  let any = false;
  for (;;) {
    const m = KIND.exec(msg.slice(i));
    if (!m) break;
    const k = m[2] as Card;
    counts[k] = (counts[k] ?? 0) + Number(m[1]);
    any = true;
    i += m[0].length;
    if (msg.startsWith(', ', i) && KIND.test(msg.slice(i + 2))) i += 2;
    else break;
  }
  return any ? { counts, end: i } : null;
}

/** The whole rest of the message is cards, maybe followed by one of `suffixes`. */
export function countsUpTo(msg: string, at: number, suffixes: string[] = ['']): CardCounts | null {
  const c = countsAt(msg, at);
  if (!c) return null;
  const rest = msg.slice(c.end);
  return suffixes.includes(rest) ? c.counts : null;
}

const BUILD_COSTS: Array<[string, CardCounts]> = [
  [' builds a road', COSTS.road],
  [' builds a ship', COSTS.ship],
  [' builds a settlement', COSTS.settlement],
  [' upgrades to a city', COSTS.city],
  [' upgrades to a city for 2 ore and 1 grain', { ore: 2, grain: 1 }],
  [' buys a development card', COSTS.devCard],
  [' hires a basic knight', CK_COSTS.knight],
  [' builds a city wall', CK_COSTS.cityWall],
];

interface Reader {
  s: GameState;
  me: PlayerId;
  names: Names;
  log: LogEntry[];
}

const visible = (e: LogEntry | undefined, me: PlayerId) => !!e && (!e.visibleTo || e.visibleTo.includes(me));

/** The private line right after entry `i`, if this seat may see it. */
function aside(r: Reader, i: number): string | null {
  const e = r.log[i + 1];
  return e?.visibleTo && e.visibleTo.includes(r.me) ? e.msg : null;
}

/** Reads entry `i` into the tallies. */
function read(r: Reader, ts: Tally[], i: number): void {
  const e = r.log[i];
  if (!visible(e, r.me)) return;
  const msg = e.msg;
  if (msg.startsWith('The pirate fleet (')) {
    // Pirate Islands: "The pirate fleet (…) raids X, who loses N card(s)"
    const at = msg.indexOf(' raids ');
    if (at < 0) return;
    const who = nameAt(r.names, msg, at + 7);
    const m = who && /^, who loses (\d+) card/.exec(msg.slice(who[1]));
    if (who && m) loseUnknown(ts[who[0]], Number(m[1]));
    return;
  }
  const who = nameAt(r.names, msg, 0);
  if (!who) return;
  const [p, end] = who;
  const t = ts[p];
  const rest = msg.slice(end);
  const after = (prefix: string) => (rest.startsWith(prefix) ? end + prefix.length : -1);
  let at: number;

  if ((at = after(' receives ')) >= 0) {
    const c = countsUpTo(msg, at);
    // (Cloth for Catan's cloth is a token, not a card; it only counts as a card in Cities & Knights)
    if (c && (r.s.ck || !c.cloth)) gainAll(t, c);
    return;
  }
  if ((at = after(' takes ')) >= 0) {
    const mm = /^(\d+) cards? from /.exec(msg.slice(at));
    if (mm) {
      // Master Merchant: cards taken from another hand (which ones only the two of them see)
      const q = nameAt(r.names, msg, at + mm[0].length);
      if (!q) return;
      const seen = aside(r, i);
      const c = seen ? countsUpTo(seen, 1, [')']) : null;
      if (c) {
        payAll(ts[q[0]], c);
        gainAll(t, c);
      } else moveUnknown(ts[q[0]], t, Number(mm[1]));
      return;
    }
    const c = countsUpTo(msg, at, ['', ' (gold)', ' for the discovery', ' (Aqueduct)']);
    if (c) gainAll(t, c);
    return;
  }
  if ((at = after(' plays Year of Plenty and takes ')) >= 0) {
    const c = countsUpTo(msg, at);
    if (c) gainAll(t, c);
    return;
  }
  if ((at = after(' plays Monopoly on ')) >= 0) {
    const m = /^(brick|lumber|wool|grain|ore) and collects (\d+)$/.exec(msg.slice(at));
    if (!m) return;
    const k = m[1] as Card;
    for (const o of ts) if (o !== t) o.known[k] = 0;
    gain(t, k, Number(m[2]));
    return;
  }
  if ((at = after(' trades ')) >= 0) {
    if (msg.startsWith('a resource to ', at)) {
      // Commercial Harbor: a resource for a commodity (which ones only the two of them see)
      const q = nameAt(r.names, msg, at + 14);
      if (!q) return;
      const seen = aside(r, i);
      const m = seen ? /gave 1 (\w+) for 1 (\w+)\)$/.exec(seen) : null;
      if (m) {
        pay(t, m[1] as Card, 1);
        gain(ts[q[0]], m[1] as Card, 1);
        pay(ts[q[0]], m[2] as Card, 1);
        gain(t, m[2] as Card, 1);
      } else {
        // a resource one way, a commodity the other
        t.unR = Math.max(0, t.unR - 1);
        ts[q[0]].unR += 1;
        ts[q[0]].unC = Math.max(0, ts[q[0]].unC - 1);
        t.unC += 1;
      }
      return;
    }
    const give = countsAt(msg, at);
    if (!give) return;
    const tail = msg.slice(give.end);
    if (tail.startsWith(' with the bank for ')) {
      const get = countsUpTo(msg, give.end + 19);
      if (!get) return;
      payAll(t, give.counts);
      gainAll(t, get);
      return;
    }
    if (!tail.startsWith(' to ')) return;
    const q = nameAt(r.names, msg, give.end + 4);
    if (!q || !msg.startsWith(' for ', q[1])) return;
    const get = countsUpTo(msg, q[1] + 5);
    if (!get) return;
    payAll(t, give.counts);
    gainAll(t, get);
    payAll(ts[q[0]], get);
    gainAll(ts[q[0]], give.counts);
    return;
  }
  if ((at = after(' offers ')) >= 0) {
    // an offer shows the cards it gives are in the hand (the engine checks): unknown cards become known ones
    const c = countsAt(msg, at);
    if (!c) return;
    for (const k of CARDS) {
      const lack = (c.counts[k] ?? 0) - t.known[k];
      if (lack <= 0) continue;
      const fam = isCom(k) ? 'unC' : 'unR';
      const n = Math.min(lack, t[fam]);
      t[fam] -= n;
      t.known[k] += n;
    }
    return;
  }
  if ((at = after(' discards ')) >= 0) {
    const c = countsUpTo(msg, at);
    if (c) payAll(t, c);
    return;
  }
  if ((at = after(' steals a card from ')) >= 0) {
    const q = nameAt(r.names, msg, at);
    if (!q || q[1] !== msg.length) return;
    const seen = aside(r, i);
    const m = seen ? /^\(the stolen card is (\w+)\)$/.exec(seen) : null;
    if (m) {
      pay(ts[q[0]], m[1] as Card, 1);
      gain(t, m[1] as Card, 1);
    } else moveUnknown(ts[q[0]], t, 1);
    return;
  }
  if ((at = after(' gives ')) >= 0) {
    const q = nameAt(r.names, msg, at);
    if (!q) return;
    const tail = msg.slice(q[1]);
    // Resource or Trade Monopoly: "X gives Y 2 wool"
    const mono = /^ (\d+) (brick|lumber|wool|grain|ore|paper|cloth|coin)$/.exec(tail);
    if (mono) {
      pay(t, mono[2] as Card, Number(mono[1]));
      gain(ts[q[0]], mono[2] as Card, Number(mono[1]));
      return;
    }
    // the Wedding: "X gives Y 2 cards" (which ones only the two of them see)
    const gift = /^ (\d+) cards?$/.exec(tail);
    if (!gift) return;
    const seen = aside(r, i);
    const c = seen ? countsUpTo(seen, 1, [')']) : null;
    if (c) {
      payAll(t, c);
      gainAll(ts[q[0]], c);
    } else moveUnknown(t, ts[q[0]], Number(gift[1]));
    return;
  }
  if (rest === "'s next city improvement this turn costs one commodity less") {
    t.crane = true;
    return;
  }
  if ((at = after(' builds the ')) >= 0) {
    // a city improvement: "(science level 3)" costs 3 paper (one less after a Crane)
    const m = /\((trade|politics|science) level (\d)\)$/.exec(msg);
    if (!m) return;
    const n = Math.max(0, Number(m[2]) - (t.crane ? 1 : 0));
    t.crane = false;
    pay(t, TRACK_COMMODITY[m[1] as ImprovementTrack], n);
    return;
  }
  if ((at = after(' builds level ')) >= 0) {
    // The Wonders: a level of the player's wonder
    const w = WONDERS.find((x) => msg.endsWith(` of the ${x.name}`));
    if (w) payAll(t, w.cost);
    return;
  }
  if (rest.startsWith(' activates a ')) {
    pay(t, 'grain', 1);
    return;
  }
  if (rest.startsWith(' promotes a knight to a ') && !rest.endsWith(' for free')) {
    payAll(t, CK_COSTS.promote);
    return;
  }
  for (const [text, cost] of BUILD_COSTS) {
    if (rest === text) {
      payAll(t, cost);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Following a game: kept per log entry, read incrementally
// ---------------------------------------------------------------------------

/** The tallies as a seat had them right after an entry. */
const kept = new WeakMap<LogEntry, Map<PlayerId, Tally[]>>();

/** Every few entries the tallies are kept, so a game read from scratch has places to resume from. */
const KEEP_EVERY = 32;

function tallies(s: GameState, me: PlayerId): Tally[] {
  const log = s.log;
  let start = 0;
  let ts: Tally[] | null = null;
  for (let i = log.length - 1; i >= 0; i--) {
    const k = kept.get(log[i])?.get(me);
    if (k && k.length === s.players.length) {
      ts = cloneTallies(k);
      start = i + 1;
      break;
    }
  }
  ts ??= s.players.map(freshTally);
  const r: Reader = { s, me, names: namesOf(s), log };
  for (let i = start; i < log.length; i++) {
    read(r, ts, i);
    if (i % KEEP_EVERY === KEEP_EVERY - 1 || i === log.length - 1) {
      let m = kept.get(log[i]);
      if (!m) kept.set(log[i], (m = new Map()));
      m.set(me, cloneTallies(ts));
    }
  }
  return ts;
}

/** Expected cards per roll of each kind from the player's buildings (shares for the unknown cards). */
export function producedShares(s: GameState, q: PlayerId): Hand {
  const out = emptyHand();
  const t = topo(s);
  for (const [v, b] of Object.entries(s.board.buildings)) {
    if (b.owner !== q) continue;
    for (const h of t.vertexHexes[v]) {
      const hex = s.board.hexes[h];
      const n = pips(hex?.token ?? null);
      if (!hex || n === 0) continue;
      const r = TERRAIN_RESOURCE[hex.terrain];
      if (!r) {
        if (hex.terrain === 'gold') for (const x of RESOURCES) out[x] += ((b.type === 'city' ? 2 : 1) * n) / 5;
        continue;
      }
      const c = s.ck ? TERRAIN_COMMODITY[hex.terrain] : undefined;
      if (b.type !== 'city') out[r] += n;
      else if (c) {
        out[r] += n;
        out[c] += n;
      } else out[r] += 2 * n;
    }
  }
  return out;
}

/** Cards of a kind in the whole game: the bank's full supply. */
function supply(s: GameState, k: Card): number {
  return isCom(k) ? commodityBank(s.players.length) : scenarioOf(s).bankSize(s.players.length);
}

function bankCount(s: GameState, k: Card): number {
  return isCom(k) ? (s.ck?.bank[k as keyof NonNullable<GameState['ck']>['bank']] ?? 0) : s.bank[k as keyof GameState['bank']];
}

/**
 * The cards `me` expects each player to hold, by kind (its own hand exactly).
 * Fractions: 0.6 ore means "probably not, but maybe one".
 */
export function handEstimates(s: GameState, me: PlayerId): Hand[] {
  const ts = tallies(s, me);
  const mine = emptyHand();
  for (const r of RESOURCES) mine[r] = s.players[me].resources[r];
  if (s.ck) for (const c of COMMODITIES) mine[c] = s.ck.players[me].commodities[c];
  const others = s.players.map((pl) => pl.id).filter((q) => q !== me);
  const est: Hand[] = s.players.map(() => emptyHand());
  est[me] = mine;
  // each hand: its known cards fitted to its public size, the unknown ones spread by what the player produces
  const sizes = new Map<PlayerId, { r: number; c: number }>();
  for (const q of others) {
    const t = ts[q];
    const coms = s.ck ? commodityCount(s, q) : 0;
    const res = handSize(s, q) - coms;
    sizes.set(q, { r: res, c: coms });
    const prod = producedShares(s, q);
    for (const [family, count, un] of [
      [RESOURCES, res, t.unR],
      [COMMODITIES, coms, t.unC],
    ] as const) {
      if (family === COMMODITIES && !s.ck) continue;
      const known = family.reduce((n, k) => n + t.known[k], 0);
      let unknown = un;
      let scale = 1;
      if (known + unknown > count) {
        // fewer cards than followed: the unknown ones go first, then the known ones evenly
        unknown = Math.max(0, count - known);
        scale = known > 0 ? Math.min(1, count / known) : 0;
      } else unknown = count - known;
      const share = family.reduce((n, k) => n + prod[k], 0);
      for (const k of family) {
        const spread = share > 0 ? prod[k] / share : 1 / family.length;
        // (a little of every kind: production is not the only way to get a card)
        est[q][k] = t.known[k] * scale + unknown * (0.85 * spread + 0.15 / family.length);
      }
    }
  }
  if (others.length === 0) return est;
  // the bank: what the others hold between them, per kind; fitted together with the hand sizes
  for (const family of s.ck ? [RESOURCES, COMMODITIES] : [RESOURCES]) {
    const rowTarget = (q: PlayerId) => (family === COMMODITIES ? sizes.get(q)!.c : sizes.get(q)!.r);
    const col = new Map<Card, number>();
    for (const k of family) col.set(k, Math.max(0, supply(s, k) - bankCount(s, k) - mine[k]));
    for (let round = 0; round < 8; round++) {
      for (const k of family) {
        const sum = others.reduce((n, q) => n + est[q][k], 0);
        const want = col.get(k)!;
        if (sum > 1e-9) for (const q of others) est[q][k] *= want / sum;
        else if (want > 0) {
          // the tracker had none of these anywhere: spread them over the hands with room
          const room = others.filter((q) => rowTarget(q) > 0);
          for (const q of room) est[q][k] = want / room.length;
        }
      }
      for (const q of others) {
        const sum = family.reduce((n, k) => n + est[q][k], 0);
        const want = rowTarget(q);
        if (sum > 1e-9) for (const k of family) est[q][k] *= want / sum;
      }
    }
  }
  return est;
}
