import { shade } from '../board/Board';

export type PieceKind = 'road' | 'ship' | 'settlement' | 'city' | 'dev';

type Poly = Array<[number, number]>;
const pts = (p: Poly) => p.map(([x, y]) => `${x},${y}`).join(' ');

/** The same faces the board draws for a settlement and a city (see Board.tsx). */
const HOUSE = (fill: string, light: string, dark: string): Array<[Poly, string]> => [
  [[[0.05, 0.11], [0.13, 0.06], [0.13, -0.05], [0.05, -0.01]], dark],
  [[[-0.13, 0.11], [0.05, 0.11], [0.05, -0.01], [-0.13, -0.01]], fill],
  [[[-0.13, -0.01], [0.05, -0.01], [-0.04, -0.12]], fill],
  [[[-0.04, -0.12], [0.05, -0.01], [0.13, -0.05], [0.04, -0.16]], light],
];
const HALL = (fill: string, light: string, dark: string): Array<[Poly, string]> => [
  [[[0.08, 0.12], [0.17, 0.07], [0.17, -0.05], [0.08, 0.0]], dark],
  [[[-0.2, 0.12], [0.08, 0.12], [0.08, 0.0], [-0.2, 0.0]], fill],
  [[[-0.2, 0.0], [0.08, 0.0], [0.17, -0.05], [-0.11, -0.05]], light],
  [[[-0.05, 0.0], [0.01, -0.03], [0.01, -0.21], [-0.05, -0.18]], dark],
  [[[-0.17, 0.0], [-0.05, 0.0], [-0.05, -0.18], [-0.17, -0.18]], fill],
  [[[-0.17, -0.18], [-0.05, -0.18], [-0.11, -0.3]], fill],
  [[[-0.05, -0.18], [0.01, -0.21], [-0.05, -0.33], [-0.11, -0.3]], light],
];

/**
 * A game piece drawn like the ones on the board, in a player's colours: for
 * the build buttons. `dev` is a face-down development card.
 */
export function PieceGlyph({ kind, fill, stroke }: { kind: PieceKind; fill: string; stroke: string }) {
  const light = shade(fill, 0.3);
  const dark = shade(fill, -0.3);
  if (kind === 'road') {
    const d = 'M-0.17 0.1 L0.17 -0.1';
    return (
      <svg viewBox="-0.25 -0.25 0.5 0.5" aria-hidden="true">
        <path d={d} transform="translate(0.02 0.05)" stroke="rgba(0,0,0,0.28)" stroke-width="0.13" stroke-linecap="round" fill="none" />
        <path d={d} transform="translate(0 0.04)" stroke={stroke} stroke-width="0.12" stroke-linecap="round" fill="none" />
        <path d={d} stroke={fill} stroke-width="0.11" stroke-linecap="round" fill="none" />
        <path d={d} stroke="rgba(255,255,255,0.45)" stroke-width="0.022" stroke-linecap="round" fill="none" />
      </svg>
    );
  }
  if (kind === 'settlement' || kind === 'city') {
    const faces = kind === 'city' ? HALL(fill, light, dark) : HOUSE(fill, light, dark);
    const box = kind === 'city' ? '-0.25 -0.37 0.46 0.55' : '-0.19 -0.22 0.38 0.4';
    return (
      <svg viewBox={box} aria-hidden="true">
        <ellipse cx="0.02" cy={kind === 'city' ? 0.135 : 0.12} rx={kind === 'city' ? 0.22 : 0.16} ry="0.045" fill="rgba(0,0,0,0.25)" />
        {faces.map(([p, f], i) => (
          <polygon key={i} points={pts(p)} fill={f} stroke={stroke} stroke-width="0.016" stroke-linejoin="round" />
        ))}
      </svg>
    );
  }
  if (kind === 'ship') {
    return (
      <svg viewBox="-0.27 -0.3 0.54 0.48" aria-hidden="true">
        <ellipse cx="0.02" cy="0.13" rx="0.24" ry="0.05" fill="rgba(0,0,0,0.25)" />
        <path d="M -0.22 0.0 L 0.22 0.0 L 0.14 0.11 L -0.14 0.11 Z" fill={fill} stroke={stroke} stroke-width="0.018" stroke-linejoin="round" />
        <path d="M -0.22 0.0 L 0.22 0.0 L 0.2 0.03 L -0.2 0.03 Z" fill={light} />
        <line x1="0" y1="0" x2="0" y2="-0.24" stroke={stroke} stroke-width="0.022" />
        <path d="M 0.012 -0.23 Q 0.17 -0.12 0.15 -0.02 L 0.012 -0.02 Z" fill="#fbfaf5" stroke={stroke} stroke-width="0.016" stroke-linejoin="round" />
        <path d="M -0.012 -0.2 Q -0.11 -0.12 -0.1 -0.03 L -0.012 -0.03 Z" fill="#e9e6db" stroke={stroke} stroke-width="0.016" stroke-linejoin="round" />
      </svg>
    );
  }
  // a face-down development card
  return (
    <svg viewBox="0 0 30 34" aria-hidden="true">
      <rect x="6.5" y="3.5" width="18" height="26" rx="3" fill="rgba(0,0,0,0.22)" transform="rotate(8 15 17)" />
      <rect x="5" y="3" width="18" height="26" rx="3" fill="#6a48c4" stroke="#e9dcff" stroke-width="1.2" />
      <circle cx="14" cy="16" r="5.5" fill="#f1c140" stroke="#fff3c4" stroke-width="0.8" />
      <path d="M14 11.8 l1.1 2.6 2.8 0.2 -2.1 1.8 0.7 2.7 -2.5 -1.5 -2.5 1.5 0.7 -2.7 -2.1 -1.8 2.8 -0.2 Z" fill="#fff8e1" />
    </svg>
  );
}
