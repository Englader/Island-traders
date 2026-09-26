import { isProducing } from '../../board/mapSpec.js';
import { BANK_5_6, BANK_BASE, DEV_DECK_5_6, DEV_DECK_BASE, HARBORS_BASE, TERRAIN_RESOURCE } from '../../core/constants.js';
import type { EdgeId, GameState, HarborType, PlayerId, Terrain } from '../../core/types.js';
import { addGoldChoice, log, nameOf, payFromBank } from '../../rules/helpers.js';
import { topo } from '../../rules/queries.js';
import type { ScenarioDef } from '../types.js';

/** Multiset difference: `all` minus one occurrence of each item of `remove`. */
export function withoutTokens(all: readonly number[], remove: readonly number[]): number[] {
  const out = [...all];
  for (const t of remove) {
    const i = out.indexOf(t);
    if (i < 0) throw new Error(`token ${t} not available`);
    out.splice(i, 1);
  }
  return out;
}

export const seafarersSupply: Pick<ScenarioDef, 'bankSize' | 'devDeck'> = {
  bankSize: (n) => (n >= 5 ? BANK_5_6 : BANK_BASE),
  devDeck: (n) => (n >= 5 ? DEV_DECK_5_6 : DEV_DECK_BASE),
};

/**
 * Harbor tokens of scenarios 1-4: the five special 2:1 harbors plus four
 * generic 3:1 harbors, or three generic ones with 3 players.
 */
export function seafarersHarbors(players: number): HarborType[] {
  const pool = [...HARBORS_BASE];
  if (players <= 3) pool.splice(pool.indexOf('generic'), 1);
  return pool;
}

interface FogStack {
  terrains: Terrain[];
  tokens: number[];
}

/**
 * The Fog Islands: placing a road or ship that reaches an intersection of an
 * unexplored hex turns it over. Land gets a random number token and pays the
 * discoverer one card of its type (gold: one card of their choice).
 */
export function revealFogAround(state: GameState, player: PlayerId, edge: EdgeId): void {
  revealFogAt(state, player, topo(state).edgeVertices[edge]);
}

export function revealFogAt(state: GameState, player: PlayerId, vertices: readonly string[]): void {
  const fog = state.ext.fog as FogStack | undefined;
  if (!fog) return;
  const t = topo(state);
  const touched = new Set<string>();
  for (const v of vertices) {
    for (const h of t.vertexHexes[v]) if (state.board.hexes[h].terrain === 'fog') touched.add(h);
  }
  for (const h of [...touched].sort()) {
    const hex = state.board.hexes[h];
    const terrain = fog.terrains.pop() ?? 'sea';
    hex.terrain = terrain;
    hex.zone = terrain === 'sea' ? null : 'discovered';
    if (isProducing(terrain)) hex.token = fog.tokens.pop() ?? null;
    log(state, `${nameOf(state, player)} discovers ${terrain}${hex.token ? ` (${hex.token})` : ''}`);
    const res = TERRAIN_RESOURCE[terrain];
    if (res) {
      const got = payFromBank(state, player, { [res]: 1 });
      if (got[res]) log(state, `${nameOf(state, player)} takes 1 ${res} for the discovery`);
    } else if (terrain === 'gold') {
      addGoldChoice(state, { [player]: 1 });
    }
  }
}
