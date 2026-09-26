import {
  applyAction,
  heuristicAction,
  legalActions,
  viewFor,
  type Action,
  type GameState,
  type GameView,
  type PlayerId,
} from 'engine';
import { isRunning, newClock, observe, pause, restoreClock, resume, stop, summarize, type ClockFeed, type GameClock } from './clock';
import { botDelay, mustAct, type BotLevel, type BotSpeed, type Seat } from './seats';
import { removeKey, saveJson } from './storage';

export type GameMode = 'local' | 'host';

/** Everything needed to resume a game: stored in localStorage after every move. */
export interface GameRecord {
  v: 1;
  id: string;
  mode: GameMode;
  seats: Seat[];
  state: GameState;
  botSpeed: BotSpeed;
  /** How well the computer players play (older saves: medium). */
  botLevel?: BotLevel;
  /** Online games: the room code friends join with. */
  room?: string;
  /** Online games: which browser (client id) holds which remote seat. */
  claims?: Record<string, number>;
  /** Online games: the host has left the lobby and play has begun. */
  started?: boolean;
  /** How long the game has been played, and by whom (games saved before the timer: none). */
  clock?: GameClock;
  savedAt: number;
}

/** A clock for a new game: the first placement is about to be timed. */
export function clockFor(state: GameState): GameClock {
  return newClock(state.players.length, state.turn.actor, state.turn.number);
}

export const SAVE_KEY: Record<GameMode, string> = { local: 'save:local', host: 'save:host' };

/** What one seat's screen needs: its redacted view and its legal moves. */
export interface SeatSnapshot {
  view: GameView;
  legal: Action[];
  seat: PlayerId | null;
}

/**
 * Runs a game in this browser: applies moves through the engine, drives the
 * bots, decides whose hands this device may show (pass-and-play) and saves
 * after every move. In an online game the host runs one of these and remote
 * seats send their moves over the network.
 */
export class GameController {
  record: GameRecord;
  /** The local human currently holding the device (null = spectator). */
  viewer: PlayerId | null = null;
  /** Local human the device must be passed to before anything is shown. */
  handoff: PlayerId | null = null;
  error: string | null = null;
  /** Latest successful action, for small board animations. */
  last: { action: Action; by: PlayerId; at: number } | null = null;

  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botSteps = 0;
  private botPart = -1;
  private destroyed = false;
  private discarded = false;

  constructor(record: GameRecord) {
    // a saved clock comes back paused: the time the game spent closed doesn't count
    let clock = record.clock ? restoreClock(record.clock, record.state.players.length) ?? undefined : undefined;
    if (clock && record.state.phase.kind === 'gameOver' && !clock.stopped) clock = { ...clock, stopped: true };
    this.record = { ...record, clock };
    const humans = this.localHumans();
    // With several humans on one device nobody's hand is shown until the device is handed over.
    this.viewer = humans.length === 1 ? humans[0] : null;
    this.refresh(true);
  }

  get state(): GameState {
    return this.record.state;
  }

  get seats(): Seat[] {
    return this.record.seats;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  localHumans(): PlayerId[] {
    return this.seats.flatMap((s, i) => (s.kind === 'human' ? [i] : []));
  }

  /** Snapshot for a seat (null = spectator). Legal moves only for seats that may act. */
  snapshot(seat: PlayerId | null): SeatSnapshot {
    return {
      view: viewFor(this.state, seat),
      legal: seat === null ? [] : legalActions(this.state, seat),
      seat,
    };
  }

  /** Applies a move. Returns an error message, or null on success. */
  act(action: Action): string | null {
    if (this.destroyed) return 'the game is closed';
    const r = applyAction(this.state, action);
    if (!r.ok) {
      this.error = r.error;
      this.emit();
      return r.error;
    }
    this.error = null;
    const now = Date.now();
    let clock = this.record.clock;
    if (clock) {
      // the time so far goes to whoever had the turn; then the next turn is timed
      clock = observe(clock, r.state.turn.actor, r.state.turn.number, now);
      if (r.state.phase.kind === 'gameOver') clock = stop(clock, now);
    }
    this.record = { ...this.record, state: r.state, clock, savedAt: now };
    this.last = { action, by: action.player, at: now };
    this.save();
    this.refresh(false);
    return null;
  }

  clearError(): void {
    this.error = null;
    this.emit();
  }

  /** The player the device was passed to confirms it is them. */
  takeDevice(p: PlayerId): void {
    this.viewer = p;
    this.handoff = null;
    this.emit();
  }

  /** Online: a friend's browser takes a seat (and its name). */
  claimSeat(client: string, seat: number, name: string): void {
    const seats = this.seats.map((s, i) => (i === seat ? { ...s, name } : s));
    const state = { ...this.state, players: this.state.players.map((p, i) => (i === seat ? { ...p, name } : p)) };
    this.record = { ...this.record, seats, state, claims: { ...(this.record.claims ?? {}), [client]: seat } };
    this.save();
    this.emit();
  }

  /** Online: turns an empty or abandoned friend seat into a computer player (or back). */
  setSeatKind(seat: number, kind: Seat['kind']): void {
    const seats = this.seats.map((s, i) => (i === seat ? { ...s, kind } : s));
    const claims = { ...(this.record.claims ?? {}) };
    if (kind !== 'remote') for (const [c, i] of Object.entries(claims)) if (i === seat) delete claims[c];
    this.record = { ...this.record, seats, claims };
    this.save();
    this.refresh(false);
  }

  markStarted(): void {
    if (this.record.started) return;
    this.record = { ...this.record, started: true };
    this.save();
    this.emit();
  }

  setBotLevel(level: BotLevel): void {
    this.record = { ...this.record, botLevel: level };
    this.save();
    this.emit();
  }

  setBotSpeed(speed: BotSpeed): void {
    this.record = { ...this.record, botSpeed: speed };
    this.save();
    // apply the new pace to the move that is waiting
    this.scheduleBots(mustAct(this.state));
    this.emit();
  }

  /**
   * Runs or pauses the game clock (the page decides: see useGameClock). Pausing
   * saves the game, so the time so far is kept if the page is closed next.
   */
  setClockRunning(on: boolean): void {
    const c = this.record.clock;
    if (!c || this.destroyed) return;
    const now = Date.now();
    const next = on ? resume(c, now) : pause(c, now);
    if (next === c) return;
    this.record = { ...this.record, clock: next };
    if (!on) this.save();
    this.emit();
  }

  /** The clock's numbers now, for the screens and the guests (null: not timed). */
  clockFeed(): ClockFeed | null {
    const c = this.record.clock;
    if (!c) return null;
    const now = Date.now();
    return { sum: summarize(c, now), at: now };
  }

  save(): void {
    if (this.discarded) return;
    const c = this.record.clock;
    // saved paused with the time so far: a reload carries on from there, however long the page was closed
    saveJson(SAVE_KEY[this.record.mode], c ? { ...this.record, clock: pause(c, Date.now()) } : this.record);
  }

  discardSave(): void {
    this.discarded = true;
    removeKey(SAVE_KEY[this.record.mode]);
  }

  destroy(): void {
    if (this.destroyed) return;
    // keep the time played so far
    if (this.record.clock && isRunning(this.record.clock)) {
      this.record = { ...this.record, clock: pause(this.record.clock, Date.now()) };
      this.save();
    }
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }

  /** Works out who holds the device next and schedules bot moves. */
  private refresh(initial: boolean): void {
    const need = mustAct(this.state);
    const humans = this.localHumans();
    const nextHuman = need.find((p) => this.seats[p].kind === 'human');
    if (nextHuman !== undefined) {
      if (humans.length <= 1) {
        this.viewer = nextHuman;
      } else if (this.viewer !== nextHuman || initial) {
        this.handoff = nextHuman;
      }
    }
    this.scheduleBots(need);
    this.emit();
  }

  private scheduleBots(need: PlayerId[]): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // While players are answering a trade offer, the active player waits for
    // them (a computer player that made the offer must not withdraw it early).
    const s = this.state;
    const answering = s.phase.kind === 'main' ? need.filter((p) => p !== s.turn.actor) : [];
    const bot = (answering.length > 0 ? answering : need).find((p) => this.seats[p].kind === 'bot');
    if (bot === undefined || this.state.phase.kind === 'gameOver') return;
    this.timer = setTimeout(() => this.botStep(bot), botDelay(this.record.botSpeed, this.last?.action ?? null));
  }

  private botStep(p: PlayerId): void {
    this.timer = null;
    if (this.destroyed) return;
    const s = this.state;
    if (s.turn.part !== this.botPart) {
      this.botPart = s.turn.part;
      this.botSteps = 0;
    }
    let a = heuristicAction(s, p, this.record.botLevel ?? 'medium');
    // Safety valve: a bot never takes more than 60 moves in one part of a turn.
    if (++this.botSteps > 60 && s.phase.kind === 'main' && s.turn.actor === p) a = { type: 'endTurn', player: p };
    if (!a) {
      const legal = legalActions(s, p);
      a = legal.find((x) => x.type === 'endTurn') ?? legal[0] ?? null;
    }
    if (!a) return;
    const err = this.act(a);
    if (err) {
      // Should not happen; fall back to any legal move so the game never stalls.
      console.warn('bot move rejected', a, err);
      const legal = legalActions(this.state, p);
      const fallback = legal.find((x) => x.type === 'endTurn') ?? legal[0];
      if (fallback) this.act(fallback);
    }
  }
}

export function newGameId(): string {
  return Math.random().toString(36).slice(2, 10);
}
