import { RESOURCES, TERRAIN_RESOURCE } from '../core/constants.js';
import type { GameState, HexId, PlayerId, Resource } from '../core/types.js';
import { log, nameOf } from './helpers.js';
import { topo } from './queries.js';

export interface ProductionResult {
  /** Cards dealt per player. */
  dealt: Record<number, Partial<Record<Resource, number>>>;
  /** Resources nobody received because the bank ran short. */
  shortages: Resource[];
  /** Free choices owed from gold fields. */
  gold: Record<number, number>;
}

/**
 * Resource production for a roll of `roll` (not 7).
 *
 * Every hex showing the number, unless the robber sits on it, pays 1 card per
 * adjacent settlement and 2 per city. Demand is totalled per resource before
 * dealing: if the bank cannot cover a resource, nobody receives it, except
 * when only one player is owed it, who then gets whatever is left. Gold fields
 * pay the same amounts as free choices, resolved afterwards.
 */
export function produce(state: GameState, roll: number, onlyHexes?: HexId[]): ProductionResult {
  const t = topo(state);
  const demand: Record<Resource, Map<PlayerId, number>> = {
    brick: new Map(),
    lumber: new Map(),
    wool: new Map(),
    grain: new Map(),
    ore: new Map(),
  };
  const gold: Record<number, number> = {};
  const hexes = onlyHexes ?? Object.keys(state.board.hexes);
  for (const id of hexes) {
    const hex = state.board.hexes[id];
    if (hex.token !== roll || id === state.board.robber) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res && hex.terrain !== 'gold') continue;
    for (const v of t.hexVertices[id]) {
      const b = state.board.buildings[v];
      if (!b) continue;
      const amount = b.type === 'city' ? 2 : 1;
      if (res) demand[res].set(b.owner, (demand[res].get(b.owner) ?? 0) + amount);
      else gold[b.owner] = (gold[b.owner] ?? 0) + amount;
    }
  }

  const dealt: ProductionResult['dealt'] = {};
  const shortages: Resource[] = [];
  for (const r of RESOURCES) {
    const owed = demand[r];
    if (owed.size === 0) continue;
    let need = 0;
    for (const n of owed.values()) need += n;
    if (need > state.bank[r]) {
      if (owed.size === 1) {
        const [[p, n]] = [...owed.entries()];
        const give = Math.min(n, state.bank[r]);
        if (give > 0) {
          state.bank[r] -= give;
          state.players[p].resources[r] += give;
          (dealt[p] ??= {})[r] = give;
        }
        if (give < n) shortages.push(r);
      } else {
        shortages.push(r);
      }
      continue;
    }
    for (const [p, n] of owed) {
      state.bank[r] -= n;
      state.players[p].resources[r] += n;
      (dealt[p] ??= {})[r] = n;
    }
  }

  for (const [p, got] of Object.entries(dealt)) {
    const parts = Object.entries(got).map(([r, n]) => `${n} ${r}`);
    log(state, `${nameOf(state, Number(p))} receives ${parts.join(', ')}`);
  }
  for (const r of shortages) log(state, `The bank is short of ${r}: it is not paid out`);
  return { dealt, shortages, gold };
}

/** Starting resources: one card per terrain hex adjacent to the vertex (gold handled by caller). */
export function startingResources(state: GameState, p: PlayerId, vertex: string): { gold: number } {
  let gold = 0;
  for (const id of topo(state).vertexHexes[vertex]) {
    const hex = state.board.hexes[id];
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (res) {
      if (state.bank[res] > 0) {
        state.bank[res]--;
        state.players[p].resources[res]++;
      }
    } else if (hex.terrain === 'gold') {
      gold++;
    }
  }
  return { gold };
}
