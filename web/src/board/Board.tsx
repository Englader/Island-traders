import {
  cornerVertex,
  getTopologyFor,
  hexCenter,
  parseHexId,
  pips,
  vertexPoint,
  type EdgeId,
  type GameView,
  type HarborType,
  type HexId,
  type Terrain,
  type VertexId,
} from 'engine';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RESOURCE_INFO } from '../game/names';
import type { PlayerColor } from '../game/seats';
import type { Flash } from '../ui/flash';
import { ResGlyph } from '../ui/icons';
import { GOLD_TILE, GoldFieldDefs } from './gold';

export type PickKind = 'vertex' | 'edge' | 'hex';

export interface Targets {
  vertices: Set<VertexId>;
  edges: Set<EdgeId>;
  hexes: Set<HexId>;
}

export interface Ghost {
  kind: 'settlement' | 'city' | 'road' | 'ship' | 'robber' | 'pirate' | 'harbor';
  id: string;
  owner: number;
}

interface Props {
  view: GameView;
  colors: PlayerColor[];
  targets: Targets;
  /** Colour of the target highlights (the acting player's). */
  accent: string;
  ghost: Ghost | null;
  /** The latest move, highlighted for a moment so others can follow it. */
  flash: Flash | null;
  onPick(kind: PickKind, id: string): void;
  /** Extra round buttons shown under the zoom buttons (speed, log). */
  tools?: ComponentChildren;
}

interface Pt {
  x: number;
  y: number;
}

const EMPTY: Targets = { vertices: new Set(), edges: new Set(), hexes: new Set() };
export const NO_TARGETS = EMPTY;

/** The board is seen from a slight angle: vertical distances shrink. */
const TILT = 0.8;
/** Thickness of a land tile, in board units. */
const DEPTH = 0.2;

/** Tile colours: top face, the lit edge of the gradient, the tile side. */
const TILE: Record<Exclude<Terrain, 'sea'>, { top: string; light: string; side: string }> = {
  hills: { top: '#cf6d3f', light: '#e58a5a', side: '#8c3f1e' },
  forest: { top: '#3f8f45', light: '#58a85a', side: '#245a2a' },
  pasture: { top: '#9fd060', light: '#bde27e', side: '#5f8f2f' },
  fields: { top: '#eac24a', light: '#f5d673', side: '#a57f1b' },
  mountains: { top: '#8f97a3', light: '#aab1bb', side: '#565d68' },
  desert: { top: '#e7d6a2', light: '#f3e7c2', side: '#b09b62' },
  gold: GOLD_TILE,
  fog: { top: '#b9c2cc', light: '#d3dae1', side: '#7d8792' },
};

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function polygon(points: Pt[]): string {
  return points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}

function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function shift(points: Pt[], dy: number): Pt[] {
  return points.map((p) => ({ x: p.x, y: p.y + dy }));
}

function scaleAround(points: Pt[], c: Pt, k: number): Pt[] {
  return points.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

/** Mixes a #rrggbb colour with white (t > 0) or black (t < 0). */
export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(t >= 0 ? v + (255 - v) * t : v * (1 + t)));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Stable geometry for a layout (optionally rotated 90° for tall screens). */
function useGeometry(layoutKey: string, rotate: boolean) {
  return useMemo(() => {
    const t = getTopologyFor(layoutKey);
    const proj = (p: Pt): Pt => (rotate ? { x: -p.y, y: p.x * TILT } : { x: p.x, y: p.y * TILT });
    const hexPts: Record<HexId, Pt[]> = {};
    const centers: Record<HexId, Pt> = {};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const h of t.hexIds) {
      const a = parseHexId(h);
      centers[h] = proj(hexCenter(a));
      hexPts[h] = [0, 1, 2, 3, 4, 5].map((i) => proj(vertexPoint(cornerVertex(a, i))));
      for (const p of hexPts[h]) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y + DEPTH);
      }
    }
    const vpt: Record<VertexId, Pt> = {};
    for (const v of t.vertexIds) vpt[v] = proj(vertexPoint(v));
    const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    return { t, proj, hexPts, centers, vpt, bounds };
  }, [layoutKey, rotate]);
}

function unrotatedAspect(layoutKey: string): number {
  const t = getTopologyFor(layoutKey);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const h of t.hexIds) {
    const c = hexCenter(parseHexId(h));
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return (maxX - minX + 2) / ((maxY - minY + 2) * TILT);
}

export function Board({ view, colors, targets, accent, ghost, flash, onPick, tools }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 360, h: 360 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth || 360, h: el.clientHeight || 360 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layoutKey = view.board.layoutKey;
  const aspect = useMemo(() => unrotatedAspect(layoutKey), [layoutKey]);
  const rotate = aspect > 1.15 && size.h > size.w * 1.1;
  const g = useGeometry(layoutKey, rotate);

  // --- pan & zoom ------------------------------------------------------------
  const fit = useMemo(() => {
    // Trim the open sea around the islands so the land fills the screen.
    const land = g.t.hexIds.filter((h) => view.board.hexes[h].terrain !== 'sea');
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const h of land.length > 0 ? land : g.t.hexIds) {
      for (const p of g.hexPts[h]) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y + DEPTH);
      }
    }
    const pad = 0.5;
    // a little more room on top for the event ticker
    let x = Math.max(g.bounds.x, minX - pad);
    let y = Math.max(g.bounds.y, minY - pad - 0.35);
    let w = Math.min(g.bounds.x + g.bounds.w, maxX + pad) - x;
    let h = Math.min(g.bounds.y + g.bounds.h, maxY + pad) - y;
    const ca = size.w / Math.max(1, size.h);
    if (w / h > ca) {
      const nh = w / ca;
      y -= (nh - h) / 2;
      h = nh;
    } else {
      const nw = h * ca;
      x -= (nw - w) / 2;
      w = nw;
    }
    return { x, y, w, h };
    // Fitted once per layout and screen size: revealing fog does not re-zoom.
  }, [g, size.w, size.h]);
  const [vb, setVb] = useState(fit);
  useEffect(() => setVb(fit), [fit]);

  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ moved: boolean; start: Pt; dist: number; vb: typeof vb } | null>(null);

  const clamp = (next: typeof vb) => {
    const minW = fit.w / 6;
    const maxW = fit.w * 1.6;
    let w = Math.min(maxW, Math.max(minW, next.w));
    let h = (w * next.h) / next.w;
    const cx = next.x + next.w / 2;
    const cy = next.y + next.h / 2;
    // keep the centre on the board
    const bx = Math.min(Math.max(cx, g.bounds.x), g.bounds.x + g.bounds.w);
    const by = Math.min(Math.max(cy, g.bounds.y), g.bounds.y + g.bounds.h);
    if (!Number.isFinite(h)) h = fit.h;
    return { x: bx - w / 2, y: by - h / 2, w, h };
  };

  const zoomAt = (factor: number, px: number, py: number) => {
    setVb((cur) => {
      const w = cur.w * factor;
      const h = cur.h * factor;
      const fx = px / size.w;
      const fy = py / size.h;
      return clamp({ x: cur.x + (cur.w - w) * fx, y: cur.y + (cur.h - h) * fy, w, h });
    });
  };

  const local = (e: PointerEvent | WheelEvent): Pt => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: PointerEvent) => {
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const dist = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { moved: gesture.current?.moved ?? false, start: local(e), dist, vb };
    if (pts.length === 1) gesture.current.moved = false;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const gs = gesture.current;
    const scale = gs.vb.w / size.w;
    if (pts.length === 1) {
      const dx = pts[0].x - gs.start.x;
      const dy = pts[0].y - gs.start.y;
      if (!gs.moved && Math.hypot(dx, dy) < 8) return;
      gs.moved = true;
      setVb(clamp({ ...gs.vb, x: gs.vb.x - dx * scale, y: gs.vb.y - dy * scale }));
    } else if (pts.length === 2 && gs.dist > 0) {
      gs.moved = true;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const factor = gs.dist / Math.max(20, d);
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      const w = gs.vb.w * factor;
      const h = gs.vb.h * factor;
      setVb(clamp({ x: gs.vb.x + (gs.vb.w - w) * (mx / size.w), y: gs.vb.y + (gs.vb.h - h) * (my / size.h), w, h }));
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    const gs = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // one finger left after a pinch: restart the pan from here
      const [p] = [...pointers.current.values()];
      if (gs) gesture.current = { moved: true, start: p, dist: 0, vb };
      return;
    }
    gesture.current = null;
    if (!gs || gs.moved) return;
    const hit = nearestTarget(e);
    if (hit) onPick(hit.kind, hit.id);
  };

  /**
   * Fingers are wide and board spots are small on a phone, so a tap picks
   * the nearest highlighted spot within about a thumb's width.
   */
  const nearestTarget = (e: PointerEvent): { kind: PickKind; id: string } | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const p = { x: pt.x, y: pt.y };
    const unitsPerPx = vb.w / Math.max(1, size.w);
    const reach = Math.max(0.5, 34 * unitsPerPx);
    let best: { kind: PickKind; id: string; d: number } | null = null;
    const consider = (kind: PickKind, id: string, d: number) => {
      if (d <= reach && (!best || d < best.d)) best = { kind, id, d };
    };
    for (const v of targets.vertices) {
      const q = g.vpt[v];
      if (q) consider('vertex', v, Math.hypot(q.x - p.x, q.y - p.y));
    }
    for (const ed of targets.edges) {
      const ends = g.t.edgeVertices[ed];
      if (!ends) continue;
      // the middle part of the path: taps right at an end are ambiguous
      const a = g.vpt[ends[0]];
      const c = g.vpt[ends[1]];
      const a2 = { x: a.x + (c.x - a.x) * 0.15, y: a.y + (c.y - a.y) * 0.15 };
      const c2 = { x: c.x - (c.x - a.x) * 0.15, y: c.y - (c.y - a.y) * 0.15 };
      consider('edge', ed, distToSegment(p, a2, c2));
    }
    for (const h of targets.hexes) {
      const poly = g.hexPts[h];
      if (!poly) continue;
      consider('hex', h, insidePolygon(p, poly) ? 0 : Math.hypot(g.centers[h].x - p.x, g.centers[h].y - p.y) - 0.6);
    }
    const found = best as { kind: PickKind; id: string; d: number } | null;
    return found ? { kind: found.kind, id: found.id } : null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
  };

  // --- drawing -----------------------------------------------------------------
  // Built once per change of the game view; panning and zooming only move the viewBox.
  const content = useMemo(() => {
    const { t, hexPts, centers, vpt } = g;
    const b = view.board;
    const color = (p: number) => colors[p] ?? colors[0];
    const hexIds = t.hexIds;
    const sea = hexIds.filter((h) => b.hexes[h].terrain === 'sea');
    // Back to front, so nearer tiles cover the sides of those behind them.
    const land = hexIds.filter((h) => b.hexes[h].terrain !== 'sea').sort((a, c) => centers[a].y - centers[c].y || centers[a].x - centers[c].x);

    const edgeEnds = (e: EdgeId): [Pt, Pt] => {
      const [a, c] = t.edgeVertices[e];
      return [vpt[a], vpt[c]];
    };
    const mid = (e: EdgeId): Pt => {
      const [a, c] = edgeEnds(e);
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    };

    const ext = view.ext as Record<string, unknown>;
    const cloth = ext.cloth as { villages: Record<VertexId, { token: number; cloth: number; traders: number[] }> } | undefined;
    const tribe = ext.tribe as { spots?: Record<EdgeId, string> } | undefined;
    const pirateIslands = ext.pirateIslands as
      | { circuit: HexId[]; fortresses: Array<{ hex: HexId; vertex: VertexId; waypoint: VertexId; chits: number; captured: boolean }> }
      | undefined;

    function renderFlash(f: Flash) {
      const col = color(f.by).fill;
      if (f.kind === 'roll') {
        const dice = view.turn.dice;
        const sum = dice ? dice[0] + dice[1] : 0;
        if (sum === 7) return null;
        // the tiles that produce this roll glow for a moment
        return (
          <g key={`fl${f.key}`} class="roll-glow">
            {land
              .filter((h) => b.hexes[h].token === sum && b.robber !== h)
              .map((h) => (
                <polygon key={h} points={polygon(hexPts[h])} class="roll-glow-hex" />
              ))}
          </g>
        );
      }
      if (f.kind === 'vertex' && vpt[f.id]) {
        const p = vpt[f.id];
        return (
          <g key={`fl${f.key}`} class="flash">
            <ellipse cx={p.x} cy={p.y} rx={0.42} ry={0.42 * TILT} class="flash-halo" />
            <ellipse cx={p.x} cy={p.y} rx={0.42} ry={0.42 * TILT} class="flash-ring" stroke={col} />
          </g>
        );
      }
      if (f.kind === 'edge' && t.edgeVertices[f.id]) {
        const [a, c] = edgeEnds(f.id);
        return (
          <g key={`fl${f.key}`} class="flash">
            <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class="flash-halo" />
            <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class="flash-ring" stroke={col} />
          </g>
        );
      }
      if (f.kind === 'hex' && hexPts[f.id]) {
        return (
          <g key={`fl${f.key}`} class="flash">
            <polygon points={polygon(hexPts[f.id])} class="flash-halo" />
            <polygon points={polygon(hexPts[f.id])} class="flash-ring" stroke={col} />
          </g>
        );
      }
      return null;
    }

    // Pieces are drawn back to front as well.
    const pieces = Object.entries(b.pieces)
      .filter(([e]) => t.edgeVertices[e])
      .sort(([a], [c]) => mid(a).y - mid(c).y);
    const buildings = Object.entries(b.buildings)
      .filter(([v]) => vpt[v])
      .sort(([a], [c]) => vpt[a].y - vpt[c].y);

    return (
      <>
            <BoardDefs />
            {/* open sea: faint tile outlines only */}
            {sea.map((h) => (
              <polygon key={h} points={polygon(hexPts[h])} class="hex sea" />
            ))}
            {/* shallow water around the coasts */}
            {land.map((h) => (
              <polygon key={`sh${h}`} points={polygon(scaleAround(shift(hexPts[h], DEPTH * 0.6), centers[h], 1.16))} class="shallows" />
            ))}
            {/* raised tiles: side, top, texture */}
            {land.map((h) => {
              const hex = b.hexes[h];
              const tile = TILE[hex.terrain as Exclude<Terrain, 'sea'>];
              const top = hexPts[h];
              return (
                <g key={h}>
                  <polygon points={polygon(shift(top, DEPTH))} fill={tile.side} class="tile-side" />
                  <polygon points={polygon(top)} fill={`url(#tile-${hex.terrain})`} class="tile-top" />
                  <polygon points={polygon(top)} fill={`url(#tex-${hex.terrain})`} class="tile-tex" />
                  {hex.terrain === 'gold' && <use href="#gold-art" x={fmt(centers[h].x)} y={fmt(centers[h].y)} class="tile-art" />}
                  {hex.terrain === 'fog' && (
                    <T x={centers[h].x} y={centers[h].y} s={0.62} cls="fog-mark">
                      ?
                    </T>
                  )}
                </g>
              );
            })}
            {/* scenario: strait markers (Wonders) */}
            {sea
              .filter((h) => b.hexes[h].zone === 'strait')
              .map((h) => (
                <T key={`st${h}`} x={centers[h].x} y={centers[h].y + 0.05} s={0.4} cls="marker-icon">
                  🌉
                </T>
              ))}
            {/* pirate fleet circuit (Pirate Islands) */}
            {pirateIslands &&
              pirateIslands.circuit.map((h, i) => (
                <ellipse key={`c${i}`} cx={centers[h].x} cy={centers[h].y} rx={0.08} ry={0.08 * TILT} class="circuit-dot" />
              ))}
            {/* number tokens: little discs standing on the tiles */}
            {land.map((h) => {
              const hex = b.hexes[h];
              if (hex.token === null) return null;
              const c = centers[h];
              const n = pips(hex.token);
              const red = hex.token === 6 || hex.token === 8;
              const blocked = b.robber === h;
              const r = 0.3;
              return (
                <g key={`tk${h}`} class={blocked ? 'token blocked' : 'token'}>
                  <ellipse cx={c.x + 0.03} cy={c.y + 0.07} rx={r} ry={r * TILT} class="token-shadow" />
                  <ellipse cx={c.x} cy={c.y + 0.045} rx={r} ry={r * TILT} class="token-rim" />
                  <ellipse cx={c.x} cy={c.y} rx={r} ry={r * TILT} fill="url(#token-top)" class="token-top" />
                  <T x={c.x} y={c.y - 0.02} s={red ? 0.27 : 0.24} cls={red ? 'token-num red' : 'token-num'}>
                    {hex.token}
                  </T>
                  {Array.from({ length: n }, (_, i) => (
                    <circle key={i} cx={c.x + (i - (n - 1) / 2) * 0.06} cy={c.y + 0.13} r={0.021} class={red ? 'pip red' : 'pip'} />
                  ))}
                </g>
              );
            })}
            {/* harbors: a jetty from the coast to a flag */}
            {b.harbors.map((hb) => {
              const [h1, h2] = t.edgeHexes[hb.edge];
              const seaHex = b.hexes[h1].terrain === 'sea' ? h1 : h2;
              const m = mid(hb.edge);
              const sc = centers[seaHex];
              const p = { x: m.x + (sc.x - m.x) * 0.5, y: m.y + (sc.y - m.y) * 0.5 };
              const [a, c] = edgeEnds(hb.edge);
              return (
                <g key={`hb${hb.edge}`} class="harbor">
                  <line x1={p.x} y1={p.y} x2={a.x} y2={a.y} class="pier" />
                  <line x1={p.x} y1={p.y} x2={c.x} y2={c.y} class="pier" />
                  <ellipse cx={p.x + 0.02} cy={p.y + 0.06} rx={0.21} ry={0.21 * TILT} class="token-shadow" />
                  <ellipse cx={p.x} cy={p.y} rx={0.21} ry={0.21 * TILT} class="harbor-bg" />
                  <HarborText p={p} type={hb.type} />
                </g>
              );
            })}
            {/* Forgotten Tribe gifts */}
            {tribe?.spots &&
              Object.entries(tribe.spots).map(([e, gift]) => {
                if (!t.edgeVertices[e]) return null;
                const m = mid(e);
                const kind = gift.split(':')[0];
                const res = gift.startsWith('harbor:') ? (gift.slice(7) as HarborType) : null;
                const label = kind === 'vp' ? '★' : kind === 'devCard' ? '?' : res && res !== 'generic' ? RESOURCE_INFO[res].icon : '⚓';
                return (
                  <g key={`gift${e}`} class={`gift gift-${kind}`}>
                    <ellipse cx={m.x + 0.02} cy={m.y + 0.05} rx={0.16} ry={0.16 * TILT} class="token-shadow" />
                    <ellipse cx={m.x} cy={m.y} rx={0.16} ry={0.16 * TILT} class="gift-bg" />
                    {res && res !== 'generic' ? (
                      <ResGlyph r={res} x={m.x} y={m.y} size={0.17} />
                    ) : (
                      <T x={m.x} y={m.y} s={kind === 'vp' ? 0.2 : 0.15} cls="gift-icon">
                        {res === 'generic' ? '3:1' : label}
                      </T>
                    )}
                  </g>
                );
              })}
            {/* Pirate Islands: waypoints */}
            {pirateIslands &&
              pirateIslands.fortresses.map((f, i) =>
                vpt[f.waypoint] ? (
                  <ellipse key={`wp${i}`} cx={vpt[f.waypoint].x} cy={vpt[f.waypoint].y} rx={0.22} ry={0.22 * TILT} class="waypoint" stroke={color(i).fill} />
                ) : null,
              )}
            {/* Cloth villages */}
            {cloth &&
              Object.entries(cloth.villages).map(([v, vil]) => {
                const p = vpt[v];
                if (!p) return null;
                return (
                  <g key={`vil${v}`} class={vil.cloth > 0 ? 'village' : 'village empty'}>
                    <ellipse cx={p.x + 0.02} cy={p.y + 0.06} rx={0.24} ry={0.24 * TILT} class="token-shadow" />
                    <ellipse cx={p.x} cy={p.y} rx={0.24} ry={0.24 * TILT} class="village-bg" />
                    <T x={p.x} y={p.y - 0.035} s={0.15} cls="village-num">
                      {vil.token}
                    </T>
                    <T x={p.x} y={p.y + 0.09} s={0.1} cls="village-cloth">
                      {vil.cloth} cloth
                    </T>
                    {vil.traders.map((tr, k) => (
                      <circle key={k} cx={p.x - 0.2 + k * 0.13} cy={p.y - 0.28} r={0.055} fill={color(tr).fill} stroke="#fff" stroke-width={0.015} />
                    ))}
                  </g>
                );
              })}
            {/* roads and ships (the newest one pops into place) */}
            {pieces.map(([e, piece]) => {
              const col = color(piece.owner);
              const [a, c] = edgeEnds(e);
              const el =
                piece.type === 'road' ? (
                  <Road key={`pc${e}`} a={a} c={c} fill={col.fill} stroke={col.stroke} />
                ) : (
                  <Ship key={`pc${e}`} a={a} c={c} fill={col.fill} stroke={col.stroke} war={!!piece.warship} />
                );
              return flash?.kind === 'edge' && flash.id === e ? (
                <g key={`new${e}-${flash.key}`} class={piece.type === 'road' ? 'arrive-pop' : 'arrive-sail'}>
                  {el}
                </g>
              ) : (
                el
              );
            })}
            {/* Pirate Islands: fortresses */}
            {pirateIslands &&
              pirateIslands.fortresses.map((f, i) =>
                !f.captured && vpt[f.vertex] ? <Fortress key={`pf${i}`} p={vpt[f.vertex]} col={color(i)} chits={f.chits} /> : null,
              )}
            {/* buildings */}
            {buildings.map(([v, bd]) => {
              const col = color(bd.owner);
              const el = <Building key={`bd${v}`} p={vpt[v]} city={bd.type === 'city'} fill={col.fill} stroke={col.stroke} />;
              // the newest settlement or city drops onto the board
              return flash?.kind === 'vertex' && flash.id === v ? (
                <g key={`new${v}-${flash.key}`} class="arrive-drop">
                  {el}
                </g>
              ) : (
                el
              );
            })}
            {/* robber & pirate (land with a bounce when moved) */}
            {b.robber && centers[b.robber] && (
              <g key={`robber${b.robber}`} class={flash?.kind === 'hex' && flash.id === b.robber ? 'arrive-drop' : undefined}>
                <Robber p={centers[b.robber]} />
              </g>
            )}
            {b.pirate && centers[b.pirate] && (
              <g key={`pirate${b.pirate}`} class={flash?.kind === 'hex' && flash.id === b.pirate ? 'arrive-sail' : undefined}>
                <PirateShip p={centers[b.pirate]} />
              </g>
            )}
            {flash ? renderFlash(flash) : null}
            {/* targets */}
            {[...targets.hexes].map((h) =>
              hexPts[h] ? <polygon key={`th${h}`} points={polygon(hexPts[h])} class="target-hex" stroke={accent} data-pick={`h:${h}`} /> : null,
            )}
            {[...targets.edges].map((e) => {
              if (!t.edgeVertices[e]) return null;
              const [a, c] = edgeEnds(e);
              return (
                <g key={`te${e}`} data-pick={`e:${e}`} class="target-edge-g">
                  <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class="target-edge-halo" />
                  <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class="target-edge" stroke={accent} />
                  <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class="hit-edge" />
                </g>
              );
            })}
            {[...targets.vertices].map((v) =>
              vpt[v] ? (
                <g key={`tv${v}`} data-pick={`v:${v}`}>
                  <circle cx={vpt[v].x} cy={vpt[v].y} r={0.15} class="target-vertex" fill={accent} />
                  <circle cx={vpt[v].x} cy={vpt[v].y} r={0.4} class="hit" />
                </g>
              ) : null,
            )}
            {ghost && <GhostPiece ghost={ghost} g={g} colors={colors} />}
      </>
    );
  }, [view, g, targets, ghost, flash, colors, accent]);

  return (
    <div class="board-wrap" ref={wrap}>
      <svg
        ref={svgRef}
        class="board"
        viewBox={`${fmt(vb.x)} ${fmt(vb.y)} ${fmt(vb.w)} ${fmt(vb.h)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        role="img"
        aria-label="Game board"
      >
        {content}
      </svg>
      <div class="zoom-controls">
        <button type="button" class="zoom-in" aria-label="Zoom in" onClick={() => zoomAt(1 / 1.3, size.w / 2, size.h / 2)}>
          +
        </button>
        <button type="button" class="zoom-out" aria-label="Zoom out" onClick={() => zoomAt(1.3, size.w / 2, size.h / 2)}>
          −
        </button>
        <button type="button" class="fit" aria-label="Fit board" onClick={() => setVb(fit)}>
          ⤢
        </button>
        {tools}
      </div>
    </div>
  );
}

/** Gradients for the tile tops and the textures drawn over them. */
function BoardDefs() {
  return (
    <defs>
      {(Object.keys(TILE) as Array<keyof typeof TILE>).map((k) => (
        <linearGradient key={k} id={`tile-${k}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stop-color={TILE[k].light} />
          <stop offset="0.55" stop-color={TILE[k].top} />
          <stop offset="1" stop-color={shade(TILE[k].top, -0.1)} />
        </linearGradient>
      ))}
      <radialGradient id="token-top" cx="0.4" cy="0.35" r="0.75">
        <stop offset="0" stop-color="#fffaf0" />
        <stop offset="1" stop-color="#eadfc2" />
      </radialGradient>
      <radialGradient id="robber-grad" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#6d6d72" />
        <stop offset="1" stop-color="#1c1c20" />
      </radialGradient>
      {/* forest: little trees */}
      <pattern id="tex-forest" width="0.42" height="0.36" patternUnits="userSpaceOnUse">
        <path d="M0.1 0.03 L0.17 0.17 L0.03 0.17 Z M0.31 0.2 L0.38 0.34 L0.24 0.34 Z" fill="#1d4f25" opacity="0.55" />
      </pattern>
      {/* pasture: tufts of grass */}
      <pattern id="tex-pasture" width="0.34" height="0.3" patternUnits="userSpaceOnUse">
        <path d="M0.05 0.12 l0.03 -0.06 l0.03 0.06 M0.22 0.27 l0.03 -0.06 l0.03 0.06" stroke="#f2ffd9" stroke-width="0.018" fill="none" opacity="0.7" />
      </pattern>
      {/* fields: rows of wheat */}
      <pattern id="tex-fields" width="0.16" height="0.16" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
        <line x1="0" y1="0.08" x2="0.16" y2="0.08" stroke="#b08717" stroke-width="0.03" opacity="0.4" />
      </pattern>
      {/* hills: courses of brick */}
      <pattern id="tex-hills" width="0.3" height="0.16" patternUnits="userSpaceOnUse">
        <path d="M0 0.01 H0.3 M0 0.09 H0.3 M0.08 0.01 V0.09 M0.23 0.09 V0.16" stroke="#7a3316" stroke-width="0.016" fill="none" opacity="0.45" />
      </pattern>
      {/* mountains: snowy peaks */}
      <pattern id="tex-mountains" width="0.46" height="0.4" patternUnits="userSpaceOnUse">
        <path d="M0.03 0.2 L0.14 0.04 L0.25 0.2 Z" fill="#5d6570" opacity="0.55" />
        <path d="M0.11 0.085 L0.14 0.04 L0.17 0.085 Z" fill="#fff" opacity="0.8" />
        <path d="M0.24 0.38 L0.34 0.24 L0.44 0.38 Z" fill="#5d6570" opacity="0.5" />
      </pattern>
      {/* desert: dunes */}
      <pattern id="tex-desert" width="0.4" height="0.26" patternUnits="userSpaceOnUse">
        <path d="M0.02 0.12 q0.08 -0.07 0.16 0 M0.22 0.24 q0.08 -0.07 0.16 0" stroke="#b79d5c" stroke-width="0.018" fill="none" opacity="0.6" />
      </pattern>
      <GoldFieldDefs />
      {/* fog: hatching */}
      <pattern id="tex-fog" width="0.12" height="0.12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0.06" x2="0.12" y2="0.06" stroke="#fff" stroke-width="0.025" opacity="0.35" />
      </pattern>
    </defs>
  );
}

/**
 * Text drawn at 100x its size and scaled down, so browsers' minimum font
 * size settings never inflate labels on a board measured in hex units.
 */
function T({ x, y, s, cls, fill, children }: { x: number; y: number; s: number; cls: string; fill?: string; children: ComponentChildren }) {
  return (
    <text class={cls} transform={`translate(${fmt(x)} ${fmt(y)}) scale(0.01)`} font-size={s * 100} fill={fill}>
      {children}
    </text>
  );
}

function HarborText({ p, type }: { p: Pt; type: HarborType }) {
  if (type === 'generic') {
    return (
      <T x={p.x} y={p.y} s={0.15} cls="harbor-text">
        3:1
      </T>
    );
  }
  return (
    <>
      <ResGlyph r={type} x={p.x} y={p.y - 0.06} size={0.2} />
      <T x={p.x} y={p.y + 0.1} s={0.1} cls="harbor-text">
        2:1
      </T>
    </>
  );
}

function Road({ a, c, fill, stroke, ghost }: { a: Pt; c: Pt; fill: string; stroke: string; ghost?: boolean }) {
  const k = 0.17;
  const p1 = { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k };
  const p2 = { x: c.x - (c.x - a.x) * k, y: c.y - (c.y - a.y) * k };
  const d = `M${fmt(p1.x)} ${fmt(p1.y)} L${fmt(p2.x)} ${fmt(p2.y)}`;
  return (
    <g class={ghost ? 'road-g ghost' : 'road-g'}>
      <path d={d} transform="translate(0.02 0.06)" class="road-shadow" />
      <path d={d} transform="translate(0 0.045)" class="road-side" stroke={stroke} />
      <path d={d} class="road-top" stroke={fill} />
      <path d={d} class="road-shine" />
    </g>
  );
}

type Poly = Array<[number, number]>;

/** A small house (settlement) or a hall with a tower (city), lit from the top left. */
function Building({ p, city, fill, stroke, ghost }: { p: Pt; city: boolean; fill: string; stroke: string; ghost?: boolean }) {
  const light = shade(fill, 0.3);
  const dark = shade(fill, -0.3);
  const k = city ? 1.2 : 1.3;
  const at = (pts: Poly) => pts.map(([x, y]) => `${fmt(p.x + x * k)},${fmt(p.y + y * k)}`).join(' ');
  const faces: Array<[Poly, string]> = city
    ? [
        [[[0.08, 0.12], [0.17, 0.07], [0.17, -0.05], [0.08, 0.0]], dark],
        [[[-0.2, 0.12], [0.08, 0.12], [0.08, 0.0], [-0.2, 0.0]], fill],
        [[[-0.2, 0.0], [0.08, 0.0], [0.17, -0.05], [-0.11, -0.05]], light],
        [[[-0.05, 0.0], [0.01, -0.03], [0.01, -0.21], [-0.05, -0.18]], dark],
        [[[-0.17, 0.0], [-0.05, 0.0], [-0.05, -0.18], [-0.17, -0.18]], fill],
        [[[-0.17, -0.18], [-0.05, -0.18], [-0.11, -0.3]], fill],
        [[[-0.05, -0.18], [0.01, -0.21], [-0.05, -0.33], [-0.11, -0.3]], light],
      ]
    : [
        [[[0.05, 0.11], [0.13, 0.06], [0.13, -0.05], [0.05, -0.01]], dark],
        [[[-0.13, 0.11], [0.05, 0.11], [0.05, -0.01], [-0.13, -0.01]], fill],
        [[[-0.13, -0.01], [0.05, -0.01], [-0.04, -0.12]], fill],
        [[[-0.04, -0.12], [0.05, -0.01], [0.13, -0.05], [0.04, -0.16]], light],
      ];
  return (
    <g class={ghost ? 'building ghost' : 'building'}>
      <ellipse cx={p.x + 0.03} cy={p.y + 0.14 * k} rx={(city ? 0.24 : 0.17) * k} ry={0.06 * k} class="piece-shadow" />
      {faces.map(([pts, f], i) => (
        <polygon key={i} points={at(pts)} fill={f} stroke={stroke} class="building-face" />
      ))}
    </g>
  );
}

function Ship({ a, c, fill, stroke, war, ghost }: { a: Pt; c: Pt; fill: string; stroke: string; war: boolean; ghost?: boolean }) {
  const m = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  let ang = (Math.atan2(c.y - a.y, c.x - a.x) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang <= -90) ang += 180;
  // Boats stay upright: only lean a little with the path.
  const lean = Math.max(-25, Math.min(25, ang * 0.3));
  return (
    <g transform={`translate(${fmt(m.x)} ${fmt(m.y)})`} class={ghost ? 'ship ghost' : 'ship'}>
      <ellipse cx={0.02} cy={0.12} rx={0.24} ry={0.06} class="piece-shadow" />
      <g transform={`rotate(${fmt(lean)})`}>
        <path d="M -0.22 0.0 L 0.22 0.0 L 0.14 0.11 L -0.14 0.11 Z" fill={fill} stroke={stroke} class="ship-hull" />
        <path d="M -0.22 0.0 L 0.22 0.0 L 0.2 0.03 L -0.2 0.03 Z" fill={shade(fill, 0.35)} class="ship-rail" />
        <line x1={0} y1={0.0} x2={0} y2={-0.24} stroke={stroke} class="ship-mast" />
        <path d="M 0.012 -0.23 Q 0.17 -0.12 0.15 -0.02 L 0.012 -0.02 Z" fill={war ? '#26262b' : '#fbfaf5'} stroke={stroke} class="ship-sail" />
        <path d="M -0.012 -0.2 Q -0.11 -0.12 -0.1 -0.03 L -0.012 -0.03 Z" fill={war ? '#3a3a40' : '#e9e6db'} stroke={stroke} class="ship-sail" />
        {war && <path d="M 0 -0.24 L 0.1 -0.21 L 0 -0.18 Z" fill="#d7263d" />}
      </g>
    </g>
  );
}

function Fortress({ p, col, chits }: { p: Pt; col: PlayerColor; chits: number }) {
  const dark = shade(col.fill, -0.35);
  const x = p.x;
  const y = p.y;
  return (
    <g class="fortress">
      <ellipse cx={x + 0.03} cy={y + 0.16} rx={0.26} ry={0.07} class="piece-shadow" />
      <rect x={x - 0.2} y={y - 0.12} width={0.4} height={0.26} fill="#57534e" stroke="#2b2825" stroke-width="0.02" />
      <path d={`M${fmt(x - 0.2)} ${fmt(y - 0.12)} v-0.07 h0.08 v0.04 h0.08 v-0.04 h0.08 v0.04 h0.08 v-0.04 h0.08 v0.07 Z`} fill="#6b665f" stroke="#2b2825" stroke-width="0.02" />
      <rect x={x - 0.05} y={y + 0.02} width={0.1} height={0.12} fill="#2b2825" />
      <line x1={x} y1={y - 0.19} x2={x} y2={y - 0.42} stroke="#2b2825" stroke-width="0.02" />
      <path d={`M${fmt(x)} ${fmt(y - 0.42)} l0.16 0.05 l-0.16 0.05 Z`} fill={col.fill} stroke={dark} stroke-width="0.012" />
      <T x={x} y={y + 0.29} s={0.13} cls="fortress-chits">
        {'●'.repeat(chits)}
      </T>
    </g>
  );
}

function Robber({ p }: { p: Pt }) {
  const x = p.x + 0.3;
  const y = p.y - 0.02;
  return (
    <g class="robber">
      <ellipse cx={x + 0.02} cy={y + 0.2} rx={0.14} ry={0.05} class="piece-shadow" />
      <path d={`M ${fmt(x - 0.12)} ${fmt(y + 0.2)} Q ${fmt(x)} ${fmt(y - 0.14)} ${fmt(x + 0.12)} ${fmt(y + 0.2)} Z`} fill="url(#robber-grad)" class="robber-body" />
      <circle cx={x} cy={y - 0.1} r={0.085} fill="url(#robber-grad)" class="robber-body" />
    </g>
  );
}

function PirateShip({ p }: { p: Pt }) {
  return (
    <g class="pirate" transform={`translate(${fmt(p.x)} ${fmt(p.y)}) scale(1.35)`}>
      <ellipse cx={0.02} cy={0.13} rx={0.25} ry={0.06} class="piece-shadow" />
      <path d="M -0.22 0.0 L 0.22 0.0 L 0.14 0.12 L -0.14 0.12 Z" class="pirate-hull" />
      <line x1={0} y1={0.0} x2={0} y2={-0.25} class="pirate-mast" />
      <path d="M 0.012 -0.24 Q 0.18 -0.12 0.16 -0.02 L 0.012 -0.02 Z" class="pirate-sail" />
      <path d="M -0.012 -0.21 Q -0.12 -0.12 -0.11 -0.03 L -0.012 -0.03 Z" class="pirate-sail" />
      <T x={0.075} y={-0.1} s={0.1} cls="pirate-skull">
        ☠
      </T>
    </g>
  );
}

function GhostPiece({ ghost, g, colors }: { ghost: Ghost; g: ReturnType<typeof useGeometry>; colors: PlayerColor[] }) {
  const col = colors[ghost.owner] ?? colors[0];
  if (ghost.kind === 'settlement' || ghost.kind === 'city') {
    const p = g.vpt[ghost.id];
    return p ? <Building p={p} city={ghost.kind === 'city'} fill={col.fill} stroke={col.stroke} ghost /> : null;
  }
  if (ghost.kind === 'road' || ghost.kind === 'ship' || ghost.kind === 'harbor') {
    const ends = g.t.edgeVertices[ghost.id];
    if (!ends) return null;
    const a = g.vpt[ends[0]];
    const c = g.vpt[ends[1]];
    if (ghost.kind === 'ship') return <Ship a={a} c={c} fill={col.fill} stroke={col.stroke} war={false} ghost />;
    if (ghost.kind === 'road') return <Road a={a} c={c} fill={col.fill} stroke={col.stroke} ghost />;
    return <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class="ghost-harbor" stroke={col.fill} />;
  }
  const c = g.centers[ghost.id];
  if (!c) return null;
  return <g class="ghost">{ghost.kind === 'robber' ? <Robber p={c} /> : <PirateShip p={c} />}</g>;
}
