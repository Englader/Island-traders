import { applyAction, createGame, type GameState, type PartialCounts, type Resource } from '../src/index.js';

/** Where a hosted online game is saved (web/src/game/storage.ts, controller.ts). */
export const HOST_SAVE_KEY = 'island-traders:v1:save:host';

function give(s: GameState, p: number, c: PartialCounts): void {
  for (const [r, n] of Object.entries(c) as Array<[Resource, number]>) {
    s.bank[r] -= n;
    s.players[p].resources[r] += n;
  }
}

/**
 * Turn 1 of a base game, the first player about to roll, with each player
 * holding `hands[p]`. The dice are loaded: the roll is a 7, so everyone with
 * more than 7 cards has to discard half.
 */
function sevenToRoll(names: string[], hands: PartialCounts[]): GameState {
  const s = createGame({ scenario: 'base', players: names, seed: 'discard-ui', options: { firstPlayer: 0 } });
  s.turn.number = 1;
  s.turn.part = 1;
  s.turn.current = 0;
  s.turn.actor = 0;
  s.turn.role = 'active';
  s.phase = { kind: 'preRoll' };
  hands.forEach((h, p) => give(s, p, h));
  for (let i = 0; i < 1000; i++, s.rng.s++) {
    const r = applyAction(s, { type: 'rollDice', player: 0 });
    if (r.ok && r.state.turn.dice![0] + r.state.turn.dice![1] === 7) return s;
  }
  throw new Error('no seven found');
}

/**
 * A saved game against two computer players (Ada and Björn): you (Sam) are
 * about to roll a 7 holding `hand`, 9 cards by default, so you discard 4.
 * Opened with Continue on the home screen (see trade.spec.ts).
 */
export function sevenGame(hand: PartialCounts = { brick: 3, lumber: 2, wool: 1, grain: 3 }) {
  const names = ['Sam', 'Ada', 'Björn'];
  const state = sevenToRoll(names, [hand, { brick: 1, wool: 2 }, { grain: 1, ore: 2 }]);
  return {
    v: 1,
    id: 'discard-ui',
    mode: 'local',
    seats: names.map((name, i) => ({ name, kind: i === 0 ? 'human' : 'bot', color: i })),
    state,
    botSpeed: 'fast',
    botLevel: 'medium',
    savedAt: Date.now(),
  };
}

/**
 * The same for an online room the host (Sam) has saved: a friend takes seat 2
 * and holds `guestHand`, so after the host rolls the 7 the friend discards
 * during the host's turn. The computer player (Björn) holds too few cards to discard.
 */
export function sevenRoom(room: string, guestHand: PartialCounts = { brick: 2, lumber: 3, wool: 2, grain: 1, ore: 2 }) {
  const names = ['Sam', 'Friend', 'Björn'];
  const state = sevenToRoll(names, [{ brick: 1, grain: 2 }, guestHand, { wool: 1, ore: 1 }]);
  return {
    v: 1,
    id: 'discard-room',
    mode: 'host',
    seats: [
      { name: 'Sam', kind: 'human', color: 0 },
      { name: 'Friend', kind: 'remote', color: 1 },
      { name: 'Björn', kind: 'bot', color: 2 },
    ],
    state,
    botSpeed: 'fast',
    botLevel: 'medium',
    room,
    savedAt: Date.now(),
  };
}
