import { describe, expect, it } from 'vitest';
import {
  BOT_LEVELS,
  PROGRESS_CARDS,
  PROGRESS_CARD_NAMES,
  RESOURCES,
  TERRAIN_RESOURCE,
  applyAction,
  cardRates,
  createGame,
  edgeBetween,
  heuristicAction,
  legalActions,
  longestRouteLength,
  offsetId,
  placeMerchant,
  playersToAct,
  publicVP,
  seedRng,
  simulate,
  simulateHeuristic,
  topo,
  totalVP,
  viewFor,
  type Action,
  type GameState,
  type PlayerId,
  type VertexId,
} from '../src/index.js';
import { CK, bare, checkInvariants, ckGame, giveC, has, knight, laterTurn, roll, stack } from './ckHelpers.js';
import { C, H, act, blank, fail, give, put, road, setHex, trail } from './helpers.js';

// ---------------------------------------------------------------------------

describe('Cities & Knights: set-up', () => {
  it('places a settlement, then a city, and pays the city one resource per hex', () => {
    let s = createGame({ scenario: 'base', players: 3, seed: 'setup', options: { ...CK, firstPlayer: 0 } });
    for (let guard = 0; s.phase.kind === 'setup' && guard < 50; guard++) {
      const p = playersToAct(s)[0];
      s = act(s, legalActions(s, p)[0]);
    }
    expect(s.phase.kind).toBe('preRoll');
    for (const pl of s.players) {
      const mine = Object.entries(s.board.buildings).filter(([, b]) => b.owner === pl.id);
      expect(mine.map(([, b]) => b.type).sort()).toEqual(['city', 'settlement']);
      expect(pl.supply).toMatchObject({ settlements: 4, cities: 3 });
      const city = mine.find(([, b]) => b.type === 'city')![0];
      const producing = topo(s).vertexHexes[city].filter((h) => TERRAIN_RESOURCE[s.board.hexes[h]?.terrain]).length;
      expect(RESOURCES.reduce((n, r) => n + pl.resources[r], 0)).toBe(producing);
      expect(s.ck!.players[pl.id].commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
    }
    expect(s.log.some((l) => /places a starting city/.test(l.msg))).toBe(true);
  });

  it('plays on the rulebook beginners map by default, the variable set-up on the random layout', () => {
    const s = createGame({ scenario: 'base', players: 4, seed: 1, options: CK });
    const hex = (col: number, row: number) => s.board.hexes[offsetId(col, row)];
    expect(hex(2, 1)).toMatchObject({ terrain: 'hills', token: 6 });
    expect(hex(3, 1)).toMatchObject({ terrain: 'mountains', token: 2 });
    expect(hex(4, 2)).toMatchObject({ terrain: 'desert', token: null });
    expect(hex(3, 3)).toMatchObject({ terrain: 'hills', token: 11 });
    expect(hex(4, 5)).toMatchObject({ terrain: 'forest', token: 11 });
    const land = Object.values(s.board.hexes).filter((h) => h.terrain !== 'sea');
    expect(land).toHaveLength(19);
    const count = (t: string) => land.filter((h) => h.terrain === t).length;
    expect([count('forest'), count('pasture'), count('fields'), count('hills'), count('mountains'), count('desert')]).toEqual([4, 4, 4, 3, 3, 1]);
    expect(land.map((h) => h.token).filter((t) => t !== null).sort((a, b) => a! - b!)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
    expect(s.board.harbors.map((h) => h.type).sort()).toEqual(['brick', 'generic', 'generic', 'generic', 'generic', 'grain', 'lumber', 'ore', 'wool']);
    expect(s.board.robber).toBe(offsetId(4, 2));
    const random = createGame({ scenario: 'base', players: 4, seed: 1, options: { ...CK, layout: 'random' } });
    expect(Object.keys(random.board.hexes)).toContain('0,0');
  });

  it('has no development cards, 13 VP to win, three progress decks of 18 and 12 of each commodity', () => {
    const s = createGame({ scenario: 'base', players: 3, seed: 2, options: CK });
    expect(s.devDeck).toEqual([]);
    expect(s.victoryTarget).toBe(13);
    for (const t of ['trade', 'politics', 'science'] as const) expect(s.ck!.decks[t]).toHaveLength(18);
    const all = [...s.ck!.decks.trade, ...s.ck!.decks.politics, ...s.ck!.decks.science];
    for (const name of PROGRESS_CARD_NAMES) {
      expect(all.filter((c) => c === name).length, name).toBe(PROGRESS_CARDS[name].count);
      expect(s.ck!.decks[PROGRESS_CARDS[name].deck]).toContain(name);
    }
    expect(s.ck!.bank).toEqual({ paper: 12, cloth: 12, coin: 12 });
    expect(s.ck!.defenderCards).toBe(6);
    expect(createGame({ scenario: 'base', players: 3, seed: 2, options: { ...CK, victoryPoints: 15 } }).victoryTarget).toBe(15);
    const g = ckGame();
    give(g, 0, { ore: 1, wool: 1, grain: 1 });
    fail(g, { type: 'buyDevCard', player: 0 }, /no development cards/);
    expect(legalActions(g, 0).some((a) => a.type === 'buyDevCard')).toBe(false);
  });

  it('is for the base game with 3-4 players for now', () => {
    expect(() => createGame({ scenario: 'base', players: 5, seed: 1, options: CK })).toThrow(/3-4 players/);
    expect(() => createGame({ scenario: 'seafarers-1-new-shores', players: 4, seed: 1, options: CK })).toThrow(/base game/);
  });
});

describe('Cities & Knights: production', () => {
  /** (0,0) forest 8, (1,0) hills 8, (1,-1) mountains 8, (-1,0) pasture 8, (-1,1) fields 8. */
  function board(): GameState {
    const s = bare();
    setHex(s, 0, 0, 'forest', 8);
    setHex(s, 1, 0, 'hills', 8);
    setHex(s, 1, -1, 'mountains', 8);
    setHex(s, -1, 0, 'pasture', 8);
    setHex(s, -1, 1, 'fields', 8);
    return s;
  }

  it('a city takes a resource and a commodity on forest, pasture and mountains, two on hills and fields', () => {
    let s = board();
    put(s, C(0, 0, 0), 0, 'city'); // forest, hills, mountains
    put(s, C(0, 0, 3), 1); // a settlement on forest, pasture, fields
    put(s, C(-1, 0, 3), 2, 'city'); // pasture
    put(s, C(-1, 1, 4), 2, 'city'); // fields
    s = roll(s, 4, 4);
    expect(s.players[0].resources).toMatchObject({ lumber: 1, brick: 2, ore: 1, wool: 0, grain: 0 });
    expect(s.ck!.players[0].commodities).toEqual({ paper: 1, cloth: 0, coin: 1 });
    expect(s.players[1].resources).toMatchObject({ lumber: 1, wool: 1, grain: 1 });
    expect(s.ck!.players[1].commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
    expect(s.players[2].resources).toMatchObject({ wool: 1, grain: 2 });
    expect(s.ck!.players[2].commodities).toEqual({ paper: 0, cloth: 1, coin: 0 });
    expect(s.ck!.bank).toEqual({ paper: 11, cloth: 11, coin: 11 });
    expect(s.stats!.players[0].producedCommodities).toEqual({ paper: 1, cloth: 0, coin: 1 });
    expect(s.stats!.players[0].produced).toMatchObject({ lumber: 1, brick: 2, ore: 1 });
    expect(s.phase.kind).toBe('main');
  });

  it('the robber blocks commodities too, and the bank-shortage rule applies to each commodity', () => {
    let s = board();
    put(s, C(0, 0, 0), 0, 'city');
    s.board.robber = H(0, 0);
    s = roll(s, 4, 4);
    expect(s.players[0].resources.lumber).toBe(0);
    expect(s.ck!.players[0].commodities.paper).toBe(0);

    let t = board();
    put(t, C(0, 0, 0), 0, 'city');
    put(t, C(0, 0, 3), 1, 'city');
    t.ck!.bank.paper = 1; // two players are owed one paper each
    t = roll(t, 4, 4);
    expect(t.ck!.players[0].commodities.paper + t.ck!.players[1].commodities.paper).toBe(0);
    expect(t.players[0].resources.lumber).toBe(1); // lumber unaffected
    let u = board();
    put(u, C(0, 0, 0), 0, 'city');
    u.ck!.bank.coin = 0;
    u = roll(u, 4, 4);
    expect(u.ck!.players[0].commodities).toMatchObject({ paper: 1, coin: 0 });
  });

  it('the aqueduct gives a resource of choice after a roll that gave nothing, never on a 7', () => {
    let s = board();
    put(s, C(0, 0, 0), 1, 'city');
    s.ck!.players[0].improvements.science = 3;
    s.ck!.players[1].improvements.science = 3;
    s = roll(s, 2, 3); // a 5: nothing for anyone
    expect(s.phase).toMatchObject({ kind: 'ck', step: 'aqueduct', pending: { 0: 1, 1: 1 } });
    expect(playersToAct(s).sort()).toEqual([0, 1]);
    const options = legalActions(s, 0);
    expect(options).toContainEqual({ type: 'aqueduct', player: 0, resource: 'ore' });
    expect(options).toContainEqual({ type: 'aqueduct', player: 0 });
    s = act(s, { type: 'aqueduct', player: 0, resource: 'ore' });
    s = act(s, { type: 'aqueduct', player: 1 }); // declines
    expect(s.players[0].resources.ore).toBe(1);
    expect(s.players[1].resources.ore).toBe(0);
    expect(s.phase.kind).toBe('main');

    let t = board();
    put(t, C(0, 0, 0), 1, 'city');
    t.ck!.players[0].improvements.science = 3;
    t.ck!.players[1].improvements.science = 3;
    t = roll(t, 4, 4); // player 1 receives, player 0 does not
    expect(t.phase).toMatchObject({ kind: 'ck', step: 'aqueduct', pending: { 0: 1 } });
    fail(t, { type: 'aqueduct', player: 1, resource: 'ore' }, /no aqueduct/);

    const u = roll(board(), 3, 4); // a 7
    u.ck!.players[0].improvements.science = 3;
    expect(u.phase.kind).toBe('main');
  });
});

describe('Cities & Knights: the event die and progress cards', () => {
  it('a city gate lets a player draw when the red die is at most their level + 1', () => {
    const s = bare();
    s.ck!.players[1].improvements.politics = 1;
    s.ck!.players[2].improvements.politics = 2;
    const top = s.ck!.decks.politics.at(-1)!;
    const a = roll(structuredClone(s), 1, 2, 'politics');
    expect(a.ck!.players[1].progress.length + a.ck!.players[1].vpCards.length).toBe(1);
    expect(a.ck!.players[2].progress.length + a.ck!.players[2].vpCards.length).toBe(1);
    expect([...a.ck!.players[1].progress, ...a.ck!.players[1].vpCards]).toEqual([top]); // drawn in turn order from the roller
    expect(a.ck!.decks.politics).toHaveLength(16);
    const b = roll(structuredClone(s), 1, 3, 'politics');
    expect(b.ck!.players[1].progress).toHaveLength(0);
    expect(b.ck!.players[2].progress.length + b.ck!.players[2].vpCards.length).toBe(1);
    const c = roll(structuredClone(s), 1, 2, 'trade'); // another colour
    expect(c.ck!.players[1].progress).toHaveLength(0);
    expect(c.ck!.players[2].progress).toHaveLength(0);
  });

  it('a victory point card is played face up at once and counts', () => {
    let s = bare();
    s.ck!.players[1].improvements.politics = 1;
    stack(s, 'constitution');
    const before = publicVP(s, 1);
    s = roll(s, 1, 1, 'politics');
    expect(s.ck!.players[1].vpCards).toEqual(['constitution']);
    expect(s.ck!.players[1].progress).toEqual([]);
    expect(publicVP(s, 1)).toBe(before + 1);
    expect(viewFor(s, 0).ck!.players[1].vpCards).toEqual(['constitution']);
  });

  it('a fifth card outside your turn is discarded at once, under its deck', () => {
    let s = bare();
    s.ck!.players[1].improvements.politics = 1;
    s.ck!.players[1].progress = ['spy', 'spy', 'bishop', 'wedding'];
    s.ck!.decks.politics = s.ck!.decks.politics.filter((c) => c === 'warlord' || c === 'saboteur');
    s = roll(s, 1, 1, 'politics');
    expect(s.ck!.players[1].progress).toHaveLength(5);
    expect(s.phase).toMatchObject({ kind: 'ck', step: 'progressDiscard', pending: { 1: 1 } });
    expect(playersToAct(s)).toEqual([1]);
    const acts = legalActions(s, 1);
    expect(acts.every((a) => a.type === 'discardProgress')).toBe(true);
    expect(acts).toHaveLength(new Set(s.ck!.players[1].progress).size);
    fail(s, { type: 'discardProgress', player: 1, card: 'deserter' }, /do not have/);
    s = act(s, { type: 'discardProgress', player: 1, card: 'bishop' });
    expect(s.ck!.players[1].progress).toHaveLength(4);
    expect(s.ck!.decks.politics[0]).toBe('bishop'); // the bottom of the deck
    expect(s.phase.kind).toBe('main');
  });

  it('on your own turn you may hold a fifth card until you end the turn', () => {
    let s = bare();
    s.ck!.players[0].improvements.politics = 1;
    s.ck!.players[0].progress = ['spy', 'spy', 'bishop', 'wedding'];
    s.ck!.decks.politics = s.ck!.decks.politics.filter((c) => c === 'warlord');
    s = roll(s, 1, 1, 'politics');
    expect(s.phase.kind).toBe('main');
    expect(s.ck!.players[0].progress).toHaveLength(5);
    fail(s, { type: 'endTurn', player: 0 }, /discard progress cards/);
    const acts = legalActions(s, 0);
    expect(acts.some((a) => a.type === 'endTurn')).toBe(false);
    expect(acts.some((a) => a.type === 'discardProgress')).toBe(true);
    s = act(s, { type: 'discardProgress', player: 0, card: 'spy' });
    fail(s, { type: 'discardProgress', player: 0, card: 'spy' }, /within the limit/);
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.turn.current).toBe(1);
  });

  it('progress cards are played after the roll on your own turn; one that would do nothing is not offered', () => {
    const s = bare();
    s.ck!.players[0].progress = ['warlord', 'merchant'];
    expect(legalActions(s, 0).some((a) => a.type === 'playProgress')).toBe(false); // no knights, no buildings
    fail(s, { type: 'playProgress', player: 0, card: 'warlord' }, /no knights/);
    fail(s, { type: 'playProgress', player: 0, card: 'spy' }, /do not have/);
    s.phase = { kind: 'preRoll' };
    fail(s, { type: 'playProgress', player: 0, card: 'warlord' }, /roll the dice first/);
  });
});

describe('Cities & Knights: the barbarians', () => {
  /** Two cities for player 0, one city for player 1 (with an active basic knight), a settlement for player 2. */
  function attackBoard(): GameState {
    const s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    put(s, C(0, 0, 3), 0, 'city');
    put(s, C(-2, 0, 0), 1, 'city');
    put(s, C(2, -1, 3), 2);
    knight(s, C(-2, 2, 0), 1, 1, true);
    s.ck!.barbarians = 6;
    return s;
  }

  it('sails one space per ship and attacks on the seventh', () => {
    let s = bare();
    s = roll(s, 2, 3, 'ship');
    expect(s.ck!.barbarians).toBe(1);
    expect(s.ck!.attacks).toBe(0);
    s.ck!.barbarians = 6;
    s = roll(s, 2, 3, 'ship');
    expect(s.ck!.barbarians).toBe(0);
    expect(s.ck!.attacks).toBe(1);
  });

  it('when the barbarians win, the weakest defender with cities chooses a city to lose, and its wall goes', () => {
    let s = attackBoard();
    s.ck!.players[0].walls = [C(0, 0, 0)];
    s = roll(s, 2, 3, 'ship'); // 3 cities against 1 knight
    expect(s.phase).toMatchObject({ kind: 'ck', step: 'pillage', pending: { 0: 1 } });
    expect(playersToAct(s)).toEqual([0]);
    expect(legalActions(s, 0).map((a) => (a as { vertex: string }).vertex).sort()).toEqual([C(0, 0, 0), C(0, 0, 3)].sort());
    fail(s, { type: 'pillageCity', player: 1, vertex: C(-2, 0, 0) }, /do not lose/);
    s = act(s, { type: 'pillageCity', player: 0, vertex: C(0, 0, 0) });
    expect(s.board.buildings[C(0, 0, 0)].type).toBe('settlement');
    expect(s.ck!.players[0].walls).toEqual([]);
    expect(s.players[0].supply).toMatchObject({ cities: 3, settlements: 4 });
    expect(s.board.buildings[C(-2, 0, 0)].type).toBe('city'); // player 1 defended
    expect(s.phase.kind).toBe('main');
    expect(Object.values(s.ck!.knights).every((k) => !k.active)).toBe(true);
  });

  it('everyone tied for the least loses a city; a single city goes at once', () => {
    let s = attackBoard();
    delete s.ck!.knights[C(-2, 2, 0)];
    s.board.buildings[C(0, 0, 3)].type = 'settlement';
    s = roll(s, 2, 3, 'ship');
    expect(s.board.buildings[C(0, 0, 0)].type).toBe('settlement');
    expect(s.board.buildings[C(-2, 0, 0)].type).toBe('settlement');
    expect(s.phase.kind).toBe('main');
  });

  it('a metropolis is immune: its owner is skipped and the next weakest loses a city', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    s.ck!.metropolises.trade = { owner: 0, vertex: C(0, 0, 0) };
    put(s, C(-2, 0, 0), 1, 'city');
    knight(s, C(-2, 2, 0), 1, 1, true);
    put(s, C(2, -1, 3), 2, 'city');
    s.ck!.barbarians = 6;
    s = roll(s, 2, 3, 'ship'); // 3 against 1: player 0 (0 knights) is immune, player 2 (0) is next
    expect(s.board.buildings[C(0, 0, 0)].type).toBe('city');
    expect(s.board.buildings[C(-2, 0, 0)].type).toBe('city');
    expect(s.board.buildings[C(2, -1, 3)].type).toBe('settlement');
  });

  it('a sole best defender is Defender of Catan; tied best defenders each draw a progress card', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    put(s, C(-2, 0, 0), 1, 'city');
    knight(s, C(0, 0, 1), 0, 2, true);
    knight(s, C(-2, 2, 0), 1, 1, true);
    s.ck!.barbarians = 6;
    const vp = publicVP(s, 0);
    s = roll(s, 2, 3, 'ship'); // 2 cities against 3
    expect(s.ck!.players[0].defenders).toBe(1);
    expect(s.ck!.defenderCards).toBe(5);
    expect(publicVP(s, 0)).toBe(vp + 1);
    expect(viewFor(s, 1).ck!.players[0].defenders).toBe(1);

    let t = bare();
    put(t, C(0, 0, 0), 0, 'city');
    knight(t, C(0, 0, 1), 0, 1, true);
    knight(t, C(-2, 2, 0), 2, 1, true);
    t.ck!.barbarians = 6;
    t.turn.current = 1;
    t = roll(t, 2, 3, 'ship', 1); // player 1 rolls: player 2 draws first, then player 0
    expect(t.phase).toMatchObject({ kind: 'ck', step: 'defenderDraw', queue: [2, 0] });
    expect(playersToAct(t)).toEqual([2]);
    expect(legalActions(t, 2)).toHaveLength(3);
    fail(t, { type: 'drawProgress', player: 0, deck: 'trade' }, /not your turn to draw/);
    t = act(t, { type: 'drawProgress', player: 2, deck: 'trade' });
    t = act(t, { type: 'drawProgress', player: 0, deck: 'science' });
    expect(t.ck!.players[2].progress.length + t.ck!.players[2].vpCards.length).toBe(1);
    expect(t.ck!.players[0].progress.length + t.ck!.players[0].vpCards.length).toBe(1);
    expect(t.ck!.decks.trade).toHaveLength(17);
    expect(t.ck!.decks.science).toHaveLength(17);
    expect(t.ck!.defenderCards).toBe(6);
    expect(t.phase.kind).toBe('main');
  });

  it('the robber stays put until the first attack; a 7 still makes players discard', () => {
    let s = bare();
    give(s, 1, { brick: 6 });
    giveC(s, 1, { paper: 3 });
    s = roll(s, 3, 4); // 7, no attack yet
    expect(s.phase).toMatchObject({ kind: 'discard', pending: { 1: 4 } });
    s = act(s, { type: 'discard', player: 1, cards: { brick: 2, paper: 2 } });
    expect(s.phase.kind).toBe('main'); // no robber
    expect(s.ck!.players[1].commodities.paper).toBe(1);
    expect(s.ck!.bank.paper).toBe(11);
    s.phase = { kind: 'robber', reason: 'seven', resume: { kind: 'main' } };
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(0, 0) }, /until the barbarians first attack/);

    let t = bare();
    t.ck!.barbarians = 6;
    t = roll(t, 2, 3, 'ship');
    expect(t.ck!.attacks).toBe(1);
    t = roll(t, 3, 4);
    expect(t.phase.kind).toBe('robber');
  });

  it('decisions from the attack come before production', () => {
    let s = attackBoard();
    setHex(s, 0, 0, 'hills', 5);
    s = roll(s, 2, 3, 'ship');
    expect(s.phase.kind).toBe('ck');
    expect(s.players[0].resources.brick).toBe(0);
    s = act(s, { type: 'pillageCity', player: 0, vertex: C(0, 0, 0) });
    // C(0,0,0) is now a settlement (1 brick); C(0,0,3) is still a city (2 brick)
    expect(s.players[0].resources.brick).toBe(3);
  });

  it('a city pillaged with no settlement left lies on its side and must be rebuilt first', () => {
    let s = bare();
    for (const v of [C(-2, 0, 0), C(-2, 2, 0), C(2, -1, 3), C(0, -2, 4), C(1, 1, 5)]) put(s, v, 0);
    put(s, C(0, 0, 0), 0, 'city');
    expect(s.players[0].supply).toMatchObject({ settlements: 0, cities: 3 });
    s.ck!.barbarians = 6;
    s = roll(s, 2, 3, 'ship');
    expect(s.board.buildings[C(0, 0, 0)].type).toBe('settlement');
    expect(s.ck!.tipped).toEqual([C(0, 0, 0)]);
    expect(s.players[0].supply).toMatchObject({ settlements: 0, cities: 3 });
    expect(publicVP(s, 0)).toBe(6);
    give(s, 0, { ore: 6, grain: 4 });
    fail(s, { type: 'buildCity', player: 0, vertex: C(-2, 0, 0) }, /pillaged city/);
    const other = laterTurn(structuredClone(s), 1);
    give(other, 1, { ore: 3, grain: 2 });
    fail(other, { type: 'buildCity', player: 1, vertex: C(0, 0, 0) }, /one of your settlements/);
    expect(legalActions(s, 0).filter((a) => a.type === 'buildCity')).toEqual([{ type: 'buildCity', player: 0, vertex: C(0, 0, 0) }]);
    s = act(s, { type: 'buildCity', player: 0, vertex: C(0, 0, 0) });
    expect(s.ck!.tipped).toEqual([]);
    expect(s.players[0].supply).toMatchObject({ settlements: 0, cities: 3 });
    s = act(s, { type: 'buildCity', player: 0, vertex: C(-2, 0, 0) });
    expect(s.players[0].supply).toMatchObject({ settlements: 1, cities: 2 });
  });
});

describe('Cities & Knights: knights', () => {
  /** Player 0: a settlement at C(0,0,0) and roads C0-C1-C2-C3-C4 around hex (0,0). */
  function knightBoard(): GameState {
    const s = bare();
    put(s, C(0, 0, 0), 0);
    road(s, trail(s, [0, 1, 2, 3, 4].map((i) => C(0, 0, i))), 0);
    return s;
  }

  it('hires a basic knight on an empty intersection on its own road, ignoring the distance rule', () => {
    let s = knightBoard();
    give(s, 0, { wool: 3, ore: 3 });
    fail(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 0) }, /occupied/);
    fail(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 5) }, /on your road/);
    fail(s, { type: 'buildKnight', player: 1, vertex: C(0, 0, 1) }, /not your turn/);
    expect(has(legalActions(s, 0), { type: 'buildKnight', vertex: C(0, 0, 1) })).toBe(true);
    s = act(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 1) }); // next to the settlement
    expect(s.ck!.knights[C(0, 0, 1)]).toMatchObject({ owner: 0, level: 1, active: false });
    expect(s.players[0].resources).toMatchObject({ wool: 2, ore: 2 });
    s = act(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 2) });
    fail(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 3) }, /no basic knight left/);
    s.phase = { kind: 'preRoll' };
    fail(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 3) }, /roll the dice first/);
  });

  it('activates for a grain; a knight activated this turn cannot act until the next', () => {
    let s = knightBoard();
    knight(s, C(0, 0, 1), 0);
    give(s, 0, { grain: 2 });
    fail(s, { type: 'moveKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 3) }, /not active/);
    s = act(s, { type: 'activateKnight', player: 0, vertex: C(0, 0, 1) });
    expect(s.ck!.knights[C(0, 0, 1)].active).toBe(true);
    fail(s, { type: 'activateKnight', player: 0, vertex: C(0, 0, 1) }, /already active/);
    fail(s, { type: 'moveKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 3) }, /activated this turn/);
    expect(legalActions(s, 0).some((a) => a.type === 'moveKnight')).toBe(false);
    s = laterTurn(s);
    s = act(s, { type: 'moveKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 3) });
    expect(s.ck!.knights[C(0, 0, 1)]).toBeUndefined();
    expect(s.ck!.knights[C(0, 0, 3)]).toMatchObject({ active: false });
    // re-activated the same turn, it still cannot act again
    s = act(s, { type: 'activateKnight', player: 0, vertex: C(0, 0, 3) });
    fail(s, { type: 'moveKnight', player: 0, from: C(0, 0, 3), to: C(0, 0, 4) }, /activated this turn/);
  });

  it('moves only along its own roads, past its own pieces but not past others', () => {
    let s = knightBoard();
    knight(s, C(0, 0, 1), 0, 1, true);
    knight(s, C(0, 0, 2), 0); // own knight: passable
    const reach = () => legalActions(s, 0).filter((a) => a.type === 'moveKnight' && a.from === C(0, 0, 1)).map((a) => (a as { to: string }).to).sort();
    expect(reach()).toEqual([C(0, 0, 3), C(0, 0, 4)].sort());
    knight(s, C(0, 0, 3), 1); // another player's knight: a wall
    expect(reach()).toEqual([]);
    fail(s, { type: 'moveKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 4) }, /cannot reach/);
    fail(s, { type: 'moveKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 5) }, /cannot reach/);
    delete s.ck!.knights[C(0, 0, 3)];
    put(s, C(0, 0, 3), 2); // another player's settlement on the road
    expect(reach()).toEqual([]);
  });

  /**
   * Player 0: strong active knight at C(0,0,1) with roads to C(0,0,3).
   * Player 1: basic knight at C(0,0,3), with roads C(0,0,3)-C(0,0,4)-C(0,0,5).
   */
  function displaceBoard(): GameState {
    const s = bare();
    put(s, C(0, 0, 0), 0);
    road(s, trail(s, [0, 1, 2, 3].map((i) => C(0, 0, i))), 0);
    road(s, trail(s, [3, 4, 5].map((i) => C(0, 0, i))), 1);
    knight(s, C(0, 0, 1), 0, 2, true);
    knight(s, C(0, 0, 3), 1, 1, true);
    return s;
  }

  it('a stronger knight displaces a weaker one, whose owner moves it along their own roads', () => {
    let s = displaceBoard();
    expect(legalActions(s, 0)).toContainEqual({ type: 'displaceKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 3) });
    s = act(s, { type: 'displaceKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 3) });
    expect(s.ck!.knights[C(0, 0, 3)]).toMatchObject({ owner: 0, level: 2, active: false });
    expect(s.phase).toMatchObject({ kind: 'ck', step: 'retreat', player: 1, from: C(0, 0, 3) });
    expect(playersToAct(s)).toEqual([1]);
    const spots = legalActions(s, 1).map((a) => (a.type === 'retreatKnight' ? a.to : a.type));
    expect(spots.sort()).toEqual([C(0, 0, 4), C(0, 0, 5)].sort());
    fail(s, { type: 'retreatKnight', player: 1, to: C(0, 0, 1) }, /cannot retreat/);
    fail(s, { type: 'retreatKnight', player: 0, to: C(0, 0, 4) }, /not your knight/);
    s = act(s, { type: 'retreatKnight', player: 1, to: C(0, 0, 5) });
    expect(s.ck!.knights[C(0, 0, 5)]).toMatchObject({ owner: 1, level: 1, active: true }); // status kept
    expect(s.phase.kind).toBe('main');
  });

  it('displacing: never an equal or stronger knight, never your own, and a knight with nowhere to go leaves', () => {
    let s = displaceBoard();
    s.ck!.knights[C(0, 0, 3)].level = 2;
    fail(s, { type: 'displaceKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 3) }, /stronger/);
    expect(legalActions(s, 0).some((a) => a.type === 'displaceKnight')).toBe(false);
    s.ck!.knights[C(0, 0, 3)].owner = 0;
    fail(s, { type: 'displaceKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 3) }, /no opposing knight/);

    let t = displaceBoard();
    for (const p of [C(0, 0, 4), C(0, 0, 5)]) knight(t, p, 1); // player 1's road is full
    t = act(t, { type: 'displaceKnight', player: 0, from: C(0, 0, 1), to: C(0, 0, 3) });
    expect(t.phase.kind).toBe('main');
    expect(Object.values(t.ck!.knights).filter((k) => k.owner === 1)).toHaveLength(2); // back in the supply
    expect(t.log.some((l) => /nowhere to go/.test(l.msg))).toBe(true);
  });

  it('promotes once per turn; mighty needs the Fortress; only two of each level', () => {
    let s = knightBoard();
    knight(s, C(0, 0, 1), 0, 1, true);
    give(s, 0, { wool: 4, ore: 4 });
    s = act(s, { type: 'promoteKnight', player: 0, vertex: C(0, 0, 1) });
    expect(s.ck!.knights[C(0, 0, 1)]).toMatchObject({ level: 2, active: true });
    fail(s, { type: 'promoteKnight', player: 0, vertex: C(0, 0, 1) }, /once per turn/);
    s = laterTurn(s);
    fail(s, { type: 'promoteKnight', player: 0, vertex: C(0, 0, 1) }, /Fortress/);
    s.ck!.players[0].improvements.politics = 3;
    s = act(s, { type: 'promoteKnight', player: 0, vertex: C(0, 0, 1) });
    expect(s.ck!.knights[C(0, 0, 1)].level).toBe(3);
    fail(s, { type: 'promoteKnight', player: 0, vertex: C(0, 0, 1) }, /mighty knights cannot/);
    knight(s, C(0, 0, 2), 0, 2);
    knight(s, C(0, 0, 3), 0, 2);
    knight(s, C(0, 0, 4), 0, 1);
    fail(s, { type: 'promoteKnight', player: 0, vertex: C(0, 0, 4) }, /no stronger knight/);
  });

  it('chases the robber from an adjacent hex to a numbered hex once it is active, and steals commodities too', () => {
    let s = knightBoard();
    knight(s, C(0, 0, 1), 0, 1, true);
    setHex(s, 1, -1, 'forest', 6);
    setHex(s, 2, -2, 'hills', 4);
    s.board.robber = H(1, -1); // touches C(0,0,1)
    put(s, C(2, -2, 3), 1); // on the hills 4
    giveC(s, 1, { coin: 1 });
    fail(s, { type: 'chaseRobber', player: 0, vertex: C(0, 0, 1), piece: 'robber' }, /first attack/);
    s.ck!.attacks = 1;
    fail(s, { type: 'chaseRobber', player: 0, vertex: C(0, 0, 3), piece: 'robber' }, /no knight/);
    expect(legalActions(s, 0)).toContainEqual({ type: 'chaseRobber', player: 0, vertex: C(0, 0, 1), piece: 'robber' });
    s = act(s, { type: 'chaseRobber', player: 0, vertex: C(0, 0, 1), piece: 'robber' });
    expect(s.ck!.knights[C(0, 0, 1)].active).toBe(false);
    expect(s.phase).toMatchObject({ kind: 'robber', reason: 'chase', piece: 'robber' });
    const moves = legalActions(s, 0) as Array<Extract<Action, { type: 'moveRobber' }>>;
    expect(moves.every((m) => m.piece === 'robber' && s.board.hexes[m.hex].token !== null)).toBe(true);
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(0, 0) }, /hex with a number/);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: H(2, -2), victim: 1 });
    expect(s.ck!.players[0].commodities.coin).toBe(1);
    expect(s.ck!.players[1].commodities.coin).toBe(0);
    expect(s.phase.kind).toBe('main');
    // not next to the robber any more
    s = laterTurn(s);
    s.ck!.knights[C(0, 0, 1)].active = true;
    fail(s, { type: 'chaseRobber', player: 0, vertex: C(0, 0, 1), piece: 'robber' }, /not next to/);
  });

  it("breaks other players' Longest Road and blocks their roads", () => {
    let s = bare();
    // player 1: a settlement and a road of 5 around hex (0,0)
    put(s, C(0, 0, 0), 1);
    road(s, trail(s, [0, 1, 2, 3, 4, 5].map((i) => C(0, 0, i))), 1);
    // player 0 reaches C(0,0,2) with a road from outside
    road(s, edgeBetween(topo(s), C(0, 0, 2), C(0, -1, 3))!, 0);
    s.longestRoute = { holder: 1, lengths: [1, 5, 0] };
    expect(longestRouteLength(s, 1)).toBe(5);
    give(s, 0, { wool: 1, ore: 1 });
    s = act(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 2) });
    expect(longestRouteLength(s, 1)).toBe(3);
    expect(s.longestRoute.holder).toBeNull();
    // a road may end at another player's knight but not go past it
    s = laterTurn(s, 1);
    give(s, 1, { brick: 1, lumber: 1 });
    const out = edgeBetween(topo(s), C(0, 0, 5), C(1, 0, 4))!;
    expect(applyAction(s, { type: 'buildRoad', player: 1, edge: out }).ok).toBe(true);
    knight(s, C(0, 0, 5), 0);
    fail(s, { type: 'buildRoad', player: 1, edge: out }, /connect/);
    expect(legalActions(s, 1).some((a) => a.type === 'buildRoad' && a.edge === out)).toBe(false);
  });

  /** Player 0: a settlement at C(0,-2,4) and a road of two to X = C(-1,-1,2). */
  function siteBoard(owner: PlayerId): { s: GameState; x: VertexId } {
    const s = bare();
    const x = C(-1, -1, 2);
    put(s, C(0, -2, 4), 0);
    road(s, trail(s, [C(0, -2, 4), C(0, -2, 3), x]), 0);
    knight(s, x, owner);
    give(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    return { s, x };
  }

  it('nobody settles where a knight stands', () => {
    const other = siteBoard(1);
    fail(other.s, { type: 'buildSettlement', player: 0, vertex: other.x }, /a knight stands there/);
    expect(legalActions(other.s, 0).some((a) => a.type === 'buildSettlement')).toBe(false);
    delete other.s.ck!.knights[other.x];
    expect(applyAction(other.s, { type: 'buildSettlement', player: 0, vertex: other.x }).ok).toBe(true);
  });

  it('a settlement on your own knight needs the knight moved first', () => {
    const { s, x } = siteBoard(0);
    fail(s, { type: 'buildSettlement', player: 0, vertex: x }, /move your knight away first/);
  });
});

describe('Cities & Knights: city improvements and metropolises', () => {
  function improveBoard(): GameState {
    const s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    put(s, C(0, 0, 3), 0, 'city');
    put(s, C(-2, 0, 0), 1, 'city');
    put(s, C(2, -1, 3), 2);
    return s;
  }

  it('level n costs n of the track commodity and needs a city', () => {
    let s = improveBoard();
    giveC(s, 0, { cloth: 3, coin: 1, paper: 1 });
    s = act(s, { type: 'improveCity', player: 0, track: 'trade' });
    expect(s.ck!.players[0].improvements.trade).toBe(1);
    expect(s.ck!.players[0].commodities.cloth).toBe(2);
    s = act(s, { type: 'improveCity', player: 0, track: 'trade' });
    expect(s.ck!.players[0].commodities.cloth).toBe(0);
    expect(s.stats!.players[0].spent).toBe(3);
    fail(s, { type: 'improveCity', player: 0, track: 'trade' }, /not enough cloth/);
    s = act(s, { type: 'improveCity', player: 0, track: 'politics' });
    s = act(s, { type: 'improveCity', player: 0, track: 'science' });
    expect(s.ck!.players[0].improvements).toEqual({ trade: 2, politics: 1, science: 1 });
    s = laterTurn(s, 2);
    giveC(s, 2, { cloth: 1 });
    fail(s, { type: 'improveCity', player: 2, track: 'trade' }, /need a city/);
  });

  it('the first to level 4 takes the metropolis; the first to level 5 takes it away; level 5 keeps it', () => {
    let s = improveBoard();
    s.ck!.players[0].improvements.politics = 3;
    s.ck!.players[1].improvements.politics = 3;
    giveC(s, 0, { coin: 4 });
    giveC(s, 1, { coin: 4 });
    const vp0 = publicVP(s, 0);
    fail(s, { type: 'improveCity', player: 0, track: 'politics' }, /choose the city/);
    const options = legalActions(s, 0).filter((a) => a.type === 'improveCity' && a.track === 'politics');
    expect(options).toEqual([
      { type: 'improveCity', player: 0, track: 'politics', vertex: C(0, 0, 0) },
      { type: 'improveCity', player: 0, track: 'politics', vertex: C(0, 0, 3) },
    ]);
    s = act(s, { type: 'improveCity', player: 0, track: 'politics', vertex: C(0, 0, 3) });
    expect(s.ck!.metropolises.politics).toEqual({ owner: 0, vertex: C(0, 0, 3) });
    expect(publicVP(s, 0)).toBe(vp0 + 2);
    // a second player reaching level 4 gets no metropolis
    s = laterTurn(s, 1);
    fail(s, { type: 'improveCity', player: 1, track: 'politics', vertex: C(-2, 0, 0) }, /does not win a metropolis/);
    s = act(s, { type: 'improveCity', player: 1, track: 'politics' });
    expect(s.ck!.metropolises.politics!.owner).toBe(0);
    // level 5 first takes it
    giveC(s, 1, { coin: 5 });
    s = act(s, { type: 'improveCity', player: 1, track: 'politics', vertex: C(-2, 0, 0) });
    expect(s.ck!.metropolises.politics).toEqual({ owner: 1, vertex: C(-2, 0, 0) });
    expect(publicVP(s, 0)).toBe(vp0);
    // ... and keeps it for good
    s = laterTurn(s, 0);
    giveC(s, 0, { coin: 5 });
    s = act(s, { type: 'improveCity', player: 0, track: 'politics' });
    expect(s.ck!.players[0].improvements.politics).toBe(5);
    expect(s.ck!.metropolises.politics!.owner).toBe(1);
  });

  it('beyond level 3 you need a city where a metropolis could stand', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    s.ck!.players[0].improvements = { trade: 3, politics: 3, science: 0 };
    giveC(s, 0, { cloth: 9, coin: 4 });
    s = act(s, { type: 'improveCity', player: 0, track: 'trade', vertex: C(0, 0, 0) });
    fail(s, { type: 'improveCity', player: 0, track: 'politics' }, /city without a metropolis/);
    s = act(s, { type: 'improveCity', player: 0, track: 'trade' }); // already holds this one
    expect(s.ck!.players[0].improvements.trade).toBe(5);
  });

  it('level 3 abilities: 2:1 commodity trades, mighty knights (tested above), the aqueduct (tested above)', () => {
    let s = improveBoard();
    giveC(s, 0, { paper: 4 });
    expect(cardRates(s, 0).paper).toBe(4);
    s.ck!.players[0].improvements.trade = 3;
    expect(cardRates(s, 0)).toMatchObject({ paper: 2, cloth: 2, coin: 2, brick: 4 });
    s = act(s, { type: 'bankTrade', player: 0, give: { paper: 2 }, get: { ore: 1 } });
    s = act(s, { type: 'bankTrade', player: 0, give: { paper: 2 }, get: { coin: 1 } });
    expect(s.ck!.players[0].commodities).toEqual({ paper: 0, cloth: 0, coin: 1 });
    expect(s.players[0].resources.ore).toBe(1);
  });
});

describe('Cities & Knights: walls, hand limit, merchant, victory', () => {
  it('city walls: 2 brick, under your cities, one each, at most three', () => {
    let s = bare();
    for (const v of [C(0, 0, 0), C(0, 0, 3), C(-2, 0, 0), C(2, -1, 3)]) put(s, v, 0, 'city');
    put(s, C(0, -2, 4), 0);
    give(s, 0, { brick: 10 });
    fail(s, { type: 'buildCityWall', player: 0, vertex: C(0, -2, 4) }, /under one of your cities/);
    s = act(s, { type: 'buildCityWall', player: 0, vertex: C(0, 0, 0) });
    fail(s, { type: 'buildCityWall', player: 0, vertex: C(0, 0, 0) }, /already has a wall/);
    s = act(s, { type: 'buildCityWall', player: 0, vertex: C(0, 0, 3) });
    s = act(s, { type: 'buildCityWall', player: 0, vertex: C(-2, 0, 0) });
    fail(s, { type: 'buildCityWall', player: 0, vertex: C(2, -1, 3) }, /at most 3/);
    expect(s.players[0].resources.brick).toBe(4);
    expect(legalActions(s, 0).some((a) => a.type === 'buildCityWall')).toBe(false);
  });

  it('each wall lets its owner keep 2 more cards on a 7', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    s.ck!.players[0].walls = [C(0, 0, 0)];
    give(s, 0, { brick: 5 });
    giveC(s, 0, { cloth: 4 }); // 9 cards: safe up to 9
    give(s, 1, { brick: 5 });
    giveC(s, 1, { cloth: 3 }); // 8 cards: over 7
    s = roll(s, 3, 4);
    expect(s.phase).toMatchObject({ kind: 'discard', pending: { 1: 4 } });
    const options = legalActions(s, 1) as Array<Extract<Action, { type: 'discard' }>>;
    expect(options.some((a) => (a.cards.cloth ?? 0) > 0)).toBe(true);
    expect(options.every((a) => Object.values(a.cards).reduce((x, y) => x + (y ?? 0), 0) === 4)).toBe(true);
  });

  it('the merchant: 1 VP while held, and its hex resource at 2:1', () => {
    const s = bare();
    setHex(s, 0, 0, 'pasture', 5);
    put(s, C(0, 0, 0), 0);
    put(s, C(0, 0, 3), 1);
    const vp = publicVP(s, 0);
    expect(placeMerchant(s, 0, H(2, -2))).toMatch(/next to one of your/);
    expect(placeMerchant(s, 0, H(0, 0))).toBeNull();
    expect(publicVP(s, 0)).toBe(vp + 1);
    expect(cardRates(s, 0).wool).toBe(2);
    expect(cardRates(s, 0).cloth).toBe(4); // resources only
    expect(cardRates(s, 1).wool).toBe(4);
    expect(placeMerchant(s, 1, H(0, 0))).toBeNull();
    expect(publicVP(s, 0)).toBe(vp);
    expect(cardRates(s, 1).wool).toBe(2);
  });

  it('wins with 13 VP on your own turn', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0);
    s.ck!.players[0].defenders = 11; // 12 VP
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.phase.kind).toBe('preRoll');
    s = laterTurn(s, 0);
    give(s, 0, { ore: 3, grain: 2 });
    s = act(s, { type: 'buildCity', player: 0, vertex: C(0, 0, 0) });
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 0 });
    expect(totalVP(s, 0)).toBe(13);
  });
});

describe('Cities & Knights: trading', () => {
  it('commodities trade with players like resources; base games reject them', () => {
    let s = bare();
    giveC(s, 0, { paper: 1 });
    give(s, 1, { brick: 1 });
    s = act(s, { type: 'proposeTrade', player: 0, give: { paper: 1 }, get: { brick: 1 }, to: [1] });
    expect(legalActions(s, 1)).toContainEqual({ type: 'acceptTrade', player: 1, tradeId: s.turn.trades[0].id });
    s = act(s, { type: 'acceptTrade', player: 1, tradeId: s.turn.trades[0].id });
    s = act(s, { type: 'confirmTrade', player: 0, tradeId: s.turn.trades[0].id, partner: 1 });
    expect(s.ck!.players[1].commodities.paper).toBe(1);
    expect(s.players[0].resources.brick).toBe(1);
    expect(s.stats!.players[0]).toMatchObject({ tradeOut: 1, tradeIn: 1, trades: 1 });
    fail(s, { type: 'proposeTrade', player: 1, give: { paper: 2 }, get: { brick: 1 }, to: [0] }, /do not have/);
    const b = blank('base', 3);
    give(b, 0, { brick: 1 });
    fail(b, { type: 'proposeTrade', player: 0, give: { brick: 1 }, get: { paper: 1 }, to: [1] } as Action, /invalid trade/);
  });

  it('with the bank: 4:1, 3:1 at a generic harbor, resource harbors only for their resource', () => {
    let s = bare();
    setHex(s, 0, 0, 'hills', 5);
    put(s, C(0, 0, 0), 0);
    giveC(s, 0, { coin: 4 });
    give(s, 0, { brick: 4 });
    expect(cardRates(s, 0)).toMatchObject({ coin: 4, brick: 4 });
    s = act(s, { type: 'bankTrade', player: 0, give: { brick: 4 }, get: { paper: 1 } });
    expect(s.ck!.players[0].commodities.paper).toBe(1);
    // a brick harbor at the settlement: brick 2:1, commodities still 4:1
    const edge = topo(s).vertexEdges[C(0, 0, 0)][0];
    s.board.harbors = [{ edge, type: 'brick' }];
    expect(cardRates(s, 0)).toMatchObject({ brick: 2, coin: 4, paper: 4 });
    s.board.harbors = [{ edge, type: 'generic' }];
    expect(cardRates(s, 0)).toMatchObject({ brick: 3, coin: 3, paper: 3 });
    fail(s, { type: 'bankTrade', player: 0, give: { coin: 2 }, get: { ore: 1 } }, /3:1/);
    s = act(s, { type: 'bankTrade', player: 0, give: { coin: 3 }, get: { ore: 1 } });
    expect(s.players[0].resources.ore).toBe(1);
  });
});

describe('Cities & Knights: hidden information', () => {
  it("shows other players' commodities and progress cards as counts only", () => {
    const s = bare();
    giveC(s, 0, { paper: 2 });
    give(s, 0, { ore: 1 });
    s.ck!.players[0].progress = ['spy', 'merchant'];
    s.ck!.players[0].vpCards = ['printer'];
    s.ck!.players[0].defenders = 1;
    const other = viewFor(s, 1);
    expect(other.players[0].resourceCount).toBe(3);
    expect(other.players[0].resources).toBeUndefined();
    expect(other.ck!.players[0]).toMatchObject({ commodityCount: 2, progressCount: 2, vpCards: ['printer'], defenders: 1 });
    expect(other.ck!.players[0].commodities).toBeUndefined();
    expect(other.ck!.players[0].progress).toBeUndefined();
    expect(other.ck!.decks).toEqual({ trade: 18, politics: 18, science: 18 });
    expect(JSON.stringify(other)).not.toMatch(/"spy"/);
    const own = viewFor(s, 0);
    expect(own.ck!.players[0].commodities).toEqual({ paper: 2, cloth: 0, coin: 0 });
    expect(own.ck!.players[0].progress).toEqual(['spy', 'merchant']);
    expect(own.players[0].totalVP).toBe(publicVP(s, 0));
    const spectator = viewFor(s, null);
    expect(spectator.ck!.players.every((p) => p.progress === undefined && p.commodities === undefined)).toBe(true);
    expect(viewFor(blank('base', 3), 0).ck).toBeUndefined();
  });

  it('a drawn card is logged privately to its drawer', () => {
    let s = bare();
    s.ck!.players[1].improvements.science = 1;
    s.ck!.decks.science = s.ck!.decks.science.filter((c) => c !== 'printer');
    s = roll(s, 1, 1, 'science');
    const name = PROGRESS_CARDS[s.ck!.players[1].progress[0]].title;
    expect(viewFor(s, 1).log.some((l) => l.msg.includes(name))).toBe(true);
    expect(viewFor(s, 0).log.some((l) => l.msg.includes(`drew ${name}`))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Whole games
// ---------------------------------------------------------------------------

describe('Cities & Knights: whole games', () => {
  it('the same seed plays the same game', () => {
    const play = (seed: string) => {
      const g = createGame({ scenario: 'base', players: 4, seed, options: CK });
      return JSON.stringify(simulate(g, seedRng(`bots-${seed}`), 1500).state);
    };
    expect(play('same')).toBe(play('same'));
    expect(play('same')).not.toBe(play('other'));
    const h = (seed: string) => JSON.stringify(simulateHeuristic(createGame({ scenario: 'base', players: 3, seed, options: CK }), 4000).state);
    expect(h('again')).toBe(h('again'));
  });

  for (const n of [3, 4]) {
    it(`random bots finish ${n}-player games with every rule invariant intact`, () => {
      for (const layout of ['official', 'random'] as const) {
        const g = createGame({ scenario: 'base', players: n, seed: `ck-random-${n}-${layout}`, options: { ...CK, layout } });
        let steps = 0;
        const r = simulate(g, seedRng(`ck-bots-${n}-${layout}`), 40000, (s) => {
          if (steps++ % 7 === 0) checkInvariants(s);
        });
        checkInvariants(r.state);
        expect(r.finished).toBe(true);
        const ph = r.state.phase as Extract<GameState['phase'], { kind: 'gameOver' }>;
        expect(totalVP(r.state, ph.winner!)).toBeGreaterThanOrEqual(13);
      }
    });

    it(`heuristic bots finish ${n}-player games at every level`, () => {
      for (const level of BOT_LEVELS) {
        for (const layout of ['official', 'random'] as const) {
          const g = createGame({ scenario: 'base', players: n, seed: `ck-heur-${n}-${level}-${layout}`, options: { ...CK, layout } });
          const { state } = simulateHeuristic(g, 8000, level);
          expect(state.phase.kind, `${level} ${layout}`).toBe('gameOver');
          checkInvariants(state);
        }
      }
    });
  }

  it('random games reach every kind of C&K decision, and the engine accepts every legal move', () => {
    const want = [
      'buildKnight',
      'activateKnight',
      'promoteKnight',
      'moveKnight',
      'displaceKnight',
      'retreatKnight',
      'chaseRobber',
      'buildCityWall',
      'improveCity',
      'pillageCity',
      'drawProgress',
      'discardProgress',
      'aqueduct',
    ];
    const seen = new Set<string>();
    // a heuristic game (cities to lose, defender draws) ...
    let s = createGame({ scenario: 'base', players: 3, seed: 'ck-cover-0', options: CK });
    for (let k = 0; k < 6000 && s.phase.kind !== 'gameOver'; k++) {
      for (const p of playersToAct(s)) {
        const a = heuristicAction(s, p);
        if (!a) continue;
        seen.add(a.type);
        s = act(s, a);
        break;
      }
    }
    // ... and random games (knights on the move), which also check that every legal move is accepted
    for (let i = 0; i < 12 && want.some((t) => !seen.has(t)); i++) {
      const g = createGame({ scenario: 'base', players: 3 + (i % 2), seed: `ck-legal-${i}`, options: CK });
      simulate(g, seedRng(`ck-legal-${i}`), 20000, (_s, a) => seen.add(a.type));
    }
    expect(want.filter((t) => !seen.has(t))).toEqual([]);
  });

  it('applyAction rejects C&K actions in games without the expansion', () => {
    const s = blank('base', 3);
    const r = applyAction(s, { type: 'buildKnight', player: 0, vertex: C(0, 0, 0) });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/not played with Cities & Knights/) });
  });
});
