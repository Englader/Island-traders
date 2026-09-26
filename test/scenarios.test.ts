import { describe, expect, it } from 'vitest';
import {
  createGame,
  currentSetupPlayer,
  legalActions,
  legalRoads,
  legalSetupSettlements,
  publicVP,
  topo,
  totalVP,
  type EdgeId,
  type GameState,
  type HexId,
  type VertexId,
} from '../src/index.js';
import { EXHAUSTED_VILLAGES_TO_END } from '../src/scenarios/seafarers/tribes.js';
import { WONDERS } from '../src/scenarios/seafarers/wonders.js';
import { act, blank, fail, give, put, ship, withDice } from './helpers.js';

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

describe('3 The Fog Islands', () => {
  function fogSetup() {
    const s = blank('seafarers-3-fog-islands', 3);
    // sea hexes (3,3) and (4,3) lie between fog hexes (4,2) and (3,4)
    expect(s.board.hexes['4,2'].terrain).toBe('fog');
    expect(s.board.hexes['3,4'].terrain).toBe('fog');
    const t = topo(s);
    const buildEdge = '3,3|4,3';
    const [va] = t.edgeVertices[buildEdge];
    const feeder = t.vertexEdges[va].find((e) => e !== buildEdge && t.edgeHexes[e].includes('3,3'))!;
    ship(s, feeder, 0);
    give(s, 0, { lumber: 1, wool: 1 });
    return { s, buildEdge };
  }

  it('a ship touching fog reveals it; land gets a number and pays the discoverer', () => {
    let { s, buildEdge } = fogSetup();
    const fog = s.ext.fog as { terrains: string[]; tokens: number[] };
    fog.terrains.push('sea', 'forest');
    fog.tokens.push(5);
    s.ext.fog = fog;
    // any fog touched by the feeder ship was placed directly (no reveal); reveal happens on build
    s = act(s, { type: 'buildShip', player: 0, edge: buildEdge });
    expect(s.board.hexes['3,4']).toMatchObject({ terrain: 'forest', token: 5 });
    expect(s.board.hexes['4,2']).toMatchObject({ terrain: 'sea', token: null });
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
    const v = t.edgeVertices[edge].find((x) => t.vertexEdges[x].some((e) => e !== edge && t.edgeHexes[e].every((h) => s.board.hexes[h].terrain === 'sea')))!;
    const feeder = t.vertexEdges[v].find((e) => e !== edge && t.edgeHexes[e].every((h) => s.board.hexes[h].terrain === 'sea'))!;
    ship(s, feeder, 0);
    give(s, 0, { lumber: 1, wool: 1 });
    return { s, edge };
  }

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

  it('a development card gift cannot be played this turn', () => {
    let { s, edge } = tribe('devCard');
    s = act(s, { type: 'buildShip', player: 0, edge });
    expect(s.players[0].devCards).toHaveLength(1);
    expect(s.players[0].devCards[0].boughtPart).toBe(s.turn.part);
  });

  it('a harbor gift is placed next to your own coastal settlement', () => {
    let { s, edge } = tribe('harbor');
    s = act(s, { type: 'buildShip', player: 0, edge });
    const held = (s.ext.heldHarbors as Record<string, string[]>)[0];
    expect(held).toHaveLength(1);
    const home = coastalVertexIn(s, 'main');
    const t = topo(s);
    const coastEdge = t.vertexEdges[home].find((e) => {
      const kinds = t.edgeHexes[e].map((h) => s.board.hexes[h].terrain);
      return kinds.includes('sea') && kinds.some((k) => k !== 'sea' && k !== 'desert');
    })!;
    fail(s, { type: 'placeHarbor', player: 0, edge: coastEdge }, /your own settlement|another harbor/);
    put(s, home, 0);
    s.board.harbors = [];
    s = act(s, { type: 'placeHarbor', player: 0, edge: coastEdge });
    expect(s.board.harbors).toHaveLength(1);
    expect((s.ext.heldHarbors as Record<string, string[]>)[0]).toHaveLength(0);
  });

  it('gift identities are hidden in player views', async () => {
    const { viewFor } = await import('../src/index.js');
    const s = blank('seafarers-5-forgotten-tribe', 3);
    const v = viewFor(s, 0);
    expect(v.ext.tribe).toMatchObject({ giftSpots: expect.any(Array) });
    expect(JSON.stringify(v.ext.tribe)).not.toMatch(/devCard|"vp"/);
  });
});

describe('6 Cloth for Catan', () => {
  function village(s: GameState, token: number): HexId {
    return Object.keys(s.board.hexes).find((h) => s.board.hexes[h].zone === 'village' && s.board.hexes[h].token === token)!;
  }

  it('three starting settlements', () => {
    let s = createGame({ scenario: 'seafarers-6-cloth-for-catan', players: 3, seed: 'c', options: { firstPlayer: 0 } });
    let placed = 0;
    while (s.phase.kind === 'setup' || s.phase.kind === 'gold') {
      if (s.phase.kind === 'gold') {
        const p = Number(Object.keys(s.phase.pending)[0]);
        s = act(s, { type: 'chooseGold', player: p, resources: { ore: s.phase.pending[p] } });
        continue;
      }
      const p = currentSetupPlayer(s)!;
      const v = legalSetupSettlements(s, p)[0];
      s = act(s, { type: 'placeSettlement', player: p, vertex: v });
      s = act(s, { type: 'placeRoad', player: p, edge: legalRoads(s, p, v)[0] });
      placed++;
    }
    expect(placed).toBe(9);
    expect(s.players.every((p) => p.supply.settlements === 2)).toBe(true);
  });

  it('a ship on a village coast earns cloth when its number rolls; 2 cloth = 1 VP', () => {
    let s = blank('seafarers-6-cloth-for-catan', 3);
    const v = village(s, 8);
    const coast = topo(s).hexEdges[v][0];
    ship(s, coast, 1);
    s.phase = { kind: 'preRoll' };
    s = act(withDice(s, 4, 4), { type: 'rollDice', player: 0 });
    const cloth = s.ext.cloth as { villages: Record<string, number>; cloth: number[] };
    expect(cloth.cloth).toEqual([0, 1, 0]);
    expect(cloth.villages[v]).toBe(4);
    cloth.cloth[1] = 5;
    expect(publicVP(s, 1)).toBe(2);
  });

  it('settlements on villages are forbidden and there is no Longest Trade Route', () => {
    const s = blank('seafarers-6-cloth-for-catan', 3);
    expect(s.longestRoute.holder).toBeNull();
    const v = coastalVertexIn(s, 'village');
    ship(s, shipEdgeAt(s, v), 0);
    give(s, 0, SETTLEMENT);
    fail(s, { type: 'buildSettlement', player: 0, vertex: v }, /may not be settled/);
  });

  it('the game ends when enough villages run dry: most VP wins', () => {
    let s = blank('seafarers-6-cloth-for-catan', 3);
    const cloth = s.ext.cloth as { villages: Record<string, number>; cloth: number[] };
    const ids = Object.keys(cloth.villages);
    for (let i = 0; i < EXHAUSTED_VILLAGES_TO_END - 1; i++) cloth.villages[ids[i]] = 0;
    put(s, coastalVertexIn(s, 'east'), 2, 'city');
    give(s, 0, { ore: 4 });
    s = act(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    expect(s.phase.kind).toBe('main');
    (s.ext.cloth as typeof cloth).villages[ids[EXHAUSTED_VILLAGES_TO_END - 1]] = 0;
    s = act(s, { type: 'endTurn', player: 0 });
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 2 });
  });
});

describe('7 The Pirate Islands', () => {
  function pi(s: GameState) {
    return s.ext.pirateIslands as {
      circuit: string[];
      fleetIndex: number;
      fortresses: Array<{ hex: string; vertex: string; strength: number; captured: boolean }>;
    };
  }

  it('no robber: a 7 only triggers discards; the fleet moves by the lower die', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    expect(s.board.robber).toBeNull();
    s.phase = { kind: 'preRoll' };
    s = act(withDice(s, 3, 4), { type: 'rollDice', player: 0 });
    expect(s.phase.kind).toBe('main');
    expect(pi(s).fleetIndex).toBe(3);
    expect(s.board.pirate).toBe(pi(s).circuit[3]);
  });

  it('the fleet raids settlements next to it unless their warships outnumber its strength', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    const target = pi(s).circuit[2];
    const v = topo(s).hexVertices[target].find((x) => topo(s).vertexHexes[x].some((h) => s.board.hexes[h].zone === 'main'))!;
    put(s, v, 1);
    give(s, 1, { ore: 2 });
    s.phase = { kind: 'preRoll' };
    s = act(withDice(s, 2, 5), { type: 'rollDice', player: 0 }); // moves 2, strength 5
    expect(s.board.pirate).toBe(target);
    expect(s.players[1].resources.ore).toBe(1);
  });

  it('knights make warships; the fortress falls after three won battles; you win only with your fortress', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    const f = pi(s).fortresses[0];
    // a ship touching the fortress
    const t = topo(s);
    const e = t.vertexEdges[f.vertex].find((x) => t.edgeHexes[x].every((h) => s.board.hexes[h].terrain === 'sea'))!;
    ship(s, e, 0);
    s.players[0].devCards = [{ type: 'knight', boughtPart: 0 }];
    s = act(s, { type: 'playKnight', player: 0 });
    expect(s.phase).toMatchObject({ kind: 'scenario', step: 'warship' });
    s = act(s, { type: 'scenario', player: 0, name: 'convertWarship', args: { edge: e } });
    expect(s.board.pieces[e].warship).toBe(true);
    // with seven warships every battle is won (a die never beats 7)
    const seaEdges = t.edgeIds.filter((x) => t.edgeHexes[x].every((h) => s.board.hexes[h].terrain === 'sea') && !s.board.pieces[x]);
    for (const x of seaEdges.slice(0, 6)) s.board.pieces[x] = { owner: 0, type: 'ship', placedPart: 0, warship: true };
    expect(legalActions(s, 0).some((a) => a.type === 'scenario' && a.name === 'attackFortress')).toBe(true);
    for (let round = 0; round < 3; round++) {
      s.turn.part++;
      s = act(s, { type: 'scenario', player: 0, name: 'attackFortress' });
    }
    expect(pi(s).fortresses[0].captured).toBe(true);
    expect(s.board.buildings[f.vertex]).toMatchObject({ owner: 0, type: 'settlement' });
    fail(s, { type: 'scenario', player: 0, name: 'attackFortress' }, /already captured/);
  });

  it('10 VP without the fortress is not a win', () => {
    const s = blank('seafarers-7-pirate-islands', 3);
    s.players[0].bonusVP = 12;
    give(s, 0, { ore: 4 });
    const next = act(s, { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } });
    expect(next.phase.kind).toBe('main');
  });

  it('a single unbranched trade route', () => {
    let s = blank('seafarers-7-pirate-islands', 3);
    const v = coastalVertexIn(s, 'main');
    put(s, v, 0);
    const t = topo(s);
    const first = shipEdgeAt(s, v);
    ship(s, first, 0);
    const w = t.edgeVertices[first].find((x) => x !== v)!;
    const onward = t.vertexEdges[w].filter((e) => e !== first && t.edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea'));
    expect(onward.length).toBe(2);
    give(s, 0, { lumber: 2, wool: 2 });
    s = act(s, { type: 'buildShip', player: 0, edge: onward[0] });
    fail(s, { type: 'buildShip', player: 0, edge: onward[1] }, /branch/);
    // a second route from elsewhere is not allowed either
    const busy = Object.keys(s.board.pieces).flatMap((e) => t.edgeVertices[e]);
    const v2 = coastalVertexIn(s, 'main', [v, ...busy]);
    put(s, v2, 0);
    fail(s, { type: 'buildShip', player: 0, edge: shipEdgeAt(s, v2) }, /single trade route/);
  });
});

describe('8 The Wonders of Catan', () => {
  it('claim a wonder once its requirement is met; finishing all four levels wins', () => {
    let s = blank('seafarers-8-wonders', 3);
    const colossus = WONDERS.find((w) => w.id === 'colossus')!;
    fail(s, { type: 'scenario', player: 0, name: 'claimWonder', args: { wonder: 'colossus' } }, /requirement/);
    const vs = topo(s).vertexIds.filter((v) => topo(s).vertexHexes[v].every((h) => s.board.hexes[h].zone === 'main'));
    put(s, vs[0], 0, 'city');
    put(s, vs.find((v) => !topo(s).vertexNeighbors[vs[0]].includes(v) && v !== vs[0])!, 0, 'city');
    s = act(s, { type: 'scenario', player: 0, name: 'claimWonder', args: { wonder: 'colossus' } });
    fail(s, { type: 'scenario', player: 0, name: 'claimWonder', args: { wonder: 'greatLibrary' } }, /already/);
    for (let level = 1; level <= 4; level++) {
      give(s, 0, colossus.cost);
      s = act(s, { type: 'scenario', player: 0, name: 'buildWonder' });
      if (level < 4) expect(s.phase.kind).toBe('main');
    }
    expect(s.phase).toMatchObject({ kind: 'gameOver', winner: 0, reason: 'completed a wonder' });
  });

  it('10 VP wins only with the strictly highest wonder level', () => {
    const s = blank('seafarers-8-wonders', 3);
    const w = s.ext.wonders as { levels: number[] };
    s.players[0].bonusVP = 10;
    give(s, 0, { ore: 4 });
    const trade = { type: 'bankTrade', player: 0, give: { ore: 4 }, get: { wool: 1 } } as const;
    expect(act(s, trade).phase.kind).toBe('main'); // no wonder yet
    w.levels[0] = 1;
    w.levels[1] = 1;
    expect(act(s, trade).phase.kind).toBe('main'); // tied
    w.levels[0] = 2;
    expect(act(s, trade).phase).toMatchObject({ kind: 'gameOver', winner: 0 });
  });
});

describe('9 New World', () => {
  it('players place the harbors after the starting placement; first settlement on each other island earns 1 VP', () => {
    let s = createGame({ scenario: 'seafarers-9-new-world', players: 3, seed: 'nw', options: { firstPlayer: 0 } });
    expect(s.board.harbors).toHaveLength(0);
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
    expect(s.phase.kind).toBe('harborPlacement');
    let placed = 0;
    while (s.phase.kind === 'harborPlacement') {
      const p = s.phase.queue[0];
      const a = legalActions(s, p)[0];
      s = act(s, a);
      placed++;
    }
    expect(placed).toBe(10);
    expect(s.board.harbors).toHaveLength(10);
    expect(s.phase.kind).toBe('preRoll');
    // island bonus
    s.phase = { kind: 'main' };
    const home = s.players[0].homeZones;
    const other = [...new Set(Object.values(s.board.hexes).map((h) => h.zone).filter(Boolean))].find((z) => !home.includes(z as string)) as string;
    const before = totalVP(s, 0);
    const v = coastalVertexIn(s, other, Object.keys(s.board.buildings));
    expect(v).toBeDefined();
    s = settleWithShip(s, 0, v);
    expect(totalVP(s, 0)).toBe(before + 2);
  });
});
