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
  type VertexId,
} from 'engine';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RESOURCE_INFO, TERRAIN_INFO, harborLabel } from '../game/names';
import type { PlayerColor } from '../game/seats';

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
  /** Something to flash briefly (the latest move). */
  flash: { kind: PickKind; id: string; key: number } | null;
  onPick(kind: PickKind, id: string): void;
}

interface Pt {
  x: number;
  y: number;
}

const EMPTY: Targets = { vertices: new Set(), edges: new Set(), hexes: new Set() };
export const NO_TARGETS = EMPTY;

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function polygon(points: Pt[]): string {
  return points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

/** Stable geometry for a layout (optionally rotated 90° for tall screens). */
function useGeometry(layoutKey: string, rotate: boolean) {
  return useMemo(() => {
    const t = getTopologyFor(layoutKey);
    const proj = (p: Pt): Pt => (rotate ? { x: -p.y, y: p.x } : p);
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
        maxY = Math.max(maxY, p.y);
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
  return (maxX - minX + 2) / (maxY - minY + 2);
}

export function Board({ view, colors, targets, accent, ghost, flash, onPick }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
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
    const pad = 0.15;
    let { x, y, w, h } = g.bounds;
    x -= pad;
    y -= pad;
    w += pad * 2;
    h += pad * 2;
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
  }, [g, size.w, size.h]);
  const [vb, setVb] = useState(fit);
  useEffect(() => setVb(fit), [fit]);

  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ moved: boolean; start: Pt; dist: number; vb: typeof vb } | null>(null);

  const clamp = (next: typeof vb) => {
    const minW = fit.w / 6;
    const maxW = fit.w * 1.25;
    let w = Math.min(maxW, Math.max(minW, next.w));
    let h = (w * next.h) / next.w;
    const cx = next.x + next.w / 2;
    const cy = next.y + next.h / 2;
    // keep the centre on the board
    const bx = Math.min(Math.max(cx, fit.x), fit.x + fit.w);
    const by = Math.min(Math.max(cy, fit.y), fit.y + fit.h);
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
    const el = (e.target as Element | null)?.closest?.('[data-pick]');
    const pick = el?.getAttribute('data-pick');
    if (!pick) return;
    const [kind, id] = [pick.slice(0, 1), pick.slice(2)];
    onPick(kind === 'v' ? 'vertex' : kind === 'e' ? 'edge' : 'hex', id);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y);
  };

  // --- drawing -----------------------------------------------------------------
  const { t, hexPts, centers, vpt } = g;
  const b = view.board;
  const color = (p: number) => colors[p] ?? colors[0];
  const hexIds = t.hexIds;
  const sea = hexIds.filter((h) => b.hexes[h].terrain === 'sea');
  const land = hexIds.filter((h) => b.hexes[h].terrain !== 'sea');

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

  const flashEl = flash ? renderFlash(flash) : null;

  function renderFlash(f: NonNullable<Props['flash']>) {
    if (f.kind === 'vertex' && vpt[f.id]) {
      return <circle key={`fl${f.key}`} class="flash" cx={vpt[f.id].x} cy={vpt[f.id].y} r={0.32} />;
    }
    if (f.kind === 'edge' && t.edgeVertices[f.id]) {
      const [a, c] = edgeEnds(f.id);
      return <line key={`fl${f.key}`} class="flash" x1={a.x} y1={a.y} x2={c.x} y2={c.y} />;
    }
    if (f.kind === 'hex' && hexPts[f.id]) {
      return <polygon key={`fl${f.key}`} class="flash" points={polygon(hexPts[f.id])} />;
    }
    return null;
  }

  return (
    <div class="board-wrap" ref={wrap}>
      <svg
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
        <defs>
          <radialGradient id="seaGrad" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stop-color="#4a9ad8" />
            <stop offset="100%" stop-color="#2f78b7" />
          </radialGradient>
        </defs>
        {/* sea */}
        {sea.map((h) => (
          <polygon key={h} points={polygon(hexPts[h])} class="hex sea" />
        ))}
        {/* land */}
        {land.map((h) => {
          const hex = b.hexes[h];
          const info = TERRAIN_INFO[hex.terrain];
          const c = centers[h];
          return (
            <g key={h}>
              <polygon points={polygon(hexPts[h])} class={`hex land t-${hex.terrain}`} fill={info.fill} />
              {hex.terrain === 'fog' ? (
                <T x={c.x} y={c.y} s={0.7} cls="fog-mark">
                  ?
                </T>
              ) : (
                info.icon && (
                  <T x={c.x} y={c.y - 0.5} s={0.3} cls="terrain-icon">
                    {info.icon}
                  </T>
                )
              )}
            </g>
          );
        })}
        {/* scenario: strait markers (Wonders) */}
        {sea
          .filter((h) => b.hexes[h].zone === 'strait')
          .map((h) => (
            <T key={`st${h}`} x={centers[h].x} y={centers[h].y + 0.1} s={0.45} cls="marker-icon">
              🌉
            </T>
          ))}
        {/* pirate fleet circuit (Pirate Islands) */}
        {pirateIslands &&
          pirateIslands.circuit.map((h, i) => (
            <circle key={`c${i}`} cx={centers[h].x} cy={centers[h].y} r={0.07} class="circuit-dot" />
          ))}
        {/* number tokens */}
        {land.map((h) => {
          const hex = b.hexes[h];
          if (hex.token === null) return null;
          const c = centers[h];
          const n = pips(hex.token);
          const red = hex.token === 6 || hex.token === 8;
          const blocked = b.robber === h;
          return (
            <g key={`tk${h}`} class={blocked ? 'token blocked' : 'token'}>
              <circle cx={c.x} cy={c.y} r={0.3} class="token-bg" />
              <T x={c.x} y={c.y + 0.02} s={0.26} cls={red ? 'token-num red' : 'token-num'}>
                {hex.token}
              </T>
              {Array.from({ length: n }, (_, i) => (
                <circle key={i} cx={c.x + (i - (n - 1) / 2) * 0.065} cy={c.y + 0.17} r={0.024} class={red ? 'pip red' : 'pip'} />
              ))}
            </g>
          );
        })}
        {/* harbors */}
        {b.harbors.map((hb) => {
          const [h1, h2] = t.edgeHexes[hb.edge];
          const seaHex = b.hexes[h1].terrain === 'sea' ? h1 : h2;
          const m = mid(hb.edge);
          const sc = centers[seaHex];
          const p = { x: m.x + (sc.x - m.x) * 0.55, y: m.y + (sc.y - m.y) * 0.55 };
          const [a, c] = edgeEnds(hb.edge);
          return (
            <g key={`hb${hb.edge}`} class="harbor">
              <line x1={p.x} y1={p.y} x2={a.x} y2={a.y} class="pier" />
              <line x1={p.x} y1={p.y} x2={c.x} y2={c.y} class="pier" />
              <circle cx={p.x} cy={p.y} r={0.22} class="harbor-bg" />
              <HarborText p={p} type={hb.type} />
            </g>
          );
        })}
        {/* Forgotten Tribe gifts */}
        {tribe?.spots &&
          Object.entries(tribe.spots).map(([e, gift]) => {
            if (!t.edgeVertices[e]) return null;
            const m = mid(e);
            const label = gift === 'vp' ? '★' : gift === 'devCard' ? '🂠' : '⚓';
            const sub = gift.startsWith('harbor:') ? harborLabel(gift.slice(7) as HarborType) : gift === 'vp' ? '1 VP' : 'card';
            return (
              <g key={`gift${e}`} class={`gift gift-${gift.split(':')[0]}`}>
                <circle cx={m.x} cy={m.y} r={0.16} class="gift-bg" />
                <T x={m.x} y={m.y + 0.01} s={0.18} cls="gift-icon">
                  {label}
                </T>
                <T x={m.x} y={m.y + 0.27} s={0.1} cls="gift-sub">
                  {sub}
                </T>
              </g>
            );
          })}
        {/* Pirate Islands: waypoints and fortresses */}
        {pirateIslands &&
          pirateIslands.fortresses.map((f, i) => (
            <g key={`pf${i}`}>
              {vpt[f.waypoint] && (
                <circle cx={vpt[f.waypoint].x} cy={vpt[f.waypoint].y} r={0.2} class="waypoint" stroke={color(i).fill} />
              )}
              {!f.captured && vpt[f.vertex] && (
                <g class="fortress">
                  <circle cx={vpt[f.vertex].x} cy={vpt[f.vertex].y} r={0.24} fill={color(i).fill} stroke={color(i).stroke} />
                  <T x={vpt[f.vertex].x} y={vpt[f.vertex].y + 0.02} s={0.24} cls="fortress-icon">
                    🏴
                  </T>
                  <T x={vpt[f.vertex].x} y={vpt[f.vertex].y + 0.42} s={0.14} cls="fortress-chits">
                    {'●'.repeat(f.chits)}
                  </T>
                </g>
              )}
            </g>
          ))}
        {/* Cloth villages */}
        {cloth &&
          Object.entries(cloth.villages).map(([v, vil]) => {
            const p = vpt[v];
            if (!p) return null;
            return (
              <g key={`vil${v}`} class={vil.cloth > 0 ? 'village' : 'village empty'}>
                <circle cx={p.x} cy={p.y} r={0.24} class="village-bg" />
                <T x={p.x} y={p.y - 0.02} s={0.16} cls="village-num">
                  {vil.token}
                </T>
                <T x={p.x} y={p.y + 0.15} s={0.11} cls="village-cloth">
                  {vil.cloth}🧵
                </T>
                {vil.traders.map((tr, k) => (
                  <circle key={k} cx={p.x - 0.2 + k * 0.13} cy={p.y - 0.3} r={0.055} fill={color(tr).fill} stroke="#fff" stroke-width={0.015} />
                ))}
              </g>
            );
          })}
        {/* roads and ships */}
        {Object.entries(b.pieces).map(([e, piece]) => {
          if (!t.edgeVertices[e]) return null;
          const col = color(piece.owner);
          const [a, c] = edgeEnds(e);
          if (piece.type === 'road') {
            const k = 0.16;
            const p1 = { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k };
            const p2 = { x: c.x - (c.x - a.x) * k, y: c.y - (c.y - a.y) * k };
            return (
              <g key={`pc${e}`}>
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} class="road-outline" stroke={col.stroke} />
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} class="road" stroke={col.fill} />
              </g>
            );
          }
          return <Ship key={`pc${e}`} a={a} c={c} fill={col.fill} stroke={col.stroke} war={!!piece.warship} />;
        })}
        {/* buildings */}
        {Object.entries(b.buildings).map(([v, bd]) => {
          const p = vpt[v];
          if (!p) return null;
          const col = color(bd.owner);
          return <Building key={`bd${v}`} p={p} city={bd.type === 'city'} fill={col.fill} stroke={col.stroke} />;
        })}
        {/* robber & pirate */}
        {b.robber && centers[b.robber] && <Robber p={centers[b.robber]} />}
        {b.pirate && centers[b.pirate] && <PirateShip p={centers[b.pirate]} />}
        {flashEl}
        {/* targets */}
        {[...targets.hexes].map((h) =>
          hexPts[h] ? <polygon key={`th${h}`} points={polygon(hexPts[h])} class="target-hex" stroke={accent} data-pick={`h:${h}`} /> : null,
        )}
        {[...targets.edges].map((e) => {
          if (!t.edgeVertices[e]) return null;
          const [a, c] = edgeEnds(e);
          return (
            <g key={`te${e}`} data-pick={`e:${e}`} class="target-edge-g">
              <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class="target-edge" stroke={accent} />
              <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class="hit-edge" />
            </g>
          );
        })}
        {[...targets.vertices].map((v) =>
          vpt[v] ? (
            <g key={`tv${v}`} data-pick={`v:${v}`}>
              <circle cx={vpt[v].x} cy={vpt[v].y} r={0.14} class="target-vertex" fill={accent} />
              <circle cx={vpt[v].x} cy={vpt[v].y} r={0.3} class="hit" />
            </g>
          ) : null,
        )}
        {ghost && <GhostPiece ghost={ghost} g={g} colors={colors} />}
      </svg>
      <div class="zoom-controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1 / 1.3, size.w / 2, size.h / 2)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1.3, size.w / 2, size.h / 2)}>
          −
        </button>
        <button type="button" aria-label="Fit board" onClick={() => setVb(fit)}>
          ⤢
        </button>
      </div>
    </div>
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
      <T x={p.x} y={p.y + 0.02} s={0.16} cls="harbor-text">
        3:1
      </T>
    );
  }
  return (
    <>
      <T x={p.x} y={p.y - 0.05} s={0.17} cls="harbor-icon">
        {RESOURCE_INFO[type].icon}
      </T>
      <T x={p.x} y={p.y + 0.14} s={0.12} cls="harbor-text small">
        2:1
      </T>
    </>
  );
}

function Building({ p, city, fill, stroke, ghost }: { p: Pt; city: boolean; fill: string; stroke: string; ghost?: boolean }) {
  const pts = city
    ? [
        [-0.21, 0.13],
        [0.21, 0.13],
        [0.21, -0.03],
        [0.03, -0.03],
        [0.03, -0.11],
        [-0.09, -0.22],
        [-0.21, -0.11],
      ]
    : [
        [-0.14, 0.11],
        [0.14, 0.11],
        [0.14, -0.04],
        [0, -0.17],
        [-0.14, -0.04],
      ];
  const k = city ? 1.25 : 1.35;
  return (
    <polygon
      points={pts.map(([x, y]) => `${fmt(p.x + x * k)},${fmt(p.y + y * k)}`).join(' ')}
      fill={fill}
      stroke={stroke}
      class={ghost ? 'building ghost' : 'building'}
    />
  );
}

function Ship({ a, c, fill, stroke, war, ghost }: { a: Pt; c: Pt; fill: string; stroke: string; war: boolean; ghost?: boolean }) {
  const m = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  let ang = (Math.atan2(c.y - a.y, c.x - a.x) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang <= -90) ang += 180;
  return (
    <g transform={`translate(${fmt(m.x)} ${fmt(m.y)}) rotate(${fmt(ang)})`} class={ghost ? 'ship ghost' : 'ship'}>
      <line x1={-0.3} y1={0.07} x2={0.3} y2={0.07} class="ship-wake" stroke={fill} />
      <path d="M -0.2 0.01 L 0.2 0.01 L 0.13 0.11 L -0.13 0.11 Z" fill={fill} stroke={stroke} class="ship-hull" />
      <line x1={0} y1={0.01} x2={0} y2={-0.2} stroke={stroke} class="ship-mast" />
      <path d="M 0.01 -0.2 L 0.14 -0.01 L 0.01 -0.01 Z" fill={war ? '#222' : '#fff'} stroke={stroke} class="ship-sail" />
      {war && <path d="M -0.01 -0.19 L -0.12 -0.13 L -0.01 -0.08 Z" fill="#c62828" />}
    </g>
  );
}

function Robber({ p }: { p: Pt }) {
  const x = p.x + 0.28;
  const y = p.y - 0.05;
  return (
    <g class="robber">
      <ellipse cx={x} cy={y + 0.2} rx={0.13} ry={0.05} class="shadow" />
      <path d={`M ${x - 0.11} ${y + 0.2} Q ${x} ${y - 0.12} ${x + 0.11} ${y + 0.2} Z`} class="robber-body" />
      <circle cx={x} cy={y - 0.08} r={0.08} class="robber-body" />
    </g>
  );
}

function PirateShip({ p }: { p: Pt }) {
  return (
    <g class="pirate" transform={`translate(${fmt(p.x)} ${fmt(p.y)}) scale(1.4)`}>
      <path d="M -0.2 0.01 L 0.2 0.01 L 0.13 0.12 L -0.13 0.12 Z" class="pirate-hull" />
      <line x1={0} y1={0.01} x2={0} y2={-0.22} class="pirate-mast" />
      <path d="M 0.01 -0.22 L 0.16 -0.02 L 0.01 -0.02 Z" class="pirate-sail" />
      <T x={0.07} y={-0.06} s={0.1} cls="pirate-skull">
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
    return <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} class={ghost.kind === 'harbor' ? 'ghost-harbor' : 'road ghost'} stroke={col.fill} />;
  }
  const c = g.centers[ghost.id];
  if (!c) return null;
  return <g class="ghost">{ghost.kind === 'robber' ? <Robber p={c} /> : <PirateShip p={c} />}</g>;
}
