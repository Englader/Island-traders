import { opponentKnightAt } from '../ck/basics.js';
import { LONGEST_ROUTE_MIN } from '../core/constants.js';
import type { EdgeId, GameState, PlayerId, VertexId } from '../core/types.js';
import { scenarioOf } from '../scenarios/registry.js';
import { ownsBuildingAt, opponentBuildingAt, topo } from './queries.js';

/**
 * Longest single trail (no edge reused) through a player's roads and ships.
 *
 * - Branches do not add up; loops count fully (a 6-road ring is 6).
 * - An opponent's settlement or city (or, in Cities & Knights, knight) cuts
 *   the trail: it may end there but not pass through.
 * - Seafarers: switching between road and ship is only allowed at the player's own building.
 *
 * Depth-first search from every edge in both directions, marking visited edges
 * and un-marking on backtrack (the UVa 539 approach). With at most 30 pieces
 * this is fast.
 */
export function longestRouteLength(state: GameState, p: PlayerId): number {
  const t = topo(state);
  const mine: EdgeId[] = [];
  for (const [e, piece] of Object.entries(state.board.pieces)) if (piece.owner === p) mine.push(e);
  if (mine.length === 0) return 0;
  const mineSet = new Set(mine);
  const visited = new Set<EdgeId>();

  const walk = (edge: EdgeId, from: VertexId): number => {
    const [a, b] = t.edgeVertices[edge];
    const to = a === from ? b : a;
    let best = 0;
    if (!opponentBuildingAt(state, p, to) && !opponentKnightAt(state, p, to)) {
      const kind = state.board.pieces[edge].type;
      const ownHere = ownsBuildingAt(state, p, to);
      for (const next of t.vertexEdges[to]) {
        if (next === edge || visited.has(next) || !mineSet.has(next)) continue;
        if (state.board.pieces[next].type !== kind && !ownHere) continue;
        visited.add(next);
        best = Math.max(best, walk(next, to));
        visited.delete(next);
      }
    }
    return 1 + best;
  };

  let longest = 0;
  for (const e of mine) {
    for (const start of t.edgeVertices[e]) {
      visited.add(e);
      longest = Math.max(longest, walk(e, start));
      visited.delete(e);
    }
  }
  return longest;
}

/**
 * Re-evaluates the Longest Road / Longest Trade Route card after any change
 * that can affect route lengths.
 *
 * - The holder keeps it while still (jointly) longest with at least 5.
 * - Otherwise a unique longest player with at least 5 takes it.
 * - If nobody qualifies, or several non-holders tie for longest, it is set aside.
 */
export function updateLongestRoute(state: GameState): void {
  if (!scenarioOf(state).rules.longestRoute) return;
  const lengths = state.players.map((pl) => longestRouteLength(state, pl.id));
  state.longestRoute.lengths = lengths;
  const holder = state.longestRoute.holder;
  const max = Math.max(...lengths);
  if (holder !== null && lengths[holder] >= LONGEST_ROUTE_MIN && lengths[holder] >= max) return;
  const leaders = lengths.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
  const next = max >= LONGEST_ROUTE_MIN && leaders.length === 1 ? leaders[0] : null;
  if (next !== holder) {
    const label = scenarioOf(state).rules.ships ? 'Longest Trade Route' : 'Longest Road';
    state.log.push({
      turn: state.turn.number,
      msg:
        next === null
          ? `${label} is set aside`
          : `${state.players[next].name} takes ${label} (${lengths[next]})`,
    });
  }
  state.longestRoute.holder = next;
}
