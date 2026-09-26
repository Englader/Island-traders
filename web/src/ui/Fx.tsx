import type { Action, DevCardType, GameView, PartialCounts, PlayerId, Resource } from 'engine';
import { useEffect, useRef } from 'preact/hooks';
import { DEV_INFO, RESOURCE_INFO, RESOURCE_LIST } from '../game/names';
import type { PlayerColor } from '../game/seats';
import { DevCardView, ResourceCard } from './cards';

/** A moment worth showing in the middle of the screen: a trade or a development card. */
export type FxEvent =
  | { kind: 'trade'; a: PlayerId; b: PlayerId | 'bank'; give: PartialCounts; get: PartialCounts }
  | { kind: 'devBuy'; by: PlayerId; card: DevCardType | null }
  | { kind: 'devPlay'; by: PlayerId; card: DevCardType; detail: string };

const PLAYS: Partial<Record<Action['type'], DevCardType>> = {
  playKnight: 'knight',
  playRoadBuilding: 'roadBuilding',
  playYearOfPlenty: 'yearOfPlenty',
  playMonopoly: 'monopoly',
};

function newCard(before: GameView, after: GameView, p: PlayerId): DevCardType | null {
  const had = before.players[p]?.devCards;
  const has = after.players[p]?.devCards;
  if (!had || !has) return null;
  const count = (list: typeof has, t: DevCardType) => list.filter((c) => c.type === t).length;
  return has.find((c) => count(has, c.type) > count(had, c.type))?.type ?? null;
}

/** The event a move should show, if any; `before` is the view just before it. */
export function fxFor(action: Action, before: GameView, after: GameView, seat: PlayerId | null): FxEvent | null {
  switch (action.type) {
    case 'bankTrade':
      return { kind: 'trade', a: action.player, b: 'bank', give: action.give, get: action.get };
    case 'confirmTrade': {
      const t = before.turn.trades.find((x) => x.id === action.tradeId);
      return t ? { kind: 'trade', a: t.from, b: action.partner, give: t.give, get: t.get } : null;
    }
    case 'acceptTrade': {
      // only a counter-offer taken by the active player trades at once
      const t = before.turn.trades.find((x) => x.id === action.tradeId);
      if (!t || after.turn.trades.some((x) => x.id === t.id)) return null;
      return { kind: 'trade', a: t.from, b: action.player, give: t.give, get: t.get };
    }
    case 'buyDevCard':
      return { kind: 'devBuy', by: action.player, card: seat === action.player ? newCard(before, after, action.player) : null };
    default: {
      const card = PLAYS[action.type];
      if (!card) return null;
      let detail = DEV_INFO[card].text;
      if (action.type === 'playMonopoly') detail = `Takes every ${RESOURCE_INFO[action.resource].label.toLowerCase()} card.`;
      if (action.type === 'playYearOfPlenty') detail = `Takes ${action.resources.map((r) => RESOURCE_INFO[r].label.toLowerCase()).join(' and ')} from the bank.`;
      return { kind: 'devPlay', by: action.player, card, detail };
    }
  }
}

function cardsOf(c: PartialCounts): Resource[] {
  return RESOURCE_LIST.flatMap((r) => Array.from({ length: c[r] ?? 0 }, () => r));
}

function Party({ name, color, bank }: { name: string; color?: PlayerColor; bank?: boolean }) {
  return (
    <div class="fx-party">
      <span class="fx-avatar" style={color ? { background: color.fill, borderColor: color.stroke } : undefined}>
        {bank ? '🏦' : name.slice(0, 1).toUpperCase()}
      </span>
      <span class="fx-name">{name}</span>
    </div>
  );
}

function DevFace({ card }: { card: DevCardType | null }) {
  return (
    <div class="fx-flip">
      <div class="fx-dev back">
        <DevCardView type={null} back />
      </div>
      <div class="fx-dev face">
        <DevCardView type={card} back={!card} />
      </div>
    </div>
  );
}

/**
 * Shows a trade (the cards slide across between the two sides) or a
 * development card (bought: it flies in and, if it is yours, turns over;
 * played: it turns face up) for `ms` milliseconds. A tap skips it.
 */
export function FxOverlay({ fx, view, colors, seat, ms, onDone }: { fx: FxEvent & { key: number }; view: GameView; colors: PlayerColor[]; seat: PlayerId | null; ms: number; onDone(): void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(), ms);
    return () => clearTimeout(t);
  }, [fx.key]);
  const name = (p: PlayerId) => (p === seat ? 'You' : view.players[p]?.name ?? `Player ${p + 1}`);
  const style = { '--fx-ms': `${ms}ms` } as Record<string, string>;
  let body;
  if (fx.kind === 'trade') {
    const right = cardsOf(fx.give);
    const left = cardsOf(fx.get);
    body = (
      <>
        <div class="fx-title">{fx.b === 'bank' ? `${name(fx.a)} trade${fx.a === seat ? '' : 's'} with the bank` : `${name(fx.a)} ⇄ ${name(fx.b)}`}</div>
        <div class="fx-trade-row">
          <Party name={name(fx.a)} color={colors[fx.a]} />
          <div class="fx-lanes">
            <div class="fx-lane">
              {right.map((r, i) => (
                <span key={`r${i}`} class="fx-card go-right" style={{ '--i': i } as Record<string, number>}>
                  <ResourceCard r={r} look="mini" />
                </span>
              ))}
            </div>
            <div class="fx-lane">
              {left.map((r, i) => (
                <span key={`l${i}`} class="fx-card go-left" style={{ '--i': i } as Record<string, number>}>
                  <ResourceCard r={r} look="mini" />
                </span>
              ))}
            </div>
          </div>
          {fx.b === 'bank' ? <Party name="Bank" bank /> : <Party name={name(fx.b)} color={colors[fx.b]} />}
        </div>
      </>
    );
  } else if (fx.kind === 'devBuy') {
    body = (
      <>
        <div class="fx-title">{fx.by === seat ? 'You buy a development card' : `${name(fx.by)} buys a development card`}</div>
        <div class={fx.card ? 'fx-devbuy reveal' : 'fx-devbuy'}>
          <DevFace card={fx.card} />
        </div>
        {fx.card && <div class="fx-sub">{DEV_INFO[fx.card].text}</div>}
      </>
    );
  } else {
    body = (
      <>
        <div class="fx-title">
          {name(fx.by)} {fx.by === seat ? 'play' : 'plays'} {DEV_INFO[fx.card].label}
        </div>
        <div class="fx-devplay reveal">
          <DevFace card={fx.card} />
        </div>
        <div class="fx-sub">{fx.detail}</div>
      </>
    );
  }
  return (
    <div class="fx-overlay" style={style} onClick={() => done.current()} role="status">
      <div class={`fx-panel fx-${fx.kind}`}>{body}</div>
    </div>
  );
}
