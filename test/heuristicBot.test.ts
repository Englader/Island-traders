import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SCENARIOS,
  createGame,
  heuristicAction,
  legalSetupSettlements,
  simulateHeuristic,
  spotValue,
  topo,
} from '../src/index.js';
import { blank, give, put } from './helpers.js';

describe('heuristic bot', () => {
  for (const sc of BUILT_IN_SCENARIOS) {
    const counts = [...new Set([sc.minPlayers, Math.min(4, sc.maxPlayers), ...(sc.maxPlayers >= 5 ? [sc.maxPlayers] : [])])];
    for (const n of counts) {
      it(`finishes ${sc.id} with ${n} players using only legal moves`, () => {
        const { state } = simulateHeuristic(createGame({ scenario: sc.id, players: n, seed: `bot-${n}` }), 4000);
        expect(state.phase.kind).toBe('gameOver');
      });
    }
  }

  it('takes the most valuable starting spot', () => {
    const s = createGame({ scenario: 'base', players: 3, seed: 7, options: { firstPlayer: 0 } });
    const a = heuristicAction(s, 0);
    expect(a?.type).toBe('placeSettlement');
    const chosen = spotValue(s, 0, (a as { vertex: string }).vertex);
    for (const v of legalSetupSettlements(s, 0)) expect(spotValue(s, 0, v)).toBeLessThanOrEqual(chosen);
  });

  it('keeps the robber off its own hexes', () => {
    const s = blank('base', 3);
    const hex = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].token === 8)!;
    put(s, topo(s).hexVertices[hex][0], 0);
    s.board.robber = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].terrain === 'desert')!;
    s.phase = { kind: 'robber', reason: 'knight', resume: { kind: 'main' } };
    const a = heuristicAction(s, 0);
    expect(a?.type).toBe('moveRobber');
    expect((a as { hex: string }).hex).not.toBe(hex);
  });

  it('trades with the bank only to complete what it is saving for', () => {
    const s = blank('base', 3, {}, 'trade');
    s.board.harbors = [];
    const t = topo(s);
    const v = t.vertexIds.find((x) => t.vertexHexes[x].every((h) => s.board.hexes[h].terrain !== 'sea'))!;
    put(s, v, 0);
    // A city needs 3 ore and 2 grain: the one missing grain is bought with the 4 spare wool.
    give(s, 0, { ore: 3, grain: 1, wool: 4 });
    const a = heuristicAction(s, 0);
    expect(a).toMatchObject({ type: 'bankTrade', give: { wool: 4 }, get: { grain: 1 } });
  });
});
