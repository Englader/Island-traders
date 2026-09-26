import type { ComponentChildren } from 'preact';
import type { PartialCounts, Resource } from 'engine';
import { RESOURCE_INFO, RESOURCE_LIST } from '../game/names';
import { ResGlyph } from './icons';

export function Sheet({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose?: () => void;
  children: ComponentChildren;
  wide?: boolean;
}) {
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <section class={wide ? 'sheet wide' : 'sheet'} role="dialog" aria-label={title}>
        <header class="sheet-head">
          <h2>{title}</h2>
          {onClose && (
            <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          )}
        </header>
        <div class="sheet-body">{children}</div>
      </section>
    </div>
  );
}

export function Stepper({
  value,
  min = 0,
  max,
  step = 1,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max: number;
  step?: number;
  onChange(v: number): void;
  label?: string;
}) {
  return (
    <div class="stepper" aria-label={label}>
      <button type="button" disabled={value - step < min} onClick={() => onChange(value - step)} aria-label="less">
        −
      </button>
      <span class="stepper-value">{value}</span>
      <button type="button" disabled={value + step > max} onClick={() => onChange(value + step)} aria-label="more">
        +
      </button>
    </div>
  );
}

export function ResIcon({ r, n }: { r: Resource; n?: number }) {
  const info = RESOURCE_INFO[r];
  return (
    <span class={`res res-${r}`} title={info.label}>
      <span class="res-icon">
        <ResGlyph r={r} />
      </span>
      {n !== undefined && <span class="res-n">{n}</span>}
    </span>
  );
}

export function Cost({ cost }: { cost: PartialCounts }) {
  return (
    <span class="cost">
      {RESOURCE_LIST.flatMap((r) => Array.from({ length: cost[r] ?? 0 }, (_, i) => <ResGlyph key={`${r}${i}`} r={r} />))}
    </span>
  );
}

/** Per-resource steppers, each bounded by `max[r]`. */
export function ResourcePicker({
  value,
  max,
  onChange,
  step,
}: {
  value: PartialCounts;
  max: PartialCounts;
  onChange(v: PartialCounts): void;
  step?: PartialCounts;
}) {
  return (
    <div class="res-picker">
      {RESOURCE_LIST.map((r) => (
        <div class="res-picker-row" key={r}>
          <ResIcon r={r} />
          <span class="res-label">{RESOURCE_INFO[r].label}</span>
          <Stepper
            label={RESOURCE_INFO[r].label}
            value={value[r] ?? 0}
            max={max[r] ?? 0}
            step={step?.[r] ?? 1}
            onChange={(v) => onChange({ ...value, [r]: v })}
          />
        </div>
      ))}
    </div>
  );
}

export function sumCounts(c: PartialCounts): number {
  return RESOURCE_LIST.reduce((n, r) => n + (c[r] ?? 0), 0);
}

export function cleanCounts(c: PartialCounts): PartialCounts {
  const out: PartialCounts = {};
  for (const r of RESOURCE_LIST) if ((c[r] ?? 0) > 0) out[r] = c[r];
  return out;
}

const PIP_LAYOUT: Record<number, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.28, 0.24],
    [0.72, 0.24],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.76],
    [0.72, 0.76],
  ],
};

/** Just the pips of a die face (the rolling dice draw their own faces). */
export function DiePips({ n }: { n: number }) {
  return (
    <svg class="die-pips" viewBox="0 0 1 1" aria-hidden="true">
      {(PIP_LAYOUT[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.09" class="die-pip" />
      ))}
    </svg>
  );
}

export function Die({ n, red }: { n: number; red?: boolean }) {
  return (
    <svg class={red ? 'die red' : 'die'} viewBox="0 0 1 1" aria-label={`die ${n}`}>
      <rect x="0.03" y="0.03" width="0.94" height="0.94" rx="0.18" class="die-face" />
      {(PIP_LAYOUT[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="0.09" class="die-pip" />
      ))}
    </svg>
  );
}
