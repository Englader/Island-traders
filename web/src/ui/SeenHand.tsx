import type { Card, GameView, PlayerId, SeenRange } from 'engine';
import { useMemo } from 'preact/hooks';
import { handSplit } from '../game/ck';
import { CARD_INFO, cardKindsOf } from '../game/names';
import type { PlayerColor } from '../game/seats';
import { seenOfView } from '../game/seen';
import { ResGlyph } from './icons';

/** How a range reads on its chip: "2", "1–3", "2+", "0–1", or "?" when nothing is known. */
export function rangeText(r: SeenRange): string {
  if (r.max === r.min) return String(r.min);
  if (r.min > 0) return r.max - r.min <= 2 ? `${r.min}–${r.max}` : `${r.min}+`;
  return r.max <= 2 ? `0–${r.max}` : '?';
}

function rangeSaid(r: SeenRange): string {
  if (r.max === 0) return 'none';
  if (r.max === r.min) return `${r.min}`;
  if (r.min > 0) return `at least ${r.min}, at most ${r.max}`;
  return r.max <= 2 ? `at most ${r.max}` : 'not seen';
}

/**
 * Another player's hand as this seat can know it: the card count (resources
 * and commodities apart in Cities & Knights), the victory points, and per
 * kind what was seen of it, from public events only (web/src/game/seen.ts).
 * With `onAsk` a kind is a button: it adds one of those cards to what you ask for.
 */
export function SeenHand({
  view,
  seat,
  p,
  colors,
  onAsk,
}: {
  view: GameView;
  seat: PlayerId;
  p: PlayerId;
  colors: PlayerColor[];
  /** Asks for one more card of a kind; null where the kind can't be asked for now. */
  onAsk?: (r: Card) => (() => void) | null;
}) {
  const seen = useMemo(() => seenOfView(view, seat)[p], [view, seat, p]);
  const pl = view.players[p];
  if (!pl || !seen) return null;
  const split = handSplit(view, p);
  const name = pl.name;
  const kinds = cardKindsOf(view);
  const color = colors[p];
  return (
    <section class="seen" aria-label={`${name}'s hand`}>
      <div class="seen-head">
        <span class="dot" style={{ background: color?.fill, borderColor: color?.stroke }} />
        <b>{name}</b>
        <span class="seen-count">
          {pl.resourceCount} card{pl.resourceCount === 1 ? '' : 's'}
          {split && (
            <span class="seen-split">
              {' '}
              ({split.resources} res · {split.commodities} com)
            </span>
          )}
        </span>
        <span class="seen-vp">
          {pl.publicVP} VP
        </span>
      </div>
      <div class={kinds.length > 5 ? 'seen-row cards8' : 'seen-row'} role="group" aria-label={`Seen in ${name}'s hand`}>
        {kinds.map((r) => {
          const range = seen.cards[r] ?? { min: 0, max: 0 };
          const ask = onAsk && range.max > 0 ? onAsk(r) : null;
          const text = rangeText(range);
          const said = `${CARD_INFO[r].label}: ${rangeSaid(range)}`;
          const cls = `seen-chip${range.max === 0 ? ' none' : range.min > 0 ? ' some' : ''}${text === '?' ? ' unknown' : ''}`;
          const body = (
            <>
              <ResGlyph r={r} />
              <span class="seen-n">{range.max === 0 ? '0' : text}</span>
            </>
          );
          return ask ? (
            <button type="button" key={r} class={cls} data-res={r} onClick={ask} aria-label={`${said}. Ask ${name} for one`} title={`${said}. Tap to ask for one`}>
              {body}
            </button>
          ) : (
            <span key={r} class={cls} data-res={r} role="img" aria-label={said} title={said}>
              {body}
            </span>
          );
        })}
      </div>
      <p class="seen-note">
        How many of each {name} can hold, from what everyone saw: rolls, trades, builds, steals
        {seen.unknown > 0 ? ` · ${seen.unknown} card${seen.unknown === 1 ? '' : 's'} unseen` : ''}
        {onAsk ? ' · tap a card to ask for it' : ''}
      </p>
    </section>
  );
}
