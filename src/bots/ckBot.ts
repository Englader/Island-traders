import { bankOf, cardRates, handOf, isCommodity } from '../ck/cards.js';
import { commodityCount } from '../ck/basics.js';
import {
  ABILITY_LEVEL,
  BARBARIAN_TRACK,
  CK_COSTS,
  MAX_CITY_WALLS,
  MAX_IMPROVEMENT,
  METROPOLIS_LEVEL,
  PROGRESS_CARDS,
  PROGRESS_HAND_LIMIT,
  TERRAIN_COMMODITY,
  TRACK_COMMODITY,
  TRACKS,
  drawsOn,
} from '../ck/constants.js';
import {
  barbarianStrength,
  citiesOf,
  improvementError,
  improvementPrice,
  isMetropolis,
  metropolisSites,
  pillageableCities,
  robberActive,
  setupPlacesCity,
  sevenLimit,
  winsMetropolis,
} from '../ck/engine.js';
import { activeStrength, knightSiteError, knightsInSupply, knightsOf, retreatSpots } from '../ck/knights.js';
import { ckSeafarers } from '../ck/seafarers.js';
import { CARDS, COMMODITIES, COSTS, RESOURCES, TERRAIN_RESOURCE, pips } from '../core/constants.js';
import { cardTotal, total } from '../core/resources.js';
import type {
  Action,
  Card,
  CardCounts,
  EdgeId,
  GameState,
  HexId,
  ImprovementTrack,
  Knight,
  PartialCounts,
  PlayerId,
  ProgressCardName,
  Resource,
  TradeOffer,
  VertexId,
} from '../core/types.js';
import { applyAction } from '../engine/apply.js';
import { legalCities, legalRoads, legalSettlements, legalShips } from '../engine/placements.js';
import { longestRouteLength, updateLongestRoute } from '../rules/longestRoute.js';
import { edgeAllowsRoad, edgeAllowsShip, handSize, publicVP, topo, vertexLandHexes, vertexZones } from '../rules/queries.js';
import { scenarioOf } from '../scenarios/registry.js';
import { WONDERS, WONDER_LEVELS } from '../scenarios/seafarers/wonders.js';
import {
  best,
  edgeScore,
  leaderWeight,
  nearWin,
  pickBest,
  potentialField,
  robberScore,
  wobble,
  type Profile,
} from './heuristicBot.js';

/**
 * Computer players for Cities & Knights. The heuristic bot hands every
 * decision of a C&K game to this module; the level's profile (`ck` in
 * heuristicBot's PROFILES) sets how far it looks:
 *
 * - Set-up: the city goes where forest, pasture and mountains give
 *   commodities (weighted by `commodities`).
 * - Barbarians: it tracks the ship, the barbarians' strength (cities) and
 *   every player's active knights, and keeps from being the weakest
 *   defender when an attack would be lost and a city is at risk; the hard
 *   level weighs the odds of an attack before its next turn and the others'
 *   idle knights, and races for Defender of Catan.
 * - City improvements: one main track picked by commodity income, the
 *   level-3 abilities and (hard) the metropolis race; cheap levels of the
 *   others for their progress cards.
 * - Progress cards: played when they help (hard: when they matter most, on
 *   the leader); every card step answered.
 * - Trading, discards and the hand: every card, commodities included, is
 *   valued by what the player is saving for.
 * - Seafarers scenarios: ships head for settlement spots and scenario targets
 *   across the sea (island bonuses, Cloth villages), gold counts as a free
 *   pick, knights chase the pirate off its ships, and a Wonders player claims
 *   and builds a wonder (section 16 of the spec).
 *
 * Like the base bot it only uses what its seat may see: public state, its
 * own hand and progress cards, and what a Spy or Master Merchant shows it.
 */

/** What a level does in Cities & Knights (part of the bot's profile). */
export interface CkProfile {
  /**
   * The barbarians: 0 notices them only when the ship is about to land, and
   * not always; 1 keeps from being the weakest defender once an attack is
   * likely before its next turn; 2 plans from further out, counts the
   * others' idle knights and races for Defender of Catan.
   */
  barbarians: 0 | 1 | 2;
  /** What a city's commodity (forest, pasture, mountains) is worth on top of an ordinary card. */
  commodities: number;
  /**
   * City improvements: 0 buys whatever it can afford; 1 follows its
   * commodity income toward a metropolis; 2 also weighs the level-3
   * abilities and the others' levels (races it can win, level 5 to take or
   * keep a metropolis).
   */
  tracks: 0 | 1 | 2;
  /** Progress cards: 0 plays them as soon as it can, choosing at random; 1 when they plainly help; 2 when they matter most, against the leader. */
  cards: 0 | 1 | 2;
  /**
   * Knights beyond defence: 0 only chases the robber off its hexes; 1 also
   * places them next to its best hexes; 2 also blocks and displaces
   * opponents' knights in its way.
   */
  knights: 0 | 1 | 2;
  /** Builds city walls when its hand is large. */
  walls: boolean;
  /**
   * Seafarers scenarios: 0 builds ships with spare cards only; 1 also saves
   * for a ship toward a spot across the sea once its own island is full; 2
   * also sails for Cloth villages until it trades with two.
   */
  sea: 0 | 1 | 2;
}

type Play = Extract<Action, { type: 'playProgress' }>;
type Choice = Extract<Action, { type: 'progressChoice' }>;
type Improve = Extract<Action, { type: 'improveCity' }>;
type Hand = Record<Card, number>;

function byType<T extends Action['type']>(acts: Action[], type: T): Array<Extract<Action, { type: T }>> {
  return acts.filter((a): a is Extract<Action, { type: T }> => a.type === type);
}

const arg = <T>(a: { args?: Record<string, unknown> }, k: string) => a.args?.[k] as T;

function zero(): Hand {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, paper: 0, cloth: 0, coin: 0 };
}

/** Cards of `cost` the hand lacks. */
function lack(have: Hand, cost: CardCounts): CardCounts {
  const out: CardCounts = {};
  for (const k of CARDS) {
    const m = (cost[k] ?? 0) - have[k];
    if (m > 0) out[k] = m;
  }
  return out;
}

function covers(have: Hand, cost: CardCounts): boolean {
  return CARDS.every((k) => have[k] >= (cost[k] ?? 0));
}

function opponents(s: GameState, p: PlayerId): PlayerId[] {
  return s.players.map((x) => x.id).filter((q) => q !== p);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// Production and the value of cards
// ---------------------------------------------------------------------------

/** Expected cards per 36 rolls, per kind, from the player's buildings (a city takes a commodity on forest, pasture and mountains). */
export function ckProduction(s: GameState, p: PlayerId): Hand {
  const out = zero();
  const t = topo(s);
  for (const [v, b] of Object.entries(s.board.buildings)) {
    if (b.owner !== p) continue;
    for (const h of t.vertexHexes[v]) {
      if (h === s.board.robber) continue;
      const hex = s.board.hexes[h];
      const n = pips(hex?.token ?? null);
      if (!hex || n === 0) continue;
      const r = TERRAIN_RESOURCE[hex.terrain];
      if (!r) {
        // Seafarers gold: a free pick, spread over the five resources (never a commodity)
        if (hex.terrain === 'gold') for (const x of RESOURCES) out[x] += ((b.type === 'city' ? 2 : 1) * n) / 5;
        continue;
      }
      const c = TERRAIN_COMMODITY[hex.terrain];
      if (b.type !== 'city') out[r] += n;
      else if (c) {
        out[r] += n;
        out[c] += n;
      } else out[r] += 2 * n;
    }
  }
  return out;
}

/** Resources a little more useful than others in C&K: ore and grain build cities and knights. */
const WORTH: Record<Resource, number> = { brick: 0.9, lumber: 0.95, wool: 1, grain: 1.1, ore: 1.15 };

/**
 * What a hex adds at an intersection: to a settlement, a settlement that will
 * become a city ('future'), or a city. A city's commodity counts 1 +
 * `weight` / 2 cards; a city on hills or fields takes a second resource.
 */
function hexWorth(s: GameState, h: HexId, prod: Hand, weight: number, as: 'settlement' | 'future' | 'city'): number {
  const hex = s.board.hexes[h];
  const n = pips(hex?.token ?? null);
  if (!hex || n === 0) return 0;
  const r = TERRAIN_RESOURCE[hex.terrain];
  if (!r) {
    if (hex.terrain !== 'gold') return 0;
    // Seafarers gold: any resource, one per settlement and two per city, never a commodity (2025 rulebook p. 12)
    const pick = n * 1.25;
    return as === 'settlement' ? pick : pick + (as === 'city' ? pick : 0.3 * pick);
  }
  const scarce = prod[r] === 0 ? 1.4 : prod[r] < 4 ? 1.12 : 1;
  const base = n * WORTH[r] * scarce;
  if (as === 'settlement') return base;
  const c = TERRAIN_COMMODITY[hex.terrain];
  const extra = c ? n * (1 + weight / 2) * (prod[c] === 0 ? 1.15 : 1) : n * WORTH[r];
  return base + (as === 'city' ? extra : 0.3 * extra);
}

/** The value of a building at `v` (the base bot's spot value, with commodities). */
export function ckSpotValue(
  s: GameState,
  p: PlayerId,
  v: VertexId,
  weight: number,
  as: 'settlement' | 'future' | 'city',
  prod = ckProduction(s, p),
): number {
  let value = 0;
  const kinds = new Set<string>();
  for (const h of vertexLandHexes(s, v)) {
    value += hexWorth(s, h, prod, weight, as);
    if (pips(s.board.hexes[h].token) > 0) kinds.add(s.board.hexes[h].terrain);
  }
  value += kinds.size * 0.6;
  const t = topo(s);
  for (const hb of s.board.harbors) {
    if (!t.edgeVertices[hb.edge].includes(v)) continue;
    // a 3:1 harbor serves commodities too; the 2:1 harbors only their resource
    if (hb.type === 'generic') value += 1 + (prod.paper + prod.cloth + prod.coin > 0 ? 0.5 : 0);
    else value += prod[hb.type] >= 5 ? 2.5 : 0.8;
  }
  // Seafarers: the VP chits for a first settlement in a new area (as the base bot counts them)
  const bonus = scenarioOf(s).rules.islandBonus;
  if (bonus && s.phase.kind !== 'setup') {
    const pl = s.players[p];
    const home = bonus.home === 'setup' ? pl.homeZones : bonus.home;
    for (const z of vertexZones(s, v)) if (!home.includes(z) && !pl.bonusZones.includes(z)) value += bonus.vp * 4;
  }
  return value;
}

/** What upgrading the settlement at `v` adds. */
function cityGain(s: GameState, p: PlayerId, v: VertexId, weight: number, prod: Hand): number {
  let gain = 0;
  for (const h of vertexLandHexes(s, v)) gain += hexWorth(s, h, prod, weight, 'city') - hexWorth(s, h, prod, weight, 'settlement');
  return gain;
}

// ---------------------------------------------------------------------------
// The position, computed once per decision
// ---------------------------------------------------------------------------

/** The barbarians as everyone can see them. */
export interface Outlook {
  /** Ship moves left before it lands. */
  steps: number;
  /**
   * Chance the ship lands before the active player's next turn (the others'
   * rolls and its own next roll). With 5-6 players too: they act again
   * sooner (a paired part, a special build phase), but a horizon of one roll
   * per player keeps their knights ready in time (the special build phase
   * has no trades to find the grain).
   */
  soon: number;
  /** Chance it lands within two of the active player's turns. */
  later: number;
  /** The barbarians' strength: cities on the board. */
  cities: number;
  /** Active knight strength per player. */
  strength: number[];
  /** Inactive knight strength per player. */
  idle: number[];
  /** Players with a city the barbarians could pillage. */
  exposed: boolean[];
}

function atLeast(n: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let c = 1;
  let total = 0;
  for (let i = 0; i <= n; i++) {
    if (i >= k) total += c;
    c = (c * (n - i)) / (i + 1);
  }
  return total / 2 ** n;
}

export function outlook(s: GameState): Outlook {
  const ck = s.ck!;
  const n = s.players.length;
  const steps = BARBARIAN_TRACK - ck.barbarians;
  return {
    steps,
    // half the event die's faces are ships
    soon: atLeast(n, steps),
    later: atLeast(2 * n, steps),
    cities: barbarianStrength(s),
    strength: s.players.map((pl) => activeStrength(s, pl.id)),
    idle: s.players.map((pl) => sum(knightsOf(s, pl.id).filter(([, k]) => !k.active).map(([, k]) => k.level))),
    exposed: s.players.map((pl) => pillageableCities(s, pl.id).length > 0),
  };
}

interface Ctx {
  s: GameState;
  p: PlayerId;
  pr: Profile;
  ck: CkProfile;
  hand: Hand;
  prod: Hand;
  rates: Record<Card, number>;
  vp: number;
  /** VP still needed to win. */
  gap: number;
  /** Hand size a 7 leaves alone. */
  limit: number;
  out: Outlook;
  /** The opponent with the most VP. */
  leader: PlayerId;
  /** A Seafarers scenario: ships, gold, the pirate and scenario goals. */
  sea: boolean;
  memo: Map<string, unknown>;
}

function context(s: GameState, p: PlayerId, pr: Profile): Ctx {
  const vp = publicVP(s, p);
  const opp = opponents(s, p);
  return {
    s,
    p,
    pr,
    ck: pr.ck,
    hand: handOf(s, p),
    prod: ckProduction(s, p),
    rates: cardRates(s, p),
    vp,
    gap: s.victoryTarget - vp,
    limit: sevenLimit(s, p),
    out: outlook(s),
    leader: best(opp, (q) => publicVP(s, q) + handSize(s, q) * 0.01) ?? opp[0],
    sea: ckSeafarers(s),
    memo: new Map(),
  };
}

function lazy<T>(c: Ctx, key: string, f: () => T): T {
  if (!c.memo.has(key)) c.memo.set(key, f());
  return c.memo.get(key) as T;
}

const pot = (c: Ctx) => lazy(c, 'pot', () => potentialField(c.s, c.p));
/** Seafarers: the field spread by roads only, or by ships only (a coastal road leads nowhere at sea). */
const roadPot = (c: Ctx) => lazy(c, 'pot:road', () => potentialField(c.s, c.p, (e) => edgeAllowsRoad(c.s, e)));
const shipPot = (c: Ctx) => lazy(c, 'pot:ship', () => potentialField(c.s, c.p, (e) => edgeAllowsShip(c.s, e)));

/** How much a road or a ship on `e` brings the player closer to something (the base bot's edge score; by kind with Seafarers). */
function edgeValue(c: Ctx, e: EdgeId, ship: boolean): number {
  if (!c.sea) return edgeScore(c.s, c.p, e, pot(c));
  return edgeScore(c.s, c.p, e, ship ? shipPot(c) : roadPot(c));
}
const handCount = (c: Ctx) => cardTotal(c.hand);
/** How much the bot minds hurting `q` (the leader most, at a focused level). */
const weightOf = (c: Ctx, q: PlayerId) => leaderWeight(c.s, q, Math.max(1, c.pr.robberFocus), c.p);

/** How much the player wants one more card of each kind now. */
function wants(c: Ctx): Hand {
  return lazy(c, 'wants', () => {
    const goal = resourceGoal(c);
    const cgoal = commodityGoal(c);
    const out = zero();
    const main = cgoal ? TRACK_COMMODITY[cgoal.track] : null;
    for (const k of CARDS) {
      let w = isCommodity(k) ? 1.3 : WORTH[k as Resource];
      if (c.pr.plans) {
        if (goal && (goal.cost[k] ?? 0) > c.hand[k]) w += 2;
        if (cgoal && (cgoal.cost[k] ?? 0) > c.hand[k]) w += 2;
      }
      if (c.prod[k] === 0) w += 0.4;
      if (isCommodity(k)) {
        if (k === main) w += 0.6;
        const track = TRACKS.find((t) => TRACK_COMMODITY[t] === k)!;
        if (c.s.ck!.players[c.p].improvements[track] >= MAX_IMPROVEMENT) w -= 0.5;
      }
      if (c.hand[k] >= 4) w -= 0.6;
      out[k] = w;
    }
    return out;
  });
}

/** Value of a set of cards to the player. */
function worth(c: Ctx, cards: CardCounts): number {
  const w = wants(c);
  return CARDS.reduce((n, k) => n + (cards[k] ?? 0) * w[k], 0);
}

/** The `n` cards the player minds losing least (one at a time, so a pile counts less as it grows). */
function cheapest(c: Ctx, n: number, from: Hand = c.hand): CardCounts {
  const have = { ...from };
  const w = wants(c);
  const goal = resourceGoal(c);
  const cgoal = commodityGoal(c);
  const out: CardCounts = {};
  for (let i = 0; i < n; i++) {
    let pick: Card | null = null;
    let low = Infinity;
    for (const k of CARDS) {
      if (have[k] <= 0) continue;
      let v = w[k] - have[k] * 0.25;
      // the cards of what it saves for go last
      if (have[k] <= (goal?.cost[k] ?? 0) || have[k] <= (cgoal?.cost[k] ?? 0)) v += 2;
      if (v < low) {
        low = v;
        pick = k;
      }
    }
    if (pick === null) break;
    have[pick]--;
    out[pick] = (out[pick] ?? 0) + 1;
  }
  return out;
}

/** The biggest piles (the easy level's discards). */
function biggestPiles(have: Hand, n: number): CardCounts {
  const h = { ...have };
  const out: CardCounts = {};
  for (let i = 0; i < n; i++) {
    let pick: Card | null = null;
    for (const k of CARDS) if (h[k] > 0 && (pick === null || h[k] > h[pick])) pick = k;
    if (pick === null) break;
    h[pick]--;
    out[pick] = (out[pick] ?? 0) + 1;
  }
  return out;
}

function sameCounts(a: CardCounts, b: CardCounts): boolean {
  return CARDS.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

// ---------------------------------------------------------------------------
// Set-up
// ---------------------------------------------------------------------------

function setupAction(c: Ctx, acts: Action[]): Action | null {
  const { s, p, pr } = c;
  const settle = byType(acts, 'placeSettlement');
  if (settle.length > 0) {
    const ph = s.phase;
    const city = ph.kind === 'setup' && setupPlacesCity(s, ph.round);
    return pickBest(s, p, pr, settle, (a) => ckSpotValue(s, p, a.vertex, c.ck.commodities, city ? 'city' : 'future', c.prod), (a) => a.vertex);
  }
  const edges = [...byType(acts, 'placeRoad'), ...byType(acts, 'placeShip')];
  return best(edges, (a) => edgeValue(c, a.edge, a.type === 'placeShip') + (a.type === 'placeRoad' ? 0.1 : 0)) ?? acts[0];
}

// ---------------------------------------------------------------------------
// Barbarians and knights
// ---------------------------------------------------------------------------

/** What losing a city to the barbarians costs, in cards: a VP and the poorest city's extra production. */
function cityLoss(c: Ctx): number {
  const cities = pillageableCities(c.s, c.p);
  if (cities.length === 0) return 0;
  const poorest = Math.min(...cities.map((v) => cityGain(c.s, c.p, v, c.ck.commodities, c.prod)));
  return 6 + poorest * 0.3;
}

interface Defence {
  /** Active strength wanted by the end of this turn. */
  want: number;
  /** What reaching it is worth, in cards. */
  worth: number;
  /** An attack is likely before the next turn. */
  urgent: boolean;
  /** Knight strength (active or not) to have on the board ahead of the attack (hard builds early, activates later). */
  ready: number;
}

/**
 * How much active strength the player wants: enough not to be the weakest
 * of the players with a city at risk (or for the knights to hold) when the
 * attack would be lost, and (medium, hard) one more than everyone else for
 * Defender of Catan when it would be held.
 */
function defence(c: Ctx): Defence {
  return lazy(c, 'defence', () => {
    const { s, p, ck } = c;
    const o = c.out;
    const mine = o.strength[p];
    const level = ck.barbarians;
    const none: Defence = { want: mine, worth: 0, urgent: false, ready: 0 };
    // easy: only in the ship's last moves, and then not always
    if (level === 0 && (o.steps > 2 || wobble(s, p, 'barbarians') < 0.4)) return none;
    const odds = level === 2 ? Math.max(o.soon, o.later * 0.5) : o.soon;
    // knights on the board ahead of the attack (hard from five moves out, medium three), woken when an attack is plausible
    const planning = o.steps <= (level === 2 ? 5 : level === 1 ? 3 : 0);
    if (odds < (level === 2 ? 0.1 : level === 1 ? 0.45 : 0) && !planning) return none;
    const opp = opponents(s, p);
    // the others may wake their idle knights before the ship lands (hard)
    const est = (q: PlayerId) => o.strength[q] + (level === 2 ? Math.floor(o.idle[q] / 2) : 0);
    const othersTotal = sum(opp.map(est));
    let want = mine;
    let worth = 0;
    if (o.exposed[p]) {
      const hold = Math.max(0, o.cities - othersTotal);
      const rivals = opp.filter((q) => o.exposed[q]);
      const dodge = rivals.length > 0 ? Math.min(...rivals.map(est)) + 1 : Infinity;
      const safe = Math.min(hold, dodge);
      if (safe > mine) {
        want = safe;
        worth = odds * cityLoss(c);
      }
    }
    if (level >= 1 && s.ck!.defenderCards > 0) {
      const top = Math.max(0, ...opp.map(est)) + 1;
      const held = othersTotal + Math.max(top, want) >= o.cities;
      // hard races a few levels ahead for the card; with 5-6 players (four or five rivals for it) only one, like medium
      const reach = level === 2 && s.players.length <= 4 ? (c.gap <= 3 ? 4 : 3) : 1;
      if (held && top > want && top - mine <= reach) {
        worth += odds * (c.gap <= 2 ? 9 : 5);
        want = top;
      }
    }
    // more cities appear before the ship lands (its own next city too): at least one knight ready, unless every city is a metropolis
    const immune = !o.exposed[p] && citiesOf(s, p).length > 0;
    const ready = planning ? Math.max(want, immune ? 0 : 1) : 0;
    // too early to activate: knights wait idle until an attack is plausible
    if (odds < (level === 2 ? 0.1 : level === 1 ? 0.45 : 0)) return { want: mine, worth: 0, urgent: false, ready };
    return { want, worth, urgent: worth > 0 && o.soon >= (level === 2 ? 0.3 : 0.45), ready };
  });
}

/** The cheapest next step toward more active strength: activate, promote an active knight, or hire one. */
function defenceStep(c: Ctx, acts: Action[]): Action | null {
  const { s } = c;
  const knights = s.ck!.knights;
  const activate = best(byType(acts, 'activateKnight'), (a) => knights[a.vertex].level);
  if (activate) return activate;
  const promote = best(
    byType(acts, 'promoteKnight').filter((a) => knights[a.vertex].active),
    (a) => -knights[a.vertex].level,
  );
  if (promote) return promote;
  // a new knight helps only once it can be activated too
  if (c.hand.grain >= 2 || (c.hand.grain >= 1 && c.hand.wool + c.hand.ore >= 2)) {
    const build = best(byType(acts, 'buildKnight'), (a) => knightSite(c, a.vertex));
    if (build) return build;
  }
  return null;
}

/** The cards the next defence step needs (a knight to have ready: just hiring it). */
function defenceCost(c: Ctx): CardCounts | null {
  const mine = knightsOf(c.s, c.p);
  const d = defence(c);
  if (d.want <= c.out.strength[c.p]) return canHire(c) ? CK_COSTS.knight : null;
  if (mine.some(([, k]) => !k.active)) return CK_COSTS.activate;
  const politics = c.s.ck!.players[c.p].improvements.politics;
  const promotable = ([, k]: [VertexId, Knight]) =>
    k.active && (k.level === 1 || (k.level === 2 && politics >= ABILITY_LEVEL)) && knightsInSupply(c.s, c.p, (k.level + 1) as 2 | 3) > 0;
  if (mine.some(promotable)) return CK_COSTS.promote;
  return canHire(c) ? { wool: 1, ore: 1, grain: 1 } : null;
}

/** Whether the player could hire a knight at all (a basic one in its supply and a free intersection on its roads). */
function canHire(c: Ctx): boolean {
  return lazy(c, 'canHire', () => knightsInSupply(c.s, c.p, 1) > 0 && topo(c.s).vertexIds.some((v) => knightSiteError(c.s, c.p, v) === null));
}

/** Knight strength still missing from what the player wants ready on the board. */
function readyLack(c: Ctx): number {
  return defence(c).ready - c.out.strength[c.p] - c.out.idle[c.p];
}

/** Where a new knight does most: next to the player's best hexes (to chase the robber), and (hard) in opponents' way. */
function knightSite(c: Ctx, v: VertexId): number {
  const { s, p } = c;
  const t = topo(s);
  let score = 0;
  if (c.ck.knights >= 1) {
    for (const h of t.vertexHexes[v]) {
      const n = pips(s.board.hexes[h]?.token ?? null);
      if (n === 0) continue;
      let mine = 0;
      for (const w of t.hexVertices[h]) {
        const b = s.board.buildings[w];
        if (b?.owner === p) mine += b.type === 'city' ? 2 : 1;
      }
      score += n * mine * 0.1;
    }
  }
  if (c.ck.knights >= 2) {
    // in the way of an opponent's road
    for (const e of t.vertexEdges[v]) {
      const x = s.board.pieces[e];
      if (x && x.owner !== p) score += 1.5;
    }
  }
  // the player's own next settlement spot: the knight would have to move away first
  if (legalSettlements(s, p).includes(v)) score -= 2;
  return score + wobble(s, p, `knight:${v}`) * (c.pr.noise + 0.05);
}

/** Moving a knight that can act: would the player still be safe from the barbarians? */
function canSpare(c: Ctx, v: VertexId): boolean {
  const d = defence(c);
  if (!d.urgent) return true;
  const k = c.s.ck!.knights[v];
  if (c.out.strength[c.p] - k.level >= d.want) return true;
  // it may be activated again this turn (it cannot act again)
  return c.hand.grain >= 1;
}

/** Knights at work: chase the robber off the player's hexes, and (hard) displace knights in its way. */
function knightPlay(c: Ctx, acts: Action[]): Action | null {
  const { s, p } = c;
  const knights = s.ck!.knights;
  const robber = s.board.robber;
  if (robber && robberActive(s) && robberHurts(c, robber) > 0) {
    const chases = byType(acts, 'chaseRobber').filter((a) => a.piece === 'robber' && canSpare(c, a.vertex));
    const chase = best(chases, (a) => -knights[a.vertex].level);
    if (chase) return chase;
  }
  // Seafarers: the pirate next to its ships (they cannot sail on, and it robs them)
  const pirate = s.board.pirate;
  if (c.sea && pirate && robberActive(s) && pirateHurts(c, pirate) > 0) {
    const chases = byType(acts, 'chaseRobber').filter((a) => a.piece === 'pirate' && canSpare(c, a.vertex));
    const chase = best(chases, (a) => -knights[a.vertex].level);
    if (chase) return chase;
  }
  if (c.ck.knights < 2) return null;
  const field = pot(c);
  const displace = best(
    byType(acts, 'displaceKnight').filter((a) => canSpare(c, a.from)),
    (a) => {
      const them = knights[a.to];
      let v = (field.get(a.to) ?? 0) * 0.5 + them.level * 0.5 + (them.active ? 0.5 : 0);
      if (retreatSpots(s, them.owner, a.to).length === 0) v += them.level * 1.5;
      return v * (them.owner === c.leader ? 1.3 : 1);
    },
  );
  if (displace) {
    const them = knights[displace.to];
    const v = (field.get(displace.to) ?? 0) * 0.5 + them.level;
    if (v >= 2.5) return displace;
  }
  // block an opponent's road where it heads for a good spot (only while the ship is far, or the knight can be woken again)
  const moves = byType(acts, 'moveKnight').filter((a) => (c.out.steps >= 4 || c.hand.grain >= 1) && canSpare(c, a.from));
  if (moves.length > 0) {
    const t = topo(s);
    const block = (a: Extract<Action, { type: 'moveKnight' }>) => {
      let v = 0;
      for (const q of opponents(s, p)) {
        if (!t.vertexEdges[a.to].some((e) => s.board.pieces[e]?.owner === q)) continue;
        const theirs = lazy(c, `pot:${q}`, () => potentialField(s, q));
        v = Math.max(v, (theirs.get(a.to) ?? 0) * 0.5 * weightOf(c, q));
      }
      return v - knightSite(c, a.from) * 0.5;
    };
    const top = best(moves, block);
    if (top && block(top) >= 4) return top;
  }
  return null;
}

/** The player's ships next to the pirate (stuck, and robbed on its next move there). */
function pirateHurts(c: Ctx, hex: HexId): number {
  return topo(c.s).hexEdges[hex].filter((e) => {
    const x = c.s.board.pieces[e];
    return x?.type === 'ship' && x.owner === c.p;
  }).length;
}

/** Pips the robber takes from the player where it stands. */
function robberHurts(c: Ctx, hex: HexId): number {
  const { s, p } = c;
  const n = pips(s.board.hexes[hex]?.token ?? null);
  let mine = 0;
  for (const v of topo(s).hexVertices[hex]) {
    const b = s.board.buildings[v];
    if (b?.owner === p) mine += b.type === 'city' ? 2 : 1;
  }
  return n * mine;
}

// ---------------------------------------------------------------------------
// City improvements
// ---------------------------------------------------------------------------

/** Chance per roll that a production roll gives the player nothing (the Aqueduct's chance). */
function idleOdds(c: Ctx): number {
  const { s, p } = c;
  const t = topo(s);
  const sums = new Set<number>();
  for (const [v, b] of Object.entries(s.board.buildings)) {
    if (b.owner !== p) continue;
    for (const h of t.vertexHexes[v]) {
      const token = s.board.hexes[h]?.token;
      if (token && h !== s.board.robber && TERRAIN_RESOURCE[s.board.hexes[h].terrain]) sums.add(token);
    }
  }
  let q = 0;
  for (let x = 2; x <= 12; x++) if (x !== 7 && !sums.has(x)) q += pips(x);
  return q / 36;
}

/** What a track's level-3 ability is worth to the player, in cards. */
function abilityValue(c: Ctx, t: ImprovementTrack): number {
  switch (t) {
    case 'trade':
      // Merchant Guild: commodities 2:1, for heavy commodity producers
      return (c.prod.paper + c.prod.cloth + c.prod.coin) * 0.3;
    case 'politics': {
      // Fortress: mighty knights
      const strong = knightsOf(c.s, c.p).filter(([, k]) => k.level >= 2).length;
      return strong * 1.5 + (c.ck.barbarians === 2 ? 1 : 0);
    }
    case 'science':
      // Aqueduct: a resource whenever a roll gives nothing, for weak producers
      return idleOdds(c) * 12;
  }
}

/** How attractive the next level of a track is as the player's main goal. */
function trackScore(c: Ctx, t: ImprovementTrack): number {
  const { s, p, ck } = c;
  const all = s.ck!;
  const level = all.players[p].improvements[t];
  if (level >= MAX_IMPROVEMENT || improvementError(s, p, t, true) !== null) return -Infinity;
  const com = TRACK_COMMODITY[t];
  if (ck.tracks === 0) return c.hand[com] + wobble(s, p, `track:${t}`);
  let score = c.prod[com] * 0.6 + c.hand[com] * 0.5 + level * 1.5;
  const m = all.metropolises[t];
  const locked = m !== null && m.owner !== p && all.players[m.owner].improvements[t] >= MAX_IMPROVEMENT;
  if (m === null) score += 3;
  else if (m.owner === p) score += level >= METROPOLIS_LEVEL ? 1 : 0;
  else if (locked) score -= 6;
  else score += 1;
  if (ck.tracks === 2) {
    if (level < ABILITY_LEVEL) score += abilityValue(c, t) * 0.5;
    for (const q of opponents(s, p)) {
      const theirs = all.players[q].improvements[t];
      // a race it is behind in, for a metropolis still to be won
      if (m === null && theirs > level) score -= (theirs - level) * 1.5;
      // its own metropolis under threat: level 5 keeps it
      if (m?.owner === p && theirs >= METROPOLIS_LEVEL) score += 4;
      // someone else's metropolis it can take with level 5
      if (m && m.owner === q && !locked && level >= ABILITY_LEVEL) score += 2;
    }
    if (locked && level >= ABILITY_LEVEL) score -= 4;
  }
  return score;
}

/** The track the player works toward. */
function mainTrack(c: Ctx): ImprovementTrack | null {
  return lazy(c, 'track', () => {
    const t = best([...TRACKS], (x) => trackScore(c, x));
    return t !== null && trackScore(c, t) > -Infinity ? t : null;
  });
}

/** How good a city is for a metropolis: the best city, a walled one first (the wall is then safe too). */
function metropolisWorth(c: Ctx, v: VertexId): number {
  return ckSpotValue(c.s, c.p, v, c.ck.commodities, 'city', c.prod) + (c.s.ck!.players[c.p].walls.includes(v) ? 3 : 0);
}

function metropolisSite(c: Ctx): VertexId | undefined {
  return best(metropolisSites(c.s, c.p), (v) => metropolisWorth(c, v)) ?? undefined;
}

interface Goal {
  cost: CardCounts;
  action: Action;
  rank: number;
  label: string;
}

/** The next level of the main track. */
function commodityGoal(c: Ctx): (Goal & { track: ImprovementTrack }) | null {
  return lazy(c, 'cgoal', () => {
    const t = mainTrack(c);
    if (!t) return null;
    const wins = winsMetropolis(c.s, c.p, t);
    const vertex = wins ? metropolisSite(c) : undefined;
    if (wins && !vertex) return null;
    const action: Action = { type: 'improveCity', player: c.p, track: t, ...(vertex ? { vertex } : {}) };
    return { track: t, cost: improvementPrice(c.s, c.p, t), action, rank: 0, label: `improve ${t}` };
  });
}

/** An improvement worth buying now. */
function improvement(c: Ctx, acts: Action[]): Action | null {
  const { s, p } = c;
  const options = byType(acts, 'improveCity');
  if (options.length === 0) return null;
  const site = (a: Improve) => (a.vertex === undefined ? 0 : metropolisWorth(c, a.vertex));
  const level = (a: Improve) => s.ck!.players[p].improvements[a.track];
  if (c.ck.tracks === 0) return pickBest(s, p, c.pr, options, (a) => level(a) + site(a) * 0.01, (a) => `${a.track}${a.vertex ?? ''}`);
  const main = mainTrack(c);
  const mine = options.filter((a) => a.track === main);
  if (mine.length > 0) return best(mine, site);
  // other tracks: the cheap levels (progress cards), an ability or a metropolis, with commodities the main track doesn't need
  return (
    best(
      options.filter((a) => {
        const next = s.ck!.players[p].improvements[a.track] + 1;
        if (winsMetropolis(s, p, a.track)) return true;
        if (next <= 2) return true;
        return next === ABILITY_LEVEL && (c.ck.tracks === 1 || abilityValue(c, a.track) >= 3);
      }),
      (a) => -level(a) + site(a) * 0.01,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// What to save for
// ---------------------------------------------------------------------------

/**
 * The resource target: a city, a settlement, a road toward a good spot, the
 * next step against the barbarians, or a city wall, whichever is fewest
 * cards away (with a rank for how much each matters now).
 */
function resourceGoal(c: Ctx): Goal | null {
  return lazy(c, 'goal', () => {
    if (!c.pr.plans) return null;
    const { s, p } = c;
    const options: Goal[] = [];
    const endgame = c.gap <= 3 ? 0.6 : 0;
    const cities = legalCities(s, p);
    if (cities.length > 0) {
      const v = best(cities, (x) => cityGain(s, p, x, c.ck.commodities, c.prod))!;
      options.push({ cost: COSTS.city, action: { type: 'buildCity', player: p, vertex: v }, rank: -0.2 - endgame, label: 'city' });
    }
    const spots = legalSettlements(s, p);
    if (spots.length > 0) {
      const v = best(spots, (x) => ckSpotValue(s, p, x, c.ck.commodities, 'future', c.prod))!;
      options.push({ cost: COSTS.settlement, action: { type: 'buildSettlement', player: p, vertex: v }, rank: 0 - endgame, label: 'settlement' });
    } else if (s.players[p].supply.settlements > 0 || (c.sea && c.ck.sea >= 1)) {
      // Seafarers: ships toward spots across the sea and the scenario's targets (Cloth villages)
      const edges = [
        ...legalRoads(s, p).map((edge) => ({ edge, ship: false })),
        ...(c.sea && c.ck.sea >= 1 ? legalShips(s, p).map((edge) => ({ edge, ship: true })) : []),
      ];
      const e = best(edges, (x) => edgeValue(c, x.edge, x.ship));
      if (e && edgeValue(c, e.edge, e.ship) > 0.5 && (s.players[p].supply.settlements > 0 || e.ship)) {
        options.push(
          e.ship
            ? { cost: COSTS.ship, action: { type: 'buildShip', player: p, edge: e.edge }, rank: 1, label: 'ship' }
            : { cost: COSTS.road, action: { type: 'buildRoad', player: p, edge: e.edge }, rank: 1, label: 'road' },
        );
      }
    }
    const village = c.ck.sea >= 2 ? villageShip(c) : null;
    if (village) options.push({ cost: COSTS.ship, action: { type: 'buildShip', player: p, edge: village }, rank: VILLAGE_RANK, label: 'ship' });
    const wonder = wonderGoal(c);
    if (wonder) options.push(wonder);
    const lr = routePush(c);
    if (lr) options.push({ cost: COSTS.road, action: { type: 'buildRoad', player: p, edge: lr }, rank: -0.3, label: 'route' });
    const d = defence(c);
    const step = defenceCost(c);
    if (d.want > c.out.strength[p] && d.worth >= 1.5 && step) {
      const rank = d.urgent ? -2 : d.worth >= 4 ? -0.5 : 0.8;
      options.push({ cost: step, action: { type: 'endTurn', player: p }, rank, label: 'defence' });
    } else if (readyLack(c) > 0 && canHire(c)) {
      options.push({ cost: CK_COSTS.knight, action: { type: 'endTurn', player: p }, rank: c.out.steps <= 3 ? -0.5 : 0.5, label: 'knight' });
    }
    if (c.ck.walls && wallSites(c).length > 0 && handCount(c) > c.limit - 1 && c.out.cities > 0) {
      options.push({ cost: CK_COSTS.cityWall, action: { type: 'endTurn', player: p }, rank: 1.5, label: 'wall' });
    }
    return best(options, (o) => -(cardTotal(lack(c.hand, o.cost)) + o.rank * 0.4)) ?? null;
  });
}

/** Cloth for Catan (hard): how much a ship toward a village matters, how near (in ships) the village must be, and how many to trade with. */
const VILLAGE_RANK = 0.3;
const VILLAGE_REACH = 3;
const VILLAGES = 2;

/**
 * Cloth for Catan (hard): the ship toward the best village with cloth a few
 * ships away, while the player trades with fewer than VILLAGES of them (a
 * village pays cloth, 2 cloth = 1 VP, on arrival and on its number). Nearer
 * villages, likelier numbers and fewer traders sharing them come first.
 */
function villageShip(c: Ctx): EdgeId | null {
  const { s, p } = c;
  const cloth = s.ext.cloth as { villages: Record<VertexId, { token: number; cloth: number; traders: number[] }> } | undefined;
  if (!cloth) return null;
  const villages = Object.entries(cloth.villages);
  if (villages.filter(([, v]) => v.traders.includes(p)).length >= VILLAGES) return null;
  const targets = villages.filter(([, v]) => v.cloth > 0 && !v.traders.includes(p));
  if (targets.length === 0) return null;
  return lazy(c, 'village', () => {
    const t = topo(s);
    const ships = legalShips(s, p);
    let top: EdgeId | null = null;
    let low = Infinity;
    for (const [at, village] of targets) {
      // ship steps from each intersection to this village, over paths a ship of the player could take
      const dist = new Map<VertexId, number>([[at, 0]]);
      const queue = [at];
      for (let i = 0; i < queue.length; i++) {
        const v = queue[i];
        for (const e of t.vertexEdges[v]) {
          const piece = s.board.pieces[e];
          if (!edgeAllowsShip(s, e) || (piece && piece.owner !== p)) continue;
          const [a, b] = t.edgeVertices[e];
          const w = a === v ? b : a;
          if (!dist.has(w)) {
            dist.set(w, dist.get(v)! + 1);
            queue.push(w);
          }
        }
      }
      const appeal = pips(village.token) * 0.3 - village.traders.length * 0.5;
      for (const e of ships) {
        const [a, b] = t.edgeVertices[e];
        const da = dist.get(a) ?? Infinity;
        const db = dist.get(b) ?? Infinity;
        // the step must bring the route closer, and the village be a few ships away
        const d = Math.min(da, db);
        if (da === db || d >= VILLAGE_REACH) continue;
        if (d - appeal < low) {
          low = d - appeal;
          top = e;
        }
      }
    }
    return top;
  });
}

/** Hard, near the end: the road that brings Longest Road within reach (2 VP), if a road or two does it. */
function routePush(c: Ctx): EdgeId | null {
  const { s, p } = c;
  if (c.ck.tracks < 2 || c.gap > 4 || s.longestRoute.holder === p || s.players[p].supply.roads === 0) return null;
  const holder = s.longestRoute.holder;
  const need = holder === null ? 5 : longestRouteLength(s, holder) + 1;
  const now = longestRouteLength(s, p);
  if (need - now > 2) return null;
  const e = best(legalRoads(s, p), (x) => routeWith(s, p, x, null));
  return e !== null && routeWith(s, p, e, null) > now ? e : null;
}

/** The Wonders: the player's wonder, its levels and the most any other player has built. */
function wonderState(c: Ctx): { id: string | null; mine: number; best: number } | null {
  const w = c.s.ext.wonders as { owned: Array<string | null>; levels: number[] } | undefined;
  if (!w) return null;
  return { id: w.owned[c.p], mine: w.levels[c.p], best: Math.max(0, ...w.levels.filter((_, q) => q !== c.p)) };
}

/** The next level of the player's wonder (all four win; with the VP target, more levels than anyone else). */
function wonderGoal(c: Ctx): Goal | null {
  const w = wonderState(c);
  if (!w?.id || w.mine >= WONDER_LEVELS) return null;
  const def = WONDERS.find((x) => x.id === w.id);
  if (!def) return null;
  return { cost: { ...def.cost } as CardCounts, action: { type: 'scenario', player: c.p, name: 'buildWonder' }, rank: wonderRank(c, w), label: 'wonder' };
}

/**
 * How much the next level matters: most when the VP are there but another
 * player has as many levels (only a level more wins), or the last level is
 * next (it wins outright); then while level with the others; less when ahead.
 */
function wonderRank(c: Ctx, w: { mine: number; best: number }): number {
  if (c.gap <= 0 && w.mine <= w.best) return -3;
  if (w.mine >= WONDER_LEVELS - 1) return -2;
  if (c.gap <= 2 && w.mine <= w.best) return -1.5;
  return w.mine <= w.best ? -0.6 : 0.4;
}

/** The Wonders: claim the wonder whose costs suit the player's production best, and build its levels when the cards are there. */
function wonderPlay(c: Ctx, acts: Action[]): Action | null {
  const sc = byType(acts, 'scenario');
  const build = sc.find((a) => a.name === 'buildWonder');
  if (build) {
    const goal = resourceGoal(c);
    const w = wonderState(c)!;
    if (!goal || goal.label === 'wonder' || goal.rank >= 0 || wonderRank(c, w) <= -1.5) return build;
  }
  const claims = sc.filter((a) => a.name === 'claimWonder');
  if (claims.length === 0) return null;
  return best(claims, (a) => {
    const def = WONDERS.find((x) => x.id === a.args?.wonder);
    return def ? RESOURCES.reduce((n, r) => n + (def.cost[r] ?? 0) * c.prod[r], 0) : -1;
  });
}

function wallSites(c: Ctx): VertexId[] {
  const walls = c.s.ck!.players[c.p].walls;
  if (walls.length >= MAX_CITY_WALLS) return [];
  return Object.entries(c.s.board.buildings)
    .filter(([v, b]) => b.owner === c.p && b.type === 'city' && !walls.includes(v))
    .map(([v]) => v);
}

/**
 * Bank and harbor trades that turn spare cards into the missing ones of
 * `cost`, keeping `keep` (the other goal's cards); null when the spare cards
 * are not enough.
 */
function bankPlan(c: Ctx, cost: CardCounts, keep: CardCounts): Array<{ give: Card; rate: number; get: Card }> | null {
  const have = { ...c.hand };
  const need = lack(have, cost);
  if (cardTotal(need) === 0) return [];
  const bank = bankOf(c.s);
  const w = wants(c);
  const plan: Array<{ give: Card; rate: number; get: Card }> = [];
  for (const k of CARDS) {
    for (let i = 0; i < (need[k] ?? 0); i++) {
      if (bank[k] <= 0) return null;
      const options = CARDS.filter((g) => g !== k && have[g] - (cost[g] ?? 0) - (keep[g] ?? 0) >= c.rates[g]);
      const g = best(options, (x) => -c.rates[x] * 2 - w[x] + have[x] * 0.05);
      if (!g) return null;
      have[g] -= c.rates[g];
      have[k] += 1;
      bank[k] -= 1;
      plan.push({ give: g, rate: c.rates[g], get: k });
    }
  }
  return plan;
}

function bankTrade(acts: Action[], give: Card, rate: number, get: Card): Action | null {
  return (
    byType(acts, 'bankTrade').find((a) => a.give[give] === rate && a.get[get] === 1 && cardTotal(a.give) === rate && cardTotal(a.get) === 1) ??
    null
  );
}

/** An offer to the other players: one spare card for one the goal lacks (hard: a second try with two). */
function offer(c: Ctx, cost: CardCounts, keep: CardCounts): Action | null {
  const { s, p, pr } = c;
  const made = s.turn.offers ?? 0;
  if (made >= pr.offersPerTurn || s.turn.role !== 'active') return null;
  if (s.options.tradeBuildMode === 'separate' && s.turn.buildingStarted) return null;
  const need = lack(c.hand, cost);
  if (cardTotal(need) < 1 || cardTotal(need) > 2) return null;
  const want = CARDS.find((k) => (need[k] ?? 0) > 0)!;
  const w = wants(c);
  const spare = (k: Card) => c.hand[k] - (cost[k] ?? 0) - (keep[k] ?? 0);
  const pool = CARDS.filter((k) => k !== want && spare(k) >= 1).sort((x, y) => w[x] - w[y] || spare(y) - spare(x));
  if (pool.length === 0) return null;
  const give: CardCounts = { [pool[0]]: 1 };
  if (made >= 1) {
    const second = pool.find((k) => spare(k) >= (k === pool[0] ? 2 : 1));
    if (!second) return null;
    give[second] = (give[second] ?? 0) + 1;
  }
  const to = opponents(s, p).filter((q) => !nearWin(s, q, pr) && handSize(s, q) > 0);
  if (to.length === 0) return null;
  const a: Action = { type: 'proposeTrade', player: p, give, get: { [want]: 1 }, to };
  return applyAction(s, a).ok ? a : null;
}

/** Works toward a goal: builds it, or asks the others, or trades with the bank when that completes it. */
function pursue(c: Ctx, acts: Action[], goal: Goal, keep: CardCounts, offers: boolean): Action | null {
  if (covers(c.hand, goal.cost)) return null;
  if (offers) {
    const o = offer(c, goal.cost, keep);
    if (o) return o;
  }
  const plan = bankPlan(c, goal.cost, keep);
  if (plan && plan.length > 0) return bankTrade(acts, plan[0].give, plan[0].rate, plan[0].get);
  return null;
}

// ---------------------------------------------------------------------------
// Progress cards
// ---------------------------------------------------------------------------

/** What keeping a progress card is worth now (the least is discarded first; the Spy takes the most). */
function keepValue(c: Ctx, card: ProgressCardName): number {
  const { s, p } = c;
  const o = c.out;
  switch (card) {
    case 'merchant':
      return s.ck!.merchant?.owner === p ? 5 : 8;
    case 'alchemist':
    case 'resourceMonopoly':
    case 'masterMerchant':
    case 'wedding':
      return 6;
    case 'medicine':
      return legalCities(s, p).length > 0 ? 6 : 3;
    case 'irrigation':
    case 'mining':
      return 5;
    case 'crane':
      return mainTrack(c) ? 5 : 2;
    case 'saboteur':
    case 'spy':
    case 'roadBuilding':
      return 5;
    case 'bishop':
      return robberActive(s) ? 5 : 3;
    case 'smith':
      return knightsOf(s, p).length > 0 ? 5 : 3;
    case 'warlord':
      return knightsOf(s, p).length >= 2 || o.steps <= 2 ? 5 : 2;
    case 'engineer':
      return wallSites(c).length > 0 ? 4 : 1;
    case 'deserter':
    case 'tradeMonopoly':
    case 'commercialHarbor':
      return 4;
    case 'inventor':
    case 'intrigue':
    case 'merchantFleet':
      return 3;
    case 'diplomat':
      return s.longestRoute.holder !== null ? 4 : 2;
    default:
      return 0;
  }
}

/** Estimated cards of kind `k` an opponent holds, from their production (hands are hidden). */
function guessHeld(c: Ctx, q: PlayerId, k: Card): number {
  const prod = lazy(c, `prod:${q}`, () => ckProduction(c.s, q));
  const commodity = isCommodity(k);
  const kinds = commodity ? COMMODITIES : RESOURCES;
  const total = sum(kinds.map((x) => prod[x]));
  const held = commodity ? commodityCount(c.s, q) : handSize(c.s, q) - commodityCount(c.s, q);
  if (total === 0) return held / kinds.length;
  return (held * prod[k]) / total;
}

/** Production for a roll of `yellow` + `red`, net of what it gives the others (the Alchemist). */
function rollValue(c: Ctx, yellow: number, red: number): number {
  const { s, p } = c;
  const total = yellow + red;
  const w = wants(c);
  if (total === 7) {
    const robbed = robberActive(s) ? 1.2 : 0;
    return robbed - (handCount(c) > c.limit ? Math.floor(handCount(c) / 2) : 0);
  }
  let mine = 0;
  let theirs = 0;
  let got = false;
  const t = topo(s);
  for (const [id, hex] of Object.entries(s.board.hexes)) {
    if (hex.token !== total || id === s.board.robber) continue;
    const r = TERRAIN_RESOURCE[hex.terrain];
    if (!r) continue;
    const com = TERRAIN_COMMODITY[hex.terrain];
    for (const v of t.hexVertices[id]) {
      const b = s.board.buildings[v];
      if (!b) continue;
      const city = b.type === 'city';
      if (b.owner === p) {
        got = true;
        mine += !city ? w[r] : com ? w[r] + w[com] : 2 * w[r];
      } else {
        theirs += (city ? 2 : 1) * (c.ck.cards === 2 ? weightOf(c, b.owner) * 0.4 : 0.3);
      }
    }
  }
  if (!got && s.ck!.players[p].improvements.science >= ABILITY_LEVEL) mine += Math.max(...RESOURCES.map((r) => w[r]));
  // a city gate shows up one roll in two: the red die decides who draws
  let draws = 0;
  for (const tr of TRACKS) {
    if (drawsOn(s.ck!.players[p].improvements[tr], red)) draws += 2.5 / 6;
    for (const q of opponents(s, p)) if (drawsOn(s.ck!.players[q].improvements[tr], red)) draws -= 1 / 6;
  }
  return mine - theirs + draws;
}

/** Before rolling: the Alchemist, when choosing the dice beats a roll by enough (never a 7). */
function alchemist(c: Ctx, acts: Action[]): Action | null {
  const { s, p } = c;
  const dice = (a: Play) => arg<[number, number]>(a, 'dice');
  const options = byType(acts, 'playProgress').filter((a) => a.card === 'alchemist' && dice(a)[0] + dice(a)[1] !== 7);
  if (options.length === 0) return null;
  if (c.ck.cards === 0) return pickBest(s, p, { ...c.pr, noise: 1 }, options, () => 0, (a) => String(dice(a)));
  let expected = 0;
  for (let y = 1; y <= 6; y++) for (let r = 1; r <= 6; r++) expected += rollValue(c, y, r) / 36;
  const value = (a: Play) => rollValue(c, dice(a)[0], dice(a)[1]);
  // (rollValue counts who draws progress cards on the red die; ties go to the lowest red die)
  const top = best(options, (a) => value(a) - dice(a)[1] * 0.001);
  if (!top) return null;
  const gain = value(top) - expected;
  // hard waits for a roll that matters: a big one, or one that completes what it saves for
  const goal = resourceGoal(c);
  const short = goal ? cardTotal(lack(c.hand, goal.cost)) : 0;
  const completes = short > 0 && short <= 2 && gain >= 1.5;
  const bar = c.ck.cards === 2 ? 3 : 1.8;
  return gain >= bar || (c.ck.cards === 2 && completes) || (c.gap <= 2 && gain > 1) ? top : null;
}

/** What swapping the numbers of hexes `a` and `b` gains the player, in pips (the Inventor). */
function swapGain(c: Ctx, a: HexId, b: HexId): number {
  const { s, p } = c;
  const weight = (h: HexId) => {
    let w = 0;
    for (const v of topo(s).hexVertices[h]) {
      const x = s.board.buildings[v];
      if (!x) continue;
      const n = x.type === 'city' ? 2 : 1;
      w += x.owner === p ? n : -n * (c.ck.cards === 2 ? 0.4 * weightOf(c, x.owner) : 0.5);
    }
    return w;
  };
  const pip = (h: HexId) => pips(s.board.hexes[h].token);
  return (pip(b) - pip(a)) * (weight(a) - weight(b));
}

/** Longest Road for `q` with the road on `e` added or (null) as it stands. */
function routeWith(s: GameState, p: PlayerId, add: EdgeId | null, remove: EdgeId | null): number {
  const pieces = { ...s.board.pieces };
  if (remove) delete pieces[remove];
  if (add) pieces[add] = { owner: p, type: 'road', placedPart: 0 };
  return longestRouteLength({ ...s, board: { ...s.board, pieces } }, p);
}

/** Who holds Longest Road after taking up the road on `remove` and building one for `p` on `add` (the engine's own rule). */
function holderAfter(s: GameState, p: PlayerId, remove: EdgeId | null, add: EdgeId | null): PlayerId | null {
  const pieces = { ...s.board.pieces };
  if (remove) delete pieces[remove];
  if (add) pieces[add] = { owner: p, type: 'road', placedPart: 0 };
  const copy: GameState = { ...s, board: { ...s.board, pieces }, longestRoute: { ...s.longestRoute }, log: [] };
  updateLongestRoute(copy);
  return copy.longestRoute.holder;
}

/**
 * The Diplomat: what removing the road on `e` gains, in cards. An opponent's
 * road: more if it shortens a leader's route, most if it costs them Longest
 * Road (or hands it to the player). Its own road: worth moving when the road
 * built again elsewhere wins Longest Road, or keeps it from a rival close
 * behind.
 */
function diplomatValue(c: Ctx, e: EdgeId): number {
  const { s, p } = c;
  const owner = s.board.pieces[e].owner;
  const holder = s.longestRoute.holder;
  if (owner === p) {
    const before = longestRouteLength(s, p);
    const threat = holder === p && Math.max(...opponents(s, p).map((q) => longestRouteLength(s, q))) >= before - 1;
    // one road moved adds at most one to the route
    if (!threat && (holder === p || before + 1 < Math.max(5, holder === null ? 5 : longestRouteLength(s, holder) + 1))) return -1;
    let top = -1;
    for (const x of legalRoads(s, p)) {
      if (x === e) continue;
      const v = holderAfter(s, p, e, x) === p && holder !== p ? 9 : routeWith(s, p, x, e) > before ? 1 : -1;
      top = Math.max(top, v);
    }
    return top === 1 && threat ? 3 : top;
  }
  const before = longestRouteLength(s, owner);
  const after = routeWith(s, owner, null, e);
  let v = (before - after) * 0.8 * weightOf(c, owner);
  const next = holderAfter(s, p, e, null);
  if (holder === owner && next !== owner) v += 6 * weightOf(c, owner);
  if (next === p && holder !== p) v += 6;
  return v;
}

/** Each progress card's worth if played now with these choices, in cards (null: not worth it). */
function playValue(c: Ctx, a: Play): number {
  const { s, p } = c;
  const ck = s.ck!;
  const o = c.out;
  const target = arg<number>(a, 'target');
  const w = wants(c);
  switch (a.card) {
    case 'irrigation':
    case 'mining': {
      const terrain = a.card === 'irrigation' ? 'fields' : 'mountains';
      const r: Resource = a.card === 'irrigation' ? 'grain' : 'ore';
      const mine = (h: HexId) => topo(s).hexVertices[h].some((v) => s.board.buildings[v]?.owner === p);
      const hexes = Object.keys(s.board.hexes).filter((h) => s.board.hexes[h].terrain === terrain && mine(h));
      const n = Math.min(2 * hexes.length, s.bank[r]);
      return n * w[r] - Math.max(0, handCount(c) + n - c.limit) * 0.3 - (c.ck.cards === 2 && n < 4 && w[r] < 2 ? 2 : 0);
    }
    case 'wedding': {
      let n = 0;
      for (const q of opponents(s, p)) {
        if (publicVP(s, q) > c.vp) n += Math.min(2, handSize(s, q)) * (c.ck.cards === 2 ? 0.8 + 0.2 * weightOf(c, q) : 1);
      }
      return n;
    }
    case 'medicine':
      return 3 + cityGain(s, p, arg<string>(a, 'vertex'), c.ck.commodities, c.prod) * 0.2;
    case 'engineer': {
      const v = arg<string>(a, 'vertex');
      return 2.5 + (isMetropolis(s, v) ? 1 : 0) + (handCount(c) > c.limit - 2 ? 1 : 0);
    }
    case 'roadBuilding': {
      // with Seafarers, roads or ships (Almanac p. 15)
      const edges = [...legalRoads(s, p).map((e) => ({ e, ship: false })), ...(c.sea ? legalShips(s, p).map((e) => ({ e, ship: true })) : [])];
      const top = best(edges, (x) => edgeValue(c, x.e, x.ship));
      const v = top ? edgeValue(c, top.e, top.ship) : 0;
      return v > c.pr.roadBar ? 2 + v * 0.3 : 0.5;
    }
    case 'smith': {
      const k = ck.knights[arg<string>(a, 'vertex')];
      const more = knightsOf(s, p).filter(([v, x]) => x !== k && v !== arg<string>(a, 'vertex')).length > 0 ? 1.5 : 0;
      return 2 + (k.active ? 1 : 0) + more + (defence(c).want > o.strength[p] ? 2 : 0);
    }
    case 'crane': {
      const main = mainTrack(c);
      return TRACKS.some((t) => {
        if (improvementError(s, p, t, true) !== null) return false;
        const k = TRACK_COMMODITY[t];
        const price = improvementPrice(s, p, t)[k] ?? 0;
        return c.hand[k] >= price - 1 && (c.ck.cards < 2 || t === main || price <= 2) && c.hand[k] < price + (c.ck.cards === 2 ? 0 : 99);
      })
        ? 3
        : 0;
    }
    case 'inventor': {
      const [x, y] = arg<[string, string]>(a, 'hexes');
      return swapGain(c, x, y) * 0.8;
    }
    case 'bishop': {
      // a robber move (scored where it lands) and a card from everyone next to it
      const here = s.board.robber ? robberHurts(c, s.board.robber) : 0;
      return 2 + (here > 0 ? 2 : 0);
    }
    case 'deserter': {
      // they give up their weakest knight; the player places one as strong
      const theirs = knightsOf(s, target).map(([, k]) => k.level + (k.active ? 0.5 : 0));
      const weakest = Math.min(...theirs);
      return 1.5 + weakest + (o.steps <= 3 ? weakest * 0.5 : 0) + (target === c.leader ? 0.5 : 0);
    }
    case 'diplomat':
      return diplomatValue(c, arg<string>(a, 'edge'));
    case 'intrigue': {
      const v = arg<string>(a, 'vertex');
      const k = ck.knights[v];
      const gone = retreatSpots(s, k.owner, v).length === 0;
      return (gone ? k.level * 2 : k.level * 0.5) + (pot(c).get(v) ?? 0) * 0.3 + (k.owner === c.leader ? 0.5 : 0);
    }
    case 'saboteur': {
      let n = 0;
      for (const q of opponents(s, p)) {
        if (publicVP(s, q) >= c.vp) n += Math.floor(handSize(s, q) / 2) * (c.ck.cards === 2 ? 0.5 * weightOf(c, q) : 0.6);
      }
      return n;
    }
    case 'spy': {
      const n = ck.players[target].progress.length;
      return 1 + Math.min(n, 4) * 0.6 + (target === c.leader ? 0.5 : 0);
    }
    case 'warlord': {
      const idle = o.idle[p];
      const d = defence(c);
      return d.want > o.strength[p] ? idle * 2 : o.steps <= 3 ? idle : idle * 0.5;
    }
    case 'commercialHarbor': {
      const partners = opponents(s, p).filter((q) => commodityCount(s, q) > 0).length;
      const spare = RESOURCES.filter((r) => c.hand[r] > 0).length;
      return spare > 0 ? Math.min(partners, handCount(c)) * 0.8 : 0;
    }
    case 'masterMerchant':
      return 2.5 + Math.min(handSize(s, target), 8) * 0.1 + (target === c.leader ? 0.5 : 0);
    case 'merchant': {
      const hex = arg<string>(a, 'hex');
      const mineNow = ck.merchant?.owner === p;
      const r = TERRAIN_RESOURCE[s.board.hexes[hex].terrain];
      const use = r ? (c.prod[r] / 6) * 0.5 + (c.hand[r] >= 2 ? 0.5 : 0) : 0;
      // the VP is what matters; hard keeps a second Merchant to win it back
      return mineNow ? (c.ck.cards === 2 ? -1 : use - 0.5) : 6 + use;
    }
    case 'merchantFleet': {
      const k = (arg<Card>(a, 'resource') ?? arg<Card>(a, 'commodity')) as Card;
      const goal = resourceGoal(c);
      const spare = c.hand[k] - (goal?.cost[k] ?? 0);
      return spare >= 4 && c.rates[k] > 2 ? Math.floor(spare / 2) - Math.floor(spare / c.rates[k]) + 0.5 : 0;
    }
    case 'resourceMonopoly': {
      const r = arg<Resource>(a, 'resource');
      const n = sum(opponents(s, p).map((q) => Math.min(2, guessHeld(c, q, r))));
      return n * w[r];
    }
    case 'tradeMonopoly': {
      const k = arg<Card>(a, 'commodity');
      const n = sum(opponents(s, p).map((q) => Math.min(1, guessHeld(c, q, k))));
      return n * w[k];
    }
    default:
      return 0;
  }
}

/** The least each card must be worth to play it now (hard waits for more), lower when the hand is over the limit. */
function playBar(c: Ctx, card: ProgressCardName): number {
  const held = c.s.ck!.players[c.p].progress.length;
  if (held > PROGRESS_HAND_LIMIT || c.gap <= 2) return 0.5;
  if (c.ck.cards === 1) return 1;
  // a full hand: a card drawn on someone else's turn would have to go
  if (held === PROGRESS_HAND_LIMIT) return 1;
  switch (card) {
    case 'resourceMonopoly':
      return 4;
    case 'saboteur':
    case 'masterMerchant':
      return 3;
    case 'irrigation':
    case 'mining':
    case 'inventor':
      return 2.5;
    case 'spy':
    case 'deserter':
    case 'intrigue':
    case 'warlord':
      return 2;
    default:
      return 1;
  }
}

/** A progress card worth playing now, or a Commercial Harbor offer. */
function cardPlay(c: Ctx, acts: Action[]): Action | null {
  const { s, p } = c;
  // Commercial Harbor: offer each opponent a spare resource for a commodity
  const offers = byType(acts, 'progressChoice');
  if (offers.length > 0) {
    if (c.ck.cards === 0) return offers[0];
    const w = wants(c);
    return best(offers, (a) => -w[arg<Resource>(a, 'resource')] + c.hand[arg<Resource>(a, 'resource')] * 0.1);
  }
  const plays = byType(acts, 'playProgress').filter((a) => a.card !== 'alchemist');
  if (plays.length === 0) return null;
  if (c.ck.cards === 0) {
    // easy: the first card it holds, with any choice
    const card = s.ck!.players[p].progress.find((x) => plays.some((a) => a.card === x))!;
    const options = plays.filter((a) => a.card === card);
    return pickBest(s, p, { ...c.pr, noise: 1 }, options, () => 0, (a) => JSON.stringify(a.args ?? null));
  }
  let top: Play | null = null;
  let margin = 0;
  for (const a of plays) {
    const v = playValue(c, a);
    const m = v - playBar(c, a.card);
    if (m >= 0 && (top === null || m > margin)) {
      top = a;
      margin = m;
    }
  }
  return top;
}

/** Over the hand limit: the least useful card goes. */
function progressDiscard(c: Ctx, acts: Action[]): Action | null {
  const options = byType(acts, 'discardProgress');
  if (options.length === 0) return null;
  if (c.ck.cards === 0) return pickBest(c.s, c.p, { ...c.pr, noise: 1 }, options, () => 0, (a) => a.card);
  return best(options, (a) => -keepValue(c, a.card));
}

/** Answers a progress card's choice ('card' step). */
function cardAnswer(c: Ctx, choices: Choice[]): Choice | null {
  const { s, p } = c;
  const ph = s.phase;
  if (ph.kind !== 'ck' || ph.step !== 'card' || choices.length === 0) return null;
  const skip = choices.find((x) => x.args === undefined) ?? null;
  const knights = s.ck!.knights;
  const vertex = (x: Choice) => arg<string>(x, 'vertex');
  switch (ph.stage) {
    case 'promote':
      return best(choices.filter((x) => x.args), (x) => (knights[vertex(x)].active ? 2 : 0) + knights[vertex(x)].level) ?? skip;
    case 'desert':
      // give up the weakest knight: an inactive one first, then the one doing least
      return best(choices, (x) => {
        const k = knights[vertex(x)];
        return -(k.level * 3 + (k.active ? 1.5 : 0) + knightSite(c, vertex(x)) * 0.1);
      });
    case 'place':
      return best(choices.filter((x) => x.args), (x) => knightSite(c, vertex(x))) ?? skip;
    case 'rebuild': {
      const data = ph.data as { edge: EdgeId };
      const value = (e: EdgeId) => routeWith(s, p, e, null) * 2 + edgeScore(s, p, e, pot(c)) * 0.1 - (e === data.edge ? 1 : 0);
      return best(choices.filter((x) => x.args), (x) => value(arg<string>(x, 'edge'))) ?? skip;
    }
    case 'discard':
    case 'give': {
      const n = ph.pending?.[p] ?? 0;
      const pick = c.ck.cards === 0 ? biggestPiles(c.hand, n) : cheapest(c, n);
      return choices.find((x) => sameCounts(arg<CardCounts>(x, 'cards'), pick)) ?? best(choices, (x) => -worth(c, arg<CardCounts>(x, 'cards')));
    }
    case 'take': {
      if (ph.card === 'spy') return best(choices.filter((x) => x.args), (x) => keepValue(c, arg<ProgressCardName>(x, 'card'))) ?? skip;
      return best(choices, (x) => worth(c, arg<CardCounts>(x, 'cards')));
    }
    case 'exchange': {
      const w = wants(c);
      return best(choices, (x) => -w[arg<Card>(x, 'commodity')]);
    }
    default:
      return choices[0];
  }
}

// ---------------------------------------------------------------------------
// Trades with other players
// ---------------------------------------------------------------------------

/** What taking another player's offer gains the player: it receives `give` and pays `get`. */
function gainOf(c: Ctx, t: TradeOffer): number {
  return worth(c, t.give) - worth(c, t.get);
}

/** An open offer answered card for card (as the base bot does, it asks for cards the proposer holds). */
function counterOffer(c: Ctx, t: TradeOffer): Action | null {
  const { s, p, pr } = c;
  const w = wants(c);
  const theirs = handOf(s, t.from);
  if (t.open === 'give') {
    const n = cardTotal(t.get);
    if (n === 0 || !covers(c.hand, t.get)) return null;
    const cost = worth(c, t.get);
    const ask: CardCounts = {};
    let value = 0;
    for (let k = 0; k < n + 1 + pr.counterExtra && value - cost <= pr.counterGain; k++) {
      const r = best(
        CARDS.filter((x) => !(t.get[x] ?? 0)),
        (x) => w[x] - (ask[x] ?? 0) * 0.4 + (theirs[x] > (ask[x] ?? 0) ? 0.5 : -2),
      );
      if (!r) break;
      ask[r] = (ask[r] ?? 0) + 1;
      value += w[r];
    }
    if (value - cost <= pr.counterGain || cardTotal(ask) === 0) return null;
    return { type: 'proposeTrade', player: p, give: { ...t.get }, get: ask, to: [t.from], replyTo: t.id };
  }
  const n = cardTotal(t.give);
  if (n === 0) return null;
  const value = worth(c, t.give);
  const pay = best(
    CARDS.filter((k) => !(t.give[k] ?? 0) && c.hand[k] >= n),
    (k) => -w[k] + c.hand[k] * 0.05,
  );
  if (!pay || value - w[pay] * n <= pr.counterGain) return null;
  return { type: 'proposeTrade', player: p, give: { [pay]: n }, get: { ...t.give }, to: [t.from], replyTo: t.id };
}

/** Another player's offer: take it, counter it, or turn it down. */
function respond(c: Ctx, acts: Action[]): Action | null {
  const { s, p, pr } = c;
  for (const t of s.turn.trades) {
    if (!t.to.includes(p) || t.accepted.includes(p) || t.rejected.includes(p)) continue;
    const accept = acts.find((a) => a.type === 'acceptTrade' && a.tradeId === t.id);
    const reject = acts.find((a) => a.type === 'rejectTrade' && a.tradeId === t.id);
    const close = nearWin(s, t.from, pr);
    if (t.open) {
      const counter = close ? null : counterOffer(c, t);
      if (counter && applyAction(s, counter).ok) return counter;
      if (reject) return reject;
      continue;
    }
    if (accept && gainOf(c, t) > pr.acceptGain && !close) return accept;
    if (reject) return reject;
  }
  return null;
}

/** The active player's own offers (settle them) and counter-offers to it; undefined: nothing to do, null: wait. */
function actorTrades(c: Ctx, acts: Action[]): Action | null | undefined {
  const { s, p, pr } = c;
  for (const t of s.turn.trades) {
    if (t.from !== p) continue;
    if (t.accepted.length > 0) {
      const partner = best(t.accepted, (q) => -publicVP(s, q))!;
      return { type: 'confirmTrade', player: p, tradeId: t.id, partner };
    }
    if (t.to.some((q) => !t.rejected.includes(q))) return null;
    return { type: 'cancelTrade', player: p, tradeId: t.id };
  }
  for (const t of s.turn.trades) {
    if (t.from === p || !t.to.includes(p)) continue;
    const accept = acts.find((a) => a.type === 'acceptTrade' && a.tradeId === t.id);
    if (accept && gainOf(c, t) > pr.acceptGain && !nearWin(s, t.from, pr)) return accept;
    return { type: 'rejectTrade', player: p, tradeId: t.id };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

/** A city wall: under a metropolis first (it is never pillaged), then under the best city (the last it would give up). */
function wallAction(c: Ctx, acts: Action[]): Action | null {
  const score = (v: VertexId) => (isMetropolis(c.s, v) ? 100 : 0) + ckSpotValue(c.s, c.p, v, c.ck.commodities, 'city', c.prod);
  return best(byType(acts, 'buildCityWall'), (a) => score(a.vertex));
}

/** Trades a large hand down (or walls a city) before a 7 can take half of it. */
function handGuard(c: Ctx, acts: Action[]): Action | null {
  const { s, p } = c;
  const n = handCount(c);
  if (n <= c.limit) return null;
  if (c.ck.walls) {
    const wall = wallAction(c, acts);
    if (wall) return wall;
  }
  const w = wants(c);
  const keep: Hand = zero();
  for (const g of [resourceGoal(c), commodityGoal(c)]) if (g) for (const k of CARDS) keep[k] = Math.max(keep[k], g.cost[k] ?? 0);
  const gain = (a: Extract<Action, { type: 'bankTrade' }>) => {
    const get = CARDS.find((k) => (a.get[k] ?? 0) > 0)!;
    const give = CARDS.find((k) => (a.give[k] ?? 0) > 0)!;
    if (c.hand[give] - (a.give[give] ?? 0) < keep[give]) return -Infinity;
    return w[get] - w[give] * (a.give[give] ?? 1) * 0.3;
  };
  const t = best(byType(acts, 'bankTrade'), gain);
  if (t && gain(t) > -0.5 && (c.pr.handGuard || gain(t) > 0)) return t;
  return null;
}

/** Spare cards at the end of a turn: a knight to guard its best hexes from the robber, knights woken early (hard). */
function spare(c: Ctx, acts: Action[]): Action | null {
  const { s, p } = c;
  const goal = resourceGoal(c);
  const free = (cost: CardCounts) => !goal || covers(subtract(c.hand, cost), goal.cost) || handCount(c) > c.limit;
  // robber guard (medium, hard): an active knight next to the player's best hexes once the robber moves
  if (c.ck.knights >= 1 && robberActive(s) && free(CK_COSTS.knight)) {
    const knights = knightsOf(s, p);
    if (knights.length < (c.ck.knights >= 2 ? 3 : 2)) {
      const site = best(byType(acts, 'buildKnight'), (a) => knightSite(c, a.vertex));
      if (site && knightSite(c, site.vertex) >= (c.ck.knights >= 2 ? 2 : 3)) return site;
    }
  }
  if (c.ck.knights >= 2 && c.out.steps <= 4 && free(CK_COSTS.activate)) {
    const wake = best(byType(acts, 'activateKnight'), (a) => s.ck!.knights[a.vertex].level);
    if (wake) return wake;
  }
  return null;
}

function subtract(have: Hand, cost: CardCounts): Hand {
  const out = { ...have };
  for (const k of CARDS) out[k] -= cost[k] ?? 0;
  for (const k of CARDS) if (out[k] < 0) out[k] = -99;
  return out;
}

/** The active player's move in the main phase. */
function mainTurn(c: Ctx, acts: Action[]): Action | null {
  const { s, p, pr } = c;
  const deal = actorTrades(c, acts);
  if (deal !== undefined) return deal;

  const knight = knightPlay(c, acts);
  if (knight) return knight;
  const card = cardPlay(c, acts);
  if (card) return card;

  // the barbarians: the next step when an attack is likely soon
  const d = defence(c);
  if (d.want > c.out.strength[p] && (d.urgent || d.worth >= 3)) {
    const step = defenceStep(c, acts);
    if (step) return step;
  }
  // a knight on the board ahead of the attack, while there is time to wake it
  // (a city it can build now comes first while the ship is 3 or more moves out)
  if (readyLack(c) > 0 && c.out.steps <= 4 && (c.out.steps <= 2 || !acts.some((a) => a.type === 'buildCity'))) {
    const hire = best(byType(acts, 'buildKnight'), (a) => knightSite(c, a.vertex));
    if (hire) return hire;
  }

  if (c.sea) {
    const wonder = wonderPlay(c, acts);
    if (wonder) return wonder;
  }

  const imp = improvement(c, acts);
  if (imp) return imp;

  const city = byType(acts, 'buildCity');
  if (city.length > 0) return pickBest(s, p, pr, city, (a) => cityGain(s, p, a.vertex, c.ck.commodities, c.prod), (a) => a.vertex);
  const settle = byType(acts, 'buildSettlement');
  if (settle.length > 0) return pickBest(s, p, pr, settle, (a) => ckSpotValue(s, p, a.vertex, c.ck.commodities, 'future', c.prod), (a) => a.vertex);

  const goal = resourceGoal(c);
  const cgoal = commodityGoal(c);
  if (goal) {
    if (covers(c.hand, goal.cost)) {
      if (goal.label === 'defence') {
        const step = defenceStep(c, acts);
        if (step) return step;
      } else if (goal.label === 'knight') {
        const hire = best(byType(acts, 'buildKnight'), (a) => knightSite(c, a.vertex));
        if (hire) return hire;
      } else if (goal.label === 'wall') {
        const wall = wallAction(c, acts);
        if (wall) return wall;
      } else if (applyAction(s, goal.action).ok) return goal.action;
    } else {
      const step = pursue(c, acts, goal, cgoal?.cost ?? {}, true);
      if (step) return step;
    }
  }
  // the improvement: trade spare cards into the commodity when that completes it
  if (cgoal && pr.plans && !covers(c.hand, cgoal.cost)) {
    const level = s.ck!.players[p].improvements[cgoal.track] + 1;
    const worthIt = level >= ABILITY_LEVEL || winsMetropolis(s, p, cgoal.track) || cardTotal(lack(c.hand, cgoal.cost)) <= 1;
    if (worthIt) {
      const step = pursue(c, acts, cgoal, goal?.cost ?? {}, false);
      if (step) return step;
    }
  }

  // spare cards: roads toward good spots, knights, walls
  const extra = spare(c, acts);
  if (extra) return extra;
  const free = (cost: CardCounts) => !goal || covers(subtract(c.hand, cost), goal.cost) || handCount(c) > c.limit;
  const edges: Array<Extract<Action, { type: 'buildRoad' | 'buildShip' }>> = c.sea
    ? [...byType(acts, 'buildRoad'), ...byType(acts, 'buildShip')]
    : byType(acts, 'buildRoad');
  const edge = pickBest(s, p, pr, edges, (a) => edgeValue(c, a.edge, a.type === 'buildShip'), (a) => a.edge);
  if (edge && edgeValue(c, edge.edge, edge.type === 'buildShip') > pr.roadBar && free(edge.type === 'buildShip' ? COSTS.ship : COSTS.road)) return edge;
  if (!pr.plans) {
    // easy: a knight when it has none, and more now and then, when it has the cards
    const hire = byType(acts, 'buildKnight');
    if (hire.length > 0 && (knightsOf(s, p).length === 0 || wobble(s, p, 'hire') < 0.25)) {
      return pickBest(s, p, pr, hire, (a) => knightSite(c, a.vertex), (a) => a.vertex);
    }
  }
  const guard = handGuard(c, acts);
  if (guard) return guard;
  const discard = progressDiscard(c, acts);
  if (discard) return discard;
  return acts.find((a) => a.type === 'endTurn') ?? null;
}

// ---------------------------------------------------------------------------
// Other phases
// ---------------------------------------------------------------------------

/** Discarding half on a 7: the cards it minds least (easy: from the biggest piles). */
function discard(c: Ctx): Action | null {
  const ph = c.s.phase;
  if (ph.kind !== 'discard') return null;
  const need = ph.pending[c.p];
  if (need === undefined) return null;
  return { type: 'discard', player: c.p, cards: c.ck.cards === 0 ? biggestPiles(c.hand, need) : cheapest(c, need) };
}

/** Where the robber goes: as the base bot (the leader's best hex, never its own), and for the Bishop where it robs most. */
function robber(c: Ctx, acts: Action[]): Action | null {
  const { s, p, pr } = c;
  const moves = byType(acts, 'moveRobber');
  const ph = s.phase;
  const bishop = ph.kind === 'robber' && ph.reason === 'bishop';
  const score = (a: Extract<Action, { type: 'moveRobber' }>) => {
    let v = robberScore(s, p, a, pr);
    if (bishop) {
      const victims = new Set<PlayerId>();
      for (const x of topo(s).hexVertices[a.hex]) {
        const b = s.board.buildings[x];
        if (b && b.owner !== p && handSize(s, b.owner) > 0) victims.add(b.owner);
      }
      for (const q of victims) v += 3 * weightOf(c, q);
    }
    return v;
  };
  return pickBest(s, p, pr, moves, score, (a) => `${a.hex}:${a.victim ?? ''}`) ?? acts[0];
}

/** Seafarers gold: the resources it wants most (never commodities). */
function goldPick(c: Ctx): Action | null {
  const ph = c.s.phase;
  if (ph.kind !== 'gold') return null;
  const owed = ph.pending[c.p];
  if (owed === undefined) return null;
  const n = Math.min(owed, total(c.s.bank));
  const w = wants(c);
  const bank = { ...c.s.bank };
  const have = { ...c.hand };
  const pick: PartialCounts = {};
  for (let i = 0; i < n; i++) {
    const r = best(
      RESOURCES.filter((x) => bank[x] > 0),
      (x) => w[x] - have[x] * 0.3,
    );
    if (!r) break;
    bank[r]--;
    have[r]++;
    pick[r] = (pick[r] ?? 0) + 1;
  }
  return { type: 'chooseGold', player: c.p, resources: pick };
}

/** Decisions in the expansion's own phases. */
function phaseAction(c: Ctx, acts: Action[]): Action | null {
  const { s, p } = c;
  const ph = s.phase;
  if (ph.kind !== 'ck') return acts[0] ?? null;
  switch (ph.step) {
    case 'pillage': {
      // lose a city without a wall, the poorest
      const walls = s.ck!.players[p].walls;
      const keep = (v: VertexId) =>
        (walls.includes(v) ? 10 : 0) + cityGain(s, p, v, c.ck.commodities, c.prod) + ckSpotValue(s, p, v, 0, 'settlement', c.prod) * 0.1;
      return best(byType(acts, 'pillageCity'), (a) => -keep(a.vertex)) ?? acts[0];
    }
    case 'defenderDraw': {
      const options = byType(acts, 'drawProgress');
      const imp = s.ck!.players[p].improvements;
      // hard: the trade deck (six Merchants), medium: its strongest track
      if (c.ck.cards === 2) return best(options, (a) => (a.deck === 'trade' ? 2 : a.deck === 'politics' ? 1 : 0) + imp[a.deck] * 0.1) ?? acts[0];
      return best(options, (a) => imp[a.deck]) ?? acts[0];
    }
    case 'aqueduct': {
      const w = wants(c);
      return best(byType(acts, 'aqueduct').filter((a) => a.resource !== undefined), (a) => w[a.resource!]) ?? acts[0];
    }
    case 'progressDiscard':
      return progressDiscard(c, acts) ?? acts[0];
    case 'retreat':
      return best(byType(acts, 'retreatKnight'), (a) => knightSite(c, a.to)) ?? acts[0];
    case 'card':
      return cardAnswer(c, byType(acts, 'progressChoice')) ?? acts[0];
    default:
      return acts[0];
  }
}

/**
 * The heuristic bot's move in a Cities & Knights game (heuristicAction
 * calls this whenever the game has the expansion).
 */
export function ckHeuristicAction(s: GameState, p: PlayerId, acts: Action[], pr: Profile): Action | null {
  const c = context(s, p, pr);
  const ph = s.phase;
  switch (ph.kind) {
    case 'setup':
      return setupAction(c, acts);
    case 'discard':
      return discard(c);
    case 'ck':
      return phaseAction(c, acts);
    case 'robber':
      return robber(c, acts);
    case 'gold':
      return goldPick(c) ?? acts[0];
    case 'roadBuilding': {
      const edges = [...byType(acts, 'buildRoad'), ...byType(acts, 'buildShip')];
      const e = best(edges, (a) => edgeValue(c, a.edge, a.type === 'buildShip') + routeWith(s, p, a.edge, null) * 0.05);
      return e ?? acts.find((a) => a.type === 'endRoadBuilding') ?? acts[0];
    }
    case 'preRoll':
      return alchemist(c, acts) ?? acts.find((a) => a.type === 'rollDice') ?? acts[0];
    case 'main':
      if (s.turn.actor !== p) return respond(c, acts);
      return mainTurn(c, acts);
    case 'specialBuild':
      // C&K 5-6 (2020): build, hire, wall, improve, activate and promote as on its own turn; no trades, knight moves or cards
      return mainTurn(c, acts) ?? acts.find((a) => a.type === 'endTurn') ?? acts[0];
    default:
      return acts[0];
  }
}

