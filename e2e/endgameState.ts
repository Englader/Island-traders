import { applyAction, createGame, heuristicAction, playersToAct, totalVP, type Action, type GameState } from '../src/index.js';

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
      savedAt: Date.now(),
    },
  };
}
