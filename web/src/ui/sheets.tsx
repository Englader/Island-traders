import {
  COSTS,
  getScenario,
  tradeRates,
  type Action,
  type DevCardType,
  type GameState,
  type GameView,
  type PartialCounts,
  type PlayerId,
  type Resource,
  type TradeOffer,
} from 'engine';
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { DEV_INFO, RESOURCE_INFO, RESOURCE_LIST, WONDER_INFO, countsText, harborLabel } from '../game/names';
import type { PlayerColor } from '../game/seats';
import { Cost, ResIcon, ResourcePicker, Sheet, cleanCounts, sumCounts } from './common';
import { Counts, ResGlyph } from './icons';
import { DevCardView, ResourceCard } from './cards';

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

export type BuildPiece = 'road' | 'ship' | 'settlement' | 'city';

export function BuildSheet({ view, legal, seat, send, close, choose }: SheetProps & { choose(p: BuildPiece): void }) {
  const ships = getScenario(view.scenario).rules.ships;
  const me = view.players[seat];
  const items: Array<{ key: BuildPiece | 'dev'; label: string; cost: PartialCounts; ok: boolean; left?: number }> = [
    { key: 'road', label: 'Road', cost: COSTS.road, ok: has(legal, 'buildRoad'), left: me?.supply.roads },
    ...(ships ? [{ key: 'ship' as const, label: 'Ship', cost: COSTS.ship, ok: has(legal, 'buildShip'), left: me?.supply.ships }] : []),
    { key: 'settlement', label: 'Settlement', cost: COSTS.settlement, ok: has(legal, 'buildSettlement'), left: me?.supply.settlements },
    { key: 'city', label: 'City', cost: COSTS.city, ok: has(legal, 'buildCity'), left: me?.supply.cities },
    { key: 'dev', label: 'Development card', cost: COSTS.devCard, ok: has(legal, 'buyDevCard'), left: view.devDeckCount },
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
            onClick={() => {
              if (it.key === 'dev') {
                send({ type: 'buyDevCard', player: seat });
                close();
              } else choose(it.key);
            }}
          >
            <span class="build-name">{it.label}</span>
            <Cost cost={it.cost} />
            <span class="build-left">{it.left !== undefined ? `${it.left} left` : ''}</span>
          </button>
        ))}
      </div>
      <p class="hint">Greyed out: not enough cards, no pieces left, or no legal spot.</p>
    </Sheet>
  );
}

// --- trade -----------------------------------------------------------------------

/** The player's cards, one tile per resource with the count. */
function YourCards({ hand }: { hand: PartialCounts }) {
  return (
    <div class="your-cards" aria-label="Your cards">
      <span class="your-cards-label">Your cards</span>
      <div class="your-cards-row">
        {RESOURCE_LIST.map((r) => (
          <ResourceCard key={r} r={r} n={hand[r] ?? 0} look="tile" empty={!(hand[r] ?? 0)} />
        ))}
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
  return (
    <>
      {who} gives <Counts c={t.give} /> for your <Counts c={t.get} />
    </>
  );
}

export function TradeSheet({ view, legal, seat, colors, send, close }: SheetProps) {
  const me = view.players[seat];
  const hand = me.resources!;
  const rates = useMemo(() => tradeRates(view as unknown as GameState, seat), [view, seat]);
  const canBank = has(legal, 'bankTrade') || (view.phase.kind === 'main' && view.turn.actor === seat && !(view.options.tradeBuildMode === 'separate' && view.turn.buildingStarted));
  const domestic =
    view.phase.kind === 'main' &&
    view.turn.actor === seat &&
    view.turn.role === 'active' &&
    !(view.options.tradeBuildMode === 'separate' && view.turn.buildingStarted);
  const [tab, setTab] = useState<'bank' | 'players'>(domestic ? 'players' : 'bank');

  // bank
  const [give, setGive] = useState<Resource | null>(null);
  const [get, setGet] = useState<Resource | null>(null);
  const [lots, setLots] = useState(1);
  const maxLots = give && get ? Math.min(Math.floor(hand[give] / rates[give]), view.bank[get]) : 0;

  // players
  const [offerGive, setOfferGive] = useState<PartialCounts>({});
  const [offerGet, setOfferGet] = useState<PartialCounts>({});
  const others = view.players.filter((p) => p.id !== seat).map((p) => p.id);
  const [to, setTo] = useState<PlayerId[]>(others);
  const mine = view.turn.trades.filter((t) => t.from === seat);
  const openIds = new Set(mine.filter((t) => t.open).map((t) => t.id));
  // answers to an open offer are listed under it; other counter-offers on their own
  const counters = view.turn.trades.filter((t) => t.from !== seat && t.to.includes(seat) && !(t.replyTo !== undefined && openIds.has(t.replyTo)));
  const answers = (id: number) => view.turn.trades.filter((t) => t.replyTo === id && t.from !== seat);
  const giveN = sumCounts(offerGive);
  const getN = sumCounts(offerGet);
  const same = RESOURCE_LIST.some((r) => (offerGive[r] ?? 0) > 0 && (offerGet[r] ?? 0) > 0);
  const kind = giveN > 0 && getN > 0 ? 'offer' : giveN > 0 ? 'open-get' : getN > 0 ? 'open-give' : null;
  const offerOk = kind !== null && to.length > 0 && !same;
  const offerLabel =
    kind === 'open-give' ? (
      <>
        Ask who gives <Counts c={offerGet} />
      </>
    ) : kind === 'open-get' ? (
      <>
        Ask what they'd give for <Counts c={offerGive} />
      </>
    ) : (
      'Make offer'
    );
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
      <YourCards hand={hand} />
      {domestic && (
        <div class="tabs" role="tablist">
          <button type="button" class={tab === 'players' ? 'tab on' : 'tab'} onClick={() => setTab('players')}>
            Players {counters.length > 0 ? `(${counters.length})` : ''}
          </button>
          <button type="button" class={tab === 'bank' ? 'tab on' : 'tab'} onClick={() => setTab('bank')}>
            Bank & harbors
          </button>
        </div>
      )}
      {tab === 'bank' || !domestic ? (
        <div class="bank-trade">
          {!canBank && <p class="hint">You can trade with the bank during your turn (after rolling).</p>}
          <h3>Give</h3>
          <div class="res-choice">
            {RESOURCE_LIST.map((r) => (
              <button
                type="button"
                key={r}
                class={give === r ? 'res-btn on' : 'res-btn'}
                disabled={hand[r] < rates[r]}
                onClick={() => {
                  setGive(r);
                  setLots(1);
                  if (get === r) setGet(null);
                }}
              >
                <ResIcon r={r} n={hand[r]} />
                <span class="rate">{rates[r]}:1</span>
              </button>
            ))}
          </div>
          <h3>Get</h3>
          <div class="res-choice">
            {RESOURCE_LIST.map((r) => (
              <button
                type="button"
                key={r}
                class={get === r ? 'res-btn on' : 'res-btn'}
                disabled={r === give || view.bank[r] === 0}
                onClick={() => {
                  setGet(r);
                  setLots(1);
                }}
              >
                <ResIcon r={r} />
                <span class="rate">{view.bank[r]} in bank</span>
              </button>
            ))}
          </div>
          {give && get && (
            <div class="trade-summary">
              <button type="button" class="small-btn" disabled={lots <= 1} onClick={() => setLots(lots - 1)}>
                −
              </button>
              <span>
                {lots * rates[give]}
                <ResGlyph r={give} /> → {lots}
                <ResGlyph r={get} />
              </span>
              <button type="button" class="small-btn" disabled={lots >= maxLots} onClick={() => setLots(lots + 1)}>
                +
              </button>
            </div>
          )}
          <button
            type="button"
            class="primary wide"
            disabled={!canBank || !give || !get || maxLots < 1}
            onClick={() => {
              send({ type: 'bankTrade', player: seat, give: { [give!]: lots * rates[give!] }, get: { [get!]: lots } });
              setGive(null);
              setGet(null);
            }}
          >
            Trade with the bank
          </button>
        </div>
      ) : (
        <div class="player-trade">
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
          <h3>You give</h3>
          <ResourcePicker value={offerGive} max={hand} have={hand} onChange={setOfferGive} />
          <h3>You get</h3>
          <ResourcePicker value={offerGet} max={{ brick: 9, lumber: 9, wool: 9, grain: 9, ore: 9 }} have={hand} onChange={setOfferGet} />
          <p class="hint">Leave one side empty to ask the others what they would trade.</p>
          <h3>Offer to</h3>
          <div class="chips">
            {others.map((p) => (
              <button
                type="button"
                key={p}
                class={to.includes(p) ? 'chip on' : 'chip'}
                onClick={() => setTo(to.includes(p) ? to.filter((x) => x !== p) : [...to, p])}
              >
                <Dot color={colors[p]} /> {nameOf(view, p)}
              </button>
            ))}
          </div>
          <button
            type="button"
            class="primary wide"
            disabled={!offerOk}
            onClick={() => {
              send({
                type: 'proposeTrade',
                player: seat,
                give: cleanCounts(offerGive),
                get: cleanCounts(offerGet),
                to,
                ...(kind === 'offer' ? {} : { open: true }),
              });
              setOfferGive({});
              setOfferGet({});
            }}
          >
            {offerLabel}
          </button>
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
              {t.accepted.includes(p) ? '✅ yes' : answered(p) ? '💬 made an offer' : t.rejected.includes(p) ? '❌ no' : '… waiting'}
            </span>
          ))}
        </div>
      )}
      <div class="offer-actions">{children}</div>
    </div>
  );
}

/** A player answers the active player's offer: accept, decline, or make a counter-offer. */
export function RespondSheet({ view, legal, seat, colors, send }: Omit<SheetProps, 'close'>) {
  const offers = view.turn.trades.filter((t) => t.to.includes(seat) && t.from === view.turn.actor && !t.accepted.includes(seat) && !t.rejected.includes(seat));
  const [counter, setCounter] = useState<TradeOffer | null>(null);
  const [cGive, setCGive] = useState<PartialCounts>({});
  const [cGet, setCGet] = useState<PartialCounts>({});
  const hand = view.players[seat].resources!;
  if (offers.length === 0) return null;
  if (counter) {
    // an open offer fixes one side: the other player's request or card stays as it is
    const fixedGive = counter.open === 'give';
    const fixedGet = counter.open === 'get';
    const fixed = fixedGive ? counter.get : counter.give;
    const others = RESOURCE_LIST.filter((r) => !((fixed[r] ?? 0) > 0));
    const ok =
      sumCounts(cGive) > 0 &&
      sumCounts(cGet) > 0 &&
      RESOURCE_LIST.every((r) => !((cGive[r] ?? 0) > 0 && (cGet[r] ?? 0) > 0)) &&
      RESOURCE_LIST.every((r) => (cGive[r] ?? 0) <= (hand[r] ?? 0));
    return (
      <Sheet title={counter.open ? `Your offer to ${nameOf(view, counter.from)}` : `Counter-offer to ${nameOf(view, counter.from)}`} onClose={() => setCounter(null)} wide>
        <YourCards hand={hand} />
        <h3>You give</h3>
        {fixedGive ? (
          <p class="fixed-side">
            <Counts c={fixed} />
          </p>
        ) : (
          <ResourcePicker value={cGive} max={hand} have={hand} only={fixedGet ? others : undefined} onChange={setCGive} />
        )}
        <h3>You get</h3>
        {fixedGet ? (
          <p class="fixed-side">
            <Counts c={fixed} />
          </p>
        ) : (
          <ResourcePicker
            value={cGet}
            max={{ brick: 9, lumber: 9, wool: 9, grain: 9, ore: 9 }}
            have={hand}
            only={fixedGive ? others : undefined}
            onChange={setCGet}
          />
        )}
        <button
          type="button"
          class="primary wide"
          disabled={!ok}
          onClick={() => {
            send({ type: 'proposeTrade', player: seat, give: cleanCounts(cGive), get: cleanCounts(cGet), to: [counter.from], replyTo: counter.id });
            setCounter(null);
          }}
        >
          Send offer
        </button>
      </Sheet>
    );
  }
  return (
    <Sheet title="Trade offer">
      <YourCards hand={hand} />
      {offers.map((t) => (
        <OfferRow key={t.id} t={t} view={view} colors={colors} seat={seat}>
          {t.open ? (
            <button
              type="button"
              class="primary"
              disabled={t.open === 'give' && !RESOURCE_LIST.every((r) => (t.get[r] ?? 0) <= (hand[r] ?? 0))}
              onClick={() => {
                setCGive(t.open === 'give' ? { ...t.get } : {});
                setCGet(t.open === 'get' ? { ...t.give } : {});
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
                  setCGive({ ...t.get });
                  setCGet({ ...t.give });
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
  const [yop, setYop] = useState<PartialCounts>({});
  const yopNeed = Math.min(2, RESOURCE_LIST.reduce((n, r) => n + view.bank[r], 0));

  if (picking === 'monopoly') {
    return (
      <Sheet title="Monopoly: pick a resource" onClose={() => setPicking(null)}>
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
    const bankMax: PartialCounts = { ...view.bank };
    return (
      <Sheet title={`Year of Plenty: take ${yopNeed}`} onClose={() => setPicking(null)}>
        <ResourcePicker value={yop} max={bankMax} onChange={setYop} />
        <button
          type="button"
          class="primary wide"
          disabled={sumCounts(yop) !== yopNeed}
          onClick={() => {
            const list: Resource[] = [];
            for (const r of RESOURCE_LIST) for (let i = 0; i < (yop[r] ?? 0); i++) list.push(r);
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

export function DiscardSheet({ view, seat, send }: Omit<SheetProps, 'close' | 'legal' | 'colors'>) {
  const ph = view.phase;
  const need = ph.kind === 'discard' ? ph.pending[seat] ?? 0 : 0;
  const [pick, setPick] = useState<PartialCounts>({});
  const hand = view.players[seat].resources!;
  return (
    <Sheet title={`Discard ${need} cards`}>
      <p class="hint">A 7 was rolled and you hold more than {view.options.discardLimit} cards.</p>
      <ResourcePicker value={pick} max={hand} onChange={setPick} />
      <button
        type="button"
        class="primary wide"
        disabled={sumCounts(pick) !== need}
        onClick={() => send({ type: 'discard', player: seat, cards: cleanCounts(pick) })}
      >
        Discard {sumCounts(pick)}/{need}
      </button>
    </Sheet>
  );
}

export function GoldSheet({ view, seat, send }: Omit<SheetProps, 'close' | 'legal' | 'colors'>) {
  const ph = view.phase;
  const owed = ph.kind === 'gold' ? ph.pending[seat] ?? 0 : 0;
  const bankTotal = RESOURCE_LIST.reduce((n, r) => n + view.bank[r], 0);
  const need = Math.min(owed, bankTotal);
  const [pick, setPick] = useState<PartialCounts>({});
  return (
    <Sheet title={`Choose ${need} resource${need === 1 ? '' : 's'}`}>
      <p class="hint">Gold, a discovery or a beaten pirate fleet lets you pick any resources.</p>
      <ResourcePicker value={pick} max={{ ...view.bank }} onChange={setPick} />
      <button
        type="button"
        class="primary wide"
        disabled={sumCounts(pick) !== need}
        onClick={() => send({ type: 'chooseGold', player: seat, resources: cleanCounts(pick) })}
      >
        Take {sumCounts(pick)}/{need}
      </button>
    </Sheet>
  );
}

/** Pirate Islands: after a 7 the roller may rob any player. */
export function RobAnySheet({ view, legal, colors, send }: Omit<SheetProps, 'close'>) {
  const options = legal.filter((a): a is Extract<Action, { type: 'scenario' }> => a.type === 'scenario' && a.name === 'rob');
  return (
    <Sheet title="Rob a player">
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
    </Sheet>
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

export function LogSheet({ view, close }: { view: GameView; close(): void }) {
  const entries = view.log.slice(-200);
  return (
    <Sheet title="Game log" onClose={close}>
      <ol
        class="log"
        ref={(el) => {
          if (el) el.scrollTop = el.scrollHeight;
        }}
      >
        {entries.map((e, i) => (
          <li key={i} class={e.msg.startsWith('---') ? 'turn-line' : e.visibleTo ? 'private' : ''}>
            {e.msg.replace(/^---\s*|\s*---$/g, '')}
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

export function GameOverSheet({
  view,
  colors,
  onHome,
  onRematch,
}: {
  view: GameView;
  colors: PlayerColor[];
  onHome(): void;
  onRematch?: () => void;
}) {
  const ph = view.phase;
  if (ph.kind !== 'gameOver') return null;
  const ranked = [...view.players].sort((a, b) => (b.totalVP ?? b.publicVP) - (a.totalVP ?? a.publicVP));
  return (
    <Sheet title={ph.winner === null ? 'Game over' : `${nameOf(view, ph.winner)} wins!`}>
      <p class="hint">{ph.reason}</p>
      <ol class="results">
        {ranked.map((p) => (
          <li key={p.id}>
            <Dot color={colors[p.id]} /> <span class="res-name">{p.name}</span> <strong>{p.totalVP ?? p.publicVP} VP</strong>
          </li>
        ))}
      </ol>
      <div class="row">
        {onRematch && (
          <button type="button" class="primary" onClick={onRematch}>
            Play again
          </button>
        )}
        <button type="button" onClick={onHome}>
          Home
        </button>
      </div>
    </Sheet>
  );
}
