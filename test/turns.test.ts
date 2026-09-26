import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  legalActions,
  playersToAct,
  randomAction,
  seedRng,
  simulate,
  updateLongestRoute,
  viewFor,
  type Action,
  type GameState,
} from '../src/index.js';
import { C, act, blank, fail, give, put, ringVertices, road, trail, withDice } from './helpers.js';

function vpState(settlements: number, p = 0, s = blank('base', 3)): GameState {
  // far-apart corners on the outer ring of the island
  const spots = [C(2, 0, 0), C(0, 2, 4), C(-2, 2, 3), C(-2, 0, 2), C(0, -2, 1)];
  for (let i = 0; i < settlements; i++) put(s, spots[i], p, 'city');
  return s;
}

describe('winning', () => {
  it('the active player wins as soon as they reach the target on their turn', () => {
    let s = vpState(4); // 8 VP
    s.players[0].devCards = [{ type: 'victoryPoint', boughtPart: 0 }];
    give(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2)]), 0);
    s = act(s, { type: 'buildSettlement', player: 0, vertex: C(0, 0, 2) });
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 0 });
    fail(s, { type: 'endTurn', player: 0 }, /over/);
  });

  it('a VP card wins on the turn it is bought', () => {
    let s = vpState(4, 0);
    s.players[0].devCards = [{ type: 'victoryPoint', boughtPart: 0 }];
    give(s, 0, { ore: 1, wool: 1, grain: 1 });
    s.devDeck.push('victoryPoint');
    s = act(s, { type: 'buyDevCard', player: 0 });
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 0 });
  });

  it('reaching the target on someone else\'s turn wins only at the start of your own turn (before rolling)', () => {
    let s = vpState(4, 1); // player 1 has 8 VP
    road(s, trail(s, ringVertices(0, -2).slice(0, 6)), 1); // 5 roads
    // player 0's turn: player 1 receives Longest Road (e.g. after a break elsewhere)
    updateLongestRoute(s);
    expect(s.longestRoute.holder).toBe(1);
    s = act(s, { type: 'endTurn', player: 0 }); // any action triggers the check; player 0 is active
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 1 });
    expect(s.turn.current).toBe(1);
    expect(s.turn.dice).toBeNull();
  });

  it('points gained off-turn do not end the game immediately', () => {
    let s = vpState(4, 1);
    s.players[1].devCards = [{ type: 'victoryPoint', boughtPart: 0 }, { type: 'victoryPoint', boughtPart: 0 }];
    // It is player 0's turn; player 1 already has 10 VP but may not win yet.
    give(s, 0, { ore: 4 });
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    expect(s.phase.kind).toBe('main');
  });

  it('the victory target can be overridden', () => {
    const s = createGame({ scenario: 'base', players: 3, seed: 1, options: { victoryPoints: 12 } });
    expect(s.victoryTarget).toBe(12);
  });
});

describe('purity and determinism', () => {
  it('applyAction never mutates its input', () => {
    const s = blank('base', 3);
    give(s, 0, { ore: 4 });
    const before = JSON.stringify(s);
    const r = applyAction(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('same seed and same actions replay to the same state', () => {
    const run = () => {
      const actions: Action[] = [];
      const r = simulate(createGame({ scenario: 'seafarers-2-four-islands', players: 3, seed: 'replay' }), seedRng('bots'), 400, (_, a) => actions.push(a));
      return { state: r.state, actions };
    };
    const a = run();
    let s = createGame({ scenario: 'seafarers-2-four-islands', players: 3, seed: 'replay' });
    for (const x of a.actions) s = act(s, x);
    expect(s).toEqual(a.state);
    expect(run().state).toEqual(a.state);
  });

  it('rejects malformed actions without throwing', () => {
    const s = blank('base', 3);
    expect(applyAction(s, { type: 'nope', player: 0 } as unknown as Action).ok).toBe(false);
    expect(applyAction(s, { type: 'endTurn', player: 9 }).ok).toBe(false);
    expect(applyAction(s, { type: 'bankTrade', player: 0, give: { ore: -4 }, get: { wool: 1 } }).ok).toBe(false);
    expect(applyAction(s, { type: 'buildRoad', player: 0, edge: 'bogus' }).ok).toBe(false);
    expect(applyAction(s, { type: 'discard', player: 0, cards: { gold: 1 } as never }).ok).toBe(false);
  });

  it('the state is plain JSON', () => {
    const s = createGame({ scenario: 'seafarers-3-fog-islands', players: 4, seed: 'json' });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('player views', () => {
  it('hide other hands, development cards, the deck, the RNG and the fog stack', () => {
    let s = createGame({ scenario: 'seafarers-3-fog-islands', players: 3, seed: 'view' });
    s = simulate(s, seedRng('v'), 300).state;
    s.players[1].devCards = [{ type: 'knight', boughtPart: 0 }];
    const v = viewFor(s, 0);
    expect(v.players[0].resources).toBeDefined();
    expect(v.players[1].resources).toBeUndefined();
    expect(v.players[1].resourceCount).toBe(Object.values(s.players[1].resources).reduce((a, b) => a + b, 0));
    expect(v.players[1].devCards).toBeUndefined();
    expect(v.players[1].devCardCount).toBe(1);
    const json = JSON.stringify(v);
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('devDeck"');
    expect(v.ext.fog).toMatchObject({ terrainsLeft: expect.any(Number) });
    expect((v.ext.fog as Record<string, unknown>).terrains).toBeUndefined();
  });

  it('private log lines only reach their audience', () => {
    const s = blank('base', 3);
    s.log.push({ turn: 1, msg: 'secret', visibleTo: [1] });
    expect(viewFor(s, 1).log.some((l) => l.msg === 'secret')).toBe(true);
    expect(viewFor(s, 2).log.some((l) => l.msg === 'secret')).toBe(false);
    expect(viewFor(s, null).log.some((l) => l.msg === 'secret')).toBe(false);
  });
});

describe('5-6 players', () => {
  function sixPlayer(mode: 'paired' | 'specialBuild'): GameState {
    const s = blank('base', 6, { fiveSixMode: mode });
    return s;
  }

  it('paired players: player 2 is the third to the left and acts after player 1', () => {
    let s = sixPlayer('paired');
    put(s, C(0, 0, 0), 3);
    give(s, 3, { brick: 1, lumber: 1, ore: 4 });
    give(s, 0, { wool: 1 });
    fail(s, { type: 'buildRoad', player: 3, edge: trail(s, [C(0, 0, 0), C(0, 0, 1)])[0] }, /not your turn/);
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.turn).toMatchObject({ current: 0, actor: 3, role: 'paired' });
    expect(s.phase.kind).toBe('main');
    // may build and trade with the supply, but may not roll or trade with players
    fail(s, { type: 'rollDice', player: 3 });
    fail(s, { type: 'proposeTrade', player: 3, give: { ore: 1 }, get: { wool: 1 }, to: [0] }, /active player/);
    s = act(s, { type: 'bankTrade', player: 3, give: { ore: 4 }, get: { grain: 1 } });
    s = act(s, { type: 'buildRoad', player: 3, edge: trail(s, [C(0, 0, 0), C(0, 0, 1)])[0] });
    s = act(s, { type: 'endTurn', player: 3 });
    // both markers pass left
    expect(s.turn).toMatchObject({ current: 1, actor: 1, role: 'active' });
    expect(s.phase.kind).toBe('preRoll');
    s = withDice(s, 2, 3);
    s = act(s, { type: 'rollDice', player: 1 });
    s = act(s, { type: 'endTurn', player: 1 });
    expect(s.turn.actor).toBe(4);
  });

  it('paired players: a card bought as player 2 can be played in a later part; either player can win in their own part', () => {
    let s = sixPlayer('paired');
    s = act(s, { type: 'endTurn', player: 0 });
    give(s, 3, { ore: 1, wool: 1, grain: 1 });
    s.devDeck.push('monopoly');
    s = act(s, { type: 'buyDevCard', player: 3 });
    fail(s, { type: 'playMonopoly', player: 3, resource: 'ore' }, /bought/);
    const part = s.turn.part;
    s.turn.part = part + 1; // a later part of the game
    s = act(s, { type: 'playMonopoly', player: 3, resource: 'ore' });
    // winning as player 2, during the paired part
    let w = sixPlayer('paired');
    w = act(w, { type: 'endTurn', player: 0 });
    vpState(3, 3, w); // 6 VP
    w.players[3].devCards = [
      { type: 'victoryPoint', boughtPart: 0 },
      { type: 'victoryPoint', boughtPart: 0 },
    ];
    put(w, C(-2, 0, 2), 3); // 9 VP
    give(w, 3, { ore: 3, grain: 2 });
    w = act(w, { type: 'buildCity', player: 3, vertex: C(-2, 0, 2) });
    expect(w.phase).toMatchObject({ kind: 'gameOver', winner: 3 });
  });

  it('legacy Special Build Phase: others build in turn order with cards in hand only, and cannot win', () => {
    let s = sixPlayer('specialBuild');
    put(s, C(0, 0, 0), 2);
    give(s, 2, { brick: 1, lumber: 1, ore: 4, wool: 1, grain: 1 });
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.phase).toMatchObject({ kind: 'specialBuild', queue: [1, 2, 3, 4, 5] });
    expect(s.turn.actor).toBe(1);
    s = act(s, { type: 'endTurn', player: 1 });
    expect(s.turn.actor).toBe(2);
    fail(s, { type: 'bankTrade', player: 2, give: { ore: 4 }, get: { grain: 1 } });
    s.players[2].devCards.push({ type: 'yearOfPlenty', boughtPart: 0 });
    fail(s, { type: 'playYearOfPlenty', player: 2, resources: ['ore', 'ore'] }, /cannot be played now/);
    s = act(s, { type: 'buildRoad', player: 2, edge: trail(s, [C(0, 0, 0), C(0, 0, 1)])[0] });
    s = act(s, { type: 'buyDevCard', player: 2 });
    // cannot win during the special build phase
    vpState(4, 2, s);
    s.players[2].devCards.push({ type: 'victoryPoint', boughtPart: 0 }, { type: 'victoryPoint', boughtPart: 0 });
    s = act(s, { type: 'endTurn', player: 2 });
    expect(s.phase.kind).toBe('specialBuild');
    for (const p of [3, 4, 5]) s = act(s, { type: 'endTurn', player: p });
    expect(s.turn.current).toBe(1);
    expect(s.phase.kind).toBe('preRoll');
  });

  it('paired mode runs with Seafarers (New World, 5 players)', () => {
    const s = createGame({ scenario: 'seafarers-9-new-world', players: 5, seed: 'p5' });
    expect(s.players).toHaveLength(5);
    const r = simulate(s, seedRng('p5'), 3000);
    expect(r.steps).toBeGreaterThan(100);
  });
});

describe('legal action enumeration', () => {
  it('every enumerated action is accepted by the engine', () => {
    let s = createGame({ scenario: 'base', players: 4, seed: 'enum' });
    const rng = seedRng('enum');
    for (let i = 0; i < 400 && s.phase.kind !== 'gameOver'; i++) {
      for (const p of playersToAct(s)) {
        for (const a of legalActions(s, p)) {
          expect(applyAction(s, a).ok, JSON.stringify(a)).toBe(true);
        }
      }
      const p = playersToAct(s)[0];
      s = act(s, randomAction(s, p, rng)!);
    }
  });
});

describe('dice history', () => {
  it('records every roll with who rolled it, and shows it to every player', () => {
    let s = blank('base', 3);
    s.phase = { kind: 'preRoll' };
    s = act(s, { type: 'rollDice', player: 0 });
    const [a, b] = s.turn.dice!;
    expect(s.rolls).toEqual([{ by: 0, dice: [a, b], turn: s.turn.number }]);
    expect(viewFor(s, 2).rolls).toEqual(s.rolls);
    expect(viewFor(s, null).rolls).toHaveLength(1);
  });
});
