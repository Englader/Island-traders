import { bankHas, cardKinds, cardRates, hasCards, moveCards, sameCards, stealRandomCard, validCards } from '../ck/cards.js';
// Cities & Knights: registers the progress-card effects
import '../ck/effects.js';
import { CHASED_ROBBER_NEEDS_NUMBER } from '../ck/constants.js';
import {
  ckAction,
  ckCityError,
  ckEndTurnError,
  ckRollDice,
  ckSettle,
  isTipped,
  robberActive,
  setupPlacesCity,
  sevenLimit,
  untip,
} from '../ck/engine.js';
import { COSTS, LARGEST_ARMY_MIN, RESOURCES } from '../core/constants.js';
import { cardTotal, hasAtLeast, isResource, total, validCounts } from '../core/resources.js';
import { rollDie } from '../core/rng.js';
import type {
  Action,
  ApplyResult,
  DevCardType,
  EdgeId,
  GameState,
  HarborType,
  HexId,
  Phase,
  PlayerId,
  TradeOffer,
  TurnRole,
  VertexId,
} from '../core/types.js';
import {
  addGoldChoice,
  describeCounts,
  drawDevCard,
  log,
  nameOf,
  payFromBank,
  payToBank,
  stealRandom,
} from '../rules/helpers.js';
import { updateLongestRoute } from '../rules/longestRoute.js';
import { produce, startingResources } from '../rules/production.js';
import {
  cityError,
  handSize,
  isLandHex,
  isSeaHex,
  legalRobberMoves,
  pirateHexError,
  robberHexError,
  robberVictimsAt,
  roadError,
  settlementError,
  setupSettlementError,
  shipError,
  topo,
  totalVP,
  tradeRates,
  vertexZones,
} from '../rules/queries.js';
import { moveShipError } from '../rules/ships.js';
import { scenarioOf } from '../scenarios/registry.js';
import { legalEdgePlacements, legalRoads, legalSetupSettlements, legalShips } from './placements.js';
import { noteProduction, recordStats } from './stats.js';

type A<T extends Action['type']> = Extract<Action, { type: T }>;

/**
 * Deep copy for the next state. Log entries are never mutated once written,
 * so the log array is copied shallowly (cloning it deeply would make long
 * games quadratic).
 */
export function cloneState(state: GameState): GameState {
  const { log, ...rest } = state;
  const copy = structuredClone(rest) as GameState;
  copy.log = log.slice();
  return copy;
}

/**
 * The rules engine: a pure function (state, action) -> new state | error.
 * The input state is never mutated.
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
  if (state.phase.kind === 'gameOver') return { ok: false, error: 'the game is over' };
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return { ok: false, error: 'malformed action' };
  }
  if (!Number.isInteger(action.player) || action.player < 0 || action.player >= state.players.length) {
    return { ok: false, error: 'unknown player' };
  }
  const s = cloneState(state);
  const error = dispatch(s, action);
  if (error) return { ok: false, error };
  settle(s);
  recordStats(state, s, action);
  return { ok: true, state: s };
}

function dispatch(s: GameState, a: Action): string | null {
  switch (a.type) {
    case 'placeHarbor':
      return placeHarbor(s, a);
    case 'placeSettlement':
      return setupSettlement(s, a);
    case 'placeRoad':
      return setupEdge(s, a.player, a.edge, 'road');
    case 'placeShip':
      return setupEdge(s, a.player, a.edge, 'ship');
    case 'rollDice':
      return rollDice(s, a);
    case 'discard':
      return discard(s, a);
    case 'moveRobber':
      return moveRobber(s, a);
    case 'chooseGold':
      return chooseGold(s, a);
    case 'buildRoad':
      return buildEdge(s, a.player, a.edge, 'road');
    case 'buildShip':
      return buildEdge(s, a.player, a.edge, 'ship');
    case 'buildSettlement':
      return buildSettlement(s, a);
    case 'buildCity':
      return buildCity(s, a);
    case 'buyDevCard':
      return buyDevCard(s, a);
    case 'moveShip':
      return moveShip(s, a);
    case 'playKnight':
      return playKnight(s, a);
    case 'playRoadBuilding':
      return playRoadBuilding(s, a);
    case 'playYearOfPlenty':
      return playYearOfPlenty(s, a);
    case 'playMonopoly':
      return playMonopoly(s, a);
    case 'endRoadBuilding':
      return endRoadBuilding(s, a);
    case 'proposeTrade':
      return proposeTrade(s, a);
    case 'acceptTrade':
      return acceptTrade(s, a);
    case 'rejectTrade':
      return rejectTrade(s, a);
    case 'confirmTrade':
      return confirmTrade(s, a);
    case 'cancelTrade':
      return cancelTrade(s, a);
    case 'bankTrade':
      return bankTrade(s, a);
    case 'endTurn':
      return endTurn(s, a);
    case 'buildKnight':
    case 'activateKnight':
    case 'promoteKnight':
    case 'moveKnight':
    case 'displaceKnight':
    case 'retreatKnight':
    case 'chaseRobber':
    case 'buildCityWall':
    case 'improveCity':
    case 'pillageCity':
    case 'drawProgress':
    case 'discardProgress':
    case 'aqueduct':
    case 'playProgress':
    case 'progressChoice':
      return ckAction(s, a);
    case 'scenario': {
      const handler = scenarioOf(s).hooks.action;
      if (!handler) return 'this scenario has no special actions';
      const err = handler(s, a);
      if (err) return err;
      if (s.ext.forceEndTurn) {
        delete s.ext.forceEndTurn;
        // A win earned by the action counts before the turn passes on.
        checkVictory(s);
        if (s.phase.kind === 'gameOver') return null;
        return endTurn(s, { type: 'endTurn', player: a.player });
      }
      return null;
    }
    default:
      return `unknown action type "${(a as { type: string }).type}"`;
  }
}

// ---------------------------------------------------------------------------
// Turn bookkeeping
// ---------------------------------------------------------------------------

export function setupOrder(s: GameState, round: number): PlayerId[] {
  const n = s.players.length;
  const order = Array.from({ length: n }, (_, i) => (s.firstPlayer + i) % n);
  return scenarioOf(s).rules.setupRounds[round].order === 'forward' ? order : order.reverse();
}

function beginPart(s: GameState, p: PlayerId, role: TurnRole): void {
  s.turn.part++;
  s.turn.actor = p;
  s.turn.role = role;
  s.turn.devCardPlayed = false;
  s.turn.shipMoved = false;
  s.turn.buildingStarted = false;
  s.turn.trades = [];
  s.turn.offers = 0;
  if (s.ck) s.ck.turnEffects = [];
}

function startTurn(s: GameState, p: PlayerId): void {
  s.turn.number++;
  s.turn.current = p;
  s.turn.dice = null;
  if (s.ck) s.ck.event = null;
  beginPart(s, p, 'active');
  s.phase = { kind: 'preRoll' };
  log(s, `--- Turn ${s.turn.number}: ${nameOf(s, p)} ---`);
}

function nextTurn(s: GameState): void {
  startTurn(s, (s.turn.current + 1) % s.players.length);
}

function isActor(s: GameState, p: PlayerId): boolean {
  return s.turn.actor === p;
}

/** Building is allowed in the main phase (active or paired player) and the special build phase. */
function buildPhaseError(s: GameState, p: PlayerId): string | null {
  if (!isActor(s, p)) return 'it is not your turn';
  if (s.phase.kind === 'main' || s.phase.kind === 'specialBuild') return null;
  if (s.phase.kind === 'preRoll') return 'roll the dice first';
  return 'you cannot build right now';
}

function mainPhaseError(s: GameState, p: PlayerId, roles: TurnRole[]): string | null {
  if (!isActor(s, p)) return 'it is not your turn';
  if (s.phase.kind !== 'main') return s.phase.kind === 'preRoll' ? 'roll the dice first' : 'not allowed right now';
  if (!roles.includes(s.turn.role)) return 'not allowed in this part of the turn';
  return null;
}

function gameOver(s: GameState, winner: PlayerId | null, reason: string): void {
  s.phase = { kind: 'gameOver', winner, reason };
  log(s, winner === null ? `Game over: ${reason}` : `${nameOf(s, winner)} wins: ${reason}`);
}

/**
 * Where the robber phase lets the actor move the robber or pirate: every
 * legal move, limited to one piece when a knight chased it away (Cities &
 * Knights), and for the chased robber to numbered hexes.
 */
export function robberPhaseMoves(s: GameState): Array<{ piece: 'robber' | 'pirate'; hex: HexId }> {
  const ph = s.phase;
  const moves = legalRobberMoves(s, s.turn.actor);
  if (ph.kind !== 'robber' || (!ph.piece && ph.reason !== 'chase')) return moves;
  return moves.filter((m) => (!ph.piece || m.piece === ph.piece) && chasedHexOk(s, ph.reason, m.piece, m.hex));
}

function chasedHexOk(s: GameState, reason: string, piece: 'robber' | 'pirate', hex: HexId): boolean {
  return !(reason === 'chase' && piece === 'robber' && CHASED_ROBBER_NEEDS_NUMBER && s.board.hexes[hex]?.token == null);
}

/** Auto-resolves phases with nothing left to do, then checks for the end of the game. */
function settle(s: GameState): void {
  for (let guard = 0; guard < 20; guard++) {
    const ph = s.phase;
    if (ph.kind === 'ck' && ckSettle(s)) continue;
    if (ph.kind === 'robber' && robberPhaseMoves(s).length === 0) {
      log(s, 'The robber cannot move anywhere');
      s.phase = ph.resume;
      continue;
    }
    if (ph.kind === 'roadBuilding' && (ph.remaining <= 0 || legalEdgePlacements(s, s.turn.actor).length === 0)) {
      s.phase = ph.resume;
      continue;
    }
    if (ph.kind === 'gold') {
      if (total(s.bank) === 0) {
        log(s, 'The bank is empty: gold choices lapse');
        s.phase = ph.resume;
        continue;
      }
      if (Object.keys(ph.pending).length === 0) {
        s.phase = ph.resume;
        continue;
      }
    }
    if (ph.kind === 'discard' && ph.lazy) {
      s.phase = { kind: 'discard', pending: sevenDiscards(s), resume: ph.resume };
      continue;
    }
    if (ph.kind === 'discard' && Object.keys(ph.pending).length === 0) {
      s.phase = ph.resume;
      continue;
    }
    // Degenerate crowded boards: skip a starting placement that has no legal spot.
    if (ph.kind === 'setup') {
      const p = currentSetupPlayer(s)!;
      const stuck =
        ph.step === 'settlement'
          ? legalSetupSettlements(s, p).length === 0
          : legalRoads(s, p, ph.vertex).length + legalShips(s, p, ph.vertex).length === 0;
      if (stuck) {
        log(s, `${nameOf(s, p)} has no legal starting ${ph.step === 'settlement' ? 'settlement' : 'road'} and skips it`);
        advanceSetup(s);
        continue;
      }
    }
    if (ph.kind === 'harborPlacement' && !topo(s).edgeIds.some((e) => harborEdgeError(s, e, null) === null)) {
      log(s, 'No legal harbor spots remain');
      beginSetup(s);
      continue;
    }
    break;
  }
  checkVictory(s);
}

export function checkVictory(s: GameState): void {
  if (s.phase.kind === 'gameOver') return;
  const sc = scenarioOf(s);
  const end = sc.hooks.checkEnd?.(s);
  if (end) {
    gameOver(s, end.winner, end.reason);
    return;
  }
  if (s.turn.number === 0 || s.phase.kind === 'setup' || s.phase.kind === 'harborPlacement') return;
  if (s.turn.role === 'specialBuild') return;
  const p = s.turn.actor;
  const instant = sc.hooks.instantWin?.(s, p);
  if (instant) {
    gameOver(s, p, instant);
    return;
  }
  const vp = totalVP(s, p);
  if (vp >= s.victoryTarget && (sc.hooks.canWin?.(s, p) ?? true)) {
    gameOver(s, p, `${vp} victory points`);
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function currentSetupPlayer(s: GameState): PlayerId | null {
  if (s.phase.kind !== 'setup') return null;
  return setupOrder(s, s.phase.round)[s.phase.index];
}

function setupSettlement(s: GameState, a: A<'placeSettlement'>): string | null {
  const ph = s.phase;
  if (ph.kind !== 'setup' || ph.step !== 'settlement') return 'not placing a starting settlement now';
  if (currentSetupPlayer(s) !== a.player) return 'it is not your turn to place';
  const err = setupSettlementError(s, a.player, a.vertex);
  if (err) return err;
  const pl = s.players[a.player];
  // Cities & Knights: the placement that collects starting resources is a city.
  const city = setupPlacesCity(s, ph.round);
  s.board.buildings[a.vertex] = { owner: a.player, type: city ? 'city' : 'settlement' };
  if (city) pl.supply.cities--;
  else pl.supply.settlements--;
  for (const z of vertexZones(s, a.vertex)) if (!pl.homeZones.includes(z)) pl.homeZones.push(z);
  log(s, `${pl.name} places a starting ${city ? 'city' : 'settlement'}`);
  const round = scenarioOf(s).rules.setupRounds[ph.round];
  let gold = 0;
  if (round.collect) {
    const before = { ...pl.resources };
    gold = startingResources(s, a.player, a.vertex).gold;
    const got: Record<string, number> = {};
    for (const r of RESOURCES) if (pl.resources[r] > before[r]) got[r] = pl.resources[r] - before[r];
    log(s, `${pl.name} takes ${describeCounts(got)}`);
  }
  s.phase = { ...ph, step: 'edge', vertex: a.vertex };
  scenarioOf(s).hooks.afterSettlement?.(s, a.player, a.vertex, true);
  if (gold > 0 && s.options.setupGoldYield === 'choose') addGoldChoice(s, { [a.player]: gold });
  return null;
}

function setupEdge(s: GameState, p: PlayerId, e: EdgeId, kind: 'road' | 'ship'): string | null {
  const ph = s.phase;
  if (ph.kind !== 'setup' || ph.step !== 'edge' || ph.vertex === null) return 'not placing a starting road now';
  if (currentSetupPlayer(s) !== p) return 'it is not your turn to place';
  const err = kind === 'road' ? roadError(s, p, e, ph.vertex) : shipError(s, p, e, ph.vertex);
  if (err) return err;
  placeEdgePiece(s, p, e, kind);
  log(s, `${nameOf(s, p)} places a starting ${kind}`);
  advanceSetup(s);
  scenarioOf(s).hooks.afterEdge?.(s, p, e, kind, true);
  return null;
}

/** Moves the snake draft to the next placement (or on to the game). */
function advanceSetup(s: GameState): void {
  const ph = s.phase;
  if (ph.kind !== 'setup') return;
  let { round, index } = ph;
  index++;
  if (index >= s.players.length) {
    round++;
    index = 0;
  }
  if (round >= scenarioOf(s).rules.setupRounds.length) {
    finishSetup(s);
  } else {
    s.phase = { kind: 'setup', round, index, step: 'settlement', vertex: null };
    s.turn.actor = currentSetupPlayer(s)!;
  }
}

function finishSetup(s: GameState): void {
  startTurn(s, s.firstPlayer);
}

/** Starts the snake draft (after any harbor placement by players). */
export function beginSetup(s: GameState): void {
  s.phase = { kind: 'setup', round: 0, index: 0, step: 'settlement', vertex: null };
  s.turn.actor = currentSetupPlayer(s)!;
}

function placeEdgePiece(s: GameState, p: PlayerId, e: EdgeId, kind: 'road' | 'ship'): void {
  s.board.pieces[e] = { owner: p, type: kind, placedPart: s.turn.part };
  if (kind === 'road') s.players[p].supply.roads--;
  else s.players[p].supply.ships--;
}

// ---------------------------------------------------------------------------
// Harbors placed by players (New World) or won as gifts (Forgotten Tribe)
// ---------------------------------------------------------------------------

export function harborEdgeError(s: GameState, e: EdgeId, owner: PlayerId | null): string | null {
  const t = topo(s);
  const hexes = t.edgeHexes[e];
  if (!hexes) return 'no such path';
  const [a, b] = hexes;
  const coast = (isSeaHex(s, a) && isLandHex(s, b)) || (isSeaHex(s, b) && isLandHex(s, a));
  if (!coast) return 'harbors must be placed on a coast';
  const land = isLandHex(s, a) ? a : b;
  if (s.board.hexes[land].terrain === 'desert') return 'harbors may not face a desert';
  const used = new Set<VertexId>();
  for (const h of s.board.harbors) for (const v of t.edgeVertices[h.edge]) used.add(v);
  if (t.edgeVertices[e].some((v) => used.has(v))) return 'too close to another harbor';
  if (owner !== null && !t.edgeVertices[e].some((v) => s.board.buildings[v]?.owner === owner)) {
    return 'the harbor must be next to your own settlement or city';
  }
  return null;
}

function placeHarbor(s: GameState, a: A<'placeHarbor'>): string | null {
  if (s.phase.kind === 'harborPlacement') {
    const ph = s.phase;
    if (ph.queue[0] !== a.player) return 'it is not your turn to place a harbor';
    const pool = s.ext.harborPool as HarborType[];
    const err = harborEdgeError(s, a.edge, null);
    if (err) return err;
    const type = pool.pop()!;
    s.board.harbors.push({ edge: a.edge, type });
    log(s, `${nameOf(s, a.player)} places a ${type} harbor`);
    const queue = ph.queue.slice(1);
    if (queue.length === 0 || pool.length === 0) {
      beginSetup(s);
    } else {
      s.phase = { kind: 'harborPlacement', queue };
      s.turn.actor = queue[0];
    }
    return null;
  }
  // Held harbor (e.g. a Forgotten Tribe gift): placed at once when received, or later on your own turn.
  const held = (s.ext.heldHarbors as Record<string, HarborType[]> | undefined)?.[a.player] ?? [];
  if (held.length === 0) return 'you have no harbor to place';
  const ph = s.phase;
  const mustPlaceNow = ph.kind === 'scenario' && ph.step === 'placeHarbor';
  if (mustPlaceNow) {
    if (ph.player !== a.player) return 'it is not your harbor to place';
  } else {
    const e = mainPhaseError(s, a.player, ['active', 'paired']);
    if (e) return e;
  }
  const idx = a.index ?? 0;
  if (!Number.isInteger(idx) || idx < 0 || idx >= held.length) return 'no such harbor';
  const err = harborEdgeError(s, a.edge, a.player);
  if (err) return err;
  const [type] = held.splice(idx, 1);
  s.board.harbors.push({ edge: a.edge, type });
  log(s, `${nameOf(s, a.player)} places a ${type} harbor`);
  if (mustPlaceNow) s.phase = ph.resume;
  return null;
}

// ---------------------------------------------------------------------------
// Rolling, discarding, robber, gold
// ---------------------------------------------------------------------------

function robberPhaseOr(s: GameState, reason: 'seven' | 'knight', resume: Phase): Phase {
  const r = scenarioOf(s).rules;
  if (!r.robber && !r.pirate) return resume;
  return { kind: 'robber', reason, resume };
}

function rollDice(s: GameState, a: A<'rollDice'>): string | null {
  if (s.phase.kind !== 'preRoll') return 'you cannot roll now';
  if (!isActor(s, a.player)) return 'it is not your turn';
  if (s.ck) {
    // the event die first, then production (src/ck/engine.ts)
    ckRollDice(s, a.player);
    return null;
  }
  const dice: [number, number] = [rollDie(s.rng), rollDie(s.rng)];
  s.turn.dice = dice;
  (s.rolls ??= []).push({ by: a.player, dice: [dice[0], dice[1]], turn: s.turn.number });
  const sum = dice[0] + dice[1];
  log(s, `${nameOf(s, a.player)} rolls ${sum} (${dice[0]}+${dice[1]})`);
  const owed = scenarioOf(s).hooks.beforeProduction?.(s, dice) ?? {};
  if (sum === 7) {
    const after = robberPhaseOr(s, 'seven', { kind: 'main' });
    // Discards are counted once any free picks from before the roll resolved.
    s.phase = { kind: 'discard', pending: {}, resume: after, lazy: true };
    addGoldChoice(s, owed);
  } else {
    s.phase = { kind: 'main' };
    const prod = produce(s, sum);
    noteProduction(s, prod.dealt);
    const gold: Record<number, number> = { ...prod.gold };
    for (const [p, n] of Object.entries(owed)) gold[Number(p)] = (gold[Number(p)] ?? 0) + n;
    addGoldChoice(s, gold);
  }
  scenarioOf(s).hooks.afterRoll?.(s, dice);
  return null;
}

/** Players holding more than the limit (Cities & Knights: +2 per city wall) discard half, rounded down. */
function sevenDiscards(s: GameState): Record<string, number> {
  const pending: Record<string, number> = {};
  for (const pl of s.players) {
    const n = handSize(s, pl.id);
    if (n > sevenLimit(s, pl.id)) pending[pl.id] = Math.floor(n / 2);
  }
  return pending;
}

function discard(s: GameState, a: A<'discard'>): string | null {
  const ph = s.phase;
  if (ph.kind !== 'discard') return 'no discards are due';
  const need = ph.pending[a.player];
  if (need === undefined) return 'you do not need to discard';
  if (!validCards(s, a.cards)) return 'invalid cards';
  if (cardTotal(a.cards) !== need) return `you must discard exactly ${need} cards`;
  if (!hasCards(s, a.player, a.cards)) return 'you do not have those cards';
  moveCards(s, a.player, 'bank', a.cards);
  delete ph.pending[a.player];
  log(s, `${nameOf(s, a.player)} discards ${describeCounts(a.cards)}`);
  return null;
}

function moveRobber(s: GameState, a: A<'moveRobber'>): string | null {
  const ph = s.phase;
  if (ph.kind !== 'robber') return 'the robber is not being moved now';
  if (!isActor(s, a.player)) return 'it is not your turn';
  if (a.piece !== 'robber' && a.piece !== 'pirate') return 'unknown piece';
  if (!robberActive(s)) return 'the robber stays put until the barbarians first attack';
  if (ph.piece && a.piece !== ph.piece) return `only the ${ph.piece} can be moved now`;
  if (!chasedHexOk(s, ph.reason, a.piece, a.hex)) return 'a chased robber must go to a hex with a number';
  const hooks = scenarioOf(s).hooks;
  if (a.piece === 'pirate' && hooks.canMovePirate && !hooks.canMovePirate(s, a.player)) {
    return 'you cannot move the pirate yet';
  }
  const err = a.piece === 'robber' ? robberHexError(s, a.player, a.hex) : pirateHexError(s, a.hex);
  if (err) return err;
  const victims = robberVictimsAt(s, a.player, a.piece, a.hex);
  if (ph.reason === 'bishop') return bishopRobs(s, a, victims);
  if (victims.length > 0) {
    if (a.victim === undefined) return 'choose a player to rob';
    if (!victims.includes(a.victim)) return 'that player cannot be robbed from here';
  } else if (a.victim !== undefined) {
    return 'nobody can be robbed there';
  }
  const take = a.take ?? 'resource';
  if (take !== 'resource') {
    if (a.victim === undefined) return 'nobody to take from';
    const choices = hooks.stealChoices?.(s, a.player, a.victim, a.piece) ?? [];
    if (!choices.includes(take)) return `you cannot take ${take} from that player`;
  }
  if (a.piece === 'robber') s.board.robber = a.hex;
  else s.board.pirate = a.hex;
  log(s, `${nameOf(s, a.player)} moves the ${a.piece}`);
  if (a.victim !== undefined) {
    // Cities & Knights: the robber takes resources and commodities alike.
    if (take === 'resource') {
      if (s.ck) stealRandomCard(s, a.player, a.victim);
      else stealRandom(s, a.player, a.victim);
    } else hooks.steal!(s, a.player, a.victim, take);
  }
  s.phase = ph.resume;
  return null;
}

/**
 * Cities & Knights, the Bishop (Almanac p. 16): the robber moves as usual and
 * its mover draws one random card (resource or commodity) from every player
 * with a settlement or city next to its new hex, one per player.
 */
function bishopRobs(s: GameState, a: A<'moveRobber'>, victims: PlayerId[]): string | null {
  const ph = s.phase as Extract<Phase, { kind: 'robber' }>;
  if (a.victim !== undefined || (a.take !== undefined && a.take !== 'resource')) {
    return 'the Bishop takes a card from every player next to the robber: name no victim';
  }
  s.board.robber = a.hex;
  log(s, `${nameOf(s, a.player)} moves the robber`);
  if (victims.length === 0) log(s, 'Nobody is next to the robber');
  for (const v of victims) stealRandomCard(s, a.player, v);
  s.phase = ph.resume;
  return null;
}

function chooseGold(s: GameState, a: A<'chooseGold'>): string | null {
  const ph = s.phase;
  if (ph.kind !== 'gold') return 'no gold choices are due';
  const owed = ph.pending[a.player];
  if (owed === undefined) return 'you are not owed any gold';
  if (!validCounts(a.resources)) return 'invalid resources';
  const need = Math.min(owed, total(s.bank));
  if (total(a.resources) !== need) return `choose exactly ${need} resources`;
  if (!hasAtLeast(s.bank, a.resources)) return 'the bank does not have those resources';
  payFromBank(s, a.player, a.resources);
  delete ph.pending[a.player];
  log(s, `${nameOf(s, a.player)} takes ${describeCounts(a.resources)} (gold)`);
  return null;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function buildEdge(s: GameState, p: PlayerId, e: EdgeId, kind: 'road' | 'ship'): string | null {
  const free = s.phase.kind === 'roadBuilding';
  if (free) {
    if (!isActor(s, p)) return 'it is not your turn';
  } else {
    const err = buildPhaseError(s, p);
    if (err) return err;
  }
  const err = kind === 'road' ? roadError(s, p, e) : shipError(s, p, e);
  if (err) return err;
  if (!free) {
    const cost = kind === 'road' ? COSTS.road : COSTS.ship;
    if (!hasAtLeast(s.players[p].resources, cost)) return 'not enough resources';
    payToBank(s, p, cost);
    s.turn.buildingStarted = true;
  }
  placeEdgePiece(s, p, e, kind);
  log(s, `${nameOf(s, p)} builds a ${kind}${free ? ' (Road Building)' : ''}`);
  if (s.phase.kind === 'roadBuilding') s.phase.remaining--;
  updateLongestRoute(s);
  scenarioOf(s).hooks.afterEdge?.(s, p, e, kind, false);
  return null;
}

/** First settlement in a foreign zone earns VP chits (Seafarers island bonus). */
function islandBonus(s: GameState, p: PlayerId, v: VertexId): void {
  const bonus = scenarioOf(s).rules.islandBonus;
  if (!bonus) return;
  const pl = s.players[p];
  const home = bonus.home === 'setup' ? pl.homeZones : bonus.home;
  for (const z of vertexZones(s, v)) {
    if (home.includes(z) || pl.bonusZones.includes(z)) continue;
    pl.bonusZones.push(z);
    pl.bonusVP += bonus.vp;
    log(s, `${pl.name} settles a new area and earns ${bonus.vp} VP`);
  }
}

function buildSettlement(s: GameState, a: A<'buildSettlement'>): string | null {
  const e = buildPhaseError(s, a.player);
  if (e) return e;
  const err = settlementError(s, a.player, a.vertex);
  if (err) return err;
  if (!hasAtLeast(s.players[a.player].resources, COSTS.settlement)) return 'not enough resources';
  payToBank(s, a.player, COSTS.settlement);
  s.turn.buildingStarted = true;
  s.board.buildings[a.vertex] = { owner: a.player, type: 'settlement' };
  s.players[a.player].supply.settlements--;
  log(s, `${nameOf(s, a.player)} builds a settlement`);
  islandBonus(s, a.player, a.vertex);
  updateLongestRoute(s);
  scenarioOf(s).hooks.afterSettlement?.(s, a.player, a.vertex, false);
  return null;
}

function buildCity(s: GameState, a: A<'buildCity'>): string | null {
  const e = buildPhaseError(s, a.player);
  if (e) return e;
  // Cities & Knights: a pillaged city lying on its side is rebuilt first, and needs no city from the supply.
  const tipped = isTipped(s, a.vertex) && s.board.buildings[a.vertex]?.owner === a.player;
  const err = tipped ? null : cityError(s, a.player, a.vertex);
  if (err) return err;
  const ckErr = s.ck ? ckCityError(s, a.player, a.vertex) : null;
  if (ckErr) return ckErr;
  if (!hasAtLeast(s.players[a.player].resources, COSTS.city)) return 'not enough resources';
  payToBank(s, a.player, COSTS.city);
  s.turn.buildingStarted = true;
  s.board.buildings[a.vertex] = { owner: a.player, type: 'city' };
  if (tipped) {
    untip(s, a.vertex);
  } else {
    s.players[a.player].supply.cities--;
    s.players[a.player].supply.settlements++;
  }
  log(s, `${nameOf(s, a.player)} upgrades to a city`);
  return null;
}

function buyDevCard(s: GameState, a: A<'buyDevCard'>): string | null {
  const e = buildPhaseError(s, a.player);
  if (e) return e;
  if (s.ck) return 'Cities & Knights has no development cards';
  if (s.devDeck.length === 0) return 'the development card deck is empty';
  if (!hasAtLeast(s.players[a.player].resources, COSTS.devCard)) return 'not enough resources';
  payToBank(s, a.player, COSTS.devCard);
  s.turn.buildingStarted = true;
  log(s, `${nameOf(s, a.player)} buys a development card`);
  drawDevCard(s, a.player);
  return null;
}

function moveShip(s: GameState, a: A<'moveShip'>): string | null {
  const e = mainPhaseError(s, a.player, ['active', 'paired']);
  if (e) return e;
  const err = moveShipError(s, a.player, a.from, a.to);
  if (err) return err;
  const piece = s.board.pieces[a.from];
  delete s.board.pieces[a.from];
  s.board.pieces[a.to] = { ...piece };
  s.turn.shipMoved = true;
  s.turn.buildingStarted = true;
  log(s, `${nameOf(s, a.player)} moves a ship`);
  updateLongestRoute(s);
  scenarioOf(s).hooks.afterEdge?.(s, a.player, a.to, 'ship', false);
  return null;
}

// ---------------------------------------------------------------------------
// Development cards
// ---------------------------------------------------------------------------

export function devCardError(s: GameState, p: PlayerId, type: DevCardType): string | null {
  if (!isActor(s, p)) return 'it is not your turn';
  const okPhase =
    (s.phase.kind === 'preRoll' && s.turn.role === 'active') ||
    (s.phase.kind === 'main' && (s.turn.role === 'active' || s.turn.role === 'paired'));
  if (!okPhase) return 'development cards cannot be played now';
  if (s.turn.devCardPlayed) return 'only one development card may be played per turn';
  const cards = s.players[p].devCards.filter((c) => c.type === type);
  if (cards.length === 0) return `you have no ${type} card`;
  if (!cards.some((c) => c.boughtPart !== s.turn.part)) return 'a card cannot be played on the turn it was bought';
  return null;
}

function consumeDevCard(s: GameState, p: PlayerId, type: DevCardType): void {
  const hand = s.players[p].devCards;
  const idx = hand.findIndex((c) => c.type === type && c.boughtPart !== s.turn.part);
  hand.splice(idx, 1);
  s.turn.devCardPlayed = true;
  if (type !== 'knight') s.players[p].playedProgress.push(type);
}

export function updateLargestArmy(s: GameState, p: PlayerId): void {
  if (!scenarioOf(s).rules.largestArmy) return;
  const knights = s.players[p].playedKnights;
  const holder = s.largestArmy.holder;
  if (holder === p || knights < LARGEST_ARMY_MIN) return;
  if (holder === null || knights > s.players[holder].playedKnights) {
    s.largestArmy.holder = p;
    log(s, `${nameOf(s, p)} takes Largest Army (${knights})`);
  }
}

function playKnight(s: GameState, a: A<'playKnight'>): string | null {
  const err = devCardError(s, a.player, 'knight');
  if (err) return err;
  consumeDevCard(s, a.player, 'knight');
  s.players[a.player].playedKnights++;
  log(s, `${nameOf(s, a.player)} plays a Knight`);
  updateLargestArmy(s, a.player);
  const resume = s.phase;
  const custom = scenarioOf(s).hooks.onKnight?.(s, a.player, resume);
  s.phase = custom ?? robberPhaseOr(s, 'knight', resume);
  return null;
}

function playRoadBuilding(s: GameState, a: A<'playRoadBuilding'>): string | null {
  const err = devCardError(s, a.player, 'roadBuilding');
  if (err) return err;
  consumeDevCard(s, a.player, 'roadBuilding');
  log(s, `${nameOf(s, a.player)} plays Road Building`);
  s.phase = { kind: 'roadBuilding', remaining: 2, resume: s.phase };
  return null;
}

function endRoadBuilding(s: GameState, a: A<'endRoadBuilding'>): string | null {
  if (s.phase.kind !== 'roadBuilding') return 'not placing free roads';
  if (!isActor(s, a.player)) return 'it is not your turn';
  s.phase = s.phase.resume;
  return null;
}

function playYearOfPlenty(s: GameState, a: A<'playYearOfPlenty'>): string | null {
  const err = devCardError(s, a.player, 'yearOfPlenty');
  if (err) return err;
  if (!Array.isArray(a.resources) || !a.resources.every(isResource)) return 'choose resources';
  const need = Math.min(2, total(s.bank));
  if (a.resources.length !== need) return `choose ${need} resources`;
  const want: Record<string, number> = {};
  for (const r of a.resources) want[r] = (want[r] ?? 0) + 1;
  if (!hasAtLeast(s.bank, want)) return 'the bank does not have those resources';
  consumeDevCard(s, a.player, 'yearOfPlenty');
  payFromBank(s, a.player, want);
  log(s, `${nameOf(s, a.player)} plays Year of Plenty and takes ${describeCounts(want)}`);
  return null;
}

function playMonopoly(s: GameState, a: A<'playMonopoly'>): string | null {
  const err = devCardError(s, a.player, 'monopoly');
  if (err) return err;
  if (!isResource(a.resource)) return 'choose a resource';
  consumeDevCard(s, a.player, 'monopoly');
  let taken = 0;
  for (const pl of s.players) {
    if (pl.id === a.player) continue;
    const n = pl.resources[a.resource];
    pl.resources[a.resource] = 0;
    s.players[a.player].resources[a.resource] += n;
    taken += n;
  }
  log(s, `${nameOf(s, a.player)} plays Monopoly on ${a.resource} and collects ${taken}`);
  return null;
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

function tradeShapeError(s: GameState, give: unknown, get: unknown): string | null {
  if (!validCards(s, give) || !validCards(s, get)) return 'invalid trade';
  if (cardTotal(give) === 0 || cardTotal(get) === 0) return 'trades must exchange cards for cards (no gifts)';
  for (const r of cardKinds(s)) {
    if ((give[r] ?? 0) > 0 && (get[r] ?? 0) > 0) return 'cannot trade a resource for the same resource';
  }
  return null;
}

function domesticTradeWindowError(s: GameState): string | null {
  if (s.phase.kind !== 'main' || s.turn.role !== 'active') return 'players may only trade during the active player\'s turn';
  if (s.options.tradeBuildMode === 'separate' && s.turn.buildingStarted) return 'the trade phase is over';
  return null;
}

function proposeTrade(s: GameState, a: A<'proposeTrade'>): string | null {
  const w = domesticTradeWindowError(s);
  if (w) return w;
  const actor = s.turn.actor;
  let open: 'give' | 'get' | undefined;
  if (a.open) {
    if (a.player !== actor) return 'only the active player can ask for offers';
    if (!validCards(s, a.give) || !validCards(s, a.get)) return 'invalid trade';
    if ((cardTotal(a.give) === 0) === (cardTotal(a.get) === 0)) return 'an open offer names only what you give or only what you want';
    open = cardTotal(a.give) === 0 ? 'give' : 'get';
  } else {
    const shape = tradeShapeError(s, a.give, a.get);
    if (shape) return shape;
  }
  if (!Array.isArray(a.to) || a.to.length === 0) return 'choose who to trade with';
  const to = [...new Set(a.to)];
  if (to.some((p) => !Number.isInteger(p) || p < 0 || p >= s.players.length || p === a.player)) return 'invalid trade partner';
  if (a.player !== actor && (to.length !== 1 || to[0] !== actor)) {
    return 'you may only trade with the active player';
  }
  let answers: TradeOffer | undefined;
  if (a.replyTo !== undefined) {
    answers = s.turn.trades.find((t) => t.id === a.replyTo);
    if (!answers) return 'that offer is no longer open';
    if (answers.from !== actor || !answers.to.includes(a.player)) return 'you can only answer offers made to you';
    if (answers.open === 'give' && !sameCards(s, a.give, answers.get)) return `your offer must give ${describeCounts(answers.get)}`;
    if (answers.open === 'get' && !sameCards(s, a.get, answers.give)) return `your offer must ask for ${describeCounts(answers.give)}`;
  }
  if (!hasCards(s, a.player, a.give)) return 'you do not have those cards';
  const id = s.turn.nextTradeId++;
  const offer: TradeOffer = { id, from: a.player, to, give: { ...a.give }, get: { ...a.get }, accepted: [], rejected: [] };
  if (open) offer.open = open;
  if (answers) {
    offer.replyTo = answers.id;
    // answering with a counter-offer is this player's reply to the offer
    if (!answers.rejected.includes(a.player)) answers.rejected.push(a.player);
    answers.accepted = answers.accepted.filter((p) => p !== a.player);
  }
  s.turn.trades.push(offer);
  if (a.player === actor) s.turn.offers = (s.turn.offers ?? 0) + 1;
  if (open === 'give') log(s, `${nameOf(s, a.player)} asks for ${describeCounts(a.get)}: what will you give?`);
  else if (open === 'get') log(s, `${nameOf(s, a.player)} offers ${describeCounts(a.give)}: what will you give for it?`);
  else log(s, `${nameOf(s, a.player)} offers ${describeCounts(a.give)} for ${describeCounts(a.get)}`);
  return null;
}

/** Closes an open offer together with the counter-offers that answer it. */
function closeOpenOffer(s: GameState, id: number): void {
  s.turn.trades = s.turn.trades.filter((t) => t.id !== id && t.replyTo !== id);
}

function executeTrade(s: GameState, tradeId: number, partner: PlayerId): string | null {
  const offer = s.turn.trades.find((t) => t.id === tradeId)!;
  if (!hasCards(s, offer.from, offer.give)) return `${nameOf(s, offer.from)} no longer has the offered cards`;
  if (!hasCards(s, partner, offer.get)) return `${nameOf(s, partner)} no longer has the requested cards`;
  moveCards(s, offer.from, partner, offer.give);
  moveCards(s, partner, offer.from, offer.get);
  s.turn.trades = s.turn.trades.filter((t) => t.id !== tradeId);
  // a counter-offer to an open offer settles it: the others are no longer needed
  const answered = offer.replyTo === undefined ? undefined : s.turn.trades.find((t) => t.id === offer.replyTo);
  if (answered?.open) closeOpenOffer(s, answered.id);
  log(s, `${nameOf(s, offer.from)} trades ${describeCounts(offer.give)} to ${nameOf(s, partner)} for ${describeCounts(offer.get)}`);
  return null;
}

function acceptTrade(s: GameState, a: A<'acceptTrade'>): string | null {
  const w = domesticTradeWindowError(s);
  if (w) return w;
  const offer = s.turn.trades.find((t) => t.id === a.tradeId);
  if (!offer) return 'no such offer';
  if (!offer.to.includes(a.player)) return 'the offer is not addressed to you';
  if (offer.open) return 'make an offer for it instead';
  if (!hasCards(s, a.player, offer.get)) return 'you do not have the requested cards';
  if (offer.from !== s.turn.actor) {
    // A counter-offer to the active player: accepting completes it.
    return executeTrade(s, offer.id, a.player);
  }
  if (!offer.accepted.includes(a.player)) offer.accepted.push(a.player);
  offer.rejected = offer.rejected.filter((p) => p !== a.player);
  log(s, `${nameOf(s, a.player)} accepts the offer`);
  return null;
}

function rejectTrade(s: GameState, a: A<'rejectTrade'>): string | null {
  const offer = s.turn.trades.find((t) => t.id === a.tradeId);
  if (!offer) return 'no such offer';
  if (!offer.to.includes(a.player)) return 'the offer is not addressed to you';
  if (a.player === s.turn.actor && offer.from !== a.player) {
    // the active player turns down a counter-offer: it goes away
    s.turn.trades = s.turn.trades.filter((t) => t.id !== offer.id);
    return null;
  }
  if (!offer.rejected.includes(a.player)) offer.rejected.push(a.player);
  offer.accepted = offer.accepted.filter((p) => p !== a.player);
  return null;
}

function confirmTrade(s: GameState, a: A<'confirmTrade'>): string | null {
  const w = domesticTradeWindowError(s);
  if (w) return w;
  const offer = s.turn.trades.find((t) => t.id === a.tradeId);
  if (!offer) return 'no such offer';
  if (offer.from !== a.player) return 'only the proposer can confirm';
  if (!offer.accepted.includes(a.partner)) return 'that player has not accepted';
  return executeTrade(s, offer.id, a.partner);
}

function cancelTrade(s: GameState, a: A<'cancelTrade'>): string | null {
  const offer = s.turn.trades.find((t) => t.id === a.tradeId);
  if (!offer) return 'no such offer';
  if (offer.from !== a.player) return 'only the proposer can cancel';
  if (offer.open) closeOpenOffer(s, offer.id);
  else s.turn.trades = s.turn.trades.filter((t) => t.id !== a.tradeId);
  return null;
}

/**
 * Maritime trade with the supply: 4:1, 3:1 at a generic harbor, 2:1 at a
 * matching harbor (Cities & Knights: commodities too, see `cardRates`).
 */
function bankTrade(s: GameState, a: A<'bankTrade'>): string | null {
  const e = mainPhaseError(s, a.player, ['active', 'paired']);
  if (e) return e;
  if (s.options.tradeBuildMode === 'separate' && s.turn.buildingStarted) return 'the trade phase is over';
  const shape = tradeShapeError(s, a.give, a.get);
  if (shape) return shape;
  const rates: Partial<Record<string, number>> = s.ck ? cardRates(s, a.player) : tradeRates(s, a.player);
  let credits = 0;
  for (const r of cardKinds(s)) {
    const n = a.give[r] ?? 0;
    if (n === 0) continue;
    const rate = rates[r]!;
    if (n % rate !== 0) return `${r} trades at ${rate}:1`;
    credits += n / rate;
  }
  if (credits !== cardTotal(a.get)) return `that pays for ${credits} card(s)`;
  if (!hasCards(s, a.player, a.give)) return 'you do not have those cards';
  if (!bankHas(s, a.get)) return 'the bank does not have those cards';
  moveCards(s, a.player, 'bank', a.give);
  moveCards(s, 'bank', a.player, a.get);
  log(s, `${nameOf(s, a.player)} trades ${describeCounts(a.give)} with the bank for ${describeCounts(a.get)}`);
  return null;
}

// ---------------------------------------------------------------------------
// Ending a turn (and the 5-6 player structures)
// ---------------------------------------------------------------------------

function endTurn(s: GameState, a: A<'endTurn'>): string | null {
  if (!isActor(s, a.player)) return 'it is not your turn';
  const n = s.players.length;
  if (s.phase.kind === 'specialBuild') {
    const queue = s.phase.queue.slice(1);
    if (queue.length === 0) {
      nextTurn(s);
    } else {
      s.phase = { kind: 'specialBuild', queue };
      beginPart(s, queue[0], 'specialBuild');
    }
    return null;
  }
  if (s.phase.kind !== 'main') return s.phase.kind === 'preRoll' ? 'you must roll the dice first' : 'finish the current step first';
  const ckErr = ckEndTurnError(s, a.player);
  if (ckErr) return ckErr;
  s.turn.trades = [];
  if (s.turn.role === 'active' && n >= 5) {
    if (s.options.fiveSixMode === 'paired') {
      const p2 = (s.turn.current + 3) % n;
      beginPart(s, p2, 'paired');
      s.phase = { kind: 'main' };
      log(s, `${nameOf(s, p2)} takes the paired action phase`);
    } else {
      const queue = Array.from({ length: n - 1 }, (_, i) => (s.turn.current + 1 + i) % n);
      beginPart(s, queue[0], 'specialBuild');
      s.phase = { kind: 'specialBuild', queue };
      log(s, 'Special Build Phase');
    }
    return null;
  }
  nextTurn(s);
  return null;
}
