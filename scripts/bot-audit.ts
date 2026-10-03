// The blunder audit: plays whole games with computer players and counts
// clearly bad moves (src/bots/audit.ts says what counts as one):
//   npm run bots:audit -- [games] [modes] [official|random] [players] [levels] [options]
// Every seat at a table plays the same level; each mode and level gets
// `games` games. A mode is a scenario id, "ck" (Cities & Knights) or
// "ck:<scenario>" (a Seafarers scenario with it). With Seafarers it also
// shows how often a player chose the pirate when it could move the robber
// or the pirate. Options:
//   --examples=N   print up to N blunders of each kind with their details
//   --bot=<path>   audit another copy of the bot (a module exporting heuristicAction)
//   --human=N      seat N is a scripted "human" (it takes fair trades and makes
//                  the usual offers; src/bots/audit.ts, scriptedHuman)
// A second table counts trades with other players per game: offers (own turn;
// open ones), counter-offers, the share that ended in a trade, trades between
// two computer players and with the human, the human's offers and the share a
// computer player took (or countered and the human took), cards toward a
// settlement or city handed to the leader and the trades that let it build
// one, and offers repeated after nobody took them.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { auditGame, BLUNDER_KINDS, emptyTally, type Blunder, type BlunderKind, type BotFn, type TradeTally } from '../src/bots/audit.js';
import { BOT_LEVELS, createGame, heuristicAction, type BotLevel, type MapLayout } from '../src/index.js';

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
const games = Number(args[0] ?? 20);
const modes = (args[1] ?? 'base,seafarers-1-new-shores,seafarers-4-through-the-desert,ck,ck:seafarers-1-new-shores').split(',');
const layout: MapLayout = args[2] === 'random' ? 'random' : 'official';
const players = Number(args[3] ?? 3);
const levels = (args[4] ?? BOT_LEVELS.join(',')).split(',') as BotLevel[];
const examples = Number(flags.examples ?? 0);
const humans = flags.human !== undefined ? [Number(flags.human)] : [];

const bot: BotFn = flags.bot
  ? ((await import(pathToFileURL(resolve(flags.bot)).href)) as { heuristicAction: BotFn }).heuristicAction
  : heuristicAction;

const short: Record<BlunderKind, string> = {
  deadEndRoad: 'deadEnd',
  roadOverBuild: 'overBuild',
  missedBuild: 'missed',
  badTrade: 'trade',
  wastedBankTrade: 'bank',
  badDiscard: 'discard',
  robberOwnHex: 'robOwn',
  robberEmptyHex: 'robEmpty',
  barbarianNeglect: 'barb',
  wastedCard: 'card',
  stuck: 'stuck',
};

console.log(
  `${'mode'.padEnd(26)} ${'level'.padEnd(6)} ${BLUNDER_KINDS.map((k) => short[k].padStart(9)).join('')} ${'all/game'.padStart(9)}  ms median / p99 / max`,
);
const shown: Partial<Record<BlunderKind, number>> = {};
const shownList: Blunder[] = [];
const tradeLines: string[] = [];
for (const mode of modes) {
  const ck = mode === 'ck' || mode.startsWith('ck:');
  const scenario = mode.startsWith('ck:') ? mode.slice(3) : ck ? 'base' : mode;
  for (const level of levels) {
    const counts = Object.fromEntries(BLUNDER_KINDS.map((k) => [k, 0])) as Record<BlunderKind, number>;
    const times: number[] = [];
    const pirate = { options: 0, used: 0 };
    const tally = emptyTally();
    let unfinished = 0;
    for (let g = 0; g < games; g++) {
      const start = createGame({
        scenario,
        players,
        seed: `audit-${mode}-${players}p-${g}`,
        options: { firstPlayer: 0, layout, ...(ck ? { citiesAndKnights: true } : {}) },
      });
      const r = auditGame(start, start.players.map(() => level), bot, ck ? 12000 : 6000, undefined, humans);
      for (const k of Object.keys(tally) as Array<keyof TradeTally>) tally[k] += r.trades[k];
      if (r.state.phase.kind !== 'gameOver') unfinished++;
      for (const b of r.blunders) {
        counts[b.kind]++;
        if ((shown[b.kind] ?? 0) < examples) {
          shown[b.kind] = (shown[b.kind] ?? 0) + 1;
          shownList.push({ ...b, detail: `${mode} game ${g}, P${b.player + 1}: ${b.detail}` });
        }
      }
      times.push(...r.times[level]);
      pirate.options += r.pirate[level].options;
      pirate.used += r.pirate[level].used;
    }
    times.sort((a, b) => a - b);
    const q = (x: number) => times[Math.min(times.length - 1, Math.floor(x * times.length))] ?? 0;
    const all = BLUNDER_KINDS.reduce((n, k) => n + counts[k], 0);
    const per = (n: number) => (n / games).toFixed(2).padStart(9);
    console.log(
      `${mode.padEnd(26)} ${level.padEnd(6)} ${BLUNDER_KINDS.map((k) => per(counts[k])).join('')} ${per(all)}  ${q(0.5).toFixed(2)} / ${q(0.99).toFixed(1)} / ${times[times.length - 1]?.toFixed(0) ?? 0}${pirate.options ? `  pirate ${pirate.used}/${pirate.options} (${Math.round((100 * pirate.used) / pirate.options)}%)` : ''}${unfinished ? `  (${unfinished} unfinished)` : ''}`,
    );
    const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`.padStart(9);
    const t = tally;
    tradeLines.push(
      `${mode.padEnd(26)} ${level.padEnd(6)} ${per(t.offers)}${per(t.open)}${per(t.counters)}${pct(t.taken, t.offers + t.counters)}${per(t.botBot)}${per(t.botHuman)}${per(t.humanOffers)}${pct(t.humanTaken, t.humanOffers)}${per(t.leaderCards)}${per(t.leaderBuilds)}${per(t.repeats)}`,
    );
  }
}
console.log('');
console.log(
  `${'trades per game'.padEnd(26)} ${'level'.padEnd(6)} ${['offers', 'open', 'counter', 'taken', 'bot-bot', 'bot-hum', 'humOffer', 'humTaken', 'ldrCards', 'ldrBuild', 'repeats'].map((x) => x.padStart(9)).join('')}`,
);
for (const l of tradeLines) console.log(l);
if (shownList.length > 0) {
  console.log('');
  for (const b of shownList) console.log(`${b.kind} [${b.level}, turn ${b.turn}] ${b.detail}`);
}
