/**
 * Chat in online games. It travels next to the game (see protocol.ts) and is
 * never part of the engine's state. The host is the authority: a guest only
 * sends text, and the host stamps who said it, cleans it up, keeps a short
 * history and passes it on to everyone.
 */

export interface ChatMessage {
  /** Grows with every message in a room, also across a host reload. */
  id: number;
  /** The sender's seat; null for someone watching. */
  seat: number | null;
  name: string;
  text: string;
  /** Host clock, ms. */
  at: number;
}

/** Who sent a message, as the host knows it (never what the guest claims). */
export interface ChatSender {
  seat: number | null;
  name: string;
}

/** What the host knows about a guest link. */
export interface ChatGuest {
  /** Set once the guest said hello; null for a link the host doesn't know yet. */
  client: string | null;
  seat: number | null;
  /** The name from the guest's hello. */
  name: string;
}

export const CHAT_MAX_LENGTH = 200;
export const CHAT_HISTORY = 50;
/** At most this many messages per sender in any window of CHAT_WINDOW_MS. */
export const CHAT_BURST = 5;
export const CHAT_WINDOW_MS = 10_000;

/** Quick replies for a phone keyboard. */
export const QUICK_PHRASES = ['Anyone have wood?', 'Deal!', 'No thanks', 'Good game', '👍', '😂', '😮', '😡'];

// C0/C1 control characters, and the bidirectional overrides that could make a
// message display as something other than what was typed.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]+/g;

/** Plain, single-line text of at most CHAT_MAX_LENGTH characters, or null when nothing is left. */
export function cleanChatText(raw: unknown, max = CHAT_MAX_LENGTH): string | null {
  if (typeof raw !== 'string') return null;
  // look at a bounded prefix only, whatever a guest sends
  const text = raw
    .slice(0, max * 4)
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  // count characters (code points) so an emoji is never cut in half
  const chars = Array.from(text);
  const out = chars.length > max ? chars.slice(0, max).join('').trimEnd() : text;
  return out || null;
}

/** A sliding-window limit per sender. */
export class ChatRateLimiter {
  private sent = new Map<string, number[]>();

  constructor(
    private burst = CHAT_BURST,
    private windowMs = CHAT_WINDOW_MS,
  ) {}

  /** Records a message from `key` and says whether it may go through. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.sent.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.burst) {
      this.sent.set(key, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(key, recent);
    return true;
  }
}

export type ChatPostResult = { ok: true; message: ChatMessage } | { ok: false; reason: 'unknown' | 'empty' | 'limited' };

/**
 * The host's side of the chat: checks and stamps every message, keeps the
 * latest CHAT_HISTORY of them and hands them to guests who join or reconnect.
 */
export class ChatHub {
  private msgs: ChatMessage[];
  private limiter: ChatRateLimiter;
  private lastId: number;

  constructor(
    saved: ChatMessage[] = [],
    private now: () => number = Date.now,
    limiter?: ChatRateLimiter,
  ) {
    this.msgs = saved.filter(isChatMessage).slice(-CHAT_HISTORY);
    this.lastId = this.msgs.reduce((m, x) => Math.max(m, x.id), 0);
    this.limiter = limiter ?? new ChatRateLimiter();
  }

  /** The messages so far, oldest first. */
  history(): ChatMessage[] {
    return this.msgs.slice();
  }

  /** What a guest gets right after its welcome, when it joins or reconnects. */
  joinMessage(): { t: 'chatHistory'; msgs: ChatMessage[] } {
    return { t: 'chatHistory', msgs: this.history() };
  }

  /**
   * A chat message from a guest link. Only a guest that said hello may chat,
   * at most CHAT_BURST messages per CHAT_WINDOW_MS. Its seat and name come
   * from the host's records (`seatName`); whatever the message itself says
   * about who sent it is ignored.
   */
  fromGuest(guest: ChatGuest, msg: unknown, seatName: (seat: number) => string | undefined): ChatPostResult {
    if (guest.client === null) return { ok: false, reason: 'unknown' };
    const text = msg && typeof msg === 'object' ? (msg as { text?: unknown }).text : undefined;
    const from: ChatSender =
      guest.seat !== null ? { seat: guest.seat, name: seatName(guest.seat) ?? guest.name } : { seat: null, name: `${guest.name} (watching)` };
    return this.post(from, text, guest.client);
  }

  /**
   * Adds a message from `from` (the host's own, or a guest's through
   * fromGuest). With a `key` it counts against that sender's rate limit.
   */
  post(from: ChatSender, raw: unknown, key?: string): ChatPostResult {
    const text = cleanChatText(raw);
    if (text === null) return { ok: false, reason: 'empty' };
    if (key !== undefined && !this.limiter.allow(key, this.now())) return { ok: false, reason: 'limited' };
    const at = this.now();
    // ids keep growing after a host reload, even if the history was lost
    this.lastId = Math.max(this.lastId + 1, at);
    const message: ChatMessage = { id: this.lastId, seat: from.seat, name: cleanChatText(from.name, 32) ?? 'Player', text, at };
    this.msgs.push(message);
    if (this.msgs.length > CHAT_HISTORY) this.msgs.splice(0, this.msgs.length - CHAT_HISTORY);
    return { ok: true, message };
  }
}

export function isChatMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== 'object') return false;
  const x = m as Record<string, unknown>;
  return (
    typeof x.id === 'number' &&
    (x.seat === null || typeof x.seat === 'number') &&
    typeof x.name === 'string' &&
    typeof x.text === 'string' &&
    typeof x.at === 'number'
  );
}

/**
 * Adds messages from the host to a guest's list, by id (a history after a
 * reconnect overlaps what is there). Anything malformed is left out.
 */
export function mergeChat(list: ChatMessage[], add: unknown): ChatMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  let changed = false;
  for (const m of Array.isArray(add) ? add : []) {
    if (!isChatMessage(m) || byId.has(m.id)) continue;
    const text = cleanChatText(m.text);
    if (text === null) continue;
    byId.set(m.id, { id: m.id, seat: m.seat, name: cleanChatText(m.name, 32) ?? 'Player', text, at: m.at });
    changed = true;
  }
  if (!changed) return list;
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_HISTORY);
}
