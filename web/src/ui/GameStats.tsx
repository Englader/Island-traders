import { VP, getScenario, type GameStats as Stats, type GameView, type PlayerId, type PlayerStats, type Resource } from 'engine';
import type { ComponentChildren, RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { averageTurn, formatClock, formatDuration, formatRough, type ClockFeed, type ClockSummary } from '../game/clock';
import { RESOURCE_INFO, RESOURCE_LIST } from '../game/names';
import type { PlayerColor, SeatKind } from '../game/seats';
import { Sheet } from './common';
import { ResGlyph } from './icons';
import './endgame.css';

/**
 * The end-of-game statistics: final scores, the race to the winning points,
 * who produced what, highlights and a link to the dice statistics. Player
 * colours are fixed identities (the colours of their pieces), so every chart
 * also marks players with a shape and their name.
 */
export function GameStatsSheet({
  view,
  colors,
  kinds,
  seat,
  clock,
  close,
  onDice,
}: {
  view: GameView;
  colors: PlayerColor[];
  kinds: SeatKind[];
  seat: PlayerId | null;
  /** The game clock (null: the game was not timed). */
  clock: ClockFeed | null;
  close(): void;
  onDice(): void;
}) {
  const sc = getScenario(view.scenario);
  const stats = view.stats && view.stats.players.length === view.players.length ? view.stats : null;
  const winner = view.phase.kind === 'gameOver' ? view.phase.winner : null;
  const rolls = view.rolls.length;
  const time = clock && clock.sum.perPlayerMs.length === view.players.length ? clock.sum : null;
  return (
    <Sheet title="Game stats" onClose={close} wide>
      <div class="gstats">
        <p class="gs-sub">
          {sc.name} · {view.turn.number} turns · {view.players.length} players{time ? ` · ${formatRough(time.playedMs)}` : ''}
        </p>

        <Section title="Final scores">
          <ScoreTable view={view} colors={colors} kinds={kinds} seat={seat} winner={winner} />
        </Section>

        <Section title="Highlights">
          <Highlights view={view} colors={colors} stats={stats} />
        </Section>

        <Section title="Race to the finish" note="Victory points after each turn (turn 0: after the setup)">
          {stats && stats.players.every((p) => p.vp.length >= 2) ? (
            <VpRace view={view} colors={colors} stats={stats} winner={winner} />
          ) : (
            <NotRecorded />
          )}
        </Section>

        <Section title="Resources produced" note="Cards the dice gave each player, gold picks included">
          {stats ? <Produced view={view} colors={colors} stats={stats} /> : <NotRecorded />}
        </Section>

        <Section title="Cards and trades" note={`Thieves: the robber${sc.rules.pirate ? ', the pirate' : ''} and Monopoly`}>
          {stats ? <Ledger view={view} colors={colors} stats={stats} /> : <NotRecorded />}
        </Section>

        <Section title="Time" note="Active play, each moment counted for the player whose turn it was">
          {time ? (
            <TimeStats view={view} colors={colors} kinds={kinds} seat={seat} time={time} />
          ) : (
            <p class="gs-empty">Time wasn't recorded for this game: it was started before the game kept time.</p>
          )}
        </Section>

        <Section title="Dice">
          <button type="button" class="wide gs-dice" onClick={onDice}>
            🎲 Dice statistics
            <span class="gs-dice-sub">
              {rolls > 0 ? `${rolls} rolls · ${view.rolls.filter((r) => r.dice[0] + r.dice[1] === 7).length} sevens` : 'every total rolled'}
            </span>
          </button>
        </Section>
      </div>
    </Sheet>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ComponentChildren }) {
  return (
    <section class="gs-section" aria-label={title}>
      <h3>{title}</h3>
      {note && <p class="gs-note">{note}</p>}
      {children}
    </section>
  );
}

function NotRecorded() {
  return <p class="gs-empty">Not recorded for this game: it was started before the game kept these statistics.</p>;
}

// --- player identity: colour, shape and name ------------------------------------------

/** Marker shapes, one per seat, so players never rely on colour alone. */
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'down', 'plus'] as const;

function shapePath(seat: number, x: number, y: number, r: number): string {
  switch (SHAPES[seat % SHAPES.length]) {
    case 'square': {
      const s = r * 0.88;
      return `M${x - s} ${y - s}h${2 * s}v${2 * s}h${-2 * s}Z`;
    }
    case 'triangle':
      return `M${x} ${y - r * 1.15}L${x + r * 1.1} ${y + r * 0.8}H${x - r * 1.1}Z`;
    case 'diamond':
      return `M${x} ${y - r * 1.2}L${x + r * 1.05} ${y}L${x} ${y + r * 1.2}L${x - r * 1.05} ${y}Z`;
    case 'down':
      return `M${x} ${y + r * 1.15}L${x + r * 1.1} ${y - r * 0.8}H${x - r * 1.1}Z`;
    case 'plus': {
      const a = r * 0.42;
      const b = r * 1.1;
      return `M${x - a} ${y - b}h${2 * a}v${b - a}h${b - a}v${2 * a}h${a - b}v${b - a}h${-2 * a}v${a - b}h${a - b}v${-2 * a}h${b - a}Z`;
    }
    default:
      return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  }
}

/** A player's marker inside a chart, with a ring in the surface colour. */
function Marker({ seat, color, x, y, r = 4.5 }: { seat: number; color: string; x: number; y: number; r?: number }) {
  return <path d={shapePath(seat, x, y, r)} fill={color} class="gs-marker" />;
}

/** Inline key: a short line with the player's marker (for legends, tables and tooltips). */
function PlayerKey({ seat, color, line = true }: { seat: number; color: string; line?: boolean }) {
  const w = line ? 22 : 12;
  return (
    <svg class="gs-key" width={w} height="12" viewBox={`0 0 ${w} 12`} aria-hidden="true">
      {line && <line x1="1" x2={w - 1} y1="6" y2="6" stroke={color} stroke-width="2" stroke-linecap="round" />}
      <Marker seat={seat} color={color} x={w / 2} y={6} r={4} />
    </svg>
  );
}

function Who({ view, colors, p, line }: { view: GameView; colors: PlayerColor[]; p: PlayerId; line?: boolean }) {
  return (
    <span class="gs-who">
      <PlayerKey seat={p} color={colors[p].fill} line={line} />
      <span class="gs-name">{view.players[p].name}</span>
    </span>
  );
}

/** Width of an element in CSS pixels, kept up to date (charts draw at 1:1 so text stays crisp). */
function useWidth(fallback: number): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0) setW(Math.round(el.clientWidth));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A clean axis maximum and step for small counts. */
function niceStep(max: number, ticks = 5): number {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) if (max / step <= ticks) return step;
  return 1000;
}

// --- final scores ------------------------------------------------------------------------

interface Breakdown {
  settlements: number;
  cities: number;
  cards: number;
  road: number;
  army: number;
  other: number;
  total: number;
}

function breakdown(view: GameView, p: PlayerId): Breakdown {
  let settlements = 0;
  let cities = 0;
  for (const b of Object.values(view.board.buildings)) {
    if (b.owner !== p) continue;
    if (b.type === 'city') cities += VP.city;
    else settlements += VP.settlement;
  }
  const pl = view.players[p];
  const cards = (pl.devCards ?? []).filter((c) => c.type === 'victoryPoint').length * VP.vpCard;
  const road = view.longestRoute.holder === p ? VP.longestRoute : 0;
  const army = view.largestArmy.holder === p ? VP.largestArmy : 0;
  // island chits, gifts and scenario points (wonders, cloth, ...)
  const other = pl.publicVP - settlements - cities - road - army;
  return { settlements, cities, cards, road, army, other, total: pl.totalVP ?? pl.publicVP + cards };
}

function ScoreTable({
  view,
  colors,
  kinds,
  seat,
  winner,
}: {
  view: GameView;
  colors: PlayerColor[];
  kinds: SeatKind[];
  seat: PlayerId | null;
  winner: PlayerId | null;
}) {
  const sc = getScenario(view.scenario);
  const rows = view.players.map((p) => ({ p: p.id, b: breakdown(view, p.id) }));
  rows.sort((a, b) => (a.p === winner ? -1 : b.p === winner ? 1 : b.b.total - a.b.total));
  const otherLabel = sc.rules.islandBonus ? 'Islands' : 'Special';
  const cols: Array<{ key: keyof Breakdown; icon: string; label: string; show: boolean }> = [
    { key: 'settlements', icon: '🏠', label: 'Settlements', show: true },
    { key: 'cities', icon: '🏙️', label: 'Cities', show: true },
    { key: 'cards', icon: '🃏', label: 'VP cards', show: true },
    { key: 'road', icon: '🛣️', label: sc.rules.ships ? 'Longest trade route' : 'Longest road', show: sc.rules.longestRoute },
    { key: 'army', icon: '⚔️', label: 'Largest army', show: sc.rules.largestArmy },
    { key: 'other', icon: '⭐', label: otherLabel, show: rows.some((r) => r.b.other !== 0) },
  ];
  const shown = cols.filter((c) => c.show);
  return (
    <>
      <div class="gs-scroll">
        <table class="gs-table gs-scores">
          <thead>
            <tr>
              <th class="gs-pcol">Player</th>
              {shown.map((c) => (
                <th key={c.key} title={c.label} aria-label={c.label} class="num">
                  <span aria-hidden="true">{c.icon}</span>
                  <span class="gs-th-text">{c.label}</span>
                </th>
              ))}
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, b }) => (
              <tr key={p} class={p === winner ? 'gs-win' : undefined}>
                <th scope="row" class="gs-pcol">
                  <Who view={view} colors={colors} p={p} line={false} />
                  {p === winner && (
                    <span class="gs-trophy" title="Winner" aria-label="winner">
                      🏆
                    </span>
                  )}
                  {p === seat && <span class="you">you</span>}
                  {kinds[p] === 'bot' && <span class="gs-tag">computer</span>}
                </th>
                {shown.map((c) => (
                  <td key={c.key} class={b[c.key] === 0 ? 'num zero' : 'num'}>
                    {b[c.key] === 0 ? '–' : b[c.key]}
                  </td>
                ))}
                <td class="num gs-total">{b.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="gs-key-line">
        Points from: {shown.map((c) => `${c.icon} ${c.label.toLowerCase()}`).join(' · ')}
        {` · ${view.victoryTarget} VP to win`}
      </p>
    </>
  );
}

// --- highlights ---------------------------------------------------------------------------

function leaders(view: GameView, score: (p: PlayerId) => number): { who: PlayerId[]; value: number } {
  let best = -Infinity;
  let who: PlayerId[] = [];
  for (const p of view.players) {
    const v = score(p.id);
    if (v > best) {
      best = v;
      who = [p.id];
    } else if (v === best) who.push(p.id);
  }
  return { who, value: best };
}

const produced = (ps: PlayerStats) => RESOURCE_LIST.reduce((n, r) => n + ps.produced[r], 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Highlights({ view, colors, stats }: { view: GameView; colors: PlayerColor[]; stats: Stats | null }) {
  const sc = getScenario(view.scenario);
  const tiles: Array<{ label: string; who: PlayerId[]; sub: string }> = [];
  const none = { label: '', who: [] as PlayerId[], sub: '' };
  if (stats) {
    const ps = stats.players;
    const prod = leaders(view, (p) => produced(ps[p]));
    tiles.push({ label: 'Most resources produced', who: prod.who, sub: plural(prod.value, 'card') });
    const trades = leaders(view, (p) => ps[p].trades + ps[p].bankTrades);
    tiles.push(
      trades.value > 0
        ? {
            label: 'Most trades',
            who: trades.who,
            sub: trades.who.length === 1 ? `${ps[trades.who[0]].trades} with players, ${ps[trades.who[0]].bankTrades} with the bank` : plural(trades.value, 'trade'),
          }
        : { ...none, label: 'Most trades', sub: 'No trades this game' },
    );
  }
  if (sc.rules.longestRoute) {
    const label = sc.rules.ships ? 'Longest trade route' : 'Longest road';
    const h = view.longestRoute.holder;
    const longest = Math.max(...view.longestRoute.lengths);
    tiles.push(h !== null ? { label, who: [h], sub: plural(view.longestRoute.lengths[h] ?? 0, 'segment') } : { ...none, label, sub: `Nobody held it (longest: ${longest})` });
  }
  if (sc.rules.largestArmy) {
    const h = view.largestArmy.holder;
    const most = Math.max(...view.players.map((p) => p.playedKnights));
    tiles.push(
      h !== null
        ? { label: 'Biggest army', who: [h], sub: plural(view.players[h].playedKnights, 'knight') }
        : { ...none, label: 'Biggest army', sub: `Nobody held it (most: ${plural(most, 'knight')})` },
    );
  }
  if (stats) {
    const ps = stats.players;
    // dice production against what the numbers they sat on should have given
    const luck = (p: PlayerId) => (ps[p].expected36 > 0 ? (36 * produced(ps[p])) / ps[p].expected36 - 1 : -Infinity);
    const lucky = leaders(view, luck);
    if (lucky.value > -Infinity) {
      const p = lucky.who[0];
      const pct = Math.round(lucky.value * 100);
      tiles.push({
        label: 'Luckiest roller',
        who: lucky.who,
        sub: `${produced(ps[p])} cards from the dice, ${Math.round(ps[p].expected36 / 36)} expected (${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%)`,
      });
    }
    const sevens = leaders(view, (p) => ps[p].discarded + ps[p].stolen);
    tiles.push(
      sevens.value > 0
        ? {
            label: 'Unluckiest 7s',
            who: sevens.who,
            sub: sevens.who.length === 1 ? `lost ${ps[sevens.who[0]].discarded} to discards, ${ps[sevens.who[0]].stolen} to thieves` : `lost ${plural(sevens.value, 'card')}`,
          }
        : { ...none, label: 'Unluckiest 7s', sub: 'Nobody lost a card' },
    );
  }
  return (
    <div class="gs-tiles">
      {tiles.map((t) => (
        <div class="gs-tile" key={t.label}>
          <span class="stat-label">{t.label}</span>
          <span class="gs-tile-who">
            {t.who.length === 0 ? '–' : t.who.map((p) => <Who key={p} view={view} colors={colors} p={p} line={false} />)}
          </span>
          <span class="stat-sub">{t.sub}</span>
        </div>
      ))}
      {!stats && <p class="gs-empty gs-span">More highlights were not recorded for this game.</p>}
    </div>
  );
}

// --- VP race: a step line per player ------------------------------------------------------

function VpRace({ view, colors, stats, winner }: { view: GameView; colors: PlayerColor[]; stats: Stats; winner: PlayerId | null }) {
  const [ref, width] = useWidth(360);
  const [focus, setFocus] = useState<number | null>(null);
  const series = stats.players.map((p) => p.vp);
  const n = series.length;
  const last = Math.min(...series.map((s) => s.length)) - 1;
  const top = Math.max(view.victoryTarget, ...series.map((s) => Math.max(...s)));
  const names = view.players.map((p) => p.name);

  // geometry (CSS pixels)
  const H = Math.round(Math.min(330, Math.max(230, width * 0.36)));
  const plotTop = 12;
  const base = H - 22;
  const left = 26;
  const labelChars = Math.min(12, Math.max(...names.map((s) => s.length)));
  const right = 22 + labelChars * 6.6 + 16;
  const plotW = Math.max(60, width - left - right);
  const x = (t: number) => left + (plotW * t) / last;
  const perVP = (base - plotTop) / top;
  const y = (v: number) => base - perVP * v;
  // players level on points would hide each other: nudge each line a pixel or two
  const nudge = Math.min(2.5, perVP / (n + 1));
  const off = (p: number) => (p - (n - 1) / 2) * nudge;
  const yStep = niceStep(top, 5);
  const yTicks: number[] = [];
  for (let v = 0; v <= top; v += yStep) yTicks.push(v);
  const xStep = niceStep(last, Math.max(3, Math.floor(plotW / 60)));
  const xTicks: number[] = [];
  for (let t = 0; t <= last; t += xStep) xTicks.push(t);

  const pathOf = (p: number) => {
    const s = series[p];
    let d = `M${x(0).toFixed(1)} ${(y(s[0]) + off(p)).toFixed(1)}`;
    for (let t = 1; t <= last; t++) {
      if (s[t] !== s[t - 1]) d += `H${x(t).toFixed(1)}V${(y(s[t]) + off(p)).toFixed(1)}`;
    }
    return d + `H${x(last).toFixed(1)}`;
  };
  // draw the winner last, on top
  const order = [...Array(n).keys()].sort((a, b) => (a === winner ? 1 : b === winner ? -1 : a - b));

  // end labels: at each line's final value, pushed apart where they would touch
  const gap = 13;
  const labels = order
    .map((p) => ({ p, at: y(series[p][last]) + off(p), y: y(series[p][last]) + off(p) }))
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
  const overflow = labels.length ? labels[labels.length - 1].y - (base - 2) : 0;
  if (overflow > 0) for (const l of labels) l.y -= overflow;
  for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);

  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * width;
    const t = Math.round(((px - left) / plotW) * last);
    setFocus(Math.max(0, Math.min(last, t)));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const cur = focus ?? last;
      setFocus(Math.max(0, Math.min(last, cur + (e.key === 'ArrowRight' ? step : -step))));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setFocus(e.key === 'Home' ? 0 : last);
    } else if (e.key === 'Escape') setFocus(null);
  };
  const tipRows = focus === null ? [] : [...Array(n).keys()].sort((a, b) => series[b][focus] - series[a][focus] || a - b);
  const tipLeft = focus === null ? 0 : x(focus);
  const tipOnLeft = focus !== null && tipLeft > width / 2;

  return (
    <div class="gs-chart" ref={ref}>
      <div class="gs-legend" aria-hidden="true">
        {[...Array(n).keys()].map((p) => (
          <span key={p}>
            <PlayerKey seat={p} color={colors[p].fill} />
            {names[p]}
          </span>
        ))}
      </div>
      <div class="gs-plot">
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`Victory points after each of ${last} turns. ${order
            .map((p) => `${names[p]} finished with ${series[p][last]}`)
            .join(', ')}. Use the arrow keys to read each turn.`}
          onPointerMove={(e) => pick(e.clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect())}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setFocus(null)}
          onKeyDown={onKey}
          onBlur={() => setFocus(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={left} x2={left + plotW} y1={y(v)} y2={y(v)} class={v === 0 ? 'gs-axis' : 'gs-grid'} />
              <text x={left - 6} y={y(v) + 3.5} class="gs-tick" text-anchor="end">
                {v}
              </text>
            </g>
          ))}
          <line x1={left} x2={left + plotW} y1={y(view.victoryTarget)} y2={y(view.victoryTarget)} class="gs-goal" />
          <text x={left + 4} y={y(view.victoryTarget) - 4} class="gs-goal-text">
            {view.victoryTarget} to win
          </text>
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={base + 16} class="gs-tick" text-anchor="middle">
              {t}
            </text>
          ))}
          {focus !== null && <line x1={x(focus)} x2={x(focus)} y1={plotTop - 6} y2={base} class="gs-cross" />}
          {order.map((p) => (
            <path key={p} d={pathOf(p)} class="gs-line" stroke={colors[p].fill} />
          ))}
          {order.map((p) => (
            <Marker key={p} seat={p} color={colors[p].fill} x={x(last)} y={y(series[p][last]) + off(p)} />
          ))}
          {labels.map((l) => (
            <g key={l.p}>
              {Math.abs(l.y - l.at) > 3 && <path d={`M${x(last) + 7} ${l.at}L${x(last) + 16} ${l.y}`} class="gs-leader" />}
              <text x={x(last) + 18} y={l.y + 4} class="gs-end">
                <tspan class="gs-end-v">{series[l.p][last]}</tspan> {names[l.p].length > labelChars ? `${names[l.p].slice(0, labelChars - 1)}…` : names[l.p]}
              </text>
            </g>
          ))}
          {focus !== null &&
            order.map((p) => <Marker key={`f${p}`} seat={p} color={colors[p].fill} x={x(focus)} y={y(series[p][focus]) + off(p)} r={4} />)}
        </svg>
        {focus !== null && (
          <div class={tipOnLeft ? 'gs-tip left' : 'gs-tip'} style={{ left: `${tipLeft}px` }} role="status">
            <div class="gs-tip-head">{focus === 0 ? 'After the setup' : `After turn ${focus}`}</div>
            {tipRows.map((p) => (
              <div key={p} class="gs-tip-row">
                <PlayerKey seat={p} color={colors[p].fill} />
                <b>{series[p][focus]}</b> <span>{names[p]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details class="dice-table gs-details">
        <summary>Show as a table</summary>
        <VpTable view={view} colors={colors} series={series} last={last} />
      </details>
    </div>
  );
}

/** The turns where someone's points changed, with everyone's points after them. */
function VpTable({ view, colors, series, last }: { view: GameView; colors: PlayerColor[]; series: number[][]; last: number }) {
  const turns: number[] = [];
  for (let t = 0; t <= last; t++) if (t === 0 || t === last || series.some((s) => s[t] !== s[t - 1])) turns.push(t);
  return (
    <div class="gs-scroll gs-tall">
      <table class="gs-table">
        <thead>
          <tr>
            <th>After</th>
            {view.players.map((p) => (
              <th key={p.id} class="num">
                <Who view={view} colors={colors} p={p.id} line={false} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {turns.map((t) => (
            <tr key={t}>
              <th scope="row">{t === 0 ? 'setup' : t === last ? `turn ${t} (end)` : `turn ${t}`}</th>
              {series.map((s, p) => (
                <td key={p} class={t > 0 && s[t] !== s[t - 1] ? 'num changed' : 'num'}>
                  {s[t]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- resources produced: a stacked bar per player -----------------------------------------

function Produced({ view, colors, stats }: { view: GameView; colors: PlayerColor[]; stats: Stats }) {
  const [ref, width] = useWidth(360);
  const [focus, setFocus] = useState<{ p: PlayerId; r: Resource; x: number } | null>(null);
  const ps = stats.players;
  const totals = ps.map(produced);
  const max = Math.max(1, ...totals);
  const rowH = 30;
  const barH = 16;
  const labelW = Math.min(110, Math.max(70, width * 0.26));
  const valueW = 36;
  const barMax = Math.max(40, width - labelW - valueW);
  const H = rowH * ps.length + 4;
  const scale = barMax / max;
  const gapPx = 2;

  return (
    <div class="gs-chart" ref={ref}>
      <div class="gs-legend" aria-hidden="true">
        {RESOURCE_LIST.map((r) => (
          <span key={r}>
            <span class="gs-swatch" style={{ background: RESOURCE_INFO[r].color }} />
            <ResGlyph r={r} />
            {RESOURCE_INFO[r].label}
          </span>
        ))}
      </div>
      <div class="gs-plot">
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`Resources produced: ${view.players.map((p) => `${p.name} ${totals[p.id]}`).join(', ')}`}>
          <line x1={labelW} x2={labelW} y1={0} y2={H} class="gs-axis" />
          {ps.map((s, p) => {
            const cy = rowH * p + rowH / 2 + 2;
            let x0 = labelW;
            const parts = RESOURCE_LIST.filter((r) => s.produced[r] > 0);
            return (
              <g key={p}>
                <Marker seat={p} color={colors[p].fill} x={8} y={cy} r={4} />
                <text x={18} y={cy + 4} class="gs-rowlabel">
                  {clip(view.players[p].name, Math.floor((labelW - 24) / 7))}
                </text>
                {parts.map((r, i) => {
                  const w = s.produced[r] * scale;
                  const lastPart = i === parts.length - 1;
                  const drawW = Math.max(0.5, lastPart ? w : w - gapPx);
                  const xs = x0;
                  x0 += w;
                  const rr = lastPart ? Math.min(4, drawW / 2) : 0;
                  const top = cy - barH / 2;
                  const d = `M${xs} ${top}H${xs + drawW - rr}Q${xs + drawW} ${top} ${xs + drawW} ${top + rr}V${top + barH - rr}Q${xs + drawW} ${top + barH} ${xs + drawW - rr} ${top + barH}H${xs}Z`;
                  const on = focus?.p === p && focus.r === r;
                  return (
                    <g key={r} class={on ? 'gs-seg on' : 'gs-seg'}>
                      <path d={d} fill={RESOURCE_INFO[r].color} />
                      {drawW >= 17 && <ResGlyph r={r} x={xs + drawW / 2} y={cy} size={12} />}
                      <rect
                        x={xs}
                        y={cy - rowH / 2}
                        width={Math.max(w, 6)}
                        height={rowH}
                        class="gs-hit"
                        onPointerEnter={() => setFocus({ p, r, x: xs + w / 2 })}
                        onPointerLeave={() => setFocus((f) => (f?.p === p && f.r === r ? null : f))}
                        onClick={() => setFocus({ p, r, x: xs + w / 2 })}
                      />
                    </g>
                  );
                })}
                <text x={x0 + 6} y={cy + 4} class="gs-value">
                  {totals[p]}
                </text>
              </g>
            );
          })}
        </svg>
        {focus && (
          <div
            class="gs-tip bar"
            style={{
              // above the bar, or below it for the first row (the legend is above)
              top: `${focus.p === 0 ? rowH + 4 : rowH * focus.p - 30}px`,
              left: `${Math.min(width - 100, Math.max(100, focus.x))}px`,
            }}
            role="status"
          >
            <b>{ps[focus.p].produced[focus.r]}</b> {RESOURCE_INFO[focus.r].label.toLowerCase()} · {view.players[focus.p].name}
            <span class="gs-tip-sub"> of {totals[focus.p]} produced</span>
          </div>
        )}
      </div>
      <details class="dice-table gs-details">
        <summary>Show as a table</summary>
        <div class="gs-scroll">
          <table class="gs-table">
            <thead>
              <tr>
                <th>Player</th>
                {RESOURCE_LIST.map((r) => (
                  <th key={r} class="num" title={RESOURCE_INFO[r].label}>
                    <ResGlyph r={r} />
                  </th>
                ))}
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {ps.map((s, p) => (
                <tr key={p}>
                  <th scope="row">
                    <Who view={view} colors={colors} p={p} line={false} />
                  </th>
                  {RESOURCE_LIST.map((r) => (
                    <td key={r} class="num">
                      {s.produced[r]}
                    </td>
                  ))}
                  <td class="num gs-total">{totals[p]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

// --- cards and trades: one row per counter, one column per player -------------------------

function Ledger({ view, colors, stats }: { view: GameView; colors: PlayerColor[]; stats: Stats }) {
  const sc = getScenario(view.scenario);
  const ps = stats.players;
  const rows: Array<{ icon: string; label: string; get(s: PlayerStats): number; show?: boolean; best?: 'high' }> = [
    { icon: '🎲', label: 'From the dice', get: produced, best: 'high' },
    { icon: '🤝', label: 'Player trades', get: (s) => s.trades, best: 'high' },
    { icon: '📥', label: 'Cards from trades', get: (s) => s.tradeIn },
    { icon: '🏦', label: 'Bank trades', get: (s) => s.bankTrades, best: 'high' },
    { icon: '🥷', label: 'Stole from others', get: (s) => s.stole, best: 'high' },
    { icon: '💸', label: 'Lost to thieves', get: (s) => s.stolen },
    { icon: '🗑️', label: 'Discarded on 7s', get: (s) => s.discarded },
    { icon: '🏴‍☠️', label: 'Lost to pirates', get: (s) => s.lost, show: ps.some((s) => s.lost > 0) },
    { icon: '🔨', label: 'Spent building', get: (s) => s.spent },
    { icon: '🃏', label: 'Dev. cards bought', get: (s) => s.devBought },
    { icon: '▶️', label: 'Dev. cards played', get: (s) => s.devPlayed },
    { icon: '⚔️', label: 'Knights played', get: (s) => s.knights, show: sc.rules.largestArmy },
  ];
  return (
    <div class="gs-scroll">
      <table class="gs-table gs-ledger">
        <thead>
          <tr>
            <th />
            {view.players.map((p) => (
              <th key={p.id} class="num gs-colhead">
                <PlayerKey seat={p.id} color={colors[p.id].fill} line={false} />
                <span class="gs-name">{p.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((r) => r.show !== false)
            .map((row) => {
              const vals = ps.map(row.get);
              const top = Math.max(...vals);
              return (
                <tr key={row.label}>
                  <th scope="row">
                    <span aria-hidden="true">{row.icon}</span> {row.label}
                  </th>
                  {vals.map((v, p) => (
                    <td key={p} class={row.best === 'high' && v === top && v > 0 ? 'num lead' : 'num'}>
                      {v}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}


// --- time: how long the game took, and who took it --------------------------------------------

function TimeStats({ view, colors, kinds, seat, time }: { view: GameView; colors: PlayerColor[]; kinds: SeatKind[]; seat: PlayerId | null; time: ClockSummary }) {
  const [focus, setFocus] = useState<PlayerId | null>(null);
  const players = view.players.map((p) => p.id);
  const total = time.playedMs;
  const pct = (p: PlayerId) => `${total > 0 ? Math.round((100 * time.perPlayerMs[p]) / total) : 0}%`;
  const turns = time.turnCount.reduce((a, b) => a + b, 0);
  const turnMs = time.turnMs.reduce((a, b) => a + b, 0);
  const avg = (p: PlayerId) => averageTurn(time, p);
  const bot = (p: PlayerId) => kinds[p] === 'bot';
  // fastest and slowest: the shortest and longest average turn (players who had a turn)
  const paced = players.filter((p) => avg(p) !== null).sort((a, b) => avg(a)! - avg(b)!);
  const fastest = paced.length >= 2 ? paced[0] : null;
  const slowest = paced.length >= 2 ? paced[paced.length - 1] : null;
  const most = Math.max(1, ...time.perPlayerMs);
  const longest = time.longest;
  const who = (p: PlayerId) => (
    <>
      <Who view={view} colors={colors} p={p} line={false} />
      {bot(p) && <span class="gs-tag">computer</span>}
    </>
  );
  const pace = (p: PlayerId) => `${formatDuration(avg(p)!)} a turn`;
  return (
    <div class="tm">
      <div class="gs-tiles tm-tiles">
        <div class="gs-tile tm-hero">
          <span class="stat-label">Game time</span>
          <span class="tm-value big">{formatDuration(total)}</span>
          <span class="stat-sub">
            active play · {plural(turns, 'turn')} · {plural(view.players.length, 'player')}
          </span>
        </div>
        <div class="gs-tile">
          <span class="stat-label">Average turn</span>
          <span class="tm-value">{turns > 0 ? formatDuration(turnMs / turns) : '–'}</span>
          <span class="stat-sub">{turns > 0 ? `over ${plural(turns, 'turn')}` : 'No turns yet'}</span>
        </div>
        <div class="gs-tile">
          <span class="stat-label">Longest turn</span>
          <span class="tm-value">{longest ? formatDuration(longest.ms) : '–'}</span>
          <span class="stat-sub tm-who">{longest ? <>{who(longest.player)} · turn {longest.turn}</> : 'No turns yet'}</span>
        </div>
        <div class="gs-tile">
          <span class="stat-label">Fastest player</span>
          <span class="gs-tile-who">{fastest !== null ? who(fastest) : '–'}</span>
          <span class="stat-sub">{fastest !== null ? pace(fastest) : 'Needs two players with a turn'}</span>
        </div>
        <div class="gs-tile">
          <span class="stat-label">Slowest player</span>
          <span class="gs-tile-who">{slowest !== null ? who(slowest) : '–'}</span>
          <span class="stat-sub">{slowest !== null ? pace(slowest) : 'Needs two players with a turn'}</span>
        </div>
      </div>

      <div class="gs-chart tm-chart" role="group" aria-label="Time per player">
        <p class="tm-cap">Time per player and share of the game</p>
        {players.map((p) => {
          const on = focus === p;
          const a = avg(p);
          return (
            <div
              key={p}
              class={on ? 'tm-row on' : 'tm-row'}
              tabIndex={0}
              aria-label={`${view.players[p].name}${bot(p) ? ' (computer)' : ''}: ${formatDuration(time.perPlayerMs[p])}, ${pct(p)} of the game${a !== null ? `, ${formatDuration(a)} a turn` : ''}`}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setFocus(p)}
              onPointerLeave={() => setFocus((f) => (f === p ? null : f))}
              onClick={() => setFocus(p)}
              onFocus={() => setFocus(p)}
              onBlur={() => setFocus((f) => (f === p ? null : f))}
            >
              <span class="tm-label">
                <span class="tm-name">
                  <Who view={view} colors={colors} p={p} line={false} />
                  {p === seat && <span class="you">you</span>}
                  {bot(p) && <span class="gs-tag">computer</span>}
                </span>
                <span class="tm-pace">{a !== null ? pace(p) : 'no turns yet'}</span>
              </span>
              <span class="tm-track">
                <span class="tm-bar" style={{ width: `calc((100% - 5.6em) * ${(time.perPlayerMs[p] / most).toFixed(4)})`, background: colors[p].fill }} />
                <span class="tm-tip">
                  <b>{formatClock(time.perPlayerMs[p])}</b> {pct(p)}
                </span>
              </span>
              {on && (
                <span class="gs-tip tm-pop" role="status">
                  <b>{formatDuration(time.perPlayerMs[p])}</b> · {pct(p)} of the game
                  <br />
                  {plural(time.turnCount[p], 'turn')}
                  {a !== null ? `, ${formatDuration(a)} on average` : ''}
                  {bot(p) ? ' (computer)' : ''}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <details class="dice-table gs-details">
        <summary>Show as a table</summary>
        <div class="gs-scroll">
          <table class="gs-table tm-table">
            <thead>
              <tr>
                <th>Player</th>
                <th class="num">Time</th>
                <th class="num">Share</th>
                <th class="num">Turns</th>
                <th class="num">Average</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p}>
                  <th scope="row">{who(p)}</th>
                  <td class="num">{formatClock(time.perPlayerMs[p])}</td>
                  <td class="num">{pct(p)}</td>
                  <td class="num">{time.turnCount[p]}</td>
                  <td class="num">{avg(p) !== null ? formatClock(avg(p)!) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p class="gs-key-line">
        A player's time is the time on their turns, setup placements included: while others discard on a 7 or answer their trade offer,
        it still counts for them. The clock stops while the game is hidden or closed (online: it runs while the host's page is open).
        Computer players' times are their real pace, set by the computer speed.
      </p>
    </div>
  );
}
