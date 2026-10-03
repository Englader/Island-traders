import { createGame, topo, type GameState, type PartialCounts, type Resource, type TradeOffer } from '../src/index.js';

/** Where a saved local game lives in the browser (web/src/game/storage.ts, controller.ts). */
export const SAVE_KEY = 'island-traders:v1:save:local';

function give(s: GameState, p: number, c: PartialCounts): void {
  for (const [r, n] of Object.entries(c) as Array<[Resource, number]>) {
    s.bank[r] -= n;
    s.players[p].resources[r] += n;
  }
}

/**
 * A saved game against two computer players (Ada and Björn) after the roll,
 * on your turn unless `actor` says otherwise. Your hand is `hand`, and your
 * settlements on a generic and a 2:1 harbor give you those rates. `trades`
 * are offers already on the table. Opened with Continue on the home screen.
 */
export function tradeGame({
  hand = { brick: 5, lumber: 2, wool: 1, grain: 3, ore: 4 },
  actor = 0,
  trades = [],
  ada = { brick: 1, lumber: 2, wool: 3, grain: 2, ore: 1 },
  adaSettles = false,
}: {
  hand?: PartialCounts;
  actor?: number;
  trades?: TradeOffer[];
  /** Ada's hand. */
  ada?: PartialCounts;
  /** Ada has a settlement with a road to a free spot: she saves for a settlement. */
  adaSettles?: boolean;
} = {}) {
  const s = createGame({ scenario: 'base', players: ['Sam', 'Ada', 'Björn'], seed: 'trade-ui', options: { firstPlayer: 0 } });
  s.turn.number = 1;
  s.turn.part = 1;
  s.turn.current = actor;
  s.turn.actor = actor;
  s.turn.role = 'active';
  s.turn.dice = [3, 4];
  s.phase = { kind: 'main' };
  give(s, 0, hand);
  give(s, 1, ada);
  give(s, 2, { brick: 2, lumber: 1, wool: 2, grain: 1, ore: 2 });
  s.turn.trades = trades;
  s.turn.nextTradeId = trades.length + 1;
  const t = topo(s);
  const generic = s.board.harbors.find((h) => h.type === 'generic')!;
  const special = s.board.harbors.find((h) => h.type !== 'generic')!;
  for (const h of [generic, special]) {
    s.board.buildings[t.edgeVertices[h.edge][0]] = { owner: 0, type: 'settlement' };
    s.players[0].supply.settlements--;
  }
  if (adaSettles) {
    // inland, away from Sam's settlements: a settlement, and a road of two to a free spot
    const free = (v: string) => !s.board.buildings[v] && t.vertexNeighbors[v].every((n) => !s.board.buildings[n]);
    const inland = (v: string) => t.vertexHexes[v].every((h) => s.board.hexes[h].terrain !== 'sea');
    const a = t.vertexIds.find((v) => inland(v) && free(v) && t.vertexNeighbors[v].some((b) => t.vertexNeighbors[b].some((c) => c !== v && inland(c) && free(c) && !t.vertexNeighbors[c].includes(v))))!;
    const b = t.vertexNeighbors[a].find((x) => t.vertexNeighbors[x].some((c) => c !== a && inland(c) && free(c) && !t.vertexNeighbors[c].includes(a)))!;
    const c = t.vertexNeighbors[b].find((x) => x !== a && inland(x) && free(x) && !t.vertexNeighbors[x].includes(a))!;
    s.board.buildings[a] = { owner: 1, type: 'settlement' };
    s.players[1].supply.settlements--;
    for (const [x, y] of [
      [a, b],
      [b, c],
    ]) {
      const e = t.vertexEdges[x].find((f) => t.edgeVertices[f].includes(y))!;
      s.board.pieces[e] = { owner: 1, type: 'road', placedPart: 0 };
      s.players[1].supply.roads--;
    }
  }
  return {
    special: special.type as Resource,
    record: {
      v: 1,
      id: 'trade-ui',
      mode: 'local',
      seats: [
        { name: 'Sam', kind: 'human', color: 0 },
        { name: 'Ada', kind: 'bot', color: 1 },
        { name: 'Björn', kind: 'bot', color: 2 },
      ],
      state: s,
      botSpeed: 'fast',
      botLevel: 'medium',
      savedAt: Date.now(),
    },
  };
}
