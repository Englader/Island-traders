import type { Action, PlayerId } from 'engine';
import type { SeatSnapshot } from '../game/controller';
import type { Seat } from '../game/seats';

/**
 * Online play: the host's browser runs the engine. Friends connect over
 * WebRTC (PeerJS) with a room code, send the moves they want to make and
 * receive their own redacted view plus their legal moves after every change.
 * The host checks every move with the engine, so a guest can never see
 * hidden cards or make an illegal move.
 */

export const PROTOCOL = 1;

/** Room codes avoid easily confused characters (0/O, 1/I). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomRoomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function normalizeCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

/** The PeerJS id the host registers for a room. */
export function hostPeerId(code: string): string {
  return `island-traders-room-${normalizeCode(code).toLowerCase()}`;
}

export interface BrokerOptions {
  host?: string;
  port?: number;
  path?: string;
  secure?: boolean;
}

/**
 * The PeerJS broker only introduces the browsers to each other; game data
 * then flows directly between them. By default the free PeerJS cloud is used.
 * A self-hosted broker (`npx peer --port 9000`) can be set at build time with
 * VITE_PEER_HOST / VITE_PEER_PORT / VITE_PEER_PATH / VITE_PEER_SECURE, or per
 * visit with `?peer=host:port/path` in the page URL.
 */
export function brokerOptions(): BrokerOptions {
  const fromUrl = new URLSearchParams(location.search).get('peer');
  const env = import.meta.env;
  const spec = fromUrl ?? (env.VITE_PEER_HOST ? `${env.VITE_PEER_HOST}:${env.VITE_PEER_PORT ?? 443}${env.VITE_PEER_PATH ?? '/'}` : null);
  if (!spec) return {};
  const m = /^([^:/]+)(?::(\d+))?(\/.*)?$/.exec(spec);
  if (!m) return {};
  const port = Number(m[2] ?? 443);
  const secureEnv = env.VITE_PEER_SECURE;
  const secure = secureEnv !== undefined ? secureEnv === 'true' : port === 443;
  return { host: m[1], port, path: m[3] ?? '/', secure };
}

export interface LobbySeat {
  name: string;
  kind: Seat['kind'];
  color: number;
  /** Remote seats: a friend has claimed it. */
  taken: boolean;
  online: boolean;
}

export type GuestMessage =
  | { t: 'hello'; v: number; name: string; client: string }
  | { t: 'action'; action: Action };

export type HostMessage =
  | { t: 'welcome'; seat: PlayerId | null; reason?: string }
  | { t: 'lobby'; scenario: string; seats: LobbySeat[]; started: boolean; host: string }
  | {
      t: 'state';
      snap: SeatSnapshot;
      seats: LobbySeat[];
      last: { action: Action; at: number } | null;
    }
  | { t: 'error'; message: string };
