import type { GameView, PlayerId, Resource } from 'engine';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PlayerColor } from '../game/seats';
import { Die } from './common';
import { ResGlyph } from './icons';

/** One line of the game log, ready to draw. */
export interface LogItem {
  /** Index in view.log (stable: the log only grows). */
  key: number;
  msg: string;
  /** The player the line is about (it starts with their name). */
  who: PlayerId | null;
  /** A "--- Turn 9: Ada ---" line: the turn number and whose turn it is. */
  turn?: { n: number | null; label: string };
  /** Seen only by some players (a stolen or drawn card). */
  secret: boolean;
}

const TURN = /^---\s*(?:Turn (\d+):\s*)?(.*?)\s*---$/;

/** The last `limit` log lines, with their players and turn dividers worked out. */
export function logItems(view: GameView, limit = 300): LogItem[] {
  const out: LogItem[] = [];
  for (let i = Math.max(0, view.log.length - limit); i < view.log.length; i++) {
    const e = view.log[i];
    const t = TURN.exec(e.msg);
    if (t) {
      const who = view.players.find((p) => p.name === t[2]);
      out.push({ key: i, msg: e.msg, who: who?.id ?? null, turn: { n: t[1] ? Number(t[1]) : null, label: t[2] }, secret: false });
      continue;
    }
    const who = view.players.find((p) => e.msg.startsWith(p.name + ' ') || e.msg.startsWith('(' + p.name + ' '));
    out.push({ key: i, msg: e.msg, who: who?.id ?? null, secret: !!e.visibleTo });
  }
  return out;
}

type Tok =
  | { t: 'text'; s: string }
  | { t: 'name'; s: string; id: PlayerId }
  | { t: 'roll'; n: number; a: number; b: number }
  | { t: 'res'; n: number | null; r: Resource };

const RES = '(brick|lumber|wool|grain|ore)';
const WORDISH = /[\p{L}\p{N}]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let cached: { key: string; re: RegExp; names: Array<{ id: PlayerId; name: string }> } | null = null;

/** The pattern for one game's player names (built once per game). */
function pattern(view: GameView) {
  const key = view.players.map((p) => p.name).join('\n');
  if (cached?.key !== key) {
    const names = view.players.filter((p) => p.name).sort((a, b) => b.name.length - a.name.length);
    const alt = names.length > 0 ? names.map((p) => escape(p.name)).join('|') : '[^\\s\\S]';
    const re = new RegExp(`(${alt})|rolls (\\d+) \\((\\d)\\+(\\d)\\)|(\\d+) ${RES}\\b|\\b${RES}\\b`, 'g');
    cached = { key, re, names: names.map((p) => ({ id: p.id, name: p.name })) };
  }
  return cached;
}

/** Splits a log line into text, player names, a dice roll and resource counts. */
function tokenize(msg: string, view: GameView): Tok[] {
  const { re, names } = pattern(view);
  re.lastIndex = 0;
  const out: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(msg))) {
    if (m[1] !== undefined) {
      // a name inside a longer word ("Ada" in "Adam") is just text
      const before = msg[m.index - 1];
      const after = msg[m.index + m[0].length];
      if ((before && WORDISH.test(before)) || (after && WORDISH.test(after))) {
        re.lastIndex = m.index + 1;
        continue;
      }
    }
    if (m.index > last) out.push({ t: 'text', s: msg.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'name', s: m[1], id: names.find((p) => p.name === m![1])!.id });
    else if (m[2] !== undefined) {
      out.push({ t: 'text', s: 'rolls ' });
      out.push({ t: 'roll', n: Number(m[2]), a: Number(m[3]), b: Number(m[4]) });
    } else if (m[5] !== undefined) out.push({ t: 'res', n: Number(m[5]), r: m[6] as Resource });
    else out.push({ t: 'res', n: null, r: m[7] as Resource });
    last = m.index + m[0].length;
  }
  if (last < msg.length) out.push({ t: 'text', s: msg.slice(last) });
  return out;
}

/** A log line with player names marked, the dice total picked out and drawn resource icons. */
export function RichText({ msg, view, colors }: { msg: string; view: GameView; colors: PlayerColor[] }) {
  return (
    <>
      {tokenize(msg, view).map((k, i): ComponentChildren => {
        switch (k.t) {
          case 'text':
            return k.s;
          case 'name':
            return (
              <b key={i} class="lg-name" style={{ '--pc': colors[k.id]?.fill } as Record<string, string>}>
                {k.s}
              </b>
            );
          case 'roll':
            return (
              <span key={i} class="lg-rolled">
                <span class={k.n === 7 ? 'lg-roll seven' : k.n === 6 || k.n === 8 ? 'lg-roll hot' : 'lg-roll'}>{k.n}</span>
                <span class="lg-dice">
                  <Die n={k.a} />
                  <Die n={k.b} red />
                </span>
              </span>
            );
          case 'res':
            return k.n === null ? (
              <span key={i} class="lg-res word">
                <ResGlyph r={k.r} />
                {k.r}
              </span>
            ) : (
              <span key={i} class="lg-res">
                {k.n}
                <ResGlyph r={k.r} />
              </span>
            );
        }
      })}
    </>
  );
}

/** One log line or turn divider. */
export function LogLine({ item, view, colors }: { item: LogItem; view: GameView; colors: PlayerColor[] }) {
  const pc = item.who !== null ? colors[item.who]?.fill : undefined;
  const style = pc ? ({ '--pc': pc } as Record<string, string>) : undefined;
  if (item.turn) {
    return (
      <li class={pc ? 'lg-turn' : 'lg-turn plain'} style={style}>
        <span class="lg-turn-label">
          {item.turn.n !== null && <span class="lg-turn-n">Turn {item.turn.n}</span>}
          {item.turn.label && <span class="lg-turn-who">{item.turn.label}</span>}
        </span>
      </li>
    );
  }
  const roll = / rolls \d+ \(/.test(item.msg);
  return (
    <li class={`lg-e${item.secret ? ' secret' : ''}${roll ? ' is-roll' : ''}${pc ? '' : ' system'}`} style={style}>
      <span class="lg-dot" aria-hidden="true" />
      <span class="lg-msg">
        <RichText msg={item.msg} view={view} colors={colors} />
      </span>
    </li>
  );
}

/** Where the docked log is kept between games (see GameScreen). */
export interface LogPrefs {
  open: boolean;
  /** Size set by dragging the corner, in px (none: the default size). */
  w?: number;
  h?: number;
}

/**
 * The game log docked in the bottom-left corner of the board (wide screens):
 * newest line at the bottom, following new moves unless the player has
 * scrolled back. It can be folded down to its header and resized from its
 * top-right corner.
 */
export function DockedLog({
  view,
  colors,
  prefs,
  onPrefs,
}: {
  view: GameView;
  colors: PlayerColor[];
  prefs: LogPrefs;
  onPrefs(p: LogPrefs): void;
}) {
  const len = view.log.length;
  const colorKey = colors.map((c) => c.id).join();
  // the log only grows: the lines are redrawn when a new one comes in
  const items = useMemo(() => logItems(view, 300), [len, view.log[len - 1]?.msg, colorKey]);
  const lines = useMemo(
    () => (
      <ol class="glog-list">
        {items.map((it) => (
          <LogLine key={it.key} item={it} view={view} colors={colors} />
        ))}
      </ol>
    ),
    [items],
  );
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  // follow new lines while the player is at the bottom
  const stick = useRef(true);
  const seen = useRef(len);
  const [unseen, setUnseen] = useState(0);

  useLayoutEffect(() => {
    const el = list.current;
    const added = len - seen.current;
    seen.current = len;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setUnseen((n) => n + added);
  }, [len]);
  // opened again: start at the newest line
  useLayoutEffect(() => {
    if (!prefs.open || !list.current) return;
    stick.current = true;
    list.current.scrollTop = list.current.scrollHeight;
    setUnseen(0);
  }, [prefs.open]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    if (stick.current) setUnseen(0);
  };
  const jump = () => {
    const el = list.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
    setUnseen(0);
  };

  // Resizing from the top-right corner: the new size goes straight into the
  // CSS variables while dragging and is saved when the button is let go.
  const drag = useRef<{ id: number; x: number; y: number; w: number; h: number; maxW: number; maxH: number } | null>(null);
  const size = useRef<{ w: number; h: number } | null>(null);
  const onGripDown = (e: PointerEvent) => {
    const el = box.current;
    const area = el?.parentElement;
    if (!el || !area) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      w: r.width,
      h: r.height,
      // keep room for the confirm bar on the right and the zoom buttons above
      maxW: Math.max(280, area.clientWidth - 330),
      maxH: Math.max(160, area.clientHeight - 24),
    };
  };
  const onGripMove = (e: PointerEvent) => {
    const d = drag.current;
    const area = box.current?.parentElement;
    if (!d || d.id !== e.pointerId || !area) return;
    const w = Math.round(Math.min(d.maxW, Math.max(280, d.w + e.clientX - d.x)));
    const h = Math.round(Math.min(d.maxH, Math.max(160, d.h - (e.clientY - d.y))));
    size.current = { w, h };
    area.style.setProperty('--log-w', `${w}px`);
    area.style.setProperty('--log-h', `${h}px`);
    if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  };
  const onGripUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (size.current) onPrefs({ ...prefs, ...size.current });
    size.current = null;
  };
  const resetSize = () => {
    const area = box.current?.parentElement;
    area?.style.removeProperty('--log-w');
    area?.style.removeProperty('--log-h');
    onPrefs({ open: prefs.open });
  };

  const latest = [...items].reverse().find((it) => !it.turn);
  return (
    <section ref={box} class={prefs.open ? 'glog' : 'glog folded'} aria-label="Game log">
      <header class="glog-head">
        <span class="glog-title">
          <svg viewBox="0 0 16 16" aria-hidden="true" class="glog-icon">
            <path d="M3 2.5h8.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
            <path d="M5.5 6h5.5M5.5 8.5h5.5M5.5 11h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
          Game log
        </span>
        {!prefs.open && latest && (
          <span class="glog-peek">
            <RichText msg={latest.msg} view={view} colors={colors} />
          </span>
        )}
        {prefs.open && (
          <span
            class="glog-grip"
            title="Drag to resize · double-click for the normal size"
            aria-hidden="true"
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            onDblClick={resetSize}
          >
            <svg viewBox="0 0 12 12">
              <path d="M2 6 6 2M2 10 10 2M6 10 10 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
          </span>
        )}
        <button
          type="button"
          class="glog-fold"
          aria-expanded={prefs.open}
          aria-label={prefs.open ? 'Fold the game log' : 'Open the game log'}
          title={prefs.open ? 'Fold the game log' : 'Open the game log'}
          onClick={() => onPrefs({ ...prefs, open: !prefs.open })}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d={prefs.open ? 'M3 4.5 6 7.5 9 4.5' : 'M3 7.5 6 4.5 9 7.5'} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </header>
      {prefs.open && (
        <div class="glog-body" ref={list} onScroll={onScroll} role="log" aria-live="polite">
          {items.length === 0 ? <p class="glog-empty">Moves will show up here.</p> : lines}
        </div>
      )}
      {prefs.open && unseen > 0 && (
        <button type="button" class="glog-new" onClick={jump}>
          ↓ {unseen} new
        </button>
      )}
    </section>
  );
}
