/*
 * The gold field: a charcoal cliff with a cave glowing with gold. The ground
 * is kept dark so the tile never reads as a field of wheat, even in grayscale
 * or to colour-blind players; the gold is the bright accent on it. A picture
 * is drawn once in the board's <defs> and placed on every gold hex with
 * <use href="#gold-art">: a rocky crest with veins of gold and a cave mouth
 * lit from inside at the back, quartz crystals on the left and a heap of gold
 * with a pick in it on the right.
 *
 * Coordinates are relative to the hex centre, where the number token
 * stands, so the picture keeps to the rim of the tile. It fits the tile both
 * ways round (the board turns 90° on tall screens).
 */

/** Tile colours: top face, the lit edge of the gradient, the tile side. */
export const GOLD_TILE = { top: '#4a4544', light: '#67605d', side: '#242120' };

type Tone = { fill: string; dark: string; light: string };
const GOLD: Tone = { fill: '#ffd43b', dark: '#b8780a', light: '#fff7cc' };
const ROCK: Tone = { fill: '#2e2a29', dark: '#171413', light: '#57504c' };
const SHINE = '#ffc933';

type Nugget = [x: number, y: number, r: number];

const CREST =
  'M-0.58 -0.15 L-0.55 -0.25 L-0.47 -0.31 L-0.42 -0.4 L-0.32 -0.44 L-0.25 -0.53 L-0.14 -0.57 L-0.07 -0.635 L0.05 -0.65 L0.12 -0.605 L0.2 -0.595 L0.27 -0.53 L0.38 -0.49 L0.44 -0.41 L0.52 -0.36 L0.56 -0.26 L0.58 -0.15 Q0 -0.06 -0.58 -0.15 Z';
const VEINS =
  'M-0.5 -0.3 L-0.44 -0.33 L-0.38 -0.32 L-0.31 -0.36 L-0.24 -0.35 M-0.36 -0.45 L-0.29 -0.47 L-0.22 -0.46 M0.18 -0.39 L0.25 -0.37 L0.31 -0.39 L0.38 -0.36 L0.46 -0.37 M0.19 -0.53 L0.25 -0.51 L0.3 -0.52';
const CAVE = 'M-0.2 -0.25 Q-0.23 -0.46 -0.1 -0.53 Q0 -0.58 0.1 -0.53 Q0.23 -0.46 0.2 -0.25 Z';
/** The shadow under the roof of the cave, so the light seems to come from deep inside. */
const CAVE_ROOF = 'M-0.2 -0.26 Q-0.23 -0.46 -0.1 -0.53 Q0 -0.58 0.1 -0.53 Q0.23 -0.46 0.2 -0.26 Q0.17 -0.44 0.08 -0.48 Q0 -0.51 -0.08 -0.48 Q-0.17 -0.44 -0.2 -0.26 Z';
const IN_CAVE: Nugget[] = [
  [-0.1, -0.29, 0.03],
  [-0.04, -0.3, 0.025],
  [0.07, -0.28, 0.028],
  [0.12, -0.3, 0.02],
];
/** Quartz crystals: x, y, height, tilt in degrees. */
const CRYSTALS: Array<[number, number, number, number]> = [
  [-0.59, 0.37, 0.13, -28],
  [-0.42, 0.37, 0.12, 26],
  [-0.5, 0.38, 0.19, -4],
  [-0.55, 0.39, 0.09, -12],
  [-0.45, 0.4, 0.08, 14],
];
const BY_CRYSTALS: Nugget[] = [
  [-0.56, 0.4, 0.022],
  [-0.47, 0.41, 0.02],
  [-0.37, 0.41, 0.018],
];
const HEAP: Nugget[] = [
  [0.34, 0.39, 0.04],
  [0.42, 0.4, 0.045],
  [0.51, 0.395, 0.042],
  [0.58, 0.405, 0.03],
  [0.38, 0.34, 0.038],
  [0.47, 0.34, 0.044],
  [0.54, 0.35, 0.034],
  [0.43, 0.29, 0.04],
  [0.5, 0.3, 0.03],
];
/** Sparkles that light up in turn (see .gold-glint); they stand still with reduced motion. */
const GLINTS: Nugget[] = [
  [0.45, 0.26, 0.06],
  [-0.37, -0.345, 0.05],
  [0.02, -0.36, 0.05],
  [-0.47, 0.23, 0.045],
];

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** A 4-point sparkle. */
function sparkle([x, y, r]: Nugget): string {
  const k = r * 0.25;
  return `M${f(x)} ${f(y - r)} L${f(x + k)} ${f(y - k)} L${f(x + r)} ${f(y)} L${f(x + k)} ${f(y + k)} L${f(x)} ${f(y + r)} L${f(x - k)} ${f(y + k)} L${f(x - r)} ${f(y)} L${f(x - k)} ${f(y - k)} Z`;
}

/** Gold nuggets with a lit edge; `glow` adds a soft halo. */
function Nuggets({ list, glow }: { list: Nugget[]; glow?: boolean }) {
  return (
    <>
      {glow && (
        <g fill="url(#gold-glow)">
          {list.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r * 2.2} />
          ))}
        </g>
      )}
      <g fill={GOLD.fill} stroke={GOLD.dark} stroke-width="0.012">
        {list.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} />
        ))}
      </g>
      <g fill={GOLD.light}>
        {list.map(([x, y, r], i) => (
          <circle key={i} cx={x - r * 0.35} cy={y - r * 0.35} r={r * 0.3} />
        ))}
      </g>
    </>
  );
}

/** A seam of gold: a soft shine, a dark edge, the gold and a highlight. */
function Seam({ d, w }: { d: string; w: number }) {
  return (
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d={d} stroke={SHINE} stroke-width={w * 2.9} opacity="0.35" />
      <path d={d} stroke={GOLD.dark} stroke-width={w * 1.55} />
      <path d={d} stroke={GOLD.fill} stroke-width={w} />
      <path d={d} stroke={GOLD.light} stroke-width={w * 0.3} transform="translate(-0.004 -0.005)" />
    </g>
  );
}

function GoldArt() {
  return (
    <g id="gold-art">
      {/* the rocky crest, in layers, lit from the top left */}
      <ellipse cx="0" cy="-0.15" rx="0.62" ry="0.06" fill="#000" opacity="0.18" />
      <g clip-path="url(#gold-crest)">
        <rect x="-0.6" y="-0.66" width="1.2" height="0.6" fill={ROCK.fill} />
        <path d="M-0.6 -0.5 Q-0.3 -0.56 0 -0.53 T0.6 -0.56 V-0.49 Q0.3 -0.46 0 -0.47 T-0.6 -0.44 Z" fill={ROCK.dark} opacity="0.6" />
        <path d="M-0.6 -0.39 Q-0.3 -0.44 0 -0.41 T0.6 -0.43 V-0.39 Q0.3 -0.37 0 -0.375 T-0.6 -0.35 Z" fill={ROCK.light} opacity="0.7" />
        <path d="M-0.6 -0.29 Q-0.3 -0.34 0 -0.31 T0.6 -0.33 V-0.25 Q0.3 -0.23 0 -0.24 T-0.6 -0.21 Z" fill={ROCK.dark} opacity="0.6" />
        <path d="M-0.6 -0.1 L-0.6 -0.3 L-0.3 -0.6 L0.05 -0.66 L-0.02 -0.58 L-0.18 -0.5 L-0.28 -0.42 L-0.4 -0.33 L-0.47 -0.2 L-0.5 -0.1 Z" fill="#fff" opacity="0.14" />
        <path d="M0.05 -0.66 L0.6 -0.5 V-0.1 H0.4 L0.4 -0.3 L0.3 -0.42 L0.16 -0.52 Z" fill="#000" opacity="0.2" />
      </g>
      <path d={CREST} fill="none" stroke={ROCK.dark} stroke-width="0.012" stroke-linejoin="round" />
      <Seam d={VEINS} w={0.026} />
      {/* the cave mouth, lit from inside by gold */}
      <ellipse cx="0" cy="-0.3" rx="0.36" ry="0.2" fill="url(#gold-glow)" opacity="0.8" />
      <path d={CAVE} fill="url(#gold-cave)" stroke={ROCK.dark} stroke-width="0.016" />
      <path d={CAVE_ROOF} fill="#1c1004" opacity="0.55" />
      <Nuggets list={IN_CAVE} />
      {/* a cluster of quartz crystals with gold at their foot */}
      <ellipse cx="-0.5" cy="0.38" rx="0.16" ry="0.032" fill="#000" opacity="0.3" />
      {CRYSTALS.map(([x, y, h, a], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${a})`} stroke="#5d5868" stroke-width="0.01" stroke-linejoin="round">
          <path d={`M-0.028 0 V${-h} L0 ${f(-h - 0.045)} L0.028 ${-h} V0 Z`} fill="#d8d2e4" />
          <path d={`M-0.028 0 V${-h} L0 ${f(-h - 0.045)} V0 Z`} fill="#f7f5fb" stroke="none" />
        </g>
      ))}
      <Nuggets list={BY_CRYSTALS} />
      {/* a heap of gold with a pick in it */}
      <ellipse cx="0.46" cy="0.42" rx="0.18" ry="0.035" fill="#000" opacity="0.3" />
      <Nuggets list={HEAP} glow />
      <path d="M0.5 0.28 L0.62 0.02" stroke="#1e140c" stroke-width="0.034" stroke-linecap="round" />
      <path d="M0.5 0.28 L0.62 0.02" stroke="#b27b44" stroke-width="0.02" stroke-linecap="round" />
      <path d="M0.5 -0.02 Q0.6 -0.02 0.71 0.07" stroke="#2a2d31" stroke-width="0.04" fill="none" stroke-linecap="round" />
      <path d="M0.5 -0.02 Q0.6 -0.02 0.71 0.07" stroke="#c3c8cf" stroke-width="0.018" fill="none" stroke-linecap="round" />
      {GLINTS.map((g, i) => (
        <path key={i} d={sparkle(g)} fill="#fffbe8" class={i === 0 ? 'gold-glint' : `gold-glint g${i + 1}`} />
      ))}
    </g>
  );
}

/** Everything the gold field needs in the board's <defs>. */
export function GoldFieldDefs() {
  return (
    <>
      {/* the ground: cracks, pebbles and flecks of gold */}
      <pattern id="tex-gold" width="0.46" height="0.36" patternUnits="userSpaceOnUse">
        <path d="M0.03 0.1 l0.06 0.025 l0.05 -0.02 M0.25 0.28 l0.05 0.02 l0.05 -0.03" stroke="#1b1817" stroke-width="0.016" fill="none" opacity="0.6" stroke-linecap="round" />
        <ellipse cx="0.33" cy="0.08" rx="0.028" ry="0.018" fill="#7a726c" opacity="0.5" />
        <circle cx="0.18" cy="0.22" r="0.011" fill={GOLD.fill} />
      </pattern>
      <clipPath id="gold-crest">
        <path d={CREST} />
      </clipPath>
      {/* golden light from deep in the cave, fading to dark under its roof */}
      <radialGradient id="gold-cave" cx="0.5" cy="1" r="0.95">
        <stop offset="0" stop-color="#ffe98a" />
        <stop offset="0.35" stop-color="#f3ab22" />
        <stop offset="0.75" stop-color="#5e3408" />
        <stop offset="1" stop-color="#2a1604" />
      </radialGradient>
      <radialGradient id="gold-glow">
        <stop offset="0" stop-color={SHINE} stop-opacity="0.55" />
        <stop offset="1" stop-color={SHINE} stop-opacity="0" />
      </radialGradient>
      <GoldArt />
    </>
  );
}
