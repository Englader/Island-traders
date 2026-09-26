import { getScenario, type Action, type GameView, type PlayerId } from 'engine';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board, NO_TARGETS, type Ghost, type PickKind, type Targets } from '../board/Board';
import { RESOURCE_INFO, RESOURCE_LIST, describeAction, harborLabel } from '../game/names';
import { FX_TIME, mustAct, ROLL_TIMING, SPEED_LABEL, type BotSpeed, type PlayerColor, type SeatKind } from '../game/seats';
import { FxOverlay, fxFor, type FxEvent } from './Fx';
import { DiceRoll, type RollInfo } from './DiceRoll';
import { DiceStatsSheet } from './DiceStats';
import { DevCardView, ResourceCard } from './cards';
import type { Flash } from './flash';
import { Die, Sheet } from './common';
import {
  BuildSheet,
  CardsSheet,
  DiscardSheet,
  GameOverSheet,
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
}

type Mode =
  | null
  | { kind: 'build'; piece: BuildPiece }
  | { kind: 'moveFrom' }
  | { kind: 'moveTo'; from: string }
  | { kind: 'harbor' }
  | { kind: 'robber'; piece: 'robber' | 'pirate' };

type SheetName = null | 'build' | 'trade' | 'cards' | 'scenario' | 'log' | 'scores' | 'dice';

interface Pending {
  key: string;
  actions: Action[];
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

function ghostFor(a: Action, seat: PlayerId): Ghost | null {
  switch (a.type) {
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
    default:
      return null;
  }
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
      if (a.victim === undefined) return 'Nobody to rob';
      return a.take === 'cloth' ? `Take cloth from ${name(a.victim)}` : `Rob ${name(a.victim)} (${view.players[a.victim].resourceCount})`;
    default:
      return 'Confirm';
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
      return ph.step === 'settlement' ? `Place settlement ${round}` : 'Place a road or ship next to it';
    }
    case 'preRoll':
      return mine ? 'Roll the dice' : `${name(view.turn.actor)}'s turn`;
    case 'discard':
      return seat !== null && ph.pending[seat] !== undefined ? 'Discard half your cards' : 'Players are discarding';
    case 'gold':
      return seat !== null && ph.pending[seat] !== undefined ? 'Choose your free resources' : 'Players are choosing resources';
    case 'robber':
      return mine ? 'Move the robber' + (legal.some((a) => a.type === 'moveRobber' && a.piece === 'pirate') ? ' or the pirate' : '') : `${name(view.turn.actor)} moves the robber`;
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
  const sc = getScenario(view.scenario);
  const ph = view.phase;
  const me = seat !== null ? view.players[seat] : null;

  // Reset transient UI when the phase or turn part changes.
  const phaseKey = `${ph.kind}:${view.turn.part}:${ph.kind === 'setup' ? `${ph.round}.${ph.index}.${ph.step}` : ''}`;
  useEffect(() => {
    setPending(null);
    setMode((m) => (m && (ph.kind === 'main' || ph.kind === 'specialBuild') && m.kind !== 'robber' ? m : null));
  }, [phaseKey]);
  // Drop a build mode that no longer has any legal spot.
  const spots = useMemo(() => spotActions(view, legal, mode), [view, legal, mode]);
  useEffect(() => {
    if (mode && mode.kind !== 'robber' && spots.size === 0) setMode(null);
  }, [spots, mode]);
  useEffect(() => {
    if (!props.error) return;
    const id = setTimeout(props.clearError, 3500);
    return () => clearTimeout(id);
  }, [props.error]);

  const targets = useMemo(() => toTargets(spots), [spots]);
  const accent = colors[seat ?? view.turn.actor]?.fill ?? '#fff';

  const doSend = (a: Action) => {
    setPending(null);
    if (a.type === 'buildRoad' || a.type === 'buildShip' || a.type === 'buildSettlement' || a.type === 'buildCity' || a.type === 'moveShip' || a.type === 'placeHarbor') {
      if (ph.kind !== 'roadBuilding') setMode(null);
    }
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
    setPending({ key, actions: acts });
  };

  const ghost = pending && seat !== null ? ghostFor(pending.actions[0], seat) : null;

  // --- forced sheets ---------------------------------------------------------------
  let forced: JSX.Element | null = null;
  if (seat !== null && me?.resources) {
    if (ph.kind === 'discard' && ph.pending[seat] !== undefined) forced = <DiscardSheet view={view} seat={seat} send={doSend} />;
    else if (ph.kind === 'gold' && ph.pending[seat] !== undefined) forced = <GoldSheet view={view} seat={seat} send={doSend} />;
    else if (ph.kind === 'scenario' && ph.step === 'rob' && ph.player === seat)
      forced = <RobAnySheet view={view} legal={legal} seat={seat} colors={colors} send={doSend} />;
    else if (
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
  const devCount = me?.devCards?.length ?? 0;
  const waitingFor = mustAct(view).filter((p) => p !== seat);
  const status = statusText(view, seat, legal);

  const bar: JSX.Element[] = [];
  if (isActor && canAct && !gameOver) {
    if (ph.kind === 'preRoll') {
      bar.push(
        <button type="button" key="roll" class="action primary big" onClick={() => doSend({ type: 'rollDice', player: seat! })}>
          <span class="ai">🎲</span>
          <span class="al">Roll</span>
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
          <button type="button" key="cards" class="action" onClick={() => setSheet('cards')}>
            <span class="ai">🃏</span>
            <span class="al">Cards{devCount > 0 ? ` ${devCount}` : ''}</span>
          </button>,
        );
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
      const e = reduced ? null : fxFor(l.action, prevView.current, view, seat);
      if (e) setFx({ ...e, key: l.at });
    }
    prevView.current = view;
  }, [view]);
  useEffect(() => {
    if (!rollFlash || rollFlash.key === seenRoll.current) return;
    seenRoll.current = rollFlash.key;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (dice && !reduced) setRolling({ key: rollFlash.key, dice: [dice[0], dice[1]] });
  }, [rollFlash?.key]);
  // The latest few events, each marked with the colour of the player it is about.
  const feed = view.log
    .map((e, i) => ({ msg: e.msg, i }))
    .filter((e) => !e.msg.startsWith('---'))
    .slice(-3)
    .map((e) => {
      const who = view.players.find((p) => e.msg.startsWith(p.name + ' ') || e.msg.startsWith('(' + p.name + ' '));
      return { ...e, color: who ? colors[who.id]?.fill : undefined };
    });
  const nextSpeed: Record<BotSpeed, BotSpeed> = { slow: 'normal', normal: 'fast', fast: 'slow' };
  const speedShort: Record<BotSpeed, string> = { slow: '½×', normal: '1×', fast: '2×' };

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
            {sc.name} · Turn {view.turn.number} · {view.victoryTarget} VP{props.note ? ` · ${props.note}` : ''}
          </div>
        </div>
        <div
          class="dice"
          ref={headerDice}
          style={rolling ? { visibility: 'hidden' } : undefined}
          key={dice ? `${view.turn.number}-${dice[0]}-${dice[1]}` : 'none'}
          aria-label={dice ? `rolled ${dice[0] + dice[1]}` : 'no roll yet'}
        >
          {dice ? (
            <>
              <Die n={dice[0]} />
              <Die n={dice[1]} red />
            </>
          ) : null}
        </div>
      </header>
      {fx && <FxOverlay fx={fx} view={view} colors={colors} seat={seat} ms={FX_TIME[props.speed ?? 'normal']} onDone={() => setFx(null)} />}
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

      <div class="board-area">
        <Board
          view={view}
          colors={colors}
          targets={targets}
          accent={accent}
          ghost={ghost}
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
              <button type="button" class="log-chip" onClick={() => setSheet('log')} aria-label="Game log" title="Game log">
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
          <div class={rolling ? 'feed hushed' : 'feed'} aria-live="polite">
            {feed.map((e, k) => (
              <span key={e.i} class={`feed-line age-${feed.length - 1 - k}`}>
                <span class="feed-dot" style={{ background: e.color ?? 'transparent' }} />
                {e.msg}
              </span>
            ))}
          </div>
        )}
        {pending && (
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
        {!pending && mode && mode.kind !== 'robber' && (
          <div class="mode-hint">
            {mode.kind === 'build' && `Tap a highlighted spot to build a ${mode.piece}`}
            {mode.kind === 'moveFrom' && 'Tap the ship to move'}
            {mode.kind === 'moveTo' && 'Tap where the ship should go'}
            {mode.kind === 'harbor' && 'Tap a coast next to your settlement'}
          </div>
        )}
      </div>

      <div class="panel">
        <Players view={view} colors={colors} kinds={kinds} seat={seat} onOpen={() => setSheet('scores')} />
        {me?.resources && <Hand view={view} seat={seat!} onCards={() => setSheet('cards')} />}
        <nav class="action-bar">{bar}</nav>
      </div>

      {sheet === 'build' && seat !== null && (
        <BuildSheet
          view={view}
          legal={legal}
          seat={seat}
          colors={colors}
          send={doSend}
          close={() => setSheet(null)}
          choose={(piece) => {
            setSheet(null);
            setMode({ kind: 'build', piece });
          }}
        />
      )}
      {sheet === 'trade' && seat !== null && <TradeSheet view={view} legal={legal} seat={seat} colors={colors} send={doSend} close={() => setSheet(null)} />}
      {sheet === 'cards' && seat !== null && <CardsSheet view={view} legal={legal} seat={seat} colors={colors} send={doSend} close={() => setSheet(null)} />}
      {sheet === 'scenario' && seat !== null && (
        <ScenarioSheet
          view={view}
          legal={legal}
          seat={seat}
          colors={colors}
          send={doSend}
          close={() => setSheet(null)}
          placeHarbor={() => setMode({ kind: 'harbor' })}
        />
      )}
      {sheet === 'log' && <LogSheet view={view} close={() => setSheet(null)} />}
      {sheet === 'scores' && (
        <ScoresSheet
          view={view}
          colors={colors}
          kinds={kinds}
          seat={seat}
          close={() => setSheet(null)}
          onDice={(p) => {
            setDiceFor(p);
            setSheet('dice');
          }}
        />
      )}
      {sheet === 'dice' && <DiceStatsSheet view={view} colors={colors} player={diceFor} close={() => setSheet(null)} />}
      {!sheet && forced}
      {gameOver && !sheet && <GameOverSheet view={view} colors={colors} onHome={props.onHome} onRematch={props.onRematch} />}
    </div>
  );
}

function Players({
  view,
  colors,
  kinds,
  seat,
  onOpen,
}: {
  view: GameView;
  colors: PlayerColor[];
  kinds: SeatKind[];
  seat: PlayerId | null;
  onOpen(): void;
}) {
  return (
    <div class="players" role="list">
      {view.players.map((p) => {
        const active = view.turn.actor === p.id && view.phase.kind !== 'gameOver';
        const vp = p.totalVP ?? p.publicVP;
        return (
          <button
            type="button"
            role="listitem"
            key={p.id}
            class={active ? 'player active' : 'player'}
            style={{ '--pc': colors[p.id].fill, '--pcs': colors[p.id].stroke } as Record<string, string>}
            onClick={onOpen}
            aria-label={`${p.name}: ${vp} victory points, ${p.resourceCount} cards`}
          >
            <span class="avatar">{kinds[p.id] === 'bot' ? '🤖' : kinds[p.id] === 'remote' ? '🌐' : p.name.slice(0, 1).toUpperCase()}</span>
            <span class="pinfo">
              <span class="pname">
                {p.name}
                {p.id === seat && <span class="you">you</span>}
              </span>
              <span class="pmeta">
                🎴 {p.resourceCount}
                {view.longestRoute.holder === p.id && <span title="Longest route"> 🛣️</span>}
                {view.largestArmy.holder === p.id && <span title="Largest army"> ⚔️</span>}
              </span>
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

function ScoresSheet({
  view,
  colors,
  kinds,
  seat,
  close,
  onDice,
}: {
  view: GameView;
  colors: PlayerColor[];
  kinds: SeatKind[];
  seat: PlayerId | null;
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
            <div class="score-stats">
              <span>🎴 {p.resourceCount} cards</span>
              <span>🃏 {p.devCardCount} development</span>
              {sc.rules.largestArmy && <span>⚔️ {p.playedKnights} knights</span>}
              {sc.rules.longestRoute && <span>🛣️ route {view.longestRoute.lengths[p.id] ?? 0}</span>}
              {cloth && <span>🧵 {cloth[p.id]} cloth</span>}
              {levels && <span>🏛️ wonder level {levels[p.id]}</span>}
              {forts && <span>{forts[p.id].captured ? '🏰 fortress conquered' : `🏴 fortress ${forts[p.id].chits}/3`}</span>}
              {view.longestRoute.holder === p.id && <span class="badge">{sc.rules.ships ? 'Longest Trade Route' : 'Longest Road'}</span>}
              {view.largestArmy.holder === p.id && <span class="badge">Largest Army</span>}
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

function Hand({ view, seat, onCards }: { view: GameView; seat: PlayerId; onCards(): void }) {
  const me = view.players[seat];
  const res = me.resources!;
  const cards = me.devCards ?? [];
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
