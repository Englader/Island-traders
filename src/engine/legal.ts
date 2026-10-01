import { handOf, hasCards } from '../ck/cards.js';
import {
  cardCombinations,
  ckBankTradeActions,
  ckBuildActions,
  ckPhaseActions,
  ckPlayersToAct,
  knightActions,
  ownTurnProgressDiscards,
  progressPlays,
  progressTurnChoices,
} from '../ck/legal.js';
import { COSTS, RESOURCES } from '../core/constants.js';
import { hasAtLeast, total } from '../core/resources.js';
import type { Action, GameState, HarborType, PartialCounts, PlayerId, Resource } from '../core/types.js';
import { robberVictimsAt, shipError, topo, tradeRates } from '../rules/queries.js';
import { movableShips } from '../rules/ships.js';
import { scenarioOf } from '../scenarios/registry.js';
import { currentSetupPlayer, devCardError, harborEdgeError, robberPhaseMoves } from './apply.js';
import {
  legalCities,
  legalRoads,
  legalSettlements,
  legalSetupSettlements,
  legalShips,
} from './placements.js';

/** Players who can currently take at least one action. */
export function playersToAct(s: GameState): PlayerId[] {
  const ph = s.phase;
  switch (ph.kind) {
    case 'gameOver':
      return [];
    case 'discard':
    case 'gold':
      return Object.keys(ph.pending).map(Number);
    case 'setup':
      return [currentSetupPlayer(s)!];
    case 'harborPlacement':
      return [ph.queue[0]];
    case 'scenario':
      return [ph.player];
    case 'ck':
      return ckPlayersToAct(s);
    case 'main': {
      const others = new Set<PlayerId>();
      for (const t of s.turn.trades) for (const p of t.to) others.add(p);
      others.delete(s.turn.actor);
      return [s.turn.actor, ...others];
    }
    default:
      return [s.turn.actor];
  }
}

/** All multisets of size `n` drawn from `available` (bounded per resource). */
export function combinations(available: PartialCounts, n: number): PartialCounts[] {
  const out: PartialCounts[] = [];
  const rec = (i: number, left: number, acc: PartialCounts) => {
    if (i === RESOURCES.length) {
      if (left === 0) out.push({ ...acc });
      return;
    }
    const r = RESOURCES[i];
    const max = Math.min(left, available[r] ?? 0);
    for (let k = max; k >= 0; k--) {
      if (k > 0) acc[r] = k;
      else delete acc[r];
      rec(i + 1, left - k, acc);
    }
    delete acc[r];
  };
  rec(0, n, {});
  return out;
}

/**
 * Enumerates the legal actions for `player`. Domestic trade proposals are not
 * enumerated (the space is huge); responses to open offers are.
 */
export function legalActions(s: GameState, player: PlayerId): Action[] {
  const ph = s.phase;
  const out: Action[] = [];
  const pl = s.players[player];
  const sc = scenarioOf(s);
  const isActor = s.turn.actor === player;

  switch (ph.kind) {
    case 'gameOver':
      return [];
    case 'harborPlacement': {
      if (ph.queue[0] !== player) return [];
      for (const e of topo(s).edgeIds) if (harborEdgeError(s, e, null) === null) out.push({ type: 'placeHarbor', player, edge: e });
      return out;
    }
    case 'setup': {
      if (currentSetupPlayer(s) !== player) return [];
      if (ph.step === 'settlement') {
        for (const v of legalSetupSettlements(s, player)) out.push({ type: 'placeSettlement', player, vertex: v });
      } else {
        for (const e of legalRoads(s, player, ph.vertex)) out.push({ type: 'placeRoad', player, edge: e });
        for (const e of legalShips(s, player, ph.vertex)) out.push({ type: 'placeShip', player, edge: e });
      }
      return out;
    }
    case 'discard': {
      const need = ph.pending[player];
      if (need === undefined) return [];
      // Cities & Knights: commodities are discarded like resources.
      const options = s.ck ? cardCombinations(handOf(s, player), need) : combinations(pl.resources, need);
      for (const cards of options) out.push({ type: 'discard', player, cards });
      return out;
    }
    case 'gold': {
      const owed = ph.pending[player];
      if (owed === undefined) return [];
      const n = Math.min(owed, total(s.bank));
      for (const resources of combinations(s.bank, n)) out.push({ type: 'chooseGold', player, resources });
      return out;
    }
    case 'robber': {
      if (!isActor) return [];
      for (const m of robberPhaseMoves(s)) {
        // Cities & Knights, the Bishop: one card from everyone next to the robber, no victim to name
        if (ph.reason === 'bishop') {
          out.push({ type: 'moveRobber', player, piece: m.piece, hex: m.hex });
          continue;
        }
        const victims = robberVictimsAt(s, player, m.piece, m.hex);
        if (victims.length === 0) out.push({ type: 'moveRobber', player, piece: m.piece, hex: m.hex });
        for (const v of victims) {
          out.push({ type: 'moveRobber', player, piece: m.piece, hex: m.hex, victim: v });
          for (const take of sc.hooks.stealChoices?.(s, player, v, m.piece) ?? []) {
            out.push({ type: 'moveRobber', player, piece: m.piece, hex: m.hex, victim: v, take });
          }
        }
      }
      return out;
    }
    case 'roadBuilding': {
      if (!isActor) return [];
      for (const e of legalRoads(s, player)) out.push({ type: 'buildRoad', player, edge: e });
      for (const e of legalShips(s, player)) out.push({ type: 'buildShip', player, edge: e });
      out.push({ type: 'endRoadBuilding', player });
      return out;
    }
    case 'scenario':
      return sc.hooks.legalActions?.(s, player) ?? [];
    case 'ck':
      return ckPhaseActions(s, player);
    case 'preRoll': {
      if (!isActor) return [];
      out.push({ type: 'rollDice', player });
      out.push(...devCardActions(s, player));
      if (s.ck) out.push(...progressPlays(s, player));
      out.push(...(sc.hooks.legalActions?.(s, player) ?? []));
      return out;
    }
    case 'specialBuild': {
      if (!isActor) return [];
      out.push(...buildActions(s, player));
      out.push({ type: 'endTurn', player });
      return out;
    }
    case 'main': {
      if (!isActor) {
        for (const t of s.turn.trades) {
          if (!t.to.includes(player)) continue;
          // an open offer is answered with a counter-offer (proposeTrade with replyTo) or declined
          if (!t.open && hasCards(s, player, t.get) && !t.accepted.includes(player)) {
            out.push({ type: 'acceptTrade', player, tradeId: t.id });
          }
          if (!t.rejected.includes(player)) out.push({ type: 'rejectTrade', player, tradeId: t.id });
        }
        return out;
      }
      out.push(...buildActions(s, player));
      out.push(...devCardActions(s, player));
      if (s.ck) {
        out.push(...ckBuildActions(s, player));
        if (s.turn.role === 'active') {
          out.push(...knightActions(s, player));
          out.push(...progressPlays(s, player));
          out.push(...progressTurnChoices(s, player));
          out.push(...ownTurnProgressDiscards(s, player));
        }
      }
      const tradeOpen = !(s.options.tradeBuildMode === 'separate' && s.turn.buildingStarted);
      if (tradeOpen) out.push(...(s.ck ? ckBankTradeActions(s, player) : bankTradeActions(s, player)));
      if (sc.rules.shipMoves && !s.turn.shipMoved) {
        for (const from of movableShips(s, player)) {
          for (const to of topo(s).edgeIds) {
            if (to !== from && !s.board.pieces[to] && shipError(s, player, to, null, from) === null) {
              out.push({ type: 'moveShip', player, from, to });
            }
          }
        }
      }
      const held = (s.ext.heldHarbors as Record<string, HarborType[]> | undefined)?.[player] ?? [];
      if (held.length > 0) {
        for (const e of topo(s).edgeIds) {
          if (harborEdgeError(s, e, player) === null) out.push({ type: 'placeHarbor', player, edge: e, index: 0 });
        }
      }
      for (const t of s.turn.trades) {
        if (t.from === player) {
          for (const partner of t.accepted) out.push({ type: 'confirmTrade', player, tradeId: t.id, partner });
          out.push({ type: 'cancelTrade', player, tradeId: t.id });
        } else if (t.to.includes(player)) {
          if (hasCards(s, player, t.get)) out.push({ type: 'acceptTrade', player, tradeId: t.id });
          out.push({ type: 'rejectTrade', player, tradeId: t.id });
        }
      }
      out.push(...(sc.hooks.legalActions?.(s, player) ?? []));
      // Cities & Knights: over the progress card limit, discard before ending the turn.
      if (!(s.ck && s.turn.role === 'active' && ownTurnProgressDiscards(s, player).length > 0)) out.push({ type: 'endTurn', player });
      return out;
    }
  }
}

function buildActions(s: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  const res = s.players[p].resources;
  if (hasAtLeast(res, COSTS.settlement)) for (const v of legalSettlements(s, p)) out.push({ type: 'buildSettlement', player: p, vertex: v });
  if (hasAtLeast(res, COSTS.city)) for (const v of legalCities(s, p)) out.push({ type: 'buildCity', player: p, vertex: v });
  if (hasAtLeast(res, COSTS.road)) for (const e of legalRoads(s, p)) out.push({ type: 'buildRoad', player: p, edge: e });
  if (hasAtLeast(res, COSTS.ship)) for (const e of legalShips(s, p)) out.push({ type: 'buildShip', player: p, edge: e });
  if (hasAtLeast(res, COSTS.devCard) && s.devDeck.length > 0) out.push({ type: 'buyDevCard', player: p });
  return out;
}

function devCardActions(s: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  if (devCardError(s, p, 'knight') === null) out.push({ type: 'playKnight', player: p });
  if (devCardError(s, p, 'roadBuilding') === null) out.push({ type: 'playRoadBuilding', player: p });
  if (devCardError(s, p, 'monopoly') === null) {
    for (const r of RESOURCES) out.push({ type: 'playMonopoly', player: p, resource: r });
  }
  if (devCardError(s, p, 'yearOfPlenty') === null) {
    const n = Math.min(2, total(s.bank));
    for (const c of combinations(s.bank, n)) {
      const list: Resource[] = [];
      for (const r of RESOURCES) for (let i = 0; i < (c[r] ?? 0); i++) list.push(r);
      out.push({ type: 'playYearOfPlenty', player: p, resources: list });
    }
  }
  return out;
}

function bankTradeActions(s: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  const rates = tradeRates(s, p);
  const res = s.players[p].resources;
  for (const give of RESOURCES) {
    if (res[give] < rates[give]) continue;
    for (const get of RESOURCES) {
      if (get === give || s.bank[get] === 0) continue;
      out.push({ type: 'bankTrade', player: p, give: { [give]: rates[give] }, get: { [get]: 1 } });
    }
  }
  return out;
}
