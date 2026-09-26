import { isProducing } from '../../board/mapSpec.js';
import { BANK_5_6, BANK_BASE, DEV_DECK_5_6, DEV_DECK_BASE, TERRAIN_RESOURCE } from '../../core/constants.js';
import type { EdgeId, GameState, PlayerId, Terrain } from '../../core/types.js';
import { addGoldChoice, log, nameOf, payFromBank } from '../../rules/helpers.js';
import { topo } from '../../rules/queries.js';
import type { ScenarioDef } from '../types.js';

export const seafarersSupply: Pick<ScenarioDef, 'bankSize' | 'devDeck'> = {
  bankSize: (n) => (n >= 5 ? BANK_5_6 : BANK_BASE),
  devDeck: (n) => (n >= 5 ? DEV_DECK_5_6 : DEV_DECK_BASE),
};

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
