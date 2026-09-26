import { useEffect, useRef, useState } from 'preact/hooks';
import { formatClock, liveSummary, type ClockFeed, type ClockSummary } from '../game/clock';
import { loadJson, saveJson } from '../game/storage';

// --- "Show timer": a setting kept in this browser, on unless turned off -------------------

const TIMER_PREF = 'ui:timer';
let shown: boolean | null = null;
const prefListeners = new Set<() => void>();

function timerShown(): boolean {
  // (loadJson never throws; a browser without storage just keeps the choice for this visit)
  if (shown === null) shown = loadJson<boolean>(TIMER_PREF) !== false;
  return shown;
}

export function setTimerShown(on: boolean): void {
  shown = on;
  saveJson(TIMER_PREF, on);
  for (const fn of prefListeners) fn();
}

/** Whether the live timer is shown, following changes from the menu. */
export function useTimerShown(): boolean {
  const [on, setOn] = useState(timerShown);
  useEffect(() => {
    const update = () => setOn(timerShown());
    prefListeners.add(update);
    update();
    return () => {
      prefListeners.delete(update);
    };
  }, []);
  return on;
}

/** The menu row that shows or hides the live timer, with a line on how it counts. */
export function TimerSwitch({ note }: { note: string }) {
  const on = useTimerShown();
  return (
    <div class="timer-pref">
      <label class="row switch-row">
        <span>Show timer</span>
        <input type="checkbox" role="switch" class="switch" checked={on} onChange={(e) => setTimerShown((e.target as HTMLInputElement).checked)} />
      </label>
      <p class="hint">{note}</p>
    </div>
  );
}

// --- one shared tick for every live reading ---------------------------------------------

const tickers = new Set<() => void>();
let beat: ReturnType<typeof setInterval> | null = null;

/** Calls `fn` a few times a second while subscribed (readings re-render only when their text changes). */
function onTick(fn: () => void): () => void {
  tickers.add(fn);
  if (!beat) beat = setInterval(() => tickers.forEach((f) => f()), 250);
  return () => {
    tickers.delete(fn);
    if (tickers.size === 0 && beat) {
      clearInterval(beat);
      beat = null;
    }
  };
}

/**
 * A running clock reading (m:ss or h:mm:ss) that updates itself every second,
 * so the screen around it doesn't re-render. `pick` chooses the number: the
 * game time, a player's turn so far, and so on (null shows nothing).
 */
export function LiveTime({ feed, pick, format = formatClock }: { feed: ClockFeed; pick(s: ClockSummary): number | null; format?: (ms: number) => string }) {
  const read = () => {
    const v = pick(liveSummary(feed, Date.now()));
    return v === null ? '' : format(v);
  };
  const text = read();
  const shownText = useRef(text);
  shownText.current = text;
  const reader = useRef(read);
  reader.current = read;
  const [, redraw] = useState(0);
  useEffect(() => {
    if (!feed.sum.running) return;
    return onTick(() => {
      if (reader.current() !== shownText.current) redraw((n) => n + 1);
    });
  }, [feed]);
  return <>{text}</>;
}

/** The stopwatch glyph used next to clock readings. */
export function ClockIcon() {
  return (
    <svg class="clock-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="9" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M8 9V6.2M6.4 1.8h3.2M8 1.8v1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}
