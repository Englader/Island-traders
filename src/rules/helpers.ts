import { RESOURCES } from '../core/constants.js';
import { formatCounts } from '../core/resources.js';
import { nextInt } from '../core/rng.js';
import type { CardCounts, DevCardType, GameState, PartialCounts, PlayerId, Resource } from '../core/types.js';

export function log(state: GameState, msg: string, visibleTo?: PlayerId[]): void {
  state.log.push(visibleTo ? { turn: state.turn.number, msg, visibleTo } : { turn: state.turn.number, msg });
}

export function nameOf(state: GameState, p: PlayerId): string {
  return state.players[p].name;
}

/** Pays from the bank as much of `want` as it can; returns what was actually paid. */
export function payFromBank(state: GameState, p: PlayerId, want: PartialCounts): PartialCounts {
  const paid: PartialCounts = {};
  for (const r of RESOURCES) {
    const n = Math.min(want[r] ?? 0, state.bank[r]);
    if (n > 0) {
      state.bank[r] -= n;
      state.players[p].resources[r] += n;
      paid[r] = n;
    }
  }
  return paid;
}

export function payToBank(state: GameState, p: PlayerId, cost: PartialCounts): void {
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    if (state.players[p].resources[r] < n) throw new Error(`${nameOf(state, p)} cannot pay ${r}`);
    state.players[p].resources[r] -= n;
    state.bank[r] += n;
  }
}

/** Takes one random resource card from `victim` and gives it to `thief`. */
export function stealRandom(state: GameState, thief: PlayerId, victim: PlayerId): Resource | null {
  const hand: Resource[] = [];
  const res = state.players[victim].resources;
  for (const r of RESOURCES) for (let i = 0; i < res[r]; i++) hand.push(r);
  if (hand.length === 0) {
    log(state, `${nameOf(state, thief)} robs ${nameOf(state, victim)}, who has no cards`);
    return null;
  }
  const card = hand[nextInt(state.rng, hand.length)];
  res[card]--;
  state.players[thief].resources[card]++;
  log(state, `${nameOf(state, thief)} steals a card from ${nameOf(state, victim)}`);
  log(state, `(the stolen card is ${card})`, [thief, victim]);
  return card;
}

/** Removes a random resource card from a player to the bank (used by scenario attacks). */
export function discardRandom(state: GameState, p: PlayerId): Resource | null {
  const hand: Resource[] = [];
  const res = state.players[p].resources;
  for (const r of RESOURCES) for (let i = 0; i < res[r]; i++) hand.push(r);
  if (hand.length === 0) return null;
  const card = hand[nextInt(state.rng, hand.length)];
  res[card]--;
  state.bank[card]++;
  return card;
}

export function drawDevCard(state: GameState, p: PlayerId): DevCardType | null {
  const card = state.devDeck.pop();
  if (!card) return null;
  state.players[p].devCards.push({ type: card, boughtPart: state.turn.part });
  log(state, `(${nameOf(state, p)} drew ${card})`, [p]);
  return card;
}

/**
 * Adds players owed a free resource of their choice (gold fields, discoveries).
 * If a gold phase is already open the amounts are merged; otherwise the current
 * phase is suspended until everyone has chosen.
 */
export function addGoldChoice(state: GameState, owed: Record<number, number>): void {
  const entries = Object.entries(owed).filter(([, n]) => n > 0);
  if (entries.length === 0) return;
  if (state.phase.kind === 'gold') {
    for (const [p, n] of entries) state.phase.pending[p] = (state.phase.pending[p] ?? 0) + n;
    return;
  }
  const pending: Record<string, number> = {};
  for (const [p, n] of entries) pending[p] = n;
  state.phase = { kind: 'gold', pending, resume: state.phase };
}

/** "2 brick, 1 ore" or "nothing" (commodities included in Cities & Knights). */
export function describeCounts(c: CardCounts): string {
  return formatCounts(c);
}
