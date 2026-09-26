import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../src/index.js';
import {
  advance,
  averageTurn,
  followPage,
  formatClock,
  formatDuration,
  formatRough,
  freeze,
  isRunning,
  liveSummary,
  newClock,
  observe,
  pause,
  readSummary,
  restoreClock,
  resume,
  settle,
  stop,
  summarize,
  type GameClock,
  type PageEvents,
} from '../web/src/game/clock.js';
import { GameController, clockFor, type GameRecord } from '../web/src/game/controller.js';

const S = 1000;
const now = () => Date.now();
const wait = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the game clock', () => {
  it('adds up the time only while it runs', () => {
    let c = resume(newClock(3, 0, 0), now());
    expect(isRunning(c)).toBe(true);
    wait(5 * S);
    expect(summarize(c, now()).playedMs).toBe(5 * S);
    // settling moves the running stretch into the totals and changes nothing else
    c = settle(c, now());
    expect(c.playedMs).toBe(5 * S);
    expect(settle(c, now())).toBe(c);
    wait(2 * S);
    c = pause(c, now());
    expect(isRunning(c)).toBe(false);
    expect(c.playedMs).toBe(7 * S);
    // paused: the time passing doesn't count
    wait(60 * S);
    expect(summarize(c, now()).playedMs).toBe(7 * S);
    expect(pause(c, now())).toBe(c);
    c = resume(c, now());
    wait(3 * S);
    const sum = summarize(c, now());
    expect(sum.playedMs).toBe(10 * S);
    expect(sum.perPlayerMs).toEqual([10 * S, 0, 0]);
    expect(sum.running).toBe(true);
  });

  it('never goes backwards when the device clock does', () => {
    let c = resume(newClock(2, 0, 0), now());
    wait(4 * S);
    vi.setSystemTime(now() - 60 * S);
    c = settle(c, now());
    expect(c.playedMs).toBe(0);
    wait(2 * S);
    expect(summarize(c, now()).playedMs).toBe(2 * S);
  });

  it('charges each moment to the player whose turn it is, and times every turn', () => {
    // setup: players 1, 0, then turn 1 (player 0), turn 2 (player 1), turn 3 (player 0)
    let c = resume(newClock(2, 1, 0), now());
    wait(20 * S);
    c = observe(c, 0, 0, now());
    wait(30 * S);
    c = observe(c, 0, 1, now());
    wait(10 * S);
    // an out-of-turn move (a discard, an answer to a trade) keeps the turn with its owner
    c = observe(c, 0, 1, now());
    wait(5 * S);
    c = observe(c, 1, 2, now());
    wait(40 * S);
    c = observe(c, 0, 3, now());
    wait(3 * S);
    expect(c.turns.map((t) => [t.player, t.turn, t.ms])).toEqual([
      [1, 0, 20 * S],
      [0, 0, 30 * S],
      [0, 1, 15 * S],
      [1, 2, 40 * S],
      [0, 3, 0],
    ]);
    const sum = summarize(c, now());
    expect(sum.playedMs).toBe(108 * S);
    expect(sum.perPlayerMs).toEqual([48 * S, 60 * S]);
    // the setup placements count for the player, not as turns
    expect(sum.turnCount).toEqual([2, 1]);
    expect(sum.turnMs).toEqual([18 * S, 40 * S]);
    expect(averageTurn(sum, 0)).toBe(9 * S);
    expect(averageTurn(sum, 1)).toBe(40 * S);
    expect(sum.longest).toEqual({ player: 1, turn: 2, ms: 40 * S });
    expect(sum.current).toEqual({ player: 0, turn: 3, ms: 3 * S });
  });

  it('turns that change hands while paused get no time', () => {
    let c = resume(newClock(2, 0, 1), now());
    wait(S);
    c = pause(c, now());
    wait(10 * S);
    c = observe(c, 1, 2, now());
    wait(10 * S);
    expect(c.turns).toEqual([
      { player: 0, turn: 1, ms: S },
      { player: 1, turn: 2, ms: 0 },
    ]);
  });

  it('stops for good at the end of the game', () => {
    let c = resume(newClock(2, 0, 1), now());
    wait(7 * S);
    c = stop(c, now());
    expect(c.stopped).toBe(true);
    expect(isRunning(c)).toBe(false);
    wait(5 * S);
    c = resume(c, now());
    expect(isRunning(c)).toBe(false);
    const sum = summarize(c, now());
    expect(sum.playedMs).toBe(7 * S);
    expect(sum.current).toBeNull();
    expect(sum.longest).toEqual({ player: 0, turn: 1, ms: 7 * S });
  });

  it('is saved and read back paused, so time with the game closed never counts', () => {
    let c = resume(newClock(3, 2, 0), now());
    wait(12 * S);
    c = observe(c, 0, 1, now());
    wait(3 * S);
    // saved as the game saves it: paused, with the time so far
    const json = JSON.stringify(pause(c, now()));
    // closed overnight
    wait(9 * 3600 * S);
    const back = restoreClock(JSON.parse(json), 3)!;
    expect(back).not.toBeNull();
    expect(isRunning(back)).toBe(false);
    expect(back.playedMs).toBe(15 * S);
    expect(back.perPlayerMs).toEqual([3 * S, 0, 12 * S]);
    expect(summarize(back, now()).playedMs).toBe(15 * S);
    // a clock saved while running (an older copy) also comes back paused
    const running = JSON.parse(JSON.stringify(c)) as GameClock;
    expect(running.runningSince).toBeDefined();
    expect(isRunning(restoreClock(running, 3)!)).toBe(false);
    // and resumes from where it was
    let again = resume(back, now());
    wait(5 * S);
    again = settle(again, now());
    expect(again.playedMs).toBe(20 * S);
    expect(again.turns[again.turns.length - 1]).toEqual({ player: 0, turn: 1, ms: 8 * S });
  });

  it('refuses a saved clock it cannot trust', () => {
    const good = pause(resume(newClock(2, 0, 0), now()), now() + S);
    expect(restoreClock(good, 2)).not.toBeNull();
    expect(restoreClock(undefined, 2)).toBeNull();
    expect(restoreClock(good, 3)).toBeNull();
    expect(restoreClock({ ...good, v: 2 }, 2)).toBeNull();
    expect(restoreClock({ ...good, playedMs: -1 }, 2)).toBeNull();
    expect(restoreClock({ ...good, perPlayerMs: [0, 'x'] }, 2)).toBeNull();
    expect(restoreClock({ ...good, turns: [{ player: 5, turn: 0, ms: 0 }] }, 2)).toBeNull();
    expect(restoreClock({ ...good, stopped: true }, 2)?.stopped).toBe(true);
  });
});

describe('a guest following the host clock', () => {
  it('adds the time since the host sent it, whatever the two devices think the time is', () => {
    let host = resume(newClock(3, 0, 1), now());
    wait(30 * S);
    host = observe(host, 1, 2, now());
    wait(4 * S);
    // sent to a guest whose clock is 17 minutes off; it only uses its own clock
    const wire = JSON.parse(JSON.stringify(summarize(host, now())));
    const sum = readSummary(wire, 3)!;
    const guestNow = () => now() - 17 * 60 * S;
    const feed = { sum, at: guestNow() };
    wait(6 * S);
    const guest = liveSummary(feed, guestNow());
    const truth = summarize(host, now());
    expect(guest).toEqual(truth);
    expect(guest.playedMs).toBe(40 * S);
    expect(guest.current).toEqual({ player: 1, turn: 2, ms: 10 * S });
  });

  it('the turn in play takes over as the longest one', () => {
    let host = resume(newClock(2, 0, 1), now());
    wait(20 * S);
    host = observe(host, 1, 2, now());
    wait(5 * S);
    const sum = summarize(host, now());
    expect(sum.longest).toEqual({ player: 0, turn: 1, ms: 20 * S });
    expect(advance(sum, 10 * S).longest).toEqual({ player: 0, turn: 1, ms: 20 * S });
    expect(advance(sum, 16 * S).longest).toEqual({ player: 1, turn: 2, ms: 21 * S });
    expect(advance(sum, 16 * S).turnMs).toEqual([20 * S, 21 * S]);
    // the setup is never the longest turn
    const setup = summarize(resume(newClock(2, 0, 0), now() - 50 * S), now());
    expect(advance(setup, 10 * S).longest).toBeNull();
  });

  it('stands still when the host clock is paused or the host is gone', () => {
    const paused = summarize(pause(resume(newClock(2, 0, 1), now() - 8 * S), now()), now());
    expect(paused.running).toBe(false);
    expect(advance(paused, 60 * S)).toEqual(paused);
    expect(advance(summarize(resume(newClock(2, 0, 1), now()), now()), -5 * S).playedMs).toBe(0);
    const running = summarize(resume(newClock(2, 0, 1), now()), now());
    // cut off after 3 s: the reading stays there
    const frozen = freeze(running, 3 * S);
    expect(frozen.running).toBe(false);
    expect(frozen.playedMs).toBe(3 * S);
    expect(advance(frozen, 60 * S).playedMs).toBe(3 * S);
  });

  it('ignores a clock it cannot read', () => {
    const sum = summarize(newClock(2, 0, 1), now());
    expect(readSummary(sum, 2)).toEqual(sum);
    expect(readSummary(undefined, 2)).toBeNull();
    expect(readSummary({ ...sum, perPlayerMs: [1] }, 2)).toBeNull();
    expect(readSummary({ ...sum, playedMs: Number.NaN }, 2)).toBeNull();
    expect(readSummary({ ...sum, current: { player: 9, turn: 1, ms: 0 } }, 2)?.current).toBeNull();
    expect(readSummary({ ...sum, running: 'yes' }, 2)?.running).toBe(false);
  });
});

describe('when the clock runs', () => {
  function fakePage(): PageEvents & { hide(): void; show(): void; close(): void } {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const win = new EventTarget();
    const set = (v: DocumentVisibilityState) => {
      doc.visibilityState = v;
      doc.dispatchEvent(new Event('visibilitychange'));
    };
    return { doc, win, hide: () => set('hidden'), show: () => set('visible'), close: () => win.dispatchEvent(new Event('pagehide')) };
  }
  function runner() {
    const r = { on: false, saves: 0, setClockRunning: (on: boolean) => void (r.on = on), save: () => void r.saves++ };
    return r;
  }

  it('a game on this device: while it is on screen', () => {
    const page = fakePage();
    const r = runner();
    const stopFollowing = followPage(r, true, false, page);
    expect(r.on).toBe(true);
    page.hide();
    expect(r.on).toBe(false);
    expect(r.saves).toBe(1);
    page.show();
    expect(r.on).toBe(true);
    page.close();
    expect(r.on).toBe(false);
    stopFollowing();
    page.show();
    expect(r.on).toBe(false);
  });

  it('an online host: also while hidden (the friends play on), saving the time so far', () => {
    const page = fakePage();
    const r = runner();
    followPage(r, true, true, page);
    page.hide();
    expect(r.on).toBe(true);
    expect(r.saves).toBe(1);
    page.close();
    expect(r.on).toBe(false);
  });

  it('not while the game is not open', () => {
    const r = runner();
    followPage(r, false, false, fakePage());
    expect(r.on).toBe(false);
  });
});

describe('the game controller keeps the clock', () => {
  function record(players = 3): GameRecord {
    const state = createGame({ scenario: 'base', players, seed: 'clock-test' });
    return {
      v: 1,
      id: 'clock',
      mode: 'local',
      seats: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, kind: 'human', color: i })),
      state,
      botSpeed: 'fast',
      clock: clockFor(state),
      savedAt: now(),
    };
  }
  const first = (s: GameState, type: Action['type']) => legalActions(s, s.turn.actor).find((a) => a.type === type)!;

  it('times the setup placements for the player placing, pauses on request, and saves paused', () => {
    const ctrl = new GameController(record());
    const p0 = ctrl.state.turn.actor;
    ctrl.setClockRunning(true);
    wait(4 * S);
    expect(ctrl.act(first(ctrl.state, 'placeSettlement'))).toBeNull();
    wait(2 * S);
    expect(ctrl.act(first(ctrl.state, 'placeRoad'))).toBeNull();
    const p1 = ctrl.state.turn.actor;
    expect(p1).not.toBe(p0);
    wait(5 * S);
    let sum = ctrl.clockFeed()!.sum;
    expect(sum.perPlayerMs[p0]).toBe(6 * S);
    expect(sum.perPlayerMs[p1]).toBe(5 * S);
    expect(sum.current).toEqual({ player: p1, turn: 0, ms: 5 * S });
    ctrl.setClockRunning(false);
    wait(30 * S);
    sum = ctrl.clockFeed()!.sum;
    expect(sum.playedMs).toBe(11 * S);
    expect(sum.running).toBe(false);
    ctrl.destroy();
  });

  it('comes back from a save paused, with the time so far', () => {
    const ctrl = new GameController(record());
    ctrl.setClockRunning(true);
    wait(9 * S);
    const saved = JSON.parse(JSON.stringify({ ...ctrl.record, clock: pause(ctrl.record.clock!, now()) })) as GameRecord;
    ctrl.destroy();
    wait(3600 * S);
    const again = new GameController(saved);
    expect(again.clockFeed()!.sum).toMatchObject({ playedMs: 9 * S, running: false });
    again.setClockRunning(true);
    wait(S);
    expect(again.clockFeed()!.sum.playedMs).toBe(10 * S);
    again.destroy();
  });

  it('a game saved before the timer has none', () => {
    const { clock: _, ...old } = record();
    const ctrl = new GameController(old);
    ctrl.setClockRunning(true);
    expect(ctrl.clockFeed()).toBeNull();
    ctrl.destroy();
  });
});

describe('clock words', () => {
  it('reads like a stopwatch', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(42_900)).toBe('0:42');
    expect(formatClock((23 * 60 + 41) * S)).toBe('23:41');
    expect(formatClock((3600 + 2 * 60 + 33) * S)).toBe('1:02:33');
  });
  it('says durations in words', () => {
    expect(formatDuration(45 * S)).toBe('45 s');
    expect(formatDuration(192 * S)).toBe('3 min 12 s');
    expect(formatDuration(120 * S)).toBe('2 min');
    expect(formatDuration((3600 + 2 * 60 + 5) * S)).toBe('1 h 02 min');
    expect(formatRough(45 * S)).toBe('45 s');
    expect(formatRough((41 * 60 + 40) * S)).toBe('42 min');
    expect(formatRough((72 * 60 + 10) * S)).toBe('1 h 12 min');
    expect(formatRough(120 * 60 * S)).toBe('2 h');
  });
});
