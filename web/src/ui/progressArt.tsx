import type { ProgressCardName } from 'engine';
import type { JSX } from 'preact';
import { Bolt, Cloud, CoinStack, Log, Pine } from './cards';
import { MerchantShape } from './ckArt';

/*
 * The progress cards' pictures: one painted scene per card, drawn for Island
 * Traders in the style of its resource and development cards (ui/cards.tsx).
 * All of it is original SVG.
 *
 * Scenes are drawn in a 52 x 44 window with the subject in the middle: the
 * small cards crop the sides, the full card (with its rule text) the top and
 * bottom.
 */

export const SCENE_W = 52;
export const SCENE_H = 44;
const W = SCENE_W;
const H = SCENE_H;

function Sky({ id, top, bottom }: { id: string; top: string; bottom: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={top} />
          <stop offset="1" stop-color={bottom} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id})`} />
    </>
  );
}

/** A soft shadow on the ground. */
function Shade({ cx, cy, rx, ry = 1.4 }: { cx: number; cy: number; rx: number; ry?: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#000" opacity="0.18" />;
}

/** A four-pointed glint. */
function Glint({ x, y, s = 1, fill = '#fff' }: { x: number; y: number; s?: number; fill?: string }) {
  return <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 -2 L0.5 -0.5 L2 0 L0.5 0.5 L0 2 L-0.5 0.5 L-2 0 L-0.5 -0.5 Z" fill={fill} />;
}

const PIP_AT: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** A die face, 8 wide, centred on (x, y). */
function DieFace({ x, y, n, red, turn = 0 }: { x: number; y: number; n: number; red?: boolean; turn?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${turn})`}>
      <rect x="-4" y="-3.4" width="8" height="8" rx="1.7" fill={red ? '#8e1f18' : '#b9b1a0'} />
      <rect x="-4" y="-4" width="8" height="8" rx="1.7" fill={red ? '#cc352b' : '#fbf8ef'} stroke={red ? '#6e1a14' : '#5a5246'} stroke-width="0.45" />
      {PIP_AT[n].map(([dx, dy], i) => (
        <circle key={i} cx={dx * 2.1} cy={dy * 2.1} r="0.85" fill={red ? '#fff6e8' : '#2a2620'} />
      ))}
    </g>
  );
}

/** A number token as the board draws it: a cream disc, the number and its dots. */
function Token({ x, y, n, r = 6.6 }: { x: number; y: number; n: number; r?: number }) {
  const dots = 6 - Math.abs(7 - n);
  const red = n === 6 || n === 8;
  return (
    <g>
      <ellipse cx={x + 0.5} cy={y + 1.2} rx={r} ry={r * 0.92} fill="#000" opacity="0.22" />
      <circle cx={x} cy={y} r={r} fill="#fbf1d8" stroke="#8a6d3b" stroke-width="0.7" />
      <circle cx={x} cy={y} r={r - 1.3} fill="none" stroke="#e2cf9f" stroke-width="0.5" />
      <text x={x} y={y + 1.6} text-anchor="middle" font-size={r * 0.95} font-weight="800" font-family="'Baloo 2', system-ui, sans-serif" fill={red ? '#c0392b' : '#2b1d00'}>
        {n}
      </text>
      {Array.from({ length: dots }, (_, i) => (
        <circle key={i} cx={x + (i - (dots - 1) / 2) * 1.1} cy={y + r * 0.58} r="0.42" fill={red ? '#c0392b' : '#2b1d00'} />
      ))}
    </g>
  );
}

/** A knight's helmet, about 8 wide, its rim at (x, y). */
function Helm({ x, y, s = 1, lit, plume }: { x: number; y: number; s?: number; lit?: boolean; plume?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {plume && <path d="M0.6 -8 Q3 -12.5 7.5 -11.2 Q4.6 -10 3.6 -7.4 Z" fill={plume} stroke="#4a1410" stroke-width="0.35" />}
      <path d="M-4 0 V-4.4 Q-4 -8.6 0 -8.6 Q4 -8.6 4 -4.4 V0 Z" fill={lit ? '#eef2f6' : '#b7bec8'} stroke="#4c5058" stroke-width="0.5" />
      <path d="M1 -8.5 Q4 -8 4 -4.4 V0 H1 Z" fill={lit ? '#c3ccd8' : '#949ba6'} />
      <rect x="-3.2" y="-5" width="6.4" height="1.15" rx="0.3" fill="#1b1b1f" />
      <path d="M0 -3.4 V-0.6" stroke="#4c5058" stroke-width="0.5" />
      <path d="M-4 -0.5 H4" stroke={lit ? '#e9b726' : '#8a8f97'} stroke-width="0.9" />
    </g>
  );
}

/** A small cog with a square sail, its waterline at (x, y). */
function Cog({ x, y, s = 1, sail = '#f6ecd2', stripe = '#e9b726', flag = '#e9b726' }: { x: number; y: number; s?: number; sail?: string; stripe?: string; flag?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M0 -15 V0" stroke="#4a2c12" stroke-width="0.7" />
      <path d="M0 -15 L4 -14 L0 -13 Z" fill={flag} />
      <path d="M-6 -12.5 Q0 -13.3 6 -12.5 L5.4 -3.6 Q0 -2.6 -5.4 -3.6 Z" fill={sail} stroke="#7a6a50" stroke-width="0.4" />
      <path d="M-5.9 -9.6 Q0 -10.3 5.9 -9.6 M-5.7 -6.6 Q0 -7.2 5.7 -6.6" stroke={stripe} stroke-width="1.3" fill="none" />
      <path d="M-9 -2.4 Q-8.6 0.6 -6 1.4 H6 Q8.6 0.6 9 -2.4 Z" fill="#8a5a2b" stroke="#4a2c12" stroke-width="0.5" />
      <path d="M-8.6 -1.2 H8.6" stroke="#6b4524" stroke-width="0.5" />
    </g>
  );
}

/** Small houses on a hillside, for a town in the distance. */
function Town({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const houses: Array<[number, number, number, string]> = [
    [0, 0, 1, '#a3542f'],
    [4.4, -1.2, 1.15, '#b8432f'],
    [9, 0.2, 0.95, '#a3542f'],
  ];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} stroke="#5a3616" stroke-width="0.35">
      {houses.map(([hx, hy, k, roof], i) => (
        <g key={i} transform={`translate(${hx} ${hy}) scale(${k})`}>
          <rect x="-1.8" y="-2.6" width="3.6" height="2.6" fill="#efe2c1" />
          <path d="M-2.3 -2.4 L0 -4.6 L2.3 -2.4 Z" fill={roof} />
        </g>
      ))}
      <rect x="5.6" y="-6.6" width="1.4" height="5" fill="#d9d0bd" />
      <path d="M5.3 -6.4 L6.3 -8.2 L7.3 -6.4 Z" fill="#7d4e2d" />
    </g>
  );
}

const SCENES: Record<ProgressCardName, () => JSX.Element> = {
  // --- science (green) --------------------------------------------------------------------
  /** Alchemist: a flask bubbling over a flame, the two production dice rising in its vapour. */
  alchemist: () => (
    <g>
      <defs>
        <radialGradient id="pg-alch" cx="0.5" cy="0.5" r="0.7">
          <stop offset="0" stop-color="#bfe8c4" />
          <stop offset="0.45" stop-color="#4f6a7e" />
          <stop offset="1" stop-color="#262c3c" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#pg-alch)" />
      {/* a shelf of jars */}
      <rect x="0" y="9.4" width={W} height="1.4" fill="#5a3616" />
      <g stroke="#2a1e14" stroke-width="0.35">
        <rect x="3" y="5" width="3.4" height="4.4" rx="0.8" fill="#8fbf6a" />
        <rect x="7.4" y="3.6" width="2.6" height="5.8" rx="0.8" fill="#c96a3a" />
        <rect x="42" y="4.6" width="3" height="4.8" rx="0.8" fill="#6aa5d0" />
        <rect x="46" y="6" width="3.6" height="3.4" rx="0.8" fill="#e9c454" />
      </g>
      {/* the bench */}
      <rect x="0" y="35.4" width={W} height="8.6" fill="#6b4524" />
      <rect x="0" y="35" width={W} height="1.4" fill="#9b6233" />
      {/* the burner and its tripod */}
      <path d="M23.2 35.2 Q26 28.8 28.8 35.2 Z" fill="#f2a33a" />
      <path d="M24.8 35.2 Q26 31.4 27.2 35.2 Z" fill="#ffe08a" />
      <g stroke="#3a3a40" stroke-width="0.8" stroke-linecap="round">
        <path d="M19.6 35.4 L22 30.2 M32.4 35.4 L30 30.2 M21.6 30.2 H30.4" />
      </g>
      {/* the flask */}
      <path d="M24 16.6 V21.6 Q17.6 24.2 18 28.6 Q18.8 33.4 26 33.4 Q33.2 33.4 34 28.6 Q34.4 24.2 28 21.6 V16.6 Z" fill="#e6f7f1" fill-opacity="0.45" stroke="#2e4a52" stroke-width="0.6" />
      <path d="M18.5 27.4 Q26 25.6 33.5 27.4 Q33.2 32.9 26 32.9 Q18.8 32.9 18.5 27.4 Z" fill="#5fd08f" />
      <path d="M20 28.6 Q26 27.6 31.6 28.8" stroke="#bff5d4" stroke-width="0.6" fill="none" />
      <circle cx="23" cy="30.6" r="0.8" fill="#d9fbe6" />
      <circle cx="27.6" cy="29.6" r="0.6" fill="#d9fbe6" />
      <circle cx="25.4" cy="25.2" r="0.6" fill="#d9fbe6" opacity="0.8" />
      <rect x="23.4" y="15.6" width="5.2" height="1.6" rx="0.6" fill="#cfe7e0" stroke="#2e4a52" stroke-width="0.5" />
      {/* the vapour carries the dice up */}
      <path d="M26 15 Q22.4 12 25.6 9.4 Q28.6 7 25.4 3.6" stroke="#d9f7df" stroke-width="1.6" fill="none" opacity="0.65" stroke-linecap="round" />
      <path d="M26 15 Q31 12.8 34.4 13.6 M26 15 Q20 12.6 17 14" stroke="#d9f7df" stroke-width="1" fill="none" opacity="0.5" stroke-linecap="round" />
      <DieFace x={13} y={13.6} n={4} turn={-14} />
      <DieFace x={39.4} y={14} n={3} red turn={12} />
      <Glint x={7.6} y={20} s={0.9} fill="#e8ffe9" />
      <Glint x={45} y={21.4} s={0.7} fill="#e8ffe9" />
      <Glint x={33} y={6} s={0.6} fill="#e8ffe9" />
    </g>
  ),
  /** Crane: a treadwheel crane hoists a stone onto a tower under construction. */
  crane: () => (
    <g>
      <Sky id="pg-sky-crane" top="#a9d8f0" bottom="#f3ead2" />
      <Cloud x={42} y={6} s={0.8} />
      <path d={`M0 34 Q26 30 ${W} 34 V${H} H0 Z`} fill="#8cbf5a" />
      {/* the tower, scaffolded */}
      <g stroke="#6f675c" stroke-width="0.5">
        <path d="M30 34 V19 H32 V17.4 H34.6 V19 H37.4 V16.8 H40 V19 H42 V20.4 H44 V34 Z" fill="#cfc7b8" />
        <path d="M30 23.4 H44 M30 28 H44 M33 19 V23.4 M38 23.4 V28 M35 28 V34 M41 28 V34" fill="none" stroke="#a69d8e" />
        <path d="M35.6 34 V30.6 A1.6 1.6 0 0 1 38.8 30.6 V34 Z" fill="#3a3028" />
      </g>
      <g stroke="#8a5a2b" stroke-width="0.7" stroke-linecap="round">
        <path d="M29 34.4 V17 M45 34.4 V19 M29 25 H45 M29 31 H45" />
      </g>
      {/* the crane: an A-frame, its boom, the rope and the stone */}
      <g stroke="#5a3616" stroke-linecap="round">
        <path d="M7 35 L14 12.6 L21 35" stroke-width="1.4" fill="none" />
        <path d="M9.4 27 H18.6" stroke-width="0.8" />
        <path d="M14 12.6 L37.6 7.4" stroke-width="1.3" />
        <path d="M14 12.6 L11 6 L37.6 7.4" stroke-width="0.45" fill="none" />
      </g>
      <path d="M37.6 7.4 V12.4" stroke="#3a2a1e" stroke-width="0.45" />
      <path d="M36.8 12.4 h1.6 l-0.8 1.2 Z" fill="#3a3a40" />
      <rect x="34.4" y="13.4" width="6.4" height="4" rx="0.4" fill="#bdb4a4" stroke="#6f675c" stroke-width="0.5" />
      <path d="M34.4 15.4 H40.8" stroke="#a69d8e" stroke-width="0.4" />
      {/* the treadwheel */}
      <circle cx="14" cy="29.2" r="5.6" fill="none" stroke="#7a4a22" stroke-width="1.3" />
      <path d="M14 23.6 V34.8 M8.4 29.2 H19.6 M10 25.2 L18 33.2 M18 25.2 L10 33.2" stroke="#9b6233" stroke-width="0.55" />
      <circle cx="14" cy="29.2" r="1" fill="#5a3616" />
      <Shade cx={26} cy={35.4} rx={20} />
    </g>
  ),
  /** Engineer: a new stretch of city wall, its plan unrolled in front with a pair of dividers. */
  engineer: () => (
    <g>
      <Sky id="pg-sky-eng" top="#9fd3ee" bottom="#eef3e2" />
      <Cloud x={12} y={6} s={0.7} />
      <path d={`M0 20 Q18 14 34 18 T${W} 16 V${H} H0 Z`} fill="#6fae5a" />
      {/* the wall with two towers and a gate */}
      <g stroke="#6f675c" stroke-width="0.5">
        <path d="M8 31 V19 H10 V20.6 H12 V19 H14 V20.6 H16 V19 H18 V20.6 H20 V19 H22 V20.6 H24 V19 H26 V20.6 H28 V19 H30 V20.6 H32 V19 H34 V20.6 H36 V19 H38 V20.6 H40 V19 H44 V31 Z" fill="#cfc7b8" />
        <path d="M2 31 V14.6 H3.6 V13 H5.4 V14.6 H7 V13 H8.8 V14.6 H10.4 V31 Z" fill="#c4bcac" />
        <path d="M41.6 31 V14.6 H43.2 V13 H45 V14.6 H46.6 V13 H48.4 V14.6 H50 V31 Z" fill="#c4bcac" />
        <path d="M22 31 V25.4 A4 4 0 0 1 30 25.4 V31 Z" fill="#3a3028" />
        <path d="M10.4 24.4 H22 M30 24.4 H41.6 M2 22 H10.4 M41.6 22 H50 M15 20.6 V24.4 M36 20.6 V24.4 M16 24.4 V31 M36 24.4 V31" fill="none" stroke="#a69d8e" />
      </g>
      <path d="M5 18 h2.4 v2 h-2.4 Z M44.6 18 h2.4 v2 h-2.4 Z" fill="#3a3028" />
      <path d={`M0 31 Q26 29.4 ${W} 31 V${H} H0 Z`} fill="#86b955" />
      {/* the plan and the dividers */}
      <path d="M7 43.4 L11.6 33.6 H44.6 L41 43.4 Z" fill="#dcebf7" stroke="#3f6489" stroke-width="0.6" />
      <path d="M13.6 41 L16.4 35.6 H23 L20.4 41 Z M23.6 38.6 H35 M24.6 36.6 H37.4 M22.6 40.6 H31" stroke="#6d93b8" stroke-width="0.55" fill="none" />
      <g stroke="#5b6270" stroke-width="0.9" stroke-linecap="round">
        <path d="M33.6 30.4 L30.4 41.2 M33.6 30.4 L38.6 40" />
      </g>
      <circle cx="33.6" cy="30.4" r="1.1" fill="#d9a83a" stroke="#7a560c" stroke-width="0.4" />
    </g>
  ),
  /** Inventor: two number tokens trade places, with a cog turning behind them. */
  inventor: () => (
    <g>
      <defs>
        <radialGradient id="pg-inv" cx="0.5" cy="0.45" r="0.75">
          <stop offset="0" stop-color="#fff3d6" />
          <stop offset="1" stop-color="#d9b98a" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#pg-inv)" />
      {/* a cog behind */}
      <g transform="translate(26 22)" fill="#b98a55" opacity="0.4">
        <circle r="9.4" />
        {Array.from({ length: 10 }, (_, i) => (
          <rect key={i} x="-1.6" y="-12" width="3.2" height="4" rx="0.6" transform={`rotate(${i * 36})`} />
        ))}
        <circle r="3.4" fill="#fff3d6" />
      </g>
      <rect x="0" y="37" width={W} height="7" fill="#9b6233" />
      <rect x="0" y="36.4" width={W} height="1.2" fill="#b98a55" />
      <Token x={13.6} y={23.4} n={4} />
      <Token x={38.4} y={23.4} n={10} />
      {/* the swap */}
      <g fill="none" stroke-width="1.5" stroke-linecap="round">
        <path d="M15.6 13.8 Q26 4.6 35.4 13" stroke="#3f9a4a" />
        <path d="M36.4 33 Q26 42 16.6 34" stroke="#3f9a4a" />
      </g>
      <path d="M36.8 14.6 L33 13.6 L36 10.8 Z" fill="#3f9a4a" />
      <path d="M15.2 32.4 L19 33.6 L16 36.2 Z" fill="#3f9a4a" />
      <Glint x={26} y={23.4} s={1.1} fill="#f1c140" />
      <Glint x={7} y={9} s={0.7} fill="#fffaf0" />
    </g>
  ),
  /** Irrigation: a sluice lets water into a golden field. */
  irrigation: () => (
    <g>
      <Sky id="pg-sky-irr" top="#8fcbef" bottom="#fbeecb" />
      <circle cx="42" cy="8" r="4.6" fill="#ffd96a" />
      <circle cx="42" cy="8" r="7" fill="#ffd96a" opacity="0.25" />
      <path d={`M0 18 Q14 12 28 16 T${W} 14 V${H} H0 Z`} fill="#7fb55a" />
      <path d={`M0 21 Q26 17 ${W} 21 V${H} H0 Z`} fill="#eac24a" />
      <g stroke="#cf9f2a" stroke-width="0.6">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <path key={i} d={`M${-12 + i * 9} ${H} L${2 + i * 6} 21`} />
        ))}
      </g>
      {/* the channel */}
      <path d="M0 27.6 Q14 24.4 26 27.4 T52 25 V28 Q40 28.8 27 30.8 T0 31 Z" fill="#5aaee0" stroke="#2f7fb0" stroke-width="0.4" />
      <path d="M3 29 Q12 26.8 20 28.4 M30 28.6 Q38 27 46 26.8" stroke="#d6f0ff" stroke-width="0.6" fill="none" />
      {/* the sluice */}
      <g stroke="#4a2c12" stroke-width="0.5">
        <rect x="5" y="22" width="1.6" height="10" fill="#8a5a2b" />
        <rect x="11.4" y="21.4" width="1.6" height="10" fill="#8a5a2b" />
        <rect x="4.4" y="21" width="9.2" height="1.8" fill="#9b6233" />
        <rect x="6.6" y="24.6" width="4.8" height="2.6" fill="#b07a3c" />
      </g>
      {/* green shoots by the water, ripe ears in front */}
      <g stroke="#3f8f45" stroke-width="0.6" stroke-linecap="round">
        <path d="M18 31.6 l-0.8 -2.4 M19 31.6 l0.6 -2.6 M33 30.4 l-0.6 -2.6 M34 30.4 l0.8 -2.2 M44 29 l-0.6 -2.2" />
      </g>
      <g stroke="#a87a10" stroke-width="0.7" stroke-linecap="round">
        {[8, 16, 24, 32, 40, 47].map((x, i) => (
          <path key={x} d={`M${x} ${H} L${x + (i % 2 ? 1 : -1)} 35`} />
        ))}
      </g>
      <g fill="#f1c140" stroke="#a87a10" stroke-width="0.35">
        {[8, 16, 24, 32, 40, 47].map((x, i) => (
          <ellipse key={x} cx={x + (i % 2 ? 1 : -1)} cy={34} rx="1.1" ry="2.4" />
        ))}
      </g>
    </g>
  ),
  /** Medicine: herbs, a mortar and remedies, with a town on the hill behind. */
  medicine: () => (
    <g>
      <Sky id="pg-sky-med" top="#b8dcf0" bottom="#f4ecd8" />
      <path d={`M0 22 Q18 11 34 15 T${W} 16 V${H} H0 Z`} fill="#9ccf6a" />
      <Town x={30} y={15.4} s={1.1} />
      <Pine x={9} y={10} s={0.55} />
      <Pine x={15} y={12.4} s={0.45} />
      {/* the table */}
      <rect x="0" y="31.6" width={W} height="12.4" fill="#7a4a22" />
      <rect x="0" y="31" width={W} height="1.6" fill="#a8743f" />
      {/* the mortar and pestle */}
      <path d="M19 25 L26 18.4" stroke="#b9b0a1" stroke-width="2.4" stroke-linecap="round" />
      <path d="M9.4 25.4 Q9.6 31.6 16 31.8 Q22.4 31.6 22.6 25.4 Z" fill="#cfc7b8" stroke="#6f675c" stroke-width="0.6" />
      <ellipse cx="16" cy="25.4" rx="6.6" ry="1.7" fill="#e9e3d6" stroke="#6f675c" stroke-width="0.5" />
      <path d="M12 28 Q16 29.6 20 28" stroke="#a69d8e" stroke-width="0.5" fill="none" />
      {/* a bundle of herbs */}
      <g stroke="#2f6b35" stroke-width="0.5" stroke-linecap="round">
        <path d="M27 31 L30.6 21 M28.4 31 L31.6 22 M29.6 31 L33.2 21.6" />
      </g>
      <g fill="#58a85a">
        <ellipse cx="30.2" cy="21.6" rx="1" ry="2" transform="rotate(20 30.2 21.6)" />
        <ellipse cx="32.2" cy="22.4" rx="1" ry="2" transform="rotate(30 32.2 22.4)" />
        <ellipse cx="33.6" cy="21" rx="0.9" ry="1.8" transform="rotate(10 33.6 21)" />
        <ellipse cx="29.4" cy="24.2" rx="0.8" ry="1.6" transform="rotate(-20 29.4 24.2)" />
      </g>
      <path d="M27.6 28.4 L30.4 29.4" stroke="#c0392b" stroke-width="0.9" />
      {/* two remedies */}
      <g stroke="#2f5f7f" stroke-width="0.5">
        <rect x="36" y="22.4" width="6.6" height="9" rx="1.4" fill="#86c0e0" fill-opacity="0.9" />
        <rect x="38" y="19.4" width="2.6" height="3.2" fill="#cfe7f2" />
      </g>
      <rect x="37.8" y="18.4" width="3" height="1.6" rx="0.4" fill="#a8743f" />
      <rect x="37" y="25.4" width="4.6" height="3.2" fill="#fffaf0" />
      <path d="M39.3 28 Q37.8 26.4 39.3 25.8 Q40.8 26.4 39.3 28 Z" fill="#58a85a" />
      <g stroke="#7a4a10" stroke-width="0.5">
        <rect x="44" y="25.6" width="5" height="5.8" rx="1.2" fill="#e09a3a" />
        <rect x="45.4" y="23.8" width="2.2" height="2" fill="#f2c27a" />
      </g>
      <Shade cx={28} cy={32.2} rx={20} ry={0.8} />
    </g>
  ),
  /** Mining: a cart of ore rolls out of the mountain. */
  mining: () => (
    <g>
      <Sky id="pg-sky-mine" top="#9cc9e6" bottom="#e7edf2" />
      <path d={`M0 28 L11 8 L20 19 L32 4 L${W} 26 V${H} H0 Z`} fill="#8f97a3" />
      <path d="M20 19 L32 4 L35 17 Z M11 8 L15 20 L6 19 Z" fill="#6b7380" opacity="0.6" />
      <path d="M11 8 L14 13 L11.6 12.2 L8.6 13.4 Z M32 4 L36.2 9.6 L33 8.8 L29 10 Z" fill="#fff" />
      {/* the mine */}
      <path d="M4 32 V25 Q9 19 14 25 V32 Z" fill="#23262c" />
      <g fill="#8a5a2b" stroke="#5a3616" stroke-width="0.45">
        <rect x="3.2" y="23.6" width="1.6" height="8.4" />
        <rect x="13.2" y="23.6" width="1.6" height="8.4" />
        <rect x="2.6" y="22.6" width="12.8" height="1.6" />
      </g>
      <path d={`M0 32 Q26 29 ${W} 31 V${H} H0 Z`} fill="#77706a" />
      {/* rails */}
      <path d={`M0 40 H${W} M0 42.6 H${W}`} stroke="#4a4f58" stroke-width="0.7" />
      <g stroke="#6b4524" stroke-width="1">
        {[3, 9, 15, 21, 27, 33, 39, 45].map((x) => (
          <path key={x} d={`M${x} 39.4 V43.2`} />
        ))}
      </g>
      {/* the cart, heaped with ore */}
      <g stroke="#3f444c" stroke-width="0.5">
        <path d="M20 27 L23 25.4 L26 26.6 L29 24.4 L32.6 26 L35.6 25.6 L37 27.6 Z" fill="#9aa1ab" />
        <path d="M23 25.4 L25 28 L26 26.6 Z M29 24.4 L30 27.4 L32.6 26 Z" fill="#c9ced5" />
      </g>
      <path d="M26.4 26.2 l0.6 -1.2 l0.6 1.2 l-0.6 1.2 Z M33 25.6 l0.5 -1 l0.5 1 l-0.5 1 Z" fill="#8fd3ff" />
      <path d="M18.6 27.4 H38.4 L36 37 H21 Z" fill="#6d5a4a" stroke="#3a2a1e" stroke-width="0.6" />
      <path d="M19.6 30.6 H37.6 M20.6 33.8 H36.6" stroke="#4a3a2c" stroke-width="0.5" />
      <circle cx="23.6" cy="38.4" r="2.2" fill="#3a3a40" stroke="#1c1c20" stroke-width="0.4" />
      <circle cx="33.4" cy="38.4" r="2.2" fill="#3a3a40" stroke="#1c1c20" stroke-width="0.4" />
      <circle cx="23.6" cy="38.4" r="0.7" fill="#8a8f97" />
      <circle cx="33.4" cy="38.4" r="0.7" fill="#8a8f97" />
      {/* a pickaxe */}
      <path d="M41.4 40 L46.4 25.6" stroke="#8a5a2b" stroke-width="1.3" stroke-linecap="round" />
      <path d="M40.4 25.4 Q46 22.2 51.6 26.6 Q46.4 24.6 40.4 25.4 Z" fill="#8f97a3" stroke="#3f444c" stroke-width="0.5" />
    </g>
  ),
  /** Printer: a wooden press and a stack of freshly printed sheets. */
  printer: () => (
    <g>
      <Sky id="pg-sky-print" top="#ecdcb6" bottom="#cdb488" />
      <g stroke="#8a6d3b" stroke-width="0.6" opacity="0.5">
        <path d={`M0 6 H${W} M0 16 H${W}`} />
      </g>
      <rect x="0" y="37" width={W} height="7" fill="#9b6233" />
      {/* the press */}
      <g stroke="#3a2412" stroke-width="0.6">
        <rect x="11" y="5" width="3" height="32" fill="#8a5a2b" />
        <rect x="35" y="5" width="3" height="32" fill="#8a5a2b" />
        <rect x="9" y="4" width="31" height="3.6" rx="0.6" fill="#7a4a22" />
        <rect x="11" y="13.4" width="27" height="2.8" fill="#7a4a22" />
        <rect x="23" y="7.6" width="3" height="10.6" fill="#7d838d" />
        <rect x="16.6" y="19.2" width="15.8" height="2.4" fill="#6b4524" />
        <rect x="8" y="27.4" width="33" height="3" fill="#8a5a2b" />
        <rect x="8.6" y="30.4" width="2.6" height="6.6" fill="#7a4a22" />
        <rect x="37.8" y="30.4" width="2.6" height="6.6" fill="#7a4a22" />
      </g>
      <path d="M23 9.6 L26 11 M23 12 L26 13.4 M23 16.6 L26 18" stroke="#4a4f58" stroke-width="0.5" />
      <path d="M24.5 18.2 V19.2" stroke="#4a4f58" stroke-width="1" />
      <path d="M16 11.8 L33 9.4" stroke="#4a2c12" stroke-width="1.3" stroke-linecap="round" />
      <circle cx="16" cy="11.8" r="1" fill="#4a2c12" />
      <circle cx="33" cy="9.4" r="1" fill="#4a2c12" />
      <rect x="16" y="25.8" width="17" height="1.6" fill="#fffaf0" stroke="#b49a68" stroke-width="0.35" />
      {/* printed sheets, with a star for the victory point */}
      <g stroke="#8a6d3b" stroke-width="0.45">
        <path d="M36.4 42.6 L39 36.4 H51 L48.6 42.6 Z" fill="#efe2c1" />
        <path d="M36.8 41.4 L39.4 35.2 H51.4 L49 41.4 Z" fill="#fff8e6" />
      </g>
      <path d="M40.4 37.2 H46 M40 38.6 H44.6 M39.6 40 H45" stroke="#7a6a50" stroke-width="0.45" />
      <circle cx="47.6" cy="37.6" r="2.4" fill="#f1c140" stroke="#a87a10" stroke-width="0.4" />
      <path d="M47.6 36.2 l0.4 0.9 1 0.1 -0.7 0.7 0.2 1 -0.9 -0.5 -0.9 0.5 0.2 -1 -0.7 -0.7 1 -0.1 Z" fill="#fff8e1" />
    </g>
  ),
  /** Road Building: a new road is paved up the hill to a settlement. */
  roadBuilding: () => (
    <g>
      <Sky id="pg-sky-rb" top="#a9dbf2" bottom="#eef7df" />
      <Cloud x={40} y={6} s={0.7} />
      <path d={`M0 22 Q16 12 30 15 T${W} 17 V${H} H0 Z`} fill="#8fca58" />
      <path d={`M0 30 Q26 25 ${W} 30 V${H} H0 Z`} fill="#7cb84c" />
      {/* the road, paved at the front, staked out further up */}
      <path d="M13 44 Q21 31 23.6 16.4 H27.4 Q29.4 31 39 44 Z" fill="#c8b48a" stroke="#8a7650" stroke-width="0.5" />
      <path d="M23.6 16.4 Q22.4 23 20.6 28 M27.4 16.4 Q28.2 23 29.8 28" stroke="#fff" stroke-width="0.6" stroke-dasharray="1 1" fill="none" />
      <path d="M20.2 29 Q22 28 24 28.6 Q26.4 27.6 30.2 28.8 L39 44 H13 Z" fill="#b8a073" />
      <g fill="#d9c79d" stroke="#8a7650" stroke-width="0.35">
        {[
          [16, 41],
          [21.4, 41],
          [27, 41],
          [32.4, 41],
          [18.6, 37.2],
          [24, 37.2],
          [29.4, 37.2],
          [20.6, 33.4],
          [25.6, 33.4],
          [22.6, 30.2],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="4.2" height="2.6" rx="0.6" />
        ))}
      </g>
      {/* the settlement at the top */}
      <g stroke="#5a3616" stroke-width="0.45">
        <rect x="23" y="11.6" width="5" height="4" fill="#efe2c1" />
        <path d="M22.4 11.8 L25.5 8.6 L28.6 11.8 Z" fill="#a3542f" />
      </g>
      {/* a shovel and a heap of stones */}
      <path d="M42.4 40 L46 27" stroke="#8a5a2b" stroke-width="1.1" stroke-linecap="round" />
      <path d="M40.6 39 Q41.2 43.6 43.8 43.6 Q44.4 41 43.4 39.6 Z" fill="#8f97a3" stroke="#3f444c" stroke-width="0.4" transform="rotate(16 42.6 41)" />
      <g fill="#a8a29a" stroke="#5f5a52" stroke-width="0.35">
        <ellipse cx="7" cy="40" rx="2.2" ry="1.4" />
        <ellipse cx="10.2" cy="40.6" rx="2" ry="1.3" />
        <ellipse cx="8.6" cy="38.4" rx="1.9" ry="1.2" />
      </g>
    </g>
  ),
  /** Smith: a helmet on the anvil by the forge, the hammer raised. */
  smith: () => (
    <g>
      <defs>
        <radialGradient id="pg-smith" cx="0.12" cy="0.8" r="1">
          <stop offset="0" stop-color="#ffb347" />
          <stop offset="0.35" stop-color="#7a4a2a" />
          <stop offset="1" stop-color="#2a1e1a" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#pg-smith)" />
      {/* the forge */}
      <g stroke="#4a1a0c" stroke-width="0.4">
        <rect x="0" y="22" width="12" height="22" fill="#8c3f1e" />
        <path d="M0 26 H12 M0 30 H12 M0 34 H12 M0 38 H12 M4 22 V26 M8 26 V30 M4 30 V34 M8 34 V38" fill="none" />
      </g>
      <path d="M1.4 33 Q3 26 5 29 Q6 24 8 28.6 Q9.6 26 10.6 33 Z" fill="#f2a33a" />
      <path d="M3 33 Q5 29 6.4 31 Q7.6 28.8 9 33 Z" fill="#ffe08a" />
      <rect x="0" y="40" width={W} height="4" fill="#3a2a22" />
      {/* the anvil */}
      <g stroke="#1e2126" stroke-width="0.5">
        <path d="M19 27.4 H40.4 V30.8 H19 Q13 30.6 12 28.8 Q15 27.8 19 27.4 Z" fill="#4a4f58" />
        <path d="M23.4 30.8 H35.4 L33.4 35.6 H25.4 Z" fill="#3f444c" />
        <rect x="21.6" y="35.6" width="15" height="4.4" fill="#4a4f58" />
      </g>
      <path d="M19 27.9 H40" stroke="#8a929e" stroke-width="0.6" />
      {/* the helmet, glowing from the fire */}
      <Helm x={30.2} y={27.4} s={1.05} lit plume="#c0392b" />
      <path d="M26 27.2 Q30.2 25.4 34.4 27.2" stroke="#ffb347" stroke-width="0.6" fill="none" opacity="0.8" />
      {/* the hammer */}
      <path d="M44.6 9 L37.6 20.2" stroke="#8a5a2b" stroke-width="1.5" stroke-linecap="round" />
      <rect x="41" y="4.4" width="9.4" height="4.4" rx="0.6" fill="#6b6f78" stroke="#2a2d33" stroke-width="0.5" transform="rotate(32 45.7 6.6)" />
      {/* sparks */}
      <g stroke="#ffd34d" stroke-width="0.6" stroke-linecap="round">
        <path d="M35 18 l1.6 -2 M37.4 21.6 l2.4 -0.8 M32.4 17 l0 -2.2 M39.6 18.4 l1.8 -1.4" />
      </g>
      <Glint x={36.4} y={14.6} s={0.6} fill="#ffe08a" />
    </g>
  ),

  // --- politics (blue) ------------------------------------------------------------------------
  /** Bishop: a mitre and crozier before a stained-glass window, an offering bowl of coins. */
  bishop: () => (
    <g>
      <Sky id="pg-sky-bish" top="#ddd4c4" bottom="#b5a995" />
      {/* the window */}
      <path d="M15 37 V14 A11 11 0 0 1 37 14 V37 Z" fill="#294f8f" stroke="#6b5a3a" stroke-width="1.2" />
      <g stroke="#1d2a40" stroke-width="0.6">
        <path d="M15.6 22 H36.4 M15.6 30 H36.4 M22.4 14 V37 M29.6 14 V37" fill="none" />
        <circle cx="26" cy="11.6" r="3.6" fill="#e9b726" />
        <path d="M16 22 V16 Q17.6 9 22.4 6.6 V22 Z" fill="#3b78c9" />
        <path d="M29.6 6.6 Q34.4 9 36 16 V22 H29.6 Z" fill="#3b78c9" />
        <rect x="22.4" y="22" width="7.2" height="8" fill="#c8402f" />
        <rect x="15.6" y="22" width="6.8" height="8" fill="#e9b726" />
        <rect x="29.6" y="22" width="6.8" height="8" fill="#3f9a4a" />
        <rect x="22.4" y="30" width="7.2" height="7" fill="#b9d3f2" />
      </g>
      <path d="M26 14 L10 44 H42 Z" fill="#fff8d0" opacity="0.18" />
      <rect x="0" y="37" width={W} height="7" fill="#8a7a62" />
      {/* the mitre */}
      <g stroke="#7a560c" stroke-width="0.5">
        <path d="M8 38 V30 Q8.6 24 13.6 20 Q18.6 24 19.2 30 V38 Z" fill="#fbf6ea" />
        <path d="M12.4 20.8 V38 H14.8 V20.8 Q13.6 20.2 12.4 20.8 Z M8 31.6 H19.2 V33.6 H8 Z" fill="#e9b726" />
      </g>
      {/* the crozier */}
      <path d="M40.4 42 L42 13.6" stroke="#d9a83a" stroke-width="1.4" stroke-linecap="round" />
      <path d="M42 13.6 Q41.8 7.6 46.4 7.6 Q50 7.8 49.8 11.4 Q49.4 14.2 46.6 13.8" stroke="#d9a83a" stroke-width="1.4" fill="none" stroke-linecap="round" />
      {/* the bowl of coins */}
      <path d="M26 38.6 Q26.4 43 31 43 Q35.6 43 36 38.6 Z" fill="#8a5a2b" stroke="#4a2c12" stroke-width="0.5" />
      <ellipse cx="29.6" cy="38.2" rx="2" ry="0.8" fill="#f2c64e" stroke="#a87a10" stroke-width="0.35" />
      <ellipse cx="32.4" cy="37.6" rx="2" ry="0.8" fill="#e0a933" stroke="#a87a10" stroke-width="0.35" />
    </g>
  ),
  /** Constitution: a charter with its seal and a quill, before blue drapes. */
  constitution: () => (
    <g>
      <rect width={W} height={H} fill="#2f5fa8" />
      <g stroke="#173a7a" stroke-width="0.8" opacity="0.6">
        <path d="M4 0 Q2 22 5 44 M13 0 Q11 22 14 44 M39 0 Q41 22 38 44 M48 0 Q50 22 47 44" fill="none" />
      </g>
      <path d="M0 2 Q26 8 52 2" stroke="#e9b726" stroke-width="0.9" fill="none" />
      <rect x="0" y="34" width={W} height="10" fill="#6b4524" />
      <rect x="0" y="33.4" width={W} height="1.4" fill="#9b6233" />
      {/* the charter */}
      <rect x="11" y="8" width="29" height="25" fill="#f6ead0" stroke="#8a6d3b" stroke-width="0.6" />
      <rect x="9" y="6.2" width="33" height="3.4" rx="1.7" fill="#e8d3a8" stroke="#8a6d3b" stroke-width="0.5" />
      <rect x="9" y="31.4" width="33" height="3.4" rx="1.7" fill="#e8d3a8" stroke="#8a6d3b" stroke-width="0.5" />
      <path d="M17 13 H34" stroke="#7a6a50" stroke-width="1.2" />
      <path d="M14.4 17 H37 M14.4 19.8 H35 M14.4 22.6 H37 M14.4 25.4 H30" stroke="#b49a68" stroke-width="0.6" />
      {/* the seal */}
      <path d="M32.6 30.6 L31.4 35.4 L33.2 34.4 L34 36 L34.6 31" fill="#8e1f18" />
      <circle cx="34" cy="28.4" r="2.9" fill="#b83b32" stroke="#6e1a14" stroke-width="0.5" />
      <path d="M34 26.8 l0.5 1 1.1 0.1 -0.8 0.7 0.2 1.1 -1 -0.6 -1 0.6 0.2 -1.1 -0.8 -0.7 1.1 -0.1 Z" fill="#f1c140" />
      {/* the quill in its ink */}
      <path d="M44 38 V34.6 H49 V38 Q46.6 39 44 38 Z" fill="#23262c" />
      <path d="M46.4 34.8 Q46 24 50.6 14.6 Q51.6 22 47.4 34.8 Z" fill="#fbf8ef" stroke="#8a8f97" stroke-width="0.4" />
      <path d="M46.8 34.4 Q47.4 24 50.4 16" stroke="#8a8f97" stroke-width="0.35" fill="none" />
    </g>
  ),
  /** Deserter: a knight leaves the camp at dusk, a white flag over his shoulder. */
  deserter: () => (
    <g>
      <Sky id="pg-sky-des" top="#6c7fb0" bottom="#f2b880" />
      <path d={`M0 25 Q14 19 28 23 T${W} 22 V${H} H0 Z`} fill="#4d6a3c" />
      {/* the camp */}
      <g stroke="#173a7a" stroke-width="0.5">
        <path d="M1 27 L7 17 L13 27 Z" fill="#3b78c9" />
        <path d="M10 27 L15 19.4 L20 27 Z" fill="#5a8fd6" />
        <path d="M7 17 L7 27 M15 19.4 L15 27" />
      </g>
      <path d="M7 17 V12 M7 12 L11 13 L7 14" stroke="#3a2a1e" stroke-width="0.4" fill="#e9b726" />
      <path d={`M0 30 Q26 27 ${W} 30 V${H} H0 Z`} fill="#5f7f45" />
      {/* the path out */}
      <path d="M14 30 Q24 34 30 36 T52 40 V44 H44 Q36 41 28 39 T10 31 Z" fill="#b8a073" opacity="0.85" />
      <g fill="#8a7650">
        <ellipse cx="18" cy="32.8" rx="0.7" ry="0.4" />
        <ellipse cx="21" cy="34" rx="0.7" ry="0.4" />
        <ellipse cx="24" cy="34.6" rx="0.7" ry="0.4" />
      </g>
      {/* the knight, walking off */}
      <g stroke="#2c2e33" stroke-width="0.5" stroke-linejoin="round">
        <path d="M30.6 26 L28.6 36 L30.4 36.4 L32.4 27 Z" fill="#5b6270" />
        <path d="M33.6 26 L36.6 35.4 L38.4 34.8 L35.8 25.6 Z" fill="#5b6270" />
        <path d="M28.2 36 H31.2 V37.2 H27.6 Z M36.4 35 L39.2 34.2 L39.6 35.4 L36.6 36.2 Z" fill="#2c2e33" />
        <path d="M29.8 16.6 H36.4 L37.4 27 H29 Z" fill="#c8402f" />
        <path d="M29.4 22 H37" stroke="#e9b726" stroke-width="0.8" />
        <path d="M27 17.6 H30.6 V23 Q28.8 25.4 27 23 Z" fill="#8a5a2b" />
      </g>
      <Helm x={33} y={17} s={0.85} />
      {/* the white flag over the shoulder */}
      <path d="M34.6 21 L43.4 8" stroke="#6b4524" stroke-width="0.7" stroke-linecap="round" />
      <path d="M43.4 8 Q46.4 9.6 49 8.4 L48.4 13.6 Q45.4 14.6 42.2 13.2 Z" fill="#fbf8ef" stroke="#8a8f97" stroke-width="0.4" />
    </g>
  ),
  /** Diplomat: the end of a road is taken up, the treaty rolled beside it. */
  diplomat: () => (
    <g>
      <Sky id="pg-sky-dip" top="#a9d4f0" bottom="#eef3e2" />
      <Cloud x={14} y={7} s={0.8} />
      <Cloud x={42} y={4} s={0.55} />
      <path d={`M0 18 Q20 12 36 15 T${W} 14 V${H} H0 Z`} fill="#9fd060" />
      <path d={`M0 26 Q26 21 ${W} 26 V${H} H0 Z`} fill="#8cc254" />
      {/* a settlement and its road */}
      <g stroke="#5a3616" stroke-width="0.45">
        <rect x="3.6" y="29.4" width="5" height="4" fill="#efe2c1" />
        <path d="M3 29.6 L6.1 26.4 L9.2 29.6 Z" fill="#a3542f" />
      </g>
      <g stroke-linecap="round">
        <path d="M9 33 L18.6 29.6 L28.4 33" stroke="#6e1a14" stroke-width="3.4" fill="none" />
        <path d="M9 33 L18.6 29.6 L28.4 33" stroke="#c8402f" stroke-width="2.4" fill="none" />
      </g>
      {/* where the last piece was */}
      <path d="M28.4 33 L38.2 29.6" stroke="#5a3616" stroke-width="2.4" stroke-dasharray="1.2 1.2" stroke-linecap="round" opacity="0.6" />
      {/* the piece lifted away */}
      <g transform="rotate(-24 39 17)" stroke-linecap="round">
        <path d="M34 17 H44" stroke="#6e1a14" stroke-width="3.4" />
        <path d="M34 17 H44" stroke="#c8402f" stroke-width="2.4" />
      </g>
      <path d="M33.4 29 Q30 22 33.4 19.6" stroke="#2f5fa8" stroke-width="0.8" fill="none" stroke-linecap="round" />
      <path d="M32 20.6 L34.2 18.8 L34.4 21.4 Z" fill="#2f5fa8" />
      {/* the treaty */}
      <g stroke="#7d6234" stroke-width="0.5">
        <rect x="31" y="37.4" width="16" height="4.6" rx="2.3" fill="#f3e3bb" />
        <ellipse cx="46.6" cy="39.7" rx="1.3" ry="2.3" fill="#e4c98f" />
        <rect x="37.4" y="37.2" width="2" height="5" fill="#3b78c9" stroke="#173a7a" />
      </g>
      <path d="M38.4 42 L37.4 44 M38.4 42 L39.6 44" stroke="#3b78c9" stroke-width="0.7" />
    </g>
  ),
  /** Intrigue: a masquerade mask by candlelight under the moon. */
  intrigue: () => (
    <g>
      <Sky id="pg-sky-int" top="#16213d" bottom="#3a4a7a" />
      <path d="M44 4.4 A5 5 0 1 0 46.6 13.6 A4 4 0 1 1 44 4.4 Z" fill="#f4ecd2" />
      <g fill="#fff">
        <circle cx="8" cy="5" r="0.4" />
        <circle cx="18" cy="9" r="0.35" />
        <circle cx="30" cy="4" r="0.4" />
        <circle cx="37" cy="12" r="0.3" />
      </g>
      {/* the castle behind */}
      <path d="M0 26 H6 V22 H8 V24 H10 V22 H12 V26 H40 V20 H42 V22 H44 V20 H46 V22 H48 V20 H50 V26 H52 V44 H0 Z" fill="#1c2236" />
      <rect x="44" y="23" width="2" height="3" fill="#f2c64e" />
      <rect x="0" y="34" width={W} height="10" fill="#4a2f6a" />
      <path d="M0 34 Q26 32 52 34" stroke="#6a4a90" stroke-width="0.8" fill="none" />
      {/* the candle */}
      <rect x="6" y="29" width="3.4" height="9" fill="#f3e3bb" stroke="#b49a68" stroke-width="0.4" />
      <path d="M7.7 28.8 Q6.4 26.4 7.7 24 Q9 26.4 7.7 28.8 Z" fill="#ffd34d" />
      <circle cx="7.7" cy="26.8" r="5" fill="#ffd34d" opacity="0.18" />
      {/* the mask */}
      <path d="M38 34 L46 42" stroke="#d9a83a" stroke-width="1" stroke-linecap="round" />
      <path d="M14 23.6 Q18.6 19.6 24 22.4 Q26 23.4 28 22.4 Q33.4 19.6 38 23.6 Q37 30.6 31 30.4 Q28 29.6 26 27.4 Q24 29.6 21 30.4 Q15 30.6 14 23.6 Z" fill="#6a3fa0" stroke="#f1c140" stroke-width="0.7" />
      <ellipse cx="20.4" cy="25.4" rx="2.8" ry="1.6" fill="#16213d" />
      <ellipse cx="31.6" cy="25.4" rx="2.8" ry="1.6" fill="#16213d" />
      <path d="M17 22 Q20 20.8 23 22.4 M29 22.4 Q32 20.8 35 22" stroke="#f1c140" stroke-width="0.5" fill="none" />
      <path d="M37.6 22.8 Q42 14 47.4 13.6 Q44 17 40.6 23.4 Z" fill="#3b78c9" stroke="#173a7a" stroke-width="0.4" />
      <path d="M38.4 22.6 Q43 16 46 14.6" stroke="#b9d3f2" stroke-width="0.35" fill="none" />
    </g>
  ),
  /** Saboteur: a cart overturned on the road, its wheel off and its load spilled. */
  saboteur: () => (
    <g>
      <Sky id="pg-sky-sab" top="#b4c9d8" bottom="#efe2c8" />
      <path d={`M0 22 Q16 14 30 18 T${W} 17 V${H} H0 Z`} fill="#93b864" />
      <path d={`M0 28 Q26 25 ${W} 29 V${H} H0 Z`} fill="#c8b48a" />
      {/* the cart on its side */}
      <g stroke="#3a2412" stroke-width="0.5">
        <path d="M17 33 L23 18 L37 22 L32 37 Z" fill="#9b6233" />
        <path d="M19.6 30 L24.4 19.6 M23.4 31.6 L28 20.6 M27.4 33.4 L31.6 21.4" stroke="#7a4a22" />
        <path d="M32 37 L37 22 L39.4 23 L34.6 38 Z" fill="#7a4a22" />
      </g>
      {/* the wheel, off */}
      <ellipse cx="11" cy="37.6" rx="6" ry="2.6" fill="#6b4524" stroke="#3a2412" stroke-width="0.5" />
      <ellipse cx="11" cy="37.6" rx="4.4" ry="1.8" fill="none" stroke="#9b6233" stroke-width="0.4" />
      <path d="M5.2 37.6 H16.8 M11 35 V40.2 M7 36 L15 39.2 M15 36 L7 39.2" stroke="#8a5a2b" stroke-width="0.4" />
      {/* the load: bricks, a split sack, a log */}
      <g stroke="#6e2a12" stroke-width="0.4">
        <rect x="36" y="37" width="5" height="2.8" rx="0.4" fill="#d0663c" transform="rotate(-12 38.5 38.4)" />
        <rect x="41.4" y="38.6" width="5" height="2.8" rx="0.4" fill="#d0663c" transform="rotate(18 43.9 40)" />
      </g>
      <path d="M38 30 Q36.6 25.6 40 24.6 Q43.6 24 44 28 Q46 31.6 42.6 33 Q39 33.4 38 30 Z" fill="#e8d3a8" stroke="#8a6d3b" stroke-width="0.5" />
      <g fill="#f1c140">
        <circle cx="44.4" cy="33.6" r="0.6" />
        <circle cx="46" cy="34.6" r="0.5" />
        <circle cx="45" cy="35.8" r="0.55" />
        <circle cx="47.2" cy="36.4" r="0.45" />
      </g>
      <Log x={22} y={41} len={11} r={1.8} />
      {/* dust */}
      <g fill="#fff" opacity="0.55">
        <circle cx="27" cy="16" r="2" />
        <circle cx="30" cy="14.4" r="1.5" />
        <circle cx="15" cy="30" r="1.6" />
      </g>
    </g>
  ),
  /** Spy: a spyglass trained on three face-down progress cards. */
  spy: () => (
    <g>
      <defs>
        <radialGradient id="pg-spy" cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stop-color="#4f8a5a" />
          <stop offset="1" stop-color="#1c3a24" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#pg-spy)" />
      {/* the cards, fanned */}
      {(
        [
          ['#e9b726', '#8a6410', -16, 14],
          ['#3b78c9', '#173a7a', 0, 21],
          ['#3f9a4a', '#1d5a26', 16, 28],
        ] as Array<[string, string, number, number]>
      ).map(([fill, dark, turn, x], i) => (
        <g key={i} transform={`translate(${x} 22) rotate(${turn})`}>
          <rect x="-5.6" y="-8" width="11.2" height="16" rx="1.4" fill={fill} stroke="#fff6e0" stroke-width="0.8" />
          <rect x="-4.2" y="-6.6" width="8.4" height="13.2" rx="1" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="0.4" />
          <circle r="2.6" fill="#fffaf0" stroke={dark} stroke-width="0.4" />
        </g>
      ))}
      {/* the spyglass */}
      <g transform="rotate(-36 40 32)">
        <rect x="24" y="29.2" width="9" height="5.6" rx="0.8" fill="#d9a83a" stroke="#7a560c" stroke-width="0.5" />
        <rect x="32" y="29.8" width="9" height="4.4" rx="0.6" fill="#c99a3a" stroke="#7a560c" stroke-width="0.5" />
        <rect x="40" y="30.4" width="9" height="3.2" rx="0.5" fill="#b8872c" stroke="#7a560c" stroke-width="0.5" />
        <path d="M26 29.2 V34.8 M31 29.2 V34.8" stroke="#8a6410" stroke-width="0.6" />
        <ellipse cx="24" cy="32" rx="1.2" ry="2.8" fill="#bfe3f5" stroke="#7a560c" stroke-width="0.5" />
      </g>
      <Glint x={23.4} y={30.2} s={0.9} />
    </g>
  ),
  /** Warlord: the horn sounds and the banner rises over three helmets, all lit. */
  warlord: () => (
    <g>
      <Sky id="pg-sky-war" top="#8fb8e0" bottom="#f7c98b" />
      <path d={`M0 28 Q20 22 34 25 T${W} 24 V${H} H0 Z`} fill="#5f8f45" />
      {/* the banner */}
      <path d="M26 6 V30" stroke="#5a3616" stroke-width="0.9" />
      <circle cx="26" cy="5.4" r="0.9" fill="#d9a83a" />
      <path d="M26.4 7 H40 L37.6 12 L40 17 H26.4 Z" fill="#3b78c9" stroke="#173a7a" stroke-width="0.5" />
      <path d="M31.6 9.2 L33.4 12 L31.6 14.8 L29.8 12 Z" fill="#f1c140" />
      {/* the knights, active */}
      {[11, 26, 41].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={33.6} rx="5.8" ry="2" fill="#f1c140" opacity="0.55" />
          <Helm x={x} y={33} s={0.95} lit plume={x === 26 ? '#c0392b' : undefined} />
        </g>
      ))}
      {/* the horn */}
      <path d="M4 18 Q8 22 15 20.6 L16.6 23.6 Q8 26.6 3 20.6 Z" fill="#efe2c1" stroke="#8a6d3b" stroke-width="0.5" />
      <path d="M7 21.6 L8 23.6 M11 21.6 L11.4 24" stroke="#d9a83a" stroke-width="0.8" />
      <g stroke="#fff" stroke-width="0.6" fill="none" opacity="0.8" stroke-linecap="round">
        <path d="M18.4 19.6 Q19.6 22 18.6 24.6 M20.4 18.6 Q22 22 20.6 25.6" />
      </g>
      <rect x="0" y="40" width={W} height="4" fill="#4d7a38" />
    </g>
  ),
  /** Wedding: a bell under a flowered arch, two rings and the gifts. */
  wedding: () => (
    <g>
      <Sky id="pg-sky-wed" top="#fbe3e8" bottom="#f7f0d8" />
      {/* the arch */}
      <path d="M7 44 V20 Q7 6 26 6 Q45 6 45 20 V44" stroke="#5f9a35" stroke-width="2.4" fill="none" />
      <g>
        {(
          [
            [7, 30, '#f7b6c8'],
            [7.4, 21, '#fff'],
            [10.4, 12, '#f7b6c8'],
            [17, 7.4, '#fff'],
            [26, 6, '#f7b6c8'],
            [35, 7.4, '#fff'],
            [41.6, 12, '#f7b6c8'],
            [44.6, 21, '#fff'],
            [45, 30, '#f7b6c8'],
          ] as Array<[number, number, string]>
        ).map(([x, y, c], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="1.9" fill={c} stroke="#c9768e" stroke-width="0.35" />
            <circle cx={x} cy={y} r="0.6" fill="#f1c140" />
          </g>
        ))}
      </g>
      {/* the bell */}
      <path d="M26 7.6 V10" stroke="#8a6410" stroke-width="0.6" />
      <path d="M22 18 Q22.4 10.4 26 10.4 Q29.6 10.4 30 18 Q30.6 19 31 19.4 H21 Q21.4 19 22 18 Z" fill="#e9b726" stroke="#8a6410" stroke-width="0.5" />
      <circle cx="26" cy="20" r="0.9" fill="#8a6410" />
      <path d="M21.4 13 Q18 15 18.6 19 M30.6 13 Q34 15 33.4 19" stroke="#e78fa8" stroke-width="0.8" fill="none" />
      {/* two rings */}
      <circle cx="22.6" cy="27.6" r="4" fill="none" stroke="#c99a3a" stroke-width="1.6" />
      <circle cx="29.4" cy="27.6" r="4" fill="none" stroke="#e9b726" stroke-width="1.6" />
      <path d="M29.4 22.4 l1.2 -1.4 h-2.4 Z" fill="#bfe3f5" stroke="#7a9ab0" stroke-width="0.3" />
      <Glint x={33.6} y={23} s={0.6} />
      {/* the gifts */}
      <g stroke="#6e1a14" stroke-width="0.4">
        <rect x="12" y="35.4" width="8" height="7" fill="#c8402f" />
        <path d="M16 35.4 V42.4 M12 38.6 H20" stroke="#f1c140" stroke-width="0.9" />
      </g>
      <g stroke="#173a7a" stroke-width="0.4">
        <rect x="31" y="36.6" width="7.4" height="5.8" fill="#3b78c9" />
        <path d="M34.7 36.6 V42.4 M31 39.4 H38.4" stroke="#fff" stroke-width="0.9" />
      </g>
      <path d="M14 35.4 Q16 33 16 35.4 Q16 33 18 35.4" stroke="#f1c140" stroke-width="0.6" fill="none" />
    </g>
  ),

  // --- trade (yellow) ---------------------------------------------------------------------------
  /** Commercial Harbor: a cog moored at the quay among crates and cloth. */
  commercialHarbor: () => (
    <g>
      <Sky id="pg-sky-ch" top="#9fd3ee" bottom="#eaf4f8" />
      <Cloud x={14} y={6} s={0.7} />
      <rect x="0" y="26" width={W} height="18" fill="#3f8fc4" />
      <path d="M22 30 Q25 29 28 30 T34 30 M38 36 Q41 35 44 36 T50 36 M26 40 Q29 39 32 40" stroke="#bfe3f5" stroke-width="0.6" fill="none" />
      <Cog x={38} y={30} s={1.15} sail="#f6ecd2" stripe="#e9b726" flag="#c8402f" />
      {/* the quay */}
      <path d="M0 24 H22 V31 H0 Z" fill="#cdb98e" stroke="#8a7650" stroke-width="0.5" />
      <path d="M0 31 H22 V36 H0 Z" fill="#8a7a62" />
      <path d="M4 31 V36 M10 31 V36 M16 31 V36" stroke="#6b5e4a" stroke-width="0.4" />
      <path d="M20 26 L29 29.4" stroke="#8a5a2b" stroke-width="1.2" />
      {/* crates, a barrel, cloth */}
      <g stroke="#5a3616" stroke-width="0.45">
        <rect x="2.4" y="17" width="7" height="7" fill="#c89a5a" />
        <path d="M2.4 17 L9.4 24 M9.4 17 L2.4 24" stroke="#8a5a2b" />
        <rect x="9.6" y="19.4" width="5.6" height="4.6" fill="#b88a4a" />
        <path d="M15.6 24 V18.6 Q18 17.6 20.4 18.6 V24 Q18 25 15.6 24 Z" fill="#9b6233" />
        <path d="M15.6 20.4 Q18 21.4 20.4 20.4 M15.6 22.4 Q18 23.4 20.4 22.4" stroke="#5a3616" fill="none" />
      </g>
      <Bolt x={3.4} y={15.2} len={6.4} r={1.8} fill="#a24f9a" light="#d98ccf" dark="#5a1f55" />
      <g stroke="#3a3a3a" stroke-width="0.4" fill="none">
        <path d="M30 8 q1 -1 2 0 q1 -1 2 0 M44 12 q1 -1 2 0 q1 -1 2 0" />
      </g>
    </g>
  ),
  /** Master Merchant: the ledger, the scales and the takings on a counting table. */
  masterMerchant: () => (
    <g>
      <Sky id="pg-sky-mm" top="#d9c09a" bottom="#b0905e" />
      {/* shelves of goods */}
      <g stroke="#4a2c12" stroke-width="0.4">
        <rect x="0" y="10" width={W} height="1.4" fill="#6b4524" />
        <rect x="0" y="21" width={W} height="1.4" fill="#6b4524" />
      </g>
      <g stroke="#3a2412" stroke-width="0.35">
        <rect x="3" y="5" width="4" height="5" rx="0.8" fill="#86c0e0" />
        <rect x="8.4" y="6.4" width="3.6" height="3.6" rx="0.8" fill="#e09a3a" />
        <rect x="40" y="4.6" width="3.4" height="5.4" rx="0.8" fill="#8fbf6a" />
        <rect x="44.4" y="6" width="4.6" height="4" rx="0.8" fill="#c96a3a" />
      </g>
      <Bolt x={14} y={18.6} len={8} r={2.2} fill="#3e7cc4" light="#8fb8e8" dark="#1d3f70" />
      <Bolt x={30} y={18.6} len={8} r={2.2} fill="#a24f9a" light="#d98ccf" dark="#5a1f55" />
      {/* the counter */}
      <rect x="0" y="30.4" width={W} height="13.6" fill="#7a4a22" />
      <rect x="0" y="29.6" width={W} height="1.6" fill="#a8743f" />
      {/* the ledger */}
      <g stroke="#7d6234" stroke-width="0.4">
        <path d="M3 30 L6 24.4 H15 L13.6 30 Z" fill="#fbf3dc" />
        <path d="M13.6 30 L15 24.4 H24 L22.6 30 Z" fill="#f3e6c4" />
      </g>
      <path d="M6.6 26 H13 M6 27.4 H12.4 M5.4 28.8 H11.6 M15.8 26 H22 M15.4 27.4 H21.4" stroke="#a08a5c" stroke-width="0.4" />
      {/* the scales */}
      <path d="M36 29.6 V17.4 M29 19 H43" stroke="#7a560c" stroke-width="0.8" stroke-linecap="round" />
      <circle cx="36" cy="17" r="1" fill="#d9a83a" />
      <path d="M29 19 L26.6 25 H31.4 Z M43 19 L40.6 24 H45.4 Z" fill="none" stroke="#7a560c" stroke-width="0.4" />
      <path d="M26 25 Q29 27 32 25 Z M40 24 Q43 26 46 24 Z" fill="#d9a83a" stroke="#7a560c" stroke-width="0.4" />
      <ellipse cx="29" cy="24.4" rx="2" ry="0.7" fill="#f2c64e" stroke="#a87a10" stroke-width="0.3" />
      <rect x="41.6" y="20.4" width="3" height="4" rx="0.4" fill="#e8d3a8" stroke="#8a6d3b" stroke-width="0.3" transform="rotate(8 43 22.4)" />
      <CoinStack x={42} y={39} n={3} />
      <CoinStack x={30} y={40} n={2} />
      {/* a purse */}
      <path d="M8 40.6 Q6 35 10 33.6 L12.6 33.6 Q16.4 35 14.4 40.6 Q11.2 42 8 40.6 Z" fill="#7a4fb8" stroke="#3f2466" stroke-width="0.5" />
      <path d="M9.4 34.4 Q11.2 35.6 13 34.4" stroke="#f1c140" stroke-width="0.7" fill="none" />
    </g>
  ),
  /** Merchant: the travelling merchant on the road to market. */
  merchant: () => (
    <g>
      <Sky id="pg-sky-mer" top="#9fd3ee" bottom="#f3ecd6" />
      <Cloud x={10} y={6} s={0.7} />
      <path d={`M0 22 Q14 14 30 17 T${W} 13 V${H} H0 Z`} fill="#9fd060" />
      <Town x={38} y={14.6} s={1} />
      {/* a market tent by the town */}
      <path d="M31 18.6 L34.4 14.6 L37.8 18.6 Z" fill="#e9b726" stroke="#8a6410" stroke-width="0.35" />
      <path d="M32.6 18.6 L34.4 14.6 L36 18.6" fill="#fff" />
      <path d={`M0 30 Q26 26 ${W} 30 V${H} H0 Z`} fill="#8cc254" />
      {/* the road to it */}
      <path d="M2 44 Q16 34 26 28 Q32 24 36 19 H38.4 Q35 25 30 30 Q22 37 16 44 Z" fill="#d9c79d" stroke="#a08a5c" stroke-width="0.4" />
      {/* the merchant */}
      <g transform="translate(19 38.4) scale(62)">
        <MerchantShape fill="#b8432f" stroke="#5a1a10" />
      </g>
      <Shade cx={20} cy={39.2} rx={8} ry={1.2} />
    </g>
  ),
  /** Merchant Fleet: three cogs under sail, yellow and white. */
  merchantFleet: () => (
    <g>
      <Sky id="pg-sky-mf" top="#8fcbef" bottom="#e9f4fb" />
      <circle cx="44" cy="9" r="4" fill="#ffe08a" />
      <rect x="0" y="27" width={W} height="17" fill="#3f8fc4" />
      <path d={`M0 27 Q13 25.6 26 27 T${W} 27`} stroke="#9fd3ee" stroke-width="0.6" fill="none" />
      <Cog x={11} y={29} s={0.7} />
      <Cog x={41} y={29.6} s={0.75} sail="#fbf3dc" stripe="#c8402f" />
      <Cog x={26} y={37} s={1.2} />
      <path d="M4 34 Q7 33 10 34 T16 34 M34 41 Q37 40 40 41 T46 41 M8 41 Q11 40 14 41" stroke="#bfe3f5" stroke-width="0.6" fill="none" />
      <g stroke="#3a3a3a" stroke-width="0.4" fill="none">
        <path d="M17 9 q1 -1 2 0 q1 -1 2 0 M30 6 q0.8 -0.8 1.6 0 q0.8 -0.8 1.6 0" />
      </g>
    </g>
  ),
  /** Resource Monopoly: a stall piled with every resource. */
  resourceMonopoly: () => (
    <g>
      <Sky id="pg-sky-rm" top="#a9d4f0" bottom="#f5ecd8" />
      {/* the awning */}
      <path d="M2 4 H50 L48 12 H4 Z" fill="#fff" stroke="#8a6410" stroke-width="0.4" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M${2 + i * 8} 4 H${6 + i * 8} L${5.7 + i * 7.33} 12 H${4 + i * 7.33} Z`} fill="#e9b726" />
      ))}
      <path d="M4 12 Q6 14 8 12 Q10 14 12 12 Q14 14 16 12 Q18 14 20 12 Q22 14 24 12 Q26 14 28 12 Q30 14 32 12 Q34 14 36 12 Q38 14 40 12 Q42 14 44 12 Q46 14 48 12" fill="#e9b726" stroke="#8a6410" stroke-width="0.4" />
      <rect x="5" y="12" width="1.8" height="22" fill="#8a5a2b" />
      <rect x="45.2" y="12" width="1.8" height="22" fill="#8a5a2b" />
      {/* the counter */}
      <rect x="0" y="32.6" width={W} height="11.4" fill="#8a5a2b" />
      <rect x="0" y="32" width={W} height="1.6" fill="#b07a3c" />
      {/* bricks */}
      <g stroke="#6e2a12" stroke-width="0.35">
        <rect x="3" y="28.6" width="4.6" height="3.4" rx="0.4" fill="#d0663c" />
        <rect x="7.8" y="28.6" width="4.6" height="3.4" rx="0.4" fill="#d0663c" />
        <rect x="5.4" y="25.2" width="4.6" height="3.4" rx="0.4" fill="#d0663c" />
      </g>
      {/* logs */}
      <Log x={13.4} y={30.2} len={8} r={1.8} />
      <Log x={15.4} y={26.8} len={7} r={1.6} />
      {/* wool */}
      <g fill="#fdfdf8" stroke="#9a9a8e" stroke-width="0.4">
        <circle cx="25.6" cy="28.6" r="2.4" />
        <circle cx="28.2" cy="27.6" r="2.6" />
        <circle cx="27" cy="30" r="2.2" />
      </g>
      {/* grain */}
      <g stroke="#a87a10" stroke-width="0.5" stroke-linecap="round">
        <path d="M34 32 L33 22.4 M35 32 L35 22 M36 32 L37 22.4" />
      </g>
      <g fill="#f1c140" stroke="#a87a10" stroke-width="0.3">
        <ellipse cx="33" cy="22" rx="0.9" ry="2" />
        <ellipse cx="35" cy="21.4" rx="0.9" ry="2" />
        <ellipse cx="37" cy="22" rx="0.9" ry="2" />
      </g>
      <rect x="33.4" y="27" width="3.2" height="1.2" fill="#c0392b" />
      {/* ore */}
      <path d="M39.4 32 L41 27.6 L44.6 26.6 L47.6 29.6 L46.6 32 Z" fill="#9aa1ab" stroke="#3f444c" stroke-width="0.4" />
      <path d="M41 27.6 L42.6 30 L44.6 26.6 Z" fill="#c9ced5" />
      <path d="M43.6 29 l0.5 -1 l0.5 1 l-0.5 1 Z" fill="#8fd3ff" />
      {/* the price sign */}
      <rect x="20" y="36" width="12" height="5.4" rx="0.8" fill="#fbf3dc" stroke="#8a6410" stroke-width="0.4" />
      <path d="M22.4 38.6 H29.6 M23.4 40 H28.6" stroke="#8a6410" stroke-width="0.6" />
    </g>
  ),
  /** Trade Monopoly: a warehouse stacked with cloth, paper and coin. */
  tradeMonopoly: () => (
    <g>
      <Sky id="pg-sky-tm" top="#b88a52" bottom="#8a5a2b" />
      <g stroke="#6b4524" stroke-width="0.5" opacity="0.7">
        {[6, 14, 22, 30, 38, 46].map((x) => (
          <path key={x} d={`M${x} 0 V${H}`} />
        ))}
      </g>
      {/* the shelves */}
      <rect x="0" y="18" width={W} height="1.6" fill="#4a2c12" />
      <rect x="0" y="32" width={W} height="12" fill="#5a3616" />
      <rect x="0" y="31.4" width={W} height="1.6" fill="#7a4a22" />
      {/* cloth */}
      <Bolt x={3} y={15} len={13} r={2.4} fill="#a24f9a" light="#d98ccf" dark="#5a1f55" />
      <Bolt x={5} y={10.4} len={11} r={2.2} fill="#3e7cc4" light="#8fb8e8" dark="#1d3f70" />
      <Bolt x={4} y={28.6} len={13} r={2.6} fill="#c8577f" light="#f0a3bf" dark="#6e2140" />
      {/* paper */}
      <g stroke="#7d6234" stroke-width="0.4">
        <rect x="21" y="13" width="11" height="3.4" rx="1.7" fill="#f3e3bb" />
        <rect x="22.6" y="9.4" width="10" height="3.4" rx="1.7" fill="#f7ecd2" />
        <rect x="26" y="14" width="1.4" height="2.4" fill="#c0392b" stroke="#7c1d18" />
      </g>
      <g stroke="#8a6d3b" stroke-width="0.4">
        <path d="M20 31.2 L22 27.6 H32.6 L31 31.2 Z" fill="#efe2c1" />
        <path d="M20.4 30 L22.4 26.4 H33 L31.4 30 Z" fill="#fff8e6" />
      </g>
      {/* coin: a chest, open */}
      <g stroke="#3a2412" stroke-width="0.5">
        <path d="M37 31 V24 H49 V31 Z" fill="#8a5a2b" />
        <path d="M37 24 L38 19 H50 L49 24 Z" fill="#9b6233" />
        <path d="M37 26.6 H49" stroke="#d9a83a" stroke-width="0.8" />
      </g>
      <g fill="#f2c64e" stroke="#a87a10" stroke-width="0.3">
        <ellipse cx="40" cy="24" rx="1.8" ry="0.7" />
        <ellipse cx="43.4" cy="23.4" rx="1.8" ry="0.7" />
        <ellipse cx="46.4" cy="24" rx="1.8" ry="0.7" />
        <ellipse cx="42" cy="22.6" rx="1.8" ry="0.7" />
      </g>
      <CoinStack x={44} y={14.6} n={3} />
      <Glint x={45} y={20.6} s={0.6} fill="#fff8e1" />
    </g>
  ),
};

/** A progress card's picture, filling its box (cropped to it). */
export function ProgressScene({ card }: { card: ProgressCardName }) {
  const scene = SCENES[card];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {scene ? scene() : null}
    </svg>
  );
}
