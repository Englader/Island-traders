/**
 * The game clock: how long a game has been played, and by whom. It lives in
 * the web layer (the engine stays free of wall-clock time) and is saved with
 * the game record.
 *
 * Only active play counts. The page decides when the clock runs (see
 * useGameClock in app.tsx): a game on this device while it is on screen, an
 * online game while the host's page is open. It stops for good at the end.
 *
 * Every moment is charged to the player whose turn it is (the engine's
 * `turn.actor`), setup placements included. Moments when others act out of
 * turn (discarding on a 7, answering a trade offer) count for the turn's owner.
 *
 * Functions here are pure: they take the time (`now`, Date.now() style) and
 * return a new clock, so they are easy to test and to save.
 */

/** One stretch of a single player's turn. */
export interface TurnTime {
  /** The seat whose turn it was. */
  player: number;
  /** The engine's turn number (0: the setup placements before turn 1). */
  turn: number;
  ms: number;
}

export interface GameClock {
  v: 1;
  /** Active play so far, in ms, up to `runningSince` while running. */
  playedMs: number;
  /** The same, per seat. */
  perPlayerMs: number[];
  /** Every turn timed so far, oldest first; the last one is the turn in play. */
  turns: TurnTime[];
  /** While running: the local time the running stretch started. Never kept across a reload. */
  runningSince?: number;
  /** The game is over and the clock has stopped for good. */
  stopped?: boolean;
}

/** A new clock, paused, with the first turn (usually a setup placement) about to be timed. */
export function newClock(players: number, owner: number, turn: number): GameClock {
  return { v: 1, playedMs: 0, perPlayerMs: Array<number>(players).fill(0), turns: [{ player: owner, turn, ms: 0 }] };
}

export function isRunning(c: GameClock): boolean {
  return c.runningSince !== undefined;
}

/** Charges the time since `runningSince` to the turn in play; the stretch then starts again at `now`. */
export function settle(c: GameClock, now: number): GameClock {
  if (c.runningSince === undefined) return c;
  // a clock that went backwards (the device's time was changed) adds nothing
  const d = Math.max(0, now - c.runningSince);
  if (d === 0) return c.runningSince === now ? c : { ...c, runningSince: now };
  const turns = c.turns.slice();
  const cur = turns[turns.length - 1];
  const perPlayerMs = c.perPlayerMs.slice();
  if (cur) {
    turns[turns.length - 1] = { ...cur, ms: cur.ms + d };
    if (cur.player >= 0 && cur.player < perPlayerMs.length) perPlayerMs[cur.player] += d;
  }
  return { ...c, playedMs: c.playedMs + d, perPlayerMs, turns, runningSince: now };
}

/** Starts the clock (unless it is running or the game is over). */
export function resume(c: GameClock, now: number): GameClock {
  if (c.stopped || c.runningSince !== undefined) return c;
  return { ...c, runningSince: now };
}

/** Pauses the clock, keeping the time so far. */
export function pause(c: GameClock, now: number): GameClock {
  if (c.runningSince === undefined) return c;
  const { runningSince: _, ...rest } = settle(c, now);
  return rest;
}

/** The game is over: the time so far is final. */
export function stop(c: GameClock, now: number): GameClock {
  return { ...pause(c, now), stopped: true };
}

/**
 * The game moved on: the time until now goes to the player who had the turn,
 * and a new turn starts being timed when the turn changed hands.
 */
export function observe(c: GameClock, owner: number, turn: number, now: number): GameClock {
  const s = settle(c, now);
  const cur = s.turns[s.turns.length - 1];
  if (cur && cur.player === owner && cur.turn === turn) return s;
  return { ...s, turns: [...s.turns, { player: owner, turn, ms: 0 }] };
}

const isMs = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const isSeat = (n: unknown, players: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < players;

/**
 * A clock read back from storage, checked. It always comes back paused: the
 * time the game spent closed (overnight, say) never counts. Null when the
 * data is unusable (or was never recorded).
 */
export function restoreClock(raw: unknown, players: number): GameClock | null {
  const c = raw as Partial<GameClock> | null;
  if (!c || typeof c !== 'object' || c.v !== 1) return null;
  if (!isMs(c.playedMs) || !Array.isArray(c.perPlayerMs) || c.perPlayerMs.length !== players || !c.perPlayerMs.every(isMs)) return null;
  if (!Array.isArray(c.turns) || !c.turns.every((t) => t && isSeat(t.player, players) && Number.isInteger(t.turn) && t.turn >= 0 && isMs(t.ms))) return null;
  const out: GameClock = {
    v: 1,
    playedMs: c.playedMs,
    perPlayerMs: c.perPlayerMs.slice(),
    turns: c.turns.map((t) => ({ player: t.player, turn: t.turn, ms: t.ms })),
  };
  if (c.stopped === true) out.stopped = true;
  return out;
}

// --- following the page: when the clock runs ----------------------------------------------

/** What followPage drives: the game controller. */
export interface ClockRunner {
  setClockRunning(on: boolean): void;
  save(): void;
}

/** The page events the clock follows: the real document and window in the browser, stand-ins in tests. */
export interface PageEvents {
  doc: { readonly visibilityState: DocumentVisibilityState } & Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  win: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/**
 * Runs the clock while `active` (the game is open) and, unless `whileHidden`
 * (an online host: the friends go on playing), only while the page is
 * visible. Closing the page pauses it, which saves the time so far; a hidden
 * page saves too, as it may be closed without another word. Returns the
 * function that stops following.
 */
export function followPage(runner: ClockRunner, active: boolean, whileHidden: boolean, page: PageEvents = { doc: document, win: window }): () => void {
  const { doc, win } = page;
  const update = () => runner.setClockRunning(active && (whileHidden || doc.visibilityState === 'visible'));
  const onVisibility = () => {
    update();
    if (doc.visibilityState === 'hidden') runner.save();
  };
  const onHide = () => runner.setClockRunning(false);
  // back from the browser's page cache
  const onShow = (e: Event) => (e as PageTransitionEvent).persisted && update();
  update();
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onHide);
  win.addEventListener('pageshow', onShow);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onHide);
    win.removeEventListener('pageshow', onShow);
  };
}

// --- summaries: what the screens show, and what a host sends its guests --------------------

export interface ClockSummary {
  playedMs: number;
  perPlayerMs: number[];
  /** Per seat: turns played (turn 1 on; the setup is not a turn) and their time together. */
  turnCount: number[];
  turnMs: number[];
  /** The longest turn so far (setup placements excluded). */
  longest: TurnTime | null;
  /** The turn being timed. */
  current: TurnTime | null;
  /** The clock is running: the values grow with the time since the summary was made. */
  running: boolean;
}

/** The clock's numbers at `now`. */
export function summarize(c: GameClock, now: number): ClockSummary {
  const s = settle(c, now);
  const n = s.perPlayerMs.length;
  const turnCount = Array<number>(n).fill(0);
  const turnMs = Array<number>(n).fill(0);
  let longest: TurnTime | null = null;
  for (const t of s.turns) {
    if (t.turn < 1 || t.player >= n) continue;
    turnCount[t.player]++;
    turnMs[t.player] += t.ms;
    if (!longest || t.ms > longest.ms) longest = t;
  }
  const cur = s.turns[s.turns.length - 1];
  return {
    playedMs: s.playedMs,
    perPlayerMs: s.perPlayerMs.slice(),
    turnCount,
    turnMs,
    longest: longest && { ...longest },
    current: !s.stopped && cur ? { ...cur } : null,
    running: isRunning(s),
  };
}

/**
 * A running summary `ms` later: what a guest shows between the host's
 * updates (the time since one arrived), or a screen between its re-renders.
 */
export function advance(s: ClockSummary, ms: number): ClockSummary {
  const d = Math.max(0, ms);
  if (!s.running || d === 0) return s;
  const perPlayerMs = s.perPlayerMs.slice();
  const turnMs = s.turnMs.slice();
  let current = s.current;
  let longest = s.longest;
  if (current) {
    current = { ...current, ms: current.ms + d };
    if (current.player < perPlayerMs.length) {
      perPlayerMs[current.player] += d;
      if (current.turn >= 1) turnMs[current.player] += d;
    }
    // the turn in play may become the longest (the summary's longest includes it)
    if (current.turn >= 1 && (!longest || current.ms > longest.ms)) longest = current;
  }
  return { ...s, playedMs: s.playedMs + d, perPlayerMs, turnMs, current, longest };
}

/** Stops a summary's clock at `ms` after it was made (a guest that lost the host). */
export function freeze(s: ClockSummary, ms: number): ClockSummary {
  return { ...advance(s, ms), running: false };
}

/** A summary received from a host, checked (null when missing or unusable). */
export function readSummary(raw: unknown, players: number): ClockSummary | null {
  const s = raw as Partial<ClockSummary> | null;
  if (!s || typeof s !== 'object' || !isMs(s.playedMs)) return null;
  const list = (a: unknown): a is number[] => Array.isArray(a) && a.length === players && a.every(isMs);
  if (!list(s.perPlayerMs) || !list(s.turnCount) || !list(s.turnMs)) return null;
  const turn = (t: unknown): TurnTime | null => {
    const x = t as TurnTime | null;
    return x && typeof x === 'object' && isSeat(x.player, players) && Number.isInteger(x.turn) && x.turn >= 0 && isMs(x.ms) ? { player: x.player, turn: x.turn, ms: x.ms } : null;
  };
  return {
    playedMs: s.playedMs,
    perPlayerMs: s.perPlayerMs.slice(),
    turnCount: s.turnCount.slice(),
    turnMs: s.turnMs.slice(),
    longest: turn(s.longest),
    current: turn(s.current),
    running: s.running === true,
  };
}

/** A summary and the local time it describes: a live display adds the time since. */
export interface ClockFeed {
  sum: ClockSummary;
  at: number;
}

export function liveSummary(feed: ClockFeed, now: number): ClockSummary {
  return advance(feed.sum, now - feed.at);
}

// --- words and numbers ------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** A stopwatch reading: 0:42, 23:41, 1:02:33. */
export function formatClock(ms: number): string {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A duration in words, to the second under an hour: 45 s, 3 min 12 s, 1 h 02 min. */
export function formatDuration(ms: number): string {
  const t = Math.floor(Math.max(0, ms) / 1000);
  if (t < 60) return `${t} s`;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  if (h > 0) return `${h} h ${pad(m)} min`;
  const s = t % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** A rough duration: 45 s, 42 min, 1 h 12 min. */
export function formatRough(ms: number): string {
  const t = Math.max(0, ms) / 1000;
  if (t < 60) return `${Math.floor(t)} s`;
  const mins = Math.round(t / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Average turn time per seat (null: no turns yet). */
export function averageTurn(s: ClockSummary, p: number): number | null {
  return s.turnCount[p] > 0 ? s.turnMs[p] / s.turnCount[p] : null;
}
