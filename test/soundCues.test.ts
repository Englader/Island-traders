import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  heuristicAction,
  legalActions,
  playersToAct,
  viewFor,
  type Action,
  type GameState,
  type PartialCounts,
  type PlayerId,
  type Resource,
} from '../src/index.js';
import { attentionCue, cuesFor, endCue, type CueCall } from '../web/src/game/soundCues.js';
import { ckAfterSetup, ckMain, giveCards, loadDice, makeCity, setLevels } from '../e2e/ckState.js';
import { sevenGame } from '../e2e/discardState.js';
import { tradeGame } from '../e2e/tradeState.js';

/*
 * Which sounds a move makes, for each seat: worked out from the views just
 * before and after the move, as the browser does (web/src/game/soundCues.ts).
 */

function act(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}

/** The sounds of `a` for the player at `seat` (null: watching). */
function cues(s: GameState, a: Action, seat: PlayerId | null): CueCall[] {
  return cuesFor(a, viewFor(s, seat), viewFor(act(s, a), seat), seat);
}

const names = (c: CueCall[]) => c.map((x) => x.cue);

function find<T extends Action['type']>(s: GameState, type: T, p: PlayerId = 0, ok: (a: Extract<Action, { type: T }>) => boolean = () => true) {
  const a = legalActions(s, p).find((x): x is Extract<Action, { type: T }> => x.type === type && ok(x as Extract<Action, { type: T }>));
  if (!a) throw new Error(`no ${type} for player ${p}`);
  return a;
}

function give(s: GameState, p: PlayerId, c: PartialCounts): void {
  for (const [r, n] of Object.entries(c) as Array<[Resource, number]>) {
    s.bank[r] -= n;
    s.players[p].resources[r] += n;
  }
}

/** A base game played by the computer through the set-up: Sam (seat 0) is about to roll. */
function afterSetup(seed = 'sound'): GameState {
  let s = createGame({ scenario: 'base', players: ['Sam', 'Ada', 'Björn'], seed, options: { firstPlayer: 0 } });
  for (let i = 0; i < 400 && !(s.phase.kind === 'preRoll' && s.turn.actor === 0); i++) {
    const p = playersToAct(s)[0];
    s = act(s, heuristicAction(s, p, 'medium') ?? legalActions(s, p)[0]);
  }
  return s;
}

/** `p`'s turn after the roll, with `hand` added. */
function mainFor(s: GameState, p: PlayerId, hand: PartialCounts = {}): GameState {
  s.phase = { kind: 'main' };
  s.turn.dice = [3, 5];
  s.turn.actor = p;
  s.turn.current = p;
  give(s, p, hand);
  return s;
}

const RICH = { brick: 4, lumber: 4, wool: 3, grain: 4, ore: 4 };

describe('sound cues: building', () => {
  it('your road, settlement and city: a tap, a knock, a thud', () => {
    const s = mainFor(afterSetup(), 0, RICH);
    expect(cues(s, find(s, 'buildRoad'), 0)).toEqual([{ cue: 'road', at: 'now' }]);
    expect(cues(s, find(s, 'buildCity'), 0)).toEqual([{ cue: 'city', at: 'now' }]);
    const setup = createGame({ scenario: 'base', players: 3, seed: 'sound-setup', options: { firstPlayer: 0 } });
    expect(cues(setup, find(setup, 'placeSettlement'), 0)).toEqual([{ cue: 'settlement', at: 'now' }]);
  });

  it("other players' builds are quieter, and heard by those watching too", () => {
    const s = mainFor(afterSetup(), 1, RICH);
    const road = find(s, 'buildRoad', 1);
    expect(cues(s, road, 0)).toEqual([{ cue: 'road', at: 'now', quiet: true }]);
    expect(cues(s, road, null)).toEqual([{ cue: 'road', at: 'now', quiet: true }]);
    expect(cues(s, road, 1)).toEqual([{ cue: 'road', at: 'now' }]);
  });

  it('ending a turn makes no sound of its own', () => {
    const s = mainFor(afterSetup(), 0);
    expect(cues(s, { type: 'endTurn', player: 0 }, 0)).toEqual([]);
  });
});

describe('sound cues: the dice and the robber', () => {
  it('a roll rattles at once; a 7 sounds when the dice land, for everyone', () => {
    const s = sevenGame().state;
    const roll: Action = { type: 'rollDice', player: 0 };
    expect(cues(s, roll, 0)).toEqual([
      { cue: 'roll', at: 'now' },
      { cue: 'seven', at: 'land' },
    ]);
    expect(cues(s, roll, 1)).toEqual([
      { cue: 'roll', at: 'now', quiet: true },
      { cue: 'seven', at: 'land' },
    ]);
  });

  it('any other number: only the rattle', () => {
    const s = loadDice(afterSetup(), { sum: 8 });
    expect(cues(s, { type: 'rollDice', player: 0 }, 0)).toEqual([{ cue: 'roll', at: 'now' }]);
  });

  it('the robber moves with a low tone; robbed of a card, you hear the robbery', () => {
    for (const seed of ['sound', 'sound-2', 'sound-3', 'sound-4']) {
      let s = loadDice(afterSetup(seed), { sum: 7 });
      s = act(s, { type: 'rollDice', player: 0 });
      if (s.phase.kind !== 'robber') continue;
      const rob = legalActions(s, 0).find((a) => a.type === 'moveRobber' && a.victim === 1);
      if (!rob) continue;
      expect(cues(s, rob, 1)).toEqual([{ cue: 'stolen', at: 'now' }]);
      expect(cues(s, rob, 0)).toEqual([{ cue: 'robber', at: 'now' }]);
      expect(cues(s, rob, 2)).toEqual([{ cue: 'robber', at: 'now', quiet: true }]);
      return;
    }
    throw new Error('no robbery found');
  });
});

describe('sound cues: whose turn it is', () => {
  it('your turn comes round: a chime, on your device only', () => {
    const s = tradeGame({ actor: 2, hand: { brick: 1 } }).record.state;
    const end: Action = { type: 'endTurn', player: 2 };
    expect(cues(s, end, 0)).toEqual([{ cue: 'yourTurn', at: 'now' }]);
    expect(cues(s, end, 1)).toEqual([]);
    expect(cues(s, end, null)).toEqual([]);
  });

  it('something to answer out of turn: a softer note', () => {
    const s = tradeGame({ actor: 1, hand: { brick: 5, grain: 4 } }).record.state;
    const discard = structuredClone(s);
    discard.phase = { kind: 'discard', pending: { 0: 4 }, resume: { kind: 'main' } };
    expect(attentionCue(viewFor(s, 0), viewFor(discard, 0), 0)).toBe('nudge');
    expect(attentionCue(viewFor(s, 2), viewFor(discard, 2), 2)).toBeNull();
    // already asked: not again
    expect(attentionCue(viewFor(discard, 0), viewFor(discard, 0), 0)).toBeNull();
  });

  it('the special build phase asks softly', () => {
    const s = tradeGame({ actor: 1 }).record.state;
    const sb = structuredClone(s);
    sb.phase = { kind: 'specialBuild', queue: [0] };
    sb.turn.actor = 0;
    expect(attentionCue(viewFor(s, 0), viewFor(sb, 0), 0)).toBe('nudge');
  });
});

describe('sound cues: trading', () => {
  const offer = (p: PlayerId, to: PlayerId[]): Action => ({ type: 'proposeTrade', player: p, give: { brick: 1 }, get: { wool: 1 }, to });

  it('an offer for you pings; your own offer is silent', () => {
    const s = tradeGame().record.state;
    expect(cues(s, offer(0, [1, 2]), 1)).toEqual([{ cue: 'tradeOffer', at: 'now' }]);
    expect(cues(s, offer(0, [1]), 2)).toEqual([]);
    expect(cues(s, offer(0, [1, 2]), 0)).toEqual([]);
    // another player's offer on their turn: the ping, not the "answer it" note as well
    const theirs = tradeGame({ actor: 1, hand: { wool: 2 } }).record.state;
    expect(cues(theirs, offer(1, [0]), 0)).toEqual([{ cue: 'tradeOffer', at: 'now' }]);
  });

  it('answers to your offer: declined softly, accepted with a ping, made with coins', () => {
    let s = act(tradeGame().record.state, offer(0, [1, 2]));
    const id = s.turn.trades[0].id;
    expect(cues(s, { type: 'rejectTrade', player: 2, tradeId: id }, 0)).toEqual([{ cue: 'tradeDeclined', at: 'now' }]);
    expect(cues(s, { type: 'rejectTrade', player: 2, tradeId: id }, 1)).toEqual([]);
    const accept: Action = { type: 'acceptTrade', player: 1, tradeId: id };
    expect(cues(s, accept, 0)).toEqual([{ cue: 'tradeOffer', at: 'now' }]);
    s = act(s, accept);
    const confirm: Action = { type: 'confirmTrade', player: 0, tradeId: id, partner: 1 };
    expect(cues(s, confirm, 0)).toEqual([{ cue: 'tradeDone', at: 'fx', beat: 0.3 }]);
    expect(cues(s, confirm, 1)).toEqual([{ cue: 'tradeDone', at: 'fx', beat: 0.3 }]);
    expect(cues(s, confirm, 2)).toEqual([{ cue: 'tradeDone', at: 'fx', beat: 0.3, quiet: true }]);
  });

  it("a bank trade: coins for you, nothing for the others", () => {
    const { record, special } = tradeGame();
    const s = record.state;
    const bank = find(s, 'bankTrade', 0, (a) => (a.give[special] ?? 0) === 2);
    expect(cues(s, bank, 0)).toEqual([{ cue: 'tradeDone', at: 'fx', beat: 0.3 }]);
    expect(cues(s, bank, 1)).toEqual([]);
  });
});

describe('sound cues: development cards', () => {
  it('buying one flicks a card; playing one has a flourish', () => {
    const s = tradeGame().record.state;
    const buy: Action = { type: 'buyDevCard', player: 0 };
    expect(cues(s, buy, 0)).toEqual([{ cue: 'cardDraw', at: 'fx', beat: 0.05 }]);
    expect(cues(s, buy, 1)).toEqual([{ cue: 'cardDraw', at: 'fx', beat: 0.05, quiet: true }]);
    const k = structuredClone(s);
    k.players[0].devCards = [{ type: 'knight', boughtPart: 0 }];
    expect(names(cues(k, { type: 'playKnight', player: 0 }, 0))).toEqual(['cardPlay']);
  });

  it("someone's Monopoly that empties your hand: their flourish, then your loss", () => {
    const s = tradeGame({ actor: 1, hand: { grain: 3 } }).record.state;
    s.players[1].devCards = [{ type: 'monopoly', boughtPart: 0 }];
    const c = cues(s, { type: 'playMonopoly', player: 1, resource: 'grain' }, 0);
    expect(c).toEqual([
      { cue: 'cardPlay', at: 'fx', beat: 0, quiet: true },
      { cue: 'stolen', at: 'fx', beat: 0.35 },
    ]);
  });
});

describe('sound cues: Cities & Knights', () => {
  it('a knight clinks, a wall is stone', () => {
    const s = ckMain(ckAfterSetup('sound-ck'), { wool: 1, ore: 1, brick: 2 });
    expect(cues(s, find(s, 'buildKnight'), 0)).toEqual([{ cue: 'knight', at: 'now' }]);
    expect(cues(s, find(s, 'buildCityWall'), 0)).toEqual([{ cue: 'wall', at: 'now' }]);
    // the set-up's second round places a city
    const setup = createGame({ scenario: 'base', players: ['Sam', 'Ada', 'Björn'], seed: 'sound-ck', options: { firstPlayer: 0, citiesAndKnights: true } });
    let t = setup;
    while (!(t.phase.kind === 'setup' && t.phase.round === 1 && t.turn.actor === 0)) t = act(t, heuristicAction(t, playersToAct(t)[0], 'medium')!);
    expect(cues(t, find(t, 'placeSettlement'), 0)).toEqual([{ cue: 'city', at: 'now' }]);
  });

  it('a city improvement chimes; a metropolis rings', () => {
    const s = ckMain(ckAfterSetup('sound-ck'), { cloth: 4 });
    expect(cues(s, find(s, 'improveCity'), 0)).toEqual([{ cue: 'improve', at: 'fx', beat: 0.1 }]);
    const m = ckMain(ckAfterSetup('sound-ck'), {});
    setLevels(m, 0, { trade: 3 });
    giveCards(m, 0, { cloth: 4 });
    const metro = find(m, 'improveCity', 0, (a) => a.vertex !== undefined);
    expect(cues(m, metro, 0)).toEqual([{ cue: 'metropolis', at: 'fx', beat: 0.1 }]);
    expect(cues(m, metro, 1)).toEqual([{ cue: 'metropolis', at: 'fx', beat: 0.1 }]);
  });

  it('the barbarian ship sails on: a horn as the dice land', () => {
    const s = loadDice(ckAfterSetup('sound-ck'), { event: 'ship', sum: 8 });
    expect(cues(s, { type: 'rollDice', player: 0 }, 1)).toEqual([
      { cue: 'roll', at: 'now', quiet: true },
      { cue: 'barbarianShip', at: 'land' },
    ]);
  });

  it('the barbarians attack: drums, then how it ended, then the cities to lose', () => {
    const s = ckAfterSetup('sound-ck');
    s.ck!.barbarians = 6;
    // Ada has two cities: she chooses which one she loses
    makeCity(s, 1);
    loadDice(s, { event: 'ship', sum: 8 });
    const c = cues(s, { type: 'rollDice', player: 0 }, 1);
    expect(names(c)).toEqual(['roll', 'barbarianShip', 'attack', 'attackLost', 'nudge']);
    expect(c.find((x) => x.cue === 'attack')).toEqual({ cue: 'attack', at: 'fx', beat: 0 });
    expect(c.find((x) => x.cue === 'attackLost')).toEqual({ cue: 'attackLost', at: 'fx', beat: 0.46 });
    // the city to lose is asked after the outcome
    expect(c.find((x) => x.cue === 'nudge')).toEqual({ cue: 'nudge', at: 'fx', beat: 0.6 });
  });
});

describe('sound cues: the end of the game', () => {
  const over = (winner: PlayerId | null) => {
    const s = tradeGame().record.state;
    s.phase = { kind: 'gameOver', winner, reason: '10 victory points' };
    return s;
  };
  it('a fanfare for the winner, a gentle close for the others', () => {
    const kinds = ['human', 'bot', 'bot'] as const;
    expect(endCue(viewFor(over(0), 0), 0, [...kinds])).toBe('victory');
    expect(endCue(viewFor(over(1), 0), 0, [...kinds])).toBe('defeat');
    // pass-and-play: a win for anyone at this device
    expect(endCue(viewFor(over(1), 0), 0, ['human', 'human', 'bot'])).toBe('victory');
    // watching
    expect(endCue(viewFor(over(2), null), null, [...kinds])).toBe('victory');
    // not over yet
    expect(endCue(viewFor(tradeGame().record.state, 0), 0, [...kinds])).toBeNull();
  });
});
