import type { EdgeId, HexId, VertexId } from '../core/types.js';
import { cornerVertex, hexId, neighbor, parseHexId, sideEdge } from './hex.js';

/**
 * Static adjacency graph of a board layout. Every rule is phrased in terms of
 * hexes, vertices (intersections) and edges (paths), so all of it is
 * precomputed here once per layout.
 *
 * - An edge exists between two adjacent on-board hexes.
 * - A vertex exists if it is the endpoint of at least one edge.
 */
export interface Topology {
  hexIds: HexId[];
  /** Corners of each hex in rotational order (only corners that exist). */
  hexVertices: Record<HexId, VertexId[]>;
  /** Sides of each hex (only sides shared with another on-board hex). */
  hexEdges: Record<HexId, EdgeId[]>;
  hexNeighbors: Record<HexId, HexId[]>;
  vertexHexes: Record<VertexId, HexId[]>; // on-board hexes touching the vertex (1-3)
  vertexNeighbors: Record<VertexId, VertexId[]>;
  vertexEdges: Record<VertexId, EdgeId[]>;
  edgeHexes: Record<EdgeId, [HexId, HexId]>;
  edgeVertices: Record<EdgeId, [VertexId, VertexId]>;
  vertexIds: VertexId[];
  edgeIds: EdgeId[];
}

const cache = new Map<string, Topology>();

export function layoutKeyFor(hexIds: readonly HexId[]): string {
  return [...hexIds].sort().join(';');
}

export function getTopologyFor(layoutKey: string): Topology {
  let t = cache.get(layoutKey);
  if (!t) {
    t = buildTopology(layoutKey.split(';'));
    cache.set(layoutKey, t);
  }
  return t;
}

export function buildTopology(hexIds: readonly HexId[]): Topology {
  const onBoard = new Set(hexIds);
  const hexVertices: Record<HexId, VertexId[]> = {};
  const hexEdges: Record<HexId, EdgeId[]> = {};
  const hexNeighbors: Record<HexId, HexId[]> = {};
  const edgeHexes: Record<EdgeId, [HexId, HexId]> = {};
  const edgeVertices: Record<EdgeId, [VertexId, VertexId]> = {};

  // Edges first: each edge's two endpoints are the corners either side of the side.
  for (const id of hexIds) {
    const h = parseHexId(id);
    hexNeighbors[id] = [];
    for (let i = 0; i < 6; i++) {
      const n = neighbor(h, i);
      const nid = hexId(n.q, n.r);
      if (!onBoard.has(nid)) continue;
      hexNeighbors[id].push(nid);
      const e = sideEdge(h, i);
      if (!edgeHexes[e]) {
        const [a, b] = e.split('|');
        edgeHexes[e] = [a, b];
        // corner i-1 (between dir i-1 and i) and corner i (between dir i and i+1)
        edgeVertices[e] = [cornerVertex(h, i - 1 + 6), cornerVertex(h, i)];
      }
    }
  }

  const vertexEdges: Record<VertexId, EdgeId[]> = {};
  for (const e of Object.keys(edgeVertices)) {
    for (const v of edgeVertices[e]) (vertexEdges[v] ??= []).push(e);
  }

  const vertexHexes: Record<VertexId, HexId[]> = {};
  const vertexNeighbors: Record<VertexId, VertexId[]> = {};
  for (const v of Object.keys(vertexEdges)) {
    vertexHexes[v] = v.split('|').filter((h) => onBoard.has(h));
    vertexNeighbors[v] = vertexEdges[v].map((e) => {
      const [a, b] = edgeVertices[e];
      return a === v ? b : a;
    });
  }

  for (const id of hexIds) {
    const h = parseHexId(id);
    hexVertices[id] = [];
    hexEdges[id] = [];
    for (let i = 0; i < 6; i++) {
      const v = cornerVertex(h, i);
      if (vertexEdges[v]) hexVertices[id].push(v);
      const e = sideEdge(h, i);
      if (edgeHexes[e]) hexEdges[id].push(e);
    }
  }

  return {
    hexIds: [...hexIds],
    hexVertices,
    hexEdges,
    hexNeighbors,
    vertexHexes,
    vertexNeighbors,
    vertexEdges,
    edgeHexes,
    edgeVertices,
    vertexIds: Object.keys(vertexEdges).sort(),
    edgeIds: Object.keys(edgeHexes).sort(),
  };
}

/** Edge between two vertices, if they are adjacent. */
export function edgeBetween(t: Topology, a: VertexId, b: VertexId): EdgeId | undefined {
  return t.vertexEdges[a]?.find((e) => {
    const [x, y] = t.edgeVertices[e];
    return (x === a && y === b) || (x === b && y === a);
  });
}
