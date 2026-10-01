import { PROGRESS_CARDS, type EventFace, type ImprovementTrack, type KnightLevel, type ProgressCardName } from 'engine';
import type { JSX } from 'preact';
import { TRACK_INFO, PROGRESS_TEXT, progressDeck } from '../game/ck';
import { progressTitle } from '../game/names';
import { shade } from '../board/Board';
import { ResGlyph } from './icons';
import { ProgressScene } from './progressArt';

/*
 * Cities & Knights art, drawn for Island Traders in the style of its pieces
 * and cards: knights, city walls, metropolis towers, the merchant, the
 * barbarian ship, city gates, the event die and the progress cards. All of it
 * is original SVG.
 */

/** The board is seen from a slight angle (Board.tsx). */
const TILT = 0.8;

// --- the barbarian ship and the city gates -------------------------------------------------

/** A raiders' longship: dark hull with a row of shields and a striped sail. Centred on (0, 0), about 1 wide. */
export function ShipShape({ dim }: { dim?: boolean }) {
  return (
    <g class={dim ? 'bship dim' : 'bship'}>
      <path d="M0 -0.42 V0.06" stroke="#3a2a1e" stroke-width="0.05" />
      <path d="M-0.27 -0.36 Q0 -0.4 0.27 -0.36 L0.25 0.0 Q0 -0.03 -0.25 0.0 Z" fill="#a8322a" stroke="#4a1410" stroke-width="0.03" />
      <path d="M-0.26 -0.24 Q0 -0.28 0.26 -0.24 M-0.255 -0.12 Q0 -0.16 0.255 -0.12" stroke="#f0d9b5" stroke-width="0.05" fill="none" />
      <path d="M-0.48 0.02 Q-0.5 -0.12 -0.42 -0.16 Q-0.4 -0.08 -0.36 0.04 L0.36 0.04 Q0.4 -0.08 0.42 -0.16 Q0.5 -0.12 0.48 0.02 Q0.4 0.22 0 0.22 Q-0.4 0.22 -0.48 0.02 Z" fill="#2e2622" stroke="#120d0a" stroke-width="0.03" />
      {[-0.27, -0.09, 0.09, 0.27].map((x, i) => (
        <circle key={x} cx={x} cy={0.08} r={0.065} fill={i % 2 ? '#d9a83a' : '#c9c2b4'} stroke="#120d0a" stroke-width="0.02" />
      ))}
    </g>
  );
}

/** A city gate: two towers and an arch, in a track's colour. Centred on (0, 0), about 1 wide. */
export function GateShape({ track }: { track: ImprovementTrack }) {
  const t = TRACK_INFO[track];
  return (
    <g stroke={t.dark} stroke-width="0.04" stroke-linejoin="round">
      <path d="M-0.42 0.36 V-0.26 H-0.36 V-0.34 H-0.29 V-0.26 H-0.21 V-0.34 H-0.14 V-0.12 H0.14 V-0.34 H0.21 V-0.26 H0.29 V-0.34 H0.36 V-0.26 H0.42 V0.36 Z" fill={t.fill} />
      <path d="M-0.14 -0.12 H0.14 V-0.06 H-0.14 Z" fill={t.light} stroke="none" />
      <path d="M-0.17 0.36 V0.04 A0.17 0.17 0 0 1 0.17 0.04 V0.36 Z" fill="#2a2420" />
      <path d="M-0.09 -0.08 V0.36 M0 -0.13 V0.36 M0.09 -0.08 V0.36 M-0.17 0.12 H0.17 M-0.17 0.24 H0.17" stroke="#8b847a" stroke-width="0.025" />
      <path d="M-0.36 -0.12 V-0.02 M0.36 -0.12 V-0.02" stroke={t.dark} stroke-width="0.05" />
    </g>
  );
}

/** A small city gate icon in a line of text, or at a size. */
export function GateGlyph({ track, size }: { track: ImprovementTrack; size?: number }) {
  return (
    <svg viewBox="-0.5 -0.5 1 1" class="glyph gate-glyph" width={size ?? '1em'} height={size ?? '1em'} role="img" aria-label={`${TRACK_INFO[track].label} gate`}>
      <GateShape track={track} />
    </svg>
  );
}

export function ShipGlyph({ size }: { size?: number }) {
  return (
    <svg viewBox="-0.55 -0.5 1.1 0.8" class="glyph ship-glyph" width={size ?? '1.3em'} height={size ? size * 0.75 : '1em'} role="img" aria-label="Barbarian ship">
      <ShipShape />
    </svg>
  );
}

/** One face of the event die: the barbarian ship, or a city gate. Drawn in a 0..1 square. */
export function EventFaceArt({ face }: { face: EventFace }) {
  return (
    <g transform="translate(0.5 0.53) scale(0.7)">{face === 'ship' ? <g transform="translate(0 0.05)"><ShipShape /></g> : <GateShape track={face} />}</g>
  );
}

/** The event die as it rests in the header. */
export function EventDie({ face }: { face: EventFace }) {
  const label = face === 'ship' ? 'event die: barbarian ship' : `event die: ${TRACK_INFO[face].colorName} city gate`;
  return (
    <svg class="die event" viewBox="0 0 1 1" aria-label={label}>
      <rect x="0.03" y="0.03" width="0.94" height="0.94" rx="0.18" class="die-face" />
      <EventFaceArt face={face} />
    </svg>
  );
}

// --- knights -------------------------------------------------------------------------------------

/**
 * A knight: a thick disc in the owner's colour with a helmet on top. Basic
 * knights wear a plain helm, strong ones a plume, mighty ones a crown too;
 * dots on the rim count the strength. An active knight stands in a lit ring
 * and its helmet shines; an inactive one's helmet is dull grey. Drawn round
 * (0, 0) in board units (the disc is about a third of a hex wide).
 */
export function KnightShape({ level, active, fill, stroke, ghost }: { level: KnightLevel; active: boolean; fill: string; stroke: string; ghost?: boolean }) {
  const r = 0.165;
  const ry = r * TILT;
  const h = 0.07;
  const dark = shade(fill, -0.32);
  const light = shade(fill, 0.25);
  const helm = active ? { body: '#eef2f6', side: '#b7c2cf', edge: '#5b4a1a', slit: '#1b1b1f', trim: '#e9b726' } : { body: '#a3a8b0', side: '#848a93', edge: '#4c5058', slit: '#2c2e33', trim: '#8a8f97' };
  return (
    <g class={`knight${active ? ' active' : ' idle'}${ghost ? ' ghost' : ''}`} data-level={level}>
      <ellipse cx={0.025} cy={h + 0.03} rx={r + 0.02} ry={ry * 0.95} class="piece-shadow" />
      {active && (
        <>
          <ellipse cx={0} cy={h * 0.55} rx={r + 0.06} ry={(r + 0.06) * TILT} class="knight-glow" />
          <ellipse cx={0} cy={h * 0.55} rx={r + 0.045} ry={(r + 0.045) * TILT} class="knight-ring" />
        </>
      )}
      <path d={`M${-r} 0 V${h} A${r} ${ry} 0 0 0 ${r} ${h} V0 Z`} fill={dark} stroke={stroke} stroke-width="0.016" />
      <ellipse cx={0} cy={0} rx={r} ry={ry} fill={fill} stroke={stroke} stroke-width="0.016" />
      <ellipse cx={-0.03} cy={-0.025} rx={r * 0.62} ry={ry * 0.5} fill={light} opacity="0.55" />
      {Array.from({ length: level }, (_, i) => (
        <circle key={i} cx={(i - (level - 1) / 2) * 0.055} cy={h * 0.62 + ry * 0.62} r={0.017} fill="#fff" opacity="0.92" />
      ))}
      <g transform="translate(0 -0.005)">
        {level >= 2 && (
          <path d="M0.01 -0.15 Q0.05 -0.245 0.135 -0.225 Q0.085 -0.205 0.07 -0.14 Z" fill={fill} stroke={stroke} stroke-width="0.012" />
        )}
        {level === 3 && (
          <path d="M-0.062 -0.14 L-0.066 -0.205 L-0.032 -0.176 L0 -0.222 L0.032 -0.176 L0.066 -0.205 L0.062 -0.14 Z" fill="#f1c140" stroke="#7a560c" stroke-width="0.012" />
        )}
        <path d="M-0.075 0.025 V-0.07 Q-0.075 -0.152 0 -0.152 Q0.075 -0.152 0.075 -0.07 V0.025 Z" fill={helm.body} stroke={helm.edge} stroke-width="0.014" />
        <path d="M0.02 -0.15 Q0.075 -0.14 0.075 -0.07 V0.025 H0.02 Z" fill={helm.side} />
        <rect x={-0.06} y={-0.083} width={0.12} height={0.022} rx="0.006" fill={helm.slit} />
        <path d="M0 -0.05 V0.015" stroke={helm.edge} stroke-width="0.012" />
        <path d="M-0.075 0.012 H0.075" stroke={helm.trim} stroke-width="0.018" />
      </g>
    </g>
  );
}

/** A knight for buttons, dialogs and the players list. */
export function KnightGlyph({ level, active, fill, stroke }: { level: KnightLevel; active: boolean; fill: string; stroke: string }) {
  return (
    <svg viewBox="-0.26 -0.3 0.52 0.48" aria-hidden="true" class="knight-glyph">
      <KnightShape level={level} active={active} fill={fill} stroke={stroke} />
    </svg>
  );
}

/** A helmet in the text colour (players list: knights). */
export function HelmIcon() {
  return (
    <svg viewBox="0 0 16 16" class="pm-icon helm-icon" aria-hidden="true">
      <path d="M3 14 V7.2 Q3 2 8 2 Q13 2 13 7.2 V14 Z" fill="currentColor" />
      <rect x="4.2" y="6.4" width="7.6" height="1.6" rx="0.5" fill="var(--panel, #fff)" />
      <path d="M8 9.2 V12.6" stroke="var(--panel, #fff)" stroke-width="1.1" />
    </svg>
  );
}

// --- city walls, metropolises, the merchant ------------------------------------------------------

/**
 * A stone wall round a city at (0, 0): `part` 'back' is drawn before the
 * city, 'front' after it, so the city stands inside. A thin band in the
 * owner's colour runs along its foot.
 */
export function WallShape({ part, fill, ghost }: { part: 'back' | 'front'; fill: string; ghost?: boolean }) {
  const cx = -0.02;
  const cy = 0.07;
  const rx = 0.33;
  const ry = 0.17;
  const arc = part === 'back' ? `M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}` : `M${cx + rx} ${cy} A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}`;
  return (
    <g class={ghost ? `wall ${part} ghost` : `wall ${part}`}>
      <path d={arc} transform="translate(0 0.05)" fill="none" stroke={fill} stroke-width="0.03" />
      <path d={arc} transform="translate(0 0.025)" fill="none" stroke="#6f675c" stroke-width="0.075" />
      <path d={arc} fill="none" stroke="#b9b0a1" stroke-width="0.06" />
      <path d={arc} transform="translate(0 -0.03)" fill="none" stroke="#d6cfc2" stroke-width="0.035" stroke-dasharray="0.035 0.028" />
    </g>
  );
}

/** A metropolis tower beside a city at (0, 0): the owner's colour, a roof and pennant in the track's colour. */
export function TowerShape({ track, fill, stroke, ghost }: { track: ImprovementTrack; fill: string; stroke: string; ghost?: boolean }) {
  const t = TRACK_INFO[track];
  const dark = shade(fill, -0.3);
  const light = shade(fill, 0.3);
  return (
    <g class={ghost ? 'tower ghost' : 'tower'} data-track={track}>
      <ellipse cx={0.03} cy={0.015} rx={0.1} ry={0.035} class="piece-shadow" />
      <path d="M0.055 0 L0.09 -0.022 L0.09 -0.4 L0.055 -0.38 Z" fill={dark} stroke={stroke} stroke-width="0.012" />
      <rect x={-0.06} y={-0.38} width={0.115} height={0.38} fill={fill} stroke={stroke} stroke-width="0.012" />
      <path d="M-0.06 -0.38 V-0.41 H-0.035 V-0.39 H-0.01 V-0.41 H0.015 V-0.39 H0.04 V-0.41 H0.055 V-0.38 Z" fill={light} stroke={stroke} stroke-width="0.01" />
      <path d="M-0.075 -0.405 L0.015 -0.56 L0.105 -0.42 Z" fill={t.fill} stroke={t.dark} stroke-width="0.014" stroke-linejoin="round" />
      <path d="M0.015 -0.56 L0.105 -0.42 L0.05 -0.415 Z" fill={t.dark} opacity="0.35" />
      <path d="M0.015 -0.56 V-0.66" stroke="#3a2a1e" stroke-width="0.012" />
      <path d="M0.015 -0.66 L0.1 -0.635 L0.015 -0.608 Z" fill={t.fill} stroke={t.dark} stroke-width="0.01" />
      <path d="M-0.022 -0.2 V-0.25 A0.022 0.022 0 0 1 0.022 -0.25 V-0.2 Z" fill="#2a2420" />
      <path d="M-0.022 -0.07 V-0.12 A0.022 0.022 0 0 1 0.022 -0.12 V-0.07 Z" fill="#2a2420" />
    </g>
  );
}

/** The merchant: a travelling trader with a wide hat and a pack, in the owner's colour. Base at (0, 0). */
export function MerchantShape({ fill, stroke }: { fill: string; stroke: string }) {
  const dark = shade(fill, -0.3);
  return (
    <g class="merchant">
      <ellipse cx={0.02} cy={0.02} rx={0.13} ry={0.045} class="piece-shadow" />
      <path d="M0.03 -0.2 Q0.14 -0.2 0.13 -0.1 L0.12 -0.03 Q0.08 -0.01 0.05 -0.04 Z" fill="#8a5a2b" stroke="#4a2c12" stroke-width="0.012" />
      <path d="M-0.1 0.01 Q-0.1 -0.2 0 -0.22 Q0.1 -0.2 0.1 0.01 Q0 0.04 -0.1 0.01 Z" fill={fill} stroke={stroke} stroke-width="0.014" />
      <path d="M0.02 -0.2 Q0.1 -0.18 0.1 0.01 Q0.06 0.025 0.03 0.025 Z" fill={dark} opacity="0.6" />
      <path d="M-0.08 -0.1 H0.08" stroke="#f1c140" stroke-width="0.02" />
      <circle cx={0} cy={-0.27} r={0.06} fill="#f1d3ad" stroke="#7a4e2a" stroke-width="0.012" />
      <ellipse cx={0} cy={-0.305} rx={0.12} ry={0.03} fill="#6b4524" stroke="#3a2412" stroke-width="0.012" />
      <path d="M-0.055 -0.31 Q-0.05 -0.38 0 -0.38 Q0.05 -0.38 0.055 -0.31 Z" fill="#6b4524" stroke="#3a2412" stroke-width="0.012" />
    </g>
  );
}

/** A tower for buttons and dialogs. */
export function TowerGlyph({ track, fill, stroke }: { track: ImprovementTrack; fill: string; stroke: string }) {
  return (
    <svg viewBox="-0.2 -0.7 0.4 0.75" aria-hidden="true">
      <TowerShape track={track} fill={fill} stroke={stroke} />
    </svg>
  );
}

/** A walled city for buttons and dialogs. */
export function WallGlyph({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <svg viewBox="-0.4 -0.42 0.8 0.72" aria-hidden="true">
      <WallShape part="back" fill={fill} />
      <g transform="scale(1.2)">
        <CityShape fill={fill} stroke={stroke} />
      </g>
      <WallShape part="front" fill={fill} />
    </svg>
  );
}

/** The city as the board draws it (Board.tsx), at (0, 0). */
function CityShape({ fill, stroke }: { fill: string; stroke: string }) {
  const light = shade(fill, 0.3);
  const dark = shade(fill, -0.3);
  const faces: Array<[string, string]> = [
    ['0.08,0.12 0.17,0.07 0.17,-0.05 0.08,0', dark],
    ['-0.2,0.12 0.08,0.12 0.08,0 -0.2,0', fill],
    ['-0.2,0 0.08,0 0.17,-0.05 -0.11,-0.05', light],
    ['-0.05,0 0.01,-0.03 0.01,-0.21 -0.05,-0.18', dark],
    ['-0.17,0 -0.05,0 -0.05,-0.18 -0.17,-0.18', fill],
    ['-0.17,-0.18 -0.05,-0.18 -0.11,-0.3', fill],
    ['-0.05,-0.18 0.01,-0.21 -0.05,-0.33 -0.11,-0.3', light],
  ];
  return (
    <g>
      {faces.map(([p, f], i) => (
        <polygon key={i} points={p} fill={f} stroke={stroke} stroke-width="0.016" stroke-linejoin="round" />
      ))}
    </g>
  );
}

// --- progress cards ----------------------------------------------------------------------------------

/** Each deck's emblem: scales for trade, a crowned shield for politics, a book and flask for science. Centred on (0, 0), about 1 wide. */
function Emblem({ track }: { track: ImprovementTrack }): JSX.Element {
  const t = TRACK_INFO[track];
  if (track === 'trade') {
    return (
      <g stroke={t.dark} stroke-width="0.035" stroke-linecap="round" fill="none">
        <path d="M0 -0.36 V0.3 M-0.2 0.32 H0.2 M-0.34 -0.22 H0.34" />
        <path d="M-0.34 -0.22 L-0.46 0.04 H-0.22 Z M0.34 -0.22 L0.22 0.04 H0.46 Z" fill={t.light} stroke-linejoin="round" />
        <circle cx="0" cy="-0.4" r="0.05" fill={t.fill} />
        <ellipse cx="-0.34" cy="0.03" rx="0.07" ry="0.025" fill="#f2c64e" stroke="#7a4e0e" stroke-width="0.02" />
      </g>
    );
  }
  if (track === 'politics') {
    return (
      <g stroke={t.dark} stroke-width="0.035" stroke-linejoin="round">
        <path d="M-0.3 -0.2 H0.3 V0.06 Q0.3 0.3 0 0.42 Q-0.3 0.3 -0.3 0.06 Z" fill={t.light} />
        <path d="M0 -0.18 V0.38 M-0.28 0.04 H0.28" stroke={t.fill} stroke-width="0.07" />
        <path d="M-0.22 -0.24 L-0.24 -0.44 L-0.11 -0.33 L0 -0.48 L0.11 -0.33 L0.24 -0.44 L0.22 -0.24 Z" fill="#f1c140" stroke="#7a560c" />
      </g>
    );
  }
  return (
    <g stroke={t.dark} stroke-width="0.035" stroke-linejoin="round">
      <path d="M-0.44 0.12 L-0.44 -0.24 Q-0.22 -0.32 0 -0.22 Q0.22 -0.32 0.44 -0.24 L0.44 0.12 Q0.22 0.04 0 0.14 Q-0.22 0.04 -0.44 0.12 Z" fill="#fbf3dc" />
      <path d="M0 -0.22 V0.14" />
      <path d="M-0.34 -0.14 Q-0.2 -0.19 -0.08 -0.14 M-0.34 -0.04 Q-0.2 -0.09 -0.08 -0.04 M0.08 -0.14 Q0.2 -0.19 0.34 -0.14" stroke-width="0.025" stroke="#b49a68" fill="none" />
      <path d="M0.1 0.42 L0.18 0.16 V0.04 H0.3 V0.16 L0.38 0.42 Z" fill={t.light} />
      <path d="M0.13 0.34 L0.35 0.34 L0.37 0.41 L0.11 0.41 Z" fill={t.fill} stroke="none" />
    </g>
  );
}

/**
 * A progress card. Face down: the deck's colour with its emblem. Face up
 * (your own cards, and every card once played): a band in the deck's colour
 * with the card's name and the deck's commodity, its picture
 * (ui/progressArt.tsx) and, on the full card, its rule.
 */
export function ProgressCardView({
  card,
  deck,
  back,
  look = 'card',
  text,
}: {
  card?: ProgressCardName | null;
  deck?: ImprovementTrack;
  back?: boolean;
  look?: 'card' | 'tile' | 'mini';
  /** Show the rule text (full cards). */
  text?: boolean;
}) {
  const track = deck ?? (card ? progressDeck(card) : 'science');
  const t = TRACK_INFO[track];
  const id = `pg-${track}`;
  if (back || !card) {
    return (
      <span class={`gcard prog back ${look} deck-${track}`} aria-label={`${t.label} progress card`}>
        <svg viewBox="0 0 60 84" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <radialGradient id={`${id}-back`} cx="0.5" cy="0.42" r="0.7">
              <stop offset="0" stop-color={t.light} />
              <stop offset="0.55" stop-color={t.fill} />
              <stop offset="1" stop-color={t.dark} />
            </radialGradient>
            <pattern id={`${id}-gates`} width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M2 10 V4 H4 V6 H8 V4 H10 V10 Z" fill="#fff" opacity="0.13" />
            </pattern>
          </defs>
          <rect width="60" height="84" fill={`url(#${id}-back)`} />
          <rect width="60" height="84" fill={`url(#${id}-gates)`} />
          <rect x="4" y="4" width="52" height="76" rx="5" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1.2" />
          <circle cx="30" cy="42" r="15" fill="#fffaf0" stroke={t.dark} stroke-width="1.2" />
          <g transform="translate(30 42) scale(20)">
            <Emblem track={track} />
          </g>
        </svg>
      </span>
    );
  }
  const title = progressTitle(card);
  const vp = !!PROGRESS_CARDS[card]?.vp;
  // the name shrinks to keep its longest word on one line ("Constitution")
  const longest = Math.max(...title.split(' ').map((w) => w.length));
  const style = {
    '--deck': t.fill,
    '--deck-dark': t.dark,
    '--deck-light': t.light,
    '--fit': `${Math.min(11, 100 / longest).toFixed(1)}cqw`,
    '--fit-mini': `${Math.min(13, 120 / longest).toFixed(1)}cqw`,
  } as Record<string, string>;
  if (look === 'tile') {
    return (
      <span class={`gcard prog face tile deck-${track}`} title={title} style={style} data-card={card}>
        <span class="pg-art">
          <ProgressScene card={card} />
        </span>
      </span>
    );
  }
  return (
    <span class={`gcard prog face ${look} deck-${track}`} title={title} style={style} data-card={card}>
      <span class="pg-band">
        <span class="pg-mark" title={`${t.label} deck · ${t.commodity}`}>
          <ResGlyph r={t.commodity} />
        </span>
        <span class="prog-title">{title}</span>
      </span>
      <span class="pg-art">
        <ProgressScene card={card} />
        {vp && <span class="pg-vp">1 VP</span>}
      </span>
      {look === 'card' && text && <span class="prog-text">{PROGRESS_TEXT[card]}</span>}
    </span>
  );
}
