import { cornerVertex, getTopologyFor, parseHexId, vertexPoint, type GameView } from 'engine';

/*
 * Wide screens dock the game log in the bottom-left corner of the board.
 * Where the board leaves room free anyway (a wide map on a tall area, or the
 * other way round), its frame is moved away from the log so the islands
 * clear it; the board is never made smaller for it.
 */

// The board's projection and the margin it keeps around the land (see `fit` in board/Board.tsx).
const TILT = 0.8;
const DEPTH = 0.2;
const PAD = 0.5;
const PAD_TOP = 0.35;

export interface Size {
  w: number;
  h: number;
}

/** The land and its margin, in board units: what the board fits to the screen. */
export function landBox(view: GameView): Size {
  const t = getTopologyFor(view.board.layoutKey);
  const all = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const land = { ...all };
  for (const h of t.hexIds) {
    const onLand = view.board.hexes[h]?.terrain !== 'sea';
    const a = parseHexId(h);
    for (let i = 0; i < 6; i++) {
      const p = vertexPoint(cornerVertex(a, i));
      for (const b of onLand ? [all, land] : [all]) {
        b.x0 = Math.min(b.x0, p.x);
        b.x1 = Math.max(b.x1, p.x);
        b.y0 = Math.min(b.y0, p.y * TILT);
        b.y1 = Math.max(b.y1, p.y * TILT + DEPTH);
      }
    }
  }
  const src = Number.isFinite(land.x0) ? land : all;
  const x0 = Math.max(all.x0, src.x0 - PAD);
  const y0 = Math.max(all.y0, src.y0 - PAD - PAD_TOP);
  const x1 = Math.min(all.x1, src.x1 + PAD);
  const y1 = Math.min(all.y1, src.y1 + PAD);
  return { w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * How far to pull the board's frame in from the left and from the bottom so
 * the board clears a log of size `log` (with its margins) in the corner,
 * using only the room the fitted board leaves free.
 */
export function roomForLog(area: Size, land: Size, log: Size): { left: number; bottom: number } {
  const scale = Math.min(area.w / land.w, area.h / land.h);
  const spareX = Math.max(0, area.w - land.w * scale);
  const spareY = Math.max(0, area.h - land.h * scale);
  // The board sits in the middle of its frame: moving one edge by s moves the
  // board by s/2. Some room stays on the far side for the harbors on the coast.
  const left = Math.min(Math.max(0, spareX - 40), Math.max(0, 2 * log.w - spareX));
  const bottom = Math.min(Math.max(0, spareY - 16), Math.max(0, 2 * log.h - spareY));
  return { left: Math.floor(left), bottom: Math.floor(bottom) };
}
