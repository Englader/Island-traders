// Tunes the hard level's Cities & Knights weights (src/bots/ckWeights.ts) by
// self-play, offline (never in CI):
//   npm run bots:tune-ck -- [iterations] [games] [options]
// A (1+1) evolution strategy: each step changes one to three weights of the
// best vector so far by a random amount and plays `games` games of two seats
// with it against two seats of the reference bot at 4-player tables (seats
// alternating, split over the modes). The seeds are the same at every step:
// a first set, and a second one for a change that does about as well as the
// best on the first; it keeps the change when it wins more over both. The
// last vector is checked on held-out seeds. Options:
//   --modes=ck:random,ck:official,ck:seafarers-1-new-shores:random,ck:seafarers-8-wonders:random
//               modes and maps to play (a mode as in bot-match, then the map; these by default)
//   --params=a,b,...  the weights to tune (default: all of them, and the profile's commodity weight)
//   --start=name:value,...  the starting vector (default: today's weights)
//   --old=<module>    the reference bot (default: this bot with today's weights)
//   --holdout=N       held-out games at the end (default: games)
//   --seed=tune       the seed prefix
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CK_WEIGHT_NAMES, HARD_CK_WEIGHTS } from '../src/bots/ckWeights.js';
import { botProfile, nextInt, seedRng } from '../src/index.js';

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
const iterations = Number(args[0] ?? 30);
const games = Number(args[1] ?? 200);
const modes = (flags.modes ?? 'ck:random,ck:official,ck:seafarers-1-new-shores:random,ck:seafarers-8-wonders:random').split(',');
const prefix = flags.seed ?? 'tune';
const holdout = Number(flags.holdout ?? games);

type Vector = Record<string, number>;

/** How far each weight may go and how big a first step is. */
const RANGES: Record<string, [number, number, number]> = {
  planAhead: [2, 7, 1],
  defenderReach: [0, 4, 1],
  defenderWorth: [0, 12, 2],
  idleShare: [0, 1, 0.25],
  tieReach: [0, 3, 1],
  tieWorth: [0, 10, 2],
  tieIdle: [0, 3, 1],
  earlyWake: [0, 6, 1],
  guards: [0, 4, 1],
  cheapLevel: [0, 4, 1],
  buildVP: [2, 12, 2],
  buildCard: [0.2, 2, 0.3],
  wallMargin: [0, 6, 1],
  routeGap: [0, 13, 2],
  cardWorth: [0.5, 6, 1],
  levelTrade: [0, 3, 0.5],
  metropolisFirst: [0, 1, 1],
  wonderRush: [0, 4, 1],
  sabotage: [0.1, 1, 0.15],
  tracked: [0, 1, 1],
  commodities: [0, 4, 0.6],
};
/** Weights that only take whole numbers. */
const WHOLE = new Set(['tracked', 'planAhead', 'defenderReach', 'tieReach', 'tieIdle', 'earlyWake', 'guards', 'cheapLevel', 'metropolisFirst', 'wallMargin', 'routeGap']);

const names = flags.params ? flags.params.split(',') : [...CK_WEIGHT_NAMES, 'commodities'];
for (const n of names) if (!RANGES[n]) throw new Error(`no range for ${n}`);

const defaults: Vector = { ...(HARD_CK_WEIGHTS as unknown as Vector), commodities: botProfile('hard').ck.commodities };
const start: Vector = { ...defaults };
for (const part of (flags.start ?? '').split(',').filter(Boolean)) {
  const [k, v] = part.split(':');
  if (!(k in start)) throw new Error(`no weight ${k}`);
  start[k] = Number(v);
}

/** The weights given to the bot: the tuned ones and any other that differs from today's. */
const spec = (v: Vector) =>
  Object.keys(v)
    .filter((n) => names.includes(n) || v[n] !== defaults[n])
    .map((n) => `${n}:${+v[n].toFixed(3)}`)
    .join(',');

/** One mode's games: the candidate's wins out of the finished ones. */
function play(v: Vector, mode: string, n: number, from: number): Promise<{ wins: number; done: number }> {
  const parts = mode.split(':');
  const layout = parts[parts.length - 1] === 'official' || parts[parts.length - 1] === 'random' ? parts.pop()! : 'random';
  const m = parts.join(':');
  const argv = [
    resolve(fileURLToPath(import.meta.url), '../bot-match.ts'),
    String(n),
    m,
    layout,
    '4',
    `--w=${spec(v)}`,
    '--json',
    `--jobs=${flags.jobs ?? 4}`,
    `--seed=${prefix}`,
    `--from=${from}`,
    ...(flags.old ? [`--old=${flags.old}`] : []),
  ];
  return new Promise((done, fail) => {
    const child = spawn(resolve('node_modules/.bin/vite-node'), argv, { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', (d) => (text += d));
    child.on('exit', (code) => {
      if (code !== 0) return fail(new Error(`bot-match failed for ${mode}`));
      const r = JSON.parse(text.trim().split('\n').pop()!) as { done: number; side: Array<{ wins: number }> };
      done({ wins: r.side[0].wins, done: r.done });
    });
  });
}

/** The candidate's win rate over `n` games split over the modes (played side by side), from game `from` on. */
async function fitness(v: Vector, n: number, from: number): Promise<number> {
  const results = await Promise.all(modes.map((mode) => play(v, mode, Math.ceil(n / modes.length), from)));
  const wins = results.reduce((x, r) => x + r.wins, 0);
  const done = results.reduce((x, r) => x + r.done, 0);
  return wins / Math.max(1, done);
}

const rng = seedRng(`${prefix}-steps`);
const gauss = () => {
  // (Box-Muller from the seeded generator)
  const u = (nextInt(rng, 1 << 30) + 1) / (1 << 30);
  const w = nextInt(rng, 1 << 30) / (1 << 30);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
};

let best: Vector = { ...start };
// (the best vector's win rate on the first and the second set of seeds)
let score = await fitness(best, games, 0);
let second = await fitness(best, games, 50000);
let scale = 1;
console.log(`start ${(100 * score).toFixed(1)}% / ${(100 * second).toFixed(1)}%  ${spec(best)}`);
for (let i = 0; i < iterations; i++) {
  const next = { ...best };
  const k = 1 + nextInt(rng, 3);
  const picked = new Set<string>();
  while (picked.size < Math.min(k, names.length)) picked.add(names[nextInt(rng, names.length)]);
  for (const n of picked) {
    const [lo, hi, step] = RANGES[n];
    let x = next[n] + gauss() * step * scale;
    // (a whole number moves at least one, away from the end of its range)
    if (WHOLE.has(n) && Math.round(x) === next[n]) x = next[n] <= lo ? lo + 1 : next[n] >= hi ? hi - 1 : next[n] + (gauss() < 0 ? -1 : 1);
    if (WHOLE.has(n)) x = Math.round(x);
    next[n] = Math.max(lo, Math.min(hi, x));
  }
  const s = await fitness(next, games, 0);
  // (within a point of the best on the first seeds: the second set decides)
  const s2 = s > score - 0.01 ? await fitness(next, games, 50000) : -1;
  const took = s2 >= 0 && s + s2 > score + second;
  const change = [...picked].map((n) => `${n} ${+best[n].toFixed(2)}->${+next[n].toFixed(2)}`).join(', ');
  console.log(`${String(i + 1).padStart(3)} ${(100 * s).toFixed(1)}%${s2 >= 0 ? ` / ${(100 * s2).toFixed(1)}%` : '        '} ${took ? 'kept' : '    '} ${change}`);
  if (took) {
    best = next;
    score = s;
    second = s2;
    scale = Math.min(2, scale * 1.3);
  } else scale = Math.max(0.3, scale * 0.93);
}
console.log(`best on the tuning seeds ${(100 * score).toFixed(1)}% / ${(100 * second).toFixed(1)}%: ${spec(best)}`);
const held = await fitness(best, holdout, 100000);
const base = await fitness(start, holdout, 100000);
console.log(`held-out seeds (${holdout} games): tuned ${(100 * held).toFixed(1)}%, start ${(100 * base).toFixed(1)}%`);
