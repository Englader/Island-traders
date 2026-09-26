import { describe, expect, it } from 'vitest';
import {
  createGame,
  currentSetupPlayer,
  isLandHex,
  legalActions,
  legalRoads,
  legalSetupSettlements,
  legalShips,
  movableShips,
  publicVP,
  topo,
  totalVP,
  vertexZones,
  viewFor,
  type EdgeId,
  type GameState,
  type VertexId,
} from '../src/index.js';
import { WONDERS, straitVertices, wastelandVertices } from '../src/scenarios/seafarers/wonders.js';
import { act, blank, fail, give, put, road, ship, withDice, withNextDie } from './helpers.js';

const SETTLEMENT = { brick: 1, lumber: 1, wool: 1, grain: 1 };

/** A vertex whose land hexes all lie in `zone`, touching sea (so a ship can reach it). */
function coastalVertexIn(s: GameState, zone: string, avoid: VertexId[] = []): VertexId {
  const t = topo(s);
  return t.vertexIds.find((v) => {
    const hexes = t.vertexHexes[v].map((h) => s.board.hexes[h]);
    const land = hexes.filter((h) => h.terrain !== 'sea' && h.terrain !== 'fog');
    return (
      land.length > 0 &&
      land.every((h) => h.zone === zone) &&
      hexes.some((h) => h.terrain === 'sea') &&
      !avoid.some((a) => a === v || t.vertexNeighbors[a].includes(v))
    );
  })!;
}

/** Land zones of the board, largest first (ties by name). */
function landZones(s: GameState, exclude: string[] = []): string[] {
  const size: Record<string, number> = {};
  for (const h of Object.values(s.board.hexes)) {
    if (h.zone && isLandHex(s, `${h.q},${h.r}`) && !exclude.includes(h.zone)) size[h.zone] = (size[h.zone] ?? 0) + 1;
  }
  return Object.keys(size).sort((a, b) => size[b] - size[a] || (a < b ? -1 : 1));
}

/** A sea/coast edge at `v` for a ship. */
function shipEdgeAt(s: GameState, v: VertexId): EdgeId {
  const t = topo(s);
  return t.vertexEdges[v].find((e) => t.edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea'))!;
}

function settleWithShip(s: GameState, p: number, v: VertexId): GameState {
  ship(s, shipEdgeAt(s, v), p);
  give(s, p, SETTLEMENT);
  return act(s, { type: 'buildSettlement', player: p, vertex: v });
}

describe('1 Heading for New Shores', () => {
  it('first settlement on each small island earns 2 VP; the main island earns nothing', () => {
    let s = blank('seafarers-1-new-shores', 3);
    const zones = [...new Set(Object.values(s.board.hexes).map((h) => h.zone).filter((z) => z && z !== 'main'))];
    expect(zones.length).toBe(3);
    const a = coastalVertexIn(s, zones[0] as string);
    s = settleWithShip(s, 0, a);
    expect(s.players[0].bonusVP).toBe(2);
    const a2 = coastalVertexIn(s, zones[0] as string, [a]);
    expect(a2).toBeDefined();
    s = settleWithShip(s, 0, a2);
    expect(s.players[0].bonusVP).toBe(2);
    s = settleWithShip(s, 0, coastalVertexIn(s, zones[1] as string));
    expect(s.players[0].bonusVP).toBe(4);
    s = settleWithShip(s, 0, coastalVertexIn(s, 'main'));
    expect(s.players[0].bonusVP).toBe(4);
    expect(publicVP(s, 0)).toBe(4 + 4);
  });

  it('victory target is 14', () => {
    expect(createGame({ scenario: 'seafarers-1-new-shores', players: 4, seed: 1 }).victoryTarget).toBe(14);
  });
});

describe('2 The Four Islands', () => {
  it('home islands are where you started; others earn 2 VP each', () => {
    let s = createGame({ scenario: 'seafarers-2-four-islands', players: 3, seed: 'fi', options: { firstPlayer: 0 } });
    // place all starting settlements on legal spots
    while (s.phase.kind === 'setup') {
      const p = currentSetupPlayer(s)!;
      const v = legalSetupSettlements(s, p)[0];
      s = act(s, { type: 'placeSettlement', player: p, vertex: v });
      if (s.phase.kind === 'gold') {
        s = act(s, { type: 'chooseGold', player: p, resources: { ore: (s.phase.pending[p] as number) } });
      }
      s = act(s, { type: 'placeRoad', player: p, edge: legalRoads(s, p, v)[0] });
    }
    const home = s.players[0].homeZones;
    expect(home.length).toBeGreaterThanOrEqual(1);
    const allZones = [...new Set(Object.values(s.board.hexes).map((h) => h.zone).filter(Boolean))] as string[];
    const foreign = allZones.find((z) => !home.includes(z))!;
    s.phase = { kind: 'main' };
    s = settleWithShip(s, 0, coastalVertexIn(s, foreign, Object.keys(s.board.buildings)));
    expect(s.players[0].bonusVP).toBe(2);
    expect(s.victoryTarget).toBe(13);
  });
});

describe('harbors and robber start positions (rulebook component lists)', () => {
  it('scenarios 1, 3 and 4 use 8 harbors with 3 players and 9 with 4; The Four Islands always 9', () => {
    for (const id of ['seafarers-1-new-shores', 'seafarers-3-fog-islands', 'seafarers-4-through-the-desert']) {
      expect(createGame({ scenario: id, players: 3, seed: 1 }).board.harbors).toHaveLength(8);
      expect(createGame({ scenario: id, players: 4, seed: 1 }).board.harbors).toHaveLength(9);
    }
    for (const n of [3, 4]) {
      const h = createGame({ scenario: 'seafarers-2-four-islands', players: n, seed: 1 }).board.harbors;
      expect(h).toHaveLength(9);
      expect(h.filter((x) => x.type === 'generic')).toHaveLength(4);
    }
  });

  it('The Four Islands and The Fog Islands have no desert: the robber starts on a 12', () => {
    for (const id of ['seafarers-2-four-islands', 'seafarers-3-fog-islands']) {
      for (const seed of [1, 2, 3]) {
        const g = createGame({ scenario: id, players: 4, seed });
        expect(Object.values(g.board.hexes).some((h) => h.terrain === 'desert')).toBe(false);
        expect(g.board.hexes[g.board.robber!].token).toBe(12);
      }
    }
    const four = createGame({ scenario: 'seafarers-2-four-islands', players: 4, seed: 1 });
    expect(Object.values(four.board.hexes).some((h) => h.terrain === 'gold')).toBe(false);
  });

  it('The Pirate Islands use 8 harbors: 5 special and 3 generic', () => {
    const h = createGame({ scenario: 'seafarers-7-pirate-islands', players: 4, seed: 1 }).board.harbors;
    expect(h).toHaveLength(8);
    expect(h.filter((x) => x.type === 'generic')).toHaveLength(3);
  });
});

describe('3 The Fog Islands', () => {
  /** A path for a ship whose ends touch two fog hexes, fed by a ship at one end. */
  function fogSetup() {
    const s = blank('seafarers-3-fog-islands', 3);
    const t = topo(s);
    const fogAt = (v: string) => t.vertexHexes[v].filter((h) => s.board.hexes[h].terrain === 'fog');
    const shipOk = (e: string) => t.edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea');
    let found: { buildEdge: string; feeder: string; fog: string[] } | null = null;
    for (const e of t.edgeIds) {
      if (!shipOk(e)) continue;
      const [va, vb] = t.edgeVertices[e];
      const fog = [...new Set([...fogAt(va), ...fogAt(vb)])].sort();
      if (fog.length !== 2) continue;
      // the feeder ship is placed directly (placing it reveals nothing)
      const feeder = t.vertexEdges[va].find((x) => x !== e && shipOk(x));
      if (feeder) {
        found = { buildEdge: e, feeder, fog };
        break;
      }
    }
    expect(found).not.toBeNull();
    const { buildEdge, feeder, fog } = found!;
    ship(s, feeder, 0);
    give(s, 0, { lumber: 1, wool: 1 });
    return { s, buildEdge, fog };
  }

  it('a ship touching fog reveals it; land gets a number and pays the discoverer', () => {
    let { s, buildEdge, fog: [first, second] } = fogSetup();
    const fog = s.ext.fog as { terrains: string[]; tokens: number[] };
    fog.terrains.push('sea', 'forest');
    fog.tokens.push(5);
    s.ext.fog = fog;
    // any fog touched by the feeder ship was placed directly (no reveal); reveal happens on build,
    // in hex order, each taking the top of the stack
    s = act(s, { type: 'buildShip', player: 0, edge: buildEdge });
    expect(s.board.hexes[first]).toMatchObject({ terrain: 'forest', token: 5 });
    expect(s.board.hexes[second]).toMatchObject({ terrain: 'sea', token: null });
    expect(s.players[0].resources.lumber).toBe(1);
  });

  it('discovering gold gives a free choice', () => {
    let { s, buildEdge } = fogSetup();
    const fog = s.ext.fog as { terrains: string[]; tokens: number[] };
    fog.terrains.push('sea', 'gold');
    fog.tokens.push(9);
    s = act(s, { type: 'buildShip', player: 0, edge: buildEdge });
    expect(s.phase.kind).toBe('gold');
    s = act(s, { type: 'chooseGold', player: 0, resources: { ore: 1 } });
    expect(s.phase.kind).toBe('main');
  });

  it('the fog stack is hidden from players', async () => {
    const { viewFor } = await import('../src/index.js');
    const { s } = fogSetup();
    expect(JSON.stringify(viewFor(s, 0))).not.toMatch(/"terrains"/);
  });
});

describe('4 Through the Desert', () => {
  it('the strip beyond the deserts is foreign land worth 2 VP', () => {
    let s = blank('seafarers-4-through-the-desert', 3);
    const deserts = Object.values(s.board.hexes).filter((h) => h.terrain === 'desert');
    expect(deserts).toHaveLength(3);
    s = settleWithShip(s, 0, coastalVertexIn(s, 'strip'));
    expect(s.players[0].bonusVP).toBe(2);
    s = settleWithShip(s, 0, coastalVertexIn(s, 'home'));
    expect(s.players[0].bonusVP).toBe(2);
  });

  it('starting settlements must be in the home area', () => {
    const s = createGame({ scenario: 'seafarers-4-through-the-desert', players: 3, seed: 1 });
    for (const v of legalSetupSettlements(s, currentSetupPlayer(s)!)) {
      for (const h of topo(s).vertexHexes[v]) {
        const hex = s.board.hexes[h];
        if (hex.terrain !== 'sea') expect(hex.zone).toBe('home');
      }
    }
  });
});

describe('5 The Forgotten Tribe', () => {
  function tribe(gift: 'vp' | 'devCard' | 'harbor') {
    const s = blank('seafarers-5-forgotten-tribe', 3);
    const st = s.ext.tribe as { gifts: Record<string, string> };
    const edge = Object.keys(st.gifts).sort()[0];
    st.gifts[edge] = gift;
    // a feeder ship that touches one end of the gift path
    const t = topo(s);
    const allSea = (e: string) => t.edgeHexes[e].every((h) => s.board.hexes[h].terrain === 'sea');
    const v = t.edgeVertices[edge].find((x) => t.vertexEdges[x].some((e) => e !== edge && allSea(e)))!;
    const feeder = t.vertexEdges[v].find((e) => e !== edge && allSea(e))!;
    ship(s, feeder, 0);
    give(s, 0, { lumber: 1, wool: 1 });
    return { s, edge };
  }

  it('18 gifts: 8 VP chits, 4 development cards set aside from the deck, 6 harbors', () => {
    const s = blank('seafarers-5-forgotten-tribe', 3);
    const st = s.ext.tribe as { gifts: Record<string, string>; giftCards: string[] };
    const kinds = Object.values(st.gifts);
    expect(kinds).toHaveLength(18);
    expect(kinds.filter((k) => k === 'vp')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'devCard')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'harbor')).toHaveLength(6);
    expect(st.giftCards).toHaveLength(4);
    expect(s.devDeck).toHaveLength(21);
  });

  it('the tribe islands cannot be settled', () => {
    const s = blank('seafarers-5-forgotten-tribe', 3);
    const v = coastalVertexIn(s, 'tribe');
    ship(s, shipEdgeAt(s, v), 0);
    give(s, 0, SETTLEMENT);
    fail(s, { type: 'buildSettlement', player: 0, vertex: v }, /may not be settled/);
  });

  it('a ship on a marked path collects a VP chit', () => {
    let { s, edge } = tribe('vp');
    s = act(s, { type: 'buildShip', player: 0, edge });
    expect(s.players[0].bonusVP).toBe(1);
    expect((s.ext.tribe as { gifts: Record<string, string> }).gifts[edge]).toBeUndefined();
  });

  it('a development card gift works like a bought card (not playable this turn)', () => {
    let { s, edge } = tribe('devCard');
    s = act(s, { type: 'buildShip', player: 0, edge });
    expect(s.players[0].devCards).toHaveLength(1);
    expect(s.players[0].devCards[0].boughtPart).toBe(s.turn.part);
  });

  it('a harbor gift must be placed at once next to your coastal settlement when possible', () => {
    let { s, edge } = tribe('harbor');
    s.board.harbors = [];
    const home = coastalVertexIn(s, landZones(s, ['tribe'])[0]);
    put(s, home, 0);
    s = act(s, { type: 'buildShip', player: 0, edge });
    expect(s.phase).toMatchObject({ kind: 'scenario', step: 'placeHarbor', player: 0 });
    fail(s, { type: 'endTurn', player: 0 });
    const moves = legalActions(s, 0);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.type === 'placeHarbor')).toBe(true);
    s = act(s, moves[0]);
    expect(s.phase.kind).toBe('main');
    expect(s.board.harbors).toHaveLength(1);
  });

  it('without a coastal settlement the harbor is set aside for later', () => {
    let { s, edge } = tribe('harbor');
    s = act(s, { type: 'buildShip', player: 0, edge });
    expect(s.phase.kind).toBe('main');
    expect((s.ext.heldHarbors as Record<string, string[]>)[0]).toHaveLength(1);
    s.board.harbors = [];
    const home = coastalVertexIn(s, landZones(s, ['tribe'])[0]);
    put(s, home, 0);
    const spot = legalActions(s, 0).find((a) => a.type === 'placeHarbor')!;
    s = act(s, spot);
    expect(s.board.harbors).toHaveLength(1);
  });

  it('all 6 harbors are gifts (one 2:1 per resource and one 3:1); none are printed on the map', () => {
    const s = blank('seafarers-5-forgotten-tribe', 4);
    expect(s.board.harbors).toHaveLength(0);
    const st = s.ext.tribe as { gifts: Record<string, string>; harborAt: Record<string, string> };
    const types = Object.keys(st.gifts)
      .filter((e) => st.gifts[e] === 'harbor')
      .map((e) => st.harborAt[e])
      .sort();
    expect(types).toEqual(['brick', 'generic', 'grain', 'lumber', 'ore', 'wool']);
  });

  it('a harbor gift gives the harbor lying on that spot', () => {
    let { s, edge } = tribe('harbor');
    (s.ext.tribe as { harborAt: Record<string, string> }).harborAt[edge] = 'ore';
    s = act(s, { type: 'buildShip', player: 0, edge });
    expect((s.ext.heldHarbors as Record<string, string[]>)[0]).toEqual(['ore']);
  });

  it('VP chits and harbors lie face up; development cards stay hidden in player views', () => {
    const s = blank('seafarers-5-forgotten-tribe', 3);
    const v = viewFor(s, 0);
    const spots = (v.ext.tribe as { spots: Record<string, string> }).spots;
    const kinds = Object.values(spots);
    expect(kinds).toHaveLength(18);
    expect(kinds.filter((k) => k === 'vp')).toHaveLength(8);
    expect(kinds.filter((k) => k === 'devCard')).toHaveLength(4);
    expect(kinds.filter((k) => k.startsWith('harbor:'))).toHaveLength(6);
    expect(JSON.stringify(v.ext.tribe)).not.toMatch(/knight|victoryPoint|roadBuilding|yearOfPlenty|monopoly/);
  });

  it('the robber may only move to hexes with a number: never the desert or the tribe islands', () => {
    const s = blank('seafarers-5-forgotten-tribe', 3);
    s.phase = { kind: 'robber', reason: 'knight', resume: { kind: 'main' } };
    // the rulebook's deserts all lie on tribe islands: take a main-island hex without a number
    const main = landZones(s, ['tribe'])[0];
    const [numbered, bare] = Object.keys(s.board.hexes).filter((h) => s.board.hexes[h].zone === main);
    s.board.hexes[bare].token = null;
    const tribeHex = Object.keys(s.board.hexes).find((h) => s.board.hexes[h].zone === 'tribe')!;
    s.board.robber = numbered;
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: bare }, /number/);
    fail(s, { type: 'moveRobber', player: 0, piece: 'robber', hex: tribeHex });
    const robberMoves = legalActions(s, 0).filter((a) => a.type === 'moveRobber' && a.piece === 'robber');
    expect(robberMoves.length).toBeGreaterThan(0);
    for (const m of robberMoves) expect(s.board.hexes[(m as { hex: string }).hex].token).not.toBeNull();
  });
});

describe('6 Cloth Trade', () => {
  type Cloth = { villages: Record<string, { token: number; cloth: number; traders: number[] }>; general: number; cloth: number[] };
  const clothOf = (s: GameState) => s.ext.cloth as Cloth;

  /** A village and a path for ships leading to it that reaches no other village: [feeder, arrival]. */
  function approach(s: GameState, token: number) {
    const t = topo(s);
    const villages = clothOf(s).villages;
    const village = Object.keys(villages).find((v) => villages[v].token === token)!;
    const shipOk = (e: string) => t.edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea');
    const other = (e: string, v: string) => t.edgeVertices[e].find((x) => x !== v)!;
    const arrival = t.vertexEdges[village].find((e) => shipOk(e) && !villages[other(e, village)])!;
    const far = other(arrival, village);
    const feeder = t.vertexEdges[far].find((e) => e !== arrival && shipOk(e) && !villages[other(e, far)])!;
    return { village, arrival, feeder };
  }

  /** The two big islands (the rulebook leaves them untagged). */
  const bigIslands = (s: GameState) => landZones(s, ['isle']);

  it('8 villages on intersections with distinct numbers, 5 cloth each, plus a general supply of 10', () => {
    const s = blank('seafarers-6-cloth-trade', 3);
    const c = clothOf(s);
    const villages = Object.values(c.villages);
    expect(villages).toHaveLength(8);
    expect(new Set(villages.map((v) => v.token)).size).toBe(8);
    expect(villages.every((v) => v.cloth === 5)).toBe(true);
    expect(c.general).toBe(10);
    for (const v of Object.keys(c.villages)) expect(topo(s).vertexEdges[v]).toBeDefined();
  });

  it('three starting settlements; only the third pays starting resources', () => {
    let s = createGame({ scenario: 'seafarers-6-cloth-trade', players: 3, seed: 'c', options: { firstPlayer: 0 } });
    const third: Record<number, string> = {};
    let placed = 0;
    while (s.phase.kind === 'setup') {
      const p = currentSetupPlayer(s)!;
      const round = s.phase.round;
      const v = legalSetupSettlements(s, p)[0];
      s = act(s, { type: 'placeSettlement', player: p, vertex: v });
      if (round < 2) expect(Object.values(s.players[p].resources).reduce((a, b) => a + b, 0)).toBe(0);
      else third[p] = v;
      s = act(s, { type: 'placeRoad', player: p, edge: legalRoads(s, p, v)[0] });
      placed++;
    }
    expect(placed).toBe(9);
    for (const p of [0, 1, 2]) {
      const producing = topo(s).vertexHexes[third[p]].filter((h) =>
        ['hills', 'forest', 'pasture', 'fields', 'mountains'].includes(s.board.hexes[h].terrain),
      ).length;
      expect(Object.values(s.players[p].resources).reduce((a, b) => a + b, 0)).toBe(producing);
      expect(s.players[p].supply.settlements).toBe(2);
    }
  });

  it('reaching a village pays 1 cloth; its number pays 1 more, current player first, then the general supply', () => {
    let s = blank('seafarers-6-cloth-trade', 3);
    const { village, arrival, feeder } = approach(s, 8);
    ship(s, feeder, 0);
    give(s, 0, { lumber: 1, wool: 1 });
    s = act(s, { type: 'buildShip', player: 0, edge: arrival });
    expect(clothOf(s).cloth).toEqual([1, 0, 0]);
    expect(clothOf(s).villages[village]).toMatchObject({ cloth: 4, traders: [0] });
    // another trader arrives (direct placement) and the village runs low
    clothOf(s).villages[village].traders.push(2);
    clothOf(s).villages[village].cloth = 1;
    s.phase = { kind: 'preRoll' };
    s = act(withDice(s, 4, 4), { type: 'rollDice', player: 0 });
    expect(clothOf(s).cloth).toEqual([2, 0, 1]);
    expect(clothOf(s).villages[village].cloth).toBe(0);
    expect(clothOf(s).general).toBe(9);
    clothOf(s).cloth[0] = 5;
    expect(publicVP(s, 0)).toBe(2);
  });

  it('a route linking your settlement to a village is closed: its ships cannot move', () => {
    const s = blank('seafarers-6-cloth-trade', 3);
    const t = topo(s);
    const { village } = approach(s, 8);
    // breadth-first ship path from a big island's coast to the village
    const start = coastalVertexIn(s, bigIslands(s)[0]);
    const prev = new Map<string, [string, string]>();
    const queue = [start];
    const seen = new Set([start]);
    while (queue.length && !seen.has(village)) {
      const v = queue.shift()!;
      for (const e of t.vertexEdges[v]) {
        if (!t.edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea')) continue;
        const w = t.edgeVertices[e].find((x) => x !== v)!;
        if (seen.has(w)) continue;
        seen.add(w);
        prev.set(w, [v, e]);
        queue.push(w);
      }
    }
    const path: string[] = [];
    for (let v = village; v !== start; v = prev.get(v)![0]) path.push(prev.get(v)![1]);
    ship(s, path, 0);
    s.turn.part++;
    // without a settlement at the start, the ship at the open end may move
    expect(movableShips(s, 0)).toHaveLength(1);
    put(s, start, 0);
    expect(movableShips(s, 0)).toEqual([]);
  });

  it('the pirate moves only after you reach a village, and may steal cloth', () => {
    let s = blank('seafarers-6-cloth-trade', 3);
    const { village, arrival } = approach(s, 8);
    ship(s, arrival, 1);
    clothOf(s).cloth[1] = 2;
    const pirateHex = topo(s).edgeHexes[arrival].find((h) => s.board.hexes[h].terrain === 'sea')!;
    s.phase = { kind: 'robber', reason: 'seven', resume: { kind: 'main' } };
    fail(s, { type: 'moveRobber', player: 0, piece: 'pirate', hex: pirateHex, victim: 1 }, /cannot move the pirate yet/);
    clothOf(s).villages[village].traders.push(0);
    s = act(s, { type: 'moveRobber', player: 0, piece: 'pirate', hex: pirateHex, victim: 1, take: 'cloth' });
    expect(clothOf(s).cloth).toEqual([1, 1, 0]);
  });

  it('settlements on the village islands are forbidden and there is no Longest Trade Route', () => {
    const s = blank('seafarers-6-cloth-trade', 3);
    expect(s.longestRoute.holder).toBeNull();
    const v = topo(s).vertexIds.find(
      (x) => vertexZones(s, x).includes('isle') && !clothOf(s).villages[x] && topo(s).vertexHexes[x].some((h) => s.board.hexes[h].terrain === 'sea'),
    )!;
    ship(s, shipEdgeAt(s, v), 0);
    give(s, 0, SETTLEMENT);
    fail(s, { type: 'buildSettlement', player: 0, vertex: v }, /may not be settled/);
  });

  it('the game ends as soon as fewer than 4 villages have cloth: most VP wins (ties: most cloth)', () => {
    let s = blank('seafarers-6-cloth-trade', 3);
    const ids = Object.keys(clothOf(s).villages);
    for (const id of ids.slice(0, 4)) clothOf(s).villages[id].cloth = 0;
    put(s, coastalVertexIn(s, bigIslands(s)[1]), 2, 'city');
    put(s, coastalVertexIn(s, bigIslands(s)[0]), 1, 'city');
    clothOf(s).cloth[1] = 1;
    give(s, 0, { ore: 8 });
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    expect(s.phase.kind).toBe('main'); // 4 villages still have cloth
    clothOf(s).villages[ids[4]].cloth = 0;
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 1 });
  });
});

describe('7 The Pirate Islands', () => {
  type PI = {
    circuit: string[];
    fleetIndex: number;
    fortresses: Array<{ hex: string; vertex: string; waypoint: string; chits: number; captured: boolean }>;
  };
  const pi = (s: GameState) => s.ext.pirateIslands as PI;

  /** A shortest path for ships from one intersection to another. */
  function shipPath(s: GameState, from: string, to: string): string[] {
    const t = topo(s);
    const prev = new Map<string, [string, string]>();
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length && !seen.has(to)) {
      const v = queue.shift()!;
      for (const e of t.vertexEdges[v]) {
        if (!t.edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea')) continue;
        const w = t.edgeVertices[e].find((x) => x !== v)!;
        if (seen.has(w)) continue;
        seen.add(w);
        prev.set(w, [v, e]);
        queue.push(w);
      }
    }
    const path: string[] = [];
    for (let v = to; v !== from; v = prev.get(v)![0]) path.unshift(prev.get(v)![1]);
    return path;
  }

  /** Sets the fleet so a roll with a lower die of `lower` takes it next to player p's pre-placed settlement. */
  function fleetToward(s: GameState, p: number, lower: number): number {
    const home = Object.keys(s.board.buildings).find((v) => s.board.buildings[v].owner === p)!;
    const st = pi(s);
    const target = st.circuit.findIndex((h) => topo(s).hexVertices[h].includes(home));
    expect(target).toBeGreaterThanOrEqual(0);
    st.fleetIndex = (target - lower + st.circuit.length) % st.circuit.length;
    return target;
  }

  it('each player starts with a pre-placed settlement and ship; the fortress is one of their settlements', () => {
    const s = createGame({ scenario: 'seafarers-7-pirate-islands', players: 3, seed: 1 });
    expect(s.board.robber).toBeNull();
    for (const p of s.players) {
      expect(Object.values(s.board.buildings).filter((b) => b.owner === p.id)).toHaveLength(1);
      expect(Object.values(s.board.pieces).filter((x) => x.owner === p.id && x.type === 'ship')).toHaveLength(1);
      expect(p.supply).toMatchObject({ settlements: 3, ships: 14 });
    }
    expect(s.phase.kind).toBe('setup');
  });

  it('3 players: no VP cards; 4 players: VP cards act as knights', () => {
    const three = createGame({ scenario: 'seafarers-7-pirate-islands', players: 3, seed: 1 });
    expect(three.devDeck).toHaveLength(20);
    expect(three.devDeck).not.toContain('victoryPoint');
    const four = createGame({ scenario: 'seafarers-7-pirate-islands', players: 4, seed: 1 });
    expect(four.devDeck.filter((c) => c === 'knight')).toHaveLength(19);
    expect(four.devDeck).not.toContain('victoryPoint');
  });

  it('the fleet sails by the lower die and attacks alone-standing settlements with that strength', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    // the fleet sails 2 to a hex next to player 2's pre-placed settlement
    const target = fleetToward(s, 2, 2);
    give(s, 2, { ore: 1, wool: 1 });
    s.phase = { kind: 'preRoll' };
    s = act(withDice(s, 2, 4), { type: 'rollDice', player: 0 });
    expect(s.board.pirate).toBe(pi(s).circuit[target]);
    expect(Object.values(s.players[2].resources).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('a stronger player fleet earns a free resource; every player next to the fleet is attacked', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    const target = fleetToward(s, 2, 2);
    const p2ship = Object.keys(s.board.pieces).find((e) => s.board.pieces[e].owner === 2)!;
    s.board.pieces[p2ship].warship = true;
    s.board.pieces[p2ship] = { ...s.board.pieces[p2ship] };
    const t = topo(s);
    const extra = t.edgeIds.filter((e) => t.edgeHexes[e].every((h) => s.board.hexes[h].terrain === 'sea') && !s.board.pieces[e]).slice(0, 2);
    for (const e of extra) s.board.pieces[e] = { owner: 2, type: 'ship', placedPart: 0, warship: true };
    const base = structuredClone(s);
    s.phase = { kind: 'preRoll' };
    s = act(withDice(s, 2, 4), { type: 'rollDice', player: 0 });
    expect(s.phase).toMatchObject({ kind: 'gold', pending: { 2: 1 } });
    // a second player next to the fleet is attacked too: without warships they lose a card
    const other = t.hexVertices[pi(base).circuit[target]].find(
      (v) => !base.board.buildings[v] && t.vertexHexes[v].some((h) => base.board.hexes[h].zone === 'main'),
    )!;
    put(base, other, 1);
    // no production for them, so only the raid changes their hand
    for (const [v, b] of Object.entries(base.board.buildings)) if (b.owner === 1) for (const h of t.vertexHexes[v]) base.board.hexes[h].token = null;
    give(base, 1, { brick: 1, wool: 1 });
    base.phase = { kind: 'preRoll' };
    const n = act(withDice(base, 2, 4), { type: 'rollDice', player: 0 });
    expect(n.phase).toMatchObject({ kind: 'gold', pending: { 2: 1 } });
    expect(Object.values(n.players[1].resources).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('on a 7 the fleet acts first, then discards, then the roller may rob any player', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    give(s, 1, { brick: 2 });
    s.phase = { kind: 'preRoll' };
    s = act(withDice(s, 2, 5), { type: 'rollDice', player: 0 });
    expect(s.phase).toMatchObject({ kind: 'scenario', step: 'rob', player: 0 });
    fail(s, { type: 'scenario', player: 0, name: 'rob', args: { victim: 2 } }, /no cards/);
    s = act(s, { type: 'scenario', player: 0, name: 'rob', args: { victim: 1 } });
    expect(s.players[0].resources.brick).toBe(1);
    expect(s.phase.kind).toBe('main');
  });

  it('a knight arms the rearmost normal ship of the route', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    const t = topo(s);
    const first = Object.keys(s.board.pieces).find((e) => s.board.pieces[e].owner === 0)!;
    const tip = t.edgeVertices[first].find((v) => !s.board.buildings[v])!;
    const next = t.vertexEdges[tip].find((e) => e !== first && t.edgeHexes[e].every((h) => s.board.hexes[h].terrain === 'sea'))!;
    ship(s, next, 0);
    s.players[0].devCards = [{ type: 'knight', boughtPart: 0 }];
    s = act(s, { type: 'playKnight', player: 0 });
    expect(s.phase.kind).toBe('main');
    expect(s.board.pieces[first].warship).toBe(true);
    expect(s.board.pieces[next].warship).toBeFalsy();
  });

  it('fortress battles: via the marked intersection; win removes a chit, tie loses 1 ship, defeat loses 2; each ends the turn', () => {
    const setup = () => {
      const s = blank('seafarers-7-pirate-islands', 3);
      const f = pi(s).fortresses[0];
      const pre = Object.keys(s.board.pieces).find((e) => s.board.pieces[e].owner === 0)!;
      delete s.board.pieces[pre];
      s.players[0].supply.ships++;
      // ships from the marked intersection to the fortress
      const route = shipPath(s, f.waypoint, f.vertex);
      expect(route.length).toBeGreaterThanOrEqual(3);
      ship(s, route, 0);
      return { s, route, f };
    };
    // no route through the marked intersection: no attack
    {
      const { s, route } = setup();
      delete s.board.pieces[route[0]];
      fail(s, { type: 'scenario', player: 0, name: 'attackFortress' }, /marked intersection/);
    }
    // defeat: 0 warships vs a 3
    {
      const { s, route } = setup();
      const n = act(withNextDie(s, 3), { type: 'scenario', player: 0, name: 'attackFortress' });
      expect(Object.values(n.board.pieces).filter((x) => x.owner === 0)).toHaveLength(route.length - 2);
      expect(n.turn.current).toBe(1);
    }
    // tie: 1 warship vs a 1
    {
      const { s, route } = setup();
      s.board.pieces[route[0]].warship = true;
      const n = act(withNextDie(s, 1), { type: 'scenario', player: 0, name: 'attackFortress' });
      expect(Object.values(n.board.pieces).filter((x) => x.owner === 0)).toHaveLength(route.length - 1);
    }
    // three victories conquer the fortress, which becomes the player's settlement
    {
      let { s, route, f } = setup();
      for (const e of route) s.board.pieces[e].warship = true;
      for (let i = 0; i < 3; i++) {
        s = act(withNextDie(s, 1), { type: 'scenario', player: 0, name: 'attackFortress' });
        s.turn.current = 0;
        s.turn.actor = 0;
        s.phase = { kind: 'main' };
      }
      expect(pi(s).fortresses[0]).toMatchObject({ chits: 0, captured: true });
      expect(s.board.buildings[f.vertex]).toMatchObject({ owner: 0, type: 'settlement' });
      expect(s.players[0].supply.settlements).toBe(3);
    }
  });

  it('you win with 10 VP only after conquering your fortress, even mid-attack', () => {
    const s = blank('seafarers-7-pirate-islands', 3);
    s.board.harbors = [];
    s.players[0].bonusVP = 12;
    give(s, 0, { ore: 4 });
    expect(act(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } }).phase.kind).toBe('main');
    const f = pi(s).fortresses[0];
    f.chits = 1;
    ship(s, shipPath(s, f.waypoint, f.vertex), 0);
    for (const x of Object.values(s.board.pieces)) if (x.owner === 0) x.warship = true;
    const n = act(withNextDie(s, 1), { type: 'scenario', player: 0, name: 'attackFortress' });
    expect(n.phase).toMatchObject({ kind: 'gameOver', winner: 0 });
  });

  it('a single unbranched route that starts on the main island', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    const t = topo(s);
    const first = Object.keys(s.board.pieces).find((e) => s.board.pieces[e].owner === 0)!;
    const tip = t.edgeVertices[first].find((v) => !s.board.buildings[v])!;
    const onward = t.vertexEdges[tip].filter((e) => e !== first && t.edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea'));
    expect(onward.length).toBe(2);
    give(s, 0, { lumber: 2, wool: 2 });
    s.board.pirate = null;
    const legal = legalShips(s, 0);
    const next = onward.find((e) => legal.includes(e))!;
    expect(next).toBeDefined();
    s = act(s, { type: 'buildShip', player: 0, edge: next });
    fail(s, { type: 'buildShip', player: 0, edge: onward.find((e) => e !== next)! }, /branch/);
  });

  it('the route takes a shortest path to the marked intersection, then to the fortress, and ends there', () => {
    const s = blank('seafarers-7-pirate-islands', 3);
    const t = topo(s);
    s.board.pirate = null;
    give(s, 0, { lumber: 5, wool: 5 });
    // every legal ship extends the route one step closer; following them reaches the fortress
    let cur = s;
    const f = pi(cur).fortresses[0];
    for (let i = 0; i < 40; i++) {
      const legal = legalShips(cur, 0);
      if (legal.length === 0) break;
      give(cur, 0, { lumber: 1, wool: 1 });
      cur = act(cur, { type: 'buildShip', player: 0, edge: legal[0] });
      cur.turn.part++;
    }
    const mine = Object.keys(cur.board.pieces).filter((e) => cur.board.pieces[e].owner === 0);
    const touches = (v: string) => mine.some((e) => t.edgeVertices[e].includes(v));
    expect(touches(f.waypoint)).toBe(true);
    expect(touches(f.vertex)).toBe(true);
    expect(legalShips(cur, 0)).toHaveLength(0);
    // a detour is refused: from the start, only steps toward the marked intersection are legal
    const start = blank('seafarers-7-pirate-islands', 3);
    start.board.pirate = null;
    give(start, 0, { lumber: 1, wool: 1 });
    const firstShip = Object.keys(start.board.pieces).find((e) => start.board.pieces[e].owner === 0)!;
    const tip = t.edgeVertices[firstShip].find((v) => !start.board.buildings[v])!;
    const options = t.vertexEdges[tip].filter(
      (e) => e !== firstShip && t.edgeHexes[e].some((h) => start.board.hexes[h].terrain === 'sea'),
    );
    const refused = options.filter((e) => !legalShips(start, 0).includes(e));
    for (const e of refused) fail(start, { type: 'buildShip', player: 0, edge: e }, /shortest/);
  });
});

describe('8 The Wonders', () => {
  it('the five wonders: requirements and costs from the wonder cards', () => {
    expect(WONDERS.map((w) => w.id)).toEqual(['theater', 'greatBridge', 'monument', 'greatWall', 'cathedral']);
    for (const w of WONDERS) expect(Object.values(w.cost).reduce((a, b) => a + (b ?? 0), 0)).toBe(5);
  });

  it('claiming marks the card with a ship; four levels (several per turn allowed) win', () => {
    let s = blank('seafarers-8-wonders', 3);
    const theater = WONDERS.find((w) => w.id === 'theater')!;
    fail(s, { type: 'scenario', player: 0, name: 'claimWonder', args: { wonder: 'theater' } }, /requirement/);
    const vs = topo(s).vertexIds.filter((v) => topo(s).vertexHexes[v].every((h) => s.board.hexes[h].zone === 'main'));
    put(s, vs[0], 0, 'city');
    put(s, vs.find((v) => !topo(s).vertexNeighbors[vs[0]].includes(v) && v !== vs[0])!, 0, 'city');
    s = act(s, { type: 'scenario', player: 0, name: 'claimWonder', args: { wonder: 'theater' } });
    expect(s.players[0].supply.ships).toBe(14);
    fail(s, { type: 'scenario', player: 0, name: 'claimWonder', args: { wonder: 'cathedral' } }, /already/);
    for (let level = 1; level <= 4; level++) {
      give(s, 0, theater.cost);
      s = act(s, { type: 'scenario', player: 0, name: 'buildWonder' });
      if (level < 4) expect(s.phase.kind).toBe('main');
    }
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 0, reason: 'completed a wonder' });
  });

  it('Great Wall needs a settlement at the wasteland and Great Bridge one at the strait; neither is open at setup', () => {
    const s = blank('seafarers-8-wonders', 3);
    const wall = wastelandVertices(s)[0];
    const bridge = straitVertices(s)[0];
    expect(wall).toBeDefined();
    expect(bridge).toBeDefined();
    // closed at setup, on the rulebook's map and on generated ones
    for (const g of [s, createGame({ scenario: 'seafarers-8-wonders', players: 3, seed: 2, options: { layout: 'random' } })]) {
      const legal = legalSetupSettlements(g, 0);
      const closed = [...wastelandVertices(g), ...straitVertices(g), ...straitVertices(g).flatMap((v) => topo(g).vertexNeighbors[v])];
      expect(closed.length).toBeGreaterThan(7);
      for (const v of closed) expect(legal).not.toContain(v);
      for (const v of legal) expect(vertexZones(g, v)).toEqual(['main']);
    }
    const wallDef = WONDERS.find((w) => w.id === 'greatWall')!;
    const bridgeDef = WONDERS.find((w) => w.id === 'greatBridge')!;
    expect(wallDef.eligible(s, 0)).toBe(false);
    put(s, wall, 0);
    expect(wallDef.eligible(s, 0)).toBe(true);
    put(s, bridge, 1);
    expect(bridgeDef.eligible(s, 1)).toBe(true);
    s.board.buildings[bridge] = { owner: 1, type: 'city' };
    expect(bridgeDef.eligible(s, 1)).toBe(false); // it must be a settlement
  });

  it('Monument: a city at a harbor and a trade route of 5; Cathedral: a city and 6 VP', () => {
    const s = blank('seafarers-8-wonders', 3);
    const monument = WONDERS.find((w) => w.id === 'monument')!;
    const cathedral = WONDERS.find((w) => w.id === 'cathedral')!;
    const t = topo(s);
    const harborCorner = t.edgeVertices[s.board.harbors[0].edge][0];
    put(s, harborCorner, 0, 'city');
    expect(monument.eligible(s, 0)).toBe(false);
    s.longestRoute.holder = null;
    // a 5-long road trail starting at the city
    let v = harborCorner;
    const trailEdges: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = t.vertexEdges[v].find((x) => !trailEdges.includes(x) && t.edgeHexes[x].some((h) => isLandHex(s, h)))!;
      trailEdges.push(e);
      v = t.edgeVertices[e].find((x) => x !== v)!;
    }
    road(s, trailEdges, 0);
    expect(monument.eligible(s, 0)).toBe(true);
    expect(cathedral.eligible(s, 0)).toBe(false);
    s.players[0].bonusVP = 4;
    expect(cathedral.eligible(s, 0)).toBe(true);
  });

  it('your first settlement on each small island earns 1 VP', () => {
    let s = blank('seafarers-8-wonders', 3);
    const islands = [...new Set(Object.values(s.board.hexes).map((h) => h.zone))].filter(
      (z): z is string => !!z && z.startsWith('island-'),
    );
    expect(islands.length).toBeGreaterThanOrEqual(2);
    s = settleWithShip(s, 0, coastalVertexIn(s, islands[0]));
    expect(s.players[0].bonusVP).toBe(1);
    s = settleWithShip(s, 0, coastalVertexIn(s, 'main', Object.keys(s.board.buildings)));
    expect(s.players[0].bonusVP).toBe(1);
  });

  it('10 VP wins only with the strictly highest wonder level', () => {
    const s = blank('seafarers-8-wonders', 3);
    const w = s.ext.wonders as { levels: number[] };
    s.players[0].bonusVP = 10;
    give(s, 0, { ore: 4 });
    const trade = { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } } as const;
    expect(act(s, trade).phase.kind).toBe('main');
    w.levels[0] = 1;
    w.levels[1] = 1;
    expect(act(s, trade).phase.kind).toBe('main');
    w.levels[0] = 2;
    expect(act(s, trade).phase).toMatchObject({ kind: 'gameOver', winner: 0 });
  });
});

describe('9 New World', () => {
  it('players place the harbors first, then start anywhere; first settlement on each other island earns 1 VP', () => {
    let s = createGame({ scenario: 'seafarers-9-new-world', players: 3, seed: 'nw', options: { firstPlayer: 0 } });
    expect(s.phase.kind).toBe('harborPlacement');
    let placed = 0;
    while (s.phase.kind === 'harborPlacement') {
      const p = s.phase.queue[0];
      expect(p).toBe(placed % 3);
      s = act(s, legalActions(s, p)[0]);
      placed++;
    }
    expect(placed).toBe(9);
    expect(s.board.harbors).toHaveLength(9);
    expect(s.phase.kind).toBe('setup');
    while (s.phase.kind === 'setup' || s.phase.kind === 'gold') {
      if (s.phase.kind === 'gold') {
        const p = Number(Object.keys(s.phase.pending)[0]);
        s = act(s, { type: 'chooseGold', player: p, resources: { ore: s.phase.pending[p] } });
        continue;
      }
      const p = currentSetupPlayer(s)!;
      const v = legalSetupSettlements(s, p)[0];
      s = act(s, { type: 'placeSettlement', player: p, vertex: v });
      if (s.phase.kind === 'gold') continue;
      s = act(s, { type: 'placeRoad', player: p, edge: legalRoads(s, p, v)[0] });
    }
    expect(s.phase.kind).toBe('preRoll');
    s.phase = { kind: 'main' };
    const home = s.players[0].homeZones;
    const other = [...new Set(Object.values(s.board.hexes).map((h) => h.zone).filter(Boolean))].find(
      (z) => !home.includes(z as string),
    ) as string;
    const before = totalVP(s, 0);
    const v = coastalVertexIn(s, other, Object.keys(s.board.buildings));
    expect(v).toBeDefined();
    s = settleWithShip(s, 0, v);
    expect(totalVP(s, 0)).toBe(before + 2);
  });

  it('components follow the rulebooks: no desert or gold with 3-4 players; robber and pirate start off the board', () => {
    for (const [n, land, harbors] of [
      [3, 23, 9],
      [4, 23, 9],
      [5, 42, 11],
      [6, 42, 11],
    ] as const) {
      const g = createGame({ scenario: 'seafarers-9-new-world', players: n, seed: `c${n}` });
      const hexes = Object.values(g.board.hexes).filter((h) => h.terrain !== 'sea');
      expect(hexes).toHaveLength(land);
      expect(g.board.robber).toBeNull();
      expect(g.board.pirate).toBeNull();
      expect((g.ext.harborPool as string[]).length).toBe(harbors);
      const producing = hexes.filter((h) => h.terrain !== 'desert');
      expect(producing.every((h) => h.token !== null)).toBe(true);
      if (n <= 4) expect(hexes.some((h) => h.terrain === 'desert' || h.terrain === 'gold')).toBe(false);
    }
  });
});
