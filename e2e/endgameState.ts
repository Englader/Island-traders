import { applyAction, createGame, heuristicAction, playersToAct, totalVP, type Action, type GameState } from '../src/index.js';

/**
 * A game clock (web/src/game/clock.ts) for a saved game at the start of a
 * turn: the setup placements and every turn so far, the human taking longer
 * than the computer players. Saved paused, like the game saves it.
 */
export function clockFor(state: GameState, human: number) {
  const n = state.players.length;
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const turns: Array<{ player: number; turn: number; ms: number }> = [];
  const add = (player: number, turn: number, ms: number) => {
    const last = turns[turns.length - 1];
    if (last && last.player === player && last.turn === turn) last.ms += ms;
    else turns.push({ player, turn, ms });
  };
  const order = Array.from({ length: n }, (_, i) => (state.firstPlayer + i) % n);
  // the setup: twice round the table, the second time backwards
  for (const p of [...order, ...[...order].reverse()]) add(p, 0, Math.round((p === human ? 25_000 : 5_000) + rand() * 8_000));
  for (let t = 1; t < state.turn.number; t++) {
    const p = (state.firstPlayer + t - 1) % n;
    add(p, t, Math.round(p === human ? 20_000 + rand() * 50_000 : 6_000 + rand() * 9_000));
  }
  // the turn about to be played
  add(state.turn.actor, state.turn.number, 0);
  const perPlayerMs = Array<number>(n).fill(0);
  for (const t of turns) perPlayerMs[t.player] += t.ms;
  return { v: 1, playedMs: perPlayerMs.reduce((a, b) => a + b, 0), perPlayerMs, turns };
}

/**
 * A real game between computer players, stopped at the start of the winner's
 * last turn and saved with the winner as the human seat. A VP card makes up
 * any points still missing, so rolling the dice wins the game. The statistics
 * (VP race, production, trades) come from the whole game. Opened with
 * Continue on the home screen (see trade.spec.ts).
 */
export function nearlyWonGame(scenario = 'base', names = ['Ada', 'Björn', 'Chen', 'Dara'], seed = 'endgame-e2e') {
  let s: GameState = createGame({ scenario, players: names, seed });
  const turnStarts: GameState[] = [];
  let part = -1;
  let partSteps = 0;
  for (let steps = 0; s.phase.kind !== 'gameOver'; steps++) {
    if (steps > 8000) throw new Error('the bot game did not finish');
    if (s.phase.kind === 'preRoll') turnStarts.push(s);
    if (s.turn.part !== part) {
      part = s.turn.part;
      partSteps = 0;
    }
    let a: Action | null = null;
    for (const p of playersToAct(s)) if ((a = heuristicAction(s, p, 'medium'))) break;
    if (!a) throw new Error(`deadlock in phase ${s.phase.kind}`);
    if (++partSteps > 60 && s.phase.kind === 'main' && s.turn.actor === a.player) a = { type: 'endTurn', player: a.player };
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`bot move rejected: ${r.error}`);
    s = r.state;
  }
  const winner = s.phase.winner!;
  const start = structuredClone([...turnStarts].reverse().find((x) => x.turn.actor === winner)!);
  for (let missing = start.victoryTarget - totalVP(start, winner); missing > 0; missing--) {
    start.players[winner].devCards.push({ type: 'victoryPoint', boughtPart: 0 });
  }
  return {
    winner,
    name: names[winner],
    record: {
      v: 1,
      id: 'endgame',
      mode: 'local',
      seats: names.map((name, i) => ({ name, kind: i === winner ? 'human' : 'bot', color: i })),
      state: start,
      botSpeed: 'fast',
      botLevel: 'medium',
      clock: clockFor(start, winner) as ReturnType<typeof clockFor> | undefined,
      savedAt: Date.now(),
    },
  };
}
