// Plays games between computer players given as one move function per seat,
// and keeps statistics on how each seat played (scripts/bot-match.ts and
// scripts/bot-tune-ck.ts use it). Only for measuring: no game logic here.
import { applyAction, citiesOf, handSize, isCommodity, playersToAct, publicVP, TRACKS, type Action, type GameState, type PlayerId } from '../src/index.js';

export type SeatBot = (s: GameState, p: PlayerId) => Action | null;

/** What a seat did over a game (summed over seats and games by the callers). */
export interface SeatStats {
  games: number;
  wins: number;
  vp: number;
  settlementsVP: number;
  citiesVP: number;
  metropolisVP: number;
  routeVP: number;
  defenderVP: number;
  cardVP: number;
  merchantVP: number;
  /** Seafarers: island chits and a scenario's own points. */
  scenarioVP: number;
  /** The Wonders: levels built. */
  wonderLevels: number;
  pillaged: number;
  metropolisesWon: number;
  metropolisesLost: number;
  improvements: number;
  progressDrawn: number;
  progressPlayed: number;
  progressDiscarded: number;
  knightsHired: number;
  activations: number;
  promotions: number;
  walls: number;
  bankTrades: number;
  commoditiesToBank: number;
  discarded: number;
  handAtEnd: number;
  turnsEnded: number;
  cardsPlayed: Record<string, number>;
}

export function emptyStats(): SeatStats {
  return {
    games: 0,
    wins: 0,
    vp: 0,
    settlementsVP: 0,
    citiesVP: 0,
    metropolisVP: 0,
    routeVP: 0,
    defenderVP: 0,
    cardVP: 0,
    merchantVP: 0,
    scenarioVP: 0,
    wonderLevels: 0,
    pillaged: 0,
    metropolisesWon: 0,
    metropolisesLost: 0,
    improvements: 0,
    progressDrawn: 0,
    progressPlayed: 0,
    progressDiscarded: 0,
    knightsHired: 0,
    activations: 0,
    promotions: 0,
    walls: 0,
    bankTrades: 0,
    commoditiesToBank: 0,
    discarded: 0,
    handAtEnd: 0,
    turnsEnded: 0,
    cardsPlayed: {},
  };
}

export function addStats(a: SeatStats, b: SeatStats): SeatStats {
  const out = emptyStats();
  for (const k of Object.keys(out) as Array<keyof SeatStats>) {
    if (k === 'cardsPlayed') continue;
    (out[k] as number) = (a[k] as number) + (b[k] as number);
  }
  for (const src of [a.cardsPlayed, b.cardsPlayed]) for (const [c, n] of Object.entries(src)) out.cardsPlayed[c] = (out.cardsPlayed[c] ?? 0) + n;
  return out;
}

function progressHeld(s: GameState, p: PlayerId): number {
  const pl = s.ck?.players[p];
  return pl ? pl.progress.length + pl.vpCards.length : 0;
}

export interface GameResult {
  state: GameState;
  steps: number;
  finished: boolean;
  winner: PlayerId | null;
  stats: SeatStats[];
  /** Milliseconds of each decision (the bot's choice only). */
  times: number[];
}

/** Plays a whole game; `bots[p]` moves for seat p. The 60-move valve of simulateHeuristic applies. */
export function playGame(start: GameState, bots: SeatBot[], maxSteps = 12000, timing = false): GameResult {
  let s = start;
  let steps = 0;
  let partSteps = 0;
  let part = s.turn.part;
  const stats = start.players.map(() => emptyStats());
  const times: number[] = [];
  while (s.phase.kind !== 'gameOver' && steps < maxSteps) {
    let acted = false;
    for (const p of playersToAct(s)) {
      const t0 = timing ? performance.now() : 0;
      let a = bots[p](s, p);
      if (timing) times.push(performance.now() - t0);
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
      const prev = s;
      s = r.state;
      note(prev, s, a, stats);
      acted = true;
      break;
    }
    if (!acted) throw new Error(`deadlock in phase ${s.phase.kind}`);
    steps++;
  }
  const finished = s.phase.kind === 'gameOver';
  const winner = s.phase.kind === 'gameOver' ? s.phase.winner : null;
  s.players.forEach((_, p) => {
    const st = stats[p];
    st.games = 1;
    st.wins = winner === p ? 1 : 0;
    st.vp = publicVP(s, p);
    const cities = citiesOf(s, p).length;
    const settlements = Object.values(s.board.buildings).filter((b) => b.owner === p && b.type === 'settlement').length;
    st.settlementsVP = settlements;
    st.citiesVP = cities * 2;
    if (s.ck) {
      st.metropolisVP = 2 * TRACKS.filter((t) => s.ck!.metropolises[t]?.owner === p).length;
      st.defenderVP = s.ck.players[p].defenders;
      st.cardVP = s.ck.players[p].vpCards.length;
      st.merchantVP = s.ck.merchant?.owner === p ? 1 : 0;
      st.improvements = TRACKS.reduce((n, t) => n + s.ck!.players[p].improvements[t], 0);
      st.walls = s.ck.players[p].walls.length;
    }
    st.routeVP = s.longestRoute.holder === p ? 2 : 0;
    st.scenarioVP = st.vp - st.settlementsVP - st.citiesVP - st.metropolisVP - st.defenderVP - st.cardVP - st.merchantVP - st.routeVP;
    st.wonderLevels = (s.ext.wonders as { levels: number[] } | undefined)?.levels[p] ?? 0;
  });
  return { state: s, steps, finished, winner, stats, times };
}

function note(prev: GameState, s: GameState, a: Action, stats: SeatStats[]): void {
  const p = a.player;
  const st = stats[p];
  switch (a.type) {
    case 'buildKnight':
      st.knightsHired++;
      break;
    case 'activateKnight':
      st.activations++;
      break;
    case 'promoteKnight':
      st.promotions++;
      break;
    case 'bankTrade':
      st.bankTrades++;
      for (const [k, n] of Object.entries(a.give)) if (isCommodity(k as never)) st.commoditiesToBank += n ?? 0;
      break;
    case 'discard':
      st.discarded += Object.values(a.cards).reduce((x: number, y) => x + (y ?? 0), 0);
      break;
    case 'playProgress':
      st.progressPlayed++;
      st.cardsPlayed[a.card] = (st.cardsPlayed[a.card] ?? 0) + 1;
      break;
    case 'discardProgress':
      st.progressDiscarded++;
      break;
    case 'endTurn':
      if (prev.phase.kind === 'main') {
        st.handAtEnd += handSize(prev, p);
        st.turnsEnded++;
      }
      break;
    default:
      break;
  }
  if (!s.ck || !prev.ck) return;
  for (const pl of s.players) {
    const q = pl.id;
    const before = citiesOf(prev, q).length;
    const after = citiesOf(s, q).length;
    // cities only go down when the barbarians pillage one
    if (after < before) stats[q].pillaged += before - after;
    const drawn = progressHeld(s, q) - progressHeld(prev, q);
    // (a card played or discarded leaves the hand; a draw adds one)
    const played = a.type === 'playProgress' && a.player === q ? 1 : 0;
    const dropped = a.type === 'discardProgress' && a.player === q ? 1 : 0;
    if (drawn + played + dropped > 0) stats[q].progressDrawn += drawn + played + dropped;
  }
  for (const t of TRACKS) {
    const was = prev.ck.metropolises[t]?.owner ?? null;
    const now = s.ck.metropolises[t]?.owner ?? null;
    if (was !== now) {
      if (now !== null) stats[now].metropolisesWon++;
      if (was !== null) stats[was].metropolisesLost++;
    }
  }
}
