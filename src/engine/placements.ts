import { ckCityError, isTipped } from '../ck/engine.js';
import type { EdgeId, GameState, PlayerId, VertexId } from '../core/types.js';
import { cityError, roadError, settlementError, setupSettlementError, shipError, topo } from '../rules/queries.js';

export function legalSetupSettlements(s: GameState, p: PlayerId): VertexId[] {
  return topo(s).vertexIds.filter((v) => setupSettlementError(s, p, v) === null);
}

export function legalSettlements(s: GameState, p: PlayerId): VertexId[] {
  if (s.players[p].supply.settlements <= 0) return [];
  return topo(s).vertexIds.filter((v) => settlementError(s, p, v) === null);
}

export function legalCities(s: GameState, p: PlayerId): VertexId[] {
  if (s.ck) {
    // Cities & Knights: a city pillaged onto its side is rebuilt first, with its own piece.
    return Object.keys(s.board.buildings).filter(
      (v) =>
        (isTipped(s, v) ? s.board.buildings[v].owner === p : cityError(s, p, v) === null) && ckCityError(s, p, v) === null,
    );
  }
  return Object.keys(s.board.buildings).filter((v) => cityError(s, p, v) === null);
}

export function legalRoads(s: GameState, p: PlayerId, setupVertex: VertexId | null = null): EdgeId[] {
  if (s.players[p].supply.roads <= 0) return [];
  const t = topo(s);
  const edges = setupVertex ? t.vertexEdges[setupVertex] : t.edgeIds;
  return edges.filter((e) => roadError(s, p, e, setupVertex) === null);
}

export function legalShips(s: GameState, p: PlayerId, setupVertex: VertexId | null = null): EdgeId[] {
  if (s.players[p].supply.ships <= 0) return [];
  const t = topo(s);
  const edges = setupVertex ? t.vertexEdges[setupVertex] : t.edgeIds;
  return edges.filter((e) => shipError(s, p, e, setupVertex) === null);
}

export function legalEdgePlacements(s: GameState, p: PlayerId): Array<{ edge: EdgeId; kind: 'road' | 'ship' }> {
  return [
    ...legalRoads(s, p).map((edge) => ({ edge, kind: 'road' as const })),
    ...legalShips(s, p).map((edge) => ({ edge, kind: 'ship' as const })),
  ];
}
