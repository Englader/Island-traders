import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SCENARIOS,
  LONGEST_ROUTE_MIN,
  PIECES_PER_PLAYER,
  RESOURCES,
  createGame,
  edgeAllowsRoad,
  edgeAllowsShip,
  getScenario,
  seedRng,
  simulate,
  topo,
  vertexTouchesLand,
  type GameState,
} from '../src/index.js';

/** Rules that must hold after every single action. */
function checkInvariants(s: GameState): void {
  const sc = getScenario(s.scenario);
  const n = s.players.length;
  // resource conservation
  for (const r of RESOURCES) {
    let sum = s.bank[r];
    for (const p of s.players) {
      expect(p.resources[r]).toBeGreaterThanOrEqual(0);
      sum += p.resources[r];
    }
    expect(sum, `${r} conserved`).toBe(sc.bankSize(n));
  }
  // development cards are never created or destroyed (Forgotten Tribe sets some aside as gifts)
  const deckTotal = Object.values(sc.devDeck(n)).reduce((a, b) => a + b, 0);
  const inPlay = s.players.reduce((a, p) => a + p.devCards.length + p.playedKnights + p.playedProgress.length, 0);
  const setAside = ((s.ext.tribe as { giftCards?: unknown[] } | undefined)?.giftCards ?? []).length;
  expect(s.devDeck.length + inPlay + setAside).toBe(deckTotal);
  // Pirate Islands: an unconquered fortress is one of its owner's settlements.
  const fortresses = (s.ext.pirateIslands as { fortresses: Array<{ captured: boolean }> } | undefined)?.fortresses;
  // Wonders: a claimed wonder holds one of its owner's ships.
  const wonders = (s.ext.wonders as { owned: Array<string | null> } | undefined)?.owned;
  // piece supply matches the board
  const t = topo(s);
  for (const p of s.players) {
    const pieces = Object.values(s.board.pieces).filter((x) => x.owner === p.id);
    const buildings = Object.values(s.board.buildings).filter((b) => b.owner === p.id);
    expect(p.supply.roads + pieces.filter((x) => x.type === 'road').length).toBe(PIECES_PER_PLAYER.roads);
    const marker = wonders?.[p.id] ? 1 : 0;
    const fortress = fortresses && !fortresses[p.id].captured ? 1 : 0;
    expect(p.supply.ships + marker + pieces.filter((x) => x.type === 'ship').length).toBe(sc.rules.ships ? PIECES_PER_PLAYER.ships : 0);
    expect(p.supply.settlements + fortress + buildings.filter((b) => b.type === 'settlement').length).toBe(PIECES_PER_PLAYER.settlements);
    expect(p.supply.cities + buildings.filter((b) => b.type === 'city').length).toBe(PIECES_PER_PLAYER.cities);
  }
  // distance rule and placement legality
  for (const v of Object.keys(s.board.buildings)) {
    expect(vertexTouchesLand(s, v)).toBe(true);
    for (const nb of t.vertexNeighbors[v]) expect(s.board.buildings[nb], 'distance rule').toBeUndefined();
  }
  for (const [e, piece] of Object.entries(s.board.pieces)) {
    if (piece.type === 'road') expect(edgeAllowsRoad(s, e)).toBe(true);
    else expect(edgeAllowsShip(s, e)).toBe(true);
  }
  // special cards
  if (s.longestRoute.holder !== null) {
    expect(s.longestRoute.lengths[s.longestRoute.holder]).toBeGreaterThanOrEqual(LONGEST_ROUTE_MIN);
  }
  if (s.largestArmy.holder !== null) {
    expect(s.players[s.largestArmy.holder].playedKnights).toBeGreaterThanOrEqual(3);
  }
  // the robber is on land and the pirate at sea
  if (s.board.robber) expect(s.board.hexes[s.board.robber].terrain).not.toMatch(/sea|fog/);
  if (s.board.pirate) expect(s.board.hexes[s.board.pirate].terrain).toBe('sea');
}

const STEPS = Number(process.env.SIM_STEPS ?? 1500);
const SEEDS = Number(process.env.SIM_SEEDS ?? 2);

describe('random-game simulations with invariants', () => {
  for (const sc of BUILT_IN_SCENARIOS) {
    const counts = [...new Set([sc.minPlayers, 4, sc.maxPlayers])].filter((n) => n >= sc.minPlayers && n <= sc.maxPlayers);
    for (const n of counts) {
      it(`${sc.id} with ${n} players`, () => {
        for (let i = 0; i < SEEDS; i++) {
          // alternate between the rulebook's map and the random one
          const layout = i % 2 === 0 ? 'official' : 'random';
          const g = createGame({ scenario: sc.id, players: n, seed: `sim-${sc.id}-${n}-${i}`, options: { layout } });
          checkInvariants(g);
          let steps = 0;
          const r = simulate(g, seedRng(`bot-${i}`), STEPS, (s) => {
            if (steps++ % 5 === 0) checkInvariants(s);
          });
          checkInvariants(r.state);
          if (r.finished && r.state.phase.kind === 'gameOver' && r.state.phase.winner !== null) {
            expect(r.state.phase.reason).toBeTruthy();
          }
        }
      });
    }
  }

  it('5-6 players with the legacy Special Build Phase', () => {
    const g = createGame({ scenario: 'base', players: 5, seed: 'sbp', options: { fiveSixMode: 'specialBuild' } });
    let sawSbp = false;
    const r = simulate(g, seedRng('sbp'), STEPS, (s) => {
      if (s.phase.kind === 'specialBuild') sawSbp = true;
    });
    checkInvariants(r.state);
    expect(sawSbp).toBe(true);
  });

  it('separate trade/build phases', () => {
    const g = createGame({ scenario: 'base', players: 4, seed: 'sep', options: { tradeBuildMode: 'separate' } });
    const r = simulate(g, seedRng('sep'), STEPS);
    checkInvariants(r.state);
  });
});
