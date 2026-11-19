import { describe, expect, it } from 'vitest';
import { applyAction, heuristicAction, legalActions, playersToAct, viewFor, type Action, type GameState } from '../src/index.js';
import { handSplit, newestSwap, swapOf } from '../web/src/game/ck.js';
import { playedFx, trackStatus } from '../web/src/game/progress.js';
import { cuesFor } from '../web/src/game/soundCues.js';
import { ckAfterSetup, ckMain, cityOf, giveCards, giveProgress, setLevels } from '../e2e/ckState.js';

/*
 * Cities & Knights, what everyone can see at any time: the Inventor's swap
 * (its log line carries the two hexes, for every viewer, whoever played it),
 * the improvement levels and what the next level costs you, and every hand
 * as two public counts, resources and commodities.
 */

function act(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

const inventorPlays = (s: GameState, p: number) => legalActions(s, p).filter((a): a is Extract<Action, { type: 'playProgress' }> => a.type === 'playProgress' && a.card === 'inventor');

describe('the Inventor: which numbers were swapped, for everyone', () => {
  it('the log line names both numbers and their tiles and carries the hexes; every seat and a spectator see it', () => {
    const s = ckMain(ckAfterSetup('ck-swap'));
    giveProgress(s, 0, ['inventor']);
    const play = inventorPlays(s, 0)[0];
    const [a, b] = play.args!.hexes as [string, string];
    const ta = s.board.hexes[a].token;
    const tb = s.board.hexes[b].token;
    const after = act(s, play);
    for (const viewer of [0, 1, 2, null]) {
      const v = viewFor(after, viewer);
      const e = v.log.at(-1)!;
      expect(e.msg).toMatch(new RegExp(`^Sam swaps the ${ta} (on|in) the [a-z ]+ ↔ the ${tb} (on|in) the [a-z ]+$`));
      expect(swapOf(e)).toEqual([a, b]);
      expect(newestSwap(v, s.log.length)).toEqual({ at: v.log.length - 1, hexes: [a, b], by: 0 });
    }
    // the card shown in the middle says the same
    expect(playedFx(play, viewFor(s, 1), 1).detail).toMatch(new RegExp(`^Swaps the [a-z ]+ ${ta} ↔ the [a-z ]+ ${tb}$`));
    // older lines (and saves from before) have no hexes: nothing to show
    expect(swapOf({ turn: 1, msg: 'Sam swaps the 3 and the 10' })).toBeNull();
    expect(newestSwap(viewFor(s, 0), 0)).toBeNull();
  });

  it('a computer player playing it leaves the same line and hexes', () => {
    let s = ckMain(ckAfterSetup('ck-swap-bot'));
    s.turn.actor = 1;
    giveProgress(s, 1, ['inventor']);
    for (let i = 0; i < 200 && !s.log.some((e) => e.hexes); i++) {
      const p = playersToAct(s)[0];
      if (p === undefined || s.turn.actor !== 1) break;
      s = act(s, heuristicAction(s, p, 'hard') ?? legalActions(s, p)[0]);
    }
    const e = s.log.find((x) => x.hexes)!;
    expect(e).toBeDefined();
    expect(e.msg).toMatch(/^Ada swaps the \d+ (on|in) the [a-z ]+ ↔ the \d+ (on|in) the [a-z ]+$/);
    expect(newestSwap(viewFor(s, 0), 0)?.by).toBe(1);
  });

  it('a soft swap sound once the card has been shown, for everyone', () => {
    const s = ckMain(ckAfterSetup('ck-swap'));
    giveProgress(s, 0, ['inventor']);
    const play = inventorPlays(s, 0)[0];
    const after = act(s, play);
    for (const seat of [0, 1, null]) {
      const cues = cuesFor(play, viewFor(s, seat), viewFor(after, seat), seat);
      expect(cues).toContainEqual({ cue: 'swap', at: 'fx', beat: 1, ...(seat === 0 ? {} : { quiet: true }) });
    }
  });
});

describe('city improvements and hands, any time', () => {
  it("your levels, the abilities you have and what the next level costs you; others' levels only", () => {
    const s = ckMain(ckAfterSetup('ck-levels'), { cloth: 2, coin: 1 });
    setLevels(s, 0, { trade: 2, science: 3 });
    setLevels(s, 1, { politics: 4 });
    s.ck!.metropolises.politics = { owner: 1, vertex: cityOf(s, 1) };
    giveCards(s, 1, { paper: 2 });
    s.turn.actor = 1; // not Sam's turn
    const v = viewFor(s, 0);
    expect(trackStatus(v, 0, 'trade')).toEqual({ track: 'trade', level: 2, ability: false, metropolis: false, next: { level: 3, name: 'Merchant Guild', cost: 3, have: 2, short: 1 } });
    expect(trackStatus(v, 0, 'politics').next).toEqual({ level: 1, name: 'Town Hall', cost: 1, have: 1, short: 0 });
    expect(trackStatus(v, 0, 'science')).toMatchObject({ level: 3, ability: true, next: { name: 'Theater', cost: 4, have: 0, short: 4 } });
    // Ada's levels and metropolis are public; her paper is not
    expect(trackStatus(v, 1, 'politics')).toMatchObject({ level: 4, ability: true, metropolis: true, next: { cost: 5, have: null, short: null } });
    expect(trackStatus(viewFor(s, null), 0, 'trade').next?.have).toBeNull();
  });

  it('every hand in two public counts: resource cards and commodity cards', () => {
    const s = ckMain(ckAfterSetup('ck-levels'), { cloth: 2, coin: 1 });
    giveCards(s, 1, { paper: 2, ore: 1 });
    for (const viewer of [0, 1, 2, null]) {
      const v = viewFor(s, viewer);
      for (const p of s.players) {
        const res = Object.values(p.resources).reduce((x, y) => x + y, 0);
        const com = Object.values(s.ck!.players[p.id].commodities).reduce((x, y) => x + y, 0);
        expect(handSplit(v, p.id)).toEqual({ resources: res, commodities: com });
      }
    }
    // outside Cities & Knights, one count as before
    const base = viewFor(ckMain(ckAfterSetup('ck-levels')), 0);
    expect(handSplit({ ...base, ck: undefined }, 0)).toBeNull();
  });
});
