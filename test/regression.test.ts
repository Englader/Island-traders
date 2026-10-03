import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  legalActions,
  playersToAct,
  seedRng,
  simulate,
  simulateHeuristic,
  viewFor,
  type Action,
  type BotLevel,
  type GameConfig,
  type GameState,
} from '../src/index.js';

/**
 * Fingerprints of whole games: the start state, the moves, the final state,
 * the views and the legal moves at the end. Two kinds:
 *
 * - Engine fingerprints must never change: random bots, and games replayed
 *   move by move from a recording (the computer players of commits 7fc781f
 *   and d3b32c1, test/fixtures/bot-games-<commit>.json.gz). They pin down
 *   the rules engine alone; a change means base, Seafarers or Cities &
 *   Knights games behave differently.
 * - Computer player fingerprints change whenever the heuristic bots decide
 *   differently, which is fine when the bots were changed on purpose: then
 *   re-record them (and only them).
 */
type Mode = 'random' | 'heuristic' | 'replay';

/** The games recorded with the computer players of a commit, by key. */
function recorded(commit: string): Record<string, Action[]> {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/bot-games-${commit}.json.gz`, import.meta.url))).toString()) as Record<string, Action[]>;
}

/** Recordings as `<commit>/<key>`. */
const RECORDED: Record<string, Action[]> = {};
for (const commit of ['7fc781f', 'd3b32c1']) for (const [key, actions] of Object.entries(recorded(commit))) RECORDED[`${commit}/${key}`] = actions;

function fingerprint(config: GameConfig, mode: Mode, steps: number, levels?: BotLevel[], recording?: string): string {
  const h = createHash('sha256');
  const start = createGame(config);
  h.update(JSON.stringify(start));
  const actions: Action[] = [];
  let final: GameState;
  if (mode === 'random') final = simulate(start, seedRng(`regression-${String(config.seed)}`), steps, (_s, a) => actions.push(a)).state;
  else if (mode === 'heuristic') final = simulateHeuristic(start, steps, levels).state;
  else {
    final = start;
    for (const a of RECORDED[recording!]) {
      const r = applyAction(final, a);
      if (!r.ok) throw new Error(`recorded move rejected: ${JSON.stringify(a)} -> ${r.error}`);
      final = r.state;
    }
  }
  // (computer player games, recorded or not, hash their moves through the final state's log)
  h.update(JSON.stringify(actions));
  h.update(JSON.stringify(final));
  h.update(JSON.stringify(viewFor(final, 0)));
  h.update(JSON.stringify(viewFor(final, null)));
  for (const p of playersToAct(final)) h.update(JSON.stringify(legalActions(final, p)));
  return h.digest('hex').slice(0, 16);
}

interface Case {
  name: string;
  config: GameConfig;
  mode: Mode;
  steps: number;
  levels?: BotLevel[];
  /** The recorded game a replay plays back. */
  recording?: string;
  hash: string;
}

const CK = { citiesAndKnights: true } as const;

/**
 * Games without Cities & Knights must play exactly as they did before the
 * expansion existed: the same seeds give the same states, logs, views and
 * legal moves. These fingerprints were recorded on the engine before Cities
 * & Knights was added (commit fb6e3f7).
 */
const CASES: Case[] = [
  { name: 'base, 3 players, official map, random bots', config: { scenario: 'base', players: 3, seed: 'reg-1' }, mode: 'random', steps: 800, hash: 'c5e5615e376d4ef0' },
  { name: 'base, 4 players, random map, random bots', config: { scenario: 'base', players: 4, seed: 'reg-2', options: { layout: 'random' } }, mode: 'random', steps: 800, hash: '654fde1b8d434070' },
  { name: 'base, 5 players, paired players, random bots', config: { scenario: 'base', players: 5, seed: 'reg-3' }, mode: 'random', steps: 800, hash: '87eee7c62e19d762' },
  { name: 'base, 6 players, special build phase, random bots', config: { scenario: 'base', players: 6, seed: 'reg-4', options: { fiveSixMode: 'specialBuild', layout: 'random' } }, mode: 'random', steps: 800, hash: '3b853da0d33022de' },
  { name: 'base, 4 players, a recorded game of computer players', config: { scenario: 'base', players: 4, seed: 'reg-5' }, mode: 'replay', steps: 4000, recording: '7fc781f/base-4p-reg-5', hash: 'a8c65213c62e51ff' },
  { name: 'Heading for New Shores, 4 players, random bots', config: { scenario: 'seafarers-1-new-shores', players: 4, seed: 'reg-6' }, mode: 'random', steps: 800, hash: '367e06b71932b467' },
  { name: 'The Fog Islands, 3 players, random map, random bots', config: { scenario: 'seafarers-3-fog-islands', players: 3, seed: 'reg-7', options: { layout: 'random' } }, mode: 'random', steps: 800, hash: 'c064237fc7525315' },
  { name: 'Cloth Trade, 4 players, random bots', config: { scenario: 'seafarers-6-cloth-trade', players: 4, seed: 'reg-8' }, mode: 'random', steps: 800, hash: '07c3defea60cfa96' },
  { name: 'The Pirate Islands, 4 players, a recorded game of computer players', config: { scenario: 'seafarers-7-pirate-islands', players: 4, seed: 'reg-9' }, mode: 'replay', steps: 4000, recording: '7fc781f/pirate-islands-4p-reg-9', hash: '9e2ea6feb15fe90e' },
  { name: 'The Wonders, 3 players, a recorded game of computer players', config: { scenario: 'seafarers-8-wonders', players: 3, seed: 'reg-10' }, mode: 'replay', steps: 4000, recording: '7fc781f/wonders-3p-reg-10', hash: 'b9b044ce56061521' },
  { name: 'New World, 5 players, random bots', config: { scenario: 'seafarers-9-new-world', players: 5, seed: 'reg-11' }, mode: 'random', steps: 800, hash: '6200701285727312' },
];

describe('base and Seafarers games are unchanged by Cities & Knights', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(fingerprint(c.config, c.mode, c.steps, c.levels, c.recording)).toBe(c.hash);
    });
  }
});

/**
 * Cities & Knights with 3–4 players must play exactly as it did before the
 * 5–6 player extension was added: these fingerprints were recorded on the
 * engine of commit 352f5a7.
 */
const CK_CASES: Case[] = [
  { name: 'C&K, 3 players, official map, random bots', config: { scenario: 'base', players: 3, seed: 'reg-ck-1', options: CK }, mode: 'random', steps: 1500, hash: 'bb4edf587f06f411' },
  { name: 'C&K, 4 players, random map, random bots', config: { scenario: 'base', players: 4, seed: 'reg-ck-2', options: { ...CK, layout: 'random' } }, mode: 'random', steps: 1500, hash: 'f5bbf107d605191d' },
  { name: 'C&K, 4 players, a recorded game of computer players', config: { scenario: 'base', players: 4, seed: 'reg-ck-3', options: CK }, mode: 'replay', steps: 12000, recording: '7fc781f/ck-4p-reg-ck-3', hash: '1ae8e15477796d08' },
  { name: 'C&K, 3 players, a recorded game of easy/medium/hard players', config: { scenario: 'base', players: 3, seed: 'reg-ck-4', options: { ...CK, layout: 'random' } }, mode: 'replay', steps: 12000, recording: '7fc781f/ck-3p-reg-ck-4', hash: '63612ec8d5849f67' },
];

describe('Cities & Knights with 3–4 players is unchanged by the 5–6 extension', () => {
  for (const c of CK_CASES) {
    it(c.name, () => {
      expect(fingerprint(c.config, c.mode, c.steps, c.levels, c.recording)).toBe(c.hash);
    });
  }
});

/**
 * The computer players of commit d3b32c1 (before the trading changes), their
 * games replayed move by move: the fingerprints those games had when the
 * bots played them. Engine fingerprints: they must never change.
 */
const D3B_CASES: Case[] = [
  { name: 'base, 4 players', config: { scenario: 'base', players: 4, seed: 'reg-5' }, mode: 'replay', steps: 4000, recording: 'd3b32c1/base-4p-reg-5', hash: '5a288f01d73b2f23' },
  { name: 'The Pirate Islands, 4 players', config: { scenario: 'seafarers-7-pirate-islands', players: 4, seed: 'reg-9' }, mode: 'replay', steps: 4000, recording: 'd3b32c1/pirate-islands-4p-reg-9', hash: '9a4aa27f29de92d5' },
  { name: 'The Wonders, 3 players', config: { scenario: 'seafarers-8-wonders', players: 3, seed: 'reg-10' }, mode: 'replay', steps: 4000, recording: 'd3b32c1/wonders-3p-reg-10', hash: '085bd456a3663f08' },
  { name: 'C&K, 4 players', config: { scenario: 'base', players: 4, seed: 'reg-ck-3', options: CK }, mode: 'replay', steps: 12000, recording: 'd3b32c1/ck-4p-reg-ck-3', hash: '5d51dea5bf908fc7' },
  { name: 'C&K, 3 players, easy/medium/hard', config: { scenario: 'base', players: 3, seed: 'reg-ck-4', options: { ...CK, layout: 'random' } }, mode: 'replay', steps: 12000, recording: 'd3b32c1/ck-3p-reg-ck-4', hash: '2665b0379ee0e24c' },
];

describe('games recorded with the computer players of d3b32c1 replay unchanged', () => {
  for (const c of D3B_CASES) {
    it(c.name, () => {
      expect(fingerprint(c.config, c.mode, c.steps, c.levels, c.recording)).toBe(c.hash);
    });
  }
});

/**
 * Whole games of today's computer players. These depend on the bots'
 * decisions as well as the engine: re-record them when the bots change on
 * purpose (the engine fingerprints above must not change with them). Last
 * re-recorded for the trading changes (src/bots/trading.ts, tracker.ts):
 * the games of the bots before them replay above with their old hashes.
 */
const BOT_CASES: Case[] = [
  { name: 'base, 4 players, computer players', config: { scenario: 'base', players: 4, seed: 'reg-5' }, mode: 'heuristic', steps: 4000, hash: '0d3f42bc27a15b0a' },
  { name: 'The Pirate Islands, 4 players, computer players', config: { scenario: 'seafarers-7-pirate-islands', players: 4, seed: 'reg-9' }, mode: 'heuristic', steps: 4000, hash: '511a67aaa04fd0a2' },
  { name: 'The Wonders, 3 players, computer players', config: { scenario: 'seafarers-8-wonders', players: 3, seed: 'reg-10' }, mode: 'heuristic', steps: 4000, hash: '7ec283ac3164c725' },
  { name: 'C&K, 4 players, computer players', config: { scenario: 'base', players: 4, seed: 'reg-ck-3', options: CK }, mode: 'heuristic', steps: 12000, hash: '71dc5b7176e8a360' },
  { name: 'C&K, 3 players, easy/medium/hard players', config: { scenario: 'base', players: 3, seed: 'reg-ck-4', options: { ...CK, layout: 'random' } }, mode: 'heuristic', steps: 12000, levels: ['easy', 'medium', 'hard'], hash: '8fcb1fb2c2d43b6e' },
];

describe('computer players play whole games as recorded', () => {
  for (const c of BOT_CASES) {
    it(c.name, () => {
      expect(fingerprint(c.config, c.mode, c.steps, c.levels, c.recording)).toBe(c.hash);
    });
  }
});
