import { describe, expect, it } from 'vitest';
import { auditGame } from '../src/bots/audit.js';
import { planShipMove, sandSpot } from '../src/bots/expansion.js';
import { botProfile, expansionOf, spotValue } from '../src/bots/heuristicBot.js';
import {
  BOT_LEVELS,
  applyAction,
  createGame,
  getScenario,
  heuristicAction,
  legalActions,
  legalSettlements,
  movableShips,
  registerScenario,
  seafarersRules,
  topo,
  type Action,
  type BotLevel,
  type EdgeId,
  type GameState,
  type PlayerId,
  type VertexId,
} from '../src/index.js';
import { CK, knight } from './ckHelpers.js';
import { C, act, blank, give, put, road, setHex, ship, trail } from './helpers.js';

/**
 * Sand and ships (src/bots/expansion.ts: sandSpot, planShipMove): the
 * computer players don't settle or plan roads toward spots on desert that
 * pay next to nothing, unless island chits, a harbor or the end of the game
 * make up for it; and they move a ship when that brings a spot or goal
 * closer than where it stands, within the engine's rules for moving ships.
 *
 * test-sea (test/helpers.ts): an island of seven hexes centred on 2,2 and a
 * one-hex islet at 5,3. EAST is the island's east corner; ROUTE runs by ship
 * from it to the islet's west corner.
 */
const EAST = C(3, 2, 0);
const COAST = C(3, 2, 5);
const SEA1 = C(3, 3, 0);
const SEA2 = C(4, 3, 1);
const ISLET = C(5, 3, 2);
const ROUTE = [EAST, COAST, SEA1, SEA2, ISLET];
const ISLAND: Array<[number, number]> = [
  [2, 1],
  [3, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [1, 3],
  [2, 3],
];

// The test map with island chits: the first settlement off the home island earns 2 VP.
registerScenario({ ...getScenario('test-sea'), id: 'test-sea-chits', rules: seafarersRules({ islandBonus: { vp: 2, home: ['home'] } }) });

/** The bot's move, which the engine must accept. */
function move(s: GameState, p: PlayerId, level: BotLevel): Action {
  const a = heuristicAction(s, p, level);
  expect(a, `a move for ${p} at ${level}`).not.toBeNull();
  const r = applyAction(s, a!);
  expect(r.ok, JSON.stringify(a)).toBe(true);
  return a!;
}

const settles = (a: Action, v: VertexId) => a.type === 'buildSettlement' && a.vertex === v;

/**
 * Player 0's settlement in the island's south-west with a road two paths
 * long to SAND, the corner of 2,2 by the deserts 3,1 and 3,2 (2,2 pays a 12:
 * one pip). Settlement cards in hand.
 */
function sandy(scenario = 'test-sea'): { s: GameState; spot: VertexId } {
  const s = blank(scenario, 3, {}, 'sand');
  setHex(s, 3, 1, 'desert');
  setHex(s, 3, 2, 'desert');
  setHex(s, 2, 2, 'hills', 12);
  const spot = C(2, 2, 0);
  const t = topo(s);
  // a corner two paths away, the road along them
  const mid = t.vertexNeighbors[spot].find((v) => t.vertexHexes[v].includes('2,2') && t.vertexHexes[v].includes('3,1'))!;
  const home = t.vertexNeighbors[mid].find((v) => v !== spot && !t.vertexNeighbors[v].includes(spot))!;
  put(s, home, 0);
  road(s, trail(s, [home, mid, spot]), 0);
  give(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
  return { s, spot };
}

describe('sand', () => {
  it('a desert adds nothing to a spot: not as a hex, not as a second resource', () => {
    const s = blank('test-sea', 3, {}, 'sand-value');
    // EAST touches 3,2 alone (the rest is sea); its northern neighbour touches 3,1 and 3,2
    const north = C(3, 2, 1);
    const before = spotValue(s, 0, north);
    setHex(s, 3, 1, 'desert');
    const withDesert = spotValue(s, 0, north);
    setHex(s, 3, 1, 'sea');
    expect(withDesert).toBeCloseTo(spotValue(s, 0, north), 9);
    expect(withDesert).toBeLessThan(before);
    setHex(s, 3, 2, 'desert');
    expect(spotValue(s, 0, EAST)).toBe(0);
  });

  it('a spot on desert paying a pip is sand; island chits or a harbor make it worth a settlement', () => {
    const { s, spot } = sandy();
    expect(sandSpot(s, 0, spot)).toBe(true);
    // one paying hex of three is no sand
    setHex(s, 3, 2, 'fields', 9);
    expect(sandSpot(s, 0, spot)).toBe(false);
    setHex(s, 3, 2, 'desert');
    s.board.harbors.push({ edge: topo(s).vertexEdges[spot][0], type: 'generic' });
    expect(sandSpot(s, 0, spot)).toBe(false);
  });

  it('never settles a spot on sand more than two VP from winning, at any level', () => {
    for (const level of BOT_LEVELS) {
      const { s, spot } = sandy();
      expect(legalSettlements(s, 0)).toEqual([spot]);
      expect(settles(move(s, 0, level), spot), level).toBe(false);
      // two VP from winning, the VP is worth it
      s.players[0].bonusVP = s.victoryTarget - 3;
      expect(settles(move(s, 0, level), spot), `${level} near the end`).toBe(true);
    }
  });

  it('settles the same spot when a 2:1 harbor is on it', () => {
    for (const level of BOT_LEVELS) {
      const { s, spot } = sandy();
      s.board.harbors.push({ edge: topo(s).vertexEdges[spot][0], type: 'ore' });
      expect(settles(move(s, 0, level), spot), level).toBe(true);
    }
  });

  it('settles an islet of desert for its island chits, and sails there for them', () => {
    const s = blank('test-sea-chits', 3, {}, 'chits');
    setHex(s, 5, 3, 'desert');
    put(s, EAST, 0);
    const edges = trail(s, ROUTE);
    ship(s, edges.slice(0, 3), 0);
    // one ship short: it is the way to the chits (and the islet is no target without them)
    expect(expansionOf(s, 0, botProfile('hard')).byEdge.get(`ship:${edges[3]}`)!.gain).toBeGreaterThan(0);
    ship(s, edges[3], 0);
    give(s, 0, { brick: 1, lumber: 1, wool: 1, grain: 1 });
    expect(sandSpot(s, 0, ISLET)).toBe(false);
    for (const level of BOT_LEVELS) expect(settles(move(s, 0, level), ISLET), level).toBe(true);
  });

  it("plans no road toward sand, and heads for the better spot instead", () => {
    const { s, spot } = sandy();
    const x = expansionOf(s, 0, botProfile('hard'));
    expect(x.targets.some((t) => t.vertex === spot)).toBe(false);
    for (const t of x.targets.filter((y) => y.spot)) expect(sandSpot(s, 0, t.vertex)).toBe(false);
  });

  it('opens on the best spot, not on a mostly-desert one, at every level', () => {
    for (const level of BOT_LEVELS) {
      // the island all desert but 2,2 (an 8); the islet paying a 6
      let s = createGame({ scenario: 'test-sea', players: 3, seed: 'sand-setup', options: { firstPlayer: 0 } });
      for (const [q, r] of ISLAND) setHex(s, q, r, 'desert');
      setHex(s, 2, 2, 'mountains', 8);
      setHex(s, 5, 3, 'hills', 6);
      const a = move(s, 0, level);
      expect(a.type).toBe('placeSettlement');
      const v = (a as Extract<Action, { type: 'placeSettlement' }>).vertex;
      // a corner of the islet (5 pips, all land paying) or of 2,2 (5 pips, two deserts) at worst; never a desert corner
      expect(topo(s).vertexHexes[v].some((h) => h === '5,3' || h === '2,2'), `${level}: ${v}`).toBe(true);
      s = act(s, a);
    }
  });
});

/**
 * Ships: the island is all desert (no spot worth a settlement there), the
 * islet pays a 6. Player 0 settles EAST.
 */
function harbor(scenario = 'test-sea', options = {}): GameState {
  const s = blank(scenario, 3, options, 'ships');
  for (const [q, r] of ISLAND) setHex(s, q, r, 'desert');
  setHex(s, 5, 3, 'hills', 6);
  put(s, EAST, 0);
  s.turn.part = 5;
  return s;
}

/** The ship from EAST that points away from the islet: north, along the desert coast. */
function wrongWay(s: GameState): EdgeId {
  return trail(s, [EAST, C(3, 2, 1)])[0];
}

const moves = (s: GameState, p: PlayerId) => legalActions(s, p).filter((a): a is Extract<Action, { type: 'moveShip' }> => a.type === 'moveShip');

describe('moving ships', () => {
  it('moves a ship that leads away from the islet onto the way there, at every level that sees it', () => {
    for (const level of ['medium', 'hard'] as BotLevel[]) {
      const s = harbor();
      const away = wrongWay(s);
      ship(s, away, 0);
      expect(movableShips(s, 0)).toEqual([away]);
      const x = expansionOf(s, 0, botProfile(level));
      const before = x.targets.find((t) => t.vertex === ISLET)!.dist;
      const a = move(s, 0, level);
      expect(a.type, level).toBe('moveShip');
      const after = act(s, a);
      expect(expansionOf(after, 0, botProfile(level)).targets.find((t) => t.vertex === ISLET)!.dist, level).toBeLessThan(before);
    }
  });

  it('moves the ship instead of building one, and builds the next with the cards it saved', () => {
    let s = harbor();
    ship(s, wrongWay(s), 0);
    give(s, 0, { lumber: 1, wool: 1 });
    const a = move(s, 0, 'hard');
    expect(a.type).toBe('moveShip');
    s = act(s, a);
    expect(s.players[0].resources.lumber).toBe(1);
    const b = move(s, 0, 'hard');
    expect(b.type).toBe('buildShip');
  });

  it('leaves a ship on the way to the islet where it is', () => {
    for (const level of BOT_LEVELS) {
      const s = harbor();
      const edges = trail(s, ROUTE);
      ship(s, edges.slice(0, 2), 0);
      expect(movableShips(s, 0)).toEqual([edges[1]]);
      expect(planShipMove(s, 0, expansionOf(s, 0, botProfile(level)), moves(s, 0))).toBeNull();
      expect(move(s, 0, level).type, level).not.toBe('moveShip');
      // with the cards, it builds on toward the islet
      give(s, 0, { lumber: 1, wool: 1 });
      if (level !== 'easy') expect(move(s, 0, level), level).toEqual({ type: 'buildShip', player: 0, edge: edges[2] });
    }
  });

  it('never tries a move the engine forbids: a ship built this turn, or one by the pirate', () => {
    for (const level of BOT_LEVELS) {
      const s = harbor();
      const away = wrongWay(s);
      ship(s, away, 0);
      s.board.pieces[away].placedPart = s.turn.part;
      expect(moves(s, 0)).toEqual([]);
      expect(move(s, 0, level).type, level).not.toBe('moveShip');
      s.board.pieces[away].placedPart = 0;
      s.board.pirate = topo(s).edgeHexes[away].find((h) => s.board.hexes[h].terrain === 'sea')!;
      expect(moves(s, 0)).toEqual([]);
      expect(move(s, 0, level).type, level).not.toBe('moveShip');
    }
  });

  it('with Cities & Knights, never lifts the ship that links its knight (the engine closes that route)', () => {
    const s = harbor('test-sea', CK);
    const edges = trail(s, ROUTE);
    ship(s, edges.slice(0, 3), 0);
    knight(s, SEA2, 0);
    expect(movableShips(s, 0)).toEqual([]);
    for (const level of BOT_LEVELS) expect(move(s, 0, level).type, level).not.toBe('moveShip');
    // without the knight its last ship moves, onward is nowhere better: it stays
    delete s.ck!.knights[SEA2];
    expect(movableShips(s, 0)).toEqual([edges[2]]);
    expect(move(s, 0, 'hard').type).not.toBe('moveShip');
  });
});

describe('the audit counts sand and ship moves', () => {
  it('finds no sand settlements or idle ships by medium and hard in a Seafarers game, and counts their ship moves', () => {
    for (const level of ['medium', 'hard'] as BotLevel[]) {
      const start = createGame({ scenario: 'seafarers-2-four-islands', players: 3, seed: 'sand-audit', options: { firstPlayer: 0 } });
      const r = auditGame(start, start.players.map(() => level), heuristicAction);
      expect(r.state.phase.kind).toBe('gameOver');
      expect(r.blunders.filter((b) => b.kind === 'sandSpot' || b.kind === 'idleShip').map((b) => b.detail), level).toEqual([]);
      expect(r.ships[level].built).toBeGreaterThan(0);
    }
  });
});
