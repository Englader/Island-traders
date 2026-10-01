import { PROGRESS_CARDS, getScenario, type Action, type GameView, type ImprovementTrack, type PlayerId, type ProgressCardName, type VertexId } from 'engine';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board, NO_TARGETS, type Ghost, type PickKind, type Targets } from '../board/Board';
import { askFor, progressAsk } from '../game/ask';
import { PICK_PROMPT, PICK_STATUS, PLAY_KIND, playsOf, smithSeconds, type PlayAction } from '../game/progress';
import { CARD_INFO, COMMODITY_LIST, RESOURCE_INFO, RESOURCE_LIST, describeAction, harborLabel, progressTitle } from '../game/names';
import { KNIGHT_LABEL, PROGRESS_TEXT, TRACK_INFO, TRACK_LIST, barbarianState, ckPoints, eventText, namesList, progressDeck, sevenLimitOf } from '../game/ck';
import { FX_TIME, mustAct, ROLL_TIMING, SPEED_LABEL, type BotSpeed, type PlayerColor, type SeatKind } from '../game/seats';
import { loadJson, saveJson } from '../game/storage';
import type { ClockFeed } from '../game/clock';
import { ClockIcon, LiveTime, useTimerShown } from './Clock';
import { FxOverlay, fxFor, type FxEvent } from './Fx';
import { DiceRoll, type RollInfo } from './DiceRoll';
import { DiceStatsSheet } from './DiceStats';
import { ActionDeck, BUILD_KEYS, buildOrder, CheckIcon, EndIcon, notNowReason, StarIcon, TradeIcon, type DeckButton } from './ActionDeck';
import { DockedLog, RichText, type LogPrefs } from './GameLog';
import { landBox, roomForLog } from './boardRoom';
import { EndGame } from './EndGame';
import { ConfirmDialog, useAskBeforeBuilding } from './ConfirmDialog';
import { DevCardView, ResourceCard } from './cards';
import type { Flash } from './flash';
import { Die, Sheet, useMedia } from './common';
import { ResGlyph } from './icons';
import { PieceGlyph } from './pieces';
import { EventDie, GateGlyph, HelmIcon, KnightGlyph, ProgressCardView, TowerGlyph } from './ckArt';
import {
  AqueductSheet,
  BarbarianTrack,
  BarbariansSheet,
  CardChoiceSheet,
  CardPickSheet,
  DefenderDrawSheet,
  HarborAnswerSheet,
  ImprovementsSheet,
  KnightBar,
  ProgressDiscardSheet,
  ProgressSheet,
} from './CkPanels';
import { AlchemistSheet, CardBar, HarborOfferSheet, KindPickSheet, MasterMerchantSheet, PlayerPickSheet, SpyTakeSheet, TurnChips } from './ProgressPlay';
import {
  BuildSheet,
  CardsSheet,
  DiscardSheet,
  GoldSheet,
  LogSheet,
  RespondSheet,
  RobAnySheet,
  ScenarioSheet,
  TradeSheet,
  type BuildPiece,
} from './sheets';

export interface GameScreenProps {
  view: GameView;
  legal: Action[];
  seat: PlayerId | null;
  colors: PlayerColor[];
  kinds: SeatKind[];
  send(a: Action): void;
  error: string | null;
  clearError(): void;
  flash: Flash | null;
  /** The latest move and when it happened (for the trade and card animations). */
  last?: { action: Action; at: number } | null;
  /** Local games with computer players: their pace, adjustable from the board. */
  speed?: BotSpeed;
  onSpeed?: (s: BotSpeed) => void;
  onMenu(): void;
  onHome(): void;
  onRematch?: () => void;
  /** Extra line under the status (e.g. online connection state). */
  note?: string;
  /** Online games: the chat button and window, shown over the board. */
  chat?: ComponentChildren;
  /** The game clock (null: this game is not timed). */
  clock?: ClockFeed | null;
}

type Mode =
  | null
  | { kind: 'build'; piece: BuildPiece }
  | { kind: 'moveFrom' }
  | { kind: 'moveTo'; from: string }
  | { kind: 'harbor' }
  | { kind: 'robber'; piece: 'robber' | 'pirate' }
  // Cities & Knights: pick one of your knights, then what it does, then (moving) where it goes
  | { kind: 'knights' }
  | { kind: 'knight'; at: VertexId }
  | { kind: 'knightTo'; from: VertexId }
  // a progress card whose spot is picked on the board (the Inventor and the Smith: `first`, then a second)
  | { kind: 'card'; card: ProgressCardName; first?: string };

type SheetName = null | 'build' | 'trade' | 'cards' | 'scenario' | 'log' | 'scores' | 'dice' | 'improve' | 'barbarians' | 'harbor';

/** How long a moment is shown: the barbarians' attack has three beats, drawn cards turn over. */
function fxTime(kind: string, base: number): number {
  if (kind === 'attack') return Math.max(3600, base * 2.4);
  if (kind === 'draw') return Math.max(2000, base * 1.4);
  return base;
}

/** Knight modes: what the Knights button toggles. */
const KNIGHT_MODES = new Set(['knights', 'knight', 'knightTo']);

/** Wide screens: build tiles and bigger buttons on the side panel, and keyboard shortcuts. */
const DESK = '(min-width: 900px) and (min-height: 620px)';
/** Wider still: the game log docked in the bottom-left corner of the board. */
const DOCK = '(min-width: 1100px) and (min-height: 620px)';
/** Where the docked log's size and folded state are kept. */
const LOG_PREFS = 'ui:log';

function loadLogPrefs(): LogPrefs {
  const p = loadJson<LogPrefs>(LOG_PREFS);
  if (!p || typeof p.open !== 'boolean') return { open: true };
  const px = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined);
  return { open: p.open, w: px(p.w), h: px(p.h) };
}

/** A move picked but not made yet: waiting for the confirm bar or the "Ask before building" dialog. */
interface Pending {
  key: string;
  actions: Action[];
  /** Which of the actions the board shows as the ghost piece (the dialog's choice in view). */
  preview?: number;
  /** Runs once the move is made (e.g. closes the build sheet after buying a card). */
  done?: () => void;
  /** Asked even with "Ask before building" off: a choice to make (the city for a metropolis). */
  force?: boolean;
  /** A progress card about to be played (always asked, with its face): the Smith's second knight. */
  card?: { second?: VertexId };
  /** "No" goes back to the progress cards (nothing was picked on the way). */
  back?: boolean;
}

const BUILD_ACTION: Record<BuildPiece, Action['type']> = {
  road: 'buildRoad',
  ship: 'buildShip',
  settlement: 'buildSettlement',
  city: 'buildCity',
  knight: 'buildKnight',
  wall: 'buildCityWall',
};

function RollIcon() {
  return (
    <span class="roll-icon">
      <Die n={5} />
      <Die n={3} red />
    </span>
  );
}

/** Which board spots are clickable, and the moves available at each. */
function spotActions(view: GameView, legal: Action[], mode: Mode): Map<string, Action[]> {
  const out = new Map<string, Action[]>();
  const add = (key: string, a: Action) => {
    const list = out.get(key);
    if (list) list.push(a);
    else out.set(key, [a]);
  };
  const ph = view.phase.kind;
  for (const a of legal) {
    switch (a.type) {
      case 'placeSettlement':
        add(`v:${a.vertex}`, a);
        break;
      case 'placeRoad':
      case 'placeShip':
        add(`e:${a.edge}`, a);
        break;
      case 'placeHarbor':
        if (ph === 'harborPlacement' || ph === 'scenario' || mode?.kind === 'harbor') add(`e:${a.edge}`, a);
        break;
      case 'buildRoad':
      case 'buildShip':
        if (ph === 'roadBuilding' || (mode?.kind === 'build' && mode.piece === (a.type === 'buildRoad' ? 'road' : 'ship'))) add(`e:${a.edge}`, a);
        break;
      case 'buildSettlement':
        if (mode?.kind === 'build' && mode.piece === 'settlement') add(`v:${a.vertex}`, a);
        break;
      case 'buildCity':
        if (mode?.kind === 'build' && mode.piece === 'city') add(`v:${a.vertex}`, a);
        break;
      case 'moveShip':
        if (mode?.kind === 'moveFrom') add(`e:${a.from}`, a);
        else if (mode?.kind === 'moveTo' && a.from === mode.from) add(`e:${a.to}`, a);
        break;
      case 'moveRobber': {
        const piece = mode?.kind === 'robber' ? mode.piece : null;
        if (piece === null || a.piece === piece) add(`h:${a.hex}`, a);
        break;
      }
      // --- Cities & Knights ---
      case 'buildKnight':
        if (mode?.kind === 'build' && mode.piece === 'knight') add(`v:${a.vertex}`, a);
        break;
      case 'buildCityWall':
        if (mode?.kind === 'build' && mode.piece === 'wall') add(`v:${a.vertex}`, a);
        break;
      case 'activateKnight':
      case 'promoteKnight':
      case 'chaseRobber':
        if (mode?.kind === 'knights') add(`v:${a.vertex}`, a);
        break;
      case 'moveKnight':
      case 'displaceKnight':
        if (mode?.kind === 'knights') add(`v:${a.from}`, a);
        else if (mode?.kind === 'knightTo' && a.from === mode.from) add(`v:${a.to}`, a);
        break;
      case 'pillageCity':
        add(`v:${a.vertex}`, a);
        break;
      case 'retreatKnight':
        add(`v:${a.to}`, a);
        break;
      // a progress card asks for one of your intersections (the Deserter: the knight you remove), or a road (the Diplomat's rebuild)
      case 'progressChoice':
        if (ph === 'ck' && typeof a.args?.vertex === 'string') add(`v:${a.args.vertex}`, a);
        else if (ph === 'ck' && typeof a.args?.edge === 'string') add(`e:${a.args.edge}`, a);
        break;
      // playing a progress card: its spots on the board (the Smith's second knight is added by the caller)
      case 'playProgress': {
        if (mode?.kind !== 'card' || a.card !== mode.card) break;
        const args = a.args ?? {};
        if (typeof args.vertex === 'string') {
          if (!(a.card === 'smith' && mode.first)) add(`v:${args.vertex}`, a);
        } else if (typeof args.hex === 'string') add(`h:${args.hex}`, a);
        else if (typeof args.edge === 'string') add(`e:${args.edge}`, a);
        else if (Array.isArray(args.hexes)) {
          const [h1, h2] = args.hexes as string[];
          if (!mode.first) {
            add(`h:${h1}`, a);
            add(`h:${h2}`, a);
          } else if (h1 === mode.first) add(`h:${h2}`, a);
          else if (h2 === mode.first) add(`h:${h1}`, a);
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function toTargets(spots: Map<string, Action[]>): Targets {
  if (spots.size === 0) return NO_TARGETS;
  const t: Targets = { vertices: new Set(), edges: new Set(), hexes: new Set() };
  for (const key of spots.keys()) {
    const id = key.slice(2);
    if (key[0] === 'v') t.vertices.add(id);
    else if (key[0] === 'e') t.edges.add(id);
    else t.hexes.add(id);
  }
  return t;
}

/** Cities & Knights: the set-up round that places a city instead of a settlement (engine: setupPlacesCity). */
export function setupCity(view: GameView): boolean {
  const ph = view.phase;
  return !!view.ck && ph.kind === 'setup' && !!getScenario(view.scenario).rules.setupRounds[ph.round]?.collect;
}

function ghostFor(a: Action, seat: PlayerId, view: GameView): Ghost | null {
  const knight = (v: VertexId) => view.ck?.knights[v];
  if (a.type === 'placeSettlement' && setupCity(view)) return { kind: 'city', id: a.vertex, owner: seat };
  switch (a.type) {
    case 'buildKnight':
      return { kind: 'knight', id: a.vertex, owner: seat, level: 1, active: false };
    case 'activateKnight': {
      const k = knight(a.vertex);
      return { kind: 'knight', id: a.vertex, owner: seat, level: k?.level ?? 1, active: true };
    }
    case 'promoteKnight': {
      const k = knight(a.vertex);
      return { kind: 'knight', id: a.vertex, owner: seat, level: Math.min(3, (k?.level ?? 1) + 1) as 1 | 2 | 3, active: !!k?.active };
    }
    case 'chaseRobber': {
      const k = knight(a.vertex);
      return { kind: 'knight', id: a.vertex, owner: seat, level: k?.level ?? 1, active: false };
    }
    case 'moveKnight':
    case 'displaceKnight':
      return { kind: 'knight', id: a.to, owner: seat, level: knight(a.from)?.level ?? 1, active: false };
    case 'retreatKnight': {
      const ph = view.phase;
      const k = ph.kind === 'ck' && ph.step === 'retreat' ? ph.knight : null;
      return { kind: 'knight', id: a.to, owner: seat, level: k?.level ?? 1, active: !!k?.active };
    }
    case 'buildCityWall':
      return { kind: 'wall', id: a.vertex, owner: seat };
    case 'improveCity':
      return a.vertex ? { kind: 'metropolis', id: a.vertex, owner: seat, track: a.track } : null;
    case 'placeSettlement':
    case 'buildSettlement':
      return { kind: 'settlement', id: a.vertex, owner: seat };
    case 'buildCity':
      return { kind: 'city', id: a.vertex, owner: seat };
    case 'placeRoad':
    case 'buildRoad':
      return { kind: 'road', id: a.edge, owner: seat };
    case 'placeShip':
    case 'buildShip':
      return { kind: 'ship', id: a.edge, owner: seat };
    case 'moveShip':
      return { kind: 'ship', id: a.to, owner: seat };
    case 'placeHarbor':
      return { kind: 'harbor', id: a.edge, owner: seat };
    case 'moveRobber':
      return { kind: a.piece, id: a.hex, owner: seat };
    // --- progress cards: what the card will do ---
    case 'playProgress': {
      const args = a.args ?? {};
      const v = typeof args.vertex === 'string' ? args.vertex : null;
      switch (a.card) {
        case 'engineer':
          return v ? { kind: 'wall', id: v, owner: seat } : null;
        case 'medicine':
          return v ? { kind: 'city', id: v, owner: seat } : null;
        case 'smith': {
          const k = v ? knight(v) : undefined;
          return v ? { kind: 'knight', id: v, owner: seat, level: Math.min(3, (k?.level ?? 1) + 1) as 1 | 2 | 3, active: !!k?.active } : null;
        }
        case 'intrigue':
          return v ? { kind: 'mark', id: v, owner: seat } : null;
        case 'merchant':
          return typeof args.hex === 'string' ? { kind: 'merchant', id: args.hex, owner: seat } : null;
        case 'diplomat':
          return typeof args.edge === 'string' ? { kind: 'cut', id: args.edge, owner: seat } : null;
        case 'inventor': {
          const [h1, h2] = (args.hexes as string[] | undefined) ?? [];
          if (!h1 || !h2) return null;
          return { kind: 'swap', id: h1, id2: h2, n: view.board.hexes[h2]?.token ?? undefined, n2: view.board.hexes[h1]?.token ?? undefined, owner: seat };
        }
        default:
          return null;
      }
    }
    case 'progressChoice': {
      const ph = view.phase;
      if (ph.kind !== 'ck' || ph.step !== 'card') return null;
      if (typeof a.args?.edge === 'string') return { kind: 'road', id: a.args.edge, owner: seat };
      const v = a.args?.vertex;
      if (typeof v !== 'string') return null;
      if (ph.stage === 'promote') {
        const k = knight(v);
        return { kind: 'knight', id: v, owner: seat, level: Math.min(3, (k?.level ?? 1) + 1) as 1 | 2 | 3, active: !!k?.active };
      }
      if (ph.stage === 'place') {
        const d = ph.data as { level?: 1 | 2 | 3; active?: boolean } | undefined;
        return { kind: 'knight', id: v, owner: seat, level: d?.level ?? 1, active: !!d?.active };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Whether `a` is the follow-up the player chose before playing the card (compared field by field). */
function sameChoice(a: Action, b: Action): boolean {
  if (a.type !== 'progressChoice' || b.type !== 'progressChoice' || a.player !== b.player) return false;
  return JSON.stringify(a.args ?? null) === JSON.stringify(b.args ?? null);
}

function choiceLabel(a: Action, view: GameView): string {
  const name = (p: number) => view.players[p]?.name ?? '';
  switch (a.type) {
    case 'placeRoad':
    case 'buildRoad':
      return 'Road';
    case 'placeShip':
    case 'buildShip':
      return 'Ship';
    case 'moveRobber':
      if (view.phase.kind === 'robber' && view.phase.reason === 'bishop') return 'Move here';
      if (a.victim === undefined) return 'Nobody to rob';
      return a.take === 'cloth' ? `Take cloth from ${name(a.victim)}` : `Rob ${name(a.victim)} (${view.players[a.victim].resourceCount})`;
    case 'moveKnight':
      return 'Move here';
    case 'displaceKnight':
      return 'Displace';
    default:
      return 'Confirm';
  }
}

/** "Ada", "Ada and Björn" for the players a phase waits for. */
function waitingNames(view: GameView, pending: Record<string, number>, seat: PlayerId | null): string {
  return namesList(
    view,
    Object.keys(pending).map(Number),
    seat,
  );
}

/** The status line in a Cities & Knights decision. */
function ckStatus(view: GameView, seat: PlayerId | null): string {
  const ph = view.phase;
  if (ph.kind !== 'ck') return '';
  const name = (p: number) => (p === seat ? 'You' : view.players[p]?.name ?? '');
  switch (ph.step) {
    case 'pillage': {
      if (seat !== null && ph.pending[seat]) return 'Barbarians win: pick a city to lose';
      const n = Object.keys(ph.pending).length;
      return `${waitingNames(view, ph.pending, seat)} choose${n === 1 ? 's' : ''} a city to lose`;
    }
    case 'defenderDraw':
      return ph.queue[0] === seat ? 'Draw a progress card' : `${name(ph.queue[0])} draws a progress card`;
    case 'progressDiscard':
      return seat !== null && ph.pending[seat] ? 'Discard progress cards' : 'Players are discarding progress cards';
    case 'aqueduct':
      return seat !== null && ph.pending[seat] ? 'Aqueduct: take a resource' : 'Players use their Aqueduct';
    case 'retreat':
      return ph.player === seat ? 'Move your displaced knight' : `${name(ph.player)} moves a displaced knight`;
    case 'card': {
      const title = progressTitle(ph.card);
      const by = name(ph.player);
      if (seat !== null && ph.pending?.[seat]) {
        const n = ph.pending[seat];
        const cards = `${n} card${n === 1 ? '' : 's'}`;
        if (ph.stage === 'give') return `${title}: give ${by} ${cards}`;
        if (ph.stage === 'discard') return `${title}: discard ${cards}`;
        if (ph.stage === 'exchange') return `${title}: give ${by} a commodity`;
        if (ph.stage === 'desert') return `${title}: remove one of your knights`;
        return `${title}: your choice`;
      }
      if (ph.player === seat) {
        // your own card waits on others, or on your next choice
        if (ph.pending) {
          const who = Object.keys(ph.pending).map(Number);
          const s = who.length === 1 && who[0] !== seat ? 's' : '';
          const names = waitingNames(view, ph.pending, seat);
          if (ph.stage === 'give') return `${title}: ${names} choose${s} cards for you`;
          if (ph.stage === 'discard') return `${title}: ${names} discard${s}`;
          if (ph.stage === 'exchange') return `${title}: ${names} choose${s} a commodity`;
          if (ph.stage === 'desert') return `${title}: ${names} remove${s} a knight`;
          return `${title}: waiting for ${names}`;
        }
        if (ph.stage === 'promote') return 'Smith: promote a second knight?';
        if (ph.stage === 'place') return 'Deserter: place your knight?';
        if (ph.stage === 'rebuild') return 'Diplomat: place your road again?';
        if (ph.stage === 'take') return ph.card === 'spy' ? 'Spy: take a card, or none' : 'Master Merchant: take your cards';
        return `Finish playing ${title}`;
      }
      return `${by} plays ${title}`;
    }
    default:
      return '';
  }
}

export function statusText(view: GameView, seat: PlayerId | null, legal: Action[]): string {
  const ph = view.phase;
  const name = (p: number) => (p === seat ? 'You' : view.players[p]?.name ?? '');
  const mine = seat !== null && legal.length > 0;
  switch (ph.kind) {
    case 'gameOver':
      return ph.winner === null ? 'Game over' : `${name(ph.winner)} ${ph.winner === seat ? 'win' : 'wins'}!`;
    case 'harborPlacement': {
      const pool = view.ext.harborPool as { next: string | null; remaining: number } | undefined;
      const h = pool?.next ? harborLabel(pool.next as never) : 'harbor';
      return mine ? `Place the ${h} harbor on a coast (${pool?.remaining ?? 0} left)` : `${name(ph.queue[0])} places a harbor`;
    }
    case 'setup': {
      const round = ph.round + 1;
      if (!mine) return `${name(view.turn.actor)} is placing (round ${round})`;
      // Cities & Knights: the round that collects starting resources places a city
      if (ph.step === 'settlement' && setupCity(view)) return 'Place your city';
      return ph.step === 'settlement' ? `Place settlement ${round}` : 'Place a road or ship next to it';
    }
    case 'preRoll':
      return mine ? 'Roll the dice' : `${name(view.turn.actor)}'s turn`;
    case 'discard':
      return seat !== null && ph.pending[seat] !== undefined ? 'Discard half your cards' : 'Players are discarding';
    case 'gold':
      return seat !== null && ph.pending[seat] !== undefined ? 'Choose your free resources' : 'Players are choosing resources';
    case 'robber':
      if (ph.reason === 'chase') return mine ? 'Chase the robber to a numbered hex' : `${name(view.turn.actor)} chases the robber`;
      if (ph.reason === 'bishop') return mine ? 'Bishop: move the robber; everyone next to it pays a card' : `${name(view.turn.actor)} moves the robber (Bishop)`;
      return mine ? 'Move the robber' + (legal.some((a) => a.type === 'moveRobber' && a.piece === 'pirate') ? ' or the pirate' : '') : `${name(view.turn.actor)} moves the robber`;
    case 'ck':
      return ckStatus(view, seat);
    case 'roadBuilding':
      return mine ? `Place ${ph.remaining} free road${ph.remaining === 1 ? '' : 's'} or ship${ph.remaining === 1 ? '' : 's'}` : `${name(view.turn.actor)} is building`;
    case 'specialBuild':
      return mine ? 'Special build phase: build or pass' : `${name(view.turn.actor)} may build`;
    case 'scenario':
      if (ph.step === 'placeHarbor') return mine ? 'Place your new harbor next to your coastal settlement' : `${name(ph.player)} places a harbor`;
      if (ph.step === 'rob') return mine ? 'You may rob any player' : `${name(ph.player)} may rob a player`;
      return `${name(ph.player)} is acting`;
    case 'main': {
      if (seat !== null && view.turn.actor !== seat) {
        const offered = view.turn.trades.some((t) => t.to.includes(seat) && !t.accepted.includes(seat) && !t.rejected.includes(seat));
        return offered ? 'You have a trade offer' : `${name(view.turn.actor)}'s turn`;
      }
      if (!mine) return `${name(view.turn.actor)}'s turn`;
      // Cities & Knights: over the progress card limit, the turn can't end yet
      if (legal.some((a) => a.type === 'discardProgress')) return 'Put back a progress card (you may hold 4)';
      return view.turn.role === 'paired' ? 'Your paired turn' : 'Your turn';
    }
    default:
      return '';
  }
}

export function GameScreen(props: GameScreenProps) {
  const { view, legal, seat, colors, kinds, send } = props;
  const [mode, setMode] = useState<Mode>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [diceFor, setDiceFor] = useState<PlayerId | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // Cities & Knights: a progress card whose choices are made in a sheet (a player, a card kind, the Alchemist's dice)
  const [flow, setFlow] = useState<{ card: ProgressCardName } | null>(null);
  // a choice picked before the card was played, sent once the engine asks for it (the Smith's second knight)
  const [followUp, setFollowUp] = useState<{ action: Action; after: number } | null>(null);
  // "Ask before building" (the menu): builds, buys and placements are confirmed in a dialog
  const askOn = useAskBeforeBuilding();
  const sc = getScenario(view.scenario);
  const ph = view.phase;
  const me = seat !== null ? view.players[seat] : null;
  const desk = useMedia(DESK);
  const dock = useMedia(DOCK);
  // the live timer, unless turned off in the menu
  const timerOn = useTimerShown();
  const live = timerOn && props.clock ? props.clock : null;
  const [logPrefs, setLogPrefsState] = useState<LogPrefs>(loadLogPrefs);
  const setLogPrefs = (p: LogPrefs) => {
    setLogPrefsState(p);
    saveJson(LOG_PREFS, p);
  };
  // Move the board's frame off the docked log where the board has room to spare.
  const areaRef = useRef<HTMLDivElement>(null);
  const land = useMemo(() => landBox(view), [view.board.layoutKey]);
  const [room, setRoom] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!dock || !logPrefs.open || !area || typeof ResizeObserver === 'undefined') {
      setRoom(null);
      return;
    }
    const update = () => {
      const log = area.querySelector<HTMLElement>('.glog');
      if (!log) return;
      // the log, its 12px margin and a little air
      const next = roomForLog({ w: area.clientWidth, h: area.clientHeight }, land, { w: log.offsetWidth + 20, h: log.offsetHeight + 20 });
      setRoom((r) => (r && r.left === next.left && r.bottom === next.bottom ? r : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(area);
    return () => ro.disconnect();
  }, [dock, logPrefs.open, logPrefs.w, logPrefs.h, land]);

  // Reset transient UI when the phase or turn part changes.
  const phaseKey = `${ph.kind}:${view.turn.part}:${ph.kind === 'setup' ? `${ph.round}.${ph.index}.${ph.step}` : ''}`;
  useEffect(() => {
    setPending(null);
    setMode((m) => (m && (ph.kind === 'main' || ph.kind === 'specialBuild') && m.kind !== 'robber' ? m : null));
  }, [phaseKey]);
  // Drop a build mode that no longer has any legal spot.
  const spots = useMemo(() => {
    const out = spotActions(view, legal, mode);
    // the Smith's second knight: any other knight still promotable once the first is
    if (mode?.kind === 'card' && mode.card === 'smith' && mode.first && seat !== null) {
      const plays = playsOf(legal, 'smith');
      const first = plays.find((a) => a.args?.vertex === mode.first);
      if (first) for (const v of smithSeconds(view, seat, plays, mode.first)) out.set(`v:${v}`, [first]);
    }
    return out;
  }, [view, legal, mode]);
  useEffect(() => {
    if (!mode || mode.kind === 'robber') return;
    if (mode.kind === 'knight') {
      // the selected knight is gone (displaced, the turn moved on): nothing to show
      const k = view.ck?.knights[mode.at];
      if (!k || k.owner !== seat || !(ph.kind === 'main' && view.turn.actor === seat)) setMode(null);
      return;
    }
    if (spots.size === 0) setMode(null);
  }, [spots, mode]);
  // A move that is no longer possible (the game has moved on) is not waiting for an answer any more.
  useEffect(() => {
    if (!pending) return;
    const now = new Set(legal.map((a) => JSON.stringify(a)));
    if (!pending.actions.some((a) => now.has(JSON.stringify(a)))) setPending(null);
  }, [legal, pending]);
  useEffect(() => {
    if (!props.error) return;
    const id = setTimeout(props.clearError, 3500);
    return () => clearTimeout(id);
  }, [props.error]);
  // A card chosen in a sheet that can't be played any more (the game moved on): close its sheet.
  useEffect(() => {
    if (flow && !pending && playsOf(legal, flow.card).length === 0) setFlow(null);
  }, [legal, flow, pending]);
  // Send the choice made in advance once the card asks for it; drop it if the card asks nothing.
  useEffect(() => {
    if (!followUp || view.log.length <= followUp.after) return;
    const hit = legal.find((a) => sameChoice(a, followUp.action));
    setFollowUp(null);
    if (hit) send(hit);
  }, [view, legal, followUp]);

  const targets = useMemo(() => toTargets(spots), [spots]);
  const accent = colors[seat ?? view.turn.actor]?.fill ?? '#fff';

  const doSend = (a: Action) => {
    setPending(null);
    if (a.type === 'playProgress') {
      setMode(null);
      setFlow(null);
    }
    if (
      a.type === 'buildRoad' ||
      a.type === 'buildShip' ||
      a.type === 'buildSettlement' ||
      a.type === 'buildCity' ||
      a.type === 'moveShip' ||
      a.type === 'placeHarbor' ||
      a.type === 'buildKnight' ||
      a.type === 'buildCityWall' ||
      a.type === 'chaseRobber'
    ) {
      if (ph.kind !== 'roadBuilding') setMode(null);
    }
    // after a knight's move, pick the next knight (the mode ends by itself when none can do more)
    if (a.type === 'activateKnight' || a.type === 'promoteKnight' || a.type === 'moveKnight' || a.type === 'displaceKnight') setMode({ kind: 'knights' });
    send(a);
  };

  const onPick = (kind: PickKind, id: string) => {
    const key = `${kind[0]}:${id}`;
    const acts = spots.get(key);
    if (!acts || seat === null) return;
    if (mode?.kind === 'moveFrom') {
      setMode({ kind: 'moveTo', from: id });
      setPending(null);
      return;
    }
    if (mode?.kind === 'knights') {
      // a knight is picked: its moves come up in a bar
      setMode({ kind: 'knight', at: id });
      setPending(null);
      return;
    }
    if (mode?.kind === 'card') {
      // the Inventor's first number, the Smith's first knight: then the second
      if (mode.card === 'inventor' && !mode.first) {
        setMode({ ...mode, first: id });
        setPending(null);
        return;
      }
      if (mode.card === 'smith' && !mode.first && smithSeconds(view, seat, playsOf(legal, 'smith'), id).length > 0) {
        setMode({ ...mode, first: id });
        setPending(null);
        return;
      }
      setPending({ key, actions: acts, card: mode.card === 'smith' && mode.first ? { second: id } : {} });
      return;
    }
    setPending({ key, actions: acts });
  };

  const smithSecond = pending?.card?.second;
  const ghost =
    pending && seat !== null
      ? smithSecond && pending.actions[0]?.type === 'playProgress'
        ? ghostFor({ ...pending.actions[0], args: { vertex: smithSecond } }, seat, view)
        : ghostFor(pending.actions[pending.preview ?? 0] ?? pending.actions[0], seat, view)
      : null;
  // builds, buys and placements ask first (the robber and harbors keep the confirm bar); a metropolis always asks which city;
  // a progress card is always asked, with its face
  const ask =
    pending && seat !== null
      ? pending.card && pending.actions[0]?.type === 'playProgress'
        ? progressAsk(pending.actions[0], view, seat, pending.card.second)
        : askOn || pending.force
          ? askFor(pending.actions, view, seat)
          : null
      : null;
  /** Makes a move, or first asks when it is a build or a purchase and the menu says to ask. */
  const askOrSend = (a: Action, key: string, done?: () => void) => {
    if (askOn && seat !== null && askFor([a], view, seat)) {
      setPending({ key, actions: [a], done });
      return;
    }
    doSend(a);
    done?.();
  };
  const buyDev = (done?: () => void) => {
    const a = legal.find((x) => x.type === 'buyDevCard');
    if (a) askOrSend(a, 'dev', done);
  };
  /** Cities & Knights: the next level of a track; a level that wins a metropolis asks which city. */
  const buyImprovement = (track: ImprovementTrack) => {
    const acts = legal.filter((a) => a.type === 'improveCity' && a.track === track);
    if (acts.length === 0) return;
    setSheet(null);
    if (acts.length === 1) askOrSend(acts[0], `imp:${track}`);
    else setPending({ key: `imp:${track}`, actions: acts, force: true });
  };
  const ck = view.ck;
  // a word over the board for a moment (the Knights button with nothing to do)
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(t);
  }, [hint]);
  const toggleKnights = () => {
    setPending(null);
    if (mode && KNIGHT_MODES.has(mode.kind)) return setMode(null);
    const moves = legal.some((a) => a.type === 'activateKnight' || a.type === 'promoteKnight' || a.type === 'moveKnight' || a.type === 'displaceKnight' || a.type === 'chaseRobber');
    if (!moves) {
      const any = Object.values(view.ck?.knights ?? {}).some((k) => k.owner === seat);
      setHint(any ? 'None of your knights can do anything right now' : 'You have no knights yet: hire one with Build → Knight');
      return;
    }
    setMode({ kind: 'knights' });
  };
  const confirmPending = (a: Action) => {
    const was = pending;
    doSend(a);
    was?.done?.();
    if (a.type === 'playProgress' && seat !== null) {
      // the Smith: the second knight (or none) is answered as soon as the engine asks
      if (a.card === 'smith')
        setFollowUp({
          action: was?.card?.second ? { type: 'progressChoice', player: seat, args: { vertex: was.card.second } } : { type: 'progressChoice', player: seat },
          after: view.log.length,
        });
      // the Commercial Harbor: on to the offers; the Crane: on to the improvements, one commodity cheaper
      if (a.card === 'commercialHarbor') setSheet('harbor');
      if (a.card === 'crane') setSheet('improve');
    }
  };
  /**
   * Plays one of your progress cards: its choices first (on the board, or in
   * a sheet), then the confirmation with its face. A card with nothing to
   * choose, or a single choice, goes straight to the confirmation.
   */
  const startPlay = (card: ProgressCardName) => {
    const plays = playsOf(legal, card);
    const kind = PLAY_KIND[card];
    if (seat === null || plays.length === 0 || !kind) return;
    setSheet(null);
    setPending(null);
    setFlow(null);
    const board = kind === 'vertex' || kind === 'hex' || kind === 'edge' || kind === 'smith' || kind === 'hexPair';
    if (kind === 'confirm' || (board && kind !== 'hexPair' && plays.length === 1)) {
      setMode(null);
      setPending({ key: `card:${card}`, actions: [plays[0]], card: {}, back: true });
    } else if (board) setMode({ kind: 'card', card });
    else setFlow({ card });
  };
  /** Leaves a card's choices: the card stays in the hand, which opens again. */
  const cancelCard = () => {
    setPending(null);
    setMode(null);
    setFlow(null);
    setSheet('cards');
  };
  const alchemist = playsOf(legal, 'alchemist').length > 0;

  /** A card's choices made in its sheet: on to the confirmation. */
  const pickCardArgs = (a: PlayAction) => setPending({ key: `card:${a.card}`, actions: [a], card: {} });
  /** What the bar says while a card's spot is picked. */
  const cardPickText = (card: ProgressCardName, first?: string) => {
    const tapWord = desk ? 'Click' : 'Tap';
    if (card === 'inventor' && first) return `${tapWord} the number to swap with the ${view.board.hexes[first]?.token ?? ''}`;
    if (card === 'smith' && first) return `${tapWord} a second knight, or promote only this one`;
    return `${tapWord} ${PICK_PROMPT[card] ?? 'a highlighted spot'}`;
  };
  /** Your own card's next choice on the board (the Smith's second knight, the Deserter's knight, the Diplomat's road), with the way to skip it. */
  const ownStage = (() => {
    if (seat === null || ph.kind !== 'ck' || ph.step !== 'card' || ph.player !== seat || ph.pending) return null;
    const choices = legal.filter((a) => a.type === 'progressChoice');
    if (!choices.some((a) => a.type === 'progressChoice' && (typeof a.args?.vertex === 'string' || typeof a.args?.edge === 'string'))) return null;
    const skip = choices.find((a) => a.type === 'progressChoice' && !a.args);
    const tapWord = desk ? 'Click' : 'Tap';
    if (ph.stage === 'promote') return { card: ph.card, text: `${tapWord} a second knight to promote for free, or stop`, skip, skipLabel: 'Done' };
    if (ph.stage === 'place') {
      const d = ph.data as { level?: 1 | 2 | 3; active?: boolean } | undefined;
      const what = `${KNIGHT_LABEL[d?.level ?? 1].toLowerCase()}${d?.active ? ' (active)' : ''}`;
      return { card: ph.card, text: `${tapWord} a spot on your roads for your ${what}`, skip, skipLabel: 'Skip' };
    }
    if (ph.stage === 'rebuild') return { card: ph.card, text: `${tapWord} where your road goes again, or keep it in your supply`, skip, skipLabel: 'Keep it' };
    return { card: ph.card, text: `${tapWord} a highlighted spot`, skip, skipLabel: 'Skip' };
  })();

  // --- forced sheets ---------------------------------------------------------------
  // Under another sheet (the log, the scores) the choice waits, hidden, with what was picked so far.
  const covered = sheet !== null;
  let forced: JSX.Element | null = null;
  if (seat !== null && me?.resources) {
    if (ph.kind === 'discard' && ph.pending[seat] !== undefined) forced = <DiscardSheet view={view} seat={seat} send={doSend} covered={covered} />;
    else if (ph.kind === 'gold' && ph.pending[seat] !== undefined) forced = <GoldSheet view={view} seat={seat} send={doSend} covered={covered} />;
    else if (ph.kind === 'scenario' && ph.step === 'rob' && ph.player === seat)
      forced = <RobAnySheet view={view} legal={legal} seat={seat} colors={colors} send={doSend} covered={covered} />;
    else if (ph.kind === 'ck' && ph.step === 'progressDiscard' && ph.pending[seat])
      forced = <ProgressDiscardSheet view={view} legal={legal} seat={seat} send={doSend} covered={covered} />;
    else if (ph.kind === 'ck' && ph.step === 'defenderDraw' && ph.queue[0] === seat)
      forced = <DefenderDrawSheet view={view} legal={legal} seat={seat} send={doSend} covered={covered} />;
    else if (ph.kind === 'ck' && ph.step === 'aqueduct' && ph.pending[seat])
      forced = <AqueductSheet view={view} legal={legal} seat={seat} send={doSend} covered={covered} />;
    // a progress card another player played asks something of you
    else if (ph.kind === 'ck' && ph.step === 'card' && ph.pending?.[seat] && (ph.stage === 'give' || ph.stage === 'discard'))
      forced = <CardPickSheet view={view} seat={seat} send={doSend} covered={covered} />;
    else if (ph.kind === 'ck' && ph.step === 'card' && ph.pending?.[seat] && ph.stage === 'exchange')
      forced = <HarborAnswerSheet view={view} legal={legal} seat={seat} send={doSend} covered={covered} />;
    // your own Spy or Master Merchant: what you see, and what you take
    else if (ph.kind === 'ck' && ph.step === 'card' && ph.player === seat && !ph.pending && ph.card === 'spy' && legal.some((a) => a.type === 'progressChoice'))
      forced = <SpyTakeSheet view={view} legal={legal} seat={seat} send={doSend} covered={covered} />;
    else if (ph.kind === 'ck' && ph.step === 'card' && ph.player === seat && !ph.pending && ph.card === 'masterMerchant' && legal.some((a) => a.type === 'progressChoice'))
      forced = <MasterMerchantSheet view={view} seat={seat} send={doSend} covered={covered} />;
    else if (
      ph.kind === 'ck' &&
      ph.step === 'card' &&
      legal.some((a) => a.type === 'progressChoice') &&
      !legal.some((a) => a.type === 'progressChoice' && (typeof a.args?.vertex === 'string' || typeof a.args?.edge === 'string'))
    )
      forced = <CardChoiceSheet view={view} legal={legal} seat={seat} send={doSend} covered={covered} />;
    else if (
      !covered &&
      ph.kind === 'main' &&
      view.turn.actor !== seat &&
      view.turn.trades.some((t) => t.from === view.turn.actor && t.to.includes(seat) && !t.accepted.includes(seat) && !t.rejected.includes(seat))
    )
      forced = <RespondSheet view={view} legal={legal} seat={seat} colors={colors} send={doSend} />;
  }
  const gameOver = ph.kind === 'gameOver';

  // --- action bar ---------------------------------------------------------------------
  const isActor = seat !== null && view.turn.actor === seat;
  const canAct = legal.length > 0;
  const has = (t: Action['type']) => legal.some((a) => a.type === t);
  const robberPieces = [...new Set(legal.filter((a) => a.type === 'moveRobber').map((a) => (a as { piece: 'robber' | 'pirate' }).piece))].sort((a, b) => (a === b ? 0 : a === 'robber' ? -1 : 1));
  const scenarioActions = legal.filter((a) => a.type === 'scenario');
  const heldHarbors = seat !== null ? ((view.ext.heldHarbors as Record<string, unknown[]> | undefined)?.[seat] ?? []) : [];
  const showScenario =
    sc.expansion === 'seafarers' && (view.ext.wonders || view.ext.pirateIslands || view.ext.cloth || heldHarbors.length > 0 || scenarioActions.length > 0);
  const counters = seat !== null ? view.turn.trades.filter((t) => t.from !== seat && t.to.includes(seat)).length : 0;
  // Cities & Knights: progress cards take the development cards' place
  const devCount = ck ? (seat !== null ? ck.players[seat]?.progressCount ?? 0 : 0) : (me?.devCards?.length ?? 0);
  const knightModeOn = !!mode && KNIGHT_MODES.has(mode.kind);
  const knightMoves = legal.some((a) => a.type === 'activateKnight' || a.type === 'promoteKnight' || a.type === 'moveKnight' || a.type === 'displaceKnight' || a.type === 'chaseRobber');
  const canImprove = legal.some((a) => a.type === 'improveCity');
  const waitingFor = mustAct(view).filter((p) => p !== seat);
  const status = mode?.kind === 'card' ? `${progressTitle(mode.card)}: ${PICK_STATUS[mode.card] ?? 'pick a spot'}` : statusText(view, seat, legal);

  const bar: JSX.Element[] = [];
  if (isActor && canAct && !gameOver) {
    if (ph.kind === 'preRoll') {
      bar.push(
        <button type="button" key="roll" class="action primary big" onClick={() => doSend({ type: 'rollDice', player: seat! })}>
          <span class="ai">🎲</span>
          <span class="al">Roll</span>
        </button>,
      );
      if (alchemist)
        bar.push(
          <button type="button" key="alchemist" class="action alc-action" onClick={() => startPlay('alchemist')} title="Choose both production dice instead of rolling">
            <span class="ai ai-card">
              <ProgressCardView card="alchemist" look="mini" />
            </span>
            <span class="al">Alchemist</span>
          </button>,
        );
      if (has('playKnight') || devCount > 0)
        bar.push(
          <button type="button" key="cards" class="action" onClick={() => setSheet('cards')}>
            <span class="ai">🃏</span>
            <span class="al">Cards{devCount > 0 ? ` ${devCount}` : ''}</span>
          </button>,
        );
    } else if (ph.kind === 'main' || ph.kind === 'specialBuild') {
      bar.push(
        <button type="button" key="build" class={mode?.kind === 'build' ? 'action on' : 'action'} onClick={() => (mode?.kind === 'build' ? setMode(null) : setSheet('build'))}>
          <span class="ai">{mode?.kind === 'build' ? '✕' : '🔨'}</span>
          <span class="al">{mode?.kind === 'build' ? 'Cancel' : 'Build'}</span>
        </button>,
      );
      if (ph.kind === 'main') {
        bar.push(
          <button type="button" key="trade" class="action" onClick={() => setSheet('trade')}>
            <span class="ai">🤝</span>
            <span class="al">Trade{counters > 0 ? ` (${counters})` : ''}</span>
          </button>,
        );
        bar.push(
          <button type="button" key="cards" class={has('discardProgress') ? 'action glow' : 'action'} onClick={() => setSheet('cards')}>
            <span class="ai">🃏</span>
            <span class="al">Cards{devCount > 0 ? ` ${devCount}` : ''}</span>
          </button>,
        );
        if (ck) {
          bar.push(
            <button type="button" key="knights" class={knightModeOn ? 'action on' : 'action'} onClick={toggleKnights} aria-pressed={knightModeOn}>
              <span class="ai">{knightModeOn ? '✕' : <span class="ai-helm"><HelmIcon /></span>}</span>
              <span class="al">{knightModeOn ? 'Cancel' : 'Knights'}</span>
            </button>,
          );
          bar.push(
            <button type="button" key="improve" class={canImprove ? 'action glow' : 'action'} onClick={() => setSheet('improve')}>
              <span class="ai ai-gate">
                <GateGlyph track="science" />
              </span>
              <span class="al">Improve</span>
            </button>,
          );
        }
        if (has('moveShip'))
          bar.push(
            <button
              type="button"
              key="move"
              class={mode?.kind === 'moveFrom' || mode?.kind === 'moveTo' ? 'action on' : 'action'}
              onClick={() => setMode(mode?.kind === 'moveFrom' || mode?.kind === 'moveTo' ? null : { kind: 'moveFrom' })}
            >
              <span class="ai">{mode?.kind === 'moveFrom' || mode?.kind === 'moveTo' ? '✕' : '⛵'}</span>
              <span class="al">{mode?.kind === 'moveFrom' || mode?.kind === 'moveTo' ? 'Cancel' : 'Move ship'}</span>
            </button>,
          );
        if (showScenario)
          bar.push(
            <button type="button" key="scen" class={scenarioActions.length > 0 || heldHarbors.length > 0 ? 'action glow' : 'action'} onClick={() => setSheet('scenario')}>
              <span class="ai">⭐</span>
              <span class="al">Special</span>
            </button>,
          );
      }
      if (has('endTurn'))
        bar.push(
          <button type="button" key="end" class="action end" onClick={() => doSend({ type: 'endTurn', player: seat! })}>
            <span class="ai">⏭</span>
            <span class="al">End turn</span>
          </button>,
        );
    } else if (ph.kind === 'roadBuilding') {
      bar.push(
        <button type="button" key="done" class="action" onClick={() => doSend({ type: 'endRoadBuilding', player: seat! })}>
          <span class="ai">✓</span>
          <span class="al">Done building</span>
        </button>,
      );
    } else if (ph.kind === 'robber' && robberPieces.length > 1) {
      for (const piece of robberPieces)
        bar.push(
          <button
            type="button"
            key={piece}
            class={(mode?.kind === 'robber' ? mode.piece : robberPieces[0]) === piece ? 'action on' : 'action'}
            onClick={() => {
              setPending(null);
              setMode({ kind: 'robber', piece });
            }}
          >
            <span class="ai">{piece === 'robber' ? '🥷' : '🏴‍☠️'}</span>
            <span class="al">{piece === 'robber' ? 'Robber' : 'Pirate'}</span>
          </button>,
        );
    }
  }
  // Default the robber phase to the first piece so both kinds aren't mixed.
  useEffect(() => {
    if (ph.kind === 'robber' && isActor && robberPieces.length > 1 && mode?.kind !== 'robber') setMode({ kind: 'robber', piece: robberPieces[0] });
  }, [ph.kind, isActor, robberPieces.length]);

  // --- wide screens: the action deck ------------------------------------------------------
  const later = seat !== null ? notNowReason(view, seat) : null;
  const moving = mode?.kind === 'moveFrom' || mode?.kind === 'moveTo';
  const buildMode = mode?.kind === 'build' ? mode.piece : null;
  const toggleBuild = (piece: BuildPiece) => {
    setPending(null);
    setMode(buildMode === piece ? null : { kind: 'build', piece });
  };
  const roll = isActor && canAct && ph.kind === 'preRoll' ? () => doSend({ type: 'rollDice', player: seat! }) : null;
  const finish =
    isActor && canAct && !gameOver
      ? (ph.kind === 'main' || ph.kind === 'specialBuild') && has('endTurn')
        ? () => doSend({ type: 'endTurn', player: seat! })
        : ph.kind === 'roadBuilding'
          ? () => doSend({ type: 'endRoadBuilding', player: seat! })
          : null
      : null;
  const tradeWhy =
    later ??
    (ph.kind !== 'main'
      ? 'No trading in the special build phase'
      : view.options.tradeBuildMode === 'separate' && view.turn.buildingStarted
        ? 'No more trading once you have built this turn'
        : null);
  const primary: DeckButton[] = [];
  const secondary: DeckButton[] = [];
  if (desk && seat !== null && me?.resources && !gameOver) {
    if (roll) {
      primary.push({ key: 'roll', label: 'Roll', icon: <RollIcon />, kbd: 'R', tone: 'roll', title: 'Roll the dice', onClick: roll });
      if (alchemist)
        primary.push({
          key: 'alchemist',
          label: 'Alchemist',
          icon: <ProgressCardView card="alchemist" look="mini" />,
          kbd: 'A',
          tone: 'plain',
          title: 'Play the Alchemist: choose both production dice instead of rolling',
          onClick: () => startPlay('alchemist'),
        });
    }
    else if (finish && ph.kind === 'roadBuilding')
      primary.push({ key: 'done', label: 'Done building', icon: <CheckIcon />, kbd: 'E', tone: 'end', title: 'Stop placing free roads', onClick: finish });
    else if (finish) primary.push({ key: 'end', label: 'End turn', icon: <EndIcon />, kbd: 'E', tone: 'end', title: 'Pass the dice to the next player', onClick: finish });
    else if (isActor && ph.kind === 'robber' && robberPieces.length > 1) {
      for (const piece of robberPieces)
        primary.push({
          key: piece,
          label: piece === 'robber' ? 'Robber' : 'Pirate',
          icon: piece === 'robber' ? '🥷' : '🏴‍☠️',
          tone: 'plain',
          on: (mode?.kind === 'robber' ? mode.piece : robberPieces[0]) === piece,
          title: piece === 'robber' ? 'Move the robber to a land tile' : 'Move the pirate to a sea tile',
          onClick: () => {
            setPending(null);
            setMode({ kind: 'robber', piece });
          },
        });
    }
    secondary.push({
      key: 'trade',
      label: 'Trade',
      icon: <TradeIcon />,
      kbd: 'T',
      badge: tradeWhy === null ? counters : 0,
      why: tradeWhy,
      title: 'Trade with other players or the bank',
      onClick: () => setSheet('trade'),
    });
    if (ck) {
      secondary.push({
        key: 'cards',
        label: 'Progress',
        icon: <ProgressCardView deck="science" back look="mini" />,
        kbd: 'C',
        badge: devCount,
        glow: has('discardProgress'),
        why: devCount > 0 || (ck.players[seat].vpCards.length ?? 0) > 0 ? null : 'No progress cards yet: the event die’s city gates draw them',
        title: 'Your progress cards',
        onClick: () => setSheet('cards'),
      });
      secondary.push({
        key: 'knights',
        label: knightModeOn ? 'Cancel' : 'Knights',
        icon: <KnightGlyph level={2} active fill={colors[seat].fill} stroke={colors[seat].stroke} />,
        kbd: 'K',
        on: knightModeOn,
        why: knightModeOn ? null : (later ?? (knightMoves ? null : 'None of your knights can do anything now')),
        title: 'Activate, promote and move your knights',
        onClick: toggleKnights,
      });
      secondary.push({
        key: 'improve',
        label: 'Improve',
        icon: <GateGlyph track="trade" />,
        kbd: 'I',
        glow: canImprove,
        title: 'City improvements: trade, politics and science',
        onClick: () => setSheet('improve'),
      });
    } else
      secondary.push({
        key: 'cards',
        label: 'Play card',
        icon: <PieceGlyph kind="dev" fill="#6a48c4" stroke="#3b2273" />,
        kbd: 'C',
        badge: devCount,
        why: devCount > 0 ? null : 'No development cards yet: buy one with the Dev card tile',
        title: 'Your development cards',
        onClick: () => setSheet('cards'),
      });
    if (isActor && ph.kind === 'main' && has('moveShip'))
      secondary.push({
        key: 'move',
        label: moving ? 'Cancel move' : 'Move ship',
        icon: <PieceGlyph kind="ship" fill={colors[seat].fill} stroke={colors[seat].stroke} />,
        on: moving,
        title: 'Move one of your open-ended ships',
        onClick: () => setMode(moving ? null : { kind: 'moveFrom' }),
      });
    if (showScenario)
      secondary.push({
        key: 'scen',
        label: 'Special',
        icon: <StarIcon />,
        glow: scenarioActions.length > 0 || heldHarbors.length > 0,
        title: sc.name,
        onClick: () => setSheet('scenario'),
      });
  }

  // A short side panel lists the players two by two so the main button stays on screen.
  const panelRef = useRef<HTMLDivElement>(null);
  const [tight, setTight] = useState(false);
  const roomy = useRef(0);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!desk || !el || typeof ResizeObserver === 'undefined') {
      setTight(false);
      return;
    }
    const check = () => {
      if (!tight) {
        if (el.scrollHeight > el.clientHeight + 1) {
          // remember how tall the roomy layout was, to go back once there is room
          roomy.current = el.scrollHeight;
          setTight(true);
        }
      } else if (el.clientHeight >= roomy.current) setTight(false);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desk, tight, view.players.length, sc.id, primary.length, secondary.length]);

  // Keyboard: Esc closes a sheet or cancels a move; on wide screens R rolls, E ends
  // the turn, T trades, C shows the development cards, B goes to the build tiles
  // and 1-5 pick one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const covered = document.querySelector('.sheet-backdrop, .confirm-backdrop') !== null;
      if (e.key === 'Escape') {
        if (sheet) setSheet(null);
        else if (flow) cancelCard();
        else if (covered) return;
        else if (pending) setPending(null);
        else if (mode?.kind === 'card') {
          if (mode.first) setMode({ kind: 'card', card: mode.card });
          else cancelCard();
        }
        else if (mode?.kind === 'knight' || mode?.kind === 'knightTo') setMode({ kind: 'knights' });
        else if (mode && mode.kind !== 'robber') setMode(null);
        else return;
        e.preventDefault();
        return;
      }
      if (!desk || e.repeat || covered || document.querySelector('.roll-overlay')) return;
      const k = e.key.toLowerCase();
      const slot = BUILD_KEYS.indexOf(k);
      const piece = slot >= 0 ? buildOrder(view)[slot] : undefined;
      if (k === 'r' && roll) roll();
      else if (k === 'a' && roll && alchemist) startPlay('alchemist');
      else if (k === 'e' && finish) finish();
      else if (k === 't' && seat !== null && tradeWhy === null) setSheet('trade');
      else if (k === 'c' && seat !== null && (devCount > 0 || (ck?.players[seat]?.vpCards.length ?? 0) > 0)) setSheet('cards');
      else if (k === 'k' && ck && seat !== null && (knightModeOn || (later === null && knightMoves))) toggleKnights();
      else if (k === 'i' && ck && seat !== null) setSheet('improve');
      else if (k === 'b' && seat !== null) {
        // the build tiles are the build menu here: move the keyboard focus to them
        const tile = document.querySelector<HTMLElement>('.bgrid .btile.ready') ?? document.querySelector<HTMLElement>('.bgrid .btile');
        if (!tile) return;
        tile.focus();
      } else if (piece === 'dev' && has('buyDevCard')) buyDev();
      else if (piece && piece !== 'dev' && has(BUILD_ACTION[piece])) toggleBuild(piece);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const dice = view.turn.dice;
  // A new roll plays the dice animation; the header dice, the glowing tiles
  // and the event feed wait until the dice have landed. A roll that was
  // already there when the screen opened is not replayed.
  const rollFlash = props.flash?.kind === 'roll' ? props.flash : null;
  const seenRoll = useRef<number | null>(rollFlash?.key ?? null);
  const headerDice = useRef<HTMLDivElement>(null);
  const [rolling, setRolling] = useState<RollInfo | null>(null);
  // Trades and development cards are shown in the middle of the screen too.
  const prevView = useRef(view);
  const seenFx = useRef(props.last?.at ?? 0);
  const [fx, setFx] = useState<(FxEvent & { key: number }) | null>(null);
  useEffect(() => {
    const l = props.last;
    if (l && l.at !== seenFx.current) {
      seenFx.current = l.at;
      const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const e = fxFor(l.action, prevView.current, view, seat);
      if (e && !reduced) setFx({ ...e, key: l.at });
      // without motion, the barbarians' attack and the cards you draw are still told, in a note that stays still
      else if (e?.kind === 'attack') setEventNote({ key: l.at, title: `The barbarians attack: ${e.barbarians} against ${e.knights}`, sub: e.outcome, tone: 'attack' });
      else if (e?.kind === 'draw' && e.draws.some((d) => d.p === seat && d.card))
        setEventNote({ key: l.at, title: `You draw ${e.draws.filter((d) => d.p === seat && d.card).map((d) => progressTitle(d.card!)).join(' and ')}`, sub: 'A progress card', tone: e.draws[0].deck });
      else if (e?.kind === 'progPlay' && e.by !== seat) {
        const who = view.players[e.by]?.name ?? 'A player';
        const on = e.target === undefined ? '' : ` on ${e.target === seat ? 'you' : view.players[e.target]?.name}`;
        setEventNote({ key: l.at, title: `${who} plays ${progressTitle(e.card)}${on}`, sub: e.detail || PROGRESS_TEXT[e.card], tone: progressDeck(e.card) });
      }
    }
    prevView.current = view;
  }, [view]);
  // Cities & Knights: what the event die did (shown under the rolling dice, or for a moment over the board)
  const [eventNote, setEventNote] = useState<{ key: number; title: string; sub: string; tone: string } | null>(null);
  useEffect(() => {
    if (!rollFlash || rollFlash.key === seenRoll.current) return;
    seenRoll.current = rollFlash.key;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const event = view.ck?.event ?? null;
    const caption = dice && event ? { ...eventText(view, event, dice[1], seat), tone: event === 'ship' ? (view.ck!.barbarians === 0 ? 'attack' : 'ship') : event } : null;
    if (dice && !reduced) setRolling({ key: rollFlash.key, dice: [dice[0], dice[1]], ...(event && caption ? { event, caption: caption as RollInfo['caption'] } : {}) });
    // (an attack's note comes with its outcome, from the effect above)
    else if (caption && caption.tone !== 'attack') setEventNote((n) => (n && n.tone === 'attack' ? n : { key: rollFlash.key, ...caption }));
  }, [rollFlash?.key]);
  useEffect(() => {
    if (!eventNote) return;
    const t = setTimeout(() => setEventNote(null), eventNote.tone === 'attack' ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [eventNote?.key]);
  // The latest few events, each marked with the colour of the player it is about.
  // (Wide screens show the whole log in the corner instead.)
  const feed = dock
    ? []
    : view.log
        .map((e, i) => ({ msg: e.msg, i }))
        .filter((e) => !e.msg.startsWith('---'))
        .slice(-3)
        .map((e) => {
          const who = view.players.find((p) => e.msg.startsWith(p.name + ' ') || e.msg.startsWith('(' + p.name + ' '));
          return { ...e, color: who ? colors[who.id]?.fill : undefined };
        });
  const nextSpeed: Record<BotSpeed, BotSpeed> = { slow: 'normal', normal: 'fast', fast: 'slow' };
  const speedShort: Record<BotSpeed, string> = { slow: '½×', normal: '1×', fast: '2×' };
  const tap = desk ? 'Click' : 'Tap';

  return (
    <div class="game">
      <header class="hud" style={{ '--pc': colors[view.turn.actor]?.fill } as Record<string, string>}>
        <button type="button" class="icon-btn" aria-label="Menu" onClick={props.onMenu}>
          ☰
        </button>
        <div class="hud-main">
          <div class="status-text">
            {status}
            {!canAct && !gameOver && waitingFor.length > 0 && <span class="spinner" aria-hidden="true" />}
          </div>
          <div class="sub">
            <span class="sub-main">
              {ck ? 'Cities & Knights' : sc.name} · Turn {view.turn.number} · {view.victoryTarget} VP
            </span>
            {live && (
              <span class="hud-clock" title={gameOver ? 'Game time' : 'Game time so far (active play)'}>
                <span aria-hidden="true">{' · '}</span>
                <ClockIcon />
                <span class="sr-only">Game time </span>
                <LiveTime feed={live} pick={(c) => c.playedMs} />
              </span>
            )}
            {props.note && <span class="sub-note">{` · ${props.note}`}</span>}
          </div>
        </div>
        {ck && <BarbarianTrack view={view} onOpen={() => setSheet('barbarians')} />}
        <div
          class={ck ? 'dice three' : 'dice'}
          ref={headerDice}
          style={rolling ? { visibility: 'hidden' } : undefined}
          key={dice ? `${view.turn.number}-${dice[0]}-${dice[1]}-${ck?.event ?? ''}` : 'none'}
          aria-label={dice ? `rolled ${dice[0] + dice[1]}${ck?.event ? `, event ${ck.event === 'ship' ? 'barbarian ship' : `${TRACK_INFO[ck.event].colorName} gate`}` : ''}` : 'no roll yet'}
        >
          {dice ? (
            <>
              <Die n={dice[0]} />
              <Die n={dice[1]} red />
              {ck?.event && <EventDie face={ck.event} />}
            </>
          ) : null}
        </div>
      </header>
      {fx && !rolling && (
        <FxOverlay
          fx={fx}
          view={view}
          colors={colors}
          seat={seat}
          ms={fxTime(fx.kind, FX_TIME[props.speed ?? 'normal'])}
          onDone={() => setFx(null)}
        />
      )}
      {rolling && (
        <DiceRoll
          roll={rolling}
          timing={ROLL_TIMING[props.speed ?? 'normal']}
          targets={() => Array.from(headerDice.current?.querySelectorAll('.die') ?? [])}
          onDone={() => setRolling(null)}
        />
      )}
      {props.error && (
        <div class="toast" role="alert" onClick={props.clearError}>
          {props.error}
        </div>
      )}

      <div
        ref={areaRef}
        class={dock ? 'board-area docked' : 'board-area'}
        style={
          dock
            ? ({
                '--log-w': logPrefs.w ? `${logPrefs.w}px` : undefined,
                '--log-h': logPrefs.h ? `${logPrefs.h}px` : undefined,
                '--fit-left': room ? `${room.left}px` : undefined,
                '--fit-bottom': room ? `${room.bottom}px` : undefined,
              } as Record<string, string>)
            : undefined
        }
      >
        <Board
          view={view}
          colors={colors}
          targets={targets}
          accent={accent}
          ghost={ghost}
          selected={mode?.kind === 'knight' ? mode.at : mode?.kind === 'knightTo' ? mode.from : mode?.kind === 'card' && mode.card === 'smith' ? (mode.first ?? null) : null}
          selectedHex={mode?.kind === 'card' && mode.card === 'inventor' ? (mode.first ?? null) : null}
          focusTokens={mode?.kind === 'card' && mode.card === 'inventor'}
          flash={rolling && rollFlash ? null : props.flash}
          onPick={onPick}
          tools={
            <>
              {props.speed && props.onSpeed && kinds.includes('bot') && (
                <button
                  type="button"
                  class="speed-chip"
                  onClick={() => props.onSpeed!(nextSpeed[props.speed!])}
                  aria-label={`Computer speed: ${SPEED_LABEL[props.speed]}. Tap to change.`}
                  title={`Computer speed: ${SPEED_LABEL[props.speed]}`}
                >
                  {speedShort[props.speed]}
                </button>
              )}
              <button
                type="button"
                class="log-chip"
                onClick={() => (dock ? setLogPrefs({ ...logPrefs, open: !logPrefs.open }) : setSheet('log'))}
                aria-label="Game log"
                title="Game log"
              >
                📜
              </button>
              <button
                type="button"
                class="log-chip"
                onClick={() => {
                  setDiceFor(null);
                  setSheet('dice');
                }}
                aria-label="Dice statistics"
                title="Dice statistics"
              >
                📊
              </button>
            </>
          }
        />
        {feed.length > 0 && (
          <div class={rolling || eventNote ? 'feed hushed' : 'feed'} aria-live="polite">
            {feed.map((e, k) => (
              <span key={e.i} class={`feed-line age-${feed.length - 1 - k}`}>
                <span class="feed-dot" style={{ background: e.color ?? 'transparent' }} />
                <span class="feed-text">
                  <RichText msg={e.msg} view={view} colors={colors} />
                </span>
              </span>
            ))}
          </div>
        )}
        {dock && <DockedLog view={view} colors={colors} prefs={logPrefs} onPrefs={setLogPrefs} />}
        {pending && !ask && (
          <div class="confirm-bar">
            <span>{pending.actions.length === 1 ? describeAction(pending.actions[0], view) : 'Choose:'}</span>
            <div class="confirm-buttons">
              {pending.actions.length === 1 ? (
                <button type="button" class="primary" onClick={() => doSend(pending.actions[0])}>
                  ✓ Confirm
                </button>
              ) : (
                pending.actions.map((a, i) => (
                  <button type="button" class="primary" key={i} onClick={() => doSend(a)}>
                    {choiceLabel(a, view)}
                  </button>
                ))
              )}
              <button type="button" onClick={() => setPending(null)}>
                ✕
              </button>
            </div>
          </div>
        )}
        {!pending && mode && mode.kind !== 'robber' && mode.kind !== 'knight' && mode.kind !== 'card' && (
          <div class="mode-hint">
            {mode.kind === 'build'
              ? mode.piece === 'knight'
                ? `${tap} a spot on your roads to hire a knight`
                : mode.piece === 'wall'
                  ? `${tap} one of your cities to wall it`
                  : `${tap} a highlighted spot to build a ${mode.piece}`
              : mode.kind === 'moveFrom'
                ? `${tap} the ship to move`
                : mode.kind === 'moveTo'
                  ? `${tap} where the ship should go`
                  : mode.kind === 'knights'
                    ? `${tap} one of your knights`
                    : mode.kind === 'knightTo'
                      ? legal.some((a) => a.type === 'displaceKnight' && a.from === mode.from)
                        ? `${tap} where it goes, or a weaker knight to displace`
                        : `${tap} where the knight goes`
                      : `${tap} a coast next to your settlement`}
            {desk ? ' · Esc cancels' : ''}
          </div>
        )}
        {!pending && !mode && ph.kind === 'ck' && seat !== null && ((ph.step === 'pillage' && ph.pending[seat]) || (ph.step === 'retreat' && ph.player === seat)) && (
          <div class="mode-hint forced-hint">
            {ph.step === 'pillage' ? `${tap} the city you lose (it becomes a settlement)` : `${tap} where your displaced knight retreats`}
          </div>
        )}
        {!pending && !mode && ph.kind === 'ck' && ph.step === 'card' && seat !== null && ph.player !== seat && legal.some((a) => a.type === 'progressChoice' && typeof a.args?.vertex === 'string') && (
          <div class="mode-hint forced-hint">
            {ph.stage === 'desert' ? `${tap} the knight you remove (${view.players[ph.player]?.name} played the ${progressTitle(ph.card)})` : `${tap} a highlighted spot (${progressTitle(ph.card)})`}
          </div>
        )}
        {!pending && mode?.kind === 'card' && seat !== null && (
          <CardBar card={mode.card} text={cardPickText(mode.card, mode.first)} onCancel={cancelCard}>
            {mode.first && mode.card === 'smith' && (
              <button
                type="button"
                class="primary"
                onClick={() => {
                  const first = playsOf(legal, 'smith').find((a) => a.args?.vertex === mode.first);
                  if (first) setPending({ key: `v:${mode.first}`, actions: [first], card: {} });
                }}
              >
                Only this one
              </button>
            )}
            {mode.first && (
              <button type="button" onClick={() => setMode({ kind: 'card', card: mode.card })}>
                Back
              </button>
            )}
          </CardBar>
        )}
        {!pending && !mode && !followUp && ownStage && (
          <CardBar card={ownStage.card} text={ownStage.text}>
            {ownStage.skip && (
              <button type="button" onClick={() => doSend(ownStage.skip!)}>
                {ownStage.skipLabel}
              </button>
            )}
          </CardBar>
        )}
        {!pending && mode?.kind === 'knight' && seat !== null && (
          <KnightBar
            view={view}
            legal={legal}
            at={mode.at}
            color={colors[seat]}
            onAct={(a) => askOrSend(a, `kn:${a.type}:${mode.at}`)}
            onMove={() => setMode({ kind: 'knightTo', from: mode.at })}
            onClose={() => setMode({ kind: 'knights' })}
          />
        )}
        {hint && !pending && !mode && (
          <div class="mode-hint" role="status">
            {hint}
          </div>
        )}
        {eventNote && (
          <div class={`event-note tone-${eventNote.tone}`} role="status" key={eventNote.key}>
            <b>{eventNote.title}</b>
            <span>{eventNote.sub}</span>
          </div>
        )}
        {props.chat}
      </div>

      <div ref={panelRef} class={desk ? (tight ? 'panel desk tight' : 'panel desk') : 'panel'}>
        <Players view={view} colors={colors} kinds={kinds} seat={seat} desk={desk} clock={live} onOpen={() => setSheet('scores')} />
        {desk && me?.resources ? (
          <div class="tray">
            <Hand view={view} seat={seat!} desk onCards={() => setSheet('cards')} />
            {ck && <TurnChips view={view} seat={seat} onHarbor={() => setSheet('harbor')} />}
            {!gameOver && (
              <ActionDeck
                view={view}
                legal={legal}
                seat={seat!}
                colors={colors}
                building={buildMode}
                onBuild={toggleBuild}
                onBuyDev={() => buyDev()}
                primary={primary}
                secondary={secondary}
                status={status}
                waiting={!canAct && waitingFor.length > 0}
              />
            )}
          </div>
        ) : (
          <>
            {me?.resources && <Hand view={view} seat={seat!} desk={false} onCards={() => setSheet('cards')} />}
            {ck && <TurnChips view={view} seat={seat} onHarbor={() => setSheet('harbor')} />}
            <nav class={bar.length >= 6 ? 'action-bar six' : 'action-bar'}>{bar}</nav>
          </>
        )}
      </div>

      {sheet === 'build' && seat !== null && (
        <BuildSheet
          view={view}
          legal={legal}
          seat={seat}
          colors={colors}
          send={doSend}
          close={() => setSheet(null)}
          buyDev={() => buyDev(() => setSheet(null))}
          choose={(piece) => {
            setSheet(null);
            setMode({ kind: 'build', piece });
          }}
          improve={() => setSheet('improve')}
        />
      )}
      {sheet === 'trade' && seat !== null && <TradeSheet view={view} legal={legal} seat={seat} colors={colors} send={doSend} close={() => setSheet(null)} />}
      {sheet === 'cards' && seat !== null && !ck && <CardsSheet view={view} legal={legal} seat={seat} colors={colors} send={doSend} close={() => setSheet(null)} />}
      {sheet === 'cards' && seat !== null && ck && (
        <ProgressSheet view={view} legal={legal} seat={seat} send={doSend} close={() => setSheet(null)} onPlay={startPlay} desk={desk} />
      )}
      {sheet === 'harbor' && seat !== null && ck && <HarborOfferSheet view={view} legal={legal} seat={seat} colors={colors} send={doSend} close={() => setSheet(null)} />}
      {flow && seat !== null && !gameOver && sheet === null && PLAY_KIND[flow.card] === 'player' && (
        <PlayerPickSheet view={view} seat={seat} colors={colors} card={flow.card} legal={legal} onPick={pickCardArgs} onCancel={cancelCard} />
      )}
      {flow && seat !== null && !gameOver && sheet === null && PLAY_KIND[flow.card] === 'kind' && (
        <KindPickSheet view={view} seat={seat} card={flow.card} legal={legal} onPick={pickCardArgs} onCancel={cancelCard} />
      )}
      {flow && seat !== null && !gameOver && sheet === null && PLAY_KIND[flow.card] === 'dice' && (
        <AlchemistSheet view={view} seat={seat} legal={legal} onPick={pickCardArgs} onCancel={cancelCard} />
      )}
      {sheet === 'improve' && ck && (
        <ImprovementsSheet view={view} legal={legal} seat={seat} colors={colors} later={seat !== null ? notNowReason(view, seat) : null} onBuy={buyImprovement} close={() => setSheet(null)} />
      )}
      {sheet === 'barbarians' && ck && <BarbariansSheet view={view} colors={colors} seat={seat} close={() => setSheet(null)} />}
      {sheet === 'scenario' && seat !== null && (
        <ScenarioSheet
          view={view}
          legal={legal}
          seat={seat}
          colors={colors}
          send={(a) => askOrSend(a, 'scenario')}
          close={() => setSheet(null)}
          placeHarbor={() => setMode({ kind: 'harbor' })}
        />
      )}
      {sheet === 'log' && <LogSheet view={view} colors={colors} close={() => setSheet(null)} />}
      {sheet === 'scores' && (
        <ScoresSheet
          view={view}
          colors={colors}
          kinds={kinds}
          seat={seat}
          clock={live}
          close={() => setSheet(null)}
          onDice={(p) => {
            setDiceFor(p);
            setSheet('dice');
          }}
        />
      )}
      {sheet === 'dice' && <DiceStatsSheet view={view} colors={colors} player={diceFor} close={() => setSheet(null)} />}
      {forced}
      {ask && seat !== null && (
        <ConfirmDialog
          key={pending?.key}
          ask={ask}
          color={colors[seat]}
          onYes={(i) => confirmPending(ask.choices[i]?.action ?? ask.choices[0].action)}
          onNo={() => {
            // a card with nothing to pick goes back to the hand; otherwise back to its choices
            if (pending?.back) cancelCard();
            else setPending(null);
          }}
          onPreview={(i) => setPending((p) => (p && p.preview !== i ? { ...p, preview: i } : p))}
        />
      )}
      {gameOver && (
        <EndGame
          view={view}
          colors={colors}
          kinds={kinds}
          seat={seat}
          clock={props.clock ?? null}
          covered={sheet !== null}
          onHome={props.onHome}
          onRematch={props.onRematch}
          onDice={() => {
            setDiceFor(null);
            setSheet('dice');
          }}
        />
      )}
    </div>
  );
}

function Players({
  view,
  colors,
  kinds,
  seat,
  desk,
  clock,
  onOpen,
}: {
  view: GameView;
  colors: PlayerColor[];
  kinds: SeatKind[];
  seat: PlayerId | null;
  desk: boolean;
  /** The live timer: the turn in play shows how long it has taken so far. */
  clock: ClockFeed | null;
  onOpen(): void;
}) {
  return (
    <div class="players" role="list">
      {view.players.map((p) => {
        const active = view.turn.actor === p.id && view.phase.kind !== 'gameOver';
        const vp = p.totalVP ?? p.publicVP;
        const turnTime = active && clock?.sum.current?.player === p.id && (
          <span class="pm pturn" title="This turn so far">
            <ClockIcon />
            <LiveTime feed={clock} pick={(c) => (c.current?.player === p.id ? c.current.ms : null)} />
          </span>
        );
        const name = (
          <span class="pname">
            {p.name}
            {p.id === seat && <span class="you">you</span>}
          </span>
        );
        return (
          <button
            type="button"
            role="listitem"
            key={p.id}
            class={active ? 'player active' : 'player'}
            style={{ '--pc': colors[p.id].fill, '--pcs': colors[p.id].stroke } as Record<string, string>}
            onClick={onOpen}
            aria-label={`${p.name}: ${vp} victory points, ${p.resourceCount} cards${view.ck ? `, ${view.ck.players[p.id]?.progressCount ?? 0} progress cards` : ''}`}
          >
            <span class="avatar">{kinds[p.id] === 'bot' ? '🤖' : kinds[p.id] === 'remote' ? '🌐' : p.name.slice(0, 1).toUpperCase()}</span>
            <span class="pinfo">
              {desk ? (
                // the turn's time on the name line, where there is room for it
                <span class="pline">
                  {name}
                  {turnTime}
                </span>
              ) : (
                name
              )}
              {view.ck ? (
                <CkMeta view={view} p={p.id} desk={desk} turnTime={desk ? null : turnTime} colors={colors} />
              ) : desk ? (
                <span class="pmeta">
                  <span class="pm" title="Resource cards">
                    <CardsIcon /> {p.resourceCount}
                  </span>
                  <span class="pm" title="Development cards">
                    <CardsIcon dev /> {p.devCardCount}
                  </span>
                  {p.playedKnights > 0 && (
                    <span class="pm" title="Knights played">
                      ⚔️ {p.playedKnights}
                    </span>
                  )}
                  {view.longestRoute.holder === p.id && (
                    <span class="pm award" title="Longest route">
                      🛣️
                    </span>
                  )}
                  {view.largestArmy.holder === p.id && (
                    <span class="pm award" title="Largest army">
                      🏆
                    </span>
                  )}
                </span>
              ) : (
                <span class="pmeta">
                  🎴 {p.resourceCount}
                  {view.longestRoute.holder === p.id && <span title="Longest route"> 🛣️</span>}
                  {view.largestArmy.holder === p.id && <span title="Largest army"> ⚔️</span>}
                  {turnTime}
                </span>
              )}
            </span>
            <span class="pvp" title="Victory points">
              {vp}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A player's Cities & Knights line(s): cards, progress cards, knights, improvements and the expansion's VP cards. */
function CkMeta({ view, p, desk, turnTime, colors }: { view: GameView; p: PlayerId; desk: boolean; turnTime: ComponentChildren; colors: PlayerColor[] }) {
  const ck = view.ck!;
  const cp = ck.players[p];
  const b = barbarianState(view)!;
  const pts = ckPoints(view, p);
  const metros = TRACK_LIST.filter((t) => ck.metropolises[t]?.owner === p);
  const knights = (
    <span class="pm pm-kn" title={`Knights: ${b.active[p]} of ${b.total[p]} active, defending with strength ${b.perPlayer[p]}`}>
      <HelmIcon />
      <b>{b.perPlayer[p]}</b>
      <span class="pm-sub">
        {b.active[p]}/{b.total[p]}
      </span>
    </span>
  );
  const levels = (
    <span class="pm pm-levels" title={`City improvements: trade ${cp.improvements.trade}, politics ${cp.improvements.politics}, science ${cp.improvements.science}`}>
      {TRACK_LIST.map((t) => (
        <span key={t} class={`lvl tr-${t}${cp.improvements[t] === 0 ? ' zero' : ''}`}>
          {cp.improvements[t]}
        </span>
      ))}
    </span>
  );
  const awards = (
    <>
      {view.longestRoute.holder === p && (
        <span class="pm award" title="Longest road">
          🛣️
        </span>
      )}
      {metros.map((t) => (
        <span key={t} class="pm award pm-tower" title={`The ${t} metropolis (+2 VP)`}>
          <TowerGlyph track={t} fill={colors[p].fill} stroke={colors[p].stroke} />
        </span>
      ))}
      {pts.defender > 0 && (
        <span class="pm award pm-def" title={`Defender of Catan ×${pts.defender} (${pts.defender} VP)`}>
          🛡️{pts.defender > 1 ? <span class="pm-x">×{pts.defender}</span> : null}
        </span>
      )}
      {cp.vpCards.map((c, i) => (
        <span key={`${c}${i}`} class="pm award" title={`${progressTitle(c)} (1 VP)`}>
          📜
        </span>
      ))}
      {pts.merchant > 0 && (
        <span class="pm award" title="The merchant (1 VP)">
          🧺
        </span>
      )}
    </>
  );
  if (!desk)
    return (
      <span class="pmeta ck-meta">
        <span class="pm" title="Cards in hand">
          🎴{view.players[p].resourceCount}
        </span>
        <span class="pm" title="Progress cards">
          <span class="pm-prog" aria-hidden="true" />
          {cp.progressCount}
        </span>
        {knights}
        {turnTime}
      </span>
    );
  return (
    <>
      <span class="pmeta ck-meta">
        <span class="pm" title="Cards in hand (resources and commodities)">
          <CardsIcon /> {view.players[p].resourceCount}
        </span>
        <span class="pm" title="Progress cards (hidden)">
          <span class="pm-prog" aria-hidden="true" />
          {cp.progressCount}
        </span>
        {knights}
      </span>
      <span class="pmeta ck-awards">
        {levels}
        {awards}
      </span>
    </>
  );
}

function ScoresSheet({
  view,
  colors,
  kinds,
  seat,
  clock,
  close,
  onDice,
}: {
  view: GameView;
  colors: PlayerColor[];
  kinds: SeatKind[];
  seat: PlayerId | null;
  /** The live timer (null: hidden, or not timed). */
  clock: ClockFeed | null;
  close(): void;
  /** Opens the dice statistics, for one player or (null) everyone. */
  onDice(p: PlayerId | null): void;
}) {
  const ext = view.ext as Record<string, unknown>;
  const cloth = (ext.cloth as { cloth: number[] } | undefined)?.cloth;
  const levels = (ext.wonders as { levels: number[] } | undefined)?.levels;
  const forts = (ext.pirateIslands as { fortresses: Array<{ chits: number; captured: boolean }> } | undefined)?.fortresses;
  const sc = getScenario(view.scenario);
  return (
    <Sheet title="Players" onClose={close} wide>
      <button type="button" class="wide dice-open" onClick={() => onDice(null)}>
        📊 Dice statistics
      </button>
      <div class="scores">
        {view.players.map((p) => (
          <div class="score-row" key={p.id} style={{ '--pc': colors[p.id].fill } as Record<string, string>}>
            <div class="score-head">
              <span class="dot" style={{ background: colors[p.id].fill, borderColor: colors[p.id].stroke }} />
              <strong>{p.name}</strong>
              {kinds[p.id] === 'bot' && <span class="tag">computer</span>}
              {kinds[p.id] === 'remote' && <span class="tag">online</span>}
              {p.id === seat && <span class="you">you</span>}
              <span class="score-vp">{p.totalVP ?? p.publicVP} VP</span>
            </div>
            {view.ck && <CkScore view={view} p={p.id} colors={colors} />}
            <div class="score-stats">
              <span>🎴 {p.resourceCount} cards</span>
              {!view.ck && <span>🃏 {p.devCardCount} development</span>}
              {sc.rules.largestArmy && !view.ck && <span>⚔️ {p.playedKnights} knights</span>}
              {sc.rules.longestRoute && <span>🛣️ route {view.longestRoute.lengths[p.id] ?? 0}</span>}
              {cloth && <span>🧵 {cloth[p.id]} cloth</span>}
              {levels && <span>🏛️ wonder level {levels[p.id]}</span>}
              {forts && <span>{forts[p.id].captured ? '🏰 fortress conquered' : `🏴 fortress ${forts[p.id].chits}/3`}</span>}
              {view.longestRoute.holder === p.id && <span class="badge">{sc.rules.ships ? 'Longest Trade Route' : 'Longest Road'}</span>}
              {view.largestArmy.holder === p.id && <span class="badge">Largest Army</span>}
              {clock && (
                <span class="score-time" title="Time on their turns so far">
                  <ClockIcon /> <LiveTime feed={clock} pick={(c) => c.perPlayerMs[p.id] ?? 0} /> played
                  {clock.sum.current?.player === p.id && view.phase.kind !== 'gameOver' && (
                    <>
                      {' · this turn '}
                      <LiveTime feed={clock} pick={(c) => (c.current?.player === p.id ? c.current.ms : null)} />
                    </>
                  )}
                </span>
              )}
              <button type="button" class="small-btn dice-btn" onClick={() => onDice(p.id)} aria-label={`${p.name}'s dice rolls`}>
                🎲 Rolls
              </button>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/** Where a player's Cities & Knights points come from, and their knights, improvements and cards. */
function CkScore({ view, p, colors }: { view: GameView; p: PlayerId; colors: PlayerColor[] }) {
  const ck = view.ck!;
  const cp = ck.players[p];
  const b = barbarianState(view)!;
  const pts = ckPoints(view, p);
  let settlements = 0;
  let cities = 0;
  for (const bd of Object.values(view.board.buildings)) {
    if (bd.owner !== p) continue;
    if (bd.type === 'city') cities += 2;
    else settlements += 1;
  }
  const road = view.longestRoute.holder === p ? 2 : 0;
  const parts: Array<[string, number]> = [
    ['Settlements', settlements],
    ['Cities', cities],
    ['Metropolises', pts.metropolis],
    ['Defender of Catan', pts.defender],
    ['Progress VP cards', pts.cards],
    ['Merchant', pts.merchant],
    ['Longest road', road],
  ];
  return (
    <div class="ck-score">
      <div class="ck-vp" aria-label="Victory points from">
        {parts
          .filter(([, n]) => n > 0)
          .map(([label, n]) => (
            <span key={label} class="ck-vp-part">
              {label} <b>{n}</b>
            </span>
          ))}
      </div>
      <div class="ck-rows">
        <span title="Strength of the active knights; active / all knights">
          <HelmIcon /> knights {b.perPlayer[p]} <small>({b.active[p]}/{b.total[p]} active)</small>
        </span>
        <span class="ck-imps">
          {TRACK_LIST.map((t) => (
            <span key={t} class="ck-imp" title={`${TRACK_INFO[t].label} level ${cp.improvements[t]}`}>
              <GateGlyph track={t} /> {cp.improvements[t]}
            </span>
          ))}
        </span>
        <span>
          <span class="pm-prog" aria-hidden="true" /> {cp.progressCount} progress
        </span>
        <span>🧱 {cp.walls.length} wall{cp.walls.length === 1 ? '' : 's'}</span>
        {cp.vpCards.length > 0 && <span>📜 {cp.vpCards.map(progressTitle).join(', ')}</span>}
        {TRACK_LIST.filter((t) => ck.metropolises[t]?.owner === p).map((t) => (
          <span key={t} class="badge ck-metro-badge">
            <span class="pm-tower">
              <TowerGlyph track={t} fill={colors[p].fill} stroke={colors[p].stroke} />
            </span>{' '}
            {TRACK_INFO[t].label} metropolis
          </span>
        ))}
        {pts.defender > 0 && <span class="badge">Defender of Catan ×{pts.defender}</span>}
      </div>
    </div>
  );
}

function Hand({ view, seat, desk, onCards }: { view: GameView; seat: PlayerId; desk: boolean; onCards(): void }) {
  if (view.ck) return <CkHand view={view} seat={seat} desk={desk} onCards={onCards} />;
  const me = view.players[seat];
  const res = me.resources!;
  const cards = me.devCards ?? [];
  if (!desk) {
    return (
      <div class="hand">
        {RESOURCE_LIST.map((r) => (
          <ResourceCard key={r} r={r} n={res[r]} look="tile" empty={res[r] === 0} />
        ))}
        <button type="button" class={cards.length === 0 ? 'rtile dev empty' : 'rtile dev'} onClick={onCards} aria-label="Development cards">
          <span class="rtile-art">
            <DevCardView type={null} back look="tile" />
          </span>
          <span class="rtile-n">{cards.length}</span>
        </button>
      </div>
    );
  }
  // Wide screens: the cards themselves, held ones standing out from empty slots.
  const total = RESOURCE_LIST.reduce((n, r) => n + res[r], 0);
  const limit = view.options.discardLimit;
  const pile = (n: number) => (n === 0 ? ' empty' : n > 1 ? ' many' : '');
  return (
    <section class="hand-block" aria-label="Your hand">
      <div class="panel-cap">
        <span>Your hand</span>
        <span class={total > limit ? 'hand-total over' : 'hand-total'} title={total > limit ? `More than ${limit} cards: on a 7 you discard half` : undefined}>
          {total} card{total === 1 ? '' : 's'}
          {total > limit ? ' · discard on a 7' : ''}
        </span>
      </div>
      <div class="hand cards">
        {RESOURCE_LIST.map((r) => (
          <span key={r} class={`rtile hcard r-${r}${pile(res[r])}`} title={`${RESOURCE_INFO[r].label}: ${res[r]}`}>
            {res[r] > 0 ? <ResourceCard r={r} look="mini" /> : <span class="hcard-slot" />}
            <span class="hcard-icon">
              <ResGlyph r={r} />
            </span>
            <span class="rtile-n">{res[r]}</span>
          </span>
        ))}
        <button
          type="button"
          class={`rtile hcard dev${pile(cards.length)}`}
          onClick={onCards}
          aria-label="Development cards"
          title={`Development cards: ${cards.length}`}
        >
          {cards.length > 0 ? <DevCardView type={null} back look="mini" /> : <span class="hcard-slot" />}
          <span class="rtile-n">{cards.length}</span>
        </button>
      </div>
    </section>
  );
}

/** Cities & Knights: the hand with its commodities, and the progress cards in place of the development cards. */
function CkHand({ view, seat, desk, onCards }: { view: GameView; seat: PlayerId; desk: boolean; onCards(): void }) {
  const me = view.players[seat];
  const res = me.resources!;
  const ckMe = view.ck!.players[seat];
  const com = ckMe.commodities ?? { paper: 0, cloth: 0, coin: 0 };
  const progress = ckMe.progress ?? [];
  const hand = { ...res, ...com };
  const kinds = [...RESOURCE_LIST, ...COMMODITY_LIST];
  // the back of the newest card shows its deck's colour
  const back: ImprovementTrack = progress.length > 0 ? (PROGRESS_CARDS[progress[progress.length - 1]]?.deck ?? 'science') : 'science';
  if (!desk) {
    return (
      <div class="hand ck-hand">
        {kinds.map((r) => (
          <ResourceCard key={r} r={r} n={hand[r]} look="tile" empty={hand[r] === 0} />
        ))}
        <button type="button" class={progress.length === 0 ? 'rtile prog-tile empty' : 'rtile prog-tile'} onClick={onCards} aria-label={`Progress cards: ${progress.length}`}>
          <span class="rtile-art">
            <ProgressCardView deck={back} back look="tile" />
          </span>
          <span class="rtile-n">{progress.length}</span>
        </button>
      </div>
    );
  }
  const total = kinds.reduce((n, r) => n + hand[r], 0);
  const limit = sevenLimitOf(view, seat);
  const pile = (n: number) => (n === 0 ? ' empty' : n > 1 ? ' many' : '');
  return (
    <section class="hand-block" aria-label="Your hand">
      <div class="panel-cap">
        <span>Your hand</span>
        <span class={total > limit ? 'hand-total over' : 'hand-total'} title={`On a 7 you discard half with more than ${limit} cards (7, +2 for each city wall)`}>
          {total} card{total === 1 ? '' : 's'}
          {total > limit ? ' · discard on a 7' : ` · limit ${limit}`}
        </span>
      </div>
      <div class="hand cards ck-cards">
        {kinds.map((r) => (
          <span key={r} class={`rtile hcard r-${r}${pile(hand[r])}`} title={`${CARD_INFO[r].label}: ${hand[r]}`}>
            {hand[r] > 0 ? <ResourceCard r={r} look="mini" /> : <span class="hcard-slot" />}
            <span class="hcard-icon">
              <ResGlyph r={r} />
            </span>
            <span class="rtile-n">{hand[r]}</span>
          </span>
        ))}
        <button type="button" class={`rtile hcard prog-hcard${pile(progress.length)}`} onClick={onCards} aria-label="Progress cards" title={`Progress cards: ${progress.length}`}>
          {progress.length > 0 ? <ProgressCardView deck={back} back look="mini" /> : <span class="hcard-slot" />}
          <span class="rtile-n">{progress.length}</span>
        </button>
      </div>
    </section>
  );
}

/** A small stack of cards (hand size in the players list). */
function CardsIcon({ dev }: { dev?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" class="pm-icon" aria-hidden="true">
      <rect x="5.2" y="1.6" width="8.4" height="11.4" rx="1.6" transform="rotate(12 9.4 7.3)" fill={dev ? '#4a2f94' : '#e2c98f'} stroke={dev ? '#2b1a5c' : '#7a5a2e'} stroke-width="1" />
      <rect x="2.4" y="3" width="8.4" height="11.4" rx="1.6" fill={dev ? '#7b58d4' : '#fbf0d0'} stroke={dev ? '#2b1a5c' : '#7a5a2e'} stroke-width="1" />
      {dev && <circle cx="6.6" cy="8.7" r="2" fill="#f1c140" />}
    </svg>
  );
}
