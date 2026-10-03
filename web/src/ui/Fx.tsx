import { PROGRESS_CARDS, type Card, type CardCounts, type DevCardType, type GameView, type PlayerId } from 'engine';
import { useEffect, useRef } from 'preact/hooks';
import { TRACK_INFO, TRACK_LIST, improvementName } from '../game/ck';
import type { FxEvent } from '../game/fx';
import { playCues, type CueCall } from '../game/soundCues';
import { CARD_LIST, DEV_INFO, progressTitle } from '../game/names';
import type { PlayerColor } from '../game/seats';
import { DevCardView, ResourceCard } from './cards';
import { GateGlyph, HelmIcon, ProgressCardView, ShipGlyph, TowerGlyph } from './ckArt';

export { fxFor, type FxEvent, type ProgressDraw } from '../game/fx';

function cardsOf(c: CardCounts): Card[] {
  return CARD_LIST.flatMap((r) => Array.from({ length: c[r] ?? 0 }, () => r));
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
export function FxOverlay({
  fx,
  view,
  colors,
  seat,
  ms,
  onDone,
}: {
  /** `sounds`: what the moment sounds like, on its beats (game/soundCues.ts). */
  fx: FxEvent & { key: number; sounds?: CueCall[] };
  view: GameView;
  colors: PlayerColor[];
  seat: PlayerId | null;
  ms: number;
  onDone(): void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(), ms);
    // its sounds keep their beats (the attack's drums, then its outcome)
    if (fx.sounds) playCues(fx.sounds, { fx: ms / 1000 });
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
  } else if (fx.kind === 'attack') {
    body = (
      <>
        <div class="fx-title">The barbarians attack!</div>
        <div class="fx-attack-sea" aria-hidden="true">
          <span class="fx-attack-ship">
            <ShipGlyph />
          </span>
          <span class="fx-attack-shore" />
        </div>
        <div class={fx.won ? 'fx-vs won' : 'fx-vs lost'}>
          <span class="fx-side barb">
            <b>{fx.barbarians}</b>
            <small>barbarians</small>
          </span>
          <span class="fx-vs-x">{fx.won ? '≤' : '>'}</span>
          <span class="fx-side kn">
            <b>{fx.knights}</b>
            <small>knights</small>
          </span>
        </div>
        <div class="fx-defenders">
          {fx.perPlayer.map((n, p) => (
            <span key={p} class="fx-def" style={{ '--pc': colors[p]?.fill } as Record<string, string>}>
              <span class="fx-def-dot" />
              {name(p)} <HelmIcon /> {n}
            </span>
          ))}
        </div>
        <div class={fx.won ? 'fx-outcome won' : 'fx-outcome lost'}>
          <b>{fx.outcome}</b>
          <span>{fx.detail}</span>
        </div>
      </>
    );
  } else if (fx.kind === 'draw') {
    const who = [...new Set(fx.draws.map((d) => d.p))];
    const mine = fx.draws.filter((d) => d.p === seat && d.card);
    const title =
      who.length === 1
        ? who[0] === seat
          ? mine.length === 1
            ? `You draw ${progressTitle(mine[0].card!)}`
            : 'You draw progress cards'
          : `${name(who[0])} draws ${fx.draws.length === 1 ? (fx.draws[0].card ? progressTitle(fx.draws[0].card) : 'a progress card') : 'progress cards'}`
        : 'Progress cards are drawn';
    body = (
      <>
        <div class="fx-title">{title}</div>
        <div class="fx-draws">
          {fx.draws.map((d, i) => (
            <div key={i} class="fx-draw" style={{ '--i': i } as Record<string, number>}>
              <div class={d.card ? 'fx-devbuy reveal' : 'fx-devbuy'}>
                <div class="fx-flip prog">
                  <div class="fx-dev back">
                    <ProgressCardView deck={d.deck} back />
                  </div>
                  <div class="fx-dev face">
                    <ProgressCardView card={d.card} deck={d.deck} back={!d.card} text />
                  </div>
                </div>
              </div>
              <span class="fx-draw-who" style={{ '--pc': colors[d.p]?.fill } as Record<string, string>}>
                {name(d.p)}
              </span>
            </div>
          ))}
        </div>
        <div class="fx-sub">
          {fx.draws.some((d) => d.card && PROGRESS_CARDS[d.card]?.vp)
            ? 'A victory point card is played at once: +1 VP'
            : TRACK_LIST.filter((t) => fx.draws.some((d) => d.deck === t))
                .map((t) => `${TRACK_INFO[t].label} deck`)
                .join(' · ')}
        </div>
      </>
    );
  } else if (fx.kind === 'progPlay') {
    const on = fx.target === undefined ? '' : ` on ${fx.target === seat ? 'you' : name(fx.target)}`;
    body = (
      <>
        <div class="fx-title">
          {name(fx.by)} {fx.by === seat ? 'play' : 'plays'} {progressTitle(fx.card)}
          {on}
        </div>
        <div class="fx-devplay reveal">
          <div class="fx-flip prog">
            <div class="fx-dev back">
              <ProgressCardView card={fx.card} back />
            </div>
            <div class="fx-dev face">
              <ProgressCardView card={fx.card} text />
            </div>
          </div>
        </div>
        {fx.detail && <div class="fx-sub">{fx.detail}</div>}
      </>
    );
  } else if (fx.kind === 'improve') {
    const info = TRACK_INFO[fx.track];
    body = (
      <>
        <div class="fx-title">
          {name(fx.by)} {fx.by === seat ? 'build' : 'builds'} the {improvementName(fx.track, fx.level)}
        </div>
        <div class="fx-improve" style={{ '--tc': info.fill } as Record<string, string>}>
          <span class="fx-imp-art">{fx.metropolis ? <TowerGlyph track={fx.track} fill={colors[fx.by].fill} stroke={colors[fx.by].stroke} /> : <GateGlyph track={fx.track} />}</span>
          <span class="fx-imp-level">
            {[1, 2, 3, 4, 5].map((l) => (
              <span key={l} class={l <= fx.level ? 'on' : ''} />
            ))}
          </span>
        </div>
        <div class="fx-sub">
          {info.label} level {fx.level}
          {fx.metropolis ? ` · the ${fx.track} metropolis: +2 VP` : fx.level === 3 ? ` · ${info.abilityText}` : ''}
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
