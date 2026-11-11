import type { Action, PlayerId } from 'engine';
import type { GameController } from '../game/controller';
import type { HostMessage, LobbySeat } from './protocol';

/**
 * What the host sends one guest after every change, worked out here (away
 * from the network code) so the tests can check exactly what leaves the
 * host's browser. A seated friend gets their seat's view; someone watching
 * (seat null) gets the spectator view: no hands, no development or progress
 * cards, no scenario secrets, no legal moves.
 */

/** At most this many people may watch one room. */
export const MAX_WATCHERS = 8;

export function lobbySeats(ctrl: GameController, online: Set<number>): LobbySeat[] {
  const claimed = new Set(Object.values(ctrl.record.claims ?? {}));
  return ctrl.seats.map((s, i) => ({ name: s.name, kind: s.kind, color: s.color, taken: claimed.has(i), online: s.kind !== 'remote' || online.has(i) }));
}

/**
 * The latest move as `viewer` may see it. A few moves name cards only their
 * player (and sometimes one other) may know: the progress card put back, and
 * what changed hands answering a progress card. Everyone else gets the move
 * without those details (the board animations don't need them).
 */
export function publicAction(a: Action, viewer: PlayerId | null): Action {
  if (viewer === a.player) return a;
  const hidden = a.type === 'discardProgress' ? 'card' : a.type === 'progressChoice' ? 'args' : null;
  if (hidden === null || !(hidden in a)) return a;
  const copy: Record<string, unknown> = { ...a };
  delete copy[hidden];
  return copy as Action;
}

/** The host's name as guests see it in the lobby. */
export function hostName(ctrl: GameController): string {
  return ctrl.seats.find((s) => s.kind === 'human')?.name ?? 'Host';
}

/**
 * The lobby or game message for a guest at `seat` (null: watching).
 * `watching` lists the names of everyone watching, for the players' screens.
 */
export function messageFor(ctrl: GameController, seat: PlayerId | null, online: Set<number>, watching: string[]): HostMessage {
  const seats = lobbySeats(ctrl, online);
  if (!ctrl.record.started) {
    return { t: 'lobby', scenario: ctrl.state.scenario, seats, started: false, host: hostName(ctrl), watching };
  }
  const snap = ctrl.snapshot(seat);
  const clock = ctrl.clockFeed()?.sum;
  const last = ctrl.last ? { action: publicAction(ctrl.last.action, seat), at: ctrl.last.at } : null;
  return { t: 'state', snap, seats, last, watching, ...(clock ? { clock } : {}) };
}
