import type { DevCardType, Resource } from 'engine';
import type { JSX } from 'preact';
import { DEV_INFO, RESOURCE_INFO } from '../game/names';
import { ResGlyph } from './icons';

/*
 * Illustrated cards, drawn for Island Traders: a painted scene in a
 * parchment frame with a name ribbon, in the spirit of a classic board-game
 * card. All art is original SVG.
 *
 * Scenes are drawn in a 52 x 58 window; the subject sits in the middle so
 * the square hand tiles can crop the edges.
 */

const W = 52;
const H = 58;

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

function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g fill="#fff" opacity="0.85" transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="0" rx="5" ry="2.2" />
      <ellipse cx="3" cy="-1.4" rx="3" ry="2.2" />
      <ellipse cx="-2.5" cy="-0.8" rx="2.4" ry="1.8" />
    </g>
  );
}

function Pine({ x, y, s = 1, dark = '#245a2a', light = '#3f8f45' }: { x: number; y: number; s?: number; dark?: string; light?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-0.9" y="8" width="1.8" height="4" fill="#6b4524" />
      <path d="M0 -6 L5 2 L-5 2 Z" fill={light} />
      <path d="M0 -2 L6 6 L-6 6 Z" fill={light} />
      <path d="M0 2 L7 10 L-7 10 Z" fill={light} />
      <path d="M0 -6 L5 2 L0 2 Z M0 -2 L6 6 L0 6 Z M0 2 L7 10 L0 10 Z" fill={dark} opacity="0.55" />
    </g>
  );
}

function Log({ x, y, len, r = 3 }: { x: number; y: number; len: number; r?: number }) {
  return (
    <g stroke="#5a3616" stroke-width="0.6">
      <rect x={x} y={y - r} width={len} height={r * 2} rx={r} fill="#9b6233" />
      <path d={`M${x + 2} ${y - r * 0.4} h${len - 6} M${x + 4} ${y + r * 0.5} h${len - 9}`} stroke="#7a4a22" stroke-width="0.5" />
      <ellipse cx={x + len - r * 0.2} cy={y} rx={r * 0.8} ry={r} fill="#eac48f" />
      <ellipse cx={x + len - r * 0.2} cy={y} rx={r * 0.35} ry={r * 0.45} fill="none" stroke="#b98a55" stroke-width="0.5" />
    </g>
  );
}

function Sheep({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  const puffs: Array<[number, number, number]> = [
    [-4, 0, 4.2],
    [1, -2.5, 4.4],
    [6, 0, 4],
    [2, 2.5, 4.2],
    [-3, 3, 3.4],
  ];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="1" cy="9.5" rx="10" ry="1.6" fill="#000" opacity="0.15" />
      <rect x="-3.2" y="4" width="1.6" height="5.5" rx="0.8" fill="#333" />
      <rect x="4.2" y="4" width="1.6" height="5.5" rx="0.8" fill="#333" />
      <g fill="#fdfdf8" stroke="#9a9a8e" stroke-width="1.4">
        {puffs.map(([cx, cy, r], i) => (
          <circle key={i} cx={cx} cy={cy} r={r} />
        ))}
      </g>
      <g fill="#fdfdf8">
        {puffs.map(([cx, cy, r], i) => (
          <circle key={i} cx={cx} cy={cy} r={r} />
        ))}
      </g>
      <ellipse cx="-8.6" cy="-0.5" rx="3" ry="2.4" fill="#3a3a3a" />
      <ellipse cx="-7.6" cy="-2.8" rx="1.3" ry="0.8" fill="#3a3a3a" transform="rotate(-25 -7.6 -2.8)" />
      <circle cx="-9.6" cy="-1" r="0.5" fill="#fff" />
    </g>
  );
}

const SCENES: Record<Resource, () => JSX.Element> = {
  brick: () => (
    <g>
      <Sky id="sky-brick" top="#9fd3ee" bottom="#f7e3c4" />
      <Cloud x={38} y={9} />
      <path d={`M0 28 Q12 19 25 26 T${W} 22 V${H} H0 Z`} fill="#d99a6c" />
      <path d={`M0 37 Q20 31 ${W} 36 V${H} H0 Z`} fill="#bd6036" />
      <ellipse cx="13" cy="47" rx="9" ry="2.6" fill="#8f3f22" />
      {/* a small kiln with smoke */}
      <path d="M5 34 Q10 26 15 34 Z" fill="#a5563a" stroke="#6e2f18" stroke-width="0.6" />
      <path d="M8.6 34 Q10 31 11.4 34 Z" fill="#3a1d10" />
      <circle cx="11" cy="24" r="1.6" fill="#fff" opacity="0.6" />
      <circle cx="12.6" cy="20.5" r="2.2" fill="#fff" opacity="0.45" />
      {/* the brick stack */}
      <g stroke="#6e2a12" stroke-width="0.6">
        {[
          [22, 47],
          [29.5, 47],
          [37, 47],
          [25.8, 43],
          [33.3, 43],
          [29.6, 39],
        ].map(([bx, by], i) => (
          <g key={i}>
            <rect x={bx} y={by} width="7" height="4" rx="0.6" fill="#d0663c" />
            <path d={`M${bx + 0.8} ${by + 0.9} h5.4`} stroke="#ef9a72" stroke-width="0.6" />
          </g>
        ))}
      </g>
      <ellipse cx="33" cy="51.8" rx="12" ry="1.3" fill="#000" opacity="0.18" />
    </g>
  ),
  lumber: () => (
    <g>
      <Sky id="sky-lumber" top="#a9dbf2" bottom="#e9f3d6" />
      <Cloud x={14} y={8} s={0.9} />
      <path d={`M0 28 Q14 18 28 26 T${W} 22 V${H} H0 Z`} fill="#4c8a4f" />
      <Pine x={8} y={24} s={1.05} />
      <Pine x={44} y={22} s={1.2} />
      <Pine x={19} y={21} s={1.35} />
      <Pine x={33} y={25} s={1.0} />
      <path d={`M0 42 Q26 37 ${W} 42 V${H} H0 Z`} fill="#6aa05a" />
      <ellipse cx="27" cy="52.5" rx="15" ry="1.6" fill="#000" opacity="0.18" />
      <Log x={13} y={49} len={17} />
      <Log x={24} y={49} len={17} />
      <Log x={18.5} y={43.6} len={17} />
    </g>
  ),
  wool: () => (
    <g>
      <Sky id="sky-wool" top="#9fd3ee" bottom="#eef7df" />
      <Cloud x={40} y={10} />
      <Cloud x={12} y={14} s={0.7} />
      <path d={`M0 30 Q14 22 28 28 T${W} 25 V${H} H0 Z`} fill="#b6de7c" />
      <path d={`M0 39 Q26 33 ${W} 39 V${H} H0 Z`} fill="#8fca58" />
      {/* a fence */}
      <g stroke="#8a6238" stroke-width="1" stroke-linecap="round">
        <path d="M2 31 v7 M9 30 v7 M16 30.5 v7" />
        <path d="M1 33 L17 32 M1 36 L17 35" stroke-width="0.8" />
      </g>
      <Sheep x={29} y={41} s={1.05} />
      <g fill="#fff">
        <circle cx="8" cy="50" r="0.8" />
        <circle cx="45" cy="52" r="0.8" />
        <circle cx="12" cy="54" r="0.7" />
      </g>
      <g fill="#ffd34d">
        <circle cx="8" cy="50" r="0.3" />
        <circle cx="45" cy="52" r="0.3" />
      </g>
    </g>
  ),
  grain: () => (
    <g>
      <Sky id="sky-grain" top="#8fcbef" bottom="#fbeecb" />
      <circle cx="41" cy="12" r="6" fill="#ffd96a" />
      <circle cx="41" cy="12" r="8.5" fill="#ffd96a" opacity="0.25" />
      <path d={`M0 30 Q26 25 ${W} 30 V${H} H0 Z`} fill="#efcd66" />
      <g stroke="#d6a92f" stroke-width="0.7">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <path key={i} d={`M${-10 + i * 9} ${H} L${4 + i * 7} 30`} />
        ))}
      </g>
      {/* a sheaf of wheat */}
      <g transform="translate(26 36)">
        <ellipse cx="0" cy="17" rx="9" ry="1.5" fill="#000" opacity="0.18" />
        <g stroke="#a87a10" stroke-width="0.9" stroke-linecap="round">
          {[-5, -3, -1, 1, 3, 5].map((dx) => (
            <path key={dx} d={`M${dx * 0.35} 16 L${dx * 1.4} -10`} />
          ))}
        </g>
        <rect x="-3.4" y="4" width="6.8" height="2.2" rx="1" fill="#c0392b" />
        <g fill="#f1c140" stroke="#a87a10" stroke-width="0.5">
          {[-5, -3, -1, 1, 3, 5].map((dx) => (
            <g key={dx} transform={`translate(${dx * 1.4} -11) rotate(${dx * 4})`}>
              <ellipse cx="0" cy="0" rx="1.3" ry="2.6" />
              <ellipse cx="-1.4" cy="2.6" rx="1" ry="2" transform="rotate(-30 -1.4 2.6)" />
              <ellipse cx="1.4" cy="2.6" rx="1" ry="2" transform="rotate(30 1.4 2.6)" />
            </g>
          ))}
        </g>
      </g>
    </g>
  ),
  ore: () => (
    <g>
      <Sky id="sky-ore" top="#9cc9e6" bottom="#e7edf2" />
      <Cloud x={42} y={9} s={0.8} />
      <path d={`M0 38 L13 15 L22 27 L33 10 L${W} 35 V${H} H0 Z`} fill="#8f97a3" />
      <path d="M13 15 L22 27 L16 25 Z M33 10 L44 23 L35 20 Z" fill="#6b7380" />
      <path d="M13 15 L16.5 21 L14 20 L11 21 Z M33 10 L37.5 16 L34 15 L30 16.5 Z" fill="#fff" />
      <path d={`M0 45 Q26 40 ${W} 45 V${H} H0 Z`} fill="#6f7680" />
      {/* a mine entrance */}
      <path d="M20 46 V38 Q26 32 32 38 V46 Z" fill="#23262c" />
      <g fill="#8a5a2b" stroke="#5a3616" stroke-width="0.5">
        <rect x="19" y="36.5" width="2" height="9.5" />
        <rect x="31" y="36.5" width="2" height="9.5" />
        <rect x="18.5" y="35.4" width="15" height="2" />
      </g>
      {/* ore in front, with a glint */}
      <g stroke="#3f444c" stroke-width="0.6">
        <path d="M6 53 L9 47 L14 46 L17 50 L15 54 Z" fill="#9aa1ab" />
        <path d="M36 54 L38 48 L43 46.5 L47 50.5 L45 54.5 Z" fill="#a4aab2" />
      </g>
      <path d="M9 47 L11 50 L14 46 Z M38 48 L40.5 51 L43 46.5 Z" fill="#c9ced5" />
      <path d="M12.5 49 l0.7 -1.5 l0.7 1.5 l-0.7 1.5 Z M42 49.6 l0.7 -1.5 l0.7 1.5 l-0.7 1.5 Z" fill="#8fd3ff" />
    </g>
  ),
};

const DEV_SCENES: Record<DevCardType, () => JSX.Element> = {
  knight: () => (
    <g>
      <Sky id="sky-knight" top="#6c8fc0" bottom="#e9d9b4" />
      <path d={`M0 40 L6 40 L6 30 L10 30 L10 34 L14 34 L14 26 L20 26 L20 40 L${W} 40 V${H} H0 Z`} fill="#8b7d6b" opacity="0.6" />
      <path d={`M0 44 Q26 40 ${W} 44 V${H} H0 Z`} fill="#7b9b52" />
      {/* crossed swords behind a shield */}
      <g stroke="#5e6670" stroke-width="0.6">
        <path d="M13 12 L40 45" stroke="#cfd6de" stroke-width="2.2" stroke-linecap="round" />
        <path d="M39 12 L12 45" stroke="#cfd6de" stroke-width="2.2" stroke-linecap="round" />
        <rect x="35.5" y="40" width="7" height="2" rx="1" fill="#8a5a2b" transform="rotate(50 39 41)" />
        <rect x="9.5" y="40" width="7" height="2" rx="1" fill="#8a5a2b" transform="rotate(-50 13 41)" />
      </g>
      <path d="M17 16 H35 V30 Q35 41 26 46 Q17 41 17 30 Z" fill="#b83b32" stroke="#6e1f19" stroke-width="1" />
      <path d="M26 18 V43 M19 27 H33" stroke="#f1c140" stroke-width="2.4" />
      <path d="M17 16 H35 V19 H17 Z" fill="#fff" opacity="0.2" />
    </g>
  ),
  victoryPoint: () => (
    <g>
      <Sky id="sky-vp" top="#8fcbef" bottom="#fdf1d6" />
      <circle cx="26" cy="24" r="16" fill="#ffe8a3" opacity="0.6" />
      <path d={`M0 44 Q26 38 ${W} 44 V${H} H0 Z`} fill="#8fca58" />
      {/* a small temple */}
      <g stroke="#8a7a5a" stroke-width="0.6">
        <path d="M12 22 L26 13 L40 22 Z" fill="#f4ecd6" />
        <rect x="12" y="22" width="28" height="2.4" fill="#e6dbbf" />
        {[14, 20, 26, 32, 37].map((x) => (
          <rect key={x} x={x - 1.2} y="24.4" width="2.4" height="14" fill="#f4ecd6" />
        ))}
        <rect x="10" y="38.4" width="32" height="2.4" fill="#e6dbbf" />
        <rect x="8" y="40.8" width="36" height="2.4" fill="#d9ccab" />
      </g>
      <path d="M26 15.5 l1 2 2.2 0.3 -1.6 1.5 0.4 2.2 -2 -1 -2 1 0.4 -2.2 -1.6 -1.5 2.2 -0.3 Z" fill="#f1c140" />
    </g>
  ),
  roadBuilding: () => (
    <g>
      <Sky id="sky-road" top="#9fd3ee" bottom="#eef7df" />
      <path d={`M0 30 Q14 22 28 28 T${W} 25 V${H} H0 Z`} fill="#9fd060" />
      <path d={`M22 30 Q26 38 18 46 Q12 52 14 ${H} H38 Q34 50 38 44 Q44 36 30 30 Z`} fill="#c8b48a" stroke="#8a7650" stroke-width="0.6" />
      <g fill="#a8966c">
        <rect x="20" y="50" width="4" height="2" rx="0.5" />
        <rect x="27" y="52" width="4" height="2" rx="0.5" />
        <rect x="24" y="44" width="3.5" height="1.8" rx="0.5" />
        <rect x="30" y="38" width="3" height="1.6" rx="0.5" />
      </g>
      {/* a signpost */}
      <g stroke="#5a3616" stroke-width="0.6">
        <rect x="41" y="28" width="1.8" height="16" fill="#8a5a2b" />
        <path d="M37 29 H48 L50 31 L48 33 H37 Z" fill="#c89a5a" />
        <path d="M46 35 H35 L33 37 L35 39 H46 Z" fill="#c89a5a" />
      </g>
      <Pine x={9} y={27} s={0.8} />
    </g>
  ),
  yearOfPlenty: () => (
    <g>
      <Sky id="sky-yop" top="#f7c98b" bottom="#fdf0d5" />
      <path d={`M0 44 Q26 38 ${W} 44 V${H} H0 Z`} fill="#d9b25a" />
      {/* a basket of plenty */}
      <path d="M12 33 H40 L37 48 Q26 51 15 48 Z" fill="#b07a3c" stroke="#6e4a1e" stroke-width="0.8" />
      <path d="M13 37 H39 M14 41 H38 M15 45 H37" stroke="#8a5a2b" stroke-width="0.7" />
      <circle cx="18" cy="31" r="3.2" fill="#d94a3a" />
      <circle cx="24" cy="29" r="3.4" fill="#f1c140" />
      <circle cx="30" cy="30" r="3.2" fill="#7bbf4a" />
      <circle cx="35" cy="31.5" r="2.8" fill="#e8853a" />
      <g stroke="#a87a10" stroke-width="0.8">
        <path d="M27 30 L31 18 M29 30 L35 20" />
      </g>
      <g fill="#f1c140">
        <ellipse cx="31" cy="17" rx="1.2" ry="2.4" transform="rotate(20 31 17)" />
        <ellipse cx="35.4" cy="19" rx="1.2" ry="2.4" transform="rotate(30 35.4 19)" />
      </g>
    </g>
  ),
  monopoly: () => (
    <g>
      <Sky id="sky-mono" top="#b9a0e6" bottom="#f5ecd8" />
      {/* a market stall */}
      <path d="M6 18 H46 L44 26 H8 Z" fill="#fff" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={`M${6 + i * 8} 18 H${10 + i * 8} L${9.6 + i * 7.2} 26 H${6 + i * 7.6} Z`} fill="#c0392b" />
      ))}
      <rect x="8" y="26" width="2" height="18" fill="#8a5a2b" />
      <rect x="42" y="26" width="2" height="18" fill="#8a5a2b" />
      <path d={`M0 44 Q26 40 ${W} 44 V${H} H0 Z`} fill="#b69a6a" />
      {/* a purse of coins */}
      <path d="M18 30 Q26 26 34 30 L37 44 Q26 50 15 44 Z" fill="#7a4fb8" stroke="#3f2466" stroke-width="0.8" />
      <path d="M20 31 Q26 34 32 31" stroke="#f1c140" stroke-width="1.4" fill="none" />
      <g fill="#f1c140" stroke="#a87a10" stroke-width="0.5">
        <ellipse cx="12" cy="48" rx="4" ry="1.6" />
        <ellipse cx="12" cy="46.5" rx="4" ry="1.6" />
        <ellipse cx="41" cy="48.5" rx="4" ry="1.6" />
      </g>
    </g>
  ),
};

/** Ribbon colour for each resource's name. */
const RIBBON: Record<Resource, string> = {
  brick: '#a94a26',
  lumber: '#2f6b35',
  wool: '#5f9a35',
  grain: '#b8860b',
  ore: '#5b6270',
};

function Art({ scene, crop }: { scene: () => JSX.Element; crop?: boolean }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={crop ? 'xMidYMid slice' : 'xMidYMid meet'} aria-hidden="true">
      {scene()}
    </svg>
  );
}

/**
 * A resource card. `tile` is the square card in the hand (art filling it, the
 * count below), `mini` a small card in animations, `card` the full card with
 * its name ribbon.
 */
export function ResourceCard({ r, n, look = 'card', empty }: { r: Resource; n?: number; look?: 'card' | 'tile' | 'mini'; empty?: boolean }) {
  const label = RESOURCE_INFO[r].label;
  if (look === 'tile') {
    return (
      <span class={empty ? `rtile r-${r} empty` : `rtile r-${r}`} title={label}>
        <span class="rtile-art">
          <Art scene={SCENES[r]} crop />
        </span>
        <span class="rtile-icon">
          <ResGlyph r={r} />
        </span>
        {n !== undefined && <span class="rtile-n">{n}</span>}
      </span>
    );
  }
  return (
    <span class={`gcard r-${r} ${look}`} title={label}>
      <span class="gcard-art">
        <Art scene={SCENES[r]} crop />
      </span>
      {look === 'card' && (
        <span class="gcard-name" style={{ background: RIBBON[r] }}>
          {label}
        </span>
      )}
      {look === 'card' && (
        <span class="gcard-corner">
          <ResGlyph r={r} />
        </span>
      )}
    </span>
  );
}

/** A development card, face up (with its rule text if `text`) or face down. */
export function DevCardView({ type, back, text, look = 'card' }: { type: DevCardType | null; back?: boolean; text?: string; look?: 'card' | 'tile' | 'mini' }) {
  if (back || !type) {
    return (
      <span class={`gcard dev back ${look}`} aria-label="Development card">
        <svg viewBox="0 0 60 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <pattern id="hexes" width="8" height="13.86" patternUnits="userSpaceOnUse">
              <path d="M4 0 L8 2.31 L8 6.93 L4 9.24 L0 6.93 L0 2.31 Z M4 9.24 V13.86" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="0.6" />
            </pattern>
            <radialGradient id="back-glow" cx="0.5" cy="0.45" r="0.6">
              <stop offset="0" stop-color="#8e6bd8" />
              <stop offset="1" stop-color="#4a2f94" />
            </radialGradient>
          </defs>
          <rect width="60" height="84" fill="url(#back-glow)" />
          <rect width="60" height="84" fill="url(#hexes)" />
          <circle cx="30" cy="42" r="13" fill="#f1c140" stroke="#fff3c4" stroke-width="1.2" />
          <path d="M30 32 l2.6 6.2 6.6 0.5 -5 4.3 1.6 6.5 -5.8 -3.5 -5.8 3.5 1.6 -6.5 -5 -4.3 6.6 -0.5 Z" fill="#fff8e1" />
        </svg>
      </span>
    );
  }
  return (
    <span class={`gcard dev ${look}`} title={DEV_INFO[type].label}>
      <span class="gcard-art">
        <Art scene={DEV_SCENES[type]} crop />
      </span>
      {look === 'card' && <span class="gcard-name dev-ribbon">{DEV_INFO[type].label}</span>}
      {look === 'card' && text && <span class="gcard-text">{text}</span>}
    </span>
  );
}
