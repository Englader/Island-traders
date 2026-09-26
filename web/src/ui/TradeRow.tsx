import type { Resource } from 'engine';
import type { ComponentChildren } from 'preact';
import { RESOURCE_INFO, RESOURCE_LIST } from '../game/names';
import { countsPhrase, rowSides, signed, stepRow, stepSize, stepValue, type BoxRule, type SignedCounts } from '../game/trade';
import { ResourceCard } from './cards';

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg class="tbox-chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d={up ? 'M5 15.5 L12 8.5 L19 15.5' : 'M5 8.5 L12 15.5 L19 8.5'} />
    </svg>
  );
}

function Lock() {
  return (
    <svg class="tbox-lock" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7.5" rx="1.6" />
      <path d="M5.2 7 V5 a2.8 2.8 0 0 1 5.6 0 V7" fill="none" />
    </svg>
  );
}

function upLabel(name: string, v: number, rule: BoxRule): string {
  const n = stepSize(v, 1, rule);
  return v < 0 ? `Give ${n === 1 ? 'one' : n} fewer ${name}` : `Get one more ${name}`;
}

function downLabel(name: string, v: number, rule: BoxRule): string {
  const n = stepSize(v, -1, rule);
  return v > 0 ? `Get one fewer ${name}` : `Give ${n === 1 ? 'one' : n} more ${name}`;
}

/**
 * The trade builder: the five resources side by side, each a small box with
 * ▲ (get one more) above the card and ▼ (give one more) below it. The number
 * in between is signed: +n you get, −n you give. With a `lot` (bank and
 * harbor rates), ▼ gives a whole lot per tap.
 */
export function TradeRow({
  row,
  rules,
  notes,
  onChange,
}: {
  row: SignedCounts;
  rules: Record<Resource, BoxRule>;
  /** A small note under each box (the bank rates), with an extra class (`r3`, `r2`). */
  notes?: Record<Resource, { text: string; tone?: string }>;
  onChange(row: SignedCounts): void;
}) {
  return (
    <div class={notes ? 'trow with-notes' : 'trow'}>
      {RESOURCE_LIST.map((r) => {
        const name = RESOURCE_INFO[r].label;
        const rule = rules[r];
        const v = row[r] ?? 0;
        const state = v > 0 ? 'get' : v < 0 ? 'give' : 'zero';
        const said = v > 0 ? `you get ${v}` : v < 0 ? `you give ${-v}` : 'none';
        return (
          <div class="tcol" key={r}>
            <div
              class={`tbox ${state}${rule.locked ? ' locked' : ''}`}
              role="group"
              aria-label={`${name}: ${said}${rule.locked ? ', set by the offer' : ''}`}
              data-res={r}
              data-value={v}
            >
              <button
                type="button"
                class="tbox-btn up"
                aria-label={upLabel(name, v, rule)}
                disabled={stepValue(v, 1, rule) === null}
                onClick={() => onChange(stepRow(row, r, 1, rule))}
              >
                <Chevron up />
              </button>
              <span class="tbox-card">
                <ResourceCard r={r} look="tile" />
                {rule.locked && <Lock />}
              </span>
              <span class="tbox-val" key={v} aria-hidden="true">
                <span class="tbox-n">{signed(v)}</span>
                <span class="tbox-side">{v > 0 ? 'get' : v < 0 ? 'give' : ' '}</span>
              </span>
              <button
                type="button"
                class="tbox-btn down"
                aria-label={downLabel(name, v, rule)}
                disabled={stepValue(v, -1, rule) === null}
                onClick={() => onChange(stepRow(row, r, -1, rule))}
              >
                <Chevron />
              </button>
            </div>
            {notes && <span class={notes[r].tone ? `tnote ${notes[r].tone}` : 'tnote'}>{notes[r].text}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** One line under the row: "You give 1 brick · You get 2 wool", or `tip` while it is empty. */
export function TradeSummary({ row, tip }: { row: SignedCounts; tip: ComponentChildren }) {
  const { give, get } = rowSides(row);
  const gives = Object.keys(give).length > 0;
  const gets = Object.keys(get).length > 0;
  return (
    <p class="tsum" id="trade-sum" aria-live="polite">
      {!gives && !gets && <span class="tsum-tip">{tip}</span>}
      {gives && (
        <span class="tsum-give">
          You give <b>{countsPhrase(give)}</b>
        </span>
      )}
      {gives && gets && (
        <span class="tsum-dot" aria-hidden="true">
          {' · '}
        </span>
      )}
      {gets && (
        <span class="tsum-get">
          You get <b>{countsPhrase(get)}</b>
        </span>
      )}
    </p>
  );
}
