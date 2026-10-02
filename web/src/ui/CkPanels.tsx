import {
  ABILITY_LEVEL,
  MAX_IMPROVEMENT,
  METROPOLIS_LEVEL,
  PROGRESS_HAND_LIMIT,
  RESOURCES,
  improvementCost,
  type Action,
  type CardCounts,
  type GameView,
  type ImprovementTrack,
  type PlayerId,
  type ProgressCardName,
  type VertexId,
} from 'engine';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  ACTIVATE_COST,
  KNIGHT_LABEL,
  PROMOTE_COST,
  PROGRESS_TEXT,
  TRACK_INFO,
  TRACK_LIST,
  barbarianState,
  drawLimit,
  drawRange,
  improvementName,
  progressDeck,
  spotLabel,
  type BarbarianState,
} from '../game/ck';
import { CARD_INFO, COMMODITY_LIST, RESOURCE_INFO, cardKindsOf, countsText, handOfView, progressTitle } from '../game/names';
import { rowCount, rowSides, type SignedCounts } from '../game/trade';
import type { PlayerColor } from '../game/seats';
import { Cost, Die, ResIcon, Sheet, cleanCounts } from './common';
import { GateGlyph, HelmIcon, KnightGlyph, ProgressCardView, ShipGlyph, TowerGlyph } from './ckArt';
import { ResGlyph } from './icons';
import { ForcedSheet, PeekLine, PickCards } from './sheets';
import { hasCrane, improvementPriceOf, progressWhy } from '../game/progress';
import './ck.css';

/*
 * The Cities & Knights panels: the barbarian track in the header and its
 * sheet, the city improvements "flip chart", the progress cards, the
 * expansion's forced choices and the bar of a selected knight.
 */

function Dot({ color }: { color: PlayerColor }) {
  return <span class="dot" style={{ background: color.fill, borderColor: color.stroke }} />;
}

const nameOf = (view: GameView, p: PlayerId, seat: PlayerId | null) => (p === seat ? 'You' : view.players[p]?.name ?? `Player ${p + 1}`);

// --- the barbarian track ---------------------------------------------------------------------

/** Catan's shore at the end of the track: an island with a tower. */
function ShoreGlyph() {
  return (
    <svg viewBox="0 0 24 20" class="bt-shore-art" aria-hidden="true">
      <ellipse cx="12" cy="16" rx="11" ry="3.6" fill="#7fbf5a" stroke="#3f7a2c" stroke-width="1" />
      <rect x="8.5" y="5" width="7" height="10" fill="#e7d9b8" stroke="#6b5a3a" stroke-width="1" />
      <path d="M8.5 5 V3 H10 V4.2 H11.4 V3 H12.6 V4.2 H14 V3 H15.5 V5 Z" fill="#e7d9b8" stroke="#6b5a3a" stroke-width="0.8" />
      <path d="M10.6 15 V11.4 A1.4 1.4 0 0 1 13.4 11.4 V15 Z" fill="#4a3a28" />
    </svg>
  );
}

/**
 * Seafarers: the robber and the pirate waiting at the end of the track,
 * asleep, until the barbarians first attack (2025 rulebook p. 12).
 */
function Waiting({ w }: { w: NonNullable<BarbarianState['waiting']> }) {
  const said = `${w.robber && w.pirate ? 'The robber and the pirate wait' : w.pirate ? 'The pirate waits' : 'The robber waits'} here until the barbarians first attack`;
  return (
    <span class="bt-wait" title={said} data-waiting={[w.robber ? 'robber' : '', w.pirate ? 'pirate' : ''].filter(Boolean).join(' ')}>
      <svg viewBox={w.robber && w.pirate ? '0 0 28 20' : '0 0 16 20'} aria-hidden="true">
        {w.robber && (
          <g class="bt-wait-robber">
            <path d="M2.5 18.5 Q6.5 6.5 10.5 18.5 Z" />
            <circle cx="6.5" cy="7.4" r="3.2" />
          </g>
        )}
        {w.pirate && (
          <g class="bt-wait-pirate" transform={w.robber ? 'translate(11.5 0.5)' : 'translate(0 0.5)'}>
            <path d="M0.8 13 H15.2 L12.6 17.8 H3.4 Z" />
            <path d="M8.3 3.2 Q13.8 7 13.4 11.8 H8.3 Z M7.7 4.4 Q3.8 7.6 4 11.8 H7.7 Z" />
            <path d="M8 13 V2.6" class="mast" />
          </g>
        )}
      </svg>
    </span>
  );
}

/** The track itself: the ship's start, seven spaces and the shore; the ship sails along it. */
function Lane({ b, big }: { b: BarbarianState; big?: boolean }) {
  const nodes = Array.from({ length: b.track }, (_, i) => i);
  return (
    <span class={big ? 'bt-lane big' : 'bt-lane'} style={{ '--pos': b.pos, '--len': b.track } as Record<string, number>}>
      <span class="bt-water" aria-hidden="true" />
      <span class="bt-wake" aria-hidden="true" />
      {nodes.map((i) => (
        <span key={i} class={`bt-node${i < b.pos ? ' past' : ''}${i === b.pos ? ' here' : ''}`} style={{ '--i': i } as Record<string, number>} aria-hidden="true">
          {/* Seafarers: on the track's final space until the first attack */}
          {i === b.track - 1 && b.waiting && <Waiting w={b.waiting} />}
        </span>
      ))}
      <span class="bt-shore" aria-hidden="true">
        <ShoreGlyph />
      </span>
      <span class="bt-ship" aria-hidden="true">
        <ShipGlyph />
      </span>
    </span>
  );
}

/** Barbarians against knights, as two numbers. */
function Versus({ b }: { b: BarbarianState }) {
  const lose = b.barbarians > b.knights;
  return (
    <span class={lose ? 'bt-vs lose' : 'bt-vs hold'}>
      <span class="bt-b" title="Barbarian strength: every city on the board">
        <span class="bt-flag" aria-hidden="true" />
        {b.barbarians}
      </span>
      <span class="bt-x" aria-hidden="true">
        {lose ? '>' : '≤'}
      </span>
      <span class="bt-k" title="Knights' strength: every active knight">
        <HelmIcon />
        {b.knights}
      </span>
    </span>
  );
}

/**
 * The barbarian ship's position and the strength of both sides, small
 * enough for the header. Opens the barbarian sheet.
 */
export function BarbarianTrack({ view, onOpen }: { view: GameView; onOpen(): void }) {
  const b = barbarianState(view);
  if (!b) return null;
  const left = b.track - b.pos;
  const wait = b.waiting ? ` ${b.waiting.pirate && b.waiting.robber ? 'The robber and the pirate wait' : 'The robber waits'} at the end of the track.` : '';
  const said = `Barbarians: ${b.pos} of ${b.track} spaces sailed, ${left} to go. Barbarian strength ${b.barbarians}, knights ${b.knights}.${wait} Show details`;
  return (
    <button type="button" class="ck-track" onClick={onOpen} aria-label={said} title="The barbarians: tap for details" data-pos={b.pos}>
      <Lane b={b} />
      <Versus b={b} />
    </button>
  );
}

/** Who would suffer or gain if the barbarians landed now. */
function forecast(view: GameView, b: BarbarianState, seat: PlayerId | null): string {
  const n = view.players.length;
  const order = Array.from({ length: n }, (_, i) => (view.turn.current + i) % n);
  const name = (p: PlayerId) => (p === seat ? 'you' : view.players[p]?.name ?? '');
  const list = (ps: PlayerId[]) => (ps.length <= 1 ? ps.map(name).join('') : `${ps.slice(0, -1).map(name).join(', ')} and ${name(ps[ps.length - 1])}`);
  if (b.barbarians > b.knights) {
    const metro = new Set(Object.values(view.ck!.metropolises).flatMap((m) => (m ? [m.vertex] : [])));
    const pillageable = (p: PlayerId) => Object.entries(view.board.buildings).some(([v, x]) => x.owner === p && x.type === 'city' && !metro.has(v));
    const eligible = order.filter(pillageable);
    if (eligible.length === 0) return 'If they landed now the barbarians would win, but find no city to pillage.';
    const least = Math.min(...eligible.map((p) => b.perPlayer[p]));
    const losers = eligible.filter((p) => b.perPlayer[p] === least);
    return `If they landed now the barbarians would win: ${list(losers)} would lose a city.`;
  }
  const most = Math.max(...b.perPlayer);
  const top = order.filter((p) => b.perPlayer[p] === most);
  if (top.length === 1) return `If they landed now Catan would hold, and ${list(top)} would be the Defender of Catan (1 VP).`;
  return `If they landed now Catan would hold; ${list(top)} would tie as best defenders and each draw a progress card.`;
}

export function BarbariansSheet({ view, colors, seat, close }: { view: GameView; colors: PlayerColor[]; seat: PlayerId | null; close(): void }) {
  const b = barbarianState(view)!;
  const ck = view.ck!;
  const cities = (p: PlayerId) => Object.values(view.board.buildings).filter((x) => x.owner === p && x.type === 'city').length;
  const left = b.track - b.pos;
  return (
    <Sheet title="The barbarians" onClose={close} wide>
      <div class="bsheet">
        <div class={b.barbarians > b.knights ? 'bs-track lose' : 'bs-track hold'}>
          <Lane b={b} big />
          <p class="bs-where">
            {b.pos === 0 ? 'The ship is at its start.' : `The ship has sailed ${b.pos} of ${b.track} spaces.`} It lands in Catan after{' '}
            <b>
              {left} more ship roll{left === 1 ? '' : 's'}
            </b>{' '}
            of the event die (3 of its 6 faces).
          </p>
        </div>
        <div class="bs-sides">
          <div class="bs-side barb">
            <span class="bs-n">{b.barbarians}</span>
            <span class="bs-l">
              <b>Barbarians</b> one for every city on the board, metropolises too
            </span>
          </div>
          <div class="bs-side kn">
            <span class="bs-n">{b.knights}</span>
            <span class="bs-l">
              <b>Knights</b> every active knight: basic 1, strong 2, mighty 3
            </span>
          </div>
        </div>
        <p class="bs-forecast">{forecast(view, b, seat)}</p>
        <table class="bs-table">
          <thead>
            <tr>
              <th>Player</th>
              <th class="num" title="Strength of their active knights">Defends</th>
              <th class="num" title="Active knights / knights on the board">Knights</th>
              <th class="num">Cities</th>
              <th class="num" title="Defender of Catan cards">Defender</th>
            </tr>
          </thead>
          <tbody>
            {view.players.map((p) => (
              <tr key={p.id}>
                <th scope="row">
                  <Dot color={colors[p.id]} /> {nameOf(view, p.id, seat)}
                </th>
                <td class="num">
                  <b>{b.perPlayer[p.id]}</b>
                </td>
                <td class="num">
                  {b.active[p.id]}/{b.total[p.id]}
                </td>
                <td class="num">{cities(p.id)}</td>
                <td class="num">{ck.players[p.id].defenders || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul class="bs-rules">
          <li>
            <b>Barbarians stronger:</b> whoever gave the fewest active knights loses a city (it becomes a settlement, its wall goes too). Metropolises are
            safe.
          </li>
          <li>
            <b>Knights at least as strong:</b> the strongest defender becomes Defender of Catan (1 VP); a tie draws progress cards instead.
          </li>
          <li>Then the ship sails home and every knight goes inactive.</li>
        </ul>
        <p class="hint">
          {b.waiting
            ? `No attack yet: ${b.waiting.pirate && b.waiting.robber ? 'the robber and the pirate wait' : 'the robber waits'} at the end of the track. At the first attack ${b.waiting.pirate && b.waiting.robber ? 'they take their' : 'it takes its'} starting place${b.waiting.pirate && b.waiting.robber ? 's' : ''} on the board and can be moved from then on.`
            : b.attacks === 0
              ? 'No attack yet: the robber sleeps on the desert until the first one.'
              : `Attacks so far: ${b.attacks}. The robber${view.board.pirate ? ' and the pirate are' : ' is'} awake.`}{' '}
          Defender of Catan cards left: {ck.defenderCards}.
        </p>
      </div>
    </Sheet>
  );
}

// --- city improvements: the flip chart ---------------------------------------------------------

/** Why the player can't buy the next level of a track now. */
function improveWhy(view: GameView, seat: PlayerId, track: ImprovementTrack, later: string | null, can: boolean): string | null {
  if (can) return null;
  const ck = view.ck!;
  const level = ck.players[seat].improvements[track];
  if (level >= MAX_IMPROVEMENT) return 'Fully built';
  if (later) return later;
  const cities = Object.entries(view.board.buildings).filter(([, b]) => b.owner === seat && b.type === 'city').map(([v]) => v);
  if (cities.length === 0) return 'You need a city first';
  const com = TRACK_INFO[track].commodity;
  const have = handOfView(view, seat)[com] ?? 0;
  const cost = improvementPriceOf(view, seat, level + 1);
  if (have < cost) return `You need ${cost - have} more ${com}`;
  if (level + 1 >= METROPOLIS_LEVEL) return 'You need a city without a metropolis';
  return 'Not possible right now';
}

/** A tiny red die and the red results that draw a card at a level. */
function Draws({ level }: { level: number }) {
  return (
    <span class="flip-draw" title={`Draws a progress card when this gate comes up with a red ${drawRange(level)}`}>
      <span class="flip-die">
        <Die n={drawLimit(level)} red />
      </span>
      {drawRange(level)}
    </span>
  );
}

function TrackColumn({
  view,
  seat,
  colors,
  track,
  later,
  can,
  onBuy,
}: {
  view: GameView;
  seat: PlayerId | null;
  colors: PlayerColor[];
  track: ImprovementTrack;
  later: string | null;
  can: boolean;
  onBuy(): void;
}) {
  const ck = view.ck!;
  const info = TRACK_INFO[track];
  const mine = seat !== null ? ck.players[seat].improvements[track] : 0;
  const have = seat !== null ? (handOfView(view, seat)[info.commodity] ?? 0) : 0;
  const metro = ck.metropolises[track];
  const levels = [1, 2, 3, 4, 5];
  const why = seat !== null ? improveWhy(view, seat, track, later, can) : null;
  const next = mine + 1;
  // a Crane played this turn: one commodity off the next improvement
  const crane = seat !== null && hasCrane(view, seat);
  return (
    <section
      class={`flip-col tr-${track}`}
      style={{ '--tc': info.fill, '--tcd': info.dark, '--tcl': info.light } as Record<string, string>}
      aria-label={`${info.label}: your level ${mine}`}
    >
      <header class="flip-head">
        <span class="flip-gate">
          <GateGlyph track={track} />
        </span>
        <span class="flip-name">
          <b>{info.label}</b>
          <span class="flip-sub">
            <ResGlyph r={info.commodity} /> {info.commodity}
            <span class="flip-color"> · {info.colorName}</span>
          </span>
        </span>
        {seat !== null && (
          <span class="flip-have" title={`You hold ${have} ${info.commodity}`}>
            <ResGlyph r={info.commodity} />
            {have}
          </span>
        )}
      </header>
      <ol class="flip-levels">
        {levels.map((level) => {
          const done = level <= mine;
          const others = view.players.filter((p) => p.id !== seat && ck.players[p.id].improvements[track] === level);
          const holder = metro && level === Math.max(METROPOLIS_LEVEL, ck.players[metro.owner].improvements[track]) ? metro.owner : null;
          return (
            <li key={level} class={`flip-level${done ? ' done' : ''}${level === next && seat !== null ? ' next' : ''}${level === mine ? ' at' : ''}`} data-level={level}>
              <span class="fl-n">{level}</span>
              <span class="fl-main">
                <span class="fl-name">{improvementName(track, level)}</span>
                <span class="fl-meta">
                  <span class="fl-cost" title={`${improvementCost(level)} ${info.commodity}`}>
                    {Array.from({ length: improvementCost(level) }, (_, i) => (
                      <ResGlyph key={i} r={info.commodity} />
                    ))}
                  </span>
                  <Draws level={level} />
                </span>
                {level === ABILITY_LEVEL && <span class="fl-ability">{info.ability}</span>}
                {level >= METROPOLIS_LEVEL && (
                  <span class="fl-metro">
                    {holder !== null ? (
                      <>
                        <span class="fl-tower">
                          <TowerGlyph track={track} fill={colors[holder].fill} stroke={colors[holder].stroke} />
                        </span>
                        {nameOf(view, holder, seat)}
                      </>
                    ) : level === METROPOLIS_LEVEL && !metro ? (
                      'Metropolis +2 VP'
                    ) : level === MAX_IMPROVEMENT ? (
                      'Keeps the metropolis'
                    ) : (
                      'Metropolis'
                    )}
                  </span>
                )}
              </span>
              <span class="fl-who">
                {done && seat !== null && level === mine && <span class="fl-you">you</span>}
                {others.map((p) => (
                  <span key={p.id} class="fl-mark" title={`${p.name}: level ${level}`} style={{ background: colors[p.id].fill, borderColor: colors[p.id].stroke }} />
                ))}
              </span>
            </li>
          );
        })}
      </ol>
      {seat !== null &&
        (mine >= MAX_IMPROVEMENT ? (
          <p class="flip-done">All five built</p>
        ) : (
          <button type="button" class="primary flip-buy" disabled={!can} title={why ?? undefined} onClick={onBuy} data-track={track}>
            <span class="fb-l">Build {improvementName(track, next)}</span>
            {crane && <span class="fb-crane">Crane −1</span>}
            {crane && improvementPriceOf(view, seat!, next) === 0 ? <span class="fb-free">free</span> : <Cost cost={{ [info.commodity]: crane ? improvementPriceOf(view, seat!, next) : improvementCost(next) }} />}
          </button>
        ))}
      {seat !== null && why && mine < MAX_IMPROVEMENT && <p class="flip-why">{why}</p>}
    </section>
  );
}

/**
 * The city improvements: three tracks of five levels, like the flip-chart
 * of the box. Each level shows its cost, the red results that draw progress
 * cards, the level-3 ability and the metropolis; markers show where every
 * player stands. A button per track buys its next level.
 */
export function ImprovementsSheet({
  view,
  legal,
  seat,
  colors,
  later,
  onBuy,
  close,
}: {
  view: GameView;
  legal: Action[];
  seat: PlayerId | null;
  colors: PlayerColor[];
  /** Why the player can't build now (not their turn, ...), or null. */
  later: string | null;
  onBuy(track: ImprovementTrack): void;
  close(): void;
}) {
  return (
    <Sheet title="City improvements" onClose={close} wide>
      <p class="hint flip-lead">
        Pay commodities to improve your cities. Each level draws progress cards on more red results; level 3 gives an ability; the first to level 4
        builds the metropolis (+2 VP). You need a city to build them.
      </p>
      <div class="flip">
        {TRACK_LIST.map((track) => (
          <TrackColumn
            key={track}
            view={view}
            seat={seat}
            colors={colors}
            track={track}
            later={later}
            can={legal.some((a) => a.type === 'improveCity' && a.track === track)}
            onBuy={() => onBuy(track)}
          />
        ))}
      </div>
      <ul class="flip-notes">
        {TRACK_LIST.map((t) => (
          <li key={t}>
            <GateGlyph track={t} /> <b>{improvementName(t, ABILITY_LEVEL)}</b>: {TRACK_INFO[t].abilityText}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// --- progress cards --------------------------------------------------------------------------------

function CardRow({ card, why, children }: { card: ProgressCardName; why?: string | null; children?: ComponentChildren }) {
  const deck = progressDeck(card);
  return (
    <div class={`prog-row deck-${deck}`} data-card={card}>
      <span class="prog-thumb">
        <ProgressCardView card={card} look="mini" />
      </span>
      <div class="prog-info">
        <strong>{progressTitle(card)}</strong>
        <span>{PROGRESS_TEXT[card]}</span>
        {why ? (
          <span class="prog-why">{why}</span>
        ) : (
          <span class="prog-deck">
            <GateGlyph track={deck} /> {TRACK_INFO[deck].label} deck
          </span>
        )}
      </div>
      {children && <div class="prog-actions">{children}</div>}
    </div>
  );
}

/**
 * Your progress cards (held and VP). "Play" opens a card's choices; a card
 * the engine doesn't offer now says why (whose turn, before or after the
 * roll, nothing to target). Over the limit on your own turn, cards go back
 * before the turn ends. Wide screens: 1-4 play a card.
 */
export function ProgressSheet({
  view,
  legal,
  seat,
  send,
  close,
  onPlay,
  desk,
}: {
  view: GameView;
  legal: Action[];
  seat: PlayerId;
  send(a: Action): void;
  close(): void;
  onPlay(card: ProgressCardName): void;
  /** Wide screens: key hints. */
  desk?: boolean;
}) {
  const ck = view.ck!;
  const me = ck.players[seat];
  const hand = me.progress ?? [];
  const over = Math.max(0, hand.length - PROGRESS_HAND_LIMIT);
  const discardable = (c: ProgressCardName) => legal.some((a) => a.type === 'discardProgress' && a.card === c);
  const why = hand.map((c) => progressWhy(view, seat, c, legal));
  useEffect(() => {
    if (!desk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || document.querySelector('.confirm-backdrop')) return;
      const i = Number(e.key) - 1;
      if (!Number.isInteger(i) || i < 0 || i >= hand.length || why[i]) return;
      e.preventDefault();
      onPlay(hand[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Sheet title="Progress cards" onClose={close} wide>
      {over > 0 && (
        <p class="prog-over" role="status">
          You hold {hand.length}: put {over} back under {over === 1 ? 'its deck' : 'their decks'} before you end your turn.
        </p>
      )}
      {hand.length === 0 ? (
        <p class="hint">
          No progress cards yet. A city gate on the event die draws them for players whose improvements of its colour show the red die: build city
          improvements to get them.
        </p>
      ) : (
        <div class="prog-list">
          {hand.map((card, i) => (
            <CardRow key={`${card}${i}`} card={card} why={why[i]}>
              <button
                type="button"
                class="primary prog-play"
                disabled={!!why[i]}
                title={why[i] ?? `Play the ${progressTitle(card)}`}
                aria-label={`Play ${progressTitle(card)}`}
                onClick={() => onPlay(card)}
              >
                Play
                {desk && !why[i] && i < 9 && (
                  <kbd class="key" aria-hidden="true">
                    {i + 1}
                  </kbd>
                )}
              </button>
              {over > 0 && discardable(card) && (
                <button type="button" onClick={() => send({ type: 'discardProgress', player: seat, card })}>
                  Put back
                </button>
              )}
            </CardRow>
          ))}
        </div>
      )}
      {me.vpCards.length > 0 && (
        <div class="prog-vp">
          <h3>Played face up</h3>
          {me.vpCards.map((card, i) => (
            <CardRow key={`${card}${i}`} card={card} />
          ))}
        </div>
      )}
      <p class="hint">
        Play any number after your roll, the Alchemist before it. You may hold {PROGRESS_HAND_LIMIT} (victory point cards are played at once and don't
        count). Cards left: {TRACK_LIST.map((t) => `${TRACK_INFO[t].label.toLowerCase()} ${ck.decks[t]}`).join(' · ')}.
      </p>
    </Sheet>
  );
}

// --- forced choices --------------------------------------------------------------------------------

/** Over the progress card limit on someone else's turn: put cards back under their decks. */
export function ProgressDiscardSheet({ view, legal, seat, send, covered }: { view: GameView; legal: Action[]; seat: PlayerId; send(a: Action): void; covered?: boolean }) {
  const ph = view.phase;
  const need = ph.kind === 'ck' && ph.step === 'progressDiscard' ? ph.pending[seat] ?? 0 : 0;
  const hand = view.ck!.players[seat].progress ?? [];
  const title = `Discard ${need} progress card${need === 1 ? '' : 's'}`;
  const seen = new Set<string>();
  return (
    <ForcedSheet
      title={title}
      covered={covered}
      back="Back to the cards"
      bar={
        <>
          <b>{title}</b>
          <small>
            You hold {hand.length}; the limit is {PROGRESS_HAND_LIMIT}
          </small>
        </>
      }
    >
      <p class="pick-lead">
        You hold <b>{hand.length}</b> progress cards: the limit is <b>{PROGRESS_HAND_LIMIT}</b>.
      </p>
      <p class="hint pick-note">Choose a card to put back under its deck (face down: nobody sees which).</p>
      <div class="prog-list">
        {hand.map((card, i) => {
          const first = !seen.has(card);
          seen.add(card);
          const ok = first && legal.some((a) => a.type === 'discardProgress' && a.card === card);
          return (
            <CardRow key={`${card}${i}`} card={card}>
              <button type="button" class="primary" disabled={!ok} onClick={() => send({ type: 'discardProgress', player: seat, card })}>
                Discard
              </button>
            </CardRow>
          );
        })}
      </div>
    </ForcedSheet>
  );
}

/** Tied best defenders: each draws a progress card from a deck of their choice. */
export function DefenderDrawSheet({ view, legal, seat, send, covered }: { view: GameView; legal: Action[]; seat: PlayerId; send(a: Action): void; covered?: boolean }) {
  const ck = view.ck!;
  return (
    <ForcedSheet
      title="Draw a progress card"
      covered={covered}
      back="Back to the decks"
      bar={
        <>
          <b>Draw a progress card</b>
          <small>You tied as Catan's best defender</small>
        </>
      }
    >
      <p class="pick-lead">Catan is saved!</p>
      <p class="hint pick-note">You tied as its best defender: draw the top card of a deck of your choice.</p>
      <div class="deck-pick">
        {TRACK_LIST.map((t) => {
          const a = legal.find((x) => x.type === 'drawProgress' && x.deck === t);
          return (
            <button type="button" key={t} class="deck-btn" disabled={!a} onClick={() => a && send(a)} aria-label={`Draw from the ${TRACK_INFO[t].label.toLowerCase()} deck`}>
              <ProgressCardView deck={t} back look="mini" />
              <span class="deck-btn-l">{TRACK_INFO[t].label}</span>
              <span class="deck-btn-n">{ck.decks[t]} left</span>
            </button>
          );
        })}
      </div>
    </ForcedSheet>
  );
}

/** The Aqueduct: a roll that gave you nothing lets you take a resource. */
export function AqueductSheet({ view, legal, seat, send, covered }: { view: GameView; legal: Action[]; seat: PlayerId; send(a: Action): void; covered?: boolean }) {
  return (
    <ForcedSheet
      title="Aqueduct"
      covered={covered}
      back="Back to the Aqueduct"
      bar={
        <>
          <b>Aqueduct</b>
          <small>Take a resource of your choice</small>
        </>
      }
    >
      <p class="pick-lead">The roll gave you nothing.</p>
      <p class="hint pick-note">Your Aqueduct lets you take one resource of your choice from the bank.</p>
      <div class="res-choice">
        {RESOURCES.map((r) => {
          const a = legal.find((x) => x.type === 'aqueduct' && x.resource === r);
          return (
            <button type="button" key={r} class="res-btn" disabled={!a} onClick={() => a && send(a)} aria-label={`Take ${RESOURCE_INFO[r].label}`}>
              <ResIcon r={r} />
              <span class="rate">{RESOURCE_INFO[r].label}</span>
            </button>
          );
        })}
      </div>
      <button type="button" class="wide" onClick={() => send({ type: 'aqueduct', player: seat })}>
        No thanks
      </button>
      {view.players[seat]?.resources && <p class="hint">You hold {Object.values(view.players[seat].resources!).reduce((a, b) => a + b, 0)} resource cards.</p>}
    </ForcedSheet>
  );
}

// --- answering a progress card another player played ---------------------------------------------------

/** What a card played by someone else asks of you, by its stage (src/ck/effects.ts). */
export function cardAsk(view: GameView, seat: PlayerId): { card: ProgressCardName; stage: string; by: string; need: number } | null {
  const ph = view.phase;
  if (ph.kind !== 'ck' || ph.step !== 'card' || !ph.pending?.[seat]) return null;
  return { card: ph.card, stage: ph.stage ?? '', by: view.players[ph.player]?.name ?? 'Another player', need: ph.pending[seat] };
}

/**
 * Cards to hand over for a card someone else played: a Wedding (2 cards of
 * your choice to its player) or a Saboteur (half your hand to the bank).
 */
export function CardPickSheet({ view, seat, send, covered }: { view: GameView; seat: PlayerId; send(a: Action): void; covered?: boolean }) {
  const ask = cardAsk(view, seat);
  const [row, setRow] = useState<SignedCounts>({});
  if (!ask) return null;
  const hand = handOfView(view, seat);
  const kinds = cardKindsOf(view);
  const need = ask.need;
  const picked = rowCount(row);
  const give = ask.stage === 'give';
  const word = `${need} card${need === 1 ? '' : 's'}`;
  const title = give ? `Give ${ask.by} ${word}` : `Discard ${word}`;
  return (
    <ForcedSheet title={title} covered={covered} back="Back to your cards" bar={<PeekLine title={title} picked={rowSides(row).give} n={picked} need={need} />}>
      <div class="card-ask">
        <span class="card-ask-art">
          <ProgressCardView card={ask.card} look="mini" />
        </span>
        <p class="pick-lead">
          {ask.by} played {give ? 'a ' : 'the '}
          {progressTitle(ask.card)}
        </p>
      </div>
      <p class="hint pick-note">
        {give
          ? `Every player with more victory points gives ${ask.by} ${need === 1 ? 'a card' : '2 cards'} of their choice: pick ${need === 1 ? 'it' : 'them'}.`
          : `Everyone with at least ${ask.by}’s victory points discards half their cards: pick ${word}.`}
      </p>
      <PickCards hand={hand} row={row} need={need} limit={hand} sign={-1} kinds={kinds} giving={give} onChange={setRow} />
      <button
        type="button"
        class="primary wide"
        disabled={picked !== need}
        onClick={() => send({ type: 'progressChoice', player: seat, args: { cards: cleanCounts(rowSides(row).give) } })}
      >
        {picked === need ? (give ? `Give ${word}` : `Discard ${word}`) : `${give ? 'Give' : 'Discard'} ${picked}/${need}`}
      </button>
    </ForcedSheet>
  );
}

/** A Commercial Harbor offer: give its player a commodity of your choice for a resource. */
export function HarborAnswerSheet({ view, legal, seat, send, covered }: { view: GameView; legal: Action[]; seat: PlayerId; send(a: Action): void; covered?: boolean }) {
  const ask = cardAsk(view, seat);
  if (!ask) return null;
  const hand = handOfView(view, seat);
  const title = `Give ${ask.by} a commodity`;
  return (
    <ForcedSheet
      title={title}
      covered={covered}
      back="Back to the offer"
      bar={
        <>
          <b>{title}</b>
          <small>Commercial Harbor</small>
        </>
      }
    >
      <div class="card-ask">
        <span class="card-ask-art">
          <ProgressCardView card="commercialHarbor" look="mini" />
        </span>
        <p class="pick-lead">{ask.by} played a Commercial Harbor</p>
      </div>
      <p class="hint pick-note">{ask.by} gives you a resource card; you give a commodity of your choice for it.</p>
      <div class="res-choice">
        {COMMODITY_LIST.map((c) => {
          const a = legal.find((x) => x.type === 'progressChoice' && x.args?.commodity === c);
          return (
            <button type="button" key={c} class="res-btn" disabled={!a} onClick={() => a && send(a)} aria-label={`Give ${CARD_INFO[c].label}`}>
              <ResIcon r={c} n={hand[c] ?? 0} />
              <span class="rate">{CARD_INFO[c].label}</span>
            </button>
          );
        })}
      </div>
    </ForcedSheet>
  );
}

/**
 * Any other choice a card asks of you that has no screen of its own yet:
 * one button per answer, so a game never waits on you for good.
 */
export function CardChoiceSheet({ view, legal, seat, send, covered }: { view: GameView; legal: Action[]; seat: PlayerId; send(a: Action): void; covered?: boolean }) {
  const ph = view.phase;
  if (ph.kind !== 'ck' || ph.step !== 'card') return null;
  const options = legal.filter((a): a is Extract<Action, { type: 'progressChoice' }> => a.type === 'progressChoice');
  const by = view.players[ph.player]?.name ?? 'Another player';
  const label = (args: Record<string, unknown> | undefined) => {
    if (!args) return 'Skip';
    return Object.entries(args)
      .map(([k, v]) => (typeof v === 'object' && v !== null ? countsText(v as CardCounts) : k === 'vertex' ? `the spot at ${spotLabel(view, String(v))}` : String(v)))
      .join(', ');
  };
  const title = progressTitle(ph.card);
  return (
    <ForcedSheet
      title={title}
      covered={covered}
      back="Back to the card"
      bar={
        <>
          <b>{title}</b>
          <small>{by} played it</small>
        </>
      }
    >
      <div class="card-ask">
        <span class="card-ask-art">
          <ProgressCardView card={ph.card} look="mini" />
        </span>
        <p class="pick-lead">
          {by} played {title}
        </p>
      </div>
      <p class="hint pick-note">{PROGRESS_TEXT[ph.card]}</p>
      <div class="choice-list">
        {options.map((a, i) => (
          <button type="button" key={i} class={a.args ? 'choice primary' : 'choice'} onClick={() => send(a)}>
            {label(a.args)}
          </button>
        ))}
      </div>
    </ForcedSheet>
  );
}

// --- a selected knight ----------------------------------------------------------------------------------

/**
 * The moves of one of your knights, in a bar over the board: activate,
 * promote, move (or displace), chase the robber (or, at sea, the pirate).
 */
export function KnightBar({
  view,
  legal,
  at,
  color,
  onAct,
  onMove,
  onClose,
}: {
  view: GameView;
  legal: Action[];
  at: VertexId;
  color: PlayerColor;
  /** A move that is made at once (after the "Ask before building" dialog). */
  onAct(a: Action): void;
  /** Pick where the knight goes. */
  onMove(): void;
  onClose(): void;
}) {
  const k = view.ck?.knights[at];
  if (!k) return null;
  const activate = legal.find((a) => a.type === 'activateKnight' && a.vertex === at);
  const promote = legal.find((a) => a.type === 'promoteKnight' && a.vertex === at);
  const moves = legal.filter((a) => (a.type === 'moveKnight' || a.type === 'displaceKnight') && a.from === at);
  const displace = moves.some((a) => a.type === 'displaceKnight');
  const chase = legal.find((a) => a.type === 'chaseRobber' && a.vertex === at && a.piece === 'robber');
  // Seafarers: a knight next to the pirate's sea hex chases the pirate
  const chasePirate = legal.find((a) => a.type === 'chaseRobber' && a.vertex === at && a.piece === 'pirate');
  const fresh = k.active && k.activatedPart === view.turn.part;
  const none = !activate && !promote && moves.length === 0 && !chase && !chasePirate;
  return (
    <div class="confirm-bar knight-bar" role="group" aria-label={`${KNIGHT_LABEL[k.level]}, ${k.active ? 'active' : 'inactive'}`}>
      <span class="kb-head">
        <span class="kb-art">
          <KnightGlyph level={k.level} active={k.active} fill={color.fill} stroke={color.stroke} />
        </span>
        <span class="kb-text">
          <b>{KNIGHT_LABEL[k.level]}</b>
          <small>
            {k.active ? (fresh ? 'Active · activated this turn' : 'Active') : 'Inactive'} · strength {k.level}
          </small>
        </span>
      </span>
      <div class="confirm-buttons">
        {activate && (
          <button type="button" class="primary" onClick={() => onAct(activate)}>
            Activate <Cost cost={ACTIVATE_COST} />
          </button>
        )}
        {promote && (
          <button type="button" class="primary" onClick={() => onAct(promote)}>
            Promote <Cost cost={PROMOTE_COST} />
          </button>
        )}
        {moves.length > 0 && (
          <button type="button" class="primary" onClick={onMove}>
            {displace ? 'Move / displace' : 'Move'}
          </button>
        )}
        {chase && (
          <button type="button" class="primary" onClick={() => onAct(chase)}>
            Chase robber
          </button>
        )}
        {chasePirate && (
          <button type="button" class="primary" onClick={() => onAct(chasePirate)}>
            Chase pirate
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {none && (
        <span class="kb-none">
          {fresh
            ? 'It was activated this turn: it can act from your next turn.'
            : k.level === 3
              ? 'A mighty knight is as strong as knights get.'
              : k.level === 2 && (view.ck?.players[k.owner].improvements.politics ?? 0) < ABILITY_LEVEL
                ? 'Mighty knights need the Fortress (politics 3).'
                : 'Nothing it can do right now.'}
        </span>
      )}
    </div>
  );
}
