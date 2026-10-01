// Plays computer players of different levels against each other and counts wins:
//   npx vite-node scripts/bot-league.ts [games-per-scenario] [scenario,...] [official|random] [players]
// Every table has one easy, one medium and one hard player (with 4-6 players
// the levels repeat round the table); seats rotate so nobody always goes first.
import { BOT_LEVELS, createGame, simulateHeuristic, totalVP, type BotLevel, type MapLayout } from '../src/index.js';

const games = Number(process.argv[2] ?? 30);
const scenarios = (process.argv[3] ?? 'base,seafarers-1-new-shores,seafarers-2-four-islands').split(',');
const layout: MapLayout = process.argv[4] === 'random' ? 'random' : 'official';
const players = Number(process.argv[5] ?? 3);
const orders: BotLevel[][] = [
  ['easy', 'medium', 'hard'],
  ['medium', 'hard', 'easy'],
  ['hard', 'easy', 'medium'],
  ['easy', 'hard', 'medium'],
  ['hard', 'medium', 'easy'],
  ['medium', 'easy', 'hard'],
];

for (const scenario of scenarios) {
  const wins: Record<BotLevel, number> = { easy: 0, medium: 0, hard: 0 };
  const vp: Record<BotLevel, number> = { easy: 0, medium: 0, hard: 0 };
  const seats: Record<BotLevel, number> = { easy: 0, medium: 0, hard: 0 };
  let unfinished = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const levels = Array.from({ length: players }, (_, i) => orders[g % orders.length][i % 3]);
    const seed = players === 3 ? `league-${scenario}-${g}` : `league-${scenario}-${players}p-${g}`;
    const start = createGame({ scenario, players, seed, options: { firstPlayer: 0, layout } });
    const { state } = simulateHeuristic(start, 6000, levels);
    if (state.phase.kind !== 'gameOver') {
      unfinished++;
      continue;
    }
    if (state.phase.winner === null) continue;
    wins[levels[state.phase.winner]]++;
    levels.forEach((l, p) => {
      vp[l] += totalVP(state, p);
      seats[l]++;
    });
  }
  const done = games - unfinished;
  const line = BOT_LEVELS.map((l) => `${l} ${wins[l]} wins (${Math.round((100 * wins[l]) / Math.max(1, done))}%), avg ${(vp[l] / Math.max(1, seats[l])).toFixed(1)} VP`).join(' | ');
  const label = players === 3 ? scenario : `${scenario} (${players}p)`;
  console.log(`${label.padEnd(28)} ${line}${unfinished ? ` | ${unfinished} unfinished` : ''}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
}
