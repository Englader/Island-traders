import {
  applyAction,
  createGame,
  heuristicAction,
  legalActions,
  playersToAct,
  topo,
  totalVP,
  type Card,
  type CardCounts,
  type GameState,
  type ImprovementTrack,
  type KnightLevel,
  type PlayerId,
  type ProgressCardName,
  type VertexId,
} from '../src/index.js';

/** Where a saved local game lives in the browser (web/src/game/storage.ts, controller.ts). */
export const SAVE_KEY = 'island-traders:v1:save:local';
export const HOST_SAVE_KEY = 'island-traders:v1:save:host';

const NAMES = ['Sam', 'Ada', 'Björn'];

/** Plays the computer's moves for everyone (Sam included) until `done` says stop. */
function playUntil(s: GameState, done: (s: GameState) => boolean, limit = 4000): GameState {
  let state = s;
  for (let i = 0; i < limit && !done(state); i++) {
    const p = playersToAct(state)[0];
    if (p === undefined) break;
    const a = heuristicAction(state, p, 'medium') ?? legalActions(state, p)[0];
    if (!a) break;
    const r = applyAction(state, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
    state = r.state;
  }
  return state;
}

/** A Cities & Knights game on the beginners' map, after the set-up: Sam (seat 0) is about to roll. */
export function ckAfterSetup(seed = 'ck-ui'): GameState {
  const s = createGame({ scenario: 'base', players: NAMES, seed, options: { firstPlayer: 0, citiesAndKnights: true } });
  return playUntil(s, (x) => x.phase.kind === 'preRoll' && x.turn.actor === 0);
}

/** Moves cards from the bank into a hand (resources and commodities). */
export function giveCards(s: GameState, p: PlayerId, c: CardCounts): void {
  for (const [k, n] of Object.entries(c) as Array<[Card, number]>) {
    if (!n) continue;
    if (k === 'paper' || k === 'cloth' || k === 'coin') {
      s.ck!.bank[k] -= n;
      s.ck!.players[p].commodities[k] += n;
    } else {
      s.bank[k] -= n;
      s.players[p].resources[k] += n;
    }
  }
}

/** An empty intersection on `p`'s road (where a knight could be hired). */
export function knightSpots(s: GameState, p: PlayerId): VertexId[] {
  const t = topo(s);
  const out: VertexId[] = [];
  for (const v of t.vertexIds) {
    if (s.board.buildings[v] || s.ck!.knights[v]) continue;
    if ((t.vertexEdges[v] ?? []).some((e) => s.board.pieces[e]?.owner === p)) out.push(v);
  }
  return out.sort();
}

export function cityOf(s: GameState, p: PlayerId): VertexId {
  return Object.entries(s.board.buildings).find(([, b]) => b.owner === p && b.type === 'city')![0];
}

export function placeKnight(s: GameState, p: PlayerId, v: VertexId, level: KnightLevel, active: boolean): void {
  s.ck!.knights[v] = { owner: p, level, active, activatedPart: -1, promotedPart: -1 };
}

/** The game record the browser saves, for Continue on the home screen. */
export function ckRecord(state: GameState, opts: { id?: string; mode?: 'local' | 'host'; room?: string; seats?: Array<{ name: string; kind: string; color: number }> } = {}) {
  return {
    v: 1,
    id: opts.id ?? 'ck-ui',
    mode: opts.mode ?? 'local',
    seats: opts.seats ?? state.players.map((p, i) => ({ name: p.name, kind: i === 0 ? 'human' : 'bot', color: i })),
    state,
    botSpeed: 'fast',
    botLevel: 'medium',
    ...(opts.room ? { room: opts.room } : {}),
    savedAt: Date.now(),
  };
}

/** Sam's turn after the roll (main phase), with `hand` added. */
export function ckMain(s: GameState, hand: CardCounts = {}): GameState {
  s.phase = { kind: 'main' };
  s.turn.dice = [3, 5];
  s.ck!.event = 'ship';
  giveCards(s, 0, hand);
  return s;
}

/**
 * Loads the dice: tries rng seeds until rolling gives `want` (a sum, an
 * event face or both), and leaves the state about to roll with that seed.
 */
export function loadDice(s: GameState, want: { sum?: number; event?: string; red?: number }): GameState {
  for (let i = 0; i < 5000; i++, s.rng.s++) {
    const r = applyAction(s, { type: 'rollDice', player: s.turn.actor });
    if (!r.ok) continue;
    const d = r.state.turn.dice!;
    if (want.sum !== undefined && d[0] + d[1] !== want.sum) continue;
    if (want.red !== undefined && d[1] !== want.red) continue;
    if (want.event !== undefined && r.state.ck?.event !== want.event) continue;
    return s;
  }
  throw new Error('no such roll');
}

export function setLevels(s: GameState, p: PlayerId, levels: Partial<Record<ImprovementTrack, number>>): void {
  Object.assign(s.ck!.players[p].improvements, levels);
}

/** A whole Cities & Knights game between computer players, over: for the end-of-game screens (Sam is seat 0). */
export function ckFinished(seed = 'ck-end'): GameState {
  const s = createGame({ scenario: 'base', players: NAMES, seed, options: { firstPlayer: 0, citiesAndKnights: true } });
  return playUntil(s, (x) => x.phase.kind === 'gameOver', 40000);
}

/**
 * A whole Cities & Knights game between computer players, stopped at the
 * start of the winner's last turn, with Defender of Catan cards making up any
 * points still missing: rolling the dice wins. Saved with the winner as the
 * human seat. The statistics come from the whole game.
 */
export function ckNearlyWon(seed = 'ck-end') {
  let s = createGame({ scenario: 'base', players: NAMES, seed, options: { firstPlayer: 0, citiesAndKnights: true } });
  const turnStarts: GameState[] = [];
  for (let i = 0; i < 40000 && s.phase.kind !== 'gameOver'; i++) {
    if (s.phase.kind === 'preRoll') turnStarts.push(s);
    const p = playersToAct(s)[0];
    const a = heuristicAction(s, p, 'medium') ?? legalActions(s, p)[0];
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
    s = r.state;
  }
  if (s.phase.kind !== 'gameOver') throw new Error('the bot game did not finish');
  const winner = s.phase.winner!;
  const start = structuredClone([...turnStarts].reverse().find((x) => x.turn.actor === winner)!);
  const missing = start.victoryTarget - totalVP(start, winner);
  if (missing > 0) start.ck!.players[winner].defenders += missing;
  return {
    winner,
    record: { ...ckRecord(start), seats: NAMES.map((name, i) => ({ name, kind: i === winner ? 'human' : 'bot', color: i })) },
  };
}

/** Upgrades one of `p`'s settlements to a city (for crafted saves). */
export function makeCity(s: GameState, p: PlayerId): VertexId {
  const v = Object.entries(s.board.buildings).find(([, b]) => b.owner === p && b.type === 'settlement')![0];
  s.board.buildings[v].type = 'city';
  s.players[p].supply.cities--;
  s.players[p].supply.settlements++;
  return v;
}

export function giveProgress(s: GameState, p: PlayerId, cards: ProgressCardName[]): void {
  for (const c of cards) {
    for (const t of ['trade', 'politics', 'science'] as const) {
      const i = s.ck!.decks[t].indexOf(c);
      if (i >= 0) {
        s.ck!.decks[t].splice(i, 1);
        break;
      }
    }
    s.ck!.players[p].progress.push(c);
  }
}
