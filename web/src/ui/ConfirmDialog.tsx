import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ImprovementTrack, KnightLevel } from 'engine';
import type { Ask, AskArt } from '../game/ask';
import { CARD_INFO, CARD_LIST } from '../game/names';
import type { PlayerColor } from '../game/seats';
import { loadJson, saveJson } from '../game/storage';
import { DevCardView } from './cards';
import { ResGlyph } from './icons';
import { PieceGlyph } from './pieces';
import { GateGlyph, KnightGlyph, TowerGlyph, WallGlyph } from './ckArt';

// --- "Ask before building": a setting kept in this browser, on unless turned off -------------

const ASK_PREF = 'ui:askBuild';
let asking: boolean | null = null;
const prefListeners = new Set<() => void>();

function askBeforeBuilding(): boolean {
  // (loadJson and saveJson catch storage errors: without storage the choice lasts this visit)
  if (asking === null) asking = loadJson<boolean>(ASK_PREF) !== false;
  return asking;
}

export function setAskBeforeBuilding(on: boolean): void {
  asking = on;
  saveJson(ASK_PREF, on);
  for (const fn of prefListeners) fn();
}

/** Whether builds and purchases are confirmed in a dialog first, following changes from the menu. */
export function useAskBeforeBuilding(): boolean {
  const [on, setOn] = useState(askBeforeBuilding);
  useEffect(() => {
    const update = () => setOn(askBeforeBuilding());
    prefListeners.add(update);
    update();
    return () => {
      prefListeners.delete(update);
    };
  }, []);
  return on;
}

/** The menu row that turns the confirmation dialog on or off. */
export function AskSwitch() {
  const on = useAskBeforeBuilding();
  return (
    <div class="menu-pref">
      <label class="row switch-row">
        <span>Ask before building</span>
        <input type="checkbox" role="switch" class="switch" checked={on} onChange={(e) => setAskBeforeBuilding((e.target as HTMLInputElement).checked)} />
      </label>
      <p class="hint">A “Yes or no?” check before you build, buy a development card or place a piece.</p>
    </div>
  );
}

// --- the dialog ------------------------------------------------------------------------------------

/** A wonder under construction (The Wonders scenario). */
function WonderGlyph() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <ellipse cx="20" cy="35.5" rx="16" ry="2.6" fill="rgba(0,0,0,0.22)" />
      <path d="M4 13 L20 4 L36 13 Z" fill="#f1c140" stroke="#8a6410" stroke-width="1.4" stroke-linejoin="round" />
      <rect x="5" y="13" width="30" height="3.4" rx="0.8" fill="#e8d9b0" stroke="#8a6410" stroke-width="1.2" />
      {[8.5, 15.5, 22.5, 29.5].map((x) => (
        <rect key={x} x={x - 1.9} y="16.4" width="3.8" height="14" fill="#fbf3dc" stroke="#8a6410" stroke-width="1.1" />
      ))}
      <rect x="3.5" y="30.4" width="33" height="4" rx="0.8" fill="#e8d9b0" stroke="#8a6410" stroke-width="1.2" />
    </svg>
  );
}

/** The robber, chased by a knight. */
function RobberGlyph() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <ellipse cx="20" cy="35" rx="11" ry="3" fill="rgba(0,0,0,0.22)" />
      <path d="M10 35 Q20 6 30 35 Z" fill="#3a3a40" stroke="#1c1c20" stroke-width="1.2" />
      <circle cx="20" cy="11" r="6.5" fill="#4a4a50" stroke="#1c1c20" stroke-width="1.2" />
    </svg>
  );
}

function Art({ art, color }: { art: AskArt; color: PlayerColor }) {
  if (art === 'dev') return <DevCardView type={null} back look="mini" />;
  if (art === 'wonder') return <WonderGlyph />;
  if (art === 'robber') return <RobberGlyph />;
  if (art === 'wall') return <WallGlyph fill={color.fill} stroke={color.stroke} />;
  if (art.startsWith('knight-')) {
    const [, level, on] = art.split('-');
    return <KnightGlyph level={Number(level) as KnightLevel} active={on === 'on'} fill={color.fill} stroke={color.stroke} />;
  }
  if (art.startsWith('gate-')) return <GateGlyph track={art.slice(5) as ImprovementTrack} size={40} />;
  if (art.startsWith('metro-')) return <TowerGlyph track={art.slice(6) as ImprovementTrack} fill={color.fill} stroke={color.stroke} />;
  return <PieceGlyph kind={art as 'road' | 'ship' | 'settlement' | 'city'} fill={color.fill} stroke={color.stroke} />;
}

/** How long a click that didn't start on the dialog is ignored after it opens (see `pressed`). */
const SETTLE_MS = 600;

/**
 * "Build a settlement here? Yes / No": a small dialog in the middle of the
 * screen with the piece, what it costs and what the hand keeps. For a spot on
 * the board, the ghost piece stays in view behind it (a lit circle), and the
 * dialog moves up or down out of its way. Enter or Y says yes, Esc or N no;
 * the focus stays inside; a tap beside it is a no.
 */
export function ConfirmDialog({
  ask,
  color,
  onYes,
  onNo,
  onPreview,
}: {
  ask: Ask;
  color: PlayerColor;
  /** The choice made (an index into ask.choices). */
  onYes(i: number): void;
  onNo(): void;
  /** A choice is pointed at or focused: show that piece on the board. */
  onPreview?: (i: number) => void;
}) {
  const box = useRef<HTMLElement>(null);
  const cb = useRef({ onYes, onNo });
  cb.current = { onYes, onNo };
  const opened = useRef(Date.now());
  /** Where the latest press on the dialog (or beside it) began, and when. */
  const down = useRef<{ target: EventTarget | null; at: number } | null>(null);
  const [spot, setSpot] = useState<{ x: number; y: number; r: number } | null>(null);
  const [place, setPlace] = useState<'mid' | 'top' | 'bottom'>('mid');
  const multi = ask.choices.length > 1;

  /**
   * Whether a click on `el` is really an answer. The tap that picked the spot
   * on the board ends in a click that lands on whatever is there once the
   * dialog is up: that one doesn't count. Keys (detail 0) always do.
   */
  const pressed = (e: MouseEvent, el: Element, exact = false) => {
    if (e.detail === 0) return true;
    const d = down.current && Date.now() - down.current.at < 1500 ? down.current : null;
    if (d) return exact ? d.target === el : d.target instanceof Node && el.contains(d.target);
    return Date.now() - opened.current > SETTLE_MS;
  };

  // The focus goes to the yes button and stays in the dialog; the keys answer it and reach nothing behind it.
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLButtonElement>('button.primary')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const el = box.current;
      if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
      e.stopPropagation();
      const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
      const at = document.activeElement;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'Tab') {
        e.preventDefault();
        const i = buttons.indexOf(at as HTMLButtonElement);
        const n = buttons.length;
        buttons[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n]?.focus();
      } else if (k === 'Escape' || k === 'n') {
        e.preventDefault();
        if (!e.repeat) cb.current.onNo();
      } else if (k === 'y' || (k === 'Enter' && !(at instanceof HTMLButtonElement && el.contains(at)))) {
        e.preventDefault();
        const i = at instanceof HTMLElement && at.dataset.choice !== undefined ? Number(at.dataset.choice) : 0;
        if (!e.repeat) cb.current.onYes(i);
      } else if (k === 'Enter' && e.repeat) {
        // Enter on a button presses it; holding the key doesn't press it again
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // Keep the ghost piece on the board in view: light it up, and move the dialog off it.
  useLayoutEffect(() => {
    const measure = () => {
      const el = box.current;
      const ghost = document.querySelector('[data-ghost]')?.getBoundingClientRect();
      if (!el || !ghost || (ghost.width === 0 && ghost.height === 0)) {
        setSpot(null);
        setPlace('mid');
        return;
      }
      const s = { x: ghost.left + ghost.width / 2, y: ghost.top + ghost.height / 2, r: Math.max(ghost.width, ghost.height) / 2 + 20 };
      setSpot(s);
      // the dialog's own size (the opening animation scales it)
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = (window.innerWidth - w) / 2;
      const top = (window.innerHeight - h) / 2;
      const covers = s.x + s.r > left && s.x - s.r < left + w && s.y + s.r > top && s.y - s.r < top + h;
      setPlace(!covers ? 'mid' : s.y > window.innerHeight / 2 ? 'top' : 'bottom');
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ask.title]);

  const pips = ask.cost
    ? CARD_LIST.flatMap((r) =>
        Array.from({ length: ask.cost![r] ?? 0 }, (_, i) => (
          <span key={`${r}${i}`} class="ask-pip">
            <ResGlyph r={r} />
          </span>
        )),
      )
    : null;

  return (
    <div
      class={`confirm-backdrop at-${place}${spot ? ' lit' : ''}`}
      style={spot ? ({ '--sx': `${spot.x}px`, '--sy': `${spot.y}px`, '--sr': `${spot.r}px` } as Record<string, string>) : undefined}
      onPointerDown={(e) => {
        down.current = { target: e.target, at: Date.now() };
      }}
      onClick={(e) => {
        // (a press that began on the dialog and slid off it is not a no)
        if (e.target === e.currentTarget && pressed(e, e.currentTarget as Element, true)) cb.current.onNo();
      }}
    >
      {spot && <span class="ask-ring" aria-hidden="true" />}
      <section ref={box} class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-body">
        <div class="ask-head">
          <span class={multi ? 'ask-art two' : `ask-art art-${ask.choices[0].art}`} aria-hidden="true">
            {ask.choices.map((c, i) => (
              <span key={i} class="ask-piece">
                <Art art={c.art} color={color} />
              </span>
            ))}
          </span>
          <h2 id="ask-title">{ask.title}</h2>
        </div>
        <div id="ask-body" class="ask-body">
          {ask.cost && (
            <div class="ask-cost">
              <span class="ask-label">Cost</span>
              <span class="ask-pips">{pips}</span>
            </div>
          )}
          {ask.left.length > 0 && (
            <p class="ask-left">
              You’ll have{' '}
              {ask.left.map((x, i) => (
                <span key={x.r}>
                  {i === 0 ? '' : i === ask.left.length - 1 ? ' and ' : ', '}
                  <span class={x.n === 0 ? 'ask-n out' : 'ask-n'}>
                    <b>{x.n}</b> {CARD_INFO[x.r].label.toLowerCase()}
                  </span>
                </span>
              ))}{' '}
              left.
            </p>
          )}
          {ask.notes.length > 0 && (
            <ul class="ask-notes">
              {ask.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        <div class={multi ? 'ask-buttons multi' : 'ask-buttons'}>
          <button
            type="button"
            class="ask-no"
            onClick={(e) => {
              if (pressed(e, e.currentTarget)) cb.current.onNo();
            }}
          >
            No
            <kbd class="key" aria-hidden="true">
              Esc
            </kbd>
          </button>
          {ask.choices.map((c, i) => (
            <button
              type="button"
              key={i}
              class="primary ask-yes"
              data-choice={i}
              onClick={(e) => {
                if (pressed(e, e.currentTarget)) cb.current.onYes(i);
              }}
              onPointerEnter={() => onPreview?.(i)}
              onFocus={() => onPreview?.(i)}
            >
              {multi && (
                <span class="ask-yes-art" aria-hidden="true">
                  <Art art={c.art} color={color} />
                </span>
              )}
              {c.label}
              {i === 0 && (
                <kbd class="key" aria-hidden="true">
                  Enter
                </kbd>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
