import { applyAction, cornerVertex, createGame, type GameState, type HexId, type Terrain } from '../src/index.js';

const H = (q: number, r: number): HexId => `${q},${r}`;

/** The tiles of the crafted roll: each of them shows an 8. */
export const ROLL_LIGHT = {
  /** Forest: Sam's settlement takes a lumber. The only tile that pays. */
  pays: H(0, 0),
  /** Pasture: nobody builds next to it. */
  empty: H(-2, 2),
  /** Mountains under the robber, next to Sam's settlement. */
  robbed: H(1, -1),
  /** Fields between the two other players, with 1 grain left in the bank for the 2 they are owed. */
  short: H(0, 2),
} as const;

function setHex(s: GameState, id: HexId, terrain: Terrain, token: number | null): void {
  s.board.hexes[id].terrain = terrain;
  s.board.hexes[id].token = token;
}

/**
 * Turn 1, you (Sam) are about to roll, and the dice are loaded for an 8.
 * Four tiles show an 8 (see ROLL_LIGHT); only one of them pays. A saved
 * local game against two computer players (Ada and Björn), opened with
 * Continue on the home screen (see trade.spec.ts); or, given a `room`, an
 * online room the host (Sam) has saved, with a friend's seat for the second
 * player (see discardState.ts).
 */
export function rollLightGame(room?: string) {
  const names = room ? ['Sam', 'Friend', 'Björn'] : ['Sam', 'Ada', 'Björn'];
  const s = createGame({ scenario: 'base', players: names, seed: 'roll-light', options: { firstPlayer: 0, layout: 'random' } });
  s.turn.number = 1;
  s.turn.part = 1;
  s.turn.current = 0;
  s.turn.actor = 0;
  s.turn.role = 'active';
  s.phase = { kind: 'preRoll' };
  for (const h of Object.values(s.board.hexes)) if (h.token === 8) h.token = 3;
  setHex(s, ROLL_LIGHT.pays, 'forest', 8);
  setHex(s, H(1, 0), 'hills', 10);
  setHex(s, ROLL_LIGHT.robbed, 'mountains', 8);
  setHex(s, ROLL_LIGHT.empty, 'pasture', 8);
  setHex(s, ROLL_LIGHT.short, 'fields', 8);
  s.board.robber = ROLL_LIGHT.robbed;
  const build = (q: number, r: number, corner: number, owner: number) => {
    s.board.buildings[cornerVertex({ q, r }, corner)] = { owner, type: 'settlement' };
    s.players[owner].supply.settlements--;
  };
  // Sam: the forest, hills (10) and the robbed mountains; the others on two corners of the fields
  build(0, 0, 0, 0);
  build(0, 2, 0, 1);
  build(0, 2, 3, 2);
  s.bank.grain = 1;
  for (let i = 0; i < 1000; i++, s.rng.s++) {
    const r = applyAction(s, { type: 'rollDice', player: 0 });
    if (r.ok && r.state.turn.dice![0] + r.state.turn.dice![1] === 8) {
      return {
        v: 1,
        id: room ? 'roll-light-room' : 'roll-light',
        mode: room ? 'host' : 'local',
        seats: names.map((name, k) => ({ name, kind: k === 0 ? 'human' : k === 1 && room ? 'remote' : 'bot', color: k })),
        state: s,
        // (the dice tumble for nearly 2 seconds)
        botSpeed: 'normal',
        botLevel: 'medium',
        ...(room ? { room } : {}),
        savedAt: Date.now(),
      };
    }
  }
  throw new Error('no 8 found');
}
