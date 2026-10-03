// Head to head: this bot against another copy of it (for instance an older
// commit's src/ checked out elsewhere), half the seats each, seats
// alternating from game to game:
//   npm run bots:match -- [games] [mode] [official|random] [players] --old=<module> [options]
// A mode is a scenario id, "ck" (Cities & Knights) or "ck:<scenario>". The
// module exports heuristicAction (e.g. /tmp/old/src/index.ts). Options:
//   --level=hard       the level both sides play (--old-level= for the other side)
//   --w=name:value,... this bot's C&K weights changed (src/bots/ckWeights.ts);
//                      --old-w= the same for the other side when it is this bot too
//   --seed=match       the seed prefix (games use <prefix>-<mode>-<layout>-<n>)
//   --from=0           the first game's number n (another range: other seeds)
//   --jobs=N           run in N processes
//   --stats            show how each side played: VP sources, metropolises,
//                      pillaged cities, progress cards, knights, hands
//   --json             print the totals as JSON (scripts/bot-tune-ck.ts reads them)
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { botProfile, createGame, heuristicAction, legalActions, type Action, type BotLevel, type GameState, type MapLayout, type PlayerId } from '../src/index.js';
import { ckHeuristicAction } from '../src/bots/ckBot.js';
import { HARD_CK_WEIGHTS, type CkWeights } from '../src/bots/ckWeights.js';
import { addStats, emptyStats, playGame, type SeatStats } from './match-lib.js';

type BotFn = (s: GameState, p: PlayerId, level: BotLevel) => Action | null;

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? 'true'];
    }),
);
const games = Number(args[0] ?? 40);
// (the first game's number: a tuner's held-out seeds are another range)
const first = Number(flags.from ?? 0);
const mode = args[1] ?? 'ck';
const layout: MapLayout = args[2] === 'random' ? 'random' : 'official';
const players = Number(args[3] ?? 4);
const level = (flags.level ?? 'hard') as BotLevel;
const oldLevel = (flags['old-level'] ?? level) as BotLevel;
const prefix = flags.seed ?? 'match';
const jobs = Number(flags.jobs ?? 1);

/** The bot at `level` with some of its C&K weights changed ("name:value,..."). */
function weighted(level: BotLevel, spec: string | undefined): BotFn {
  if (!spec) return heuristicAction;
  const weights: CkWeights = { ...HARD_CK_WEIGHTS };
  const base = botProfile(level);
  const pr = { ...base, ck: { ...base.ck, weights } };
  for (const part of spec.split(',')) {
    const [k, v] = part.split(':');
    // (the profile's commodity weight too)
    if (k === 'commodities') pr.ck.commodities = Number(v);
    else if (!(k in weights)) throw new Error(`no weight ${k}`);
    else (weights as unknown as Record<string, number>)[k] = Number(v);
  }
  return (s, p) => {
    const acts = legalActions(s, p);
    return acts.length === 0 ? null : s.ck ? ckHeuristicAction(s, p, acts, pr) : heuristicAction(s, p, level);
  };
}

interface Summary {
  done: number;
  unfinished: number;
  turns: number;
  side: [SeatStats, SeatStats];
  times: number[];
}

/** Games `from` to `to`, every `step`-th from `from` (a shard of `step` takes every step-th game, so long and short games spread evenly). */
async function run(from: number, to: number, step = 1): Promise<Summary> {
  const oldBot: BotFn = flags.old
    ? ((await import(pathToFileURL(resolve(flags.old)).href)) as { heuristicAction: BotFn }).heuristicAction
    : weighted(oldLevel, flags['old-w']);
  const newBot = weighted(level, flags.w);
  const ck = mode === 'ck' || mode.startsWith('ck:');
  const scenario = mode.startsWith('ck:') ? mode.slice(3) : ck ? 'base' : mode;
  const out: Summary = { done: 0, unfinished: 0, turns: 0, side: [emptyStats(), emptyStats()], times: [] };
  for (let g = from; g < to; g += step) {
    // side 0 (this bot) on the even seats in even games, the odd seats in odd games
    const sideOf = (p: PlayerId) => (p % 2 === g % 2 ? 0 : 1);
    const start = createGame({
      scenario,
      players,
      seed: `${prefix}-${mode}-${layout}-${g}`,
      options: { firstPlayer: 0, layout, ...(ck ? { citiesAndKnights: true } : {}) },
    });
    const bots = start.players.map((_, p) => (sideOf(p) === 0 ? (s: GameState, q: PlayerId) => newBot(s, q, level) : (s: GameState, q: PlayerId) => oldBot(s, q, oldLevel)));
    const r = playGame(start, bots, ck ? 12000 : 6000, !!flags.stats);
    out.times.push(...r.times);
    if (!r.finished) {
      out.unfinished++;
      continue;
    }
    out.done++;
    out.turns += r.state.turn.number;
    r.stats.forEach((st, p) => (out.side[sideOf(p)] = addStats(out.side[sideOf(p)], st)));
  }
  return out;
}


async function main(): Promise<void> {
  if (flags.shard) {
    const [k, n] = flags.shard.split('/').map(Number);
    const r = await run(first + k, first + games, n);
    process.stdout.write(`${JSON.stringify(r)}\n`);
    return;
  }
  const t0 = Date.now();
  let total: Summary;
  if (jobs <= 1) total = await run(first, first + games);
  else {
    const self = [fileURLToPath(import.meta.url), ...process.argv.slice(2).filter((a) => !a.startsWith('--jobs'))];
    const parts = await Promise.all(
      Array.from(
        { length: jobs },
        (_, k) =>
          new Promise<Summary>((done, fail) => {
            const child = spawn(resolve('node_modules/.bin/vite-node'), [...self, `--shard=${k}/${jobs}`], { stdio: ['ignore', 'pipe', 'inherit'] });
            let text = '';
            child.stdout.on('data', (d) => (text += d));
            child.on('exit', (code) => (code === 0 ? done(JSON.parse(text.trim().split('\n').pop()!)) : fail(new Error(`shard ${k} failed`))));
          }),
      ),
    );
    total = parts.reduce((a, b) => ({
      done: a.done + b.done,
      unfinished: a.unfinished + b.unfinished,
      turns: a.turns + b.turns,
      side: [addStats(a.side[0], b.side[0]), addStats(a.side[1], b.side[1])],
      times: [...a.times, ...b.times],
    }));
  }
  const [mine, theirs] = total.side;
  if (flags.json) {
    // (for scripts: the totals without the decision times)
    process.stdout.write(`${JSON.stringify({ ...total, times: [] })}\n`);
    return;
  }
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, total.done))}%`;
  console.log(
    `${mode} ${layout} ${players}p, ${level}${flags.w ? ` (${flags.w})` : ''} vs ${flags.old ? `${oldLevel} of ${flags.old}` : `${oldLevel}${flags['old-w'] ? ` (${flags['old-w']})` : ''}`}: ${total.done}/${games} finished, ` +
      `this bot ${mine.wins} wins (${pct(mine.wins)}), the other ${theirs.wins} (${pct(theirs.wins)}), ` +
      `avg VP ${(mine.vp / Math.max(1, mine.games)).toFixed(2)} vs ${(theirs.vp / Math.max(1, theirs.games)).toFixed(2)}, ` +
      `${(total.turns / Math.max(1, total.done)).toFixed(0)} turns a game  [${((Date.now() - t0) / 1000).toFixed(0)} s]`,
  );
  if (flags.stats) {
    const rows: Array<[string, (x: SeatStats) => number]> = [
      ['VP', (x) => x.vp],
      ['  settlements', (x) => x.settlementsVP],
      ['  cities', (x) => x.citiesVP],
      ['  metropolises', (x) => x.metropolisVP],
      ['  Longest Road', (x) => x.routeVP],
      ['  Defender', (x) => x.defenderVP],
      ['  VP cards', (x) => x.cardVP],
      ['  merchant', (x) => x.merchantVP],
      ['  scenario', (x) => x.scenarioVP],
      ['wonder levels', (x) => x.wonderLevels],
      ['metropolises won', (x) => x.metropolisesWon],
      ['metropolises lost', (x) => x.metropolisesLost],
      ['improvement levels', (x) => x.improvements],
      ['cities pillaged', (x) => x.pillaged],
      ['walls', (x) => x.walls],
      ['knights hired', (x) => x.knightsHired],
      ['activations', (x) => x.activations],
      ['promotions', (x) => x.promotions],
      ['progress drawn', (x) => x.progressDrawn],
      ['progress played', (x) => x.progressPlayed],
      ['progress discarded', (x) => x.progressDiscarded],
      ['bank trades', (x) => x.bankTrades],
      ['commodities to bank', (x) => x.commoditiesToBank],
      ['cards lost on 7s', (x) => x.discarded],
    ];
    console.log(`${'per seat and game'.padEnd(22)} ${'this'.padStart(7)} ${'other'.padStart(7)}`);
    for (const [label, f] of rows) console.log(`${label.padEnd(22)} ${(f(mine) / Math.max(1, mine.games)).toFixed(2).padStart(7)} ${(f(theirs) / Math.max(1, theirs.games)).toFixed(2).padStart(7)}`);
    console.log(`${'hand at end of turn'.padEnd(22)} ${(mine.handAtEnd / Math.max(1, mine.turnsEnded)).toFixed(2).padStart(7)} ${(theirs.handAtEnd / Math.max(1, theirs.turnsEnded)).toFixed(2).padStart(7)}`);
    const cards = [...new Set([...Object.keys(mine.cardsPlayed), ...Object.keys(theirs.cardsPlayed)])].sort();
    console.log(`cards played: ${cards.map((c) => `${c} ${((mine.cardsPlayed[c] ?? 0) / mine.games).toFixed(2)}/${((theirs.cardsPlayed[c] ?? 0) / theirs.games).toFixed(2)}`).join(', ')}`);
    const t = [...total.times].sort((a, b) => a - b);
    const q = (x: number) => t[Math.min(t.length - 1, Math.floor(x * t.length))] ?? 0;
    console.log(`decision ms (both sides): median ${q(0.5).toFixed(2)}, p99 ${q(0.99).toFixed(1)}, max ${(t[t.length - 1] ?? 0).toFixed(0)}`);
  }
}

await main();
