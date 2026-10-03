import {
  COSTS,
  KNIGHTS_PER_LEVEL,
  MAX_CITY_WALLS,
  cardRates,
  getScenario,
  tradeRates,
  type Action,
  type Card,
  type CardCounts,
  type DevCardType,
  type GameState,
  type GameView,
  type PlayerId,
  type Resource,
  type TradeOffer,
} from 'engine';
import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CARD_INFO, CARD_LIST, DEV_INFO, RESOURCE_INFO, RESOURCE_LIST, WONDER_INFO, bankOfView, cardKindsOf, countsText, handOfView, harborLabel } from '../game/names';
import { KNIGHT_COST, WALL_COST, sevenLimitOf } from '../game/ck';
import type { PlayerColor } from '../game/seats';
import { Cost, ResIcon, Sheet, cleanCounts, sumCounts } from './common';
import { Counts } from './icons';
import { DevCardView, ResourceCard } from './cards';
import { TradeRow, TradeSummary, type RowVerbs } from './TradeRow';
import { LogLine, logItems } from './GameLog';
import { bankCheck, countsPhrase, pickRules, rowCount, rowKind, rowOf, rowSides, signed, type BoxRule, type SignedCounts } from '../game/trade';

export interface SheetProps {
  view: GameView;
  legal: Action[];
  seat: PlayerId;
  colors: PlayerColor[];
  send(a: Action): void;
  close(): void;
}

const has = (legal: Action[], type: Action['type']) => legal.some((a) => a.type === type);

function nameOf(view: GameView, p: PlayerId): string {
  return view.players[p]?.name ?? `Player ${p + 1}`;
}

function Dot({ color }: { color: PlayerColor }) {
  return <span class="dot" style={{ background: color.fill, borderColor: color.stroke }} />;
}

// --- build -----------------------------------------------------------------------

export type BuildPiece = 'road' | 'ship' | 'settlement' | 'city' | 'knight' | 'wall';

export function BuildSheet({
  view,
  legal,
  seat,
  close,
  choose,
  buyDev,
  improve,
}: SheetProps & {
  choose(p: BuildPiece): void;
  /** Buys a development card (after asking, if the menu says to), then closes the sheet. */
  buyDev(): void;
  /** Cities & Knights: opens the city improvements. */
  improve?: () => void;
}) {
  const ships = getScenario(view.scenario).rules.ships;
  const me = view.players[seat];
  const ck = view.ck;
  const basicLeft = KNIGHTS_PER_LEVEL - Object.values(ck?.knights ?? {}).filter((k) => k.owner === seat && k.level === 1).length;
  const items: Array<{ key: BuildPiece | 'dev'; label: string; cost: CardCounts; ok: boolean; left?: number }> = [
    { key: 'road', label: 'Road', cost: COSTS.road, ok: has(legal, 'buildRoad'), left: me?.supply.roads },
    ...(ships ? [{ key: 'ship' as const, label: 'Ship', cost: COSTS.ship, ok: has(legal, 'buildShip'), left: me?.supply.ships }] : []),
    { key: 'settlement', label: 'Settlement', cost: COSTS.settlement, ok: has(legal, 'buildSettlement'), left: me?.supply.settlements },
    { key: 'city', label: 'City', cost: COSTS.city, ok: has(legal, 'buildCity'), left: me?.supply.cities },
    ...(ck
      ? [
          { key: 'knight' as const, label: 'Knight (basic)', cost: KNIGHT_COST, ok: has(legal, 'buildKnight'), left: basicLeft },
          { key: 'wall' as const, label: 'City wall', cost: WALL_COST, ok: has(legal, 'buildCityWall'), left: MAX_CITY_WALLS - (ck.players[seat]?.walls.length ?? 0) },
        ]
      : [{ key: 'dev' as const, label: 'Development card', cost: COSTS.devCard, ok: has(legal, 'buyDevCard'), left: view.devDeckCount }]),
  ];
  return (
    <Sheet title="Build" onClose={close}>
      <div class="build-list">
        {items.map((it) => (
          <button
            type="button"
            key={it.key}
            class="build-item"
            disabled={!it.ok}
            onClick={() => (it.key === 'dev' ? buyDev() : choose(it.key))}
          >
            <span class="build-name">{it.label}</span>
            <Cost cost={it.cost} />
            <span class="build-left">{it.left !== undefined ? `${it.left} left` : ''}</span>
          </button>
        ))}
      </div>
      {ck && improve && (
        <button type="button" class="wide build-improve" onClick={improve}>
          City improvements…
        </button>
      )}
      <p class="hint">Greyed out: not enough cards, no pieces left, or no legal spot.{ck ? ' Knights are activated and moved with the Knights button.' : ''}</p>
    </Sheet>
  );
}

// --- trade -----------------------------------------------------------------------

/**
 * The player's cards, one tile per resource with the count. With `change`
 * (cards being discarded, or taken) each tile counts what will be left,
 * marked with the change, and underneath says what was held before.
 */
function YourCards({ hand, change, kinds = RESOURCE_LIST }: { hand: CardCounts; change?: SignedCounts; kinds?: Card[] }) {
  return (
    <div class={change ? 'your-cards picking' : 'your-cards'} role="group" aria-label="Your cards">
      <span class="your-cards-label">Your cards</span>
      <div class={kinds.length > 5 ? 'your-cards-row cards8' : 'your-cards-row'}>
        {kinds.map((r) => {
          const held = hand[r] ?? 0;
          const d = change?.[r] ?? 0;
          const after = held + d;
          const name = CARD_INFO[r].label;
          const said = d < 0 ? `${name}: you hold ${held}, discard ${-d}, keep ${after}` : d > 0 ? `${name}: you hold ${held}, take ${d}, then ${after}` : `${name}: ${held}`;
          return (
            <span key={r} class={d < 0 ? 'yc out' : d > 0 ? 'yc in' : 'yc'} data-res={r} role="img" aria-label={said} title={said}>
              <ResourceCard r={r} n={after} look="tile" empty={after === 0} />
              {d !== 0 && (
                <span class="yc-delta" key={d}>
                  {signed(d)}
                </span>
              )}
              {change && <span class="yc-was">{d !== 0 ? `${held} → ${after}` : '\u00a0'}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** How a player's offer reads to others, including open offers. */
function offerText(t: TradeOffer, view: GameView, seat: PlayerId): ComponentChildren {
  if (t.from === seat) {
    if (t.open === 'give')
      return (
        <>
          You want <Counts c={t.get} />: what will they give?
        </>
      );
    if (t.open === 'get')
      return (
        <>
          You give <Counts c={t.give} />: what will they give for it?
        </>
      );
    return (
      <>
        You give <Counts c={t.give} /> for <Counts c={t.get} />
      </>
    );
  }
  const who = nameOf(view, t.from);
  if (t.open === 'give')
    return (
      <>
        {who} wants <Counts c={t.get} />. What would you like for it?
      </>
    );
  if (t.open === 'get')
    return (
      <>
        {who} gives <Counts c={t.give} />. What will you give for it?
      </>
    );
  // a counter-offer to the player's own offer says so
  const counters = t.replyTo !== undefined && view.turn.trades.some((x) => x.id === t.replyTo && x.from === seat && !x.open);
  return (
    <>
      {who} {counters ? 'counters: gives' : 'gives'} <Counts c={t.give} /> for your <Counts c={t.get} />
    </>
  );
}

/** The most cards of one kind a player can ask another player for. */
const MAX_ASK = 9;

/** Can this player give what the row gives? */
function affordable(row: SignedCounts, hand: CardCounts): boolean {
  return CARD_LIST.every((r) => -(row[r] ?? 0) <= (hand[r] ?? 0));
}

/** Box rules for a trade with players: give up to what you hold, ask for up to MAX_ASK. */
function playerRules(hand: CardCounts): Record<Card, BoxRule> {
  const out = {} as Record<Card, BoxRule>;
  for (const r of CARD_LIST) out[r] = { min: -(hand[r] ?? 0), max: MAX_ASK };
  return out;
}

/**
 * The send button. While the row is empty the summary line above says what
 * to do; `why` explains any other reason it can't be pressed yet.
 */
function SendButton({ disabled, why, onClick, children }: { disabled: boolean; why: string | null; onClick(): void; children: ComponentChildren }) {
  return (
    <div class="tsend">
      {why && (
        <p class="twhy" id="trade-why">
          {why}
        </p>
      )}
      <button type="button" class="primary wide" disabled={disabled} aria-describedby={why ? 'trade-sum trade-why' : 'trade-sum'} onClick={onClick}>
        {children}
      </button>
    </div>
  );
}

export function TradeSheet({ view, legal, seat, colors, send, close }: SheetProps) {
  const hand = handOfView(view, seat);
  const kinds = cardKindsOf(view);
  const bankCards = bankOfView(view);
  // Cities & Knights: commodities trade 4:1, 3:1 at a generic harbor, 2:1 with the Merchant Guild (never at the 2:1 resource harbors)
  const rates: Partial<Record<Card, number>> = useMemo(
    () => (view.ck ? cardRates(view as unknown as GameState, seat) : tradeRates(view as unknown as GameState, seat)),
    [view, seat],
  );
  const canBank = has(legal, 'bankTrade') || (view.phase.kind === 'main' && view.turn.actor === seat && !(view.options.tradeBuildMode === 'separate' && view.turn.buildingStarted));
  const domestic =
    view.phase.kind === 'main' &&
    view.turn.actor === seat &&
    view.turn.role === 'active' &&
    !(view.options.tradeBuildMode === 'separate' && view.turn.buildingStarted);
  const [tab, setTab] = useState<'bank' | 'players'>(domestic ? 'players' : 'bank');

  // bank: ▼ gives a lot at the resource's rate, ▲ takes one card from the bank
  const [bankRow, setBankRow] = useState<SignedCounts>({});
  const bankRules = {} as Record<Card, BoxRule>;
  const rateNotes = {} as Record<Card, { text: string; tone?: string }>;
  for (const r of kinds) {
    const rate = rates[r] ?? 4;
    bankRules[r] = { min: -Math.floor((hand[r] ?? 0) / rate) * rate, max: bankCards[r] ?? 0, lot: rate };
    rateNotes[r] = { text: `${rate}:1`, tone: rate < 4 ? `r${rate}` : undefined };
  }
  const bank = bankCheck(bankRow, rates);
  const bankWhy = !canBank
    ? 'You can trade with the bank during your turn, after rolling.'
    : bank.lots === 0 && bank.cards === 0
      ? null
      : bank.lots > bank.cards
        ? `That pays for ${bank.lots} card${bank.lots === 1 ? '' : 's'}: pick ${bank.lots - bank.cards} more (▲)`
        : bank.cards > bank.lots
          ? `Give more (▼) to pay for ${bank.cards} card${bank.cards === 1 ? '' : 's'}`
          : !affordable(bankRow, hand)
            ? "You don't have those cards"
            : null;

  // players
  const [offerRow, setOfferRow] = useState<SignedCounts>({});
  const others = view.players.filter((p) => p.id !== seat).map((p) => p.id);
  const [to, setTo] = useState<PlayerId[]>(others);
  const mine = view.turn.trades.filter((t) => t.from === seat);
  const openIds = new Set(mine.filter((t) => t.open).map((t) => t.id));
  // answers to an open offer are listed under it; other counter-offers on their own
  const counters = view.turn.trades.filter((t) => t.from !== seat && t.to.includes(seat) && !(t.replyTo !== undefined && openIds.has(t.replyTo)));
  const answers = (id: number) => view.turn.trades.filter((t) => t.replyTo === id && t.from !== seat);
  const kind = rowKind(offerRow);
  const offerWhy = kind === 'empty' ? null : to.length === 0 ? 'Choose who to offer to' : !affordable(offerRow, hand) ? "You don't have those cards" : null;
  const accept = (t: TradeOffer) => (
    <>
      <button
        type="button"
        class="primary"
        disabled={!legal.some((a) => a.type === 'acceptTrade' && a.tradeId === t.id)}
        onClick={() => send({ type: 'acceptTrade', player: seat, tradeId: t.id })}
      >
        Accept
      </button>
      <button type="button" onClick={() => send({ type: 'rejectTrade', player: seat, tradeId: t.id })}>
        No thanks
      </button>
    </>
  );

  return (
    <Sheet title="Trade" onClose={close} wide>
      <YourCards hand={hand} kinds={kinds} />
      {domestic && (
        <div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'players'} class={tab === 'players' ? 'tab on' : 'tab'} onClick={() => setTab('players')}>
            Players {counters.length > 0 ? `(${counters.length})` : ''}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'bank'} class={tab === 'bank' ? 'tab on' : 'tab'} onClick={() => setTab('bank')}>
            Bank & harbors
          </button>
        </div>
      )}
      {tab === 'bank' || !domestic ? (
        <div class="bank-trade">
          <TradeRow row={bankRow} rules={bankRules} notes={rateNotes} kinds={kinds} onChange={setBankRow} />
          <TradeSummary row={bankRow} tip="▼ gives cards at the rate shown · ▲ takes a card" />
          <SendButton
            disabled={!canBank || !bank.ok || !affordable(bankRow, hand)}
            why={bankWhy}
            onClick={() => {
              const { give, get } = rowSides(bankRow);
              send({ type: 'bankTrade', player: seat, give, get });
              setBankRow({});
            }}
          >
            Trade with the bank
          </SendButton>
        </div>
      ) : (
        <div class="player-trade">
          <TradeRow row={offerRow} rules={playerRules(hand)} kinds={kinds} onChange={setOfferRow} />
          <TradeSummary row={offerRow} tip="▲ a card you want · ▼ a card you give" />
          <div class="tto" role="group" aria-label="Offer to">
            <span class="tto-label">Offer to</span>
            {others.map((p) => (
              <button
                type="button"
                key={p}
                class={to.includes(p) ? 'chip on' : 'chip'}
                aria-pressed={to.includes(p)}
                onClick={() => setTo(to.includes(p) ? to.filter((x) => x !== p) : [...to, p])}
              >
                <Dot color={colors[p]} /> {nameOf(view, p)}
              </button>
            ))}
          </div>
          <SendButton
            disabled={kind === 'empty' || offerWhy !== null}
            why={offerWhy}
            onClick={() => {
              const { give, get } = rowSides(offerRow);
              send({ type: 'proposeTrade', player: seat, give, get, to, ...(kind === 'offer' ? {} : { open: true }) });
              setOfferRow({});
            }}
          >
            {kind === 'give' || kind === 'get' ? 'Ask for offers' : 'Make offer'}
          </SendButton>
          {counters.length > 0 && (
            <div class="offers">
              <h3>Offers to you</h3>
              {counters.map((t) => (
                <OfferRow key={t.id} t={t} view={view} colors={colors} seat={seat}>
                  {accept(t)}
                </OfferRow>
              ))}
            </div>
          )}
          {mine.length > 0 && (
            <div class="offers">
              <h3>Your offers</h3>
              {mine.map((t) => (
                <OfferRow key={t.id} t={t} view={view} colors={colors} seat={seat}>
                  {t.accepted.map((p) => (
                    <button type="button" class="primary" key={p} onClick={() => send({ type: 'confirmTrade', player: seat, tradeId: t.id, partner: p })}>
                      Trade with {nameOf(view, p)}
                    </button>
                  ))}
                  {t.open && (
                    <div class="answers">
                      {answers(t.id).length === 0 ? (
                        <p class="hint">Waiting for offers…</p>
                      ) : (
                        answers(t.id).map((c) => (
                          <div class="answer" key={c.id}>
                            <span class="answer-text">
                              <Dot color={colors[c.from]} /> {nameOf(view, c.from)} gives <Counts c={c.give} /> for your <Counts c={c.get} />
                            </span>
                            <span class="answer-actions">{accept(c)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  <button type="button" onClick={() => send({ type: 'cancelTrade', player: seat, tradeId: t.id })}>
                    Withdraw
                  </button>
                </OfferRow>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function OfferRow({
  t,
  view,
  colors,
  seat,
  children,
}: {
  t: TradeOffer;
  view: GameView;
  colors: PlayerColor[];
  seat: PlayerId;
  children: ComponentChildren;
}) {
  const mineOffer = t.from === seat;
  const answered = (p: PlayerId) => view.turn.trades.some((c) => c.replyTo === t.id && c.from === p);
  return (
    <div class={t.open ? 'offer open' : 'offer'}>
      <div class="offer-text">
        {!mineOffer && <Dot color={colors[t.from]} />} {offerText(t, view, seat)}
      </div>
      {mineOffer && (
        <div class="offer-status">
          {t.to.map((p) => (
            <span key={p} class="status-chip">
              <Dot color={colors[p]} /> {nameOf(view, p)}:{' '}
              {t.accepted.includes(p) ? '✅ yes' : answered(p) ? (t.open ? '💬 made an offer' : '💬 countered') : t.rejected.includes(p) ? '❌ no' : '… waiting'}
            </span>
          ))}
        </div>
      )}
      <div class="offer-actions">{children}</div>
    </div>
  );
}

/**
 * The rules for a counter-offer's row, from the answering player's side. An
 * open offer fixes one side and the engine wants it kept exactly: "who gives
 * me 1 brick?" locks the brick this player gives and leaves only asking for
 * something in return; "what will you give for my wool?" locks the wool this
 * player gets and leaves only giving.
 */
function counterRules(t: TradeOffer, hand: CardCounts): Record<Card, BoxRule> {
  const locked = t.open === 'give' ? rowOf(t.get, {}) : t.open === 'get' ? rowOf({}, t.give) : {};
  const out = {} as Record<Card, BoxRule>;
  for (const r of CARD_LIST) {
    const v = locked[r];
    if (v !== undefined) out[r] = { min: v, max: v, locked: true };
    else if (t.open === 'give') out[r] = { min: 0, max: MAX_ASK };
    else if (t.open === 'get') out[r] = { min: -(hand[r] ?? 0), max: 0 };
    else out[r] = { min: -(hand[r] ?? 0), max: MAX_ASK };
  }
  return out;
}

/** A player answers the active player's offer: accept, decline, or make a counter-offer. */
export function RespondSheet({ view, legal, seat, colors, send }: Omit<SheetProps, 'close'>) {
  const offers = view.turn.trades.filter((t) => t.to.includes(seat) && t.from === view.turn.actor && !t.accepted.includes(seat) && !t.rejected.includes(seat));
  const [counter, setCounter] = useState<TradeOffer | null>(null);
  const [row, setRow] = useState<SignedCounts>({});
  const hand = handOfView(view, seat);
  const kinds = cardKindsOf(view);
  if (offers.length === 0) return null;
  if (counter) {
    const { give, get } = rowSides(row);
    const gives = sumCounts(give) > 0;
    const gets = sumCounts(get) > 0;
    const why = !gets
      ? counter.open === 'give'
        ? 'Pick what you want for it (▲)'
        : 'Pick what you want (▲)'
      : !gives
        ? counter.open === 'get'
          ? 'Pick what you give for it (▼)'
          : 'Pick what you give (▼)'
        : !affordable(row, hand)
          ? "You don't have those cards"
          : null;
    return (
      <Sheet title={counter.open ? `Your offer to ${nameOf(view, counter.from)}` : `Counter-offer to ${nameOf(view, counter.from)}`} onClose={() => setCounter(null)} wide>
        <YourCards hand={hand} kinds={kinds} />
        <p class="tctx">
          <Dot color={colors[counter.from]} /> {offerText(counter, view, seat)}
        </p>
        <TradeRow row={row} rules={counterRules(counter, hand)} kinds={kinds} onChange={setRow} />
        <TradeSummary row={row} tip="▲ a card you want · ▼ a card you give" />
        <SendButton
          disabled={why !== null}
          why={why}
          onClick={() => {
            send({ type: 'proposeTrade', player: seat, give, get, to: [counter.from], replyTo: counter.id });
            setCounter(null);
          }}
        >
          Send offer
        </SendButton>
      </Sheet>
    );
  }
  return (
    <Sheet title="Trade offer">
      <YourCards hand={hand} kinds={kinds} />
      {offers.map((t) => (
        <OfferRow key={t.id} t={t} view={view} colors={colors} seat={seat}>
          {t.open ? (
            <button
              type="button"
              class="primary"
              disabled={t.open === 'give' && !CARD_LIST.every((r) => (t.get[r] ?? 0) <= (hand[r] ?? 0))}
              onClick={() => {
                setRow(t.open === 'give' ? rowOf(t.get, {}) : rowOf({}, t.give));
                setCounter(t);
              }}
            >
              Make an offer…
            </button>
          ) : (
            <>
              <button
                type="button"
                class="primary"
                disabled={!legal.some((a) => a.type === 'acceptTrade' && a.tradeId === t.id)}
                onClick={() => send({ type: 'acceptTrade', player: seat, tradeId: t.id })}
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => {
                  // the same trade from this side: give what they ask for, get what they give
                  setRow(rowOf(t.get, t.give));
                  setCounter(t);
                }}
              >
                Counter…
              </button>
            </>
          )}
          <button type="button" onClick={() => send({ type: 'rejectTrade', player: seat, tradeId: t.id })}>
            No thanks
          </button>
        </OfferRow>
      ))}
    </Sheet>
  );
}

// --- development cards --------------------------------------------------------------

export function CardsSheet({ view, legal, seat, send, close }: SheetProps) {
  const me = view.players[seat];
  const cards = me.devCards ?? [];
  const counts = new Map<DevCardType, { total: number; fresh: number }>();
  for (const c of cards) {
    const e = counts.get(c.type) ?? { total: 0, fresh: 0 };
    e.total++;
    if (c.boughtPart === view.turn.part) e.fresh++;
    counts.set(c.type, e);
  }
  const [picking, setPicking] = useState<'monopoly' | 'yop' | null>(null);
  const [yop, setYop] = useState<SignedCounts>({});
  const yopNeed = Math.min(2, RESOURCE_LIST.reduce((n, r) => n + view.bank[r], 0));
  const hand = me.resources!;

  if (picking === 'monopoly') {
    return (
      <Sheet title="Monopoly: pick a resource" onClose={() => setPicking(null)}>
        <YourCards hand={hand} />
        <p class="hint">Every other player gives you all their cards of it.</p>
        <div class="res-choice">
          {RESOURCE_LIST.map((r) => (
            <button
              type="button"
              key={r}
              class="res-btn"
              onClick={() => {
                send({ type: 'playMonopoly', player: seat, resource: r });
                close();
              }}
            >
              <ResIcon r={r} />
              <span class="rate">{RESOURCE_INFO[r].label}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }
  if (picking === 'yop') {
    return (
      <Sheet title={`Year of Plenty: take ${yopNeed}`} onClose={() => setPicking(null)}>
        <PickCards hand={hand} row={yop} need={yopNeed} limit={view.bank} sign={1} onChange={setYop} />
        <button
          type="button"
          class="primary wide"
          disabled={rowCount(yop) !== yopNeed}
          onClick={() => {
            const take = rowSides(yop).get;
            const list: Resource[] = [];
            for (const r of RESOURCE_LIST) for (let i = 0; i < (take[r] ?? 0); i++) list.push(r);
            send({ type: 'playYearOfPlenty', player: seat, resources: list });
            close();
          }}
        >
          Take them
        </button>
      </Sheet>
    );
  }

  const play = (type: DevCardType) => {
    if (type === 'knight') send({ type: 'playKnight', player: seat });
    else if (type === 'roadBuilding') send({ type: 'playRoadBuilding', player: seat });
    else if (type === 'monopoly') return setPicking('monopoly');
    else if (type === 'yearOfPlenty') return setPicking('yop');
    close();
  };
  const legalType: Record<DevCardType, boolean> = {
    knight: has(legal, 'playKnight'),
    roadBuilding: has(legal, 'playRoadBuilding'),
    monopoly: has(legal, 'playMonopoly'),
    yearOfPlenty: has(legal, 'playYearOfPlenty'),
    victoryPoint: false,
  };
  const pirateIslands = view.ext.pirateIslands !== undefined;
  return (
    <Sheet title="Development cards" onClose={close}>
      {cards.length === 0 && <p class="hint">You have no development cards. Buy one from the Build menu.</p>}
      <div class="card-list">
        {[...counts.entries()].map(([type, c]) => (
          <div class="dev-card" key={type}>
            <span class="dev-thumb">
              <DevCardView type={type} look="mini" />
            </span>
            <div class="dev-text">
              <strong>
                {DEV_INFO[type].label} ×{c.total}
              </strong>
              <span>
                {type === 'knight' && pirateIslands ? 'Turn your rearmost ship into a warship.' : DEV_INFO[type].text}
                {c.fresh > 0 && type !== 'victoryPoint' ? ` (${c.fresh} bought this turn)` : ''}
              </span>
            </div>
            {type !== 'victoryPoint' && (
              <button type="button" class="primary" disabled={!legalType[type]} onClick={() => play(type)}>
                Play
              </button>
            )}
          </div>
        ))}
      </div>
      <p class="hint">One card per turn, never on the turn you bought it. Knights may be played before rolling.</p>
    </Sheet>
  );
}

// --- forced choices -------------------------------------------------------------------

type ForcedProps = Omit<SheetProps, 'close' | 'legal' | 'colors'> & {
  /** Another sheet (the log, the scores) is open on top: hide, but keep the choices made so far. */
  covered?: boolean;
};

function EyeIcon() {
  return (
    <svg class="peek-eye" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12 C5.5 6.5 9 4.8 12 4.8 S18.5 6.5 21.5 12 C18.5 17.5 15 19.2 12 19.2 S5.5 17.5 2.5 12 Z" />
      <circle cx="12" cy="12" r="3.4" />
    </svg>
  );
}

/**
 * A choice the game waits for (discarding on a 7, free resources, whom to
 * rob). It can't be closed, but "Peek at the board" folds it into a small bar
 * over the board, the choices made so far kept, and the bar opens it again.
 */
export function ForcedSheet({
  title,
  bar,
  back,
  covered,
  children,
}: {
  title: string;
  /** What the folded bar says. */
  bar: ComponentChildren;
  /** The bar's button, e.g. "Back to discard". */
  back: string;
  covered?: boolean;
  children: ComponentChildren;
}) {
  const [peek, setPeek] = useState(false);
  // The bar sits at the foot of the map, like the confirm bar (or of the screen, if there is no map area).
  const [area, setArea] = useState<Element | null>(null);
  useLayoutEffect(() => setArea(document.querySelector('.game .board-area')), []);
  // Keyboard users land on the button that undoes the fold.
  const toggled = useRef(false);
  const peekBtn = useRef<HTMLButtonElement>(null);
  const backBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (toggled.current) (peek ? backBtn : peekBtn).current?.focus();
  }, [peek]);
  const fold = (on: boolean) => {
    toggled.current = true;
    setPeek(on);
  };
  if (covered) return null;
  if (peek) {
    const el = (
      <div class={area ? 'confirm-bar peek-bar' : 'confirm-bar peek-bar floating'} role="region" aria-label={title}>
        <span class="peek-text">{bar}</span>
        <button type="button" class="primary" ref={backBtn} onClick={() => fold(false)}>
          {back}
        </button>
      </div>
    );
    return area ? createPortal(el, area) : el;
  }
  // Beside a longer title, phones say just "Peek".
  const long = title.length > 15;
  return (
    <Sheet
      title={title}
      tools={
        <button
          type="button"
          class={long ? 'peek-btn long-title' : 'peek-btn'}
          ref={peekBtn}
          aria-label="Peek at the board"
          title="Fold this away to look at the board"
          onClick={() => fold(true)}
        >
          <EyeIcon />
          <span>
            Peek<span class="peek-more"> at the board</span>
          </span>
        </button>
      }
    >
      {children}
    </Sheet>
  );
}

/** Discarding, ▼ discards a card (▲ keeps it after all); taking, ▲ takes one (▼ returns it). */
const DISCARD_VERBS: RowVerbs = { get: 'keep', give: 'discard' };
const TAKE_VERBS: RowVerbs = { get: 'take', give: 'return' };
const GIVE_VERBS: RowVerbs = { get: 'keep', give: 'give' };

/**
 * Picking exactly `need` cards: your hand on top, counting what will be left
 * as you pick, then a box per resource: ▼ discards a card from your hand
 * (`sign` −1), ▲ takes one from the bank (+1), up to `limit`. A line
 * underneath says what is picked and how many are still to pick.
 */
export function PickCards({
  hand,
  row,
  need,
  limit,
  sign,
  kinds = RESOURCE_LIST,
  giving,
  onChange,
}: {
  hand: CardCounts;
  row: SignedCounts;
  need: number;
  limit: CardCounts;
  sign: 1 | -1;
  /** The cards to pick from: resources, and commodities when discarding in Cities & Knights. */
  kinds?: Card[];
  /** The cards go to another player (a Wedding): "give" rather than "discard". */
  giving?: boolean;
  onChange(row: SignedCounts): void;
}) {
  const picked = rowCount(row);
  const { give, get } = rowSides(row);
  const left = need - picked;
  const out = giving ? 'give' : 'discard';
  return (
    <>
      <YourCards hand={hand} change={row} kinds={kinds} />
      <TradeRow
        row={row}
        rules={pickRules(row, need, limit, sign)}
        verbs={sign < 0 ? (giving ? GIVE_VERBS : DISCARD_VERBS) : TAKE_VERBS}
        kinds={kinds}
        onChange={onChange}
      />
      <p class="tsum pick-sum" aria-live="polite">
        {picked === 0 ? (
          <span class="tsum-tip">{sign < 0 ? `▼ under a card ${out}s it` : '▲ above a card takes it'}</span>
        ) : (
          <>
            <span class={sign < 0 ? 'tsum-give' : 'tsum-get'}>
              You {sign < 0 ? out : 'take'} <b>{countsPhrase(sign < 0 ? give : get)}</b>
            </span>
            {left > 0 && (
              <span class="tsum-left">
                {' · '}
                {left} more to pick
              </span>
            )}
          </>
        )}
      </p>
    </>
  );
}

const cardsWord = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

/** The folded sheet's bar: what is asked, and what is picked so far. */
export function PeekLine({ title, picked, n, need }: { title: string; picked: CardCounts; n: number; need: number }) {
  return (
    <>
      <b>{title}</b>
      <small>
        {n} of {need} picked
        {n > 0 && (
          <>
            : <Counts c={picked} />
          </>
        )}
      </small>
    </>
  );
}

export function DiscardSheet({ view, seat, send, covered }: ForcedProps) {
  const ph = view.phase;
  const need = ph.kind === 'discard' ? ph.pending[seat] ?? 0 : 0;
  const [row, setRow] = useState<SignedCounts>({});
  // Cities & Knights: commodities are discarded like resources, and each city wall raises the limit by 2
  const hand = handOfView(view, seat);
  const kinds = cardKindsOf(view);
  const limit = sevenLimitOf(view, seat);
  const total = sumCounts(hand);
  const picked = rowCount(row);
  const title = `Discard ${cardsWord(need)}`;
  return (
    <ForcedSheet title={title} covered={covered} back="Back to discard" bar={<PeekLine title={title} picked={rowSides(row).give} n={picked} need={need} />}>
      <p class="pick-lead">
        Discard <b>{need}</b> of <b>{total}</b> — you keep <b>{total - need}</b>
      </p>
      <p class="hint pick-note">
        A 7 was rolled and you hold more than {limit} cards{view.ck ? ` (${view.options.discardLimit}, +2 for each city wall; commodities count too)` : ''}.
      </p>
      <PickCards hand={hand} row={row} need={need} limit={hand} sign={-1} kinds={kinds} onChange={setRow} />
      <button
        type="button"
        class="primary wide"
        disabled={picked !== need}
        onClick={() => send({ type: 'discard', player: seat, cards: cleanCounts(rowSides(row).give) })}
      >
        {picked === need ? `Discard ${cardsWord(need)}` : `Discard ${picked}/${need}`}
      </button>
    </ForcedSheet>
  );
}

export function GoldSheet({ view, seat, send, covered }: ForcedProps) {
  const ph = view.phase;
  const owed = ph.kind === 'gold' ? ph.pending[seat] ?? 0 : 0;
  const bankTotal = RESOURCE_LIST.reduce((n, r) => n + view.bank[r], 0);
  const need = Math.min(owed, bankTotal);
  const [row, setRow] = useState<SignedCounts>({});
  const picked = rowCount(row);
  const title = `Choose ${need} resource${need === 1 ? '' : 's'}`;
  return (
    <ForcedSheet title={title} covered={covered} back="Back to your choice" bar={<PeekLine title={title} picked={rowSides(row).get} n={picked} need={need} />}>
      <p class="hint pick-note">Gold, a discovery or a beaten pirate fleet lets you pick any resources.</p>
      <PickCards hand={view.players[seat].resources!} row={row} need={need} limit={view.bank} sign={1} onChange={setRow} />
      <button
        type="button"
        class="primary wide"
        disabled={picked !== need}
        onClick={() => send({ type: 'chooseGold', player: seat, resources: cleanCounts(rowSides(row).get) })}
      >
        {picked === need ? `Take ${need === 1 ? 'it' : 'them'}` : `Take ${picked}/${need}`}
      </button>
    </ForcedSheet>
  );
}

/** Pirate Islands: after a 7 the roller may rob any player. */
export function RobAnySheet({ view, legal, colors, seat, send, covered }: Omit<SheetProps, 'close'> & { covered?: boolean }) {
  const options = legal.filter((a): a is Extract<Action, { type: 'scenario' }> => a.type === 'scenario' && a.name === 'rob');
  return (
    <ForcedSheet
      title="Rob a player"
      covered={covered}
      back="Back to robbing"
      bar={
        <>
          <b>Rob a player</b>
          <small>Choose whom to rob</small>
        </>
      }
    >
      <YourCards hand={view.players[seat].resources!} />
      <div class="choice-list">
        {options.map((a, i) => {
          const victim = a.args?.victim as number | undefined;
          return (
            <button type="button" key={i} class={victim === undefined ? 'choice' : 'choice primary'} onClick={() => send(a)}>
              {victim === undefined ? (
                'Rob nobody'
              ) : (
                <>
                  <Dot color={colors[victim]} /> {nameOf(view, victim)} ({view.players[victim].resourceCount} cards)
                </>
              )}
            </button>
          );
        })}
      </div>
      {options.length === 0 && <p class="hint">Waiting…</p>}
    </ForcedSheet>
  );
}

// --- scenario -------------------------------------------------------------------------------

export function ScenarioSheet({ view, legal, seat, colors, send, close, placeHarbor }: SheetProps & { placeHarbor(): void }) {
  const sc = getScenario(view.scenario);
  const ext = view.ext as Record<string, unknown>;
  const wonders = ext.wonders as { claimed: Record<string, number>; owned: Array<string | null>; levels: number[] } | undefined;
  const pirate = ext.pirateIslands as { fortresses: Array<{ chits: number; captured: boolean }> } | undefined;
  const cloth = ext.cloth as { villages: Record<string, { cloth: number }>; general: number; cloth: number[] } | undefined;
  const held = (ext.heldHarbors as Record<string, string[]> | undefined)?.[seat] ?? [];
  const scen = legal.filter((a): a is Extract<Action, { type: 'scenario' }> => a.type === 'scenario');
  const warships = (p: number) => Object.values(view.board.pieces).filter((x) => x.owner === p && x.warship).length;
  return (
    <Sheet title={sc.name} onClose={close} wide>
      <p class="scenario-desc">{sc.description}</p>
      {wonders && (
        <div class="wonders">
          {Object.entries(WONDER_INFO).map(([id, w]) => {
            const owner = wonders.claimed[id];
            const claim = scen.find((a) => a.name === 'claimWonder' && a.args?.wonder === id);
            const build = owner === seat ? scen.find((a) => a.name === 'buildWonder') : undefined;
            return (
              <div class="wonder" key={id}>
                <div class="wonder-head">
                  <strong>{w.name}</strong>
                  <Cost cost={w.cost} />
                </div>
                <div class="wonder-req">Needs {w.requirement}</div>
                <div class="wonder-state">
                  {owner === undefined ? (
                    'Unclaimed'
                  ) : (
                    <>
                      <Dot color={colors[owner]} /> {nameOf(view, owner)}: level {wonders.levels[owner]}/4
                    </>
                  )}
                </div>
                <div class="wonder-actions">
                  {claim && (
                    <button type="button" class="primary" onClick={() => send(claim)}>
                      Claim (uses a ship)
                    </button>
                  )}
                  {build && (
                    <button type="button" class="primary" onClick={() => send(build)}>
                      Build level {wonders.levels[seat] + 1}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {pirate && (
        <div class="fortresses">
          {pirate.fortresses.map((f, i) => (
            <div class="fortress-row" key={i}>
              <Dot color={colors[i]} /> {nameOf(view, i)}: {f.captured ? 'fortress conquered ✅' : `fortress strength ${f.chits}/3`} · {warships(i)} warship
              {warships(i) === 1 ? '' : 's'}
            </div>
          ))}
          {scen.some((a) => a.name === 'attackFortress') && (
            <button
              type="button"
              class="primary wide"
              onClick={() => {
                send(scen.find((a) => a.name === 'attackFortress')!);
                close();
              }}
            >
              Attack your fortress (ends your turn)
            </button>
          )}
        </div>
      )}
      {cloth && (
        <div class="cloth-table">
          {view.players.map((p) => (
            <div key={p.id} class="fortress-row">
              <Dot color={colors[p.id]} /> {p.name}: {cloth.cloth[p.id]} cloth ({Math.floor(cloth.cloth[p.id] / 2)} VP)
            </div>
          ))}
          <p class="hint">
            Villages with cloth: {Object.values(cloth.villages).filter((v) => v.cloth > 0).length}/8 · general supply {cloth.general}. The game ends when 3
            or fewer villages have cloth.
            {view.ck && ' The villages’ cloth only counts for victory points: it is not the cloth commodity of Cities & Knights.'}
          </p>
        </div>
      )}
      {held.length > 0 && (
        <div class="held">
          <p>
            Harbors to place: {held.map((h) => harborLabel(h as never)).join(', ')}. Place one next to your coastal settlement or city.
          </p>
          <button
            type="button"
            class="primary"
            disabled={!legal.some((a) => a.type === 'placeHarbor')}
            onClick={() => {
              placeHarbor();
              close();
            }}
          >
            Place a harbor
          </button>
        </div>
      )}
      <p class="hint">
        Victory: {view.victoryTarget} VP{wonders ? ' with the highest wonder level, or finish a wonder' : pirate ? ' and your conquered fortress' : ''}.
      </p>
    </Sheet>
  );
}

// --- log & end ----------------------------------------------------------------------------

export function LogSheet({ view, colors, close }: { view: GameView; colors: PlayerColor[]; close(): void }) {
  const items = logItems(view, 200);
  return (
    <Sheet title="Game log" onClose={close}>
      <div
        class="log"
        ref={(el) => {
          if (el) el.scrollTop = el.scrollHeight;
        }}
      >
        <ol class="glog-list">
          {items.map((it) => (
            <LogLine key={it.key} item={it} view={view} colors={colors} />
          ))}
        </ol>
      </div>
    </Sheet>
  );
}
