import { bankOf, cardRates, handOf } from '../ck/cards.js';
import { BARBARIAN_TRACK, CK_COSTS, TRACKS } from '../ck/constants.js';
import { barbarianStrength, improvementError, improvementPrice, pillageableCities } from '../ck/engine.js';
import { activeStrength, knightsInSupply } from '../ck/knights.js';
import { CARDS, COSTS } from '../core/constants.js';
import type { Action, Card, CardCounts, EdgeId, GameState, PlayerId, VertexId } from '../core/types.js';
import { applyAction } from '../engine/apply.js';
import { legalActions, playersToAct } from '../engine/legal.js';
import { legalCities, legalRoads, legalSettlements, legalShips } from '../engine/placements.js';
import { longestRouteLength } from '../rules/longestRoute.js';
import {
  distanceRuleOk,
  edgeAllowsRoad,
  edgeAllowsShip,
  isBlockedVertex,
  ownsBuildingAt,
  topo,
  vertexTouchesLand,
  vertexZones,
} from '../rules/queries.js';
import { scenarioOf } from '../scenarios/registry.js';
import type { BotLevel } from './heuristicBot.js';

/**
 * The blunder audit: plays computer players and counts moves that are
 * clearly bad by a yardstick of its own (it does not use the bot's scores,
 * so two versions of the bot are measured the same way).
 *
 * - deadEndRoad: a road or ship that can never lead to a new settlement spot
 *   or a scenario goal (it ends at an opponent's building, closes a loop, or
 *   everything beyond it is taken), and doesn't lengthen the player's route
 *   while Longest Road is within reach.
 * - roadOverBuild: a road, ship or development card bought with the cards of
 *   a settlement or city the player could build right then.
 * - missedBuild: the turn ended with a settlement or city it could build.
 * - badTrade: a trade with another player that nothing speaks for: it gets
 *   no build the player could make (city, settlement, development card, a
 *   road or ship that leads somewhere; in C&K also an improvement or a
 *   knight) any closer, and it costs cards or sets one of them back.
 * - wastedBankTrade: a 3:1 or 4:1 trade with the bank that brings no build
 *   closer, and nothing built or bought with it in the same turn.
 * - badDiscard: a discard on a 7 that leaves the hand two or more cards
 *   further from its nearest build (a city, settlement, development card or
 *   improvement) than another discard would, or throws away a settlement or
 *   city it could have kept.
 * - robberOwnHex / robberEmptyHex: the robber (or pirate) on the player's
 *   own hex, or where it hurts nobody, while another hex hurts an opponent
 *   and not the player.
 * - barbarianNeglect (Cities & Knights): it lost a city to the barbarians as
 *   the weakest defender although at the end of its last turn, with the ship
 *   two moves away or closer, it had an idle knight and the grain (or the
 *   cards to trade for it) to wake it, and waking it would have saved the
 *   city.
 * - wastedCard: a Road Building card (development or progress) that placed
 *   no road, or a Merchant Fleet with no 2:1 trade made with it.
 * - stuck: the 60-move safety valve had to end its turn.
 *
 * It also counts, per level, how often a player moved the pirate when it
 * could have moved the robber or the pirate (Seafarers).
 */
export type BlunderKind =
  | 'deadEndRoad'
  | 'roadOverBuild'
  | 'missedBuild'
  | 'badTrade'
  | 'wastedBankTrade'
  | 'badDiscard'
  | 'robberOwnHex'
  | 'robberEmptyHex'
  | 'barbarianNeglect'
  | 'wastedCard'
  | 'stuck';

export const BLUNDER_KINDS: BlunderKind[] = [
  'deadEndRoad',
  'roadOverBuild',
  'missedBuild',
  'badTrade',
  'wastedBankTrade',
  'badDiscard',
  'robberOwnHex',
  'robberEmptyHex',
  'barbarianNeglect',
  'wastedCard',
  'stuck',
];

export interface Blunder {
  kind: BlunderKind;
  player: PlayerId;
  level: BotLevel;
  turn: number;
  detail: string;
}

export type BotFn = (s: GameState, p: PlayerId, level: BotLevel) => Action | null;

export interface AuditResult {
  state: GameState;
  steps: number;
  blunders: Blunder[];
  /** Milliseconds each decision took, per level. */
  times: Record<BotLevel, number[]>;
  /** Robber moves where the pirate could have been moved instead, and how often it was, per level (not blunders). */
  pirate: Record<BotLevel, { options: number; used: number }>;
}

type Hand = Record<Card, number>;

function missingCount(have: Hand, cost: CardCounts): number {
  let n = 0;
  for (const k of CARDS) n += Math.max(0, (cost[k] ?? 0) - have[k]);
  return n;
}

function covers(have: Hand, cost: CardCounts): boolean {
  return missingCount(have, cost) === 0;
}

/**
 * What the player could save for: a city, a settlement, a development card;
 * in C&K improvements and knights; with `edges`, a road or ship that leads
 * somewhere.
 */
function buildTargets(s: GameState, p: PlayerId, edges = false): CardCounts[] {
  const out: CardCounts[] = [];
  // (a road or ship only counts while a settlement piece is left to build at its end)
  if (edges && s.players[p].supply.settlements > 0) {
    if (s.players[p].supply.roads > 0 && legalRoads(s, p).some((e) => edgeLeadsSomewhere(s, p, e, 'road'))) out.push(COSTS.road);
    if (s.players[p].supply.ships > 0 && legalShips(s, p).some((e) => edgeLeadsSomewhere(s, p, e, 'ship'))) out.push(COSTS.ship);
  }
  if (legalCities(s, p).length > 0) out.push(COSTS.city);
  if (s.players[p].supply.settlements > 0 && settlementInReach(s, p)) out.push(COSTS.settlement);
  if (!s.ck && s.devDeck.length > 0) out.push(COSTS.devCard);
  if (s.ck) {
    for (const t of TRACKS) if (improvementError(s, p, t, true) === null) out.push(improvementPrice(s, p, t));
    if (knightsInSupply(s, p, 1) > 0) out.push(CK_COSTS.knight);
    if (Object.values(s.ck.knights).some((k) => k.owner === p && !k.active)) out.push(CK_COSTS.activate);
  }
  return out;
}

/** A settlement spot it can build on now, or a road or ship it can build that leads to one. */
function settlementInReach(s: GameState, p: PlayerId): boolean {
  if (legalSettlements(s, p).length > 0) return true;
  if (s.players[p].supply.roads > 0 && legalRoads(s, p).some((e) => edgeLeadsSomewhere(s, p, e, 'road'))) return true;
  return s.players[p].supply.ships > 0 && legalShips(s, p).some((e) => edgeLeadsSomewhere(s, p, e, 'ship'));
}

function canVPBuild(s: GameState, p: PlayerId): boolean {
  const have = handOf(s, p);
  if (covers(have, COSTS.city) && legalCities(s, p).length > 0) return true;
  return covers(have, COSTS.settlement) && legalSettlements(s, p).length > 0;
}

/** Could a settlement ever stand at `v` (ignoring the road connection and knights)? */
function openSpot(s: GameState, p: PlayerId, v: VertexId): boolean {
  if (!vertexTouchesLand(s, v) || isBlockedVertex(s, v) || !distanceRuleOk(s, v)) return false;
  const sc = scenarioOf(s);
  if (vertexZones(s, v).some((z) => sc.rules.forbiddenZones.includes(z))) return false;
  return (sc.hooks.settlementAllowed?.(s, p, v, false) ?? null) === null;
}

/** Scenario goals a road or ship can lead to: Cloth villages, tribe gifts, the player's fortress, fog to explore. */
function scenarioGoals(s: GameState, p: PlayerId): { vertices: Set<VertexId>; edges: Set<EdgeId> } {
  const vertices = new Set<VertexId>();
  const edges = new Set<EdgeId>();
  const t = topo(s);
  const cloth = s.ext.cloth as { villages: Record<VertexId, { cloth: number; traders: number[] }> } | undefined;
  if (cloth) for (const [v, x] of Object.entries(cloth.villages)) if (x.cloth > 0 && !x.traders.includes(p)) vertices.add(v);
  const tribe = s.ext.tribe as { gifts: Record<EdgeId, string> } | undefined;
  if (tribe) for (const e of Object.keys(tribe.gifts)) edges.add(e);
  const pirate = s.ext.pirateIslands as { fortresses: Array<{ vertex: VertexId; waypoint: VertexId; captured: boolean }> } | undefined;
  const f = pirate?.fortresses[p];
  if (f && !f.captured) {
    vertices.add(f.vertex);
    vertices.add(f.waypoint);
  }
  // fog: a piece reaching an intersection next to it explores it
  for (const [h, hex] of Object.entries(s.board.hexes)) if (hex.terrain === 'fog') for (const v of t.hexVertices[h]) vertices.add(v);
  return { vertices, edges };
}

function blockedFor(s: GameState, p: PlayerId, v: VertexId): boolean {
  const b = s.board.buildings[v];
  if (b && b.owner !== p) return true;
  const k = s.ck?.knights[v];
  return !!k && k.owner !== p;
}

/**
 * Can a road (or ship) on `e` still lead somewhere new: a settlement spot or
 * a scenario goal reachable from its far end without passing an opponent's
 * building, knight or piece? `setup`: the starting road of the settlement
 * just placed.
 */
export function edgeLeadsSomewhere(s: GameState, p: PlayerId, e: EdgeId, kind: 'road' | 'ship', setup = false): boolean {
  const t = topo(s);
  const goals = scenarioGoals(s, p);
  if (goals.edges.has(e)) return true;
  const allows = kind === 'road' ? edgeAllowsRoad : edgeAllowsShip;
  const connected = (v: VertexId) =>
    ownsBuildingAt(s, p, v) ||
    (!setup && !blockedFor(s, p, v) && t.vertexEdges[v].some((o) => o !== e && s.board.pieces[o]?.owner === p && s.board.pieces[o].type === kind));
  const far = t.edgeVertices[e].filter((v) => !connected(v) && !blockedFor(s, p, v));
  const seen = new Set<VertexId>(far);
  const queue = [...far];
  for (let i = 0; i < queue.length; i++) {
    const v = queue[i];
    if (openSpot(s, p, v) || goals.vertices.has(v)) return true;
    if (blockedFor(s, p, v)) continue;
    for (const o of t.vertexEdges[v]) {
      if (o === e || !allows(s, o)) continue;
      const piece = s.board.pieces[o];
      if (piece && piece.owner !== p) continue;
      if (goals.edges.has(o)) return true;
      const [a, b] = t.edgeVertices[o];
      const w = a === v ? b : a;
      if (!seen.has(w)) {
        seen.add(w);
        queue.push(w);
      }
    }
  }
  return false;
}

/** Does lengthening the player's route matter: Longest Road within two pieces, or a rival close behind? */
function routeMatters(before: GameState, after: GameState, p: PlayerId): boolean {
  if (!scenarioOf(before).rules.longestRoute) return false;
  const l0 = longestRouteLength(before, p);
  const l1 = longestRouteLength(after, p);
  if (l1 <= l0) return false;
  const others = Math.max(0, ...before.players.filter((x) => x.id !== p).map((x) => longestRouteLength(before, x.id)));
  const holder = before.longestRoute.holder;
  if (holder === p) return others >= l0 - 1;
  const need = Math.max(5, (holder === null ? others : longestRouteLength(before, holder)) + 1);
  return l1 >= need - 2;
}

const SPENDS = new Set<Action['type']>([
  'buildRoad',
  'buildShip',
  'buildSettlement',
  'buildCity',
  'buyDevCard',
  'buildKnight',
  'activateKnight',
  'promoteKnight',
  'buildCityWall',
  'improveCity',
  'scenario',
]);

function minus(h: Hand, c: CardCounts): Hand {
  const out = { ...h };
  for (const k of CARDS) out[k] -= c[k] ?? 0;
  return out;
}

function plus(h: Hand, c: CardCounts): Hand {
  const out = { ...h };
  for (const k of CARDS) out[k] += c[k] ?? 0;
  return out;
}

function fmt(c: CardCounts): string {
  return CARDS.filter((k) => (c[k] ?? 0) > 0)
    .map((k) => `${c[k]} ${k}`)
    .join(', ');
}

/** The fewest cards missing for any target after the best discard of `n` cards. */
function bestKeep(have: Hand, n: number, targets: CardCounts[]): number {
  const keep = CARDS.reduce((x, k) => x + have[k], 0) - n;
  let top = Infinity;
  for (const t of targets) {
    let lack = 0;
    let usable = 0;
    for (const k of CARDS) {
      lack += Math.max(0, (t[k] ?? 0) - have[k]);
      usable += Math.min(t[k] ?? 0, have[k]);
    }
    top = Math.min(top, lack + Math.max(0, usable - keep));
  }
  return top;
}

interface Watch {
  levels: BotLevel[];
  pirate: Record<BotLevel, { options: number; used: number }>;
  /** Cards played this part of the turn that still have to be used: a Merchant Fleet's kind, or 'roads'. */
  cards: Map<PlayerId, string[]>;
  onBlunder?: (b: Blunder, s: GameState) => void;
  out: Blunder[];
  /** Bank trades waiting for something to be built with them, per player. */
  bank: Map<PlayerId, string[]>;
  /** The state as each player last ended its turn (C&K barbarians). */
  lastEnd: Array<GameState | null>;
}

function note(w: Watch, s: GameState, p: PlayerId, kind: BlunderKind, detail: string): void {
  const b: Blunder = { kind, player: p, level: w.levels[p], turn: s.turn.number, detail };
  w.out.push(b);
  w.onBlunder?.(b, s);
}

function flushBank(w: Watch, s: GameState, p: PlayerId): void {
  for (const d of w.bank.get(p) ?? []) note(w, s, p, 'wastedBankTrade', d);
  w.bank.delete(p);
}

/** Checks one move: `s` before it, `n` after it. */
function inspect(w: Watch, s: GameState, n: GameState, a: Action, forced: boolean): void {
  const p = a.player;
  if (forced) note(w, s, p, 'stuck', `turn ended by the safety valve in ${s.phase.kind}`);
  // a new part of a turn: bank trades of the last actor that built nothing, cards not used
  if (n.turn.part !== s.turn.part) {
    for (const q of [...w.bank.keys()]) flushBank(w, s, q);
    for (const [q, list] of w.cards) for (const c of list) note(w, s, q, 'wastedCard', c === 'roads' ? 'Road Building placed no road' : `Merchant Fleet (${c} 2:1) unused`);
    w.cards.clear();
  }
  if (SPENDS.has(a.type)) w.bank.delete(p);
  const pending = w.cards.get(p) ?? [];
  if (a.type === 'playRoadBuilding' || (a.type === 'playProgress' && a.card === 'roadBuilding')) pending.push('roads');
  if (a.type === 'playProgress' && a.card === 'merchantFleet') pending.push(String(a.args?.resource ?? a.args?.commodity));
  if (a.type === 'buildRoad' || a.type === 'buildShip') pending.splice(0, pending.length, ...pending.filter((c) => c !== 'roads'));
  if (a.type === 'bankTrade') pending.splice(0, pending.length, ...pending.filter((c) => (a.give[c as Card] ?? 0) !== 2));
  if (pending.length > 0) w.cards.set(p, pending);
  else w.cards.delete(p);

  switch (a.type) {
    case 'buildRoad':
    case 'buildShip':
    case 'placeRoad':
    case 'placeShip': {
      const kind = a.type === 'buildShip' || a.type === 'placeShip' ? 'ship' : 'road';
      const pirateRoute = kind === 'ship' && s.ext.pirateIslands !== undefined;
      const setup = a.type === 'placeRoad' || a.type === 'placeShip';
      if (!pirateRoute && !edgeLeadsSomewhere(s, p, a.edge, kind, setup) && !routeMatters(s, n, p)) {
        note(w, s, p, 'deadEndRoad', `${kind} on ${a.edge} (${s.phase.kind}) leads nowhere`);
      }
      if (a.type === 'buildRoad' || a.type === 'buildShip') checkOverBuild(w, s, n, a);
      break;
    }
    case 'buyDevCard':
      checkOverBuild(w, s, n, a);
      break;
    case 'endTurn':
      if (!forced && (s.phase.kind === 'main' || s.phase.kind === 'specialBuild') && canVPBuild(s, p)) {
        note(w, s, p, 'missedBuild', `ended the turn holding ${fmt(handOf(s, p))} with a settlement or city to build`);
      }
      if (s.phase.kind === 'main' && s.turn.actor === p) w.lastEnd[p] = s;
      flushBank(w, s, p);
      break;
    case 'bankTrade': {
      const rate = Math.max(...CARDS.map((k) => a.give[k] ?? 0));
      // (a trade that brings a build closer is fine even when the build waits for another turn)
      const before = handOf(s, p);
      const after = plus(minus(before, a.give), a.get);
      if (rate >= 3 && !tradeHelps(before, after, buildTargets(s, p, true))) {
        const list = w.bank.get(p) ?? [];
        list.push(`gave ${fmt(a.give)} for ${fmt(a.get)} holding ${fmt(handOf(s, p))}`);
        w.bank.set(p, list);
      }
      break;
    }
    case 'confirmTrade': {
      const t = s.turn.trades.find((x) => x.id === a.tradeId);
      if (!t) break;
      const how = t.replyTo !== undefined ? 'counter-offer' : t.open ? 'open offer' : 'offer';
      checkTrade(w, s, t.from, t.give, t.get, `its own ${how}`);
      checkTrade(w, s, a.partner, t.get, t.give, `answering an ${how}`);
      break;
    }
    case 'discard':
      checkDiscard(w, s, a);
      break;
    case 'moveRobber':
      checkRobber(w, s, a);
      break;
    default:
      break;
  }
  if (s.ck && n.ck && n.ck.attacks > s.ck.attacks) checkBarbarians(w, s);
}

function checkOverBuild(w: Watch, s: GameState, n: GameState, a: Action): void {
  const p = a.player;
  if (s.phase.kind !== 'main' && s.phase.kind !== 'specialBuild') return;
  if (!canVPBuild(s, p) || canVPBuild(n, p)) return;
  if (n.phase.kind === 'gameOver' || (n.longestRoute.holder === p && s.longestRoute.holder !== p)) return;
  note(w, s, p, 'roadOverBuild', `${a.type} holding ${fmt(handOf(s, p))} instead of a settlement or city`);
}

/**
 * Player `p` gives `give` and receives `get`: a blunder when nothing speaks
 * for it (no build it could make gets any closer) and it costs cards or sets
 * a build back.
 */
function checkTrade(w: Watch, s: GameState, p: PlayerId, give: CardCounts, get: CardCounts, how: string): void {
  const targets = buildTargets(s, p, true);
  const before = handOf(s, p);
  const after = plus(minus(before, give), get);
  if (!tradeHelps(before, after, targets)) {
    const near = (h: Hand) => Math.min(99, ...targets.map((t) => missingCount(h, t)));
    note(w, s, p, 'badTrade', `${how}: gave ${fmt(give)} for ${fmt(get)} holding ${fmt(before)} (${near(before)} -> ${near(after)} cards short of its nearest build)`);
  }
}

/**
 * The trade yardstick (the bots apply the same one): false when no build in
 * `targets` gets closer and the trade costs cards or sets one of them back.
 */
export function tradeHelps(before: Hand, after: Hand, targets: CardCounts[]): boolean {
  const size = (h: Hand) => CARDS.reduce((n, k) => n + h[k], 0);
  let worse = false;
  for (const t of targets) {
    const d = missingCount(before, t) - missingCount(after, t);
    if (d > 0) return true;
    if (d < 0) worse = true;
  }
  return !(worse || size(after) < size(before));
}

function checkDiscard(w: Watch, s: GameState, a: Extract<Action, { type: 'discard' }>): void {
  const p = a.player;
  const have = handOf(s, p);
  const n = CARDS.reduce((x, k) => x + (a.cards[k] ?? 0), 0);
  const kept = minus(have, a.cards);
  // (what a hand is kept for: not a knight, hired or woken for a card or two)
  const targets = buildTargets(s, p).filter((t) => t !== CK_COSTS.knight && t !== CK_COSTS.activate);
  const chosen = Math.min(...targets.map((t) => missingCount(kept, t)));
  const best = bestKeep(have, n, targets);
  const vp: CardCounts[] = [];
  if (legalCities(s, p).length > 0) vp.push(COSTS.city);
  if (legalSettlements(s, p).length > 0) vp.push(COSTS.settlement);
  const lostBuild = bestKeep(have, n, vp) === 0 && !vp.some((t) => covers(kept, t));
  if (lostBuild || chosen >= best + 2) {
    note(w, s, p, 'badDiscard', `discarded ${fmt(a.cards)} from ${fmt(have)} (${chosen} short of a build, ${best} possible)`);
  }
}

function robberEffect(s: GameState, p: PlayerId, a: Extract<Action, { type: 'moveRobber' }>): { own: number; hurt: number } {
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

function checkRobber(w: Watch, s: GameState, a: Extract<Action, { type: 'moveRobber' }>): void {
  const p = a.player;
  const alts = legalActions(s, p).filter((x): x is Extract<Action, { type: 'moveRobber' }> => x.type === 'moveRobber');
  if (alts.some((x) => x.piece === 'pirate') && alts.some((x) => x.piece === 'robber')) {
    w.pirate[w.levels[p]].options++;
    if (a.piece === 'pirate') w.pirate[w.levels[p]].used++;
  }
  const fx = robberEffect(s, p, a);
  const better = alts.some((x) => {
    const e = robberEffect(s, p, x);
    return e.own === 0 && e.hurt > 0;
  });
  if (!better) return;
  if (fx.own > 0) note(w, s, p, 'robberOwnHex', `${a.piece} on ${a.hex}, next to its own pieces`);
  else if (fx.hurt === 0) note(w, s, p, 'robberEmptyHex', `${a.piece} on ${a.hex}, where it hurts nobody`);
}

/** A lost barbarian attack is about to land in `s`. */
function checkBarbarians(w: Watch, s: GameState): void {
  const strength = s.players.map((pl) => activeStrength(s, pl.id));
  const cities = barbarianStrength(s);
  const total = strength.reduce((x, y) => x + y, 0);
  if (cities <= total) return;
  const eligible = s.players.map((pl) => pl.id).filter((q) => pillageableCities(s, q).length > 0);
  if (eligible.length === 0) return;
  const least = Math.min(...eligible.map((q) => strength[q]));
  for (const p of eligible) {
    if (strength[p] !== least) continue;
    const then = w.lastEnd[p];
    if (!then?.ck || BARBARIAN_TRACK - then.ck.barbarians > 2) continue;
    // an idle knight then that is still idle now
    let level = 0;
    for (const [v, k] of Object.entries(then.ck.knights)) {
      const nowK = s.ck!.knights[v];
      if (k.owner === p && !k.active && nowK?.owner === p && !nowK.active) level = Math.max(level, nowK.level);
    }
    if (level === 0) continue;
    const hand = handOf(then, p);
    const rates = cardRates(then, p);
    const grain = hand.grain >= 1 || (bankOf(then).grain > 0 && CARDS.some((k) => k !== 'grain' && hand[k] >= rates[k]));
    if (!grain) continue;
    const others = eligible.filter((q) => q !== p).map((q) => strength[q]);
    const saved = total + level >= cities || (others.length > 0 && strength[p] + level > Math.min(...others));
    if (saved) note(w, s, p, 'barbarianNeglect', `lost a city with an idle level-${level} knight and grain at hand, ${BARBARIAN_TRACK - then.ck.barbarians} moves out`);
  }
}

/**
 * Plays a game with computer players (as simulateHeuristic does, safety
 * valve included) and audits every move. `levels[p]` is each seat's level.
 */
export function auditGame(
  start: GameState,
  levels: BotLevel[],
  bot: BotFn,
  maxSteps = 12000,
  onBlunder?: (b: Blunder, s: GameState) => void,
): AuditResult {
  const pirate = { easy: { options: 0, used: 0 }, medium: { options: 0, used: 0 }, hard: { options: 0, used: 0 } };
  const w: Watch = { levels, pirate, out: [], bank: new Map(), cards: new Map(), lastEnd: start.players.map(() => null), onBlunder };
  const times: Record<BotLevel, number[]> = { easy: [], medium: [], hard: [] };
  let s = start;
  let steps = 0;
  let partSteps = 0;
  let part = s.turn.part;
  while (s.phase.kind !== 'gameOver' && steps < maxSteps) {
    let acted = false;
    for (const p of playersToAct(s)) {
      const t0 = performance.now();
      let a = bot(s, p, levels[p]);
      times[levels[p]].push(performance.now() - t0);
      if (!a) continue;
      if (s.turn.part !== part) {
        part = s.turn.part;
        partSteps = 0;
      }
      let forced = false;
      if (++partSteps > 60 && s.phase.kind === 'main' && s.turn.actor === p) {
        const end: Action = { type: 'endTurn', player: p };
        if (!s.ck || applyAction(s, end).ok) {
          a = end;
          forced = true;
        }
      }
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`bot move rejected: ${JSON.stringify(a)} -> ${r.error} (phase ${s.phase.kind})`);
      inspect(w, s, r.state, a, forced);
      s = r.state;
      acted = true;
      break;
    }
    if (!acted) throw new Error(`deadlock in phase ${s.phase.kind}`);
    steps++;
  }
  return { state: s, steps, blunders: w.out, times, pirate };
}
