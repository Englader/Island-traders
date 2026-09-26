import { describe, expect, it } from 'vitest';
import {
  createGame,
  currentSetupPlayer,
  legalRoads,
  legalSetupSettlements,
  setupOrder,
  topo,
  type GameState,
} from '../src/index.js';
import { C, H, act, fail, setHex } from './helpers.js';

function place(s: GameState, vertex: string, edge?: string): GameState {
  const p = currentSetupPlayer(s)!;
  s = act(s, { type: 'placeSettlement', player: p, vertex });
  const e = edge ?? legalRoads(s, p, vertex)[0];
  return act(s, { type: 'placeRoad', player: p, edge: e });
}

describe('setup (snake draft)', () => {
  it('rolls for the starting player unless one is given', () => {
    const s = createGame({ scenario: 'base', players: 4, seed: 'roll' });
    expect(s.log.some((l) => l.msg.includes('rolls'))).toBe(true);
    const fixed = createGame({ scenario: 'base', players: 4, seed: 'roll', options: { firstPlayer: 2 } });
    expect(fixed.firstPlayer).toBe(2);
  });

  it('round 1 clockwise, round 2 counter-clockwise from the last player', () => {
    const s = createGame({ scenario: 'base', players: 4, seed: 1, options: { firstPlayer: 1 } });
    expect(setupOrder(s, 0)).toEqual([1, 2, 3, 0]);
    expect(setupOrder(s, 1)).toEqual([0, 3, 2, 1]);
  });

  it('plays through: second settlement pays one card per adjacent terrain, first player then starts', () => {
    let s = createGame({ scenario: 'base', players: 3, seed: 7, options: { firstPlayer: 0 } });
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      const p = currentSetupPlayer(s)!;
      order.push(p);
      const v = legalSetupSettlements(s, p)[i * 5];
      const before = { ...s.players[p].resources };
      s = act(s, { type: 'placeSettlement', player: p, vertex: v });
      const gained = Object.values(s.players[p].resources).reduce((a, b) => a + b, 0) - Object.values(before).reduce((a, b) => a + b, 0);
      const producing = topo(s).vertexHexes[v].filter((h) => {
        const t = s.board.hexes[h].terrain;
        return t !== 'sea' && t !== 'desert';
      }).length;
      expect(gained).toBe(i < 3 ? 0 : producing);
      s = act(s, { type: 'placeRoad', player: p, edge: legalRoads(s, p, v)[0] });
    }
    expect(order).toEqual([0, 1, 2, 2, 1, 0]);
    expect(s.phase.kind).toBe('preRoll');
    expect(s.turn.current).toBe(0);
    expect(s.turn.number).toBe(1);
  });

  it('distance rule and the road must touch the new settlement', () => {
    let s = createGame({ scenario: 'base', players: 3, seed: 8, options: { firstPlayer: 0 } });
    s = place(s, C(0, 0, 0));
    // player 1 cannot use an adjacent intersection
    fail(s, { type: 'placeSettlement', player: 1, vertex: C(0, 0, 1) }, /distance/);
    fail(s, { type: 'placeSettlement', player: 0, vertex: C(0, 0, 3) }, /not your turn/);
    s = act(s, { type: 'placeSettlement', player: 1, vertex: C(0, 0, 3) });
    // a road elsewhere is rejected
    const far = topo(s).vertexEdges[C(1, -2, 0)][0];
    fail(s, { type: 'placeRoad', player: 1, edge: far }, /touch/);
  });

  it('second settlement need not connect to the first', () => {
    let s = createGame({ scenario: 'base', players: 3, seed: 9, options: { firstPlayer: 0 } });
    s = place(s, C(0, 0, 0));
    s = place(s, C(2, -2, 4));
    s = place(s, C(-2, 2, 1));
    // round 2: player 2 first, far away from anything
    expect(currentSetupPlayer(s)).toBe(2);
    s = place(s, C(0, 2, 0));
    expect(s.board.buildings[C(0, 2, 0)].owner).toBe(2);
  });

  it('gold next to the second settlement asks for a free choice (configurable)', () => {
    const mk = (setupGoldYield: 'choose' | 'none') => {
      let s = createGame({ scenario: 'base', players: 3, seed: 10, options: { firstPlayer: 0, setupGoldYield } });
      setHex(s, 0, 0, 'gold', 6);
      setHex(s, 1, -1, 'gold', 6);
      setHex(s, 1, 0, 'gold', 6);
      s = place(s, C(-2, 2, 1));
      s = place(s, C(2, -2, 4));
      s = place(s, C(-1, -1, 2));
      s = place(s, C(0, 2, 0));
      s = place(s, C(-2, 0, 3));
      // player 0 places the second settlement where three gold hexes meet (C(0,0,0))
      return act(s, { type: 'placeSettlement', player: 0, vertex: C(0, 0, 0) });
    };
    const choose = mk('choose');
    expect(choose.phase.kind).toBe('gold');
    if (choose.phase.kind === 'gold') expect(choose.phase.pending[0]).toBe(3);
    const after = act(choose, { type: 'chooseGold', player: 0, resources: { ore: 2, wool: 1 } });
    expect(after.players[0].resources.ore).toBe(2);
    expect(after.phase.kind).toBe('setup');
    const none = mk('none');
    expect(none.phase.kind).toBe('setup');
  });
});

describe('seafarers setup', () => {
  it('coastal starting settlement may take a ship instead of a road; restricted zones apply', () => {
    let s = createGame({ scenario: 'seafarers-1-new-shores', players: 3, seed: 11, options: { firstPlayer: 0 } });
    const vertices = legalSetupSettlements(s, 0);
    // all legal starting spots are on the main island
    for (const v of vertices) {
      for (const h of topo(s).vertexHexes[v]) {
        const hex = s.board.hexes[h];
        if (hex.terrain !== 'sea') expect(hex.zone).toBe('main');
      }
    }
    const coastal = vertices.find((v) => topo(s).vertexHexes[v].some((h) => s.board.hexes[h].terrain === 'sea'))!;
    s = act(s, { type: 'placeSettlement', player: 0, vertex: coastal });
    const seaEdge = topo(s).vertexEdges[coastal].find((e) =>
      topo(s).edgeHexes[e].some((h) => s.board.hexes[h].terrain === 'sea'),
    )!;
    s = act(s, { type: 'placeShip', player: 0, edge: seaEdge });
    expect(s.board.pieces[seaEdge].type).toBe('ship');
    expect(s.players[0].supply.ships).toBe(14);
  });

  it('a starting ship may not be placed next to the pirate', () => {
    let s = createGame({ scenario: 'test-sea', players: 2, seed: 12, options: { firstPlayer: 0 } });
    const v = C(2, 1, 1); // north coast of f6
    s.board.pirate = H(2, 0);
    s = act(s, { type: 'placeSettlement', player: 0, vertex: v });
    const next = topo(s).vertexEdges[v].find((e) => topo(s).edgeHexes[e].includes(H(2, 0)))!;
    fail(s, { type: 'placeShip', player: 0, edge: next }, /pirate/);
  });
});
