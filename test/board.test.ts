import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SCENARIOS,
  TOKENS_BASE_SPIRAL,
  createGame,
  hexId,
  hexagon,
  isLandHex,
  isRed,
  placeSpiral,
  seedRng,
  spiralOrder,
  topo,
  tokensOk,
  type GameState,
  type HexState,
} from '../src/index.js';

function landVertices(s: GameState) {
  const t = topo(s);
  return t.vertexIds.filter((v) => t.vertexHexes[v].some((h) => isLandHex(s, h)));
}
function landEdges(s: GameState) {
  const t = topo(s);
  return t.edgeIds.filter((e) => t.edgeHexes[e].some((h) => isLandHex(s, h)));
}

describe('board topology', () => {
  it('standard board: 19 hexes, 54 intersections, 72 paths', () => {
    const s = createGame({ scenario: 'base', players: 4, seed: 1 });
    const land = Object.values(s.board.hexes).filter((h) => h.terrain !== 'sea');
    expect(land).toHaveLength(19);
    expect(landVertices(s)).toHaveLength(54);
    expect(landEdges(s)).toHaveLength(72);
  });

  it('standard board has the official terrain mix and 18 tokens (no 7)', () => {
    const s = createGame({ scenario: 'base', players: 4, seed: 2 });
    const count: Record<string, number> = {};
    for (const h of Object.values(s.board.hexes)) count[h.terrain] = (count[h.terrain] ?? 0) + 1;
    expect(count).toMatchObject({ forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3, desert: 1, sea: 18 });
    const tokens = Object.values(s.board.hexes)
      .map((h) => h.token)
      .filter((t): t is number => t !== null)
      .sort((a, b) => a - b);
    expect(tokens).toEqual([...TOKENS_BASE_SPIRAL].sort((a, b) => a - b));
    expect(tokens).not.toContain(7);
    const desert = Object.values(s.board.hexes).find((h) => h.terrain === 'desert')!;
    expect(desert.token).toBeNull();
    expect(s.board.robber).toBe(hexId(desert.q, desert.r));
  });

  it('vertex adjacency: every land vertex has 2-3 neighbours and 1-3 hexes', () => {
    const s = createGame({ scenario: 'base', players: 4, seed: 3 });
    const t = topo(s);
    for (const v of landVertices(s)) {
      expect(t.vertexNeighbors[v].length).toBeGreaterThanOrEqual(2);
      expect(t.vertexNeighbors[v].length).toBeLessThanOrEqual(3);
      const land = t.vertexHexes[v].filter((h) => isLandHex(s, h));
      expect(land.length).toBeGreaterThanOrEqual(1);
      expect(land.length).toBeLessThanOrEqual(3);
    }
    for (const h of Object.keys(s.board.hexes)) {
      if (!isLandHex(s, h)) continue;
      expect(t.hexVertices[h]).toHaveLength(6);
      expect(t.hexEdges[h]).toHaveLength(6);
    }
  });

  it('5-6 board: 30 land hexes, 28 tokens, 11 harbors', () => {
    const s = createGame({ scenario: 'base', players: 6, seed: 4 });
    const land = Object.values(s.board.hexes).filter((h) => h.terrain !== 'sea');
    expect(land).toHaveLength(30);
    expect(land.filter((h) => h.token !== null)).toHaveLength(28);
    expect(s.board.harbors).toHaveLength(11);
    expect(s.bank.ore).toBe(24);
    expect(s.devDeck).toHaveLength(34);
  });
});

describe('number tokens', () => {
  it('the official A-R spiral never puts 6 and 8 next to each other (every desert spot, every start corner)', () => {
    for (const desert of hexagon(2)) {
      for (let corner = 0; corner < 6; corner++) {
        const hexes: Record<string, HexState> = {};
        for (const a of hexagon(2)) {
          const isDesert = a.q === desert.q && a.r === desert.r;
          hexes[hexId(a.q, a.r)] = { q: a.q, r: a.r, terrain: isDesert ? 'desert' : 'fields', token: null, zone: null };
        }
        placeSpiral(hexes, seedRng(1), corner);
        const tokens = Object.values(hexes).map((h) => h.token).filter((t) => t !== null);
        expect(tokens).toHaveLength(18);
        expect(tokensOk(hexes, { noAdjacentRed: true, noAdjacent2and12: false, noAdjacentSameNumber: false })).toBe(true);
      }
    }
  });

  it('spiral visits all 19 hexes once', () => {
    const order = spiralOrder(0).map((a) => hexId(a.q, a.r));
    expect(new Set(order).size).toBe(19);
  });

  it('random placement respects the red-number rule and optional house rules', () => {
    for (let i = 0; i < 30; i++) {
      const s = createGame({
        scenario: 'base',
        players: 4,
        seed: `rand${i}`,
        options: { layout: 'random', tokenPlacement: 'random', noAdjacent2and12: true, noAdjacentSameNumber: true },
      });
      expect(
        tokensOk(s.board.hexes, { noAdjacentRed: true, noAdjacent2and12: true, noAdjacentSameNumber: true }),
      ).toBe(true);
    }
  });

  it('red-number rule can be switched off', () => {
    let sawAdjacentRed = false;
    for (let i = 0; i < 60 && !sawAdjacentRed; i++) {
      const s = createGame({ scenario: 'base', players: 4, seed: `off${i}`, options: { layout: 'random', tokenPlacement: 'random', noAdjacentRed: false } });
      const t = topo(s);
      for (const [id, h] of Object.entries(s.board.hexes)) {
        if (isRed(h.token) && t.hexNeighbors[id].some((n) => isRed(s.board.hexes[n].token))) sawAdjacentRed = true;
      }
    }
    expect(sawAdjacentRed).toBe(true);
  });
});

describe('harbors', () => {
  it('base: 9 harbors (four 3:1, one 2:1 per resource) on coastal paths, never sharing an intersection', () => {
    const s = createGame({ scenario: 'base', players: 3, seed: 5 });
    const types = s.board.harbors.map((h) => h.type).sort();
    expect(types).toEqual(['brick', 'generic', 'generic', 'generic', 'generic', 'grain', 'lumber', 'ore', 'wool']);
    const t = topo(s);
    const used = new Set<string>();
    for (const h of s.board.harbors) {
      const [a, b] = t.edgeHexes[h.edge];
      expect([a, b].filter((x) => isLandHex(s, x))).toHaveLength(1);
      for (const v of t.edgeVertices[h.edge]) {
        expect(used.has(v)).toBe(false);
        used.add(v);
      }
    }
  });
});

describe('every scenario map', () => {
  it('builds valid boards for several seeds, player counts and both layouts', () => {
    for (const layout of ['official', 'random'] as const) {
      for (const sc of BUILT_IN_SCENARIOS) {
        for (let n = sc.minPlayers; n <= sc.maxPlayers; n++) {
          for (let i = 0; i < 3; i++) {
            const s = createGame({ scenario: sc.id, players: n, seed: `${sc.id}-${n}-${i}`, options: { layout } });
            const t = topo(s);
            // land never touches the edge of the map
            for (const [id, h] of Object.entries(s.board.hexes)) {
              if (h.terrain !== 'sea') expect(t.hexNeighbors[id]).toHaveLength(6);
            }
            // harbors are on coasts and never share intersections
            const used = new Set<string>();
            for (const h of s.board.harbors) {
              expect(t.edgeHexes[h.edge].filter((x) => isLandHex(s, x))).toHaveLength(1);
              for (const v of t.edgeVertices[h.edge]) {
                expect(used.has(v)).toBe(false);
                used.add(v);
              }
            }
            // producing land has a token (islands that can never be settled aside); the
            // rulebook's Pirate Islands map leaves the two western hills without a number
            let unnumbered = 0;
            for (const h of Object.values(s.board.hexes)) {
              if (['hills', 'forest', 'pasture', 'fields', 'mountains', 'gold'].includes(h.terrain)) {
                if (!sc.rules.forbiddenZones.includes(h.zone ?? '') && h.token === null) unnumbered++;
              }
              if (h.terrain === 'desert' || h.terrain === 'sea') expect(h.token).toBeNull();
            }
            const expected = layout === 'official' && sc.id === 'seafarers-7-pirate-islands' ? 2 : 0;
            expect(unnumbered, `${layout} ${sc.id} ${n}`).toBe(expected);
            // Seafarers component limits: at most 30 land hexes and 2 gold fields
            if (sc.expansion === 'seafarers' && n <= 4) {
              const land = Object.values(s.board.hexes).filter((h) => !['sea', 'fog'].includes(h.terrain));
              expect(land.length).toBeLessThanOrEqual(30);
              expect(land.filter((h) => h.terrain === 'gold').length).toBeLessThanOrEqual(2);
            }
          }
        }
      }
    }
  });

  it('random New World islands never touch each other', () => {
    for (let i = 0; i < 10; i++) {
      const s = createGame({ scenario: 'seafarers-9-new-world', players: 4, seed: `nw${i}`, options: { layout: 'random' } });
      const t = topo(s);
      for (const [id, h] of Object.entries(s.board.hexes)) {
        if (h.terrain === 'sea') continue;
        for (const n of t.hexNeighbors[id]) {
          const o = s.board.hexes[n];
          if (o.terrain !== 'sea') expect(o.zone).toBe(h.zone);
        }
      }
    }
  });

  it('same seed gives the same board', () => {
    const a = createGame({ scenario: 'seafarers-9-new-world', players: 3, seed: 'same' });
    const b = createGame({ scenario: 'seafarers-9-new-world', players: 3, seed: 'same' });
    expect(a).toEqual(b);
  });
});
