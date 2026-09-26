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
}: { hand?: PartialCounts; actor?: number; trades?: TradeOffer[] } = {}) {
  const s = createGame({ scenario: 'base', players: ['Sam', 'Ada', 'Björn'], seed: 'trade-ui', options: { firstPlayer: 0 } });
  s.turn.number = 1;
  s.turn.part = 1;
  s.turn.current = actor;
  s.turn.actor = actor;
  s.turn.role = 'active';
  s.turn.dice = [3, 4];
  s.phase = { kind: 'main' };
  give(s, 0, hand);
  give(s, 1, { brick: 1, lumber: 2, wool: 3, grain: 2, ore: 1 });
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
