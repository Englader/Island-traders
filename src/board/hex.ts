import type { EdgeId, HexId, VertexId } from '../core/types.js';

/**
 * Pointy-top axial coordinates (q, r); cube s = -q - r. See Red Blob Games'
 * hexagonal grid guide. Rows of the board are constant r.
 */
export interface Axial {
  q: number;
  r: number;
}

/** Directions in counter-clockwise order (screen y points down): E, NE, NW, W, SW, SE. */
export const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const DIR_NAMES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'] as const;

export function hexId(q: number, r: number): HexId {
  return `${q},${r}`;
}

export function parseHexId(id: HexId): Axial {
  const [q, r] = id.split(',').map(Number);
  return { q, r };
}

export function neighbor(h: Axial, dir: number): Axial {
  const d = DIRECTIONS[((dir % 6) + 6) % 6];
  return { q: h.q + d.q, r: h.r + d.r };
}

export function neighborId(id: HexId, dir: number): HexId {
  const n = neighbor(parseHexId(id), dir);
  return hexId(n.q, n.r);
}

export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Canonical vertex id: the three hexes (on- or off-board) meeting at the corner. */
export function vertexKey(a: HexId, b: HexId, c: HexId): VertexId {
  return [a, b, c].sort().join('|');
}

/** Canonical edge id: the two hexes sharing the side. */
export function edgeKey(a: HexId, b: HexId): EdgeId {
  return [a, b].sort().join('|');
}

/** The corner of `h` between direction i and i+1. */
export function cornerVertex(h: Axial, i: number): VertexId {
  const a = neighbor(h, i);
  const b = neighbor(h, i + 1);
  return vertexKey(hexId(h.q, h.r), hexId(a.q, a.r), hexId(b.q, b.r));
}

/** The side of `h` facing direction i. */
export function sideEdge(h: Axial, i: number): EdgeId {
  const a = neighbor(h, i);
  return edgeKey(hexId(h.q, h.r), hexId(a.q, a.r));
}

/** Hexes within `radius` of the origin. */
export function hexagon(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q, r });
    }
  }
  return out;
}

/** Ring of hexes at exactly `radius`, starting at corner `startCorner` and walking counter-clockwise. */
export function ring(center: Axial, radius: number, startCorner = 4): Axial[] {
  if (radius === 0) return [center];
  const out: Axial[] = [];
  const d = DIRECTIONS[startCorner % 6];
  let h: Axial = { q: center.q + d.q * radius, r: center.r + d.r * radius };
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < radius; j++) {
      out.push(h);
      h = neighbor(h, startCorner + 2 + i);
    }
  }
  return out;
}

// --- odd-r offset coordinates (used by the ASCII map format) -----------------

/** Converts odd-r offset (col, row) to axial. Odd rows are shifted half a hex right. */
export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(h: Axial): { col: number; row: number } {
  return { col: h.q + (h.r - (h.r & 1)) / 2, row: h.r };
}

/** Offset reference "col,row" -> HexId. */
export function offsetId(col: number, row: number): HexId {
  const a = offsetToAxial(col, row);
  return hexId(a.q, a.r);
}

// --- pixel geometry (for renderers) ------------------------------------------

export function hexCenter(h: Axial, size = 1): { x: number; y: number } {
  return { x: size * Math.sqrt(3) * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

/** A vertex sits at the centroid of its three hex centres. */
export function vertexPoint(id: VertexId, size = 1): { x: number; y: number } {
  const pts = id.split('|').map((h) => hexCenter(parseHexId(h), size));
  return { x: (pts[0].x + pts[1].x + pts[2].x) / 3, y: (pts[0].y + pts[1].y + pts[2].y) / 3 };
}

/** An edge midpoint is halfway between its two hex centres. */
export function edgeMidpoint(id: EdgeId, size = 1): { x: number; y: number } {
  const pts = id.split('|').map((h) => hexCenter(parseHexId(h), size));
  return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
}
