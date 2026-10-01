import { type Action, type Card, type CardCounts, type GameView, type PlayerId, type ProgressCardName, type Resource } from 'engine';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { PROGRESS_TEXT, TRACK_INFO, TRACK_LIST } from '../game/ck';
import { CARD_INFO, CARD_LIST, COMMODITY_LIST, RESOURCE_LIST, handOfView, progressTitle } from '../game/names';
import {
  harborOffers,
  kindPicks,
  playerPicks,
  playsOf,
  rollPreview,
  rollPreviewLines,
  turnChips,
  type ChoiceAction,
  type PlayAction,
} from '../game/progress';
import type { PlayerColor } from '../game/seats';
import { rowCount, rowSides, type SignedCounts } from '../game/trade';
import { ResourceCard } from './cards';
import { GateGlyph, ProgressCardView } from './ckArt';
import { Die, ResIcon, Sheet, cleanCounts } from './common';
import { ForcedSheet, PickCards } from './sheets';

/*
 * Playing your own progress cards (Cities & Knights, part 4b): the sheets in
 * which a card's choices are made before it is played (a player, a kind of
 * card, the Alchemist's dice), the bar over the board while a spot is picked,
 * the choices that follow a card (what the Spy and the Master Merchant see,
 * the Commercial Harbor's offers) and the chips of the cards in play this
 * turn. The engine's legal moves decide what can be picked.
 */

const nameOf = (view: GameView, p: PlayerId, seat: PlayerId | null) => (p === seat ? 'You' : view.players[p]?.name ?? `Player ${p + 1}`);

function opponents(view: GameView, p: PlayerId): PlayerId[] {
  const n = view.players.length;
  return Array.from({ length: n - 1 }, (_, i) => (p + 1 + i) % n);
}

/** The card at the top of a sheet: its face, its rule and what to do now. */
export function CardLead({ card, hint }: { card: ProgressCardName; hint: string }) {
  return (
    <div class="play-lead">
      <span class="play-lead-card">
        <ProgressCardView card={card} look="mini" />
      </span>
      <span class="play-lead-text">
        <strong>{progressTitle(card)}</strong>
        <span>{PROGRESS_TEXT[card]}</span>
        <span class="play-lead-hint">{hint}</span>
      </span>
    </div>
  );
}

// --- choices made before the card is played ---------------------------------------------------

const PLAYER_HINT: Partial<Record<ProgressCardName, string>> = {
  deserter: 'Pick the player who loses a knight.',
  spy: 'Pick whose progress cards you look at.',
  masterMerchant: 'Pick a player with more points: you see their hand and take 2.',
};

/** The Deserter, the Spy and the Master Merchant: pick the opponent. Players the card can't reach say why. */
export function PlayerPickSheet({
  view,
  seat,
  colors,
  card,
  legal,
  onPick,
  onCancel,
}: {
  view: GameView;
  seat: PlayerId;
  colors: PlayerColor[];
  card: ProgressCardName;
  legal: Action[];
  onPick(a: PlayAction): void;
  onCancel(): void;
}) {
  const picks = new Map(playerPicks(view, playsOf(legal, card)).map((x) => [x.p, x]));
  const mine = view.players[seat]?.publicVP ?? 0;
  const why = (p: PlayerId) => {
    if (card === 'spy') return 'No progress cards';
    if (card === 'deserter') return 'No knights';
    if ((view.players[p]?.publicVP ?? 0) <= mine) return `${view.players[p]?.publicVP ?? 0} VP: not more than you`;
    return 'No cards in hand';
  };
  const title = progressTitle(card);
  return (
    <Sheet title={`${title}: pick a player`} onClose={onCancel}>
      <CardLead card={card} hint={PLAYER_HINT[card] ?? 'Pick a player.'} />
      <div class="pick-players">
        {opponents(view, seat).map((p) => {
          const x = picks.get(p);
          return (
            <button
              type="button"
              key={p}
              class="pp-btn"
              disabled={!x}
              onClick={() => x && onPick(x.action)}
              style={{ '--pc': colors[p]?.fill, '--pcs': colors[p]?.stroke } as Record<string, string>}
              data-player={p}
            >
              <span class="pp-avatar">{view.players[p]?.name.slice(0, 1).toUpperCase()}</span>
              <span class="pp-text">
                <b>{view.players[p]?.name}</b>
                <small>{x ? x.detail : why(p)}</small>
              </span>
              <span class="pp-go" aria-hidden="true">
                ›
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" class="wide" onClick={onCancel}>
        Keep the card
      </button>
    </Sheet>
  );
}

const KIND_HINT: Partial<Record<ProgressCardName, string>> = {
  merchantFleet: 'Pick the card you trade 2:1 with the bank for the rest of this turn.',
  resourceMonopoly: 'Name a resource: every other player gives you 2 of it.',
  tradeMonopoly: 'Name a commodity: every other player gives you 1 of it.',
};

/** Merchant Fleet and the Monopolies: pick the kind of card. */
export function KindPickSheet({
  view,
  seat,
  card,
  legal,
  onPick,
  onCancel,
}: {
  view: GameView;
  seat: PlayerId;
  card: ProgressCardName;
  legal: Action[];
  onPick(a: PlayAction): void;
  onCancel(): void;
}) {
  const picks = kindPicks(view, seat, playsOf(legal, card));
  const kinds: Card[] = card === 'resourceMonopoly' ? RESOURCE_LIST : card === 'tradeMonopoly' ? COMMODITY_LIST : CARD_LIST;
  const hand = handOfView(view, seat);
  const verb = card === 'merchantFleet' ? 'Trade' : 'Name';
  return (
    <Sheet title={`${progressTitle(card)}: pick a card`} onClose={onCancel}>
      <CardLead card={card} hint={KIND_HINT[card] ?? ''} />
      <div class={kinds.length > 5 ? 'res-choice kind-pick eight' : kinds.length === 3 ? 'res-choice kind-pick three' : 'res-choice kind-pick'}>
        {kinds.map((k) => {
          const x = picks.find((y) => y.k === k);
          return (
            <button type="button" key={k} class="res-btn" disabled={!x} onClick={() => x && onPick(x.action)} aria-label={`${verb} ${CARD_INFO[k].label}`} data-kind={k}>
              <ResIcon r={k} n={hand[k] ?? 0} />
              <span class="rate">{CARD_INFO[k].label}</span>
              {card === 'merchantFleet' && <span class="kind-rate">{x ? `${x.rate}:1 → 2:1` : '2:1 already'}</span>}
            </button>
          );
        })}
      </div>
      <p class="hint">The number on each card is how many you hold.</p>
      <button type="button" class="wide" onClick={onCancel}>
        Keep the card
      </button>
    </Sheet>
  );
}

/**
 * The Alchemist, before the roll: pick the white and the red die, with what
 * the total would bring everyone and which progress cards the red die would
 * draw if the event die shows a city gate.
 */
export function AlchemistSheet({
  view,
  seat,
  legal,
  onPick,
  onCancel,
}: {
  view: GameView;
  seat: PlayerId;
  legal: Action[];
  onPick(a: PlayAction): void;
  onCancel(): void;
}) {
  const [white, setWhite] = useState<number | null>(null);
  const [red, setRed] = useState<number | null>(null);
  const plays = playsOf(legal, 'alchemist');
  const action = white && red ? plays.find((a) => (a.args?.dice as number[] | undefined)?.[0] === white && (a.args?.dice as number[])[1] === red) : undefined;
  const pv = white && red ? rollPreview(view, [white, red]) : null;
  const lines = pv ? rollPreviewLines(view, seat, pv) : null;
  // which totals pay you, for a start
  const pays = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]
    .map((t) => {
      const w = Math.max(1, t - 6);
      const got = rollPreview(view, [w, t - w]).gets.find((g) => g.p === seat);
      return { t, n: got ? Object.values(got.cards).reduce((a, b) => a + (b ?? 0), 0) : 0 };
    })
    .filter((x) => x.n > 0);
  const dieRow = (label: string, value: number | null, set: (n: number) => void, isRed: boolean) => (
    <div class="alc-row" role="radiogroup" aria-label={label}>
      <span class="alc-l">{label}</span>
      <span class="alc-dice">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <button
            type="button"
            key={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${label} ${n}`}
            class={value === n ? 'alc-die on' : 'alc-die'}
            onClick={() => set(n)}
          >
            <Die n={n} red={isRed} />
          </button>
        ))}
      </span>
    </div>
  );
  return (
    <Sheet title="Alchemist: choose the dice" onClose={onCancel}>
      <CardLead card="alchemist" hint="Choose both production dice instead of rolling them. The event die is still rolled, and resolved first." />
      {dieRow('White die', white, setWhite, false)}
      {dieRow('Red die', red, setRed, true)}
      <p class="hint alc-pays">
        {pays.length > 0 ? (
          <>
            Numbers that pay you:{' '}
            {pays.map((x, i) => (
              <span key={x.t}>
                {i > 0 ? ' · ' : ''}
                <b>{x.t}</b> ({x.n} card{x.n === 1 ? '' : 's'})
              </span>
            ))}
          </>
        ) : (
          'No number pays you right now.'
        )}
      </p>
      {pv && lines ? (
        <div class="alc-preview" aria-live="polite">
          <div class={pv.seven ? 'alc-total seven' : 'alc-total'}>
            <b>{pv.total}</b>
            <span class="alc-total-dice">
              <Die n={white!} />
              <Die n={red!} red />
            </span>
          </div>
          <ul class="alc-lines">
            {lines.produce.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p class="alc-sub">If the event die shows a city gate (red {red}):</p>
          <ul class="alc-draws">
            {TRACK_LIST.map((t, i) => (
              <li key={t}>
                <GateGlyph track={t} /> <b>{TRACK_INFO[t].label}:</b> {lines.draws[i].replace(/^[A-Z][a-z]+ gate: /, '')}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p class="hint alc-empty">Pick both dice to see what they bring.</p>
      )}
      <button type="button" class="primary wide" disabled={!action} onClick={() => action && onPick(action)}>
        {action ? `Use ${white} and ${red}` : 'Pick both dice'}
      </button>
      <button type="button" class="wide" onClick={onCancel}>
        Keep the card
      </button>
    </Sheet>
  );
}

// --- choices that follow a card -----------------------------------------------------------------------

/** The Spy: the opponent's progress cards (shown to you only); take one, or none. */
export function SpyTakeSheet({ view, legal, seat, send, covered }: { view: GameView; legal: Action[]; seat: PlayerId; send(a: Action): void; covered?: boolean }) {
  const ph = view.phase;
  if (ph.kind !== 'ck' || ph.step !== 'card' || ph.card !== 'spy' || ph.player !== seat) return null;
  const cards = ((ph.data as { cards?: ProgressCardName[] } | undefined)?.cards ?? []) as ProgressCardName[];
  const who = view.players[ph.target ?? 0]?.name ?? 'Your opponent';
  const take = (c: ProgressCardName) => legal.find((a): a is ChoiceAction => a.type === 'progressChoice' && a.args?.card === c);
  const none = legal.find((a): a is ChoiceAction => a.type === 'progressChoice' && !a.args);
  const title = `Spy: ${who}'s cards`;
  return (
    <ForcedSheet
      title={title}
      covered={covered}
      back="Back to the cards"
      bar={
        <>
          <b>{title}</b>
          <small>Take one, or none</small>
        </>
      }
    >
      <p class="pick-lead">
        {who} holds {cards.length} progress card{cards.length === 1 ? '' : 's'}
      </p>
      <p class="hint pick-note">Only you see them. Take one if you like: it joins your hand.</p>
      <div class="spy-cards">
        {cards.map((c, i) => {
          const a = take(c);
          return (
            <div class="spy-card" key={`${c}${i}`} data-card={c}>
              <span class="spy-face">
                <ProgressCardView card={c} text />
              </span>
              <button type="button" class="primary" disabled={!a} onClick={() => a && send(a)} aria-label={`Take ${progressTitle(c)}`}>
                Take
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" class="wide" disabled={!none} onClick={() => none && send(none)}>
        Take nothing
      </button>
    </ForcedSheet>
  );
}

/** The Master Merchant: the richer player's hand (shown to you only); take 2 of your choice. */
export function MasterMerchantSheet({ view, seat, send, covered }: { view: GameView; seat: PlayerId; send(a: Action): void; covered?: boolean }) {
  const ph = view.phase;
  const [row, setRow] = useState<SignedCounts>({});
  if (ph.kind !== 'ck' || ph.step !== 'card' || ph.card !== 'masterMerchant' || ph.player !== seat) return null;
  const theirs = ((ph.data as { hand?: CardCounts } | undefined)?.hand ?? {}) as CardCounts;
  const size = CARD_LIST.reduce((n, k) => n + (theirs[k] ?? 0), 0);
  const need = Math.min(2, size);
  const who = view.players[ph.target ?? 0]?.name ?? 'Your opponent';
  const picked = rowCount(row);
  const title = `Take ${need} from ${who}`;
  return (
    <ForcedSheet
      title={title}
      covered={covered}
      back="Back to the hand"
      bar={
        <>
          <b>Master Merchant</b>
          <small>
            {picked} of {need} picked
          </small>
        </>
      }
    >
      <p class="pick-lead">{who}'s hand</p>
      <div class="mm-hand" aria-label={`${who}'s hand`}>
        {CARD_LIST.filter((k) => (theirs[k] ?? 0) > 0).map((k) => (
          <span key={k} class="mm-card" title={`${CARD_INFO[k].label}: ${theirs[k]}`} data-kind={k}>
            <ResourceCard r={k} look="mini" />
            <b>{theirs[k]}</b>
          </span>
        ))}
      </div>
      <p class="hint pick-note">Only you see it. ▲ takes a card into your hand.</p>
      <PickCards hand={handOfView(view, seat)} row={row} need={need} limit={theirs} sign={1} kinds={CARD_LIST} onChange={setRow} />
      <button
        type="button"
        class="primary wide"
        disabled={picked !== need}
        onClick={() => send({ type: 'progressChoice', player: seat, args: { cards: cleanCounts(rowSides(row).get) } })}
      >
        {picked === need ? `Take ${need} card${need === 1 ? '' : 's'}` : `Take ${picked}/${need}`}
      </button>
    </ForcedSheet>
  );
}

/** What came of a Commercial Harbor offer to `to`, from the log lines you may see. */
function harborResult(view: GameView, seat: PlayerId, to: PlayerId): string | null {
  const me = view.players[seat]?.name;
  const them = view.players[to]?.name;
  for (let i = view.log.length - 1; i >= 0; i--) {
    const m = view.log[i].msg;
    if (m.startsWith('---')) break;
    if (m === `${me} trades a resource to ${them} for a commodity`) {
      const detail = /^\(.+ gave 1 (\w+) for 1 (\w+)\)$/.exec(view.log[i + 1]?.msg ?? '');
      return detail ? `Your ${detail[1]} for their ${detail[2]}` : 'Traded';
    }
  }
  return null;
}

/**
 * The Commercial Harbor, after it is played: offer each opponent who holds
 * a commodity one of your resources; they give you a commodity of their
 * choice for it (their answer is #24's sheet, or the computer's).
 */
export function HarborOfferSheet({
  view,
  legal,
  seat,
  colors,
  send,
  close,
}: {
  view: GameView;
  legal: Action[];
  seat: PlayerId;
  colors: PlayerColor[];
  send(a: Action): void;
  close(): void;
}) {
  const [pick, setPick] = useState<Record<number, Resource>>({});
  const offers = harborOffers(legal);
  const eff = view.ck?.turnEffects.find((e) => e.player === seat && e.effect === 'commercialHarbor');
  const offered = ((eff?.data as { offered?: PlayerId[] } | undefined)?.offered ?? []) as PlayerId[];
  const ph = view.phase;
  const asking = ph.kind === 'ck' && ph.step === 'card' && ph.card === 'commercialHarbor' ? (ph.target ?? null) : null;
  const hand = view.players[seat]?.resources;
  const anyResource = RESOURCE_LIST.some((r) => (hand?.[r] ?? 0) > 0);
  return (
    <Sheet title="Commercial Harbor: your offers" onClose={close}>
      <CardLead card="commercialHarbor" hint="Offer each opponent one of your resources, face down: they must give you a commodity of their choice for it." />
      {!eff && <p class="hint">Playing the card…</p>}
      <div class="harbor-rows">
        {opponents(view, seat).map((q) => {
          const acts = offers.get(q) ?? [];
          const count = view.ck?.players[q]?.commodityCount ?? 0;
          const name = view.players[q]?.name ?? '';
          const done = offered.includes(q);
          const status = done
            ? asking === q
              ? `${name} is choosing a commodity…`
              : (harborResult(view, seat, q) ?? 'Offer made')
            : count === 0
              ? 'No commodities: nothing to offer for'
              : !anyResource
                ? 'You have no resource to offer'
                : acts.length === 0
                  ? asking !== null
                    ? 'Wait for the offer in progress'
                    : 'No offer possible now'
                  : null;
          const chosen = pick[q];
          const a = chosen ? acts.find((x) => x.args?.resource === chosen) : undefined;
          return (
            <div key={q} class={done ? 'harbor-row done' : 'harbor-row'} style={{ '--pc': colors[q]?.fill } as Record<string, string>} data-player={q}>
              <span class="hr-who">
                <span class="pp-avatar small">{name.slice(0, 1).toUpperCase()}</span>
                <b>{name}</b>
                <small>
                  {count} commodit{count === 1 ? 'y' : 'ies'}
                </small>
              </span>
              {status ? (
                <span class={done ? 'hr-status ok' : 'hr-status'}>{status}</span>
              ) : (
                <>
                  <span class="hr-res">
                    {RESOURCE_LIST.map((r) => {
                      const ok = acts.some((x) => x.args?.resource === r);
                      return (
                        <button
                          type="button"
                          key={r}
                          class={chosen === r ? 'res-btn on' : 'res-btn'}
                          disabled={!ok}
                          aria-pressed={chosen === r}
                          aria-label={`Offer ${CARD_INFO[r].label} to ${name}`}
                          onClick={() => setPick({ ...pick, [q]: r })}
                        >
                          <ResIcon r={r} n={hand?.[r] ?? 0} />
                        </button>
                      );
                    })}
                  </span>
                  <button type="button" class="primary hr-send" disabled={!a} onClick={() => a && send(a)}>
                    {chosen ? `Offer 1 ${chosen} to ${name}` : 'Pick a resource'}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" class="wide" onClick={close}>
        Done
      </button>
    </Sheet>
  );
}

// --- over the board -------------------------------------------------------------------------------------

/** The bar over the board while a card's spot is picked: the card, what to tap, and the way out. */
export function CardBar({ card, text, children, onCancel }: { card: ProgressCardName; text: string; children?: ComponentChildren; onCancel?: () => void }) {
  return (
    <div class="confirm-bar card-bar" role="group" aria-label={progressTitle(card)} data-card={card}>
      <span class="cb-head">
        <span class="cb-card" aria-hidden="true">
          <ProgressCardView card={card} look="mini" />
        </span>
        <span class="cb-text">
          <b>{progressTitle(card)}</b>
          <small>{text}</small>
        </span>
      </span>
      <div class="confirm-buttons">
        {children}
        {onCancel && (
          <button type="button" onClick={onCancel} aria-label="Cancel" title="Keep the card">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/** Cards in play this turn (Crane, Merchant Fleet, Commercial Harbor, Warlord), as small chips by the action panel. */
export function TurnChips({ view, seat, onHarbor }: { view: GameView; seat: PlayerId | null; onHarbor(): void }) {
  const chips = turnChips(view);
  if (chips.length === 0) return null;
  return (
    <div class="turn-chips" role="list" aria-label="Cards in play this turn">
      {chips.map((c) => {
        const who = nameOf(view, c.player, seat);
        const body = (
          <>
            <span class="tc-card" aria-hidden="true">
              <ProgressCardView card={c.card} look="mini" />
            </span>
            <span class="tc-text">
              <b>{c.label}</b> <span>{c.detail}</span>
            </span>
          </>
        );
        const title = `${who === 'You' ? 'Your' : `${who}'s`} ${c.label}: ${c.detail}`;
        return c.card === 'commercialHarbor' && c.player === seat ? (
          <button type="button" key={c.key} class="turn-chip" role="listitem" onClick={onHarbor} title={`${title}. Tap to make your offers`} data-chip={c.key}>
            {body}
          </button>
        ) : (
          <span key={c.key} class="turn-chip" role="listitem" title={title} data-chip={c.key}>
            {body}
          </span>
        );
      })}
    </div>
  );
}
