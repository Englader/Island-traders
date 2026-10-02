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
import { applyAction } from '../engine/apply.js';
import { legalActions, playersToAct } from '../engine/legal.js';
import { legalCities, legalRoads, legalSettlements, legalShips } from '../engine/placements.js';
import {
  distanceRuleOk,
  handSize,
  isBlockedVertex,
  publicVP,
  topo,
  totalVP,
  tradeRates,
  vertexLandHexes,
  vertexTouchesLand,
  vertexZones,
} from '../rules/queries.js';
import { scenarioOf } from '../scenarios/registry.js';
import { ckHeuristicAction, type CkProfile } from './ckBot.js';

/**
 * A rule-of-thumb bot. It never looks at hidden information it could not see
 * at the table (other hands, the deck, the fog stack); it only uses public
 * state and its own hand.
 *
 * - Settlement spots are scored by pips, resources it lacks, harbors and
 *   island bonuses; roads and ships head for the best reachable spot.
 * - Each turn it picks a target (city, settlement, road/ship, wonder level,
 *   development card), builds it if it can and otherwise trades with the
 *   bank only when that completes the target right away.
 * - The robber goes where it hurts the leader most, never on its own hexes.
 * - It answers domestic offers by comparing what it needs; it does not make
 *   offers itself.
 * - Cities & Knights games have a strategy of their own (src/bots/ckBot.ts),
 *   tuned by the profile's `ck` settings.
 */

type Kind = Action['type'];

const ROAD_DECAY = 0.7;

/** How well a computer player plays. */
export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

export interface Profile {
  /** Mistakes when choosing spots and robber targets: 0 always takes the best. */
  noise: number;
  /** Saves up for a goal and trades with the bank and harbors to reach it. */
  plans: boolean;
  /** Roads: the lowest value worth building one for (low = builds roads to nowhere). */
  roadBar: number;
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
  /** Before ending its turn with more than 7 cards, trades some away so a 7 costs less. */
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
    roadBar: 0.2,
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
    roadBar: 1,
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
    roadBar: 1,
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

/** Could a settlement ever stand here (ignoring the road connection)? */
function openSpot(s: GameState, p: PlayerId, v: VertexId): boolean {
  if (!vertexTouchesLand(s, v) || isBlockedVertex(s, v) || !distanceRuleOk(s, v)) return false;
  const sc = scenarioOf(s);
  if (vertexZones(s, v).some((z) => sc.rules.forbiddenZones.includes(z))) return false;
  return (sc.hooks.settlementAllowed?.(s, p, v, false) ?? null) === null;
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

/** Scenario targets that ships should head for, with a value. */
function scenarioTargets(s: GameState, p: PlayerId): Map<VertexId, number> {
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
  return out;
}

/**
 * How attractive each intersection is as a place to extend toward: settlement
 * spots and scenario targets, decaying with the number of paths to them.
 * `through` limits the paths it spreads along (the C&K bot: by road or by ship).
 */
export function potentialField(s: GameState, p: PlayerId, through?: (e: EdgeId) => boolean): Map<VertexId, number> {
  const t = topo(s);
  const prod = production(s, p);
  const pot = new Map<VertexId, number>();
  for (const v of t.vertexIds) {
    if (openSpot(s, p, v)) pot.set(v, spotValue(s, p, v, prod));
  }
  for (const [v, val] of scenarioTargets(s, p)) pot.set(v, Math.max(pot.get(v) ?? 0, val));
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
        const bx = s.board.buildings[x];
        if (bx && bx.owner !== p) continue; // cannot pass an opponent's building
        const val = (pot.get(x) ?? 0) * ROAD_DECAY;
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

function touchesOwnNetwork(s: GameState, p: PlayerId, v: VertexId): boolean {
  if (s.board.buildings[v]?.owner === p) return true;
  return topo(s).vertexEdges[v].some((e) => s.board.pieces[e]?.owner === p);
}

export function edgeScore(s: GameState, p: PlayerId, e: EdgeId, pot: Map<VertexId, number>): number {
  const [a, b] = topo(s).edgeVertices[e];
  const na = touchesOwnNetwork(s, p, a);
  const nb = touchesOwnNetwork(s, p, b);
  const far = na && !nb ? b : nb && !na ? a : null;
  const pa = pot.get(a) ?? 0;
  const pb = pot.get(b) ?? 0;
  if (far === null) return Math.max(pa, pb) * 0.5;
  const near = far === a ? b : a;
  // Only worth it when it gets closer to something.
  return (pot.get(far) ?? 0) - (pot.get(near) ?? 0) * 0.5;
}

function missing(have: ResourceCounts, cost: PartialCounts): PartialCounts {
  const out: PartialCounts = {};
  for (const r of RESOURCES) {
    const m = (cost[r] ?? 0) - have[r];
    if (m > 0) out[r] = m;
  }
  return out;
}

/** Bank trades that turn surplus into the missing cards; null if the surplus is not enough. */
function tradePlan(s: GameState, p: PlayerId, cost: PartialCounts): Array<{ give: Resource; rate: number; get: Resource }> | null {
  const have = { ...s.players[p].resources };
  const need = missing(have, cost);
  if (total(need) === 0) return [];
  const rates = tradeRates(s, p);
  const plan: Array<{ give: Resource; rate: number; get: Resource }> = [];
  const bank = { ...s.bank };
  for (const r of RESOURCES) {
    for (let i = 0; i < (need[r] ?? 0); i++) {
      if (bank[r] <= 0) return null;
      // cheapest surplus first
      const giveOptions = RESOURCES.filter((g) => g !== r && have[g] - (cost[g] ?? 0) >= rates[g]).sort(
        (x, y) => rates[x] - rates[y] || have[y] - have[x],
      );
      const g = giveOptions[0];
      if (!g) return null;
      have[g] -= rates[g];
      have[r] += 1;
      bank[r] -= 1;
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

export function robberScore(s: GameState, p: PlayerId, a: Extract<Action, { type: 'moveRobber' }>, pr: Profile = PROFILES.medium): number {
  const t = topo(s);
  let score = 0;
  if (a.piece === 'robber') {
    const n = pips(s.board.hexes[a.hex].token);
    for (const v of t.hexVertices[a.hex]) {
      const b = s.board.buildings[v];
      if (!b) continue;
      const w = (b.type === 'city' ? 2 : 1) * n;
      score += b.owner === p ? -3 * w : w * leaderWeight(s, b.owner, pr.robberFocus, p);
    }
  } else {
    for (const e of t.hexEdges[a.hex]) {
      const x = s.board.pieces[e];
      if (x && x.type === 'ship') score += x.owner === p ? -2 : 1;
    }
  }
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

interface Plan {
  cost: PartialCounts;
  /** The action that builds the target. */
  action: Action;
}

/**
 * Picks what the player is saving for: an open settlement spot first, then
 * whichever of city, road/ship toward a good spot, or development card is
 * fewest cards away. A claimed wonder always comes first.
 */
function choosePlan(s: GameState, p: PlayerId, pot: Map<VertexId, number>, pr: Profile = PROFILES.medium): Plan | null {
  const pl = s.players[p];
  const wc = wonderCost(s, p);
  if (wc) return { cost: wc, action: { type: 'scenario', player: p, name: 'buildWonder' } };
  const prod = production(s, p);
  const spots = legalSettlements(s, p);
  if (spots.length > 0) {
    const v = best(spots, (x) => spotValue(s, p, x, prod))!;
    return { cost: COSTS.settlement, action: { type: 'buildSettlement', player: p, vertex: v } };
  }
  const options: Array<Plan & { rank: number }> = [];
  const cities = legalCities(s, p);
  if (cities.length > 0) {
    const v = best(cities, (x) => spotValue(s, p, x, prod))!;
    options.push({ cost: COSTS.city, action: { type: 'buildCity', player: p, vertex: v }, rank: 0 });
  }
  const edges: Array<{ edge: EdgeId; ship: boolean }> = [
    ...legalRoads(s, p).map((edge) => ({ edge, ship: false })),
    ...legalShips(s, p).map((edge) => ({ edge, ship: true })),
  ];
  const top = best(edges, (x) => edgeScore(s, p, x.edge, pot));
  // Pirate Islands: every legal ship is a step of the route to the fortress.
  const routeStep = routeToFortressOpen(s, p) && edges.some((x) => x.ship);
  if (routeStep) {
    const e = edges.find((x) => x.ship)!;
    options.push({ cost: COSTS.ship, action: { type: 'buildShip', player: p, edge: e.edge }, rank: 0.5 });
  } else if (top && edgeScore(s, p, top.edge, pot) > 0.5) {
    options.push({
      cost: top.ship ? COSTS.ship : COSTS.road,
      action: { type: top.ship ? 'buildShip' : 'buildRoad', player: p, edge: top.edge },
      rank: 1,
    });
  }
  if (s.devDeck.length > 0) options.push({ cost: COSTS.devCard, action: { type: 'buyDevCard', player: p }, rank: pr.devRank });
  const have = pl.resources;
  return best(options, (o) => -(total(missing(have, o.cost)) + o.rank * 0.4));
}

function setupAction(s: GameState, p: PlayerId, acts: Action[], pr: Profile): Action | null {
  const settle = byType(acts, 'placeSettlement');
  if (settle.length > 0) {
    const prod = production(s, p);
    return pickBest(s, p, pr, settle, (a) => spotValue(s, p, a.vertex, prod), (a) => a.vertex);
  }
  const pot = potentialField(s, p);
  const edges = [...byType(acts, 'placeRoad'), ...byType(acts, 'placeShip')];
  return best(edges, (a) => edgeScore(s, p, a.edge, pot) + (a.type === 'placeRoad' ? 0.1 : 0));
}

function discardAction(s: GameState, p: PlayerId): Action | null {
  const ph = s.phase;
  if (ph.kind !== 'discard') return null;
  const need = ph.pending[p];
  if (need === undefined) return null;
  const have = { ...s.players[p].resources };
  const keep = { ...COSTS.city, brick: 1, lumber: 1, wool: 1 } as PartialCounts;
  const cards: PartialCounts = {};
  for (let i = 0; i < need; i++) {
    const r = best(
      RESOURCES.filter((x) => have[x] > 0),
      (x) => have[x] - (keep[x] ?? 0) + (x === 'ore' || x === 'grain' ? -0.2 : 0),
    )!;
    have[r]--;
    cards[r] = (cards[r] ?? 0) + 1;
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
  for (const t of s.turn.trades) {
    if (!t.to.includes(p) || t.accepted.includes(p) || t.rejected.includes(p)) continue;
    const accept = acts.find((a) => a.type === 'acceptTrade' && a.tradeId === t.id);
    const reject = acts.find((a) => a.type === 'rejectTrade' && a.tradeId === t.id);
    const target = s.players[p].supply.settlements > 0 ? COSTS.settlement : COSTS.city;
    const wants = resourceWants(s, p, target);
    const proposerClose = nearWin(s, t.from, pr);
    if (t.open) {
      const counter = proposerClose ? null : counterOffer(s, p, t, wants, pr);
      if (counter) return counter;
      if (reject) return reject;
      continue;
    }
    let gain = 0;
    for (const r of RESOURCES) gain += (t.give[r] ?? 0) * wants[r] - (t.get[r] ?? 0) * wants[r];
    if (accept && gain > pr.acceptGain && !proposerClose) return accept;
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

function totalVPPublic(s: GameState, p: PlayerId): number {
  return publicVP(s, p);
}

function devCardAction(s: GameState, p: PlayerId, acts: Action[], plan: Plan | null, pr: Profile): Action | null {
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
      Object.values(s.board.pieces).some((x) => x.owner === p && x.type === 'ship' && !x.warship);
    if (blocked || armyGain || warship) return knight;
    // A focused player keeps the robber on the leader and races for Largest Army.
    if (pr.robberFocus > 1 && scenarioOf(s).rules.largestArmy && s.ext.pirateIslands === undefined) return knight;
  }
  if (!pr.devCards) return null;
  if (s.phase.kind !== 'main') return null;
  const rb = acts.find((a) => a.type === 'playRoadBuilding');
  if (rb && s.players[p].supply.roads + s.players[p].supply.ships >= 2) {
    const pot = potentialField(s, p);
    if (legalEdgeScores(s, p, pot) > 0.5) return rb;
  }
  const yop = byType(acts, 'playYearOfPlenty');
  if (yop.length > 0 && plan) {
    const need = missing(s.players[p].resources, plan.cost);
    if (total(need) > 0 && total(need) <= 2) {
      const want: Resource[] = [];
      for (const r of RESOURCES) for (let i = 0; i < (need[r] ?? 0); i++) want.push(r);
      const pick = yop.find((a) => want.every((r) => a.resources.includes(r)));
      if (pick) return pick;
    }
  }
  const mono = byType(acts, 'playMonopoly');
  if (mono.length > 0) {
    const others = s.players.filter((x) => x.id !== p).reduce((n, x) => n + handSize(s, x.id), 0);
    if (others >= 6) {
      const wants = resourceWants(s, p, plan?.cost ?? null);
      return best(mono, (a) => wants[a.resource]);
    }
  }
  return null;
}

function legalEdgeScores(s: GameState, p: PlayerId, pot: Map<VertexId, number>): number {
  let top = 0;
  const t = topo(s);
  for (const e of t.edgeIds) {
    if (s.board.pieces[e]) continue;
    const [a, b] = t.edgeVertices[e];
    if (!touchesOwnNetwork(s, p, a) && !touchesOwnNetwork(s, p, b)) continue;
    top = Math.max(top, edgeScore(s, p, e, pot));
  }
  return top;
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
function actorTrades(s: GameState, p: PlayerId, acts: Action[], pr: Profile): Action | null | undefined {
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
    const plan = choosePlan(s, p, potentialField(s, p));
    const wants = resourceWants(s, p, plan?.cost ?? null);
    let gain = 0;
    for (const r of RESOURCES) gain += (t.give[r] ?? 0) * wants[r] - (t.get[r] ?? 0) * wants[r];
    const accept = acts.find((a) => a.type === 'acceptTrade' && a.tradeId === t.id);
    if (accept && gain > pr.acceptGain && !nearWin(s, t.from, pr)) return accept;
    return { type: 'rejectTrade', player: p, tradeId: t.id };
  }
  return undefined;
}

/**
 * Offers another player a card for the one or two it is missing for its goal:
 * one spare card for one needed card, and on a second try (hard) two for one.
 */
function offerToPlayers(s: GameState, p: PlayerId, plan: Plan, pr: Profile): Action | null {
  const made = s.turn.offers ?? 0;
  if (made >= pr.offersPerTurn || s.turn.role !== 'active') return null;
  if (s.options.tradeBuildMode === 'separate' && s.turn.buildingStarted) return null;
  const have = s.players[p].resources;
  const need = missing(have, plan.cost);
  if (total(need) < 1 || total(need) > 2) return null;
  const want = RESOURCES.find((r) => (need[r] ?? 0) > 0)!;
  const spare = minus(have, plan.cost);
  const wants = resourceWants(s, p, plan.cost);
  const pool = RESOURCES.filter((r) => r !== want && spare[r] >= 1).sort((x, y) => wants[x] - wants[y] || spare[y] - spare[x]);
  if (pool.length === 0) return null;
  const give: PartialCounts = { [pool[0]]: 1 };
  if (made >= 1) {
    const second = pool.find((r) => spare[r] >= (r === pool[0] ? 2 : 1));
    if (!second) return null;
    give[second] = (give[second] ?? 0) + 1;
  }
  const to = s.players.map((x) => x.id).filter((q) => q !== p && !nearWin(s, q, pr));
  if (to.length === 0) return null;
  return { type: 'proposeTrade', player: p, give, get: { [want]: 1 }, to };
}

function mainAction(s: GameState, p: PlayerId, acts: Action[], pr: Profile): Action | null {
  const pl = s.players[p];
  // A harbor that must or may be placed.
  const harbors = byType(acts, 'placeHarbor');
  if (harbors.length > 0) return best(harbors, (a) => harborScore(s, p, a.edge));

  const deal = actorTrades(s, p, acts, pr);
  if (deal !== undefined) return deal;

  const pot = potentialField(s, p);
  const plan = pr.plans ? choosePlan(s, p, pot, pr) : null;

  const dev = devCardAction(s, p, acts, plan, pr);
  if (dev) return dev;

  // Immediate builds, best first.
  const prod = production(s, p);
  const city = byType(acts, 'buildCity');
  if (city.length > 0) return pickBest(s, p, pr, city, (a) => spotValue(s, p, a.vertex, prod), (a) => a.vertex);
  const settle = byType(acts, 'buildSettlement');
  if (settle.length > 0) return pickBest(s, p, pr, settle, (a) => spotValue(s, p, a.vertex, prod), (a) => a.vertex);
  const scen = scenarioMainAction(s, p, acts);
  if (scen) return scen;

  if (plan) {
    if (applyAction(s, plan.action).ok) return plan.action;
    const offer = offerToPlayers(s, p, plan, pr);
    if (offer && applyAction(s, offer).ok) return offer;
    const trades = tradePlan(s, p, plan.cost);
    if (trades && trades.length > 0) {
      const t = trades[0];
      const trade: Action = { type: 'bankTrade', player: p, give: { [t.give]: t.rate }, get: { [t.get]: 1 } };
      if (applyAction(s, trade).ok) return trade;
    }
  }
  // Spare cards: extend toward good spots or buy a card, if that keeps the plan intact.
  const spare = (cost: PartialCounts) => !plan || hasAtLeast(minus(pl.resources, cost), plan.cost) || total(pl.resources) > 7;
  const routeShip = routeToFortressOpen(s, p) ? byType(acts, 'buildShip')[0] : undefined;
  if (routeShip && spare(COSTS.ship)) return routeShip;
  const edges = [...byType(acts, 'buildRoad'), ...byType(acts, 'buildShip')];
  const edge = pickBest(s, p, pr, edges, (a) => edgeScore(s, p, a.edge, pot), (a) => a.edge);
  if (edge && edgeScore(s, p, edge.edge, pot) > pr.roadBar && spare(edge.type === 'buildRoad' ? COSTS.road : COSTS.ship)) return edge;
  const buy = acts.find((a) => a.type === 'buyDevCard');
  if (buy && spare(COSTS.devCard)) return buy;
  // Too many cards: trade the biggest pile into something useful.
  if (total(pl.resources) > 7) {
    const wants = resourceWants(s, p, plan?.cost ?? null);
    const gain = (a: Extract<Action, { type: 'bankTrade' }>) => {
      const g = RESOURCES.find((r) => (a.get[r] ?? 0) > 0)!;
      const give = RESOURCES.find((r) => (a.give[r] ?? 0) > 0)!;
      return wants[g] - wants[give];
    };
    const t = best(byType(acts, 'bankTrade'), gain);
    if (t && (gain(t) > 0 || (pr.handGuard && gain(t) > -1.5 && total(pl.resources) - total(t.give) + 1 <= 7))) return t;
  }
  return acts.find((a) => a.type === 'endTurn') ?? null;
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
      return discardAction(s, p);
    case 'gold':
      return goldAction(s, p);
    case 'robber':
      return (
        pickBest(s, p, pr, byType(acts, 'moveRobber'), (a) => robberScore(s, p, a, pr), (a) => `${a.hex}:${a.victim ?? ''}`) ?? acts[0]
      );
    case 'roadBuilding': {
      const pot = potentialField(s, p);
      const edges = [...byType(acts, 'buildRoad'), ...byType(acts, 'buildShip')];
      const e = best(edges, (a) => edgeScore(s, p, a.edge, pot));
      return e ?? acts.find((a) => a.type === 'endRoadBuilding') ?? acts[0];
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
      const dev = devCardAction(s, p, acts, null, pr);
      if (dev) return dev;
      return acts.find((a) => a.type === 'rollDice') ?? acts[0];
    }
    case 'specialBuild': {
      const city = byType(acts, 'buildCity')[0];
      if (city) return city;
      const prod = production(s, p);
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

/**
 * Plays heuristic bots until the game ends or `maxSteps` is reached (used by
 * tests). Throws if a chosen move is rejected or nobody can act.
 */
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
