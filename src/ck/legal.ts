import { CARDS, RESOURCES } from '../core/constants.js';
import type { Action, Card, GameState, KnightLevel, PlayerId, ProgressCardName } from '../core/types.js';
import { topo } from '../rules/queries.js';
import { bankOf, cardRates, handOf, hasCards } from './cards.js';
import { CK_COSTS, PROGRESS_CARDS, TRACKS } from './constants.js';
import {
  improvementError,
  metropolisSites,
  pillageableCities,
  progressTimingError,
  robberActive,
  winsMetropolis,
} from './engine.js';
import { chaseError, knightCanAct, knightPlacementError, knightReach, knightsOf, promoteError, retreatSpots } from './knights.js';
import { progressEffect, progressExcess } from './progress.js';

/**
 * Legal Cities & Knights moves, for `legalActions` (engine/legal.ts): the
 * decision phases, the extra builds and knight actions of the main phase,
 * progress cards (only those with an effect), and trades with commodities.
 */

export function ckPlayersToAct(s: GameState): PlayerId[] {
  const ph = s.phase;
  if (ph.kind !== 'ck') return [];
  switch (ph.step) {
    case 'pillage':
    case 'progressDiscard':
    case 'aqueduct':
      return Object.keys(ph.pending).map(Number);
    case 'defenderDraw':
      return ph.queue.length > 0 ? [ph.queue[0]] : [];
    case 'retreat':
      return [ph.player];
    case 'card':
      return ph.pending ? Object.keys(ph.pending).map(Number) : [ph.player];
    default:
      return [];
  }
}

function distinct<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function discardProgressActions(s: GameState, p: PlayerId): Action[] {
  return distinct(s.ck!.players[p].progress).map((card) => ({ type: 'discardProgress', player: p, card }) as Action);
}

/** Moves in the expansion's own decision phases. */
export function ckPhaseActions(s: GameState, p: PlayerId): Action[] {
  const ph = s.phase;
  const out: Action[] = [];
  if (ph.kind !== 'ck') return out;
  switch (ph.step) {
    case 'pillage':
      if (!ph.pending[p]) return out;
      for (const v of pillageableCities(s, p)) out.push({ type: 'pillageCity', player: p, vertex: v });
      return out;
    case 'defenderDraw':
      if (ph.queue[0] !== p) return out;
      for (const deck of TRACKS) if (s.ck!.decks[deck].length > 0) out.push({ type: 'drawProgress', player: p, deck });
      return out;
    case 'progressDiscard':
      return ph.pending[p] ? discardProgressActions(s, p) : out;
    case 'aqueduct':
      if (!ph.pending[p]) return out;
      for (const r of RESOURCES) if (s.bank[r] > 0) out.push({ type: 'aqueduct', player: p, resource: r });
      out.push({ type: 'aqueduct', player: p });
      return out;
    case 'retreat':
      if (ph.player !== p) return out;
      for (const v of retreatSpots(s, p, ph.from)) out.push({ type: 'retreatKnight', player: p, to: v });
      return out;
    case 'card': {
      const waiting = ph.pending ? !!ph.pending[p] : ph.player === p;
      if (!waiting) return out;
      const effect = progressEffect(ph.card);
      for (const args of effect?.choices?.(s, p) ?? []) out.push({ type: 'progressChoice', player: p, ...(args ? { args } : {}) });
      return out;
    }
    default:
      return out;
  }
}

/** Progress cards the player can play now (only those whose effect is implemented). */
export function progressPlays(s: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  for (const card of distinct(s.ck!.players[p].progress) as ProgressCardName[]) {
    if (progressTimingError(s, p, card) !== null) continue;
    const effect = progressEffect(card);
    if (!effect || !PROGRESS_CARDS[card]) continue;
    for (const args of effect.options(s, p)) out.push({ type: 'playProgress', player: p, card, ...(args ? { args } : {}) });
  }
  return out;
}

/**
 * Moves that cards played earlier this turn still allow (Commercial Harbor
 * offers): `progressChoice` in the main phase, with `args.card`.
 */
export function progressTurnChoices(s: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  if (s.phase.kind !== 'main' || s.turn.actor !== p || s.turn.role !== 'active') return out;
  for (const card of distinct(s.ck!.turnEffects.filter((e) => e.player === p).map((e) => e.effect))) {
    const effect = progressEffect(card as ProgressCardName);
    for (const args of effect?.turnChoices?.(s, p) ?? []) out.push({ type: 'progressChoice', player: p, args });
  }
  return out;
}

/** Knights, city walls and improvements the player can build now (the phase is checked by the caller). */
export function ckBuildActions(s: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  const ck = s.ck!;
  if (hasCards(s, p, CK_COSTS.knight)) {
    for (const v of topo(s).vertexIds) if (knightPlacementError(s, p, v) === null) out.push({ type: 'buildKnight', player: p, vertex: v });
  }
  const mine = knightsOf(s, p);
  if (hasCards(s, p, CK_COSTS.activate)) {
    for (const [v, k] of mine) if (!k.active) out.push({ type: 'activateKnight', player: p, vertex: v });
  }
  if (hasCards(s, p, CK_COSTS.promote)) {
    for (const [v] of mine) if (promoteError(s, p, v) === null) out.push({ type: 'promoteKnight', player: p, vertex: v });
  }
  if (hasCards(s, p, CK_COSTS.cityWall) && ck.players[p].walls.length < 3) {
    for (const [v, b] of Object.entries(s.board.buildings)) {
      if (b.owner === p && b.type === 'city' && !ck.players[p].walls.includes(v)) out.push({ type: 'buildCityWall', player: p, vertex: v });
    }
  }
  for (const track of TRACKS) {
    if (improvementError(s, p, track) !== null) continue;
    if (winsMetropolis(s, p, track)) {
      for (const v of metropolisSites(s, p)) out.push({ type: 'improveCity', player: p, track, vertex: v });
    } else {
      out.push({ type: 'improveCity', player: p, track });
    }
  }
  return out;
}

/** Moves, displacements and chases by knights that can act (own turn, after the roll). */
export function knightActions(s: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  for (const [v, k] of knightsOf(s, p)) {
    if (!knightCanAct(s, k)) continue;
    const reach = knightReach(s, p, v);
    for (const to of reach.moves) out.push({ type: 'moveKnight', player: p, from: v, to });
    for (const to of reach.targets) {
      if ((s.ck!.knights[to].level as KnightLevel) < k.level) out.push({ type: 'displaceKnight', player: p, from: v, to });
    }
    if (robberActive(s)) {
      for (const piece of ['robber', 'pirate'] as const) {
        if (chaseError(s, p, v, piece) === null) out.push({ type: 'chaseRobber', player: p, vertex: v, piece });
      }
    }
  }
  return out;
}

/** Over the progress hand limit on your own turn: discard before ending it. */
export function ownTurnProgressDiscards(s: GameState, p: PlayerId): Action[] {
  return progressExcess(s, p) > 0 ? discardProgressActions(s, p) : [];
}

/** One lot of a card for one card from the bank, at the player's rates. */
export function ckBankTradeActions(s: GameState, p: PlayerId): Action[] {
  const out: Action[] = [];
  const rates = cardRates(s, p);
  const hand = handOf(s, p);
  const bank = bankOf(s);
  for (const give of CARDS) {
    if (hand[give] < rates[give]) continue;
    for (const get of CARDS) {
      if (get === give || bank[get] === 0) continue;
      out.push({ type: 'bankTrade', player: p, give: { [give]: rates[give] }, get: { [get]: 1 } });
    }
  }
  return out;
}

/** Every way to discard `n` cards from the hand, commodities included. */
export function cardCombinations(available: Partial<Record<Card, number>>, n: number): Array<Partial<Record<Card, number>>> {
  const out: Array<Partial<Record<Card, number>>> = [];
  const rec = (i: number, left: number, acc: Partial<Record<Card, number>>) => {
    if (i === CARDS.length) {
      if (left === 0) out.push({ ...acc });
      return;
    }
    const k = CARDS[i];
    const max = Math.min(left, available[k] ?? 0);
    for (let c = max; c >= 0; c--) {
      if (c > 0) acc[k] = c;
      else delete acc[k];
      rec(i + 1, left - c, acc);
    }
    delete acc[k];
  };
  rec(0, n, {});
  return out;
}
