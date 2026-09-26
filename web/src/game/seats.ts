import type { Action, BotLevel, GameState, GameView, PlayerId } from 'engine';

export type SeatKind = 'human' | 'bot' | 'remote';

export interface Seat {
  name: string;
  kind: SeatKind;
  /** Index into PLAYER_COLORS. */
  color: number;
}

export interface PlayerColor {
  id: string;
  label: string;
  fill: string;
  /** Darker outline for pieces. */
  stroke: string;
}

export const PLAYER_COLORS: PlayerColor[] = [
  { id: 'red', label: 'Red', fill: '#d8433b', stroke: '#7c1d18' },
  { id: 'blue', label: 'Blue', fill: '#2f6fe0', stroke: '#173a7a' },
  { id: 'orange', label: 'Orange', fill: '#f08c1a', stroke: '#8a4b05' },
  { id: 'green', label: 'Green', fill: '#2a9d5c', stroke: '#11522d' },
  { id: 'purple', label: 'Purple', fill: '#8b55d6', stroke: '#48237f' },
  { id: 'brown', label: 'Brown', fill: '#9a6532', stroke: '#4e3014' },
];

export const BOT_NAMES = ['Ada', 'Björn', 'Chen', 'Dara', 'Emil', 'Farah', 'Gus', 'Hana'];

export type BotSpeed = 'slow' | 'normal' | 'fast';
/** Pause before each computer move, in ms (longer after a roll or at a new turn, see botDelay). */
export const BOT_DELAY: Record<BotSpeed, number> = { slow: 1900, normal: 1150, fast: 450 };

export const SPEED_LABEL: Record<BotSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };

export type { BotLevel } from 'engine';
export const LEVEL_LABEL: Record<BotLevel, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
/** What each level does differently, in a line. */
export const LEVEL_HINT: Record<BotLevel, string> = {
  easy: 'Builds whatever it can, makes mistakes, and trades generously: good for learning.',
  medium: 'Saves up for a goal, uses the bank and harbors, and trades fairly.',
  hard: 'Plans ahead, keeps the robber on the leader, trades hard and never helps someone about to win.',
};

/** The dice animation, in ms: tumbling in the middle, resting, then flying to the header. */
export interface RollTiming {
  tumble: number;
  hold: number;
  flight: number;
}
export const ROLL_TIMING: Record<BotSpeed, RollTiming> = {
  slow: { tumble: 1150, hold: 450, flight: 450 },
  normal: { tumble: 1000, hold: 350, flight: 450 },
  fast: { tumble: 550, hold: 150, flight: 300 },
};
export function rollDuration(speed: BotSpeed): number {
  const t = ROLL_TIMING[speed];
  return t.tumble + t.hold + t.flight;
}

/**
 * How long to wait before the next computer move: players need time to see
 * what a roll produced and whose turn it is now.
 */
export function botDelay(speed: BotSpeed, last: Action | null): number {
  const base = BOT_DELAY[speed];
  if (!last) return base;
  // the dice animation, then a moment to see what the roll produced
  if (last.type === 'rollDice') return rollDuration(speed) + base * 0.8;
  if (last.type === 'endTurn') return base * 1.4;
  return base;
}

/**
 * Players who must act now, most urgent first. While the active player's
 * trade offer is open, the players it is addressed to answer first.
 */
export function mustAct(s: GameState | GameView): PlayerId[] {
  const ph = s.phase;
  const n = s.players.length;
  const fromCurrent = (a: number, b: number) => ((a - s.turn.current + n) % n) - ((b - s.turn.current + n) % n);
  switch (ph.kind) {
    case 'gameOver':
      return [];
    case 'discard':
    case 'gold':
      return Object.keys(ph.pending).map(Number).sort(fromCurrent);
    case 'harborPlacement':
      return [ph.queue[0]];
    case 'scenario':
      return [ph.player];
    case 'main': {
      const responders: PlayerId[] = [];
      for (const t of s.turn.trades) {
        if (t.from !== s.turn.actor) continue;
        for (const p of t.to) {
          if (!t.accepted.includes(p) && !t.rejected.includes(p) && !responders.includes(p)) responders.push(p);
        }
      }
      return [...responders.sort(fromCurrent), s.turn.actor];
    }
    default:
      return [s.turn.actor];
  }
}
