import { describe, expect, it } from 'vitest';
import {
  createGame,
  getScenario,
  heuristicAction,
  legalActions,
  simulateHeuristic,
  topo,
  type Action,
  type BotLevel,
  type GameState,
  type MapLayout,
  type PlayerId,
} from '../src/index.js';
import { CK, checkInvariants, knight } from './ckHelpers.js';
import { C, H, blank, give, put, ship, trail } from './helpers.js';

/**
 * Computer players in Cities & Knights on the Seafarers scenarios
 * (src/bots/ckBot.ts): whole games on every scenario that combines, and the
 * Seafarers decisions. `npm run bots:league -- 60 ck:<scenario>` measures the
 * levels against each other.
 */

function botMove(s: GameState, p: PlayerId, level: BotLevel = 'medium'): Action {
  const a = heuristicAction(s, p, level);
  expect(a, `a move for ${p}`).not.toBeNull();
  expect(legalActions(s, p)).toContainEqual(a);
  return a!;
}

const LEVELS: BotLevel[] = ['easy', 'medium', 'hard', 'medium', 'hard', 'easy'];

/** Every scenario that combines, at every player count, alternating the layouts. */
const GAMES: Array<{ id: string; players: number; layout: MapLayout }> = [];
for (const id of ['seafarers-1-new-shores', 'seafarers-4-through-the-desert', 'seafarers-6-cloth-trade', 'seafarers-8-wonders']) {
  const sc = getScenario(id);
  for (let n = sc.minPlayers; n <= sc.maxPlayers; n++) {
    for (const layout of ['official', 'random'] as MapLayout[]) {
      // 5-6 players: one layout each, alternating, to keep the suite quick (the league plays both)
      if (n >= 5 && (n % 2 === 0) !== (layout === 'random')) continue;
      GAMES.push({ id, players: n, layout });
    }
  }
}

describe('computer players finish C&K games on every Seafarers scenario that combines', () => {
  for (const g of GAMES) {
    it(`${g.id}, ${g.players} players, ${g.layout} map: easy, medium and hard to the end`, () => {
      const start = createGame({ scenario: g.id, players: g.players, seed: `ck-sea-bots-${g.id}-${g.players}-${g.layout}`, options: { ...CK, layout: g.layout } });
      let checks = 0;
      const { state } = simulateHeuristic(start, 20000, LEVELS.slice(0, g.players), (s) => {
        // the engine's rules hold along the way (every 25th move, to keep it quick)
        if (++checks % 25 === 0) checkInvariants(s);
      });
      expect(state.phase.kind).toBe('gameOver');
      checkInvariants(state, true);
      // the robber (and pirate) came on the board at the first attack
      if (state.ck!.attacks > 0) {
        expect(state.ck!.asleep).toBeUndefined();
        expect(state.board.robber).not.toBeNull();
      }
    }, 120_000);
  }
});

describe('Seafarers decisions of the C&K computer players', () => {
  it('a gold field: picks the resources it is short of, never a commodity', () => {
    const s = blank('test-sea', 3, CK);
    s.phase = { kind: 'gold', pending: { 0: 2 }, resume: { kind: 'main' } };
    const a = botMove(s, 0, 'hard');
    expect(a.type).toBe('chooseGold');
    const picked = (a as Extract<Action, { type: 'chooseGold' }>).resources;
    expect(Object.values(picked).reduce((x, y) => x + (y ?? 0), 0)).toBe(2);
  });

  it('chases the pirate off its ships with a knight, once it can', () => {
    const s = blank('test-sea', 3, CK);
    s.ck!.attacks = 1;
    delete s.ck!.asleep;
    const east = C(3, 2, 0);
    const coast = C(3, 2, 5);
    const sea1 = C(3, 3, 0);
    put(s, east, 0);
    ship(s, trail(s, [east, coast, sea1]), 0);
    knight(s, coast, 0, 1, true);
    s.board.pirate = H(4, 2);
    for (const level of ['medium', 'hard'] as const) expect(botMove(s, 0, level)).toEqual({ type: 'chaseRobber', player: 0, vertex: coast, piece: 'pirate' });
  });

  it('with its island full, saves for a ship toward a spot across the sea', () => {
    const s = blank('test-sea', 3, CK);
    const east = C(3, 2, 0);
    put(s, east, 0, 'city');
    // every other spot on the island taken
    const t = topo(s);
    for (const v of t.vertexIds) {
      if (v === east || !t.vertexHexes[v].some((h) => ['2,2', '3,2', '3,1', '2,1', '1,2', '1,3', '2,3'].includes(h))) continue;
      if (Object.keys(s.board.buildings).some((b) => b === v || t.vertexNeighbors[v].includes(b))) continue;
      put(s, v, 1);
    }
    give(s, 0, { lumber: 1, wool: 1 });
    const a = botMove(s, 0, 'hard');
    expect(a.type).toBe('buildShip');
  });

  it('The Wonders: claims a wonder it qualifies for, and builds its levels', () => {
    let s = blank('seafarers-8-wonders', 3, CK);
    const t = topo(s);
    const land = t.vertexIds.filter((v) => t.vertexHexes[v].some((h) => s.board.hexes[h]?.zone === 'main'));
    put(s, land[0], 0, 'city');
    put(s, land.find((v) => v !== land[0] && !t.vertexNeighbors[land[0]].includes(v) && !t.vertexNeighbors[v].some((w) => t.vertexNeighbors[land[0]].includes(w)))!, 0, 'city');
    const claim = botMove(s, 0, 'hard');
    expect(claim).toMatchObject({ type: 'scenario', name: 'claimWonder' });
    s = { ...s, ext: { ...s.ext } };
    const w = structuredClone(s.ext.wonders) as { owned: Array<string | null>; claimed: Record<string, number>; levels: number[] };
    w.owned[0] = 'theater';
    w.claimed.theater = 0;
    s.ext.wonders = w;
    give(s, 0, { brick: 1, wool: 3, lumber: 1 });
    expect(botMove(s, 0, 'hard')).toEqual({ type: 'scenario', player: 0, name: 'buildWonder' });
  });
});
