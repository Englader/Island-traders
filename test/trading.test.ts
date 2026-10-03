import { describe, expect, it } from 'vitest';
import { auditGame, emptyTally, type TradeTally } from '../src/bots/audit.js';
import { botProfile } from '../src/bots/heuristicBot.js';
import { handEstimates } from '../src/bots/tracker.js';
import {
  BOT_LEVELS,
  CARDS,
  COMMODITIES,
  RESOURCES,
  applyAction,
  createGame,
  heuristicAction,
  playersToAct,
  seedRng,
  nextInt,
  shuffle,
  simulateHeuristic,
  topo,
  type Action,
  type BotLevel,
  type Card,
  type DevCardType,
  type GameConfig,
  type GameState,
  type PlayerId,
  type ProgressCardName,
  type RngState,
} from '../src/index.js';
import { bare, giveC } from './ckHelpers.js';
import { C, act, blank, give, put, road } from './helpers.js';

/**
 * Trading with other players (src/bots/trading.ts) and the card tracker it
 * relies on (src/bots/tracker.ts): counter-offers, answers to open offers,
 * the kinds of offer a computer player makes, what it remembers, what it
 * won't hand the leader, and that every decision comes from what its seat
 * can see.
 */

type Propose = Extract<Action, { type: 'proposeTrade' }>;

/** The bot's move, which the engine must accept. */
function move(s: GameState, p: PlayerId, level: BotLevel): Action {
  const a = heuristicAction(s, p, level);
  expect(a, `a move for ${p} at ${level}`).not.toBeNull();
  expect(applyAction(s, a!).ok, JSON.stringify(a)).toBe(true);
  return a!;
}

/** Player 1 (a computer player) has a settlement and a road to a legal spot: it saves for a settlement. */
function settler(seed = 'trading'): GameState {
  const s = blank('base', 3, {}, seed);
  s.board.harbors = [];
  const t = topo(s);
  const a = C(0, 0, 0);
  put(s, a, 1);
  const b = t.vertexNeighbors[a][0];
  const c = t.vertexNeighbors[b].find((v) => v !== a)!;
  road(s, [t.vertexEdges[a].find((e) => t.edgeVertices[e].includes(b))!, t.vertexEdges[b].find((e) => t.edgeVertices[e].includes(c))!], 1);
  return s;
}

/** Everyone an offer of the active player is addressed to turns it down. */
function nobodyTakes(s: GameState): GameState {
  for (const id of s.turn.trades.filter((t) => t.from === s.turn.actor).map((t) => t.id)) {
    for (const q of s.turn.trades.find((t) => t.id === id)?.to ?? []) {
      const t = s.turn.trades.find((x) => x.id === id);
      if (t && !t.rejected.includes(q)) s = act(s, { type: 'rejectTrade', player: q, tradeId: id });
    }
  }
  return s;
}

/** Plays the active computer player's turn while nobody takes its offers; returns its offers and the rest of its moves. */
function offersWhileRefused(s: GameState, level: BotLevel): { offers: Propose[]; moves: Action[] } {
  const offers: Propose[] = [];
  const moves: Action[] = [];
  for (let i = 0; i < 40; i++) {
    const a = move(s, s.turn.actor, level);
    moves.push(a);
    if (a.type === 'proposeTrade') offers.push(a);
    if (a.type === 'endTurn') break;
    s = nobodyTakes(act(s, a));
  }
  return { offers, moves };
}

describe('counter-offers to a person', () => {
  it('answers an offer it would turn down with one it would take: the card it was asked for, for one it needs', () => {
    let s = settler();
    // you (player 0) hold a wool and two bricks; Ada (1) lacks only a brick for her settlement
    give(s, 0, { wool: 1, brick: 2 });
    give(s, 1, { lumber: 1, wool: 1, grain: 1, ore: 2 });
    // "my wool for your ore": Ada has no use for a second wool
    s = act(s, { type: 'proposeTrade', player: 0, give: { wool: 1 }, get: { ore: 1 }, to: [1] });
    const id = s.turn.trades[0].id;
    expect(move(s, 1, 'easy')).toEqual({ type: 'rejectTrade', player: 1, tradeId: id });
    for (const level of ['medium', 'hard'] as const) {
      const counter = move(s, 1, level);
      // the ore you asked for, for a brick she needs (you hold bricks, as everyone can count from the bank)
      expect(counter, level).toEqual({ type: 'proposeTrade', player: 1, give: { ore: 1 }, get: { brick: 1 }, to: [0], replyTo: id });
      // you can take it: the trade goes through at once
      let t = act(s, counter);
      const offer = t.turn.trades.find((x) => x.from === 1)!;
      t = act(t, { type: 'acceptTrade', player: 0, tradeId: offer.id });
      expect(t.players[1].resources).toMatchObject({ brick: 1, ore: 1 });
      expect(t.players[0].resources).toMatchObject({ brick: 1, ore: 1, wool: 1 });
    }
  });

  it('answers open offers with a concrete counter-offer, asking for what the proposer holds', () => {
    // "who gives me a brick?": Ada gives one, for a card she needs that you hold
    let s = settler();
    give(s, 0, { grain: 2 });
    give(s, 1, { brick: 3, lumber: 1, wool: 1 });
    s = act(s, { type: 'proposeTrade', player: 0, give: {}, get: { brick: 1 }, to: [1, 2], open: true });
    const id = s.turn.trades[0].id;
    for (const level of BOT_LEVELS) {
      expect(move(s, 1, level), level).toEqual({ type: 'proposeTrade', player: 1, give: { brick: 1 }, get: { grain: 1 }, to: [0], replyTo: id });
    }
    // Björn has no brick: no
    expect(move(s, 2, 'medium')).toEqual({ type: 'rejectTrade', player: 2, tradeId: id });

    // "what will you give for my grain?": Ada pays with a card she can spare
    let o = settler();
    give(o, 0, { grain: 1 });
    give(o, 1, { brick: 1, lumber: 1, wool: 1, ore: 3 });
    o = act(o, { type: 'proposeTrade', player: 0, give: { grain: 1 }, get: {}, to: [1], open: true });
    for (const level of BOT_LEVELS) {
      expect(move(o, 1, level), level).toEqual({ type: 'proposeTrade', player: 1, give: { ore: 1 }, get: { grain: 1 }, to: [0], replyTo: o.turn.trades[0].id });
    }
  });
});

describe('what a trade does for the partner', () => {
  /** Player 0 lacks one grain for a city; Ada (1) has grain to spare and wants wool. */
  function cityShort(leaderVP: number): GameState {
    let s = settler('leader');
    put(s, C(-2, 0, 0), 0);
    s.players[0].bonusVP = leaderVP;
    give(s, 0, { ore: 3, grain: 1, wool: 2 });
    give(s, 1, { grain: 2, lumber: 1, brick: 1 });
    s = act(s, { type: 'proposeTrade', player: 0, give: { wool: 1 }, get: { grain: 1 }, to: [1] });
    return s;
  }

  it("won't hand the leader the card that completes a city", () => {
    const s = cityShort(4);
    for (const level of ['medium', 'hard'] as const) {
      const a = move(s, 1, level);
      expect(a.type, level).not.toBe('acceptTrade');
      // nor a counter-offer that completes the city all the same (hard asks for an ore back with the wool)
      if (a.type === 'proposeTrade') {
        let t = act(s, a);
        t = act(t, { type: 'acceptTrade', player: 0, tradeId: t.turn.trades.find((x) => x.from === 1)!.id });
        const r = t.players[0].resources;
        expect(r.ore >= 3 && r.grain >= 2, level).toBe(false);
      }
    }
    // easy only minds a win
    expect(move(s, 1, 'easy').type).toBe('acceptTrade');
  });

  it('trades with a player level with it at medium; hard keeps a rival from its city too', () => {
    const s = cityShort(0);
    expect(move(s, 1, 'medium').type).toBe('acceptTrade');
    expect(move(s, 1, 'hard').type).not.toBe('acceptTrade');
  });

  it('never hands anyone the winning city, at any level', () => {
    const s = cityShort(0);
    s.victoryTarget = 4;
    s.players[0].bonusVP = 2;
    for (const level of BOT_LEVELS) expect(move(s, 1, level).type, level).not.toBe('acceptTrade');
  });

  it('is more generous with a player well behind', () => {
    // 1 lumber for one of Ada's three bricks: a small gain for her
    const base = (behind: boolean) => {
      let s = settler('generous');
      give(s, 0, { lumber: 1 });
      give(s, 1, { brick: 3, wool: 1, grain: 1 });
      // Ada has 3 VP more than you when you are behind
      if (behind) s.players[1].bonusVP = 3;
      return act(s, { type: 'proposeTrade', player: 0, give: { lumber: 1 }, get: { brick: 1 }, to: [1] });
    };
    // (lumber is what her settlement lacks: she takes it either way at medium)
    expect(move(base(true), 1, 'medium').type).toBe('acceptTrade');
    const pr = botProfile('medium');
    expect(pr.trade.generous).toBeGreaterThan(0);
  });
});

describe('its own offers', () => {
  /** Player 0 lacks one grain for a city, with wool and brick to spare; both others hold grain. */
  function oneGrain(): GameState {
    const s = blank('base', 3, {}, 'seq');
    s.board.harbors = [];
    put(s, C(0, 0, 0), 0);
    give(s, 0, { ore: 3, grain: 1, wool: 3, brick: 2 });
    give(s, 1, { grain: 2, lumber: 1 });
    give(s, 2, { grain: 1, ore: 1 });
    return s;
  }

  it('tries different offers when nobody takes one, never the same twice, and stops at its limit', () => {
    for (const level of BOT_LEVELS) {
      const { offers } = offersWhileRefused(oneGrain(), level);
      const keys = offers.map((a) => JSON.stringify([a.give, a.get, a.open ?? false]));
      expect(new Set(keys).size, level).toBe(keys.length);
      expect(offers.length, level).toBeLessThanOrEqual(botProfile(level).offersPerTurn);
    }
    // medium: a card for the grain, then "who gives me grain?"
    const medium = offersWhileRefused(oneGrain(), 'medium').offers;
    expect(medium.map((a) => [a.give, a.get, a.open ?? false])).toEqual([
      [{ brick: 1 }, { grain: 1 }, false],
      [{}, { grain: 1 }, true],
    ]);
    // hard: then two cards for the grain the city lacks
    const hard = offersWhileRefused(oneGrain(), 'hard').offers;
    expect(hard).toHaveLength(3);
    expect(hard[2].get).toEqual({ grain: 1 });
    expect(Object.values(hard[2].give).reduce((a, b) => a + b!, 0)).toBe(2);
  });

  it("doesn't repeat an offer nobody took on its last turn", () => {
    const s = oneGrain();
    const first = move(s, 0, 'medium') as Propose;
    // the same hand two turns later, after that offer went untaken on its turn
    const later = structuredClone(s);
    later.log.push(
      { turn: 1, msg: '--- Turn 1: Player 1 ---' },
      { turn: 1, msg: `Player 1 offers 1 brick for 1 grain` },
      { turn: 2, msg: '--- Turn 2: Player 2 ---' },
      { turn: 3, msg: '--- Turn 3: Player 3 ---' },
      { turn: 4, msg: '--- Turn 4: Player 1 ---' },
    );
    later.turn.number = 4;
    expect(first).toMatchObject({ give: { brick: 1 }, get: { grain: 1 } });
    const next = move(later, 0, 'medium') as Propose;
    expect(next.type).toBe('proposeTrade');
    expect([next.give, next.get]).not.toEqual([first.give, first.get]);
  });

  it('offers two for two toward a city, to the players who hold the cards', () => {
    const s = blank('base', 3, {}, 'two');
    s.board.harbors = [];
    s.devDeck = [];
    put(s, C(0, 0, 0), 0);
    give(s, 0, { ore: 2, grain: 1, wool: 3 });
    give(s, 1, { grain: 2, ore: 1 });
    give(s, 2, { grain: 1, ore: 2 });
    for (const level of ['medium', 'hard'] as const) {
      expect(move(s, 0, level), level).toEqual({ type: 'proposeTrade', player: 0, give: { wool: 2 }, get: { grain: 1, ore: 1 }, to: [1, 2] });
    }
  });

  it('asks the player likely to hold the card, not everyone', () => {
    const s = blank('base', 3, {}, 'seq');
    s.board.harbors = [];
    put(s, C(0, 0, 0), 0);
    give(s, 0, { ore: 3, grain: 1, wool: 3, brick: 2 });
    // only Björn (2) holds grain: everyone can tell from the bank, as Ada's three cards were seen to be lumber
    give(s, 1, { lumber: 3 });
    s.log.push({ turn: 1, msg: 'Player 2 receives 3 lumber' });
    give(s, 2, { grain: 2, ore: 1 });
    expect(move(s, 0, 'medium')).toMatchObject({ type: 'proposeTrade', get: { grain: 1 }, to: [2] });
  });

  it('easy offers now and then: one card for the one a settlement or city lacks', () => {
    let offered = 0;
    for (let turn = 1; turn <= 20; turn++) {
      const s = oneGrain();
      s.turn.number = turn;
      const a = move(s, 0, 'easy');
      if (a.type === 'proposeTrade') {
        offered++;
        expect(a.open).toBeUndefined();
        expect(Object.values(a.give)).toEqual([1]);
        expect(a.get).toEqual({ grain: 1 });
      }
    }
    expect(offered).toBeGreaterThan(2);
    expect(offered).toBeLessThan(18);
  });

  it('takes the best counter-offer to its open offer, and turns down a bad one', () => {
    let s = oneGrain();
    s = act(s, { type: 'proposeTrade', player: 0, give: {}, get: { grain: 1 }, to: [1, 2], open: true });
    const id = s.turn.trades[0].id;
    // Ada wants two wool for her grain, Björn one brick
    s = act(s, { type: 'proposeTrade', player: 1, give: { grain: 1 }, get: { wool: 2 }, to: [0], replyTo: id });
    expect(heuristicAction(s, 0, 'medium')).toBeNull(); // waits for Björn
    s = act(s, { type: 'proposeTrade', player: 2, give: { grain: 1 }, get: { brick: 1 }, to: [0], replyTo: id });
    const b = s.turn.trades.find((t) => t.from === 2)!;
    expect(heuristicAction(s, 0, 'medium')).toEqual({ type: 'acceptTrade', player: 0, tradeId: b.id });
  });
});

describe('Cities & Knights', () => {
  it('asks for the commodity its next city improvement lacks, from the player who holds it', () => {
    const s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    put(s, C(-2, 0, 0), 1, 'city');
    put(s, C(0, -2, 0), 2, 'city');
    s.ck!.players[0].improvements.science = 2;
    giveC(s, 0, { paper: 2 });
    give(s, 0, { wool: 3, lumber: 2 });
    giveC(s, 1, { paper: 2 });
    give(s, 1, { lumber: 1 });
    give(s, 2, { grain: 2 });
    for (const level of ['medium', 'hard'] as const) {
      expect(move(s, 0, level), level).toEqual({ type: 'proposeTrade', player: 0, give: { lumber: 1 }, get: { paper: 1 }, to: [1] });
    }
  });

  it('counters an offer with commodities too', () => {
    let s = bare();
    put(s, C(0, 0, 0), 0, 'city');
    put(s, C(-2, 0, 0), 1, 'city');
    s.ck!.players[1].improvements.politics = 2;
    // Ada needs coin for her politics; you offer wool for her paper
    giveC(s, 0, { coin: 2 });
    give(s, 0, { wool: 1 });
    giveC(s, 1, { paper: 2, coin: 2 });
    s = act(s, { type: 'proposeTrade', player: 0, give: { wool: 1 }, get: { paper: 1 }, to: [1] });
    const a = move(s, 1, 'medium');
    expect(a).toMatchObject({ type: 'proposeTrade', give: { paper: 1 }, get: { coin: 1 }, to: [0] });
  });
});

// ---------------------------------------------------------------------------
// The card tracker and hidden information
// ---------------------------------------------------------------------------

/**
 * The same game with everything a seat can't see dealt anew: the other
 * hands (same sizes, and in Cities & Knights the same number of
 * commodities), their development and progress cards (same numbers), the
 * decks' order and the random number generator. Public counts, the board,
 * the bank and the log stay as they are.
 */
function scramble(s: GameState, me: PlayerId, rng: RngState): GameState {
  const x = structuredClone(s);
  const deal = (n: number, kinds: readonly Card[]) => {
    const out: Partial<Record<Card, number>> = {};
    for (let i = 0; i < n; i++) {
      const k = kinds[nextInt(rng, kinds.length)];
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  const devTypes: DevCardType[] = ['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly'];
  for (const pl of x.players) {
    if (pl.id === me) continue;
    const n = RESOURCES.reduce((a, r) => a + pl.resources[r], 0);
    const d = deal(n, RESOURCES);
    for (const r of RESOURCES) pl.resources[r] = d[r] ?? 0;
    pl.devCards = pl.devCards.map((c) => ({ ...c, type: devTypes[nextInt(rng, devTypes.length)] }));
    if (x.ck) {
      const c = x.ck.players[pl.id].commodities;
      const m = COMMODITIES.reduce((a, k) => a + c[k], 0);
      const e = deal(m, COMMODITIES);
      for (const k of COMMODITIES) c[k] = e[k] ?? 0;
      const names: ProgressCardName[] = ['alchemist', 'spy', 'bishop', 'merchant', 'wedding', 'crane', 'deserter'];
      x.ck.players[pl.id].progress = x.ck.players[pl.id].progress.map(() => names[nextInt(rng, names.length)]);
    }
  }
  shuffle(rng, x.devDeck);
  if (x.ck) for (const deck of Object.values(x.ck.decks)) shuffle(rng, deck);
  x.rng = { s: nextInt(rng, 1_000_000) + 1 };
  return x;
}

/** States along a game, with the players to act: every state with an offer on the table, and every `every`-th other one. */
function sampleStates(config: GameConfig, levels: BotLevel[], every: number, max: number): Array<{ s: GameState; p: PlayerId }> {
  const out: Array<{ s: GameState; p: PlayerId }> = [];
  let i = 0;
  simulateHeuristic(createGame(config), 12000, levels, (s) => {
    i++;
    // (a progress card's choice may show its player another hand: that seat legitimately sees it)
    if (s.phase.kind === 'ck' && s.phase.step === 'card') return;
    if (out.length >= max) return;
    if (s.turn.trades.length === 0 && i % every !== 0) return;
    for (const p of playersToAct(s)) out.push({ s, p });
  });
  return out;
}

describe('decisions come from what the seat can see', () => {
  it('a trade decision is the same however the other hands are made up, as long as their sizes are', () => {
    const rng = seedRng('no-peeking');
    // the situations above, from both sides of the table
    const setups: Array<{ s: GameState; p: PlayerId }> = [];
    {
      let s = settler();
      give(s, 0, { wool: 1, brick: 2 });
      give(s, 1, { lumber: 1, wool: 1, grain: 1, ore: 2 });
      give(s, 2, { ore: 1, grain: 2 });
      s = act(s, { type: 'proposeTrade', player: 0, give: { wool: 1 }, get: { ore: 1 }, to: [1, 2] });
      setups.push({ s, p: 1 }, { s, p: 2 });
      let o = settler();
      give(o, 0, { grain: 2, ore: 1 });
      give(o, 1, { brick: 3, lumber: 1, wool: 1 });
      give(o, 2, { brick: 1, wool: 2 });
      o = act(o, { type: 'proposeTrade', player: 0, give: {}, get: { brick: 1 }, to: [1, 2], open: true });
      setups.push({ s: o, p: 1 }, { s: o, p: 2 });
      const t = blank('base', 3, {}, 'seq');
      put(t, C(0, 0, 0), 0);
      give(t, 0, { ore: 3, grain: 1, wool: 3, brick: 2 });
      give(t, 1, { grain: 2, lumber: 1 });
      give(t, 2, { grain: 1, ore: 1 });
      setups.push({ s: t, p: 0 });
    }
    for (const { s, p } of setups) {
      for (const level of BOT_LEVELS) {
        const a = heuristicAction(s, p, level);
        for (let k = 0; k < 6; k++) expect(heuristicAction(scramble(s, p, rng), p, level), `${level}, player ${p}`).toEqual(a);
      }
    }
  });

  const games: Array<[string, GameConfig]> = [
    ['the base game', { scenario: 'base', players: 3, seed: 'peek-base', options: { firstPlayer: 0 } }],
    ['Heading for New Shores', { scenario: 'seafarers-1-new-shores', players: 4, seed: 'peek-sea', options: { firstPlayer: 0 } }],
    ['Cities & Knights', { scenario: 'base', players: 4, seed: 'peek-ck', options: { firstPlayer: 0, citiesAndKnights: true } }],
  ];
  for (const [name, config] of games) {
    it(`every decision in ${name} is the same with the hidden cards, decks and dice dealt anew`, () => {
      const rng = seedRng(`peek-${name}`);
      const n = typeof config.players === 'number' ? config.players : config.players.length;
      const levels = Array.from({ length: n }, (_, i) => BOT_LEVELS[i % 3]);
      const states = sampleStates(config, levels, 9, 260);
      expect(states.some((x) => x.s.turn.trades.length > 0)).toBe(true);
      for (const { s, p } of states) {
        for (const level of BOT_LEVELS) {
          const a = heuristicAction(s, p, level);
          expect(heuristicAction(scramble(s, p, rng), p, level), `${level}, player ${p}, ${s.phase.kind}`).toEqual(a);
        }
      }
    });
  }

  it('the tracker follows the cards a seat sees change hands, and only those', () => {
    const states = sampleStates({ scenario: 'base', players: 4, seed: 'tracker', options: { firstPlayer: 0 } }, ['medium', 'medium', 'hard', 'hard'], 5, 400);
    let close = 0;
    let all = 0;
    for (const { s, p } of states) {
      const est = handEstimates(s, p);
      // its own hand exactly
      for (const r of RESOURCES) expect(est[p][r]).toBe(s.players[p].resources[r]);
      for (const q of s.players.map((x) => x.id)) {
        if (q === p) continue;
        // every estimate adds up to the public hand size
        expect(RESOURCES.reduce((a, r) => a + est[q][r], 0)).toBeCloseTo(RESOURCES.reduce((a, r) => a + s.players[q].resources[r], 0), 6);
        for (const r of RESOURCES) {
          all++;
          if (Math.round(est[q][r]) === s.players[q].resources[r]) close++;
        }
      }
    }
    // the log and the bank give almost everything away (only the cards stolen between two others are guesses)
    expect(close / all).toBeGreaterThan(0.85);
  });

  it('knows the card it stole, but not one stolen between two others', () => {
    let s = blank('base', 3, {}, 'steal');
    const hex = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].token === 8)!;
    const v = topo(s).hexVertices[hex][0];
    put(s, v, 1);
    give(s, 1, { ore: 1, wool: 1 });
    // a known start: the log says what player 1 got
    s.log.push({ turn: 1, msg: 'Player 2 receives 1 wool, 1 ore' });
    s.phase = { kind: 'robber', reason: 'knight', resume: { kind: 'main' } };
    s = act(s, { type: 'moveRobber', player: 0, piece: 'robber', hex, victim: 1 });
    const stolen = CARDS.find((k) => k !== 'paper' && (s.players[0].resources as Record<string, number>)[k] === 1)!;
    // the thief and the victim know which card it was
    expect(handEstimates(s, 0)[1][stolen]).toBeCloseTo(0, 6);
    expect(handEstimates(s, 1)[0][stolen]).toBeCloseTo(1, 6);
    // player 2 only knows player 1 holds one card, wool or ore
    const seen = handEstimates(s, 2)[1];
    expect(seen.wool + seen.ore).toBeCloseTo(1, 6);
    expect(seen.wool).toBeGreaterThan(0.1);
    expect(seen.ore).toBeGreaterThan(0.1);
  });
});

describe('the trade audit', () => {
  it('computer players trade with a person who takes fair offers, and never repeat an offer nobody took', () => {
    const total: TradeTally = emptyTally();
    for (const level of ['medium', 'hard'] as const) {
      for (let g = 0; g < 2; g++) {
        const start = createGame({ scenario: 'base', players: 3, seed: `trade-audit-${level}-${g}`, options: { firstPlayer: 0 } });
        const r = auditGame(start, [level, level, level], heuristicAction, 6000, undefined, [0]);
        expect(r.state.phase.kind).toBe('gameOver');
        expect(r.blunders.map((b) => `${b.kind}: ${b.detail}`)).toEqual([]);
        for (const k of Object.keys(total) as Array<keyof TradeTally>) total[k] += r.trades[k];
      }
    }
    expect(total.botHuman).toBeGreaterThan(0);
    expect(total.counters).toBeGreaterThan(0);
    expect(total.open).toBeGreaterThan(0);
    expect(total.repeats).toBe(0);
  });
});
