import type { EdgeId, GameState, PlayerId, VertexId } from '../core/types.js';
import { scenarioOf } from '../scenarios/registry.js';
import { edgeTouchesHex, ownsBuildingAt, shipError, topo } from './queries.js';

function shipEdgesOf(state: GameState, p: PlayerId): Set<EdgeId> {
  const out = new Set<EdgeId>();
  for (const [e, piece] of Object.entries(state.board.pieces)) {
    if (piece.owner === p && piece.type === 'ship') out.add(e);
  }
  return out;
}

function anchorsOf(state: GameState): Set<VertexId> {
  return new Set(scenarioOf(state).hooks.routeAnchors?.(state) ?? []);
}

/**
 * Where a route of `p` ends: their settlement or city, a scenario anchor (a
 * Cloth village), and in Cities & Knights their knight. A knight must stay
 * connected to its owner's buildings, so a route between a building and a
 * knight is closed (C&K rules p. 13, 2025 p. 12; Seafarers FAQ "When is a
 * ship open?": "or for Cities & Knights also knights").
 */
function routeEnd(state: GameState, p: PlayerId, v: VertexId, anchors: Set<VertexId>): boolean {
  return ownsBuildingAt(state, p, v) || anchors.has(v) || state.ck?.knights[v]?.owner === p;
}

/**
 * Own buildings (and route ends, see routeEnd) reachable from `start` along
 * the player's ships, without using `skip`. A walk stops at the first one it
 * meets (that is where that part of the route ends). Opponent buildings and
 * knights are ignored, so a closed route stays closed even if an opponent
 * later settles along it, or places a knight on it (catan.com).
 */
function buildingsReachable(state: GameState, p: PlayerId, ships: Set<EdgeId>, start: VertexId, skip: EdgeId): Set<VertexId> {
  const t = topo(state);
  const anchors = anchorsOf(state);
  const found = new Set<VertexId>();
  const seen = new Set<VertexId>([start]);
  const stack = [start];
  while (stack.length) {
    const v = stack.pop()!;
    if (routeEnd(state, p, v, anchors)) {
      found.add(v);
      continue;
    }
    for (const e of t.vertexEdges[v]) {
      if (e === skip || !ships.has(e)) continue;
      const [a, b] = t.edgeVertices[e];
      const w = a === v ? b : a;
      if (!seen.has(w)) {
        seen.add(w);
        stack.push(w);
      }
    }
  }
  return found;
}

function connectedWithout(state: GameState, ships: Set<EdgeId>, from: VertexId, to: VertexId, skip: EdgeId): boolean {
  const t = topo(state);
  const seen = new Set<VertexId>([from]);
  const stack = [from];
  while (stack.length) {
    const v = stack.pop()!;
    if (v === to) return true;
    for (const e of t.vertexEdges[v]) {
      if (e === skip || !ships.has(e)) continue;
      const [a, b] = t.edgeVertices[e];
      const w = a === v ? b : a;
      if (!seen.has(w)) {
        seen.add(w);
        stack.push(w);
      }
    }
  }
  return false;
}

/**
 * A route is closed when it links two different settlements/cities of the
 * owner (or one of them and a scenario anchor such as a Cloth village, or in
 * Cities & Knights one of the owner's knights); its ships can never move. A
 * route that leaves and returns to the same settlement counts as open.
 */
export function isShipOnClosedRoute(state: GameState, p: PlayerId, edge: EdgeId): boolean {
  const ships = shipEdgesOf(state, p);
  const [a, b] = topo(state).edgeVertices[edge];
  const fromA = buildingsReachable(state, p, ships, a, edge);
  const fromB = buildingsReachable(state, p, ships, b, edge);
  for (const x of fromA) for (const y of fromB) if (x !== y) return true;
  return false;
}

/**
 * The ship is the end of its route: one end touches none of the player's other
 * ships and no building of theirs, or the ship lies on a loop (a ring, or a
 * line returning to the same settlement), so lifting it strands nothing.
 */
export function isShipAtRouteEnd(state: GameState, p: PlayerId, edge: EdgeId): boolean {
  const t = topo(state);
  const ships = shipEdgesOf(state, p);
  const [a, b] = t.edgeVertices[edge];
  const anchors = anchorsOf(state);
  const freeEnd = (v: VertexId) => !routeEnd(state, p, v, anchors) && t.vertexEdges[v].every((e) => e === edge || !ships.has(e));
  if (freeEnd(a) || freeEnd(b)) return true;
  return connectedWithout(state, ships, a, b, edge);
}

export function moveShipSourceError(state: GameState, p: PlayerId, from: EdgeId): string | null {
  const sc = scenarioOf(state);
  if (!sc.rules.ships || !sc.rules.shipMoves) return 'ships cannot be moved in this scenario';
  const piece = state.board.pieces[from];
  if (!piece || piece.owner !== p || piece.type !== 'ship') return 'you have no ship there';
  if (state.turn.shipMoved) return 'only one ship may be moved per turn';
  if (piece.placedPart === state.turn.part) return 'a ship built this turn cannot be moved';
  if (edgeTouchesHex(state, from, state.board.pirate)) return 'ships next to the pirate cannot move';
  if (isShipOnClosedRoute(state, p, from)) return 'ships on a closed trade route cannot move';
  if (!isShipAtRouteEnd(state, p, from)) return 'only the last ship of an open trade route can move';
  return null;
}

/** Validates a full move: movable source and a destination where a new ship could be built. */
export function moveShipError(state: GameState, p: PlayerId, from: EdgeId, to: EdgeId): string | null {
  const src = moveShipSourceError(state, p, from);
  if (src) return src;
  return shipError(state, p, to, null, from);
}

export function movableShips(state: GameState, p: PlayerId): EdgeId[] {
  const out: EdgeId[] = [];
  for (const [e, piece] of Object.entries(state.board.pieces)) {
    if (piece.owner === p && piece.type === 'ship' && moveShipSourceError(state, p, e) === null) out.push(e);
  }
  return out;
}
