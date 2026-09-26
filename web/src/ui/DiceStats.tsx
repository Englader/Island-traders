import type { DiceRoll, GameView, PlayerId } from 'engine';
import { useState } from 'preact/hooks';
import type { PlayerColor } from '../game/seats';
import { Sheet } from './common';

/** Ways to roll each total with two dice (out of 36). */
const WAYS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
const SUMS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Games saved before rolls were recorded: read them back from the log. */
function rollsOf(view: GameView): DiceRoll[] {
  if (view.rolls.length > 0) return view.rolls;
  const out: DiceRoll[] = [];
  for (const e of view.log) {
    const m = /^(.+) rolls \d+ \((\d)\+(\d)\)$/.exec(e.msg);
    if (!m) continue;
    const p = view.players.find((x) => x.name === m[1]);
    if (p) out.push({ by: p.id, dice: [Number(m[2]), Number(m[3])], turn: e.turn });
  }
  return out;
}

/** A clean axis maximum and step (1, 2, 5, 10, …) for the counts. */
function niceAxis(max: number): { top: number; step: number } {
  const target = Math.max(1, max);
  for (const step of [1, 2, 5, 10, 20, 50, 100]) {
    if (target / step <= 5) return { top: Math.ceil(target / step) * step, step };
  }
  return { top: Math.ceil(target / 200) * 200, step: 200 };
}

const pct = (n: number, d: number) => (d === 0 ? '0%' : `${Math.round((100 * n) / d)}%`);

/**
 * How often each total has come up, for everyone or for one player, next to
 * what fair dice would give on average.
 */
export function DiceStatsSheet({
  view,
  colors,
  player,
  close,
}: {
  view: GameView;
  colors: PlayerColor[];
  player: PlayerId | null;
  close(): void;
}) {
  const [who, setWho] = useState<PlayerId | null>(player);
  const [focus, setFocus] = useState<number | null>(null);
  const all = rollsOf(view);
  const rolls = who === null ? all : all.filter((r) => r.by === who);
  const n = rolls.length;
  const counts = Array<number>(13).fill(0);
  for (const r of rolls) counts[r.dice[0] + r.dice[1]]++;
  const expected = (sum: number) => (n * WAYS[sum]) / 36;
  const most = Math.max(...SUMS.map((x) => counts[x]));
  const mostRolled = SUMS.filter((x) => counts[x] === most && most > 0);
  const { top, step } = niceAxis(Math.max(most, expected(7)));
  const color = who === null ? 'var(--accent)' : colors[who].fill;

  // chart geometry (viewBox units)
  const W = 340;
  const H = 190;
  const left = 26;
  const right = 6;
  const plotTop = 18;
  const base = H - 24;
  const band = (W - left - right) / SUMS.length;
  const barW = Math.min(24, band - 2);
  const y = (v: number) => base - ((base - plotTop) * v) / top;
  const cx = (i: number) => left + band * i + band / 2;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  return (
    <Sheet title="Dice statistics" onClose={close} wide>
      <div class="chips dice-who" role="tablist" aria-label="Whose rolls">
        <button type="button" class={who === null ? 'chip on' : 'chip'} onClick={() => setWho(null)}>
          Everyone
        </button>
        {view.players.map((p) => (
          <button type="button" key={p.id} class={who === p.id ? 'chip on' : 'chip'} onClick={() => setWho(p.id)}>
            <span class="dot" style={{ background: colors[p.id].fill, borderColor: colors[p.id].stroke }} /> {p.name}
          </button>
        ))}
      </div>

      <div class="stat-tiles">
        <div class="stat-tile">
          <span class="stat-label">Rolls</span>
          <span class="stat-value">{n}</span>
        </div>
        <div class="stat-tile">
          <span class="stat-label">Most rolled</span>
          <span class="stat-value">{mostRolled.length ? mostRolled.join(', ') : '–'}</span>
        </div>
        <div class="stat-tile">
          <span class="stat-label">Sevens</span>
          <span class="stat-value">{counts[7]}</span>
          <span class="stat-sub">about {expected(7).toFixed(1)} expected</span>
        </div>
      </div>

      {n === 0 ? (
        <p class="hint">No rolls yet{who === null ? '' : ` for ${view.players[who].name}`}.</p>
      ) : (
        <div class="dice-chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`How often each total was rolled${who === null ? '' : ` by ${view.players[who].name}`}`}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} class={v === 0 ? 'axis' : 'grid'} />
                <text x={left - 6} y={y(v) + 3.5} class="tick" text-anchor="end">
                  {v}
                </text>
              </g>
            ))}
            {SUMS.map((sum, i) => {
              const h = base - y(counts[sum]);
              const x0 = cx(i) - barW / 2;
              const r = Math.min(4, h);
              const e = y(expected(sum));
              return (
                <g key={sum} class={focus === sum ? 'col on' : 'col'}>
                  {h > 0 && (
                    <path
                      d={`M${x0} ${base} V${base - h + r} Q${x0} ${base - h} ${x0 + r} ${base - h} H${x0 + barW - r} Q${x0 + barW} ${base - h} ${x0 + barW} ${base - h + r} V${base} Z`}
                      fill={color}
                      class="bar"
                    />
                  )}
                  <line x1={x0 - 2} x2={x0 + barW + 2} y1={e} y2={e} class="expected" />
                  {counts[sum] === most && most > 0 && (
                    <text x={cx(i)} y={base - h - 5} class="cap" text-anchor="middle">
                      {counts[sum]}
                    </text>
                  )}
                  <text x={cx(i)} y={base + 15} class={sum === 7 ? 'xlabel seven' : 'xlabel'} text-anchor="middle">
                    {sum}
                  </text>
                  {/* the whole column is the tap / hover target */}
                  <rect
                    x={left + band * i}
                    y={plotTop - 10}
                    width={band}
                    height={base - plotTop + 26}
                    class="hit"
                    onPointerEnter={() => setFocus(sum)}
                    onPointerLeave={() => setFocus((f) => (f === sum ? null : f))}
                    onClick={() => setFocus(sum)}
                  />
                </g>
              );
            })}
          </svg>
          {focus !== null && (
            <div class="dice-tip" style={{ left: `${(cx(SUMS.indexOf(focus)) / W) * 100}%` }}>
              <strong>{focus}</strong>: rolled {counts[focus]} time{counts[focus] === 1 ? '' : 's'} ({pct(counts[focus], n)})
              <br />
              fair dice: about {expected(focus).toFixed(1)} ({pct(WAYS[focus], 36)})
            </div>
          )}
          <div class="dice-legend">
            <span>
              <span class="key-bar" style={{ background: color }} /> Rolled
            </span>
            <span>
              <span class="key-line" /> Expected with fair dice
            </span>
          </div>
        </div>
      )}

      <details class="dice-table">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Total</th>
              <th>Rolled</th>
              <th>Expected</th>
            </tr>
          </thead>
          <tbody>
            {SUMS.map((sum) => (
              <tr key={sum}>
                <td>{sum}</td>
                <td>
                  {counts[sum]} ({pct(counts[sum], n)})
                </td>
                <td>
                  {expected(sum).toFixed(1)} ({pct(WAYS[sum], 36)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p class="hint">
        Each roll is two fair six-sided dice, so a 7 comes up 6 times in 36 and a 2 or 12 once in 36. Over a single game the counts can
        stray a long way from that.
      </p>
    </Sheet>
  );
}
