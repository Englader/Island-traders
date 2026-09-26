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
 */

type Kind = Action['type'];

const ROAD_DECAY = 0.7;

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
 */
export function potentialField(s: GameState, p: PlayerId): Map<VertexId, number> {
  const t = topo(s);
  const prod = production(s, p);
  const pot = new Map<VertexId, number>();
  for (const v of t.vertexIds) {
    if (openSpot(s, p, v)) pot.set(v, spotValue(s, p, v, prod));
  }
  for (const [v, val] of scenarioTargets(s, p)) pot.set(v, Math.max(pot.get(v) ?? 0, val));
  const passable = (e: EdgeId) => {
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

function edgeScore(s: GameState, p: PlayerId, e: EdgeId, pot: Map<VertexId, number>): number {
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

function best<T>(items: T[], score: (x: T) => number): T | null {
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

function leaderWeight(s: GameState, p: PlayerId): number {
  const vp = publicVP(s, p);
  return 1 + vp / Math.max(1, s.victoryTarget) * 2;
}

function robberScore(s: GameState, p: PlayerId, a: Extract<Action, { type: 'moveRobber' }>): number {
  const t = topo(s);
  let score = 0;
  if (a.piece === 'robber') {
    const n = pips(s.board.hexes[a.hex].token);
    for (const v of t.hexVertices[a.hex]) {
      const b = s.board.buildings[v];
      if (!b) continue;
      const w = (b.type === 'city' ? 2 : 1) * n;
      score += b.owner === p ? -3 * w : w * leaderWeight(s, b.owner);
    }
  } else {
    for (const e of t.hexEdges[a.hex]) {
      const x = s.board.pieces[e];
      if (x && x.type === 'ship') score += x.owner === p ? -2 : 1;
    }
  }
  if (a.victim !== undefined) score += handSize(s, a.victim) * 0.6 + publicVP(s, a.victim) * 0.4;
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
function choosePlan(s: GameState, p: PlayerId, pot: Map<VertexId, number>): Plan | null {
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
  if (s.devDeck.length > 0) options.push({ cost: COSTS.devCard, action: { type: 'buyDevCard', player: p }, rank: 2.5 });
  const have = pl.resources;
  return best(options, (o) => -(total(missing(have, o.cost)) + o.rank * 0.4));
}

function setupAction(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  const settle = byType(acts, 'placeSettlement');
  if (settle.length > 0) {
    const prod = production(s, p);
    return best(settle, (a) => spotValue(s, p, a.vertex, prod));
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

function respondToTrades(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  for (const t of s.turn.trades) {
    if (!t.to.includes(p) || t.accepted.includes(p) || t.rejected.includes(p)) continue;
    const accept = acts.find((a) => a.type === 'acceptTrade' && a.tradeId === t.id);
    const reject = acts.find((a) => a.type === 'rejectTrade' && a.tradeId === t.id);
    const target = s.players[p].supply.settlements > 0 ? COSTS.settlement : COSTS.city;
    const wants = resourceWants(s, p, target);
    let gain = 0;
    for (const r of RESOURCES) gain += (t.give[r] ?? 0) * wants[r] - (t.get[r] ?? 0) * wants[r];
    const proposerClose = totalVPPublic(s, t.from) >= s.victoryTarget - 2;
    if (accept && gain > 0.4 && !proposerClose) return accept;
    if (reject) return reject;
  }
  return null;
}

function totalVPPublic(s: GameState, p: PlayerId): number {
  return publicVP(s, p);
}

function devCardAction(s: GameState, p: PlayerId, acts: Action[], plan: Plan | null): Action | null {
  const knight = acts.find((a) => a.type === 'playKnight');
  if (knight) {
    const t = topo(s);
    const blocked =
      s.board.robber !== null && t.hexVertices[s.board.robber].some((v) => s.board.buildings[v]?.owner === p);
    const army = s.largestArmy.holder;
    const mine = s.players[p].playedKnights + 1;
    const armyGain =
      scenarioOf(s).rules.largestArmy && army !== p && mine >= 3 && (army === null || mine > s.players[army].playedKnights);
    // Pirate Islands: a knight arms the rearmost normal ship, so keep it until there is one.
    const warship =
      s.ext.pirateIslands !== undefined &&
      Object.values(s.board.pieces).some((x) => x.owner === p && x.type === 'ship' && !x.warship);
    if (blocked || armyGain || warship) return knight;
  }
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

function mainAction(s: GameState, p: PlayerId, acts: Action[]): Action | null {
  const pl = s.players[p];
  // A harbor that must or may be placed.
  const harbors = byType(acts, 'placeHarbor');
  if (harbors.length > 0) return best(harbors, (a) => harborScore(s, p, a.edge));

  const pot = potentialField(s, p);
  const plan = choosePlan(s, p, pot);

  const dev = devCardAction(s, p, acts, plan);
  if (dev) return dev;

  // Immediate builds, best first.
  const prod = production(s, p);
  const city = byType(acts, 'buildCity');
  if (city.length > 0) return best(city, (a) => spotValue(s, p, a.vertex, prod));
  const settle = byType(acts, 'buildSettlement');
  if (settle.length > 0) return best(settle, (a) => spotValue(s, p, a.vertex, prod));
  const scen = scenarioMainAction(s, p, acts);
  if (scen) return scen;

  if (plan) {
    if (applyAction(s, plan.action).ok) return plan.action;
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
  const edge = best(edges, (a) => edgeScore(s, p, a.edge, pot));
  if (edge && edgeScore(s, p, edge.edge, pot) > 1 && spare(edge.type === 'buildRoad' ? COSTS.road : COSTS.ship)) return edge;
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
    if (t && gain(t) > 0) return t;
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
export function heuristicAction(s: GameState, p: PlayerId): Action | null {
  const acts = legalActions(s, p);
  if (acts.length === 0) return null;
  const ph = s.phase;
  switch (ph.kind) {
    case 'harborPlacement':
      return best(byType(acts, 'placeHarbor'), (a) => harborScore(s, p, a.edge));
    case 'setup':
      return setupAction(s, p, acts);
    case 'discard':
      return discardAction(s, p);
    case 'gold':
      return goldAction(s, p);
    case 'robber':
      return best(byType(acts, 'moveRobber'), (a) => robberScore(s, p, a)) ?? acts[0];
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
      const dev = devCardAction(s, p, acts, null);
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
      if (s.turn.actor !== p) return respondToTrades(s, p, acts);
      return mainAction(s, p, acts);
    }
    default:
      return acts[0];
  }
}

/**
 * Plays heuristic bots until the game ends or `maxSteps` is reached (used by
 * tests). Throws if a chosen move is rejected or nobody can act.
 */
export function simulateHeuristic(initial: GameState, maxSteps = 5000): { state: GameState; steps: number } {
  let s = initial;
  let steps = 0;
  let partSteps = 0;
  let part = s.turn.part;
  while (s.phase.kind !== 'gameOver' && steps < maxSteps) {
    let acted = false;
    for (const p of playersToAct(s)) {
      let a = heuristicAction(s, p);
      if (!a) continue;
      if (s.turn.part !== part) {
        part = s.turn.part;
        partSteps = 0;
      }
      // Safety valve: a part of a turn never runs forever.
      if (++partSteps > 60 && s.phase.kind === 'main' && s.turn.actor === p) a = { type: 'endTurn', player: p };
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`bot move rejected: ${JSON.stringify(a)} -> ${r.error} (phase ${s.phase.kind})`);
      s = r.state;
      acted = true;
      break;
    }
    if (!acted) throw new Error(`deadlock in phase ${s.phase.kind}`);
    steps++;
  }
  return { state: s, steps };
}
