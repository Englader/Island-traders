import type { Action, PlayerId } from 'engine';
import type { SeatSnapshot } from '../game/controller';
import type { Seat } from '../game/seats';
import type { ChatMessage } from './chat';
import { loadJson, saveJson } from '../game/storage';

/**
 * Online play: the host's browser runs the engine. Friends connect over
 * WebRTC (PeerJS) with a room code, send the moves they want to make and
 * receive their own redacted view plus their legal moves after every change.
 * The host checks every move with the engine, so a guest can never see
 * hidden cards or make an illegal move.
 */

/**
 * Bumped when messages change incompatibly; a host turns away guests on
 * another version. Both sides ignore message types they don't know, so new
 * types (like chat) are added without a bump: an older guest just doesn't see
 * the chat, and a newer guest only shows it once the host sends a chat history.
 */
export const PROTOCOL = 3;

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

/**
 * A secret the host's browser keeps per room. The room server hands a room
 * code back to whoever shows the same token, so a host whose tab was reloaded
 * or put to sleep gets the room back at once.
 */
export function roomToken(code: string): string {
  const saved = loadJson<{ room: string; token: string }>('roomToken');
  if (saved?.room === code && saved.token) return saved.token;
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  saveJson('roomToken', { room: code, token });
  return token;
}

/**
 * STUN servers tell each phone its public address so two phones can often
 * link up directly. When they can't (common on mobile data), the game falls
 * back to the relay in relay.ts.
 */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export function rtcConfig(): RTCConfiguration {
  return { iceServers: ICE_SERVERS };
}

/**
 * How a guest reaches the host: a direct link first and the relay if that
 * doesn't connect quickly. `?link=direct` or `?link=relay` forces one (tests).
 */
export function linkMode(): 'both' | 'direct' | 'relay' {
  const q = new URLSearchParams(location.search).get('link');
  return q === 'direct' || q === 'relay' ? q : 'both';
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
  | { t: 'action'; action: Action }
  /** heartbeat; the host answers with a pong */
  | { t: 'ping' }
  | { t: 'bye' }
  /** A chat line. The host decides who sent it; anything else here is ignored. */
  | { t: 'chat'; text: string };

export type HostMessage =
  | { t: 'welcome'; seat: PlayerId | null; reason?: string }
  | { t: 'lobby'; scenario: string; seats: LobbySeat[]; started: boolean; host: string }
  | {
      t: 'state';
      snap: SeatSnapshot;
      seats: LobbySeat[];
      last: { action: Action; at: number } | null;
    }
  | { t: 'error'; message: string }
  | { t: 'pong' }
  /** The chat so far, sent after every welcome (join or reconnect). */
  | { t: 'chatHistory'; msgs: ChatMessage[] }
  /** A new chat message, stamped by the host. */
  | { t: 'chat'; msg: ChatMessage };
