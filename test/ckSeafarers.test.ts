import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SCENARIOS,
  CK_BLOCKED_SCENARIOS,
  RESOURCES,
  cardRates,
  checkVictory,
  ckCombines,
  ckScenarioError,
  createGame,
  getScenario,
  isShipOnClosedRoute,
  legalActions,
  legalSetupSettlements,
  longestRouteLength,
  merchantHexError,
  movableShips,
  openRoadError,
  setupPlacesCity,
  topo,
  totalVP,
  vertexTouchesLand,
  viewFor,
  type Action,
  type GameState,
} from '../src/index.js';
import { CK, giveC, has, hand, knight, roll } from './ckHelpers.js';
import { C, H, S, act, blank, fail, give, put, road, setHex, ship, trail } from './helpers.js';

/**
 * Cities & Knights with the Seafarers scenarios: docs/cities-and-knights.md,
 * section 16, has the rules and their pages (C&K 2020 p. 13, C&K 2025 p. 12,
 * catan.com and the FAQs).
 *
 * test-sea (test/helpers.ts): an island centred on 2,2 and an islet at 5,3.
 * ROUTE runs by ship from the island's east coast to the islet's west corner;
 * SEA1 and SEA2 are its two intersections of open sea.
 */
const EAST = C(3, 2, 0);
const COAST = C(3, 2, 5);
const SEA1 = C(3, 3, 0);
const SEA2 = C(4, 3, 1);
const ISLET = C(5, 3, 2);
const ROUTE = [EAST, COAST, SEA1, SEA2, ISLET];

/** test-sea with Cities & Knights: player 0's turn after the roll, the robber and the pirate off the board. */
function sea(players = 3): GameState {
  return blank('test-sea', players, CK);
}

/** After the first barbarian attack: the robber and pirate may move. */
function awake(s: GameState): GameState {
  s.ck!.attacks = 1;
  delete s.ck!.asleep;
  return s;
}

const COMBINES = ['seafarers-1-new-shores', 'seafarers-4-through-the-desert', 'seafarers-6-cloth-trade', 'seafarers-8-wonders'];
const BLOCKED = ['seafarers-2-four-islands', 'seafarers-3-fog-islands', 'seafarers-5-forgotten-tribe', 'seafarers-7-pirate-islands', 'seafarers-9-new-world'];

describe('which Seafarers scenarios combine with Cities & Knights (2020 p. 13, 2025 p. 12, catan.com)', () => {
  it('New Shores, Through the Desert, Cloth for Catan and The Wonders combine, with their own player counts and both layouts', () => {
    for (const id of COMBINES) {
      const sc = getScenario(id);
      expect(ckCombines(sc), id).toBe(true);
      for (let n = sc.minPlayers; n <= sc.maxPlayers; n++) {
        for (const layout of ['official', 'random'] as const) {
          const s = createGame({ scenario: id, players: n, seed: `combine-${id}-${n}`, options: { ...CK, layout } });
          expect(s.ck, `${id} ${n} ${layout}`).toBeDefined();
          expect(s.devDeck).toEqual([]);
        }
      }
    }
    // with 5-6 players: New Shores and Through the Desert (their Seafarers 5-6 maps)
    expect(getScenario('seafarers-1-new-shores').maxPlayers).toBe(6);
    expect(getScenario('seafarers-4-through-the-desert').maxPlayers).toBe(6);
  });

  it('the scenarios of hidden hexes and many small islands are refused, each saying why', () => {
    for (const id of BLOCKED) {
      const why = ckScenarioError(getScenario(id));
      expect(why, id).toMatch(/^The rulebook doesn't combine Cities & Knights/);
      expect(CK_BLOCKED_SCENARIOS[id]).toBe(why);
      expect(() => createGame({ scenario: id, players: 4, seed: 1, options: CK })).toThrow(/The rulebook doesn't combine Cities & Knights/);
    }
    expect(ckScenarioError(getScenario('seafarers-3-fog-islands'))).toMatch(/hidden hexes/);
    expect(ckScenarioError(getScenario('seafarers-7-pirate-islands'))).toMatch(/Knight cards/);
    expect(ckScenarioError(getScenario('seafarers-5-forgotten-tribe'))).toMatch(/development cards/);
    // every built-in scenario is one or the other
    const sea = BUILT_IN_SCENARIOS.filter((x) => x.expansion === 'seafarers').map((x) => x.id);
    expect([...COMBINES, ...BLOCKED].sort()).toEqual(sea.sort());
    expect(ckScenarioError(getScenario('base'))).toBeNull();
  });

  it('the VP target is the scenario’s + 2 (2025 p. 12; catan.com): 16, 16, 16 and The Wonders’ 10 + 2; the base game keeps 13', () => {
    const target = (id: string, n = 4) => createGame({ scenario: id, players: n, seed: 1, options: CK }).victoryTarget;
    expect(target('seafarers-1-new-shores')).toBe(16);
    expect(target('seafarers-1-new-shores', 6)).toBe(16);
    expect(target('seafarers-4-through-the-desert', 3)).toBe(16);
    expect(target('seafarers-6-cloth-trade')).toBe(16);
    expect(target('seafarers-8-wonders')).toBe(12);
    expect(target('base')).toBe(13);
    // an explicit target still wins
    expect(createGame({ scenario: 'seafarers-1-new-shores', players: 4, seed: 1, options: { ...CK, victoryPoints: 18 } }).victoryTarget).toBe(18);
  });

  it('with 5-6 players: the C&K 5-6 supply on the Seafarers 5-6 maps, paired players by default', () => {
    const s = createGame({ scenario: 'seafarers-4-through-the-desert', players: 6, seed: 'td6', options: CK });
    expect(s.ck!.bank).toEqual({ paper: 18, cloth: 18, coin: 18 });
    expect(s.ck!.defenderCards).toBe(8);
    for (const r of RESOURCES) expect(s.bank[r]).toBe(24);
    expect(s.options.fiveSixMode).toBe('paired');
    expect(s.ck!.asleep?.robber).not.toBeNull();
  });
});

describe('the robber and the pirate wait by the barbarian track until the first attack (2025 p. 12; catan.de p. 16)', () => {
  it('they start off the board; the scenario’s starting hexes are kept for later', () => {
    for (const id of COMBINES) {
      const plain = createGame({ scenario: id, players: 4, seed: 'asleep' });
      const s = createGame({ scenario: id, players: 4, seed: 'asleep', options: CK });
      expect(s.board.robber, id).toBeNull();
      expect(s.board.pirate, id).toBeNull();
      expect(s.ck!.asleep, id).toEqual({ robber: plain.board.robber, pirate: plain.board.pirate });
      // the same map as without the expansion
      expect(Object.keys(s.board.hexes).map((h) => s.board.hexes[h].terrain)).toEqual(Object.keys(plain.board.hexes).map((h) => plain.board.hexes[h].terrain));
      // public: every seat sees where they will start
      expect(viewFor(s, 1).ck!.asleep).toEqual(s.ck!.asleep);
    }
    // The Wonders has no pirate; on the base map the robber sleeps on the desert as before
    expect(createGame({ scenario: 'seafarers-8-wonders', players: 3, seed: 1, options: CK }).ck!.asleep!.pirate).toBeNull();
    const base = createGame({ scenario: 'base', players: 3, seed: 1, options: CK });
    expect(base.ck!.asleep).toBeUndefined();
    expect(base.board.robber).not.toBeNull();
  });

  it('a 7 before the first attack moves neither; ships may be built by the pirate’s starting hex until it arrives', () => {
    let s = sea();
    s.ck!.asleep = { robber: H(2, 2), pirate: H(4, 2) };
    put(s, EAST, 0);
    give(s, 0, { lumber: 2, wool: 2 });
    // next to hex 4,2, where the pirate will start
    s = act(s, { type: 'buildShip', player: 0, edge: trail(s, [EAST, COAST])[0] });
    s = roll(s, 3, 4, 'politics');
    expect(s.phase.kind).toBe('main');
    expect(s.log.some((l) => l.msg === 'The robber stays put until the barbarians first attack')).toBe(true);
    expect(legalActions(s, 0).some((a) => a.type === 'moveRobber')).toBe(false);
  });

  it('at the first attack they take the scenario’s starting hexes; from then on they move and block as usual', () => {
    let s = sea();
    s.ck!.asleep = { robber: H(2, 2), pirate: H(4, 2) };
    s.ck!.barbarians = 6;
    put(s, EAST, 0);
    s = roll(s, 2, 3, 'ship');
    expect(s.ck!.attacks).toBe(1);
    expect(s.ck!.asleep).toBeUndefined();
    expect(s.board.robber).toBe(H(2, 2));
    expect(s.board.pirate).toBe(H(4, 2));
    expect(s.log.some((l) => /the robber and the pirate take their places on the board/.test(l.msg))).toBe(true);
    // the pirate now keeps ships off its hex's paths
    s.phase = { kind: 'main' };
    give(s, 0, { lumber: 1, wool: 1 });
    fail(s, { type: 'buildShip', player: 0, edge: trail(s, [EAST, COAST])[0] }, /next to the pirate/);
    // and a 7 moves the robber or the pirate
    s = roll(s, 3, 4, 'politics', 1);
    const acts = legalActions(s, 1);
    expect(acts.some((a) => a.type === 'moveRobber' && a.piece === 'robber')).toBe(true);
    expect(acts.some((a) => a.type === 'moveRobber' && a.piece === 'pirate')).toBe(true);
  });

  it('a scenario without a pirate (The Wonders) brings only the robber', () => {
    let s = blank('seafarers-8-wonders', 3, CK);
    const start = s.ck!.asleep!.robber;
    s.ck!.barbarians = 6;
    s = roll(s, 2, 3, 'ship');
    expect(s.board.robber).toBe(start);
    expect(s.board.pirate).toBeNull();
    expect(s.log.some((l) => /the robber takes its place on the board/.test(l.msg))).toBe(true);
  });
});

describe('knights and ships ("rules for roads also apply to ships", 2020 p. 13; 2025 p. 12)', () => {
  /** Player 0's settlement on the east coast and ships all the way to the islet. */
  function route(): GameState {
    const s = sea();
    put(s, EAST, 0);
    ship(s, trail(s, ROUTE), 0);
    return s;
  }

  it('SEA1 and SEA2 are intersections of open sea; the rest of the route touches land', () => {
    const s = sea();
    expect(ROUTE.map((v) => vertexTouchesLand(s, v))).toEqual([true, true, false, false, true]);
  });

  it('a knight is hired on land next to your ship, never at sea ("but not place a new knight there")', () => {
    let s = route();
    give(s, 0, { wool: 2, ore: 2 });
    fail(s, { type: 'buildKnight', player: 0, vertex: SEA1 }, /placed on land/);
    expect(legalActions(s, 0).some((a) => a.type === 'buildKnight' && a.vertex === SEA1)).toBe(false);
    s = act(s, { type: 'buildKnight', player: 0, vertex: COAST });
    s = act(s, { type: 'buildKnight', player: 0, vertex: ISLET });
    expect(Object.keys(s.ck!.knights).sort()).toEqual([COAST, ISLET].sort());
  });

  it('an active knight moves along roads and ships, and may end its move at sea on its own ship', () => {
    let s = route();
    knight(s, COAST, 0, 1, true);
    const moves = legalActions(s, 0)
      .filter((a): a is Extract<Action, { type: 'moveKnight' }> => a.type === 'moveKnight')
      .map((a) => a.to);
    expect(moves).toEqual(expect.arrayContaining([SEA1, SEA2, ISLET]));
    s = act(s, { type: 'moveKnight', player: 0, from: COAST, to: SEA2 });
    expect(s.ck!.knights[SEA2]).toMatchObject({ owner: 0, active: false });
    // not where it has no ship
    knight(s, COAST, 0, 1, true);
    fail(s, { type: 'moveKnight', player: 0, from: COAST, to: C(4, 2, 0) }, /cannot reach/);
  });

  it('a ship route to your knight is closed: the ship by the knight may not move (FAQ "When is a ship open?")', () => {
    // the route ends at sea, no settlement at the far end: open, its last ship moves
    let s = sea();
    put(s, EAST, 0);
    const [e0, e1, e2] = trail(s, [EAST, COAST, SEA1, SEA2]);
    ship(s, [e0, e1, e2], 0);
    s.turn.part = 5;
    expect(movableShips(s, 0)).toEqual([e2]);
    // a knight at its end closes it: nothing moves, the knight stays connected
    knight(s, SEA2, 0);
    expect(isShipOnClosedRoute(s, 0, e2)).toBe(true);
    expect(movableShips(s, 0)).toEqual([]);
    fail(s, { type: 'moveShip', player: 0, from: e2, to: S(1, 1, 3) }, /closed trade route/);
    // a ship beyond the knight is the end of an open route and may move
    const e3 = trail(s, [SEA2, ISLET])[0];
    ship(s, e3, 0);
    expect(movableShips(s, 0)).toEqual([e3]);
    s = act(s, { type: 'moveShip', player: 0, from: e3, to: topo(s).vertexEdges[SEA2].find((e) => e !== e2 && e !== e3)! });
  });

  it('an opponent’s knight on your route: it breaks your trade route, and you still may not break a closed route by it (catan.com)', () => {
    const s = route();
    put(s, ISLET, 0);
    const e = trail(s, ROUTE);
    s.turn.part = 5;
    expect(longestRouteLength(s, 0)).toBe(4);
    expect(movableShips(s, 0)).toEqual([]);
    knight(s, SEA1, 1);
    expect(longestRouteLength(s, 0)).toBe(2);
    expect(movableShips(s, 0)).toEqual([]);
    expect(isShipOnClosedRoute(s, 0, e[1])).toBe(true);
    expect(isShipOnClosedRoute(s, 0, e[2])).toBe(true);
  });

  it('an opponent’s knight at sea blocks your ships, as it blocks roads', () => {
    const s = sea();
    put(s, EAST, 0);
    ship(s, trail(s, [EAST, COAST, SEA1]), 0);
    give(s, 0, { lumber: 1, wool: 1 });
    knight(s, SEA1, 1);
    fail(s, { type: 'buildShip', player: 0, edge: trail(s, [SEA1, SEA2])[0] }, /connect/);
  });

  it('a stronger knight displaces one at sea; it retreats along its owner’s ships', () => {
    let s = sea();
    put(s, EAST, 0);
    ship(s, trail(s, [EAST, COAST, SEA1]), 0);
    knight(s, COAST, 0, 2, true);
    put(s, ISLET, 1);
    ship(s, trail(s, [ISLET, SEA2, SEA1]), 1);
    knight(s, SEA1, 1, 1, true);
    s = act(s, { type: 'displaceKnight', player: 0, from: COAST, to: SEA1 });
    expect(s.ck!.knights[SEA1]).toMatchObject({ owner: 0, level: 2 });
    expect(s.phase).toMatchObject({ kind: 'ck', step: 'retreat', player: 1 });
    expect(legalActions(s, 1)).toEqual([{ type: 'retreatKnight', player: 1, to: SEA2 }]);
    s = act(s, { type: 'retreatKnight', player: 1, to: SEA2 });
    expect(s.ck!.knights[SEA2]).toMatchObject({ owner: 1, active: true });
  });

  it('a knight next to the pirate’s hex, on the coast or at sea, chases it once the barbarians have attacked (catan.com, catan.de p. 16)', () => {
    let s = sea();
    put(s, EAST, 0);
    ship(s, trail(s, [EAST, COAST, SEA1]), 0);
    knight(s, COAST, 0, 1, true);
    knight(s, SEA1, 0, 1, true);
    s.board.pirate = H(4, 2);
    // before the first attack
    fail(s, { type: 'chaseRobber', player: 0, vertex: COAST, piece: 'pirate' }, /pirate stays put until the barbarians first attack/);
    awake(s);
    const chases = legalActions(s, 0).filter((a) => a.type === 'chaseRobber');
    expect(chases).toEqual(
      expect.arrayContaining([
        { type: 'chaseRobber', player: 0, vertex: COAST, piece: 'pirate' },
        { type: 'chaseRobber', player: 0, vertex: SEA1, piece: 'pirate' },
      ]),
    );
    // player 1 has a ship by hex 5,2 and only a commodity in hand: the chase takes it
    put(s, ISLET, 1);
    ship(s, trail(s, [ISLET, SEA2]), 1);
    giveC(s, 1, { coin: 1 });
    s = act(s, { type: 'chaseRobber', player: 0, vertex: SEA1, piece: 'pirate' });
    expect(s.phase).toMatchObject({ kind: 'robber', reason: 'chase', piece: 'pirate' });
    expect(legalActions(s, 0).every((a) => a.type === 'moveRobber' && a.piece === 'pirate')).toBe(true);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'pirate', hex: H(5, 2), victim: 1 });
    expect(s.board.pirate).toBe(H(5, 2));
    expect(s.ck!.knights[SEA1].active).toBe(false);
    expect(s.ck!.players[0].commodities.coin).toBe(1);
    expect(s.ck!.players[1].commodities.coin).toBe(0);
  });

  it('Intrigue reaches a knight on an intersection of your ships (Almanac p. 16: "roads or shipping routes")', () => {
    const s = sea();
    put(s, EAST, 0);
    ship(s, trail(s, [EAST, COAST, SEA1]), 0);
    put(s, ISLET, 1);
    ship(s, trail(s, [ISLET, SEA2, SEA1]), 1);
    knight(s, SEA1, 1);
    hand(s, 0, 'intrigue');
    expect(has(legalActions(s, 0), { type: 'playProgress', card: 'intrigue', args: { vertex: SEA1 } })).toBe(true);
  });

  it('the Deserter’s knight is placed by the placement rules: on land', () => {
    let s = sea();
    put(s, EAST, 0);
    ship(s, trail(s, [EAST, COAST, SEA1]), 0);
    knight(s, C(5, 3, 0), 1, 1);
    hand(s, 0, 'deserter');
    s = act(s, { type: 'playProgress', player: 0, card: 'deserter', args: { target: 1 } });
    expect(s.phase).toMatchObject({ kind: 'ck', step: 'card', stage: 'place' });
    const spots = legalActions(s, 0).flatMap((a) => (a.type === 'progressChoice' && a.args ? [a.args.vertex] : []));
    expect(spots).toContain(COAST);
    expect(spots).not.toContain(SEA1);
  });
});

describe('progress cards with ships and the pirate', () => {
  it('Road Building builds roads or ships (Almanac p. 15)', () => {
    let s = sea();
    put(s, EAST, 0);
    hand(s, 0, 'roadBuilding');
    s = act(s, { type: 'playProgress', player: 0, card: 'roadBuilding' });
    const acts = legalActions(s, 0);
    expect(acts.some((a) => a.type === 'buildShip')).toBe(true);
    expect(acts.some((a) => a.type === 'buildRoad')).toBe(true);
    s = act(s, { type: 'buildShip', player: 0, edge: trail(s, [EAST, COAST])[0] });
    s = act(s, { type: 'buildShip', player: 0, edge: trail(s, [COAST, SEA1])[0] });
    expect(s.phase.kind).toBe('main');
  });

  it('the Bishop moves the robber, never the pirate (2025 p. 12; FAQ 63)', () => {
    let s = awake(sea());
    s.board.robber = H(2, 2);
    s.board.pirate = H(4, 2);
    hand(s, 0, 'bishop');
    s = act(s, { type: 'playProgress', player: 0, card: 'bishop' });
    const moves = legalActions(s, 0).filter((a) => a.type === 'moveRobber');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((a) => a.type === 'moveRobber' && a.piece === 'robber')).toBe(true);
  });

  it('the Diplomat takes up an open ship, even by the pirate, and your own goes back as a ship (2025 p. 12; FAQ 64-66)', () => {
    let s = awake(sea());
    put(s, EAST, 0);
    const [e0, e1] = trail(s, [EAST, COAST, SEA1]);
    ship(s, [e0, e1], 0);
    s.board.pirate = H(4, 2);
    expect(openRoadError(s, e1)).toBeNull();
    hand(s, 0, 'diplomat');
    s = act(s, { type: 'playProgress', player: 0, card: 'diplomat', args: { edge: e1 } });
    expect(s.phase).toMatchObject({ kind: 'ck', step: 'card', stage: 'rebuild' });
    const spots = legalActions(s, 0).flatMap((a) => (a.type === 'progressChoice' && a.args ? [a.args.edge as string] : []));
    expect(spots.length).toBeGreaterThan(0);
    for (const e of spots) {
      // a ship's path, and never by the pirate
      expect(topo(s).edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea'), e).toBe(true);
      expect(topo(s).edgeHexes[e]).not.toContain(H(4, 2));
    }
  });
});

describe('gold, the merchant and harbors (2025 p. 12; C&K p. 7)', () => {
  it('a city on gold takes two resources of its choice and no commodity; a settlement one', () => {
    let s = sea();
    setHex(s, 2, 2, 'gold', 9);
    put(s, C(2, 2, 0), 0, 'city');
    put(s, C(2, 2, 3), 1);
    s = roll(s, 4, 5, 'politics');
    expect(s.phase).toMatchObject({ kind: 'gold', pending: { 0: 2, 1: 1 } });
    s = act(s, { type: 'chooseGold', player: 0, resources: { ore: 1, wool: 1 } });
    s = act(s, { type: 'chooseGold', player: 1, resources: { grain: 1 } });
    expect(s.players[0].resources).toMatchObject({ ore: 1, wool: 1 });
    expect(s.ck!.players[0].commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
    expect(s.players[1].resources.grain).toBe(1);
  });

  it('the merchant never stands on gold', () => {
    const s = sea();
    setHex(s, 2, 2, 'gold', 9);
    put(s, C(2, 2, 0), 0);
    expect(merchantHexError(s, 0, H(2, 2))).toMatch(/gold/);
    expect(merchantHexError(s, 0, H(3, 2))).toBeNull();
  });

  it('harbors: a 3:1 harbor takes commodities 3:1, a 2:1 harbor only its own resource', () => {
    const s = sea();
    put(s, EAST, 0);
    const [e0] = trail(s, [EAST, COAST]);
    s.board.harbors = [{ edge: e0, type: 'ore' }];
    expect(cardRates(s, 0)).toMatchObject({ ore: 2, paper: 4, cloth: 4, coin: 4 });
    s.board.harbors = [{ edge: e0, type: 'generic' }];
    expect(cardRates(s, 0)).toMatchObject({ ore: 3, paper: 3, cloth: 3, coin: 3 });
  });
});

describe('setting up with a city on a Seafarers map', () => {
  it('the round that collects places a city: the second, or Cloth for Catan’s third', () => {
    const ns = createGame({ scenario: 'seafarers-1-new-shores', players: 3, seed: 1, options: CK });
    expect([setupPlacesCity(ns, 0), setupPlacesCity(ns, 1)]).toEqual([false, true]);
    const cloth = createGame({ scenario: 'seafarers-6-cloth-trade', players: 3, seed: 1, options: CK });
    expect([setupPlacesCity(cloth, 0), setupPlacesCity(cloth, 1), setupPlacesCity(cloth, 2)]).toEqual([false, false, true]);
  });

  it('plays through the set-up: the city takes one resource per hex and never a commodity; a coastal city may start a ship', () => {
    for (const id of COMBINES) {
      let s = createGame({ scenario: id, players: 3, seed: `setup-${id}`, options: { ...CK, firstPlayer: 0 } });
      let shipAfterCity = false;
      for (let guard = 0; s.phase.kind !== 'preRoll' && guard < 80; guard++) {
        const p = s.phase.kind === 'gold' ? Number(Object.keys(s.phase.pending)[0]) : s.turn.actor;
        const acts = legalActions(s, p);
        const ph = s.phase;
        if (ph.kind === 'setup' && ph.step === 'edge' && s.board.buildings[ph.vertex!]?.type === 'city' && acts.some((a) => a.type === 'placeShip')) {
          shipAfterCity = true;
        }
        // coastal spots first, so a starting ship comes up
        const coastal = acts.find((a) => a.type === 'placeSettlement' && topo(s).vertexHexes[a.vertex].some((h) => s.board.hexes[h]?.terrain === 'sea'));
        s = act(s, coastal ?? acts[0]);
      }
      expect(s.phase.kind, id).toBe('preRoll');
      for (const pl of s.players) {
        const mine = Object.values(s.board.buildings).filter((b) => b.owner === pl.id);
        expect(mine.filter((b) => b.type === 'city'), id).toHaveLength(1);
        expect(s.ck!.players[pl.id].commodities).toEqual({ paper: 0, cloth: 0, coin: 0 });
      }
      expect(shipAfterCity, id).toBe(true);
    }
  });

  it('The Wonders: the starting city keeps off the wasteland, the strait and the small islands', () => {
    const s = createGame({ scenario: 'seafarers-8-wonders', players: 3, seed: 1, options: { ...CK, firstPlayer: 0 } });
    const sites = s.ext.wonderSites as { strait: string[]; wasteland: string[] };
    const spots = legalSetupSettlements(s, 0);
    for (const v of [...sites.strait, ...sites.wasteland]) expect(spots).not.toContain(v);
  });
});

describe('Cloth for Catan with Cities & Knights', () => {
  /** Player 0 trades with a village whose number is `n`; the next roll is `n` (yellow + red). */
  function trading(): { s: GameState; village: string; token: number } {
    const s = blank('seafarers-6-cloth-trade', 3, CK);
    const cloth = s.ext.cloth as { villages: Record<string, { token: number; cloth: number; traders: number[] }> };
    const [village, v] = Object.entries(cloth.villages).find(([, x]) => x.token >= 3 && x.token <= 11 && x.token !== 7)!;
    v.traders.push(0);
    return { s, village, token: v.token };
  }

  it('a village pays its traders cloth after the roll’s production, and village cloth is not the cloth commodity', () => {
    const { s: s0, token } = trading();
    const red = Math.min(6, token - 1);
    const s = roll(s0, token - red, red, 'politics');
    const cloth = s.ext.cloth as { cloth: number[] };
    expect(cloth.cloth[0]).toBe(1);
    expect(s.ck!.players[0].commodities.cloth).toBe(0);
    expect(s.log.some((l) => l.msg === 'Player 1 receives 1 cloth')).toBe(true);
    // 2 village cloth = 1 VP
    cloth.cloth[0] = 4;
    expect(totalVP(s, 0)).toBe(2);
  });

  it('the pirate moves only for a player who reached a village, a knight’s chase included; it may take village cloth', () => {
    let s = blank('seafarers-6-cloth-trade', 3, CK);
    const pirate = s.ck!.asleep!.pirate!;
    awake(s);
    s.board.pirate = pirate;
    const v = topo(s).hexVertices[pirate][0];
    knight(s, v, 0, 1, true);
    fail(s, { type: 'chaseRobber', player: 0, vertex: v, piece: 'pirate' }, /cannot move the pirate yet/);
    const cloth = s.ext.cloth as { villages: Record<string, { traders: number[] }>; cloth: number[] };
    Object.values(cloth.villages)[0].traders.push(0);
    s = act(s, { type: 'chaseRobber', player: 0, vertex: v, piece: 'pirate' });
    expect(s.phase).toMatchObject({ kind: 'robber', piece: 'pirate' });
    // a victim with village cloth: the thief may take a card or a cloth
    const target = legalActions(s, 0).find((a) => a.type === 'moveRobber') as Extract<Action, { type: 'moveRobber' }>;
    const edge = topo(s).hexEdges[target.hex][0];
    s.board.pieces[edge] = { owner: 1, type: 'ship', placedPart: 0 };
    (s.ext.cloth as { cloth: number[] }).cloth[1] = 2;
    expect(has(legalActions(s, 0), { type: 'moveRobber', piece: 'pirate', hex: target.hex, victim: 1, take: 'cloth' })).toBe(true);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'pirate', hex: target.hex, victim: 1, take: 'cloth' });
    expect((s.ext.cloth as { cloth: number[] }).cloth).toEqual([1, 1, 0]);
  });
});

describe('The Wonders with Cities & Knights', () => {
  it('12 VP win only with more wonder levels than anyone else', () => {
    const s = blank('seafarers-8-wonders', 3, CK);
    const w = s.ext.wonders as { owned: Array<string | null>; levels: number[]; claimed: Record<string, number> };
    w.owned[0] = 'theater';
    w.claimed.theater = 0;
    w.levels = [1, 1, 0];
    s.ck!.players[0].defenders = 12;
    checkVictory(s);
    expect(s.phase.kind).toBe('main');
    // one level more than anyone else, built with resources
    let t = blank('seafarers-8-wonders', 3, CK);
    const w2 = t.ext.wonders as typeof w;
    w2.owned[0] = 'theater';
    w2.claimed.theater = 0;
    w2.levels = [1, 0, 0];
    t.ck!.players[0].defenders = 12;
    give(t, 0, { brick: 1, wool: 3, lumber: 1 });
    t = act(t, { type: 'scenario', player: 0, name: 'buildWonder' });
    expect(t.phase).toMatchObject({ kind: 'gameOver', winner: 0 });
  });

  it('wonder levels are paid in resources: commodities do not count', () => {
    const s = blank('seafarers-8-wonders', 3, CK);
    const w = s.ext.wonders as { owned: Array<string | null>; levels: number[]; claimed: Record<string, number> };
    w.owned[0] = 'theater';
    w.claimed.theater = 0;
    giveC(s, 0, { cloth: 3, paper: 2 });
    give(s, 0, { brick: 1, lumber: 1 });
    fail(s, { type: 'scenario', player: 0, name: 'buildWonder' }, /not enough resources/);
  });
});

describe('Through the Desert and New Shores with Cities & Knights', () => {
  it('the first settlement on a new island still earns its VP chits', () => {
    let s = blank('seafarers-1-new-shores', 3, CK);
    const t = topo(s);
    const spot = t.vertexIds.find((v) => {
      const zones = t.vertexHexes[v].map((h) => s.board.hexes[h]?.zone).filter(Boolean);
      return zones.length > 0 && zones.every((z) => z !== 'main') && vertexTouchesLand(s, v);
    })!;
    const e = t.vertexEdges[spot].find((x) => t.edgeHexes[x].some((h) => s.board.hexes[h]?.terrain === 'sea'))!;
    ship(s, e, 0);
    give(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    s = act(s, { type: 'buildSettlement', player: 0, vertex: spot });
    expect(s.players[0].bonusVP).toBe(2);
    expect(totalVP(s, 0)).toBe(3);
  });

  it('the barbarians count every city and knight on every island (2020 p. 13)', () => {
    let s = blank('seafarers-4-through-the-desert', 3, CK);
    const t = topo(s);
    const land = t.vertexIds.filter((v) => vertexTouchesLand(s, v));
    put(s, land[0], 0, 'city');
    put(s, land[land.length - 1], 1, 'city');
    s.ck!.barbarians = 6;
    s = roll(s, 2, 3, 'ship');
    expect(s.log.some((l) => l.msg === 'The barbarians attack: 2 against the knights\' 0')).toBe(true);
  });
});
