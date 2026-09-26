import { COSTS, getScenario, type Action, type GameView, type PartialCounts, type PlayerId } from 'engine';
import type { ComponentChildren } from 'preact';
import { RESOURCE_INFO, RESOURCE_LIST } from '../game/names';
import type { PlayerColor } from '../game/seats';
import { ResGlyph } from './icons';
import { PieceGlyph } from './pieces';
import type { BuildPiece } from './sheets';

/*
 * The actions on wide screens: a grid of build tiles with their costs, the
 * secondary buttons (trade, cards, ...) and one big main action (roll, end
 * turn, ...). Phones keep the compact action bar in GameScreen.
 */

/** Why the current player can't do anything yet, or null in their main phase. */
export function notNowReason(view: GameView, seat: PlayerId): string | null {
  const ph = view.phase;
  if (ph.kind === 'gameOver') return 'The game is over';
  if (view.turn.actor !== seat) return `Wait for your turn (${view.players[view.turn.actor]?.name ?? 'another player'} is playing)`;
  switch (ph.kind) {
    case 'preRoll':
      return 'Roll the dice first';
    case 'setup':
      return 'Place your starting pieces on the board first';
    case 'harborPlacement':
      return 'Place the harbors first';
    case 'robber':
      return 'Move the robber first';
    case 'discard':
      return 'Wait until everyone has discarded';
    case 'gold':
      return 'Wait until everyone has picked their resources';
    case 'roadBuilding':
      return 'Place your free roads first';
    case 'scenario':
      return 'Finish the special move first';
    default:
      return null;
  }
}

const lower = (r: string) => RESOURCE_INFO[r as keyof typeof RESOURCE_INFO].label.toLowerCase();

function costText(cost: PartialCounts): string {
  return RESOURCE_LIST.filter((r) => (cost[r] ?? 0) > 0)
    .map((r) => `${cost[r]} ${lower(r)}`)
    .join(', ');
}

/** What is missing from the hand to pay `cost`, e.g. "1 brick and 2 ore". */
function missingText(cost: PartialCounts, hand: PartialCounts): string {
  const parts = RESOURCE_LIST.filter((r) => (cost[r] ?? 0) > (hand[r] ?? 0)).map((r) => `${(cost[r] ?? 0) - (hand[r] ?? 0)} ${lower(r)}`);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The cost as drawn cards, the ones the player doesn't hold yet faded. */
function CostPips({ cost, hand }: { cost: PartialCounts; hand: PartialCounts }) {
  return (
    <span class="bt-cost">
      {RESOURCE_LIST.flatMap((r) =>
        Array.from({ length: cost[r] ?? 0 }, (_, i) => (
          <span key={`${r}${i}`} class={i < (hand[r] ?? 0) ? 'pip have' : 'pip miss'}>
            <ResGlyph r={r} />
          </span>
        )),
      )}
    </span>
  );
}

/** Two arrows passing each other. */
export function TradeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 8h14M14 4l4 4-4 4" />
      <path d="M20 16H6M10 12l-4 4 4 4" />
    </svg>
  );
}

/** "Next": two chevrons into a bar. */
export function EndIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.5 5.5v13l8-6.5z M11.5 5.5v13l8-6.5z" />
      <rect x="19.5" y="5.5" width="2.2" height="13" rx="1" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="#f1c140" stroke="#a87a10" stroke-width="1.2" stroke-linejoin="round" />
    </svg>
  );
}

export interface DeckButton {
  key: string;
  label: string;
  icon: ComponentChildren;
  /** Keyboard shortcut shown on the button. */
  kbd?: string;
  /** Small count next to the label. */
  badge?: number;
  /** Why it can't be pressed now (shown as its tooltip); null when it can. */
  why?: string | null;
  title?: string;
  tone?: 'roll' | 'end' | 'plain';
  on?: boolean;
  glow?: boolean;
  onClick(): void;
}

function Kbd({ k }: { k?: string }) {
  return k ? (
    <kbd class="key" aria-hidden="true">
      {k}
    </kbd>
  ) : null;
}

function DeckBtn({ b, cls }: { b: DeckButton; cls: string }) {
  const off = !!b.why;
  return (
    <button
      type="button"
      class={`${cls}${b.tone ? ` ${b.tone}` : ''}${b.on ? ' on' : ''}${b.glow ? ' glow' : ''}${b.badge ? ' badged' : ''}`}
      aria-disabled={off || undefined}
      aria-pressed={b.on === undefined ? undefined : b.on}
      aria-keyshortcuts={b.kbd}
      title={b.why ?? b.title}
      onClick={() => !off && b.onClick()}
    >
      <span class="db-icon" aria-hidden="true">
        {b.icon}
        {b.badge ? <span class="db-badge">{b.badge}</span> : null}
      </span>
      <span class="db-label">{b.label}</span>
      <Kbd k={b.kbd} />
    </button>
  );
}

export interface DeckProps {
  view: GameView;
  legal: Action[];
  seat: PlayerId;
  colors: PlayerColor[];
  /** The piece being placed on the board right now, if any. */
  building: BuildPiece | null;
  onBuild(piece: BuildPiece): void;
  onBuyDev(): void;
  secondary: DeckButton[];
  primary: DeckButton[];
  /** Shown in place of the main button while there is none. */
  status: string;
  waiting: boolean;
}

export const BUILD_KEYS = ['1', '2', '3', '4', '5'];

/** The build tiles in order (Seafarers adds the ship), for the grid and the number keys. */
export function buildOrder(view: GameView): Array<BuildPiece | 'dev'> {
  return getScenario(view.scenario).rules.ships ? ['road', 'ship', 'settlement', 'city', 'dev'] : ['road', 'settlement', 'city', 'dev'];
}

export function ActionDeck(props: DeckProps) {
  const { view, legal, seat, colors } = props;
  const me = view.players[seat];
  const hand: PartialCounts = me.resources ?? {};
  const col = colors[seat];
  const later = notNowReason(view, seat);
  const info: Record<BuildPiece | 'dev', { label: string; cost: PartialCounts; act: Action['type']; left: number; none: string; noSpot: string; verb: string }> = {
    road: { label: 'Road', cost: COSTS.road, act: 'buildRoad', left: me.supply.roads, none: 'No roads left', noSpot: 'No free edge next to your roads and buildings', verb: 'Build a road' },
    ship: { label: 'Ship', cost: COSTS.ship, act: 'buildShip', left: me.supply.ships, none: 'No ships left', noSpot: 'No free sea edge next to your ships or coastal buildings', verb: 'Build a ship' },
    settlement: {
      label: 'Settlement',
      cost: COSTS.settlement,
      act: 'buildSettlement',
      left: me.supply.settlements,
      none: 'No settlements left: upgrade one to a city',
      noSpot: 'No free spot: a settlement needs your road and two edges of space',
      verb: 'Build a settlement',
    },
    city: { label: 'City', cost: COSTS.city, act: 'buildCity', left: me.supply.cities, none: 'No cities left', noSpot: 'No settlement of yours to upgrade', verb: 'Upgrade a settlement to a city' },
    dev: { label: 'Dev card', cost: COSTS.devCard, act: 'buyDevCard', left: view.devDeckCount, none: 'The development deck is empty', noSpot: 'Not possible right now', verb: 'Buy a development card' },
  };
  const order = buildOrder(view);

  return (
    <div class="deck">
      <div class="deck-cap">
        <span class="deck-cap-title">
          Build <Kbd k="B" />
        </span>
        <span class="deck-cap-hint keys-only" aria-hidden="true">
          keys <Kbd k="1" />–<Kbd k={BUILD_KEYS[order.length - 1]} />
        </span>
      </div>
      <div class={order.length === 5 ? 'bgrid five' : 'bgrid'} role="group" aria-label="Build" aria-keyshortcuts="B">
        {order.map((key, i) => {
          const it = info[key];
          const ok = legal.some((a) => a.type === it.act);
          const short = missingText(it.cost, hand);
          const why = ok ? null : (later ?? (it.left <= 0 ? it.none : short ? `You need ${short} more` : it.noSpot));
          const state = ok ? 'ready' : !later && short && it.left > 0 ? 'short' : 'blocked';
          const on = props.building === key;
          const tip = why
            ? later && short
              ? `${why} · you need ${short} more`
              : why
            : on
              ? 'Pick a highlighted spot on the board · Esc cancels'
              : `${it.verb} (${costText(it.cost)}) · key ${BUILD_KEYS[i]}`;
          return (
            <button
              type="button"
              key={key}
              class={`btile ${state}${on ? ' on' : ''}${key === 'dev' ? ' dev' : ''}`}
              aria-disabled={!ok || undefined}
              aria-pressed={key === 'dev' ? undefined : on}
              aria-label={`${it.label} (${costText(it.cost)})`}
              aria-keyshortcuts={BUILD_KEYS[i]}
              title={tip}
              onClick={() => {
                if (!ok) return;
                if (key === 'dev') props.onBuyDev();
                else props.onBuild(key);
              }}
            >
              <span class="bt-icon">
                <PieceGlyph kind={key} fill={col.fill} stroke={col.stroke} />
                <span class="bt-left" aria-label={key === 'dev' ? `${it.left} in the deck` : `${it.left} left`}>
                  {it.left}
                </span>
              </span>
              <span class="bt-name">{it.label}</span>
              <CostPips cost={it.cost} hand={hand} />
            </button>
          );
        })}
      </div>
      {props.secondary.length > 0 && (
        <div class="deck-row">
          {props.secondary.map((b) => (
            <DeckBtn key={b.key} b={b} cls="dbtn" />
          ))}
        </div>
      )}
      <div class={props.primary.length > 1 ? 'deck-main split' : 'deck-main'}>
        {props.primary.length > 0 ? (
          props.primary.map((b) => <DeckBtn key={b.key} b={b} cls="dmain" />)
        ) : (
          <div class="deck-wait" role="status">
            {props.waiting && <span class="spinner" aria-hidden="true" />}
            <span>{props.status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
