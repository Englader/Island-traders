import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS,
  createGame,
  heuristicAction,
  legalActions,
  publicVP,
  setupPlacesCity,
  simulateHeuristic,
  topo,
  type Action,
  type BotLevel,
  type GameState,
  type PlayerId,
} from '../src/index.js';
import { CK, bare, checkInvariants, giveC, hand, knight } from './ckHelpers.js';
import { C, H, act, give, put, road, setHex, trail } from './helpers.js';

/**
 * Cities & Knights computer players (src/bots/ckBot.ts): key decisions per
 * level, and whole games at every level. The league that measures the levels
 * against each other is `npm run bots:league -- 60 ck` (scripts/bot-league.ts).
 */

/** The bot's move for `p` at `level`, which must be one of the legal moves. */
function botMove(s: GameState, p: PlayerId, level: BotLevel = 'medium'): Action {
  const a = heuristicAction(s, p, level);
  expect(a, `a move for ${p}`).not.toBeNull();
  expect(legalActions(s, p)).toContainEqual(a);
  return a!;
}

/** Three cities (barbarian strength 3), one per player, on a bare board. */
function threeCities(): GameState {
  const s = bare();
  put(s, C(0, 0, 0), 0, 'city');
  put(s, C(-2, 0, 0), 1, 'city');
  put(s, C(0, -2, 0), 2, 'city');
  return s;
}

describe('Cities & Knights computer players: the barbarians', () => {
  it('activates a knight before an attack it would lose with a city at risk', () => {
    const s = threeCities();
    // the others defend with 1 each: 2 against 3, and player 0 would be the weakest
    knight(s, C(-2, 2, 0), 1, 1, true);
    knight(s, C(2, -2, 3), 2, 1, true);
    knight(s, C(0, 0, 2), 0, 1);
    give(s, 0, { grain: 1 });
    s.ck!.barbarians = 6;
    for (const level of ['medium', 'hard'] as const) expect(botMove(s, 0, level)).toEqual({ type: 'activateKnight', player: 0, vertex: C(0, 0, 2) });
    // with the ship far away, medium and hard keep the grain for now
    s.ck!.barbarians = 1;
    for (const level of ['medium', 'hard'] as const) expect(botMove(s, 0, level)).toEqual({ type: 'endTurn', player: 0 });
  });

  it('hard hires a knight while the ship is still a few moves out; medium waits', () => {
    const s = threeCities();
    road(s, trail(s, [C(0, 0, 0), C(0, 0, 1)]), 0);
    give(s, 0, { wool: 1, ore: 1 });
    s.ck!.barbarians = 3;
    expect(botMove(s, 0, 'hard')).toEqual({ type: 'buildKnight', player: 0, vertex: C(0, 0, 1) });
    expect(botMove(s, 0, 'medium')).toEqual({ type: 'endTurn', player: 0 });
  });

  it('hard keeps up with the best defender when a knight woken does it, when the attack will be held; medium does not chase it from behind', () => {
    const s = bare();
    // player 0 has no city at risk (a settlement only); the others hold the attack between them
    put(s, C(0, 0, 0), 0);
    put(s, C(-2, 0, 0), 1, 'city');
    put(s, C(0, -2, 0), 2, 'city');
    knight(s, C(-2, 2, 0), 1, 1, true);
    knight(s, C(2, -2, 3), 2, 1, true);
    knight(s, C(0, 0, 2), 0, 2);
    give(s, 0, { grain: 1 });
    s.ck!.barbarians = 6;
    // a knight woken keeps anyone else from becoming Defender (a strong one makes it the best defender)
    expect(botMove(s, 0, 'hard')).toEqual({ type: 'activateKnight', player: 0, vertex: C(0, 0, 2) });
    s.ck!.knights[C(0, 0, 2)].level = 1;
    s.ck!.knights[C(0, 0, 3)] = { ...s.ck!.knights[C(0, 0, 2)] };
    // two knights to wake to get ahead: too far for medium; hard wakes one, to tie
    expect(botMove(s, 0, 'medium')).toEqual({ type: 'endTurn', player: 0 });
    expect(botMove(s, 0, 'hard')).toMatchObject({ type: 'activateKnight' });
  });

  it('chases the robber off its own hex and sends it to an opponent', () => {
    const s = threeCities();
    s.ck!.attacks = 1;
    setHex(s, 0, 0, 'mountains', 8);
    setHex(s, -2, 0, 'hills', 6);
    s.board.robber = H(0, 0);
    knight(s, C(0, 0, 2), 0, 1, true);
    give(s, 1, { brick: 2 });
    const chase = botMove(s, 0, 'easy');
    expect(chase).toEqual({ type: 'chaseRobber', player: 0, vertex: C(0, 0, 2), piece: 'robber' });
    const t = act(s, chase);
    expect(botMove(t, 0, 'hard')).toMatchObject({ type: 'moveRobber', hex: H(-2, 0), victim: 1 });
  });
});

describe('Cities & Knights computer players: progress cards', () => {
  it('does not waste the Alchemist on a roll that gives it little, and uses it on its best number (never a 7)', () => {
    const s = bare();
    setHex(s, 0, 0, 'fields', 2);
    put(s, C(0, 0, 0), 0);
    hand(s, 0, 'alchemist');
    s.phase = { kind: 'preRoll' };
    for (const level of ['medium', 'hard'] as const) expect(botMove(s, 0, level)).toEqual({ type: 'rollDice', player: 0 });
    // easy plays it anyway
    expect(botMove(s, 0, 'easy')).toMatchObject({ type: 'playProgress', card: 'alchemist' });
    // a city on two 5s: worth choosing the dice
    setHex(s, 0, 0, 'mountains', 5);
    setHex(s, 1, -1, 'forest', 5);
    s.board.buildings[C(0, 0, 0)].type = 'city';
    for (const level of ['medium', 'hard'] as const) {
      const a = botMove(s, 0, level) as Extract<Action, { type: 'playProgress' }>;
      expect(a.card).toBe('alchemist');
      const dice = a.args!.dice as number[];
      expect(dice[0] + dice[1]).toBe(5);
    }
  });

  it('answers a Deserter by giving up its weakest knight', () => {
    let s = bare();
    knight(s, C(0, 0, 0), 1, 3, true);
    knight(s, C(0, 0, 2), 1, 1, false);
    knight(s, C(-2, 0, 0), 1, 2, true);
    hand(s, 0, 'deserter');
    s = act(s, { type: 'playProgress', player: 0, card: 'deserter', args: { target: 1 } });
    for (const level of BOT_LEVELS) {
      expect(botMove(s, 1, level)).toEqual({ type: 'progressChoice', player: 1, args: { vertex: C(0, 0, 2) } });
    }
  });

  it('plays the Spy on the leader, and takes the card it values most', () => {
    let s = bare();
    hand(s, 1, 'merchant', 'smith');
    hand(s, 2, 'warlord', 'intrigue');
    s.players[1].bonusVP = 5;
    hand(s, 0, 'spy');
    const a = botMove(s, 0, 'hard');
    expect(a).toMatchObject({ type: 'playProgress', card: 'spy', args: { target: 1 } });
    s = act(s, a);
    expect(botMove(s, 0, 'hard')).toEqual({ type: 'progressChoice', player: 0, args: { card: 'merchant' } });
  });

  it('plays the Diplomat on the road that costs the Longest Road holder the card', () => {
    const s = bare();
    // player 1 holds Longest Road with exactly 5 roads; player 2 has 5 too, so one road less hands it on
    const one = [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2), C(0, 0, 3), C(0, 0, 4), C(0, 0, 5)];
    put(s, one[0], 1);
    road(s, trail(s, one), 1);
    const two = [C(-2, 0, 0), C(-2, 0, 1), C(-2, 0, 2), C(-2, 0, 3), C(-2, 0, 4), C(-2, 0, 5)];
    put(s, two[0], 2);
    road(s, trail(s, two), 2);
    s.longestRoute.holder = 1;
    s.players[1].bonusVP = 4;
    hand(s, 0, 'diplomat');
    const a = botMove(s, 0, 'hard') as Extract<Action, { type: 'playProgress' }>;
    expect(a).toMatchObject({ type: 'playProgress', card: 'diplomat' });
    expect(s.board.pieces[a.args!.edge as string].owner).toBe(1);
    expect(act(s, a).longestRoute.holder).not.toBe(1);
  });

  it('sends the Bishop to the leader', () => {
    let s = threeCities();
    s.ck!.attacks = 1;
    setHex(s, -2, 0, 'hills', 6);
    setHex(s, 0, -2, 'fields', 6);
    s.players[1].bonusVP = 6;
    give(s, 1, { brick: 2 });
    give(s, 2, { grain: 2 });
    hand(s, 0, 'bishop');
    s = act(s, botMove(s, 0, 'hard'));
    expect(s.phase).toMatchObject({ kind: 'robber', reason: 'bishop' });
    expect(botMove(s, 0, 'hard')).toMatchObject({ type: 'moveRobber', hex: H(-2, 0) });
  });

  it('puts the merchant where it produces most', () => {
    const s = bare();
    setHex(s, 0, 0, 'mountains', 8);
    setHex(s, -2, 0, 'fields', 3);
    put(s, C(0, 0, 0), 0, 'city');
    put(s, C(-2, 0, 0), 0);
    hand(s, 0, 'merchant');
    for (const level of ['medium', 'hard'] as const) {
      expect(botMove(s, 0, level)).toMatchObject({ type: 'playProgress', card: 'merchant', args: { hex: H(0, 0) } });
    }
  });

  it('over the progress card limit, puts back the least useful card', () => {
    const s = bare();
    // nothing here can be played now: the Bishop before the first attack, the Crane with no city...
    hand(s, 0, 'alchemist', 'bishop', 'crane', 'irrigation', 'spy');
    expect(legalActions(s, 0).some((a) => a.type === 'playProgress')).toBe(false);
    for (const level of ['medium', 'hard'] as const) expect(botMove(s, 0, level)).toEqual({ type: 'discardProgress', player: 0, card: 'crane' });
  });
});

describe('Cities & Knights computer players: cities and cards', () => {
  it('places its set-up city on commodity hexes (hard)', () => {
    const s = bare();
    s.turn.number = 0;
    s.phase = { kind: 'setup', round: 1, index: 2, step: 'settlement', vertex: null };
    expect(setupPlacesCity(s, 1)).toBe(true);
    // the same numbers twice: mountains, pasture and forest (commodities) or hills and fields
    setHex(s, 0, 0, 'mountains', 6);
    setHex(s, 1, -1, 'pasture', 8);
    setHex(s, 1, 0, 'forest', 5);
    setHex(s, -2, 1, 'hills', 6);
    setHex(s, -1, 0, 'fields', 8);
    setHex(s, -1, 1, 'fields', 5);
    const commodities = topo(s).vertexIds.find((v) => ['0,0', '1,-1', '1,0'].every((h) => topo(s).vertexHexes[v].includes(h)))!;
    const plain = topo(s).vertexIds.find((v) => ['-2,1', '-1,0', '-1,1'].every((h) => topo(s).vertexHexes[v].includes(h)))!;
    const a = botMove(s, 0, 'hard');
    expect(a).toEqual({ type: 'placeSettlement', player: 0, vertex: commodities });
    expect(a).not.toMatchObject({ vertex: plain });
  });

  it('goes for a metropolis it can still win, not one an opponent has locked at level 5', () => {
    let s = threeCities();
    s.ck!.players[0].improvements = { trade: 3, politics: 0, science: 3 };
    // player 1 holds the science metropolis at level 5: nobody can take it
    s.ck!.players[1].improvements.science = 5;
    s.ck!.metropolises.science = { owner: 1, vertex: C(-2, 0, 0) };
    giveC(s, 0, { paper: 4, cloth: 4 });
    for (const level of ['medium', 'hard'] as const) {
      expect(botMove(s, 0, level)).toEqual({ type: 'improveCity', player: 0, track: 'trade', vertex: C(0, 0, 0) });
    }
    s = act(s, botMove(s, 0, 'hard'));
    expect(s.ck!.metropolises.trade).toEqual({ owner: 0, vertex: C(0, 0, 0) });
    // and it keeps its paper rather than buy a level that wins nothing
    expect(botMove(s, 0, 'hard')).not.toMatchObject({ type: 'improveCity', track: 'science' });
  });

  it('discards the cards it needs least on a 7, keeping what its city needs', () => {
    const s = bare();
    put(s, C(0, 0, 0), 0);
    give(s, 0, { ore: 3, grain: 2, brick: 3, wool: 3 });
    giveC(s, 0, { paper: 1 });
    s.phase = { kind: 'discard', pending: { 0: 6 }, resume: { kind: 'main' } };
    for (const level of ['medium', 'hard'] as const) {
      const a = botMove(s, 0, level) as Extract<Action, { type: 'discard' }>;
      expect(a.cards.ore ?? 0).toBe(0);
      expect(a.cards.grain ?? 0).toBe(0);
    }
  });

  it('walls a city when its hand is large', () => {
    const s = threeCities();
    give(s, 0, { brick: 4, lumber: 3, wool: 2 });
    for (const level of ['medium', 'hard'] as const) expect(botMove(s, 0, level)).toEqual({ type: 'buildCityWall', player: 0, vertex: C(0, 0, 0) });
    expect(botMove(s, 0, 'easy').type).not.toBe('buildCityWall');
  });

  it('values commodities in offers: takes a coin it needs for its improvements', () => {
    let s = threeCities();
    setHex(s, 0, 0, 'mountains', 6);
    s.ck!.players[1].improvements.politics = 2;
    put(s, C(0, 0, 3), 1, 'city');
    giveC(s, 0, { coin: 1 });
    give(s, 1, { brick: 4 });
    s = act(s, { type: 'proposeTrade', player: 0, give: { coin: 1 }, get: { brick: 1 }, to: [1] });
    for (const level of BOT_LEVELS) expect(botMove(s, 1, level)).toMatchObject({ type: 'acceptTrade' });
    // but not a resource it has plenty of for its brick
    let t = threeCities();
    give(t, 0, { wool: 1 });
    give(t, 1, { brick: 1, wool: 4 });
    t = act(t, { type: 'proposeTrade', player: 0, give: { wool: 1 }, get: { brick: 1 }, to: [1] });
    expect(botMove(t, 1, 'hard')).toMatchObject({ type: 'rejectTrade' });
  });
});

describe('Cities & Knights computer players: whole games', () => {
  for (const players of [3, 4]) {
    for (const layout of ['official', 'random'] as const) {
      it(`easy, medium and hard finish a ${players}-player game on the ${layout} map`, () => {
        const levels = Array.from({ length: players }, (_, i) => BOT_LEVELS[i % 3]);
        const start = createGame({ scenario: 'base', players, seed: `ck-bots-${players}-${layout}`, options: { ...CK, layout } });
        const { state, steps } = simulateHeuristic(start, 8000, levels);
        expect(state.phase.kind).toBe('gameOver');
        expect(steps).toBeLessThan(8000);
        checkInvariants(state, true);
        const ph = state.phase as Extract<GameState['phase'], { kind: 'gameOver' }>;
        expect(publicVP(state, ph.winner!)).toBeGreaterThanOrEqual(13);
      });
    }
  }

  it('every level alone at a table finishes its games', () => {
    for (const level of BOT_LEVELS) {
      const start = createGame({ scenario: 'base', players: 3, seed: `ck-alone-${level}`, options: CK });
      const { state } = simulateHeuristic(start, 8000, level);
      expect(state.phase.kind, level).toBe('gameOver');
    }
  });
});
