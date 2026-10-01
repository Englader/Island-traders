// Plays computer players of different levels against each other and counts wins:
//   npx vite-node scripts/bot-league.ts [games-per-scenario] [scenario,...] [official|random] [players] [paired|specialBuild]
// Every table has one easy, one medium and one hard player (with 4-6 players
// the levels repeat round the table); seats rotate so nobody always goes first.
// The scenario "ck" is the base game with Cities & Knights; its line also shows
// how long the games ran and how long a computer move took. With 5-6 players
// the last argument picks paired players (the default) or the special build phase.
import { BOT_LEVELS, createGame, simulateHeuristic, totalVP, type BotLevel, type FiveSixMode, type MapLayout } from '../src/index.js';

const games = Number(process.argv[2] ?? 30);
const scenarios = (process.argv[3] ?? 'base,seafarers-1-new-shores,seafarers-2-four-islands').split(',');
const layout: MapLayout = process.argv[4] === 'random' ? 'random' : 'official';
const players = Number(process.argv[5] ?? 3);
const fiveSixMode: FiveSixMode = process.argv[6] === 'specialBuild' ? 'specialBuild' : 'paired';
const orders: BotLevel[][] = [
  ['easy', 'medium', 'hard'],
  ['medium', 'hard', 'easy'],
  ['hard', 'easy', 'medium'],
  ['easy', 'hard', 'medium'],
  ['hard', 'medium', 'easy'],
  ['medium', 'easy', 'hard'],
];

for (const scenario of scenarios) {
  const ck = scenario === 'ck';
  const wins: Record<BotLevel, number> = { easy: 0, medium: 0, hard: 0 };
  const vp: Record<BotLevel, number> = { easy: 0, medium: 0, hard: 0 };
  const seats: Record<BotLevel, number> = { easy: 0, medium: 0, hard: 0 };
  let unfinished = 0;
  let turns = 0;
  let moves = 0;
  let slowest = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const levels = Array.from({ length: players }, (_, i) => orders[g % orders.length][i % 3]);
    const seed = players === 3 ? `league-${scenario}-${g}` : `league-${scenario}-${players}p-${g}`;
    const start = createGame({
      scenario: ck ? 'base' : scenario,
      players,
      seed: ck && layout === 'random' ? `${seed}-random` : seed,
      options: { firstPlayer: 0, layout, ...(players >= 5 ? { fiveSixMode } : {}), ...(ck ? { citiesAndKnights: true } : {}) },
    });
    // time each move (the bot's choice and the engine applying it)
    let last = performance.now();
    const { state, steps } = simulateHeuristic(start, ck ? 12000 : 6000, levels, () => {
      const now = performance.now();
      slowest = Math.max(slowest, now - last);
      last = now;
    });
    moves += steps;
    if (state.phase.kind !== 'gameOver') {
      unfinished++;
      continue;
    }
    turns += state.turn.number;
    if (state.phase.winner === null) continue;
    wins[levels[state.phase.winner]]++;
    levels.forEach((l, p) => {
      vp[l] += totalVP(state, p);
      seats[l]++;
    });
  }
  const ms = Date.now() - t0;
  const done = games - unfinished;
  const line = BOT_LEVELS.map((l) => `${l} ${wins[l]} wins (${Math.round((100 * wins[l]) / Math.max(1, done))}%), avg ${(vp[l] / Math.max(1, seats[l])).toFixed(1)} VP`).join(' | ');
  const name = ck ? `Cities & Knights, ${layout}` : scenario;
  const label = players === 3 ? name : `${name} (${players}p${players >= 5 && fiveSixMode === 'specialBuild' ? ', SBP' : ''})`;
  const extra = ck
    ? ` | ${done}/${games} finished, ${(turns / Math.max(1, done)).toFixed(0)} turns a game, ${(ms / Math.max(1, moves)).toFixed(2)} ms a move (slowest ${slowest.toFixed(0)} ms)`
    : unfinished
      ? ` | ${unfinished} unfinished`
      : '';
  console.log(`${label.padEnd(28)} ${line}${extra}  [${(ms / 1000).toFixed(0)} s]`);
}
