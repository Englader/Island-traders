// Plays computer players of different levels against each other and counts wins:
//   npx vite-node scripts/bot-league.ts [games-per-scenario] [scenario,...] [official|random] [players] [paired|specialBuild]
// Every table has one easy, one medium and one hard player (with 4-6 players
// the levels repeat round the table); seats rotate so nobody always goes first.
// The scenario "ck" is the base game with Cities & Knights, "ck:<scenario>" a
// Seafarers scenario with it (e.g. ck:seafarers-1-new-shores); their lines also
// show how long the games ran and how long a computer move took. With 5-6
// players the last argument picks paired players (the default) or the special
// build phase.
//
// Head to head: --versus=<path> seats this bot against another copy of it (a
// module exporting heuristicAction, e.g. an older commit's src/index.ts), both
// at --level (default hard), alternating round the table and from game to
// game, and counts each one's wins against its share of the seats.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  BOT_LEVELS,
  applyAction,
  createGame,
  heuristicAction,
  playersToAct,
  simulateHeuristic,
  totalVP,
  type Action,
  type BotLevel,
  type FiveSixMode,
  type GameState,
  type MapLayout,
  type PlayerId,
} from '../src/index.js';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    }),
);
const games = Number(argv[0] ?? 30);
const scenarios = (argv[1] ?? 'base,seafarers-1-new-shores,seafarers-2-four-islands').split(',');
const layout: MapLayout = argv[2] === 'random' ? 'random' : 'official';
const players = Number(argv[3] ?? 3);
const fiveSixMode: FiveSixMode = argv[4] === 'specialBuild' ? 'specialBuild' : 'paired';

type BotFn = (s: GameState, p: PlayerId, level: BotLevel) => Action | null;

/** A game with a bot function per seat (as simulateHeuristic, safety valve included). */
function play(start: GameState, bots: BotFn[], level: BotLevel, maxSteps: number): GameState {
  let s = start;
  let steps = 0;
  let partSteps = 0;
  let part = s.turn.part;
  while (s.phase.kind !== 'gameOver' && steps < maxSteps) {
    let acted = false;
    for (const p of playersToAct(s)) {
      let a = bots[p](s, p, level);
      if (!a) continue;
      if (s.turn.part !== part) {
        part = s.turn.part;
        partSteps = 0;
      }
      if (++partSteps > 60 && s.phase.kind === 'main' && s.turn.actor === p) {
        const end: Action = { type: 'endTurn', player: p };
        if (!s.ck || applyAction(s, end).ok) a = end;
      }
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(`bot move rejected: ${JSON.stringify(a)} -> ${r.error} (phase ${s.phase.kind})`);
      s = r.state;
      acted = true;
      break;
    }
    if (!acted) throw new Error(`deadlock in phase ${s.phase.kind}`);
    steps++;
  }
  return s;
}

if (flags.versus) {
  const other = ((await import(pathToFileURL(resolve(flags.versus)).href)) as { heuristicAction: BotFn }).heuristicAction;
  const levels = (flags.level ?? 'hard').split(',') as BotLevel[];
  for (const level of levels) {
    for (const scenario of scenarios) {
      const ck = scenario === 'ck' || scenario.startsWith('ck:');
      const id = scenario.startsWith('ck:') ? scenario.slice(3) : ck ? 'base' : scenario;
      let mine = 0;
      let theirs = 0;
      let mySeats = 0;
      let unfinished = 0;
      let done = 0;
      const t0 = Date.now();
      for (let g = 0; g < games; g++) {
        // this bot on alternate seats, starting with seat 0 in even games
        const isMine = (p: number) => (p + g) % 2 === 0;
        const bots = Array.from({ length: players }, (_, p) => (isMine(p) ? heuristicAction : other));
        const seed = `versus-${scenario}-${players}p-${g}`;
        const start = createGame({
          scenario: id,
          players,
          seed,
          options: { firstPlayer: 0, layout, ...(players >= 5 ? { fiveSixMode } : {}), ...(ck ? { citiesAndKnights: true } : {}) },
        });
        const end = play(start, bots, level, ck ? 12000 : 6000);
        if (end.phase.kind !== 'gameOver' || end.phase.winner === null) {
          unfinished++;
          continue;
        }
        done++;
        mySeats += Array.from({ length: players }, (_, p) => p).filter(isMine).length;
        if (isMine(end.phase.winner)) mine++;
        else theirs++;
      }
      const share = mySeats / Math.max(1, done * players);
      const name = ck ? (scenario === 'ck' ? `Cities & Knights, ${layout}` : `C&K + ${id.replace(/^seafarers-\d-/, '')}, ${layout}`) : scenario;
      console.log(
        `${`${name} (${players}p, ${level})`.padEnd(40)} this bot ${mine} wins (${Math.round((100 * mine) / Math.max(1, done))}% with ${Math.round(100 * share)}% of the seats), the other ${theirs}${unfinished ? `, ${unfinished} unfinished` : ''}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`,
      );
    }
  }
  process.exit(0);
}
const orders: BotLevel[][] = [
  ['easy', 'medium', 'hard'],
  ['medium', 'hard', 'easy'],
  ['hard', 'easy', 'medium'],
  ['easy', 'hard', 'medium'],
  ['hard', 'medium', 'easy'],
  ['medium', 'easy', 'hard'],
];

for (const scenario of scenarios) {
  const ck = scenario === 'ck' || scenario.startsWith('ck:');
  const id = scenario.startsWith('ck:') ? scenario.slice(3) : ck ? 'base' : scenario;
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
      scenario: id,
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
  const name = scenario === 'ck' ? `Cities & Knights, ${layout}` : ck ? `C&K + ${id.replace(/^seafarers-\d-/, '')}, ${layout}` : scenario;
  const label = players === 3 ? name : `${name} (${players}p${players >= 5 && fiveSixMode === 'specialBuild' ? ', SBP' : ''})`;
  const extra = ck
    ? ` | ${done}/${games} finished, ${(turns / Math.max(1, done)).toFixed(0)} turns a game, ${(ms / Math.max(1, moves)).toFixed(2)} ms a move (slowest ${slowest.toFixed(0)} ms)`
    : unfinished
      ? ` | ${unfinished} unfinished`
      : '';
  console.log(`${label.padEnd(28)} ${line}${extra}  [${(ms / 1000).toFixed(0)} s]`);
}
