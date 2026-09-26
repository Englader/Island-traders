import type { PartialCounts, Resource } from 'engine';
import type { JSX } from 'preact';
import { RESOURCE_INFO, RESOURCE_LIST } from '../game/names';

/**
 * Drawn resource icons. Emoji such as 🪵 and 🪨 are too new for many
 * devices (they show as empty boxes), so the game draws its own.
 * `x`, `y` and `size` place the icon inside the board's SVG; without them it
 * sits in a line of text at 1em.
 */
export function ResGlyph({ r, x, y, size }: { r: Resource; x?: number; y?: number; size?: number }) {
  const place =
    size !== undefined ? { x: (x ?? 0) - size / 2, y: (y ?? 0) - size / 2, width: size, height: size } : { width: '1em', height: '1em', class: 'glyph' };
  return (
    <svg viewBox="0 0 24 24" {...place} role="img" aria-label={RESOURCE_INFO[r].label}>
      {GLYPHS[r]}
    </svg>
  );
}

const BRICK = '#d0663c';
const BRICK_EDGE = '#86331a';

const GLYPHS: Record<Resource, JSX.Element> = {
  brick: (
    <g fill={BRICK} stroke={BRICK_EDGE} stroke-width="1" stroke-linejoin="round">
      <rect x="1.8" y="4" width="9.7" height="4.8" rx="1" />
      <rect x="12.5" y="4" width="9.7" height="4.8" rx="1" />
      <rect x="1.8" y="9.6" width="4.6" height="4.8" rx="1" />
      <rect x="7.3" y="9.6" width="9.4" height="4.8" rx="1" />
      <rect x="17.6" y="9.6" width="4.6" height="4.8" rx="1" />
      <rect x="1.8" y="15.2" width="9.7" height="4.8" rx="1" />
      <rect x="12.5" y="15.2" width="9.7" height="4.8" rx="1" />
      <path d="M3 5.2 h7 M13.7 5.2 h7 M8.5 10.8 h7 M3 16.4 h7 M13.7 16.4 h7" stroke="#ec9670" stroke-width="0.9" fill="none" />
    </g>
  ),
  lumber: (
    <g stroke="#5a3616" stroke-width="1" stroke-linejoin="round">
      <rect x="2.5" y="12.5" width="17" height="7.5" rx="3.75" fill="#9b6233" />
      <ellipse cx="19" cy="16.25" rx="3" ry="3.75" fill="#eac48f" />
      <ellipse cx="19" cy="16.25" rx="1.4" ry="1.8" fill="none" stroke="#b98a55" />
      <rect x="4.5" y="4" width="15" height="7.5" rx="3.75" fill="#a86c3a" />
      <ellipse cx="19" cy="7.75" rx="3" ry="3.75" fill="#eac48f" />
      <ellipse cx="19" cy="7.75" rx="1.4" ry="1.8" fill="none" stroke="#b98a55" />
      <path d="M7 6.5 h7 M5 15 h8.5 M8 9.5 h5" stroke="#7a4a22" stroke-width="0.8" fill="none" />
    </g>
  ),
  wool: (
    <g>
      <g fill="#fdfdf8" stroke="#8b8b80" stroke-width="1.8">
        <circle cx="9" cy="11.5" r="4" />
        <circle cx="13.5" cy="9" r="4.2" />
        <circle cx="17.5" cy="12" r="3.8" />
        <circle cx="14" cy="14.5" r="4" />
        <circle cx="10" cy="15.2" r="3.4" />
      </g>
      <g fill="#fdfdf8">
        <circle cx="9" cy="11.5" r="4" />
        <circle cx="13.5" cy="9" r="4.2" />
        <circle cx="17.5" cy="12" r="3.8" />
        <circle cx="14" cy="14.5" r="4" />
        <circle cx="10" cy="15.2" r="3.4" />
      </g>
      <rect x="9.6" y="17.8" width="1.7" height="4" rx="0.8" fill="#3b3b3b" />
      <rect x="15" y="17.6" width="1.7" height="4" rx="0.8" fill="#3b3b3b" />
      <ellipse cx="5" cy="11" rx="2.9" ry="2.4" fill="#3b3b3b" />
      <circle cx="4.2" cy="10.5" r="0.5" fill="#fff" />
    </g>
  ),
  grain: (
    <g>
      <path d="M12 22 V6" stroke="#a87a10" stroke-width="1.5" stroke-linecap="round" />
      <g fill="#ecbd3c" stroke="#a87a10" stroke-width="0.8">
        <ellipse cx="12" cy="4.6" rx="1.6" ry="2.7" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <ellipse cx="9.6" cy={8.4 + i * 3.1} rx="1.6" ry="2.7" transform={`rotate(-35 9.6 ${8.4 + i * 3.1})`} />
            <ellipse cx="14.4" cy={8.4 + i * 3.1} rx="1.6" ry="2.7" transform={`rotate(35 14.4 ${8.4 + i * 3.1})`} />
          </g>
        ))}
      </g>
    </g>
  ),
  ore: (
    <g stroke-linejoin="round">
      <path d="M2.5 17.5 L6 9 L11.5 5.5 L17.5 7.5 L21.5 13.5 L19.5 19.5 L8 20.5 Z" fill="#8f959e" stroke="#4b5058" stroke-width="1.1" />
      <path d="M11.5 5.5 L10.5 12 L6 9 Z" fill="#c2c7ce" />
      <path d="M10.5 12 L17.5 7.5 L21.5 13.5 Z" fill="#a4aab2" />
      <path d="M6 9 L10.5 12 L11.5 5.5 M10.5 12 L17.5 7.5 M10.5 12 L8 20.5 M10.5 12 L21.5 13.5" stroke="#5f656e" stroke-width="0.8" fill="none" />
    </g>
  ),
};

/** "2 [brick] 1 [grain]" with drawn icons; "nothing" when empty. */
export function Counts({ c }: { c: PartialCounts }) {
  const parts = RESOURCE_LIST.filter((r) => (c[r] ?? 0) > 0);
  if (parts.length === 0) return <>nothing</>;
  return (
    <span class="counts">
      {parts.map((r) => (
        <span key={r} class="count">
          {c[r]}
          <ResGlyph r={r} />
        </span>
      ))}
    </span>
  );
}
