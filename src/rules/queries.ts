import { isLandTerrain } from '../board/mapSpec.js';
import { getTopologyFor, type Topology } from '../board/topology.js';
import { RESOURCES, VP } from '../core/constants.js';
import type { EdgeId, GameState, HexId, PlayerId, Resource, Terrain, VertexId } from '../core/types.js';
import { scenarioOf } from '../scenarios/registry.js';

export function topo(state: GameState): Topology {
  return getTopologyFor(state.board.layoutKey);
}

export function terrainOf(state: GameState, hex: HexId): Terrain | undefined {
  return state.board.hexes[hex]?.terrain;
}

export function isLandHex(state: GameState, hex: HexId): boolean {
  const t = terrainOf(state, hex);
  return t !== undefined && isLandTerrain(t);
}

export function isSeaHex(state: GameState, hex: HexId): boolean {
  return terrainOf(state, hex) === 'sea';
}

export function vertexLandHexes(state: GameState, v: VertexId): HexId[] {
  return (topo(state).vertexHexes[v] ?? []).filter((h) => isLandHex(state, h));
}

export function vertexTouchesLand(state: GameState, v: VertexId): boolean {
  return vertexLandHexes(state, v).length > 0;
}

export function isCoastalVertex(state: GameState, v: VertexId): boolean {
  const hexes = topo(state).vertexHexes[v] ?? [];
  return hexes.some((h) => isLandHex(state, h)) && (hexes.some((h) => isSeaHex(state, h)) || hexes.length < 3);
}

export function vertexZones(state: GameState, v: VertexId): string[] {
  const zones = new Set<string>();
  for (const h of vertexLandHexes(state, v)) {
    const z = state.board.hexes[h].zone;
    if (z) zones.add(z);
  }
  return [...zones];
}

/** Roads need land on at least one side (land-land or coast). */
export function edgeAllowsRoad(state: GameState, e: EdgeId): boolean {
  const hexes = topo(state).edgeHexes[e];
  return !!hexes && hexes.some((h) => isLandHex(state, h));
}

/** Ships need sea on at least one side (sea-sea or coast), never land-land. */
export function edgeAllowsShip(state: GameState, e: EdgeId): boolean {
  const hexes = topo(state).edgeHexes[e];
  return !!hexes && hexes.some((h) => isSeaHex(state, h));
}

export function edgeTouchesHex(state: GameState, e: EdgeId, hex: HexId | null): boolean {
  if (hex === null) return false;
  return topo(state).edgeHexes[e]?.includes(hex) ?? false;
}

export function ownsBuildingAt(state: GameState, p: PlayerId, v: VertexId): boolean {
  return state.board.buildings[v]?.owner === p;
}

export function opponentBuildingAt(state: GameState, p: PlayerId, v: VertexId): boolean {
  const b = state.board.buildings[v];
  return !!b && b.owner !== p;
}

/** Distance rule: the vertex and all adjacent vertices are unoccupied. */
export function distanceRuleOk(state: GameState, v: VertexId): boolean {
  if (state.board.buildings[v]) return false;
  return topo(state).vertexNeighbors[v].every((n) => !state.board.buildings[n] && !isBlockedVertex(state, n));
}

/** Vertices reserved by scenarios (e.g. pirate fortresses) count as occupied. */
export function isBlockedVertex(state: GameState, v: VertexId): boolean {
  const blocked = state.ext.blockedVertices as VertexId[] | undefined;
  return !!blocked && blocked.includes(v);
}

function settlementSiteError(state: GameState, p: PlayerId, v: VertexId, setup: boolean): string | null {
  const t = topo(state);
  if (!t.vertexEdges[v]) return 'no such intersection';
  if (!vertexTouchesLand(state, v)) return 'intersection is not on land';
  if (isBlockedVertex(state, v)) return 'intersection is reserved';
  if (!distanceRuleOk(state, v)) return 'distance rule: intersection or a neighbour is occupied';
  const sc = scenarioOf(state);
  const zones = vertexZones(state, v);
  if (zones.some((z) => sc.rules.forbiddenZones.includes(z))) return 'this area may not be settled';
  if (setup && sc.rules.setupZones && !zones.every((z) => sc.rules.setupZones!.includes(z))) {
    return 'starting settlements must be placed in the starting area';
  }
  const extra = sc.hooks.settlementAllowed?.(state, p, v, setup);
  if (extra) return extra;
  return null;
}

export function setupSettlementError(state: GameState, p: PlayerId, v: VertexId): string | null {
  return settlementSiteError(state, p, v, true);
}

export function settlementError(state: GameState, p: PlayerId, v: VertexId): string | null {
  const err = settlementSiteError(state, p, v, false);
  if (err) return err;
  const touches = topo(state).vertexEdges[v].some((e) => state.board.pieces[e]?.owner === p);
  if (!touches) return 'settlement must connect to your road or ship';
  if (state.players[p].supply.settlements <= 0) return 'no settlements left in supply';
  return null;
}

export function cityError(state: GameState, p: PlayerId, v: VertexId): string | null {
  const b = state.board.buildings[v];
  if (!b || b.owner !== p || b.type !== 'settlement') return 'a city must replace one of your settlements';
  if (state.players[p].supply.cities <= 0) return 'no cities left in supply';
  return null;
}

/** Road connects via an endpoint with your building, or your road where no opponent building sits. */
export function roadConnects(state: GameState, p: PlayerId, e: EdgeId): boolean {
  const t = topo(state);
  for (const v of t.edgeVertices[e]) {
    if (ownsBuildingAt(state, p, v)) return true;
    if (opponentBuildingAt(state, p, v)) continue;
    for (const o of t.vertexEdges[v]) {
      if (o === e) continue;
      const piece = state.board.pieces[o];
      if (piece && piece.owner === p && piece.type === 'road') return true;
    }
  }
  return false;
}

/** Ships connect to your coastal building or to another of your ships (never directly to a road). */
export function shipConnects(state: GameState, p: PlayerId, e: EdgeId, ignore: EdgeId | null = null): boolean {
  const t = topo(state);
  for (const v of t.edgeVertices[e]) {
    if (ownsBuildingAt(state, p, v)) return true;
    if (opponentBuildingAt(state, p, v)) continue;
    for (const o of t.vertexEdges[v]) {
      if (o === e || o === ignore) continue;
      const piece = state.board.pieces[o];
      if (piece && piece.owner === p && piece.type === 'ship') return true;
    }
  }
  return false;
}

export function roadError(state: GameState, p: PlayerId, e: EdgeId, setupVertex: VertexId | null = null): string | null {
  const t = topo(state);
  if (!t.edgeHexes[e]) return 'no such path';
  if (state.board.pieces[e]) return 'path is occupied';
  if (!edgeAllowsRoad(state, e)) return 'roads must be built on land or along a coast';
  if (state.players[p].supply.roads <= 0) return 'no roads left in supply';
  if (setupVertex !== null) {
    if (!t.edgeVertices[e].includes(setupVertex)) return 'starting road must touch the settlement just placed';
    return null;
  }
  if (!roadConnects(state, p, e)) return 'road must connect to your network';
  return null;
}

export function shipError(
  state: GameState,
  p: PlayerId,
  e: EdgeId,
  setupVertex: VertexId | null = null,
  movingFrom: EdgeId | null = null,
): string | null {
  const t = topo(state);
  const sc = scenarioOf(state);
  if (!sc.rules.ships) return 'ships are not used in this scenario';
  if (!t.edgeHexes[e]) return 'no such path';
  if (state.board.pieces[e] && e !== movingFrom) return 'path is occupied';
  if (e === movingFrom) return 'ship must move to a different path';
  if (!edgeAllowsShip(state, e)) return 'ships must be placed on sea or along a coast';
  if (edgeTouchesHex(state, e, state.board.pirate)) return 'ships may not be placed next to the pirate';
  if (movingFrom === null && state.players[p].supply.ships <= 0) return 'no ships left in supply';
  if (setupVertex !== null) {
    if (!t.edgeVertices[e].includes(setupVertex)) return 'starting ship must touch the settlement just placed';
  } else if (!shipConnects(state, p, e, movingFrom)) {
    return 'ship must connect to your coastal settlement, city or ship';
  }
  const extra = sc.hooks.shipAllowed?.(state, p, e, movingFrom);
  if (extra) return extra;
  return null;
}

/** Best maritime rate per resource: 4:1 default, 3:1 generic harbor, 2:1 special harbor. */
export function tradeRates(state: GameState, p: PlayerId): Record<Resource, number> {
  const rates: Record<Resource, number> = { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 };
  const t = topo(state);
  for (const h of state.board.harbors) {
    const [a, b] = t.edgeVertices[h.edge];
    if (!ownsBuildingAt(state, p, a) && !ownsBuildingAt(state, p, b)) continue;
    if (h.type === 'generic') {
      for (const r of RESOURCES) rates[r] = Math.min(rates[r], 3);
    } else {
      rates[h.type] = Math.min(rates[h.type], 2);
    }
  }
  return rates;
}

export function buildingsOf(state: GameState, p: PlayerId): { settlements: VertexId[]; cities: VertexId[] } {
  const settlements: VertexId[] = [];
  const cities: VertexId[] = [];
  for (const [v, b] of Object.entries(state.board.buildings)) {
    if (b.owner !== p) continue;
    (b.type === 'city' ? cities : settlements).push(v);
  }
  return { settlements, cities };
}

/** Victory points visible to everyone (everything except hidden VP cards). */
export function publicVP(state: GameState, p: PlayerId): number {
  const { settlements, cities } = buildingsOf(state, p);
  let vp = settlements.length * VP.settlement + cities.length * VP.city;
  if (state.longestRoute.holder === p) vp += VP.longestRoute;
  if (state.largestArmy.holder === p) vp += VP.largestArmy;
  vp += state.players[p].bonusVP;
  vp += scenarioOf(state).hooks.extraVP?.(state, p) ?? 0;
  return vp;
}

export function hiddenVP(state: GameState, p: PlayerId): number {
  return state.players[p].devCards.filter((c) => c.type === 'victoryPoint').length * VP.vpCard;
}

export function totalVP(state: GameState, p: PlayerId): number {
  return publicVP(state, p) + hiddenVP(state, p);
}

export function handSize(state: GameState, p: PlayerId): number {
  const r = state.players[p].resources;
  return r.brick + r.lumber + r.wool + r.grain + r.ore;
}

// --- robber & pirate -----------------------------------------------------------

function robberHexBasicError(state: GameState, hex: HexId): string | null {
  const sc = scenarioOf(state);
  if (!sc.rules.robber) return 'there is no robber in this scenario';
  if (!state.board.hexes[hex]) return 'no such hex';
  if (!isLandHex(state, hex)) return 'the robber must be placed on a land hex';
  if (hex === state.board.robber) return 'the robber must move to a different hex';
  const zone = state.board.hexes[hex].zone;
  if (zone && sc.rules.robberForbiddenZones.includes(zone)) return 'the robber may not enter this area';
  if (sc.rules.robberNeedsToken && state.board.hexes[hex].token === null) {
    return 'the robber may only be moved to a hex with a number';
  }
  return null;
}

function friendlyBlocked(state: GameState, actor: PlayerId, hex: HexId): boolean {
  return robberVictimsAt(state, actor, 'robber', hex).some((p) => publicVP(state, p) <= 2);
}

export function robberHexError(state: GameState, actor: PlayerId, hex: HexId): string | null {
  const basic = robberHexBasicError(state, hex);
  if (basic) return basic;
  if (state.options.friendlyRobber && friendlyBlocked(state, actor, hex)) {
    // Only enforced when some other hex is available.
    const alternative = Object.keys(state.board.hexes).some(
      (h) => robberHexBasicError(state, h) === null && !friendlyBlocked(state, actor, h),
    );
    if (alternative) return 'friendly robber: may not target a player with 2 or fewer points';
  }
  return null;
}

export function pirateHexError(state: GameState, hex: HexId): string | null {
  const sc = scenarioOf(state);
  if (!sc.rules.pirate) return 'there is no pirate in this scenario';
  if (!state.board.hexes[hex]) return 'no such hex';
  if (!isSeaHex(state, hex)) return 'the pirate must be placed on a sea hex';
  if (hex === state.board.pirate) return 'the pirate must move to a different hex';
  return null;
}

/** Opponents who can be robbed: buildings next to the robber hex, ships next to the pirate hex. */
export function robberVictimsAt(state: GameState, actor: PlayerId, piece: 'robber' | 'pirate', hex: HexId): PlayerId[] {
  const t = topo(state);
  const victims = new Set<PlayerId>();
  if (piece === 'robber') {
    for (const v of t.hexVertices[hex] ?? []) {
      const b = state.board.buildings[v];
      if (b && b.owner !== actor) victims.add(b.owner);
    }
  } else {
    for (const e of t.hexEdges[hex] ?? []) {
      const s = state.board.pieces[e];
      if (s && s.type === 'ship' && s.owner !== actor) victims.add(s.owner);
    }
  }
  return [...victims].sort((a, b) => a - b);
}

export function legalRobberMoves(state: GameState, actor: PlayerId): Array<{ piece: 'robber' | 'pirate'; hex: HexId }> {
  const out: Array<{ piece: 'robber' | 'pirate'; hex: HexId }> = [];
  const pirateOk = scenarioOf(state).hooks.canMovePirate?.(state, actor) ?? true;
  for (const hex of Object.keys(state.board.hexes)) {
    if (robberHexError(state, actor, hex) === null) out.push({ piece: 'robber', hex });
    if (pirateOk && pirateHexError(state, hex) === null) out.push({ piece: 'pirate', hex });
  }
  return out;
}
