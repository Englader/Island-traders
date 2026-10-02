import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS,
  PROGRESS_CARDS,
  PROGRESS_CARD_NAMES,
  RESOURCES,
  createGame,
  heuristicAction,
  legalActions,
  playersToAct,
  seedRng,
  setupPlacesCity,
  simulate,
  simulateHeuristic,
  totalVP,
  type Action,
  type BotLevel,
  type FiveSixMode,
  type GameState,
  type MapLayout,
} from '../src/index.js';
import { CK, bare, checkInvariants, giveC, has, hand, knight, laterTurn, roll } from './ckHelpers.js';
import { C, act, fail, give, put, road, trail } from './helpers.js';

/**
 * Cities & Knights for 5-6 players: the 5-6 Player Extension (2020: the
 * special build phase; 2023 and 2025: paired players). docs/cities-and-knights.md
 * section 15 has the rules and page numbers.
 */

/** A bare 5-6 player board (the base game's 5-6 random frame, centred on 0,0), player 0's turn after the roll. */
function bare56(players: 5 | 6, mode: FiveSixMode = 'paired'): GameState {
  const s = bare(players);
  s.options.fiveSixMode = mode;
  return s;
}

/** Player `p`'s city at the corner of hex 0,0 with a road of three on to an empty spot, and a knight on it. */
function estate(s: GameState, p: number, active = true): void {
  put(s, C(0, 0, 0), p, 'city');
  road(s, trail(s, [C(0, 0, 0), C(0, 0, 1), C(0, 0, 2), C(0, 0, 3)]), p);
  knight(s, C(0, 0, 2), p, 1, active);
}

const types = (acts: Action[]) => new Set(acts.map((a) => a.type));

describe('Cities & Knights for 5-6 players: components and board', () => {
  for (const n of [5, 6]) {
    it(`${n} players: 18 of each commodity, 8 Defender cards, 24 of each resource; the same 54 progress cards and 13 VP`, () => {
      const s = createGame({ scenario: 'base', players: n, seed: `ck56-${n}`, options: CK });
      expect(s.ck!.bank).toEqual({ paper: 18, cloth: 18, coin: 18 });
      expect(s.ck!.defenderCards).toBe(8);
      for (const r of RESOURCES) expect(s.bank[r]).toBe(24);
      for (const t of ['trade', 'politics', 'science'] as const) expect(s.ck!.decks[t]).toHaveLength(18);
      const all = [...s.ck!.decks.trade, ...s.ck!.decks.politics, ...s.ck!.decks.science];
      for (const name of PROGRESS_CARD_NAMES) expect(all.filter((c) => c === name).length, name).toBe(PROGRESS_CARDS[name].count);
      expect(s.ck!.metropolises).toEqual({ trade: null, politics: null, science: null });
      expect(s.ck!.players).toHaveLength(n);
      expect(s.victoryTarget).toBe(13);
      expect(s.devDeck).toEqual([]);
    });
  }

  it('3-4 players keep the base supply', () => {
    const s = createGame({ scenario: 'base', players: 4, seed: 'ck56-4', options: CK });
    expect(s.ck!.bank).toEqual({ paper: 12, cloth: 12, coin: 12 });
    expect(s.ck!.defenderCards).toBe(6);
  });

  it('the official layout is the base game’s 5-6 map (no C&K 5-6 map is printed), the robber asleep on a desert', () => {
    for (const n of [5, 6]) {
      const ck = createGame({ scenario: 'base', players: n, seed: 1, options: CK });
      const base = createGame({ scenario: 'base', players: n, seed: 1 });
      expect(ck.board.hexes).toEqual(base.board.hexes);
      expect(ck.board.harbors).toEqual(base.board.harbors);
      const land = Object.values(ck.board.hexes).filter((h) => h.terrain !== 'sea');
      expect(land).toHaveLength(30);
      expect(land.filter((h) => h.terrain === 'desert')).toHaveLength(2);
      expect(ck.board.harbors).toHaveLength(11);
      // "Place the robber in either desert": the first by id, the west end of the fourth row
      expect(ck.board.robber).toBe('-1,4');
      expect(ck.board.hexes[ck.board.robber!].terrain).toBe('desert');
      expect(ck.ck!.attacks).toBe(0);
    }
  });

  it('the random layout is the CATAN 5-6 variable set-up, dealt anew for each game', () => {
    const deal = (seed: string) => createGame({ scenario: 'base', players: 6, seed, options: { ...CK, layout: 'random' } });
    const a = deal('ck56-random-a');
    const b = deal('ck56-random-b');
    for (const s of [a, b]) {
      const land = Object.values(s.board.hexes).filter((h) => h.terrain !== 'sea');
      expect(land).toHaveLength(30);
      expect(land.filter((h) => h.terrain === 'desert')).toHaveLength(2);
      expect(land.filter((h) => h.token !== null)).toHaveLength(28);
      expect(s.board.harbors).toHaveLength(11);
      expect(s.board.hexes[s.board.robber!].terrain).toBe('desert');
    }
    expect(JSON.stringify(a.board.hexes)).not.toBe(JSON.stringify(b.board.hexes));
  });

  it('the set-up is as with 3-4 players: a settlement, then a city; Seafarers scenarios only where the rulebook combines them', () => {
    const s = createGame({ scenario: 'base', players: 5, seed: 'ck56-setup', options: CK });
    expect(s.phase).toMatchObject({ kind: 'setup', round: 0 });
    expect(setupPlacesCity(s, 0)).toBe(false);
    expect(setupPlacesCity(s, 1)).toBe(true);
    expect(() => createGame({ scenario: 'seafarers-2-four-islands', players: 6, seed: 1, options: CK })).toThrow(/The rulebook doesn't combine/);
    expect(createGame({ scenario: 'seafarers-1-new-shores', players: 6, seed: 1, options: CK }).ck).toBeDefined();
  });
});

describe('Cities & Knights for 5-6 players: paired players (2023 and 2025 rules)', () => {
  /** Player 0's turn ends: player 3 (the third to the left) takes the paired action phase. */
  function paired(n: 5 | 6 = 5): GameState {
    const s = bare56(n);
    estate(s, 3);
    knight(s, C(0, 0, 3), 3, 2, false);
    give(s, 3, { wool: 2, ore: 2, grain: 2, brick: 2, lumber: 4 });
    giveC(s, 3, { cloth: 1 });
    hand(s, 3, 'resourceMonopoly', 'alchemist');
    return act(s, { type: 'endTurn', player: 0 });
  }

  it('player 2 is the third player to the left of player 1', () => {
    for (const n of [5, 6] as const) {
      const s = paired(n);
      expect(s.turn).toMatchObject({ current: 0, actor: 3, role: 'paired' });
      expect(s.phase.kind).toBe('main');
      expect(playersToAct(s)).toEqual([3]);
    }
  });

  it('player 2 may build, improve, use knights, play progress cards and trade with the supply', () => {
    const s = paired();
    const acts = legalActions(s, 3);
    const t = types(acts);
    for (const k of ['buildRoad', 'buildKnight', 'activateKnight', 'promoteKnight', 'buildCityWall', 'improveCity', 'moveKnight', 'playProgress', 'bankTrade', 'endTurn']) {
      expect(t.has(k as Action['type']), k).toBe(true);
    }
    act(s, { type: 'moveKnight', player: 3, from: C(0, 0, 2), to: C(0, 0, 1) });
    act(s, { type: 'promoteKnight', player: 3, vertex: C(0, 0, 2) });
    act(s, { type: 'improveCity', player: 3, track: 'trade' });
    act(s, { type: 'buildCityWall', player: 3, vertex: C(0, 0, 0) });
    act(s, { type: 'bankTrade', player: 3, give: { lumber: 4 }, get: { grain: 1 } });
    act(s, { type: 'playProgress', player: 3, card: 'resourceMonopoly', args: { resource: 'grain' } });
  });

  it('player 2 neither rolls, plays the Alchemist, nor trades with other players', () => {
    const s = paired();
    const acts = legalActions(s, 3);
    expect(types(acts).has('rollDice')).toBe(false);
    expect(has(acts, { type: 'playProgress', card: 'alchemist' })).toBe(false);
    fail(s, { type: 'rollDice', player: 3 }, /cannot roll/);
    fail(s, { type: 'playProgress', player: 3, card: 'alchemist', args: { dice: [3, 4] } }, /not your turn|before rolling/);
    fail(s, { type: 'proposeTrade', player: 3, give: { lumber: 1 }, get: { brick: 1 }, to: [0] }, /active player/);
    // and player 1, whose part is over, can do nothing
    expect(legalActions(s, 0)).toEqual([]);
    fail(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 1) }, /not your turn/);
  });

  it('a knight activated in player 2’s part acts on its owner’s next turn', () => {
    let s = paired();
    s = act(s, { type: 'activateKnight', player: 3, vertex: C(0, 0, 3) });
    fail(s, { type: 'moveKnight', player: 3, from: C(0, 0, 3), to: C(0, 0, 1) }, /activated this turn/);
    expect(has(legalActions(s, 3), { type: 'moveKnight', from: C(0, 0, 3) })).toBe(false);
    s = laterTurn(s, 3);
    act(s, { type: 'moveKnight', player: 3, from: C(0, 0, 3), to: C(0, 0, 1) });
  });

  it('player 2 wins at once on reaching 13 VP in their part; player 1 wins before player 2 acts', () => {
    let s = bare56(5);
    put(s, C(0, 0, 0), 3, 'city');
    put(s, C(0, 0, 3), 3, 'settlement');
    s.ck!.players[3].defenders = 9; // a city, a settlement and 9: 12
    s.ck!.defenderCards = 0;
    give(s, 3, { grain: 2, ore: 3 });
    s = act(s, { type: 'endTurn', player: 0 });
    expect(totalVP(s, 3)).toBe(12);
    s = act(s, { type: 'buildCity', player: 3, vertex: C(0, 0, 3) });
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 3 });

    let t = bare56(5);
    put(t, C(0, 0, 0), 0, 'city');
    put(t, C(0, 0, 3), 0, 'settlement');
    t.ck!.players[0].defenders = 9;
    t.ck!.defenderCards = 0;
    give(t, 0, { grain: 2, ore: 3 });
    t = act(t, { type: 'buildCity', player: 0, vertex: C(0, 0, 3) });
    expect(t.phase).toMatchObject({ kind: 'gameOver', winner: 0 });
  });

  it('player 2 keeps a fifth progress card until they end their part; one drawn on player 1’s roll goes at once', () => {
    let s = paired();
    s.ck!.players[3].progress.push('spy', 'spy', 'bishop');
    expect(s.ck!.players[3].progress).toHaveLength(5);
    fail(s, { type: 'endTurn', player: 3 }, /discard progress cards/);
    expect(types(legalActions(s, 3)).has('endTurn')).toBe(false);
    s = act(s, { type: 'discardProgress', player: 3, card: 'bishop' });
    s = act(s, { type: 'endTurn', player: 3 });
    expect(s.turn).toMatchObject({ current: 1, actor: 1, role: 'active' });

    // on player 1's roll, the player 2 to be is not yet acting: a fifth card is discarded at once
    let r = bare56(5);
    r.ck!.players[3].improvements.politics = 1;
    r.ck!.players[3].progress = ['spy', 'spy', 'bishop', 'wedding'];
    r.ck!.decks.politics = r.ck!.decks.politics.filter((c) => c === 'warlord' || c === 'saboteur');
    r = roll(r, 1, 1, 'politics');
    expect(r.phase).toMatchObject({ kind: 'ck', step: 'progressDiscard', pending: { 3: 1 } });
  });
});

describe('Cities & Knights for 5-6 players: the special build phase (2020 rules)', () => {
  /** Player 0's turn ends: the special build phase starts with player 1. */
  function special(n: 5 | 6 = 6): GameState {
    const s = bare56(n, 'specialBuild');
    estate(s, 1);
    knight(s, C(0, 0, 3), 1, 2, false);
    give(s, 1, { wool: 2, ore: 2, grain: 2, brick: 2, lumber: 4 });
    giveC(s, 1, { cloth: 1 });
    hand(s, 1, 'resourceMonopoly');
    s.ck!.attacks = 1; // the robber is awake, next to the knight
    s.board.robber = '0,0';
    return act(s, { type: 'endTurn', player: 0 });
  }

  it('after a turn the others build in turn, starting with the next player', () => {
    let s = special(6);
    expect(s.phase).toEqual({ kind: 'specialBuild', queue: [1, 2, 3, 4, 5] });
    expect(s.turn).toMatchObject({ current: 0, actor: 1, role: 'specialBuild' });
    for (const p of [1, 2, 3, 4, 5]) {
      expect(s.turn.actor).toBe(p);
      s = act(s, { type: 'endTurn', player: p });
    }
    expect(s.turn).toMatchObject({ current: 1, actor: 1, role: 'active' });
    expect(s.phase.kind).toBe('preRoll');
  });

  it('builds roads, settlements, cities, knights, walls and improvements; activates and promotes knights', () => {
    const s = special();
    const t = types(legalActions(s, 1));
    for (const k of ['buildRoad', 'buildKnight', 'activateKnight', 'promoteKnight', 'buildCityWall', 'improveCity', 'endTurn']) {
      expect(t.has(k as Action['type']), k).toBe(true);
    }
    let x = act(s, { type: 'activateKnight', player: 1, vertex: C(0, 0, 3) });
    x = act(x, { type: 'promoteKnight', player: 1, vertex: C(0, 0, 2) });
    x = act(x, { type: 'buildCityWall', player: 1, vertex: C(0, 0, 0) });
    x = act(x, { type: 'improveCity', player: 1, track: 'trade' });
    expect(x.ck!.players[1].improvements.trade).toBe(1);
    expect(x.ck!.knights[C(0, 0, 2)].level).toBe(2);
    expect(x.ck!.knights[C(0, 0, 3)].active).toBe(true);
  });

  it('no knight actions, progress cards or trades', () => {
    const s = special();
    const t = types(legalActions(s, 1));
    for (const k of ['moveKnight', 'displaceKnight', 'chaseRobber', 'playProgress', 'bankTrade', 'progressChoice', 'discardProgress']) {
      expect(t.has(k as Action['type']), k).toBe(false);
    }
    fail(s, { type: 'moveKnight', player: 1, from: C(0, 0, 2), to: C(0, 0, 1) }, /special build phase/);
    fail(s, { type: 'chaseRobber', player: 1, vertex: C(0, 0, 2), piece: 'robber' }, /special build phase/);
    fail(s, { type: 'playProgress', player: 1, card: 'resourceMonopoly', args: { resource: 'grain' } }, /special build phase/);
    fail(s, { type: 'bankTrade', player: 1, give: { lumber: 4 }, get: { grain: 1 } }, /not allowed/);
    fail(s, { type: 'proposeTrade', player: 1, give: { lumber: 1 }, get: { brick: 1 }, to: [2] }, /active player/);
  });

  it('a knight activated in the special build phase acts on its owner’s next turn', () => {
    let s = special(5);
    s = act(s, { type: 'activateKnight', player: 1, vertex: C(0, 0, 3) });
    for (const p of [1, 2, 3, 4]) s = act(s, { type: 'endTurn', player: p });
    expect(s.turn).toMatchObject({ current: 1, actor: 1 });
    s = roll(s, 1, 2, 'trade', 1);
    expect(s.phase.kind).toBe('main');
    expect(has(legalActions(s, 1), { type: 'moveKnight', from: C(0, 0, 3), to: C(0, 0, 1) })).toBe(true);
    act(s, { type: 'moveKnight', player: 1, from: C(0, 0, 3), to: C(0, 0, 1) });
  });

  it('nobody wins in the special build phase: the player wins when their own turn begins', () => {
    let s = bare56(5, 'specialBuild');
    put(s, C(0, 0, 0), 1, 'city');
    put(s, C(0, 0, 3), 1, 'settlement');
    s.ck!.players[1].defenders = 8; // a city, a settlement and 8: 11; a second city and a metropolis make 14
    s.ck!.defenderCards = 0;
    s.ck!.players[1].improvements.trade = 3;
    give(s, 1, { grain: 2, ore: 3 });
    giveC(s, 1, { cloth: 4 });
    s = act(s, { type: 'endTurn', player: 0 });
    s = act(s, { type: 'buildCity', player: 1, vertex: C(0, 0, 3) });
    s = act(s, { type: 'improveCity', player: 1, track: 'trade', vertex: C(0, 0, 3) });
    expect(totalVP(s, 1)).toBe(14);
    expect(s.phase.kind).toBe('specialBuild');
    for (const p of [1, 2, 3]) s = act(s, { type: 'endTurn', player: p });
    expect(s.phase.kind).toBe('specialBuild');
    s = act(s, { type: 'endTurn', player: 4 });
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 1 });
  });
});

describe('Cities & Knights for 5-6 players: computer players', () => {
  it('wake their knights in the special build phase when the ship is about to land', () => {
    let s = bare56(6, 'specialBuild');
    // six cities against the others' five active knights: player 1, with none, would lose its city
    for (let p = 0; p < 6; p++) put(s, C(p - 3, 0, 0), p, 'city');
    road(s, trail(s, [C(-2, 0, 0), C(-2, 0, 1)]), 1);
    knight(s, C(-2, 0, 1), 1, 1, false);
    for (const p of [2, 3, 4, 5, 0]) knight(s, C(p - 3, 0, 3), p, 1, true);
    give(s, 1, { grain: 1 });
    s.ck!.barbarians = 6;
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.turn).toMatchObject({ actor: 1, role: 'specialBuild' });
    for (const level of ['medium', 'hard'] as const) {
      const a = heuristicAction(s, 1, level);
      expect(a).toEqual({ type: 'activateKnight', player: 1, vertex: C(-2, 0, 1) });
      expect(legalActions(s, 1)).toContainEqual(a);
    }
  });

  it('hard races for Defender of Catan only one knight level ahead with 5-6 players (two with 3-4)', () => {
    const position = (players: 4 | 6) => {
      const s = players === 4 ? bare(4) : bare56(6);
      // player 0 has no city at risk; every other player has a city and an active basic knight: the attack is held
      put(s, C(0, 0, 0), 0);
      const sites: Array<[number, number]> = [[-2, 0], [0, -2], [-2, 2], [2, -2], [0, 2]];
      for (let p = 1; p < players; p++) {
        const [q, r] = sites[p - 1];
        put(s, C(q, r, 0), p, 'city');
        knight(s, C(q, r, 3), p, 1, true);
      }
      // two idle basic knights: waking both makes it the sole best defender; it needs grain for a city too
      knight(s, C(0, 0, 2), 0, 1);
      knight(s, C(0, 0, 3), 0, 1);
      give(s, 0, { grain: 1, ore: 3 });
      s.ck!.barbarians = 6;
      return s;
    };
    expect(heuristicAction(position(4), 0, 'hard')).toMatchObject({ type: 'activateKnight' });
    expect(heuristicAction(position(6), 0, 'hard')?.type).not.toBe('activateKnight');
  });

  const games: Array<{ n: 5 | 6; mode: FiveSixMode; layout: MapLayout }> = [];
  for (const n of [5, 6] as const) for (const mode of ['paired', 'specialBuild'] as const) for (const layout of ['official', 'random'] as const) games.push({ n, mode, layout });

  it('heuristic bots of every level finish 5- and 6-player games, with C&K moves in the paired and special build parts', () => {
    const seen = new Set<string>();
    for (const [i, g] of games.entries()) {
      const levels = Array.from({ length: g.n }, (_, k) => BOT_LEVELS[(k + i) % 3]) as BotLevel[];
      const start = createGame({ scenario: 'base', players: g.n, seed: `ck56-heur-${i}`, options: { ...CK, layout: g.layout, fiveSixMode: g.mode } });
      let before = start;
      const { state } = simulateHeuristic(start, 20000, levels, (after, a) => {
        if (before.turn.role !== 'active' && a.player === before.turn.actor) seen.add(`${before.turn.role}:${a.type}`);
        before = after;
      });
      expect(state.phase.kind, `${g.n} ${g.mode} ${g.layout}`).toBe('gameOver');
      checkInvariants(state, true);
      const ph = state.phase as Extract<GameState['phase'], { kind: 'gameOver' }>;
      expect(totalVP(state, ph.winner!)).toBeGreaterThanOrEqual(13);
    }
    for (const k of ['specialBuild:activateKnight', 'specialBuild:buildKnight', 'specialBuild:improveCity', 'paired:activateKnight', 'paired:improveCity', 'paired:playProgress', 'paired:bankTrade']) {
      expect(seen.has(k), k).toBe(true);
    }
  });

  it('random bots finish 5- and 6-player games with every rule invariant intact', () => {
    for (const [i, g] of games.entries()) {
      if (g.layout === 'official' && i % 4 !== 0) continue;
      const start = createGame({ scenario: 'base', players: g.n, seed: `ck56-random-${i}`, options: { ...CK, layout: g.layout, fiveSixMode: g.mode } });
      let steps = 0;
      const r = simulate(start, seedRng(`ck56-bots-${i}`), 40000, (s) => {
        if (steps++ % 11 === 0) checkInvariants(s);
      });
      checkInvariants(r.state);
      expect(r.finished, `${g.n} ${g.mode} ${g.layout}`).toBe(true);
    }
  });
});
