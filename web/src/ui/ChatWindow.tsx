import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PlayerColor } from '../game/seats';
import { CHAT_MAX_LENGTH, ChatRateLimiter, QUICK_PHRASES, cleanChatText, type ChatMessage } from '../net/chat';

export interface ChatWindowProps {
  /** Messages so far, oldest first. */
  messages: ChatMessage[];
  /** This device's seat (own messages sit on the right); null when watching. */
  seat: number | null;
  /** Player colours by seat. */
  colors: PlayerColor[];
  /** The room, so unread counts survive the screen being left and reopened. */
  room: string;
  /** Sends a cleaned-up message; false when it could not be sent. */
  onSend(text: string): boolean;
}

/** The newest message each room's player has seen, kept while the page is open. */
const seenInRoom = new Map<string, number>();

const EMOJI_ONLY = /^[\p{Extended_Pictographic}\u200d\ufe0f\u{1f3fb}-\u{1f3ff}\s]+$/u;
const PEEK_MS = 4500;

function isEmojiOnly(text: string): boolean {
  return Array.from(text).length <= 6 && EMOJI_ONLY.test(text);
}

/**
 * Online games only: a 💬 button over the board with an unread badge, and a
 * small chat window that opens from it. A new message while the window is
 * closed shows briefly next to the button. Everything is plain text.
 */
export function ChatWindow({ messages, seat, colors, room, onSend }: ChatWindowProps) {
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : 0;
  const [open, setOpen] = useState(false);
  // what was already there when the chat first appeared (e.g. the history after a reload) counts as read
  const [seenId, setSeenId] = useState(() => {
    if (!seenInRoom.has(room)) seenInRoom.set(room, lastId);
    return seenInRoom.get(room)!;
  });
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [peek, setPeek] = useState<ChatMessage | null>(null);
  const [live, setLive] = useState<ChatMessage | null>(null);
  const limiter = useRef(new ChatRateLimiter());
  const prevLast = useRef(lastId);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const win = useRef<HTMLElement>(null);
  const fab = useRef<HTMLButtonElement>(null);

  const mine = (m: ChatMessage) => seat !== null && m.seat === seat;
  const unread = open ? 0 : messages.filter((m) => m.id > seenId && !mine(m)).length;

  useEffect(() => {
    if (!open) return;
    setSeenId(lastId);
    seenInRoom.set(room, lastId);
  }, [open, lastId, room]);

  // someone else wrote: announce it, and show it by the button if the window is closed
  useEffect(() => {
    if (lastId === prevLast.current) return;
    const fresh = messages.filter((m) => m.id > prevLast.current && !mine(m));
    prevLast.current = lastId;
    const m = fresh[fresh.length - 1];
    if (!m) return;
    setLive(m);
    if (!open) setPeek(m);
  }, [lastId]);
  useEffect(() => {
    if (!peek) return;
    const t = setTimeout(() => setPeek(null), PEEK_MS);
    return () => clearTimeout(t);
  }, [peek]);

  // keep the newest message in view
  useLayoutEffect(() => {
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [open, lastId]);

  const refocus = useRef(false);
  useEffect(() => {
    if (!open) {
      // closed from inside the window: back to the button (visible again only now)
      if (refocus.current) fab.current?.focus({ preventScroll: true });
      refocus.current = false;
      return;
    }
    setPeek(null);
    // a phone keyboard would cover the board as soon as the window opens: only
    // jump into the text box where there is a real keyboard
    const fine = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    (fine ? input.current : win.current)?.focus({ preventScroll: true });
  }, [open]);

  const close = () => {
    refocus.current = true;
    setOpen(false);
    setNote(null);
  };

  const send = (raw: string, fromDraft: boolean) => {
    const text = cleanChatText(raw);
    if (text === null) return;
    if (!limiter.current.allow('me')) {
      setNote('Slow down a little: a few seconds between bursts of messages.');
      return;
    }
    if (!onSend(text)) {
      setNote('Not connected right now. Try again in a moment.');
      return;
    }
    setNote(null);
    if (fromDraft) setDraft('');
  };

  const color = (m: ChatMessage) => (m.seat !== null ? colors[m.seat] : undefined);
  const label = unread > 0 ? `Chat, ${unread} unread message${unread === 1 ? '' : 's'}` : 'Chat';

  return (
    <div class="chat-layer">
      <div class="chat-sr" aria-live="polite" aria-atomic="true">
        {/* a new node per message, so the same words twice are read twice */}
        {live && <span key={live.id}>{`${live.name}: ${live.text}`}</span>}
      </div>
      {peek && !open && (
        <button type="button" class="chat-peek" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(true)}>
          <span class="chat-dot" style={{ background: color(peek)?.fill, borderColor: color(peek)?.stroke }} />
          <span class="chat-peek-text">
            <strong>{peek.name}</strong> {peek.text}
          </span>
        </button>
      )}
      <button
        type="button"
        ref={fab}
        class={open ? 'chat-fab on' : 'chat-fab'}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls="chat-window"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-hidden="true">💬</span>
        {unread > 0 && (
          <span class="chat-badge" key={unread} aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <section
          id="chat-window"
          ref={win}
          class="chat-win"
          role="dialog"
          aria-labelledby="chat-title"
          tabIndex={-1}
          onKeyDown={(e) => {
            // keys typed here are for the chat, not the game's keyboard shortcuts
            e.stopPropagation();
            if (e.key === 'Escape') close();
          }}
        >
          <header class="chat-head">
            <h2 id="chat-title">Chat</h2>
            <button type="button" class="icon-btn chat-close" aria-label="Close chat" onClick={close}>
              ✕
            </button>
          </header>
          <ol class="chat-list" ref={list} aria-label="Messages">
            {messages.length === 0 && <li class="chat-empty">No messages yet. Say hello!</li>}
            {messages.map((m, i) => {
              const own = mine(m);
              const prev = messages[i - 1];
              const head = !prev || prev.seat !== m.seat || prev.name !== m.name || m.at - prev.at > 120_000;
              const c = color(m);
              return (
                <li key={m.id} class={`chat-msg${own ? ' mine' : ''}${head ? ' head' : ''}`}>
                  {head && (
                    <span class="chat-who">
                      <span class="chat-dot" style={{ background: c?.fill, borderColor: c?.stroke }} />
                      {m.name}
                      {own && <span class="chat-sr"> (you)</span>}
                    </span>
                  )}
                  {!head && <span class="chat-sr">{m.name}: </span>}
                  <span class={isEmojiOnly(m.text) ? 'chat-text emoji' : 'chat-text'}>{m.text}</span>
                </li>
              );
            })}
          </ol>
          <div
            class="chat-quick"
            role="group"
            aria-label="Quick messages"
            onWheel={(e) => {
              // a mouse wheel scrolls the row sideways
              const row = e.currentTarget;
              if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
              row.scrollLeft += e.deltaY;
              e.preventDefault();
            }}
          >
            {QUICK_PHRASES.map((p) => (
              <button type="button" key={p} class="chat-chip" onClick={() => send(p, false)}>
                {p}
              </button>
            ))}
          </div>
          <form
            class="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft, true);
            }}
          >
            <input
              ref={input}
              class="chat-input"
              aria-label="Message"
              placeholder="Message…"
              value={draft}
              maxLength={CHAT_MAX_LENGTH}
              autoComplete="off"
              enterKeyHint="send"
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
            <button type="submit" class="primary chat-send" aria-label="Send" disabled={!draft.trim()}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12.2 2-12.2 2z" fill="currentColor" />
              </svg>
            </button>
          </form>
          {note && (
            <p class="chat-note" role="status">
              {note}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
