import { COSTS, RESOURCES, TERRAIN_RESOURCE, pips } from '../core/constants.js';
import { hasAtLeast, total } from '../core/resources.js';
import type {
  Action,
  EdgeId,
  GameState,
  HexId,
  PartialCounts,
  PlayerId,
  Resource,
  ResourceCounts,
  TradeOffer,
  VertexId,
} from '../core/types.js';
import { applyAction, setupOrder } from '../engine/apply.js';
import { legalActions, playersToAct } from '../engine/legal.js';
import { legalCities, legalSettlements, legalSetupSettlements } from '../engine/placements.js';
import { handSize, publicVP, topo, totalVP, tradeRates, vertexLandHexes, vertexZones } from '../rules/queries.js';
import { scenarioOf } from '../scenarios/registry.js';
import { ckHeuristicAction, type CkProfile } from './ckBot.js';
import { edgeKinds, openSpot, planExpansion, routeValue, type EdgeOption, type Expansion } from './expansion.js';

/**
 * A rule-of-thumb bot. It never looks at hidden information it could not see
 * at the table (other hands, the deck, the fog stack); it only uses public
 * state and its own hand.
 *
 * - Settlement spots are scored by pips, resources it lacks, harbors and
 *   island bonuses (and, in the Pirate Islands, the pirate fleet's reach). Roads and ships are planned toward spots and scenario
 *   goals that are still legal and reachable, re-checked at every decision
 *   (src/bots/expansion.ts): a road that leads nowhere is never built, and a
 *   spot an opponent will reach first counts for less.
 * - Each turn it picks a target (city, settlement, road/ship toward a spot,
 *   wonder level, development card), builds it if it can and otherwise
 *   trades with the bank only when that completes the target right away.
 *   Medium and hard look for the best set of settlements and cities they can
 *   complete this turn, trades included; hard also plans its opening
 *   placements in pairs.
 * - The robber goes where it hurts the leader most, never on its own hexes
 *   or where it hurts nobody while another hex hurts an opponent.
 * - It answers domestic offers by comparing what it needs, and never takes
 *   or makes a trade that leaves it further from its next build.
 * - Cities & Knights games have a strategy of their own (src/bots/ckBot.ts),
 *   tuned by the profile's `ck` settings.
 */

type Kind = Action['type'];

/** How well a computer player plays. */
export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

export interface Profile {
  /** Mistakes when choosing spots and robber targets: 0 always takes the best. */
  noise: number;
  /** Saves up for a goal and trades with the bank and harbors to reach it. */
  plans: boolean;
  /** Roads and ships: the least a target (its value after distance and race) must be worth to build toward it. */
  roadBar: number;
  /** Weighs the race for a spot: one an opponent reaches sooner counts for less. */
  race: boolean;
  /** Looks for the best set of settlements and cities it can complete this turn, bank trades included. */
  planner: boolean;
  /** Looks further: its opening placements in pairs, Year of Plenty and Monopoly by what they complete or take, a much better spot a road away first. */
  lookahead: boolean;
  /** How hard the robber goes after whoever is ahead (0: anyone). */
  robberFocus: number;
  /** Plays development cards with a purpose (easy only plays a knight to free its own hex). */
  devCards: boolean;
  /** Takes another player's offer when it gains more than this (negative: happily loses a bit). */
  acceptGain: number;
  /** Won't trade with anyone this close to winning (VP short of the target); -1 never checks. */
  leaderGuard: number;
  /** Makes a counter-offer to an open offer when it gains more than this. */
  counterGain: number;
  /** Cards it may ask for beyond the ones it gives, in a counter-offer. */
  counterExtra: number;
  /** Trade offers it makes to other players per turn, when a card or two short of its goal. */
  offersPerTurn: number;
  /** With more than 7 cards at the end of its turn, trades a pile it can't use for a card it needs, so a 7 costs less. */
  handGuard: boolean;
  /** How far down its list of goals a development card comes (lower: buys more of them). */
  devRank: number;
  /** Cities & Knights (src/bots/ckBot.ts). */
  ck: CkProfile;
}

const PROFILES: Record<BotLevel, Profile> = {
  easy: {
    noise: 0.8,
    plans: false,
    roadBar: 2,
    race: false,
    planner: false,
    lookahead: false,
    robberFocus: 0,
    devCards: false,
    acceptGain: -0.6,
    leaderGuard: -1,
    counterGain: -0.3,
    counterExtra: 0,
    offersPerTurn: 0,
    handGuard: false,
    devRank: 2.5,
    ck: { barbarians: 0, commodities: 0, tracks: 0, cards: 0, knights: 0, walls: false, sea: 0 },
  },
  medium: {
    noise: 0.4,
    plans: true,
    roadBar: 3,
    race: true,
    planner: true,
    lookahead: false,
    robberFocus: 1,
    devCards: true,
    acceptGain: 0.4,
    leaderGuard: 2,
    counterGain: 0.3,
    counterExtra: 0,
    offersPerTurn: 1,
    handGuard: false,
    devRank: 2.5,
    ck: { barbarians: 1, commodities: 0.8, tracks: 1, cards: 1, knights: 1, walls: true, sea: 1 },
  },
  hard: {
    noise: 0,
    plans: true,
    roadBar: 3,
    race: true,
    planner: true,
    lookahead: true,
    robberFocus: 3,
    devCards: true,
    acceptGain: 0.7,
    leaderGuard: 3,
    counterGain: 1,
    counterExtra: 1,
    offersPerTurn: 2,
    handGuard: true,
    devRank: 2.5,
    ck: { barbarians: 2, commodities: 1.2, tracks: 2, cards: 2, knights: 2, walls: true, sea: 2 },
  },
};

export function botProfile(level: BotLevel): Readonly<Profile> {
  return PROFILES[level] ?? PROFILES.medium;
}

/**
 * A number in [0, 1) that depends on the game position, the player and a key:
 * lets an easy bot make "random" mistakes while simulations stay repeatable.
 */
export function wobble(s: GameState, p: PlayerId, key: string): number {
  let h = (2166136261 ^ Math.imul(s.log.length + 1, 2654435761) ^ Math.imul(p + 1, 40503) ^ Math.imul(s.turn.part + 1, 69069)) >>> 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Like best(), but with the profile's noise added to every score. */
export function pickBest<T>(s: GameState, p: PlayerId, pr: Profile, items: T[], score: (x: T) => number, key: (x: T) => string): T | null {
  if (pr.noise <= 0 || items.length < 2) return best(items, score);
  const scored = items.map((x) => ({ x, v: score(x) }));
  const vs = scored.map((o) => o.v);
  const spread = Math.max(...vs) - Math.min(...vs) || 1;
  return best(scored, (o) => o.v + pr.noise * spread * (wobble(s, p, key(o.x)) - 0.5))?.x ?? null;
}

/** Won't trade with someone this close to winning. */
export function nearWin(s: GameState, q: PlayerId, pr: Profile): boolean {
  return pr.leaderGuard >= 0 && publicVP(s, q) >= s.victoryTarget - pr.leaderGuard;
}

/** Expected pips per resource from the player's buildings (gold spread over all five). */
export function production(s: GameState, p: PlayerId): Record<Resource, number> {
  const out: Record<Resource, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  const t = topo(s);
  for (const [v, b] of Object.entries(s.board.buildings)) {
    if (b.owner !== p) continue;
    const mult = b.type === 'city' ? 2 : 1;
    for (const h of t.vertexHexes[v]) {
      if (h === s.board.robber) continue;
      const hex = s.board.hexes[h];
      const n = pips(hex.token) * mult;
      const r = TERRAIN_RESOURCE[hex.terrain];
      if (r) out[r] += n;
      else if (hex.terrain === 'gold') for (const x of RESOURCES) out[x] += n / 5;
    }
  }
  return out;
}

function hexValue(s: GameState, h: HexId, prod: Record<Resource, number>): number {
  const hex = s.board.hexes[h];
  if (hex.terrain === 'fog') return 1.5;
  const n = pips(hex.token);
  if (n === 0) return 0;
  const r = TERRAIN_RESOURCE[hex.terrain];
  if (!r) return hex.terrain === 'gold' ? n * 1.25 : 0;
  // Resources the player does not produce yet are worth more.
  return n * (prod[r] === 0 ? 1.5 : prod[r] < 4 ? 1.15 : 1);
}

/** Value of a settlement at `v` for player `p`. */
export function spotValue(s: GameState, p: PlayerId, v: VertexId, prod = production(s, p)): number {
  const hexes = vertexLandHexes(s, v);
  let value = 0;
  const kinds = new Set<string>();
  for (const h of hexes) {
    value += hexValue(s, h, prod);
    kinds.add(s.board.hexes[h].terrain);
  }
  value += kinds.size * 0.6;
  const t = topo(s);
  for (const hb of s.board.harbors) {
    if (!t.edgeVertices[hb.edge].includes(v)) continue;
    if (hb.type === 'generic') value += 1;
    else value += prod[hb.type] >= 5 ? 2.5 : 0.8;
  }
  // Pirate Islands: the pirate fleet attacks every building next to its circuit, most rolls costing a card or more
  const fleet = s.ext.pirateIslands as { circuit: HexId[] } | undefined;
  if (fleet) for (const h of t.vertexHexes[v]) if (fleet.circuit.includes(h)) value -= 5;
  const bonus = scenarioOf(s).rules.islandBonus;
  if (bonus) {
    const pl = s.players[p];
    const home = bonus.home === 'setup' ? pl.homeZones : bonus.home;
    const inSetup = s.phase.kind === 'setup';
    for (const z of vertexZones(s, v)) {
      if (!inSetup && !home.includes(z) && !pl.bonusZones.includes(z)) value += bonus.vp * 4;
    }
  }
  return value;
}

/** What upgrading the settlement at `v` adds: its hexes once more. */
function cityGain(s: GameState, v: VertexId, prod: Record<Resource, number>): number {
  let gain = 0;
  for (const h of vertexLandHexes(s, v)) if (h !== s.board.robber) gain += hexValue(s, h, prod);
  return gain;
}

/** Scenario targets that roads and ships should head for, with a value: Cloth villages, tribe gifts, the fortress, fog to explore. */
export function scenarioTargets(s: GameState, p: PlayerId): Map<VertexId, number> {
  const out = new Map<VertexId, number>();
  const t = topo(s);
  const cloth = s.ext.cloth as { villages: Record<VertexId, { cloth: number; traders: number[] }> } | undefined;
  if (cloth) {
    for (const [v, village] of Object.entries(cloth.villages)) {
      if (village.cloth > 0 && !village.traders.includes(p)) out.set(v, 9);
    }
  }
  const tribe = s.ext.tribe as { gifts: Record<EdgeId, string> } | undefined;
  if (tribe) {
    for (const [e, g] of Object.entries(tribe.gifts)) {
      for (const v of t.edgeVertices[e]) out.set(v, Math.max(out.get(v) ?? 0, g === 'vp' ? 7 : 5));
    }
  }
  const pirate = s.ext.pirateIslands as { fortresses: Array<{ vertex: VertexId; waypoint: VertexId; captured: boolean }> } | undefined;
  if (pirate) {
    const f = pirate.fortresses[p];
    if (f && !f.captured) {
      out.set(f.waypoint, 10);
      out.set(f.vertex, 12);
    }
  }
  // fog: the first piece next to it explores it (a card, and maybe new land)
  for (const [h, hex] of Object.entries(s.board.hexes)) {
    if (hex.terrain !== 'fog') continue;
    for (const v of t.hexVertices[h]) out.set(v, Math.max(out.get(v) ?? 0, 4));
  }
  return out;
}

/** The player's expansion as it stands (see src/bots/expansion.ts). */
export function expansionOf(s: GameState, p: PlayerId, pr: Profile, prod = production(s, p)): Expansion {
  return planExpansion(s, p, {
    value: (v) => spotValue(s, p, v, prod),
    goals: scenarioTargets(s, p),
    race: pr.race,
    kinds: edgeKinds(s),
  });
}

/**
 * How attractive each intersection is as a place to extend toward: settlement
 * spots and scenario targets, decaying with the number of paths to them.
 * Nothing spreads into or through another player's building or knight, and
 * `through` limits the paths it spreads along. (The C&K bot uses it to judge
 * where knights stand in an opponent's way; roads and ships use the planner.)
 */
export function potentialField(s: GameState, p: PlayerId, through?: (e: EdgeId) => boolean): Map<VertexId, number> {
  const t = topo(s);
  const prod = production(s, p);
  const pot = new Map<VertexId, number>();
  const blocked = (v: VertexId) => {
    const b = s.board.buildings[v];
    const k = s.ck?.knights[v];
    return (!!b && b.owner !== p) || (!!k && k.owner !== p);
  };
  for (const v of t.vertexIds) {
    if (openSpot(s, p, v)) pot.set(v, spotValue(s, p, v, prod));
  }
  for (const [v, val] of scenarioTargets(s, p)) if (!blocked(v)) pot.set(v, Math.max(pot.get(v) ?? 0, val));
  const passable = (e: EdgeId) => {
    if (through && !through(e)) return false;
    const piece = s.board.pieces[e];
    return !piece || piece.owner === p;
  };
  for (let round = 0; round < 8; round++) {
    let changed = false;
    for (const e of t.edgeIds) {
      if (!passable(e)) continue;
      const [a, b] = t.edgeVertices[e];
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const) {
        if (blocked(x) || blocked(y)) continue;
        const val = (pot.get(x) ?? 0) * 0.7;
        if (val > (pot.get(y) ?? 0) + 1e-9) {
          pot.set(y, val);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return pot;
}

/** Pirate Islands: the player's fortress still stands. */
function routeToFortressOpen(s: GameState, p: PlayerId): boolean {
  const pirate = s.ext.pirateIslands as { fortresses: Array<{ captured: boolean }> } | undefined;
  return !!pirate && !pirate.fortresses[p]?.captured;
}

function missing(have: ResourceCounts, cost: PartialCounts): PartialCounts {
  const out: PartialCounts = {};
  for (const r of RESOURCES) {
    const m = (cost[r] ?? 0) - have[r];
    if (m > 0) out[r] = m;
  }
  return out;
}

function addCost(...costs: PartialCounts[]): PartialCounts {
  const out: PartialCounts = {};
  for (const c of costs) for (const r of RESOURCES) if (c[r]) out[r] = (out[r] ?? 0) + c[r]!;
  return out;
}

type TradeStep = { give: Resource; rate: number; get: Resource };

/** Bank trades that turn surplus into the missing cards; null if the surplus is not enough. */
function tradePlan(s: GameState, p: PlayerId, cost: PartialCounts, have = s.players[p].resources): TradeStep[] | null {
  const hand = { ...have };
  const need = missing(hand, cost);
  if (total(need) === 0) return [];
  const rates = tradeRates(s, p);
  const plan: TradeStep[] = [];
  const bank = { ...s.bank };
  for (const r of RESOURCES) {
    for (let i = 0; i < (need[r] ?? 0); i++) {
      if (bank[r] <= 0) return null;
      // cheapest surplus first
      const giveOptions = RESOURCES.filter((g) => g !== r && hand[g] - (cost[g] ?? 0) >= rates[g]).sort(
        (x, y) => rates[x] - rates[y] || hand[y] - hand[x],
      );
      const g = giveOptions[0];
      if (!g) return null;
      hand[g] -= rates[g];
      hand[r] += 1;
      bank[r] -= 1;
      bank[g] += rates[g];
      plan.push({ give: g, rate: rates[g], get: r });
    }
  }
  return plan;
}

function byType<T extends Kind>(acts: Action[], type: T): Array<Extract<Action, { type: T }>> {
  return acts.filter((a): a is Extract<Action, { type: T }> => a.type === type);
}

export function best<T>(items: T[], score: (x: T) => number): T | null {
  let out: T | null = null;
  let top = -Infinity;
  for (const x of items) {
    const v = score(x);
    if (v > top) {
      top = v;
      out = x;
    }
  }
  return out;
}

export function leaderWeight(s: GameState, p: PlayerId, focus = 1, me?: PlayerId): number {
  const vp = publicVP(s, p);
  let w = 1 + (vp / Math.max(1, s.victoryTarget)) * 2 * focus;
  // a focused robber goes after whoever leads the others
  if (focus > 1 && me !== undefined && s.players.every((o) => o.id === me || o.id === p || publicVP(s, o.id) <= vp)) w *= 1.5;
  return w;
}

/** What a robber (or pirate) move does: the player's own pieces next to it, and the opponents'. */
export function robberEffect(s: GameState, p: PlayerId, a: Extract<Action, { type: 'moveRobber' }>): { own: number; hurt: number } {
  const t = topo(s);
  let own = 0;
  let hurt = 0;
  if (a.piece === 'robber') {
    for (const v of t.hexVertices[a.hex]) {
      const b = s.board.buildings[v];
      if (b) b.owner === p ? own++ : hurt++;
    }
  } else {
    for (const e of t.hexEdges[a.hex]) {
      const x = s.board.pieces[e];
      if (x?.type === 'ship') x.owner === p ? own++ : hurt++;
    }
  }
  return { own, hurt };
}

/**
 * The robber moves worth considering: away from the player's own pieces and
 * onto an opponent's, whenever such a hex exists (even the easy level never
 * robs itself or nobody by choice).
 */
export function sensibleRobberMoves<T extends Extract<Action, { type: 'moveRobber' }>>(s: GameState, p: PlayerId, moves: T[]): T[] {
  const good = moves.filter((a) => {
    const e = robberEffect(s, p, a);
    return e.own === 0 && e.hurt > 0;
  });
  return good.length > 0 ? good : moves;
}

/** What the robber on `hex` does to the players next to it, as `p` sees it: their pips times how much it minds hurting them, its own pips three times over. */
function robberHexValue(s: GameState, p: PlayerId, hex: HexId | null, pr: Profile): number {
  if (hex === null || !s.board.hexes[hex]) return 0;
  const n = pips(s.board.hexes[hex].token);
  let score = 0;
  for (const v of topo(s).hexVertices[hex]) {
    const b = s.board.buildings[v];
    if (!b) continue;
    const w = (b.type === 'city' ? 2 : 1) * n;
    score += b.owner === p ? -3 * w : w * leaderWeight(s, b.owner, pr.robberFocus, p);
  }
  return score;
}

/** Each player's expansion (roads and ships toward the spots and goals they can reach), per state: the pirate's targets. */
const expansionCache = new WeakMap<GameState, Map<PlayerId, Expansion>>();

function expansionFor(s: GameState, q: PlayerId): Expansion {
  let m = expansionCache.get(s);
  if (!m) expansionCache.set(s, (m = new Map()));
  let x = m.get(q);
  if (!x) m.set(q, (x = expansionOf(s, q, PROFILES.hard)));
  return x;
}

/**
 * What the pirate on `hex` does, as `p` sees it: the ships next to it can't
 * move (and their owners can be robbed), and no ship can be built next to
 * it, so a player whose best way on is by ship along it loses that (medium
 * and hard weigh how much: what its best road or ship elsewhere is worth
 * less). Ships of `p`'s own count against it.
 */
function pirateHexValue(s: GameState, p: PlayerId, hex: HexId | null, pr: Profile, blocking = true): number {
  if (hex === null || !s.board.hexes[hex]) return 0;
  const t = topo(s);
  let score = 0;
  const owners = new Set<PlayerId>();
  for (const e of t.hexEdges[hex]) {
    const x = s.board.pieces[e];
    if (x?.type !== 'ship') continue;
    owners.add(x.owner);
    score += x.owner === p ? -2 : leaderWeight(s, x.owner, pr.robberFocus, p);
  }
  if (!blocking || pr.robberFocus <= 0) return score;
  // the pirate stops ships next to it: what that takes from each player whose ships are there
  for (const q of owners) {
    let all = 0;
    let free = 0;
    for (const o of expansionFor(s, q).options) {
      if (o.gain <= 0) continue;
      all = Math.max(all, o.gain);
      if (!(o.kind === 'ship' && t.edgeHexes[o.edge].includes(hex))) free = Math.max(free, o.gain);
    }
    const lost = (all - free) * 0.6;
    score += q === p ? -lost : lost * leaderWeight(s, q, pr.robberFocus, p);
  }
  return score;
}

/**
 * What moving the robber (or the pirate) gains: what it does where it lands
 * less what it stops doing where it stands (a robber already on the
 * leader's best hex is often better left there, with the pirate moved
 * instead), plus the card taken from the victim.
 */
export function robberScore(s: GameState, p: PlayerId, a: Extract<Action, { type: 'moveRobber' }>, pr: Profile = PROFILES.medium): number {
  let score =
    a.piece === 'robber'
      ? robberHexValue(s, p, a.hex, pr) - robberHexValue(s, p, s.board.robber, pr)
      : pirateHexValue(s, p, a.hex, pr) - pirateHexValue(s, p, s.board.pirate, pr, false);
  if (a.victim !== undefined) score += handSize(s, a.victim) * 0.6 + publicVP(s, a.victim) * 0.4 * pr.robberFocus;
  if (a.take === 'cloth') score += 1.5;
  return score;
}

/** How much the player wants each resource right now. */
function resourceWants(s: GameState, p: PlayerId, target: PartialCounts | null): Record<Resource, number> {
  const have = s.players[p].resources;
  const prod = production(s, p);
  const out = {} as Record<Resource, number>;
  for (const r of RESOURCES) {
    let w = 1;
    if (target && (target[r] ?? 0) > have[r]) w += 2;
    if (prod[r] === 0) w += 0.5;
    if (have[r] >= 4) w -= 0.6;
    out[r] = w;
  }
  return out;
}

/**
 * What the player could build next: a city, a settlement (where a spot is
 * legal or a road leads to one), a development card, a road or ship that
 * leads somewhere.
 */
function buildNeeds(s: GameState, p: PlayerId, x: Expansion | null): PartialCounts[] {
  const out: PartialCounts[] = [];
  if (legalCities(s, p).length > 0) out.push(COSTS.city);
  if (s.players[p].supply.settlements > 0 && (legalSettlements(s, p).length > 0 || !!x?.best)) out.push(COSTS.settlement);
  if (!s.ck && s.devDeck.length > 0) out.push(COSTS.devCard);
  if (x && s.players[p].supply.settlements > 0) {
    if (x.options.some((o) => o.kind === 'road' && o.gain > 0)) out.push(COSTS.road);
    if (x.options.some((o) => o.kind === 'ship' && o.gain > 0)) out.push(COSTS.ship);
  }
  return out;
}

/**
 * A trade is never worth it when nothing speaks for it: no build it could
 * make gets any closer, and it costs cards or sets one of them back.
 */
export function keepsProgress(have: ResourceCounts, after: ResourceCounts, needs: PartialCounts[]): boolean {
  let worse = false;
  for (const c of needs) {
    const d = total(missing(have, c)) - total(missing(after, c));
    if (d > 0) return true;
    if (d < 0) worse = true;
  }
  return !(worse || total(after) < total(have));
}

function tradeOk(s: GameState, p: PlayerId, give: PartialCounts, get: PartialCounts, x: Expansion | null): boolean {
  const have = s.players[p].resources;
  const after = { ...have };
  for (const r of RESOURCES) after[r] += (get[r] ?? 0) - (give[r] ?? 0);
  if (RESOURCES.some((r) => after[r] < 0)) return false;
  return keepsProgress(have, after, buildNeeds(s, p, x));
}

interface Plan {
  cost: PartialCounts;
  /** The action that builds the target. */
  action: Action;
}

/**
 * Picks what the player is saving for: a settlement at its best spot when
 * one is legal (hard: unless a much better spot is a road away), then
 * whichever of city, road/ship toward the best reachable spot, a road for
 * Longest Road, or development card is fewest cards away. A claimed wonder
 * always comes first.
 */
function choosePlan(s: GameState, p: PlayerId, x: Expansion, pr: Profile = PROFILES.medium): Plan | null {
  const pl = s.players[p];
  const wc = wonderCost(s, p);
  if (wc) return { cost: wc, action: { type: 'scenario', player: p, name: 'buildWonder' } };
  const prod = production(s, p);
  const spots = legalSettlements(s, p);
  if (spots.length > 0) {
    const v = best(spots, (y) => spotValue(s, p, y, prod))!;
    const far = x.best && x.best.toward && x.targets.find((t) => t.vertex === x.best!.toward && t.spot);
    // a much better spot a road away is worth the road first (hard)
    if (!(pr.lookahead && far && far.score > spotValue(s, p, v, prod) * 1.5 && far.dist <= 1)) {
      return { cost: COSTS.settlement, action: { type: 'buildSettlement', player: p, vertex: v } };
    }
  }
  const options: Array<Plan & { rank: number }> = [];
  const cities = legalCities(s, p);
  if (cities.length > 0) {
    const v = best(cities, (y) => cityGain(s, y, prod))!;
    options.push({ cost: COSTS.city, action: { type: 'buildCity', player: p, vertex: v }, rank: 0 });
  }
  // Pirate Islands: every legal ship is a step of the route to the fortress.
  const routeShip = routeToFortressOpen(s, p) ? x.options.find((o) => o.kind === 'ship') : undefined;
  if (routeShip) {
    options.push({ cost: COSTS.ship, action: { type: 'buildShip', player: p, edge: routeShip.edge }, rank: 0.5 });
  } else if (x.best && x.best.gain >= pr.roadBar * 0.5) {
    options.push({ cost: edgeCost(x.best), action: edgeAction(p, x.best), rank: 1 });
  }
  // Longest Road (or Trade Route) within two pieces, or held with a rival close behind
  const lr = routeEdge(s, p, x);
  if (lr && lr.value >= 0.6) options.push({ cost: edgeCost(lr.option), action: edgeAction(p, lr.option), rank: lr.value >= 2 ? 0 : 1.2 });
  if (s.devDeck.length > 0) options.push({ cost: COSTS.devCard, action: { type: 'buyDevCard', player: p }, rank: pr.devRank });
  const have = pl.resources;
  return best(options, (o) => -(total(missing(have, o.cost)) + o.rank * 0.4));
}

/** The road or ship that does most for Longest Road (with its value in VP, see routeValue), if any does. */
function routeEdge(s: GameState, p: PlayerId, x: Expansion): { option: EdgeOption; value: number } | null {
  let top: { option: EdgeOption; value: number } | null = null;
  for (const o of x.options) {
    const v = routeValue(s, p, o.edge, o.kind);
    if (v > 0 && (!top || v + o.gain * 0.01 > top.value + top.option.gain * 0.01)) top = { option: o, value: v };
  }
  return top;
}

const edgeCost = (o: EdgeOption): PartialCounts => (o.kind === 'ship' ? COSTS.ship : COSTS.road);
const edgeAction = (p: PlayerId, o: EdgeOption): Action => ({ type: o.kind === 'ship' ? 'buildShip' : 'buildRoad', player: p, edge: o.edge });

function setupAction(s: GameState, p: PlayerId, acts: Action[], pr: Profile): Action | null {
  const settle = byType(acts, 'placeSettlement');
  if (settle.length > 0) {
    const prod = production(s, p);
    if (pr.lookahead) {
      const ahead = setupLookahead(s, p, settle.map((a) => a.vertex), (st, q) => {
        const pq = production(st, q);
        return (v) => spotValue(st, q, v, pq);
      });
      if (ahead) return settle.find((a) => a.vertex === ahead) ?? null;
    }
    return pickBest(s, p, pr, settle, (a) => spotValue(s, p, a.vertex, prod), (a) => a.vertex);
  }
  const x = expansionOf(s, p, pr);
  const edges = [...byType(acts, 'placeRoad'), ...byType(acts, 'placeShip')];
  const gain = (a: (typeof edges)[number]) => x.byEdge.get(`${a.type === 'placeShip' ? 'ship' : 'road'}:${a.edge}`)?.gain ?? 0;
  return best(edges, (a) => gain(a) + (a.type === 'placeRoad' ? 0.1 : 0));
}

/**
 * Hard's opening: each of the best few spots is scored together with the
 * spot it would likely get on its next placement, after the others between
 * now and then take theirs (each the best spot for them, as they see it).
 * Null when this is its last starting placement (then the best spot is the
 * best spot). `valueFor(state, player)` scores spots for that player.
 */
export function setupLookahead(
  s: GameState,
  p: PlayerId,
  spots: VertexId[],
  valueFor: (st: GameState, q: PlayerId) => (v: VertexId) => number,
  candidates = 6,
): VertexId | null {
  const ph = s.phase;
  if (ph.kind !== 'setup') return null;
  const rounds = scenarioOf(s).rules.setupRounds.length;
  // the placements between this one and the player's next one
  const between: PlayerId[] = [];
  let mine = false;
  for (let r = ph.round; r < rounds && !mine; r++) {
    const order = setupOrder(s, r);
    for (let i = r === ph.round ? ph.index + 1 : 0; i < order.length; i++) {
      if (order[i] === p) {
        mine = true;
        break;
      }
      between.push(order[i]);
    }
  }
  if (!mine) return null;
  const t = topo(s);
  // where each player may place now; a pick then rules out its spot and the neighbours
  const legal = new Map<PlayerId, VertexId[]>();
  const legalOf = (q: PlayerId) => {
    let l = legal.get(q);
    if (!l) legal.set(q, (l = legalSetupSettlements(s, q)));
    return l;
  };
  const mineNow = valueFor(s, p);
  const ranked = spots.map((v) => ({ v, value: mineNow(v) })).sort((a, b) => b.value - a.value);
  let top: VertexId | null = null;
  let topScore = -Infinity;
  for (const { v, value: first } of ranked.slice(0, s.players.length >= 5 ? 4 : candidates)) {
    const sim: GameState = { ...s, board: { ...s.board, buildings: { ...s.board.buildings, [v]: { owner: p, type: 'settlement' } } } };
    const taken = new Set<VertexId>([v]);
    const free = (w: VertexId) => !taken.has(w) && !t.vertexNeighbors[w].some((n) => taken.has(n));
    for (const q of between) {
      const pick = best(legalOf(q).filter(free), valueFor(sim, q));
      if (!pick) continue;
      sim.board.buildings[pick] = { owner: q, type: 'settlement' };
      taken.add(pick);
    }
    const next = legalOf(p).filter(free);
    const later = valueFor(sim, p);
    const second = next.length > 0 ? Math.max(...next.map(later)) : 0;
    const score = first + second;
    if (score > topScore) {
      topScore = score;
      top = v;
    }
  }
  return top;
}

/**
 * The cards it gives up on a 7: it keeps the cards of the build it is
 * closest to (a city or settlement first on a tie), then (medium, hard) the
 * ones it lacks most; easy throws the rest from its biggest piles.
 */
function discardAction(s: GameState, p: PlayerId, pr: Profile): Action | null {
  const ph = s.phase;
  if (ph.kind !== 'discard') return null;
  const need = ph.pending[p];
  if (need === undefined) return null;
  const have = { ...s.players[p].resources };
  const keepN = total(have) - need;
  const x = expansionOf(s, p, pr);
  const goals: PartialCounts[] = [];
  if (legalCities(s, p).length > 0) goals.push(COSTS.city);
  if (s.players[p].supply.settlements > 0 && (legalSettlements(s, p).length > 0 || x.best)) goals.push(COSTS.settlement);
  if (s.devDeck.length > 0) goals.push(COSTS.devCard);
  if (x.best) goals.push(edgeCost(x.best));
  // the goal it can keep closest to complete (in that order on a tie)
  const short = (g: PartialCounts) => {
    let lack = 0;
    let used = 0;
    for (const r of RESOURCES) {
      lack += Math.max(0, (g[r] ?? 0) - have[r]);
      used += Math.min(g[r] ?? 0, have[r]);
    }
    return lack + Math.max(0, used - keepN);
  };
  const goal = best(goals, (g) => -short(g)) ?? {};
  const keep: PartialCounts = {};
  let kept = 0;
  for (const r of RESOURCES) {
    const n = Math.min(goal[r] ?? 0, have[r], keepN - kept);
    if (n > 0) keep[r] = n;
    kept += Math.max(0, n);
  }
  const prod = production(s, p);
  const left = { ...have };
  for (const r of RESOURCES) left[r] -= keep[r] ?? 0;
  const second = goals.find((g) => g !== goal) ?? {};
  while (kept < keepN) {
    const r = best(
      RESOURCES.filter((y) => left[y] > 0),
      (y) =>
        pr.plans
          ? ((second[y] ?? 0) > (keep[y] ?? 0) ? 2 : 0) + (prod[y] === 0 ? 0.8 : 0) - (keep[y] ?? 0) * 0.5 + (y === 'ore' || y === 'grain' ? 0.2 : 0)
          : -left[y],
    )!;
    left[r]--;
    keep[r] = (keep[r] ?? 0) + 1;
    kept++;
  }
  const cards: PartialCounts = {};
  for (const r of RESOURCES) {
    const n = have[r] - (keep[r] ?? 0);
    if (n > 0) cards[r] = n;
  }
  return { type: 'discard', player: p, cards };
}

function goldAction(s: GameState, p: PlayerId): Action | null {
  const ph = s.phase;
  if (ph.kind !== 'gold') return null;
  const owed = ph.pending[p];
  if (owed === undefined) return null;
  const n = Math.min(owed, total(s.bank));
  const wants = resourceWants(s, p, s.players[p].supply.settlements > 0 ? COSTS.settlement : COSTS.city);
  const bank = { ...s.bank };
  const have = { ...s.players[p].resources };
  const pick: PartialCounts = {};
  for (let i = 0; i < n; i++) {
    const r = best(
      RESOURCES.filter((x) => bank[x] > 0),
      (x) => wants[x] - have[x] * 0.3,
    )!;
    bank[r]--;
    have[r]++;
    pick[r] = (pick[r] ?? 0) + 1;
  }
  return { type: 'chooseGold', player: p, resources: pick };
}

function respondToTrades(s: GameState, p: PlayerId, acts: Action[], pr: Profile): Action | null {
  let x: Expansion | null = null;
  const exp = () => (x ??= expansionOf(s, p, pr));
  for (const t of s.turn.trades) {
    if (!t.to.includes(p) || t.accepted.includes(p) || t.rejected.includes(p)) continue;
    const accept = acts.find((a) => a.type === 'acceptTrade' && a.tradeId === t.id);
    const reject = acts.find((a) => a.type === 'rejectTrade' && a.tradeId === t.id);
    const target = s.players[p].supply.settlements > 0 ? COSTS.settlement : COSTS.city;
    const wants = resourceWants(s, p, target);
    const proposerClose = nearWin(s, t.from, pr);
    if (t.open) {
      const counter = proposerClose ? null : counterOffer(s, p, t, wants, pr);
      if (counter && counter.type === 'proposeTrade' && tradeOk(s, p, counter.give, counter.get, exp())) return counter;
      if (reject) return reject;
      continue;
    }
    let gain = 0;
    for (const r of RESOURCES) gain += (t.give[r] ?? 0) * wants[r] - (t.get[r] ?? 0) * wants[r];
    if (accept && gain > pr.acceptGain && !proposerClose && tradeOk(s, p, t.get, t.give, exp())) return accept;
    if (reject) return reject;
  }
  return null;
}

/**
 * Answers an open offer card for card: for "who has X for me?" the bot gives
 * X (if it can spare it) for what it needs most; for "what will you give for
 * X?" it pays with what it needs least, if it wants X. It prefers asking for
 * something the proposer actually holds, so the offer can be taken.
 */
function counterOffer(s: GameState, p: PlayerId, t: TradeOffer, wants: Record<Resource, number>, pr: Profile): Action | null {
  const mine = s.players[p].resources;
  const theirs = s.players[t.from].resources;
  if (t.open === 'give') {
    const n = total(t.get);
    if (n === 0 || !hasAtLeast(mine, t.get)) return null;
    let cost = 0;
    for (const r of RESOURCES) cost += (t.get[r] ?? 0) * wants[r];
    // ask card by card for what it values most, up to one card more than it gives
    const ask: PartialCounts = {};
    let value = 0;
    for (let k = 0; k < n + 1 + pr.counterExtra && value - cost <= pr.counterGain; k++) {
      const r = best(
        RESOURCES.filter((x) => !(t.get[x] ?? 0)),
        (x) => wants[x] - (ask[x] ?? 0) * 0.4 + (theirs[x] > (ask[x] ?? 0) ? 0.5 : -2),
      );
      if (!r) break;
      ask[r] = (ask[r] ?? 0) + 1;
      value += wants[r];
    }
    if (value - cost <= pr.counterGain || total(ask) === 0) return null;
    return { type: 'proposeTrade', player: p, give: { ...t.get }, get: ask, to: [t.from], replyTo: t.id };
  }
  const n = total(t.give);
  if (n === 0) return null;
  let value = 0;
  for (const r of RESOURCES) value += (t.give[r] ?? 0) * wants[r];
  const pay = best(
    RESOURCES.filter((r) => !(t.give[r] ?? 0) && mine[r] >= n),
    (r) => -wants[r] + mine[r] * 0.05,
  );
  if (!pay || value - wants[pay] * n <= pr.counterGain) return null;
  return { type: 'proposeTrade', player: p, give: { [pay]: n }, get: { ...t.give }, to: [t.from], replyTo: t.id };
}

/** Expected cards of `r` the others hold, from their production (hands are hidden). */
function guessHeld(s: GameState, p: PlayerId, r: Resource): number {
  let n = 0;
  for (const pl of s.players) {
    if (pl.id === p) continue;
    const prod = production(s, pl.id);
    const all = RESOURCES.reduce((x, y) => x + prod[y], 0);
    n += all > 0 ? (handSize(s, pl.id) * prod[r]) / all : handSize(s, pl.id) / 5;
  }
  return n;
}

function devCardAction(s: GameState, p: PlayerId, acts: Action[], plan: Plan | null, pr: Profile, x: Expansion | null): Action | null {
  const knight = acts.find((a) => a.type === 'playKnight');
  if (knight) {
    const t = topo(s);
    const blocked =
      s.board.robber !== null && t.hexVertices[s.board.robber].some((v) => s.board.buildings[v]?.owner === p);
    if (!pr.devCards) return blocked ? knight : null;
    const army = s.largestArmy.holder;
    const mine = s.players[p].playedKnights + 1;
    const armyGain =
      scenarioOf(s).rules.largestArmy && army !== p && mine >= 3 && (army === null || mine > s.players[army].playedKnights);
    // Pirate Islands: a knight arms the rearmost normal ship, so keep it until there is one.
    const warship =
      s.ext.pirateIslands !== undefined &&
      Object.values(s.board.pieces).some((y) => y.owner === p && y.type === 'ship' && !y.warship);
    if (blocked || armyGain || warship) return knight;
    // A focused player keeps the robber on the leader and races for Largest Army.
    if (pr.robberFocus > 1 && scenarioOf(s).rules.largestArmy && s.ext.pirateIslands === undefined) return knight;
  }
  if (!pr.devCards) return null;
  if (s.phase.kind !== 'main') return null;
  const rb = acts.find((a) => a.type === 'playRoadBuilding');
  if (rb && s.players[p].supply.roads + s.players[p].supply.ships >= 2 && x?.best && x.best.gain >= pr.roadBar) return rb;
  const yop = byType(acts, 'playYearOfPlenty');
  if (yop.length > 0) {
    // the two cards that complete a settlement or city now (hard), or the plan
    const have = s.players[p].resources;
    const goals: PartialCounts[] = [];
    if (pr.lookahead) {
      if (legalCities(s, p).length > 0) goals.push(COSTS.city);
      if (legalSettlements(s, p).length > 0) goals.push(COSTS.settlement);
    }
    if (plan) goals.push(plan.cost);
    for (const g of goals) {
      const need = missing(have, g);
      if (total(need) > 0 && total(need) <= 2) {
        const want: Resource[] = [];
        for (const r of RESOURCES) for (let i = 0; i < (need[r] ?? 0); i++) want.push(r);
        const pick = yop.find((a) => want.every((r) => a.resources.includes(r)));
        if (pick) return pick;
      }
    }
  }
  const mono = byType(acts, 'playMonopoly');
  if (mono.length > 0) {
    const wants = resourceWants(s, p, plan?.cost ?? null);
    if (pr.lookahead) {
      // the resource the others hold most of, by what they produce, weighed by what it wants
      const top = best(mono, (a) => guessHeld(s, p, a.resource) * wants[a.resource]);
      if (top && guessHeld(s, p, top.resource) >= 3) return top;
    } else {
      const others = s.players.filter((y) => y.id !== p).reduce((n, y) => n + handSize(s, y.id), 0);
      if (others >= 6) return best(mono, (a) => wants[a.resource]);
    }
  }
  return null;
}

function scenarioMainAction(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  const sc = byType(acts, 'scenario');
  const build = sc.find((a) => a.name === 'buildWonder');
  if (build) return build;
  const claims = sc.filter((a) => a.name === 'claimWonder');
  if (claims.length > 0) {
    // The wonder whose costs fit the player's production best.
    const prod = production(s, p);
    const costs: Record<string, PartialCounts> = {
      theater: { brick: 1, wool: 3, lumber: 1 },
      greatBridge: { wool: 1, grain: 1, lumber: 3 },
      monument: { ore: 2, grain: 3 },
      greatWall: { brick: 3, grain: 1, lumber: 1 },
      cathedral: { brick: 1, ore: 3, grain: 1 },
    };
    return best(claims, (a) => {
      const c = costs[String(a.args?.wonder)] ?? {};
      return RESOURCES.reduce((n, r) => n + (c[r] ?? 0) * prod[r], 0);
    });
  }
  const attack = sc.find((a) => a.name === 'attackFortress');
  if (attack) {
    const ships = Object.values(s.board.pieces).filter((x) => x.owner === p && x.warship).length;
    if (ships >= 4 || (ships >= 3 && totalVP(s, p) >= s.victoryTarget - 1)) return attack;
  }
  return null;
}

function wonderCost(s: GameState, p: PlayerId): PartialCounts | null {
  const w = s.ext.wonders as { owned: Array<string | null>; levels: number[] } | undefined;
  if (!w?.owned[p] || w.levels[p] >= 4) return null;
  const costs: Record<string, PartialCounts> = {
    theater: { brick: 1, wool: 3, lumber: 1 },
    greatBridge: { wool: 1, grain: 1, lumber: 3 },
    monument: { ore: 2, grain: 3 },
    greatWall: { brick: 3, grain: 1, lumber: 1 },
    cathedral: { brick: 1, ore: 3, grain: 1 },
  };
  return costs[w.owned[p]!] ?? null;
}

/**
 * The active player's trade business: settle its own offer once everyone has
 * answered, and take or turn down counter-offers. `null` means "wait for the
 * answers"; `undefined` means there is nothing to do.
 */
function actorTrades(s: GameState, p: PlayerId, acts: Action[], pr: Profile, x: () => Expansion): Action | null | undefined {
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
    const plan = choosePlan(s, p, x(), pr);
    const wants = resourceWants(s, p, plan?.cost ?? null);
    let gain = 0;
    for (const r of RESOURCES) gain += (t.give[r] ?? 0) * wants[r] - (t.get[r] ?? 0) * wants[r];
    const accept = acts.find((a) => a.type === 'acceptTrade' && a.tradeId === t.id);
    if (accept && gain > pr.acceptGain && !nearWin(s, t.from, pr) && tradeOk(s, p, t.get, t.give, x())) return accept;
    return { type: 'rejectTrade', player: p, tradeId: t.id };
  }
  return undefined;
}

/**
 * Offers another player a card for the one or two it is missing for its goal:
 * one spare card for one needed card, and on a second try (hard) two for one.
 */
function offerToPlayers(s: GameState, p: PlayerId, plan: Plan, pr: Profile, x: Expansion): Action | null {
  const made = s.turn.offers ?? 0;
  if (made >= pr.offersPerTurn || s.turn.role !== 'active') return null;
  if (s.options.tradeBuildMode === 'separate' && s.turn.buildingStarted) return null;
  const have = s.players[p].resources;
  const need = missing(have, plan.cost);
  if (total(need) < 1 || total(need) > 2) return null;
  const want = RESOURCES.find((r) => (need[r] ?? 0) > 0)!;
  const spare = minus(have, plan.cost);
  const wants = resourceWants(s, p, plan.cost);
  const pool = RESOURCES.filter((r) => r !== want && spare[r] >= 1).sort((a, b) => wants[a] - wants[b] || spare[b] - spare[a]);
  if (pool.length === 0) return null;
  const give: PartialCounts = { [pool[0]]: 1 };
  if (made >= 1) {
    const second = pool.find((r) => spare[r] >= (r === pool[0] ? 2 : 1));
    if (!second) return null;
    give[second] = (give[second] ?? 0) + 1;
  }
  const to = s.players.map((y) => y.id).filter((q) => q !== p && !nearWin(s, q, pr));
  if (to.length === 0 || !tradeOk(s, p, give, { [want]: 1 }, x)) return null;
  return { type: 'proposeTrade', player: p, give, get: { [want]: 1 }, to };
}

// ---------------------------------------------------------------------------
// The turn planner (medium, hard): the best settlements and cities to complete this turn
// ---------------------------------------------------------------------------

/** What a VP is worth against the cards in hand, in cards (the turn planner's unit). */
const VP_WORTH = 6;
/** A card kept in hand. */
const CARD_WORTH = 0.75;

interface Build {
  action: Action;
  cost: PartialCounts;
  value: number;
  /** The settlement spot it takes (no two adjacent ones in a package). */
  vertex?: VertexId;
  /** It starts with a road or ship (one per package). */
  road?: boolean;
}

interface Package {
  builds: Build[];
  trades: TradeStep[];
  value: number;
}

/**
 * The turn planner (medium, hard): the settlements and cities it can build
 * this turn (a spot one road or ship away included, and the road that takes
 * Longest Road), with the bank trades they need. Every set of up to two
 * builds is scored by what it adds (a VP and the production of the spot
 * each) less the cards it costs (cards traded away included); the best set
 * wins.
 */
function bestPackage(s: GameState, p: PlayerId, x: Expansion): Package | null {
  const pl = s.players[p];
  const prod = production(s, p);
  const have = pl.resources;
  const items: Build[] = [];
  const cities = legalCities(s, p)
    .map((v) => ({ v, gain: cityGain(s, v, prod) }))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 2);
  for (const c of cities) {
    items.push({ action: { type: 'buildCity', player: p, vertex: c.v }, cost: COSTS.city, value: VP_WORTH + c.gain * 0.35 });
  }
  const spots = legalSettlements(s, p)
    .map((v) => ({ v, value: spotValue(s, p, v, prod) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  for (const sp of spots) {
    items.push({ action: { type: 'buildSettlement', player: p, vertex: sp.v }, cost: COSTS.settlement, value: VP_WORTH + sp.value * 0.35, vertex: sp.v });
  }
  // a spot one road (or ship) away
  if (pl.supply.settlements > 0) {
    for (const o of x.options.slice(0, 3)) {
      if (o.gain <= 0 || o.left !== 0 || !o.toward) continue;
      const t = x.targets.find((y) => y.vertex === o.toward && y.spot);
      if (!t || legalSettlements(s, p).includes(t.vertex)) continue;
      items.push({
        action: edgeAction(p, o),
        cost: addCost(edgeCost(o), COSTS.settlement),
        value: VP_WORTH + t.value * 0.35 - 0.3,
        vertex: t.vertex,
        road: true,
      });
    }
  }
  // the road that takes Longest Road now
  const lr = routeEdge(s, p, x);
  if (lr && lr.value >= 2) items.push({ action: edgeAction(p, lr.option), cost: edgeCost(lr.option), value: VP_WORTH * 2, road: true });
  if (items.length === 0) return null;
  const sets: Build[][] = items.map((i) => [i]);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.vertex && b.vertex && (a.vertex === b.vertex || topo(s).vertexNeighbors[a.vertex].includes(b.vertex))) continue;
      if (a.action.type === 'buildCity' && b.action.type === 'buildCity' && pl.supply.cities < 2) continue;
      const settles = [a, b].filter((y) => y.vertex).length;
      if (settles > pl.supply.settlements) continue;
      if (a.road && b.road) continue;
      sets.push([a, b]);
    }
  }
  let top: Package | null = null;
  for (const set of sets) {
    const cost = addCost(...set.map((b) => b.cost));
    const trades = tradePlan(s, p, cost, have);
    if (!trades) continue;
    const spent = total(cost) + trades.reduce((n, t) => n + t.rate - 1, 0);
    const value = set.reduce((n, b) => n + b.value, 0) - spent * CARD_WORTH;
    if (!top || value > top.value) top = { builds: set, trades, value };
  }
  return top && top.value > 0 ? top : null;
}

/** The next step of a package: a trade it needs (an offer to the players first), then its builds, cities first. */
function packageStep(s: GameState, p: PlayerId, pkg: Package, acts: Action[], pr: Profile, x: Expansion): Action | null {
  if (pkg.trades.length > 0) {
    const t = pkg.trades[0];
    if (t.rate >= 3) {
      const cost = addCost(...pkg.builds.map((b) => b.cost));
      const offer = offerToPlayers(s, p, { cost, action: pkg.builds[0].action }, pr, x);
      if (offer && applyAction(s, offer).ok) return offer;
    }
    const trade: Action = { type: 'bankTrade', player: p, give: { [t.give]: t.rate }, get: { [t.get]: 1 } };
    return applyAction(s, trade).ok ? trade : null;
  }
  const order = [...pkg.builds].sort((a, b) => rankOf(a) - rankOf(b));
  for (const b of order) {
    if (acts.some((a) => sameAction(a, b.action))) return b.action;
  }
  return null;
}

function sameAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const rankOf = (b: Build) => (b.action.type === 'buildCity' ? 0 : b.action.type === 'buildSettlement' ? 1 : 2);

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

function mainAction(s: GameState, p: PlayerId, acts: Action[], pr: Profile): Action | null {
  const pl = s.players[p];
  // A harbor that must or may be placed.
  const harbors = byType(acts, 'placeHarbor');
  if (harbors.length > 0) return best(harbors, (a) => harborScore(s, p, a.edge));

  let xMemo: Expansion | null = null;
  const exp = () => (xMemo ??= expansionOf(s, p, pr));
  const deal = actorTrades(s, p, acts, pr, exp);
  if (deal !== undefined) return deal;

  const x = exp();
  const plan = pr.plans ? choosePlan(s, p, x, pr) : null;

  const dev = devCardAction(s, p, acts, plan, pr, x);
  if (dev) return dev;

  // Medium, hard: the best settlements and cities it can complete this turn.
  if (pr.planner) {
    const pkg = bestPackage(s, p, x);
    if (pkg) {
      const step = packageStep(s, p, pkg, acts, pr, x);
      if (step) return step;
    }
  }

  // Immediate builds, best first.
  const prod = production(s, p);
  const city = byType(acts, 'buildCity');
  if (city.length > 0) return pickBest(s, p, pr, city, (a) => cityGain(s, a.vertex, prod), (a) => a.vertex);
  const settle = byType(acts, 'buildSettlement');
  if (settle.length > 0) return pickBest(s, p, pr, settle, (a) => spotValue(s, p, a.vertex, prod), (a) => a.vertex);
  const scen = scenarioMainAction(s, p, acts);
  if (scen) return scen;

  if (plan) {
    if (applyAction(s, plan.action).ok) return plan.action;
    const offer = offerToPlayers(s, p, plan, pr, x);
    if (offer && applyAction(s, offer).ok) return offer;
    const trades = tradePlan(s, p, plan.cost);
    if (trades && trades.length > 0) {
      const t = trades[0];
      const trade: Action = { type: 'bankTrade', player: p, give: { [t.give]: t.rate }, get: { [t.get]: 1 } };
      if (applyAction(s, trade).ok) return trade;
    }
  }
  // Spare cards: extend toward good spots or buy a card, if that keeps the plan intact.
  const big = total(pl.resources) > s.options.discardLimit;
  const spare = (cost: PartialCounts) => !plan || hasAtLeast(minus(pl.resources, cost), plan.cost) || big;
  if (routeToFortressOpen(s, p)) {
    const routeShip = byType(acts, 'buildShip')[0];
    if (routeShip && spare(COSTS.ship)) return routeShip;
  }
  const edge = spareEdge(s, p, acts, pr, x);
  if (edge && spare(edge.type === 'buildRoad' ? COSTS.road : COSTS.ship)) return edge;
  const buy = acts.find((a) => a.type === 'buyDevCard');
  if (buy && spare(COSTS.devCard)) return buy;
  // More cards than a 7 leaves alone: something useful, with a trade if that completes it.
  if (pr.plans && big) {
    const spend = spendHand(s, p, acts, x, pr);
    if (spend) return spend;
    // or (hard) a pile it can't use traded for a card that brings a build closer
    const down = pr.handGuard ? tradeDown(s, p, acts, plan, x) : null;
    if (down) return down;
  }
  return acts.find((a) => a.type === 'endTurn') ?? null;
}

/**
 * A hand over the 7 limit: cards from a pile its plan doesn't need traded
 * with the bank for one that brings a build closer (four spare cards for a
 * needed one beat half the hand on a 7).
 */
function tradeDown(s: GameState, p: PlayerId, acts: Action[], plan: Plan | null, x: Expansion): Action | null {
  const have = s.players[p].resources;
  const wants = resourceWants(s, p, plan?.cost ?? null);
  const trades = byType(acts, 'bankTrade').filter((a) => {
    const give = RESOURCES.find((r) => (a.give[r] ?? 0) > 0)!;
    return have[give] - (a.give[give] ?? 0) >= (plan?.cost[give] ?? 0) && tradeOk(s, p, a.give, a.get, x);
  });
  const gain = (a: (typeof trades)[number]) => {
    const get = RESOURCES.find((r) => (a.get[r] ?? 0) > 0)!;
    const give = RESOURCES.find((r) => (a.give[r] ?? 0) > 0)!;
    return wants[get] - wants[give] + have[give] * 0.05;
  };
  const t = best(trades, gain);
  return t && gain(t) > 0 ? t : null;
}

/**
 * A large hand at the end of the turn: a development card, or a road or
 * ship that leads somewhere (or lengthens a route in play), bought with one
 * bank trade if it takes one, rather than half the hand lost to a 7.
 */
function spendHand(s: GameState, p: PlayerId, acts: Action[], x: Expansion, pr: Profile): Action | null {
  const options: Plan[] = [];
  if (s.devDeck.length > 0) options.push({ cost: COSTS.devCard, action: { type: 'buyDevCard', player: p } });
  const edge = best(
    x.options.filter((o) => o.gain > 0 || routeValue(s, p, o.edge, o.kind) > 0),
    (o) => o.gain + routeValue(s, p, o.edge, o.kind) * VP_WORTH,
  );
  if (edge) options.push({ cost: edgeCost(edge), action: edgeAction(p, edge) });
  for (const o of options) if (acts.some((a) => sameAction(a, o.action))) return o.action;
  // (not while already looking one step ahead)
  if (spendDepth > 0) return null;
  for (const o of options) {
    const trades = tradePlan(s, p, o.cost);
    if (trades && trades.length === 1) {
      const t = trades[0];
      const trade: Action = { type: 'bankTrade', player: p, give: { [t.give]: t.rate }, get: { [t.get]: 1 } };
      // only if, with the card, it really builds that next
      const r = applyAction(s, trade);
      if (!r.ok) continue;
      spendDepth++;
      try {
        if (sameAction(mainAction(r.state, p, legalActions(r.state, p), pr) ?? trade, o.action)) return trade;
      } finally {
        spendDepth--;
      }
    }
  }
  return null;
}

/** How deep spendHand is in its own look one step ahead (it never nests). */
let spendDepth = 0;

/**
 * A road or ship worth building with spare cards: one that brings a spot or
 * goal worth at least the level's bar closer, or (medium, hard) one that
 * takes Longest Road or keeps it in reach.
 */
function spareEdge(s: GameState, p: PlayerId, acts: Action[], pr: Profile, x: Expansion): Extract<Action, { type: 'buildRoad' | 'buildShip' }> | null {
  const edges = [...byType(acts, 'buildRoad'), ...byType(acts, 'buildShip')];
  const option = (a: (typeof edges)[number]) => x.byEdge.get(`${a.type === 'buildShip' ? 'ship' : 'road'}:${a.edge}`);
  const route = (a: (typeof edges)[number]) => (pr.plans ? routeValue(s, p, a.edge, a.type === 'buildShip' ? 'ship' : 'road') * VP_WORTH : 0);
  const useful = edges.filter((a) => (option(a)?.gain ?? 0) >= pr.roadBar || route(a) >= VP_WORTH * 0.5);
  return pickBest(s, p, pr, useful, (a) => (option(a)?.gain ?? 0) + route(a), (a) => a.edge);
}

function minus(have: ResourceCounts, cost: PartialCounts): ResourceCounts {
  const out = { ...have };
  for (const r of RESOURCES) out[r] -= cost[r] ?? 0;
  for (const r of RESOURCES) if (out[r] < 0) out[r] = -99;
  return out;
}

function harborScore(s: GameState, p: PlayerId, e: EdgeId): number {
  const t = topo(s);
  let score = 0;
  for (const h of t.edgeHexes[e]) score += pips(s.board.hexes[h].token);
  for (const v of t.edgeVertices[e]) if (s.board.buildings[v]?.owner === p) score += 5;
  return score;
}

function robberAction(s: GameState, p: PlayerId, acts: Action[], pr: Profile): Action | null {
  const moves = sensibleRobberMoves(s, p, byType(acts, 'moveRobber'));
  return pickBest(s, p, pr, moves, (a) => robberScore(s, p, a, pr), (a) => `${a.hex}:${a.victim ?? ''}`) ?? acts[0];
}

/**
 * The heuristic bot's move for `player`, or null if it has nothing to do.
 * Deterministic for a given state.
 */
export function heuristicAction(s: GameState, p: PlayerId, level: BotLevel = 'medium'): Action | null {
  const pr = botProfile(level);
  const acts = legalActions(s, p);
  if (acts.length === 0) return null;
  // Cities & Knights has a strategy of its own (src/bots/ckBot.ts)
  if (s.ck) return ckHeuristicAction(s, p, acts, pr);
  const ph = s.phase;
  switch (ph.kind) {
    case 'harborPlacement':
      return best(byType(acts, 'placeHarbor'), (a) => harborScore(s, p, a.edge));
    case 'setup':
      return setupAction(s, p, acts, pr);
    case 'discard':
      return discardAction(s, p, pr);
    case 'gold':
      return goldAction(s, p);
    case 'robber':
      return robberAction(s, p, acts, pr);
    case 'roadBuilding': {
      const x = expansionOf(s, p, pr);
      const edges = [...byType(acts, 'buildRoad'), ...byType(acts, 'buildShip')];
      const value = (a: (typeof edges)[number]) => {
        const kind = a.type === 'buildShip' ? 'ship' : 'road';
        return (x.byEdge.get(`${kind}:${a.edge}`)?.gain ?? 0) + routeValue(s, p, a.edge, kind) * VP_WORTH;
      };
      const e = best(edges, value);
      // free roads go where they lead somewhere; with nowhere to go, it stops
      if (e && value(e) > 0) return e;
      return acts.find((a) => a.type === 'endRoadBuilding') ?? e ?? acts[0];
    }
    case 'scenario': {
      const harbors = byType(acts, 'placeHarbor');
      if (harbors.length > 0) return best(harbors, (a) => harborScore(s, p, a.edge));
      const rob = byType(acts, 'scenario').filter((a) => a.name === 'rob');
      if (rob.length > 0) {
        return (
          best(
            rob.filter((a) => a.args?.victim !== undefined),
            (a) => handSize(s, Number(a.args!.victim)) + publicVP(s, Number(a.args!.victim)),
          ) ?? rob[0]
        );
      }
      return acts[0];
    }
    case 'preRoll': {
      const dev = devCardAction(s, p, acts, null, pr, null);
      if (dev) return dev;
      return acts.find((a) => a.type === 'rollDice') ?? acts[0];
    }
    case 'specialBuild': {
      const prod = production(s, p);
      const city = best(byType(acts, 'buildCity'), (a) => cityGain(s, a.vertex, prod));
      if (city) return city;
      const settle = best(byType(acts, 'buildSettlement'), (a) => spotValue(s, p, a.vertex, prod));
      if (settle) return settle;
      return acts.find((a) => a.type === 'endTurn') ?? acts[0];
    }
    case 'main': {
      if (s.turn.actor !== p) return respondToTrades(s, p, acts, pr);
      return mainAction(s, p, acts, pr);
    }
    default:
      return acts[0];
  }
}

/** Plays a whole game with computer players only; `levels` sets each seat's level (default medium). */
export function simulateHeuristic(
  initial: GameState,
  maxSteps = 5000,
  levels: BotLevel | BotLevel[] = 'medium',
  onStep?: (s: GameState, a: Action) => void,
): { state: GameState; steps: number } {
  const levelOf = (p: PlayerId): BotLevel => (Array.isArray(levels) ? (levels[p] ?? 'medium') : levels);
  let s = initial;
  let steps = 0;
  let partSteps = 0;
  let part = s.turn.part;
  while (s.phase.kind !== 'gameOver' && steps < maxSteps) {
    let acted = false;
    for (const p of playersToAct(s)) {
      let a = heuristicAction(s, p, levelOf(p));
      if (!a) continue;
      if (s.turn.part !== part) {
        part = s.turn.part;
        partSteps = 0;
      }
      // Safety valve: a part of a turn never runs forever.
      if (++partSteps > 60 && s.phase.kind === 'main' && s.turn.actor === p) {
        const end: Action = { type: 'endTurn', player: p };
        // (Cities & Knights: not while over the progress card limit)
        if (!s.ck || applyAction(s, end).ok) a = end;
      }
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`bot move rejected: ${JSON.stringify(a)} -> ${r.error} (phase ${s.phase.kind})`);
      s = r.state;
      onStep?.(s, a);
      acted = true;
      break;
    }
    if (!acted) throw new Error(`deadlock in phase ${s.phase.kind}`);
    steps++;
  }
  return { state: s, steps };
}
