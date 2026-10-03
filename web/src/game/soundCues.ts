import type { Action, GameView, PlayerId } from 'engine';
import { fxFor, type FxEvent } from './fx';
import { mustAct, type SeatKind } from './seats';
import { sound, type Cue, type PlayOptions, type Voice } from './sound';

/*
 * Which sounds a move makes, and when. Plain data worked out from the views
 * just before and after the move, so it can be tested without a browser;
 * ui/GameScreen.tsx plays them. Every device plays the sounds of the moves it
 * sees (online too: nothing about sound goes over the network). Your own
 * moves sound at full strength; other players' are quieter, and some of
 * theirs (bank trades) make no sound at all.
 */

/**
 * When a sound plays: at once ('now'), when the rolling dice land ('land'),
 * or with the moment shown in the middle of the screen ('fx', `beat` of the
 * way through it: ui/Fx.tsx).
 */
export type CueTime = 'now' | 'land' | 'fx';

export interface CueCall {
  cue: Cue;
  at: CueTime;
  /** 'fx' sounds: how far into the moment (0-1). */
  beat?: number;
  /** Another player's move: played softer. */
  quiet?: boolean;
}

const ROLLS = (a: Action) => a.type === 'rollDice' || (a.type === 'playProgress' && a.card === 'alchemist');

/** Moves of other players that can take cards from your hand. */
const TAKERS = new Set<Action['type']>(['playMonopoly', 'playProgress', 'progressChoice', 'scenario']);

const BUILD: Partial<Record<Action['type'], Cue>> = {
  placeRoad: 'road',
  buildRoad: 'road',
  placeHarbor: 'road',
  placeShip: 'ship',
  buildShip: 'ship',
  moveShip: 'ship',
  buildSettlement: 'settlement',
  buildCity: 'city',
  buildKnight: 'knight',
  activateKnight: 'knight',
  promoteKnight: 'knight',
  moveKnight: 'knight',
  displaceKnight: 'knight',
  retreatKnight: 'knight',
  chaseRobber: 'knight',
  buildCityWall: 'wall',
};

/**
 * Whether the move puts the player at the device on the spot: their turn has
 * come ('yourTurn'), or they must answer out of turn ('nudge': discard on
 * someone's 7, answer a progress card, choose a city to lose, build in the
 * special build phase).
 */
export function attentionCue(before: GameView, after: GameView, seat: PlayerId | null): Cue | null {
  if (seat === null || after.phase.kind === 'gameOver') return null;
  const need = mustAct(after);
  if (!need.includes(seat)) return null;
  const mine = after.turn.actor === seat;
  const newTurn = before.turn.actor !== after.turn.actor || before.turn.number !== after.turn.number || before.turn.part !== after.turn.part;
  if (mine && newTurn) return after.phase.kind === 'specialBuild' ? 'nudge' : 'yourTurn';
  if (!mine && !mustAct(before).includes(seat)) return 'nudge';
  return null;
}

const handOf = (v: GameView, p: PlayerId) => v.players[p]?.resourceCount ?? 0;

/**
 * The sounds of one move (`before` is the view just before it), for the
 * player at this device (`seat`; null: watching). `fx` is the moment the move
 * shows (fxFor), if already worked out.
 */
export function cuesFor(action: Action, before: GameView, after: GameView, seat: PlayerId | null, fx?: FxEvent | null): CueCall[] {
  const out: CueCall[] = [];
  const by = action.player;
  const mine = seat !== null && by === seat;
  const add = (cue: Cue, at: CueTime = 'now', o: { quiet?: boolean; beat?: number } = {}) => {
    const quiet = o.quiet ?? !mine;
    out.push({ cue, at, ...(at === 'fx' ? { beat: o.beat ?? 0 } : {}), ...(quiet ? { quiet: true } : {}) });
  };
  const rolled = ROLLS(action);

  // the dice: a rattle, then a 7 or the barbarian ship once they land
  if (rolled) {
    add('roll');
    const d = after.turn.dice;
    if (d && d[0] + d[1] === 7) add('seven', 'land', { quiet: false });
    if (after.ck?.event === 'ship') add('barbarianShip', 'land', { quiet: false });
  }

  // pieces on the board
  const piece = action.type === 'placeSettlement' ? (after.board.buildings[action.vertex]?.type === 'city' ? 'city' : 'settlement') : BUILD[action.type];
  if (piece) add(piece);

  // the robber and the pirate; your cards taken
  if (action.type === 'moveRobber') {
    if (seat !== null && action.victim === seat && !mine) add('stolen', 'now', { quiet: false });
    else add('robber');
  }

  // trade offers and their answers
  if (seat !== null && !mine) {
    if (action.type === 'proposeTrade' && action.to.includes(seat)) add('tradeOffer', 'now', { quiet: false });
    const offer = action.type === 'acceptTrade' || action.type === 'rejectTrade' ? before.turn.trades.find((t) => t.id === action.tradeId) : undefined;
    if (offer && offer.from === seat) {
      // accepted, waiting for you to confirm (a counter-offer taken trades at once: the coins below)
      if (action.type === 'acceptTrade' && after.turn.trades.some((t) => t.id === offer.id)) add('tradeOffer', 'now', { quiet: false });
      if (action.type === 'rejectTrade') add('tradeDeclined', 'now', { quiet: false });
    }
  }

  // the moment shown in the middle of the screen
  const e = fx === undefined ? fxFor(action, before, after, seat) : fx;
  if (e) {
    switch (e.kind) {
      case 'trade': {
        const yours = seat !== null && (e.a === seat || e.b === seat);
        if (yours) add('tradeDone', 'fx', { beat: 0.3, quiet: false });
        else if (e.b !== 'bank') add('tradeDone', 'fx', { beat: 0.3, quiet: true });
        break;
      }
      case 'devBuy':
        add('cardDraw', 'fx', { beat: 0.05 });
        break;
      case 'draw':
        add('cardDraw', 'fx', { beat: 0.05, quiet: !e.draws.some((d) => d.p === seat) });
        break;
      case 'devPlay':
        add('cardPlay', 'fx');
        break;
      case 'progPlay':
        add('cardPlay', 'fx', { quiet: !mine && e.target !== seat });
        break;
      case 'improve':
        if (e.metropolis) add('metropolis', 'fx', { beat: 0.1, quiet: false });
        else add('improve', 'fx', { beat: 0.1 });
        break;
      case 'attack':
        add('attack', 'fx', { quiet: false });
        add(e.won ? 'attackWon' : 'attackLost', 'fx', { beat: 0.46, quiet: false });
        break;
    }
  }

  // cards taken from you by someone else's card (the Monopoly, a Spy, a Wedding...)
  if (seat !== null && !mine && TAKERS.has(action.type) && handOf(after, seat) < handOf(before, seat)) add('stolen', e ? 'fx' : 'now', { beat: 0.35, quiet: false });

  // your turn, or something to answer, after what the move shows (an offer's ping and a 7's bell say it already)
  const att = attentionCue(before, after, seat);
  if (att && !out.some((c) => c.cue === 'tradeOffer' || c.cue === 'seven')) {
    if (e) add(att, 'fx', { beat: 0.6, quiet: false });
    else if (rolled) add(att, 'land', { quiet: false });
    else add(att, 'now', { quiet: false });
  }
  return out;
}

/** The end of the game, for the player at this device: a fanfare when they (or a player on this device) win. */
export function endCue(view: GameView, seat: PlayerId | null, kinds: SeatKind[]): Cue | null {
  const ph = view.phase;
  if (ph.kind !== 'gameOver') return null;
  const w = ph.winner;
  // watching: the end is celebrated all the same
  if (seat === null) return w === null ? 'defeat' : 'victory';
  if (w === null) return 'defeat';
  // pass-and-play: any player at this device winning is a win here
  if (w === seat || (kinds[seat] === 'human' && kinds[w] === 'human')) return 'victory';
  return 'defeat';
}

/** When each kind of sound starts, in seconds from now. */
export interface CueTiming {
  /** The rolling dice land (0 without the animation). */
  land?: number;
  /** The moment shown in the middle of the screen lasts this long (s). */
  fx?: number;
}

/** Plays a move's sounds (see cuesFor); the dice rattle lasts `rollFor` seconds. */
export function playCues(calls: CueCall[], timing: CueTiming = {}, rollFor = 0.4, dice = 2): Voice[] {
  const out: Voice[] = [];
  for (const c of calls) {
    const opts: PlayOptions = { quiet: !!c.quiet };
    if (c.at === 'land') opts.delay = timing.land ?? 0;
    if (c.at === 'fx') opts.delay = (c.beat ?? 0) * (timing.fx ?? 0);
    if (c.cue === 'roll') {
      opts.duration = rollFor;
      opts.dice = dice;
    }
    const v = sound.play(c.cue, opts);
    if (v) out.push(v);
  }
  return out;
}
