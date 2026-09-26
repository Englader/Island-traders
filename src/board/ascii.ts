import type { HexId, HexState } from '../core/types.js';
import { axialToOffset, parseHexId } from './hex.js';

const CODE: Record<string, string> = {
  sea: '~',
  hills: 'h',
  forest: 'f',
  pasture: 'p',
  fields: 'g',
  mountains: 'm',
  desert: 'd',
  gold: '$',
  fog: 'x',
};

/**
 * Renders a board as odd-r offset ASCII (the same layout the map format uses),
 * e.g. for debugging scenario maps: `m8 ~  h5`.
 */
export function renderAscii(hexes: Record<HexId, HexState>, opts: { zones?: boolean } = {}): string {
  const cells = new Map<string, string>();
  let minCol = Infinity;
  let maxCol = -Infinity;
  let minRow = Infinity;
  let maxRow = -Infinity;
  for (const [id, h] of Object.entries(hexes)) {
    const { col, row } = axialToOffset(parseHexId(id));
    let s = CODE[h.terrain] + (h.token ?? '');
    if (opts.zones && h.zone) s += '@' + h.zone.slice(0, 3);
    cells.set(`${col},${row}`, s);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  }
  const w = Math.max(...[...cells.values()].map((s) => s.length)) + 1;
  const lines: string[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    let line = row & 1 ? ' '.repeat(Math.ceil(w / 2)) : '';
    for (let col = minCol; col <= maxCol; col++) line += (cells.get(`${col},${row}`) ?? '.').padEnd(w);
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}
