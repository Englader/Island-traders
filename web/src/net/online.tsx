import type { Action } from 'engine';
import Peer from 'peerjs';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { flashOf } from '../ui/flash';
import type { GameController, SeatSnapshot } from '../game/controller';
import { PLAYER_COLORS } from '../game/seats';
import { clientId, loadJson, saveJson } from '../game/storage';
import { ChatWindow } from '../ui/ChatWindow';
import { GameScreen } from '../ui/GameScreen';
import { Logo } from '../ui/screens';
import { ChatHub, mergeChat, type ChatMessage, type ChatPostResult } from './chat';
import { GuestConnector, type Via } from './guest';
import { PROTOCOL, brokerOptions, hostPeerId, normalizeCode, randomRoomCode, roomToken, rtcConfig, type GuestMessage, type HostMessage, type LobbySeat } from './protocol';
import { RelayHost } from './relay';

// --- host -----------------------------------------------------------------------------

/** A connected friend, over a direct link or the relay. */
interface Guest {
  via: Via;
  readonly open: boolean;
  send(msg: HostMessage): void;
  close(): void;
  client: string | null;
  seat: number | null;
  /** The name from the guest's hello. */
  name: string;
  /** When the guest was last heard from. */
  seen: number;
}

/** Friends ping every 10 s; one silent for this long has gone. */
const GUEST_SILENCE_LIMIT = 40000;

export interface HostNet {
  status: string;
  ready: boolean;
  /** Seats with a connected friend. */
  online: Set<number>;
  newRoomCode(): string;
  broadcast(): void;
  /** The room's chat, oldest first. */
  chat: ChatMessage[];
  /** The host's own chat message; false when it was not sent. */
  sendChat(text: string): boolean;
}

/** The host keeps the room's chat in this browser, so a reload doesn't lose it. */
const CHAT_KEY = 'chat';

function lobbySeats(ctrl: GameController, online: Set<number>): LobbySeat[] {
  const claimed = new Set(Object.values(ctrl.record.claims ?? {}));
  return ctrl.seats.map((s, i) => ({ name: s.name, kind: s.kind, color: s.color, taken: claimed.has(i), online: s.kind !== 'remote' || online.has(i) }));
}

/**
 * Runs the host side of an online game: opens the room on the PeerJS room
 * server (direct links) and on the relay brokers, seats friends who connect,
 * applies their moves through the controller and sends every connected friend
 * their own view after each change.
 */
export function useHostNetwork(ctrl: GameController | null): HostNet {
  const [status, setStatus] = useState('');
  const [directReady, setDirectReady] = useState(false);
  const [relayReady, setRelayReady] = useState(false);
  const [online, setOnline] = useState<Set<number>>(new Set());
  const guests = useRef(new Set<Guest>());
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const hub = useRef<ChatHub | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);

  /** A chat message the hub accepted: keep it and pass it on to everyone. */
  const publish = (r: ChatPostResult | undefined) => {
    const h = hub.current;
    const code = ctrl?.record.room;
    if (!r?.ok || !h || !code) return;
    const msgs = h.history();
    setChat(msgs);
    saveJson(CHAT_KEY, { room: code, msgs });
    for (const g of guests.current) if (g.client !== null) g.send({ t: 'chat', msg: r.message });
  };

  const sendChat = (text: string): boolean => {
    if (!ctrl) return false;
    const seat = ctrl.viewer;
    const r = hub.current?.post({ seat, name: seat !== null ? ctrl.seats[seat]?.name ?? 'Host' : 'Host' }, text);
    publish(r);
    return r?.ok === true;
  };

  const sendState = (g: Guest) => {
    if (!ctrl) return;
    const seats = lobbySeats(ctrl, onlineRef.current);
    if (!ctrl.record.started) {
      g.send({ t: 'lobby', scenario: ctrl.state.scenario, seats, started: false, host: ctrl.seats.find((s) => s.kind === 'human')?.name ?? 'Host' });
      return;
    }
    const snap: SeatSnapshot = ctrl.snapshot(g.seat);
    g.send({ t: 'state', snap, seats, last: ctrl.last ? { action: ctrl.last.action, at: ctrl.last.at } : null });
  };

  const broadcast = () => {
    for (const g of guests.current) if (g.client !== null) sendState(g);
  };

  const room = ctrl?.record.room;
  useEffect(() => {
    if (!ctrl || !room) return;
    let peer: Peer | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const relayGuests = new Map<string, Guest>();
    const saved = loadJson<{ room: string; msgs: ChatMessage[] }>(CHAT_KEY);
    hub.current = new ChatHub(saved?.room === room && Array.isArray(saved.msgs) ? saved.msgs : []);
    setChat(hub.current.history());

    const refreshOnline = () => {
      const s = new Set<number>();
      for (const g of guests.current) if (g.seat !== null && g.open) s.add(g.seat);
      setOnline(s);
    };

    const drop = (g: Guest) => {
      if (!guests.current.delete(g)) return;
      g.close();
      refreshOnline();
    };

    const handle = (g: Guest, msg: GuestMessage) => {
      if (!msg || typeof msg !== 'object') return;
      g.seen = Date.now();
      if (msg.t === 'ping') {
        g.send({ t: 'pong' });
        return;
      }
      if (msg.t === 'bye') {
        drop(g);
        return;
      }
      if (msg.t === 'hello') {
        if (msg.v !== PROTOCOL) {
          g.send({ t: 'welcome', seat: null, reason: 'This room runs a different version of the game. Reload the page.' });
          return;
        }
        const client = String(msg.client).slice(0, 40);
        const name = String(msg.name || 'Friend').slice(0, 16);
        g.client = client;
        g.name = name;
        const history = () => g.send(hub.current?.joinMessage() ?? { t: 'chatHistory', msgs: [] });
        const claims = ctrl.record.claims ?? {};
        let seat = claims[client];
        if (seat === undefined || ctrl.seats[seat]?.kind !== 'remote') {
          const taken = new Set(Object.values(claims));
          seat = ctrl.seats.findIndex((s, i) => s.kind === 'remote' && !taken.has(i));
          if (seat < 0) {
            g.send({ t: 'welcome', seat: null, reason: 'All seats are taken. You are watching.' });
            g.seat = null;
            history();
            sendState(g);
            return;
          }
        }
        // one link per seat: drop an older one from the same seat
        for (const other of [...guests.current]) if (other !== g && other.seat === seat) drop(other);
        g.seat = seat;
        ctrl.claimSeat(client, seat, name);
        g.send({ t: 'welcome', seat });
        history();
        refreshOnline();
        broadcast();
        return;
      }
      if (msg.t === 'action') {
        const a = msg.action as Action;
        if (g.seat === null || !a || typeof a !== 'object' || a.player !== g.seat) {
          g.send({ t: 'error', message: 'That is not your seat.' });
          return;
        }
        if (!ctrl.record.started) {
          g.send({ t: 'error', message: 'The host has not started the game yet.' });
          return;
        }
        const err = ctrl.act(a);
        if (err) g.send({ t: 'error', message: err });
        return;
      }
      if (msg.t === 'chat') {
        // dropped unless the guest said hello; the sender comes from the host's own records
        const r = hub.current?.fromGuest(g, msg, (s) => ctrl.seats[s]?.name);
        if (r && !r.ok && r.reason === 'limited') g.send({ t: 'error', message: 'Too many chat messages: wait a few seconds.' });
        publish(r);
      }
    };

    // relay: friends whose network can't make a direct link
    const relay = new RelayHost(room);
    relay.onstatus = () => setRelayReady(relay.ready > 0);
    relay.onmessage = (from, msg) => {
      const key = `${from.broker}:${from.id}`;
      let g = relayGuests.get(key);
      if (!g) {
        if (msg.t !== 'hello') return; // a stale link from before a reload
        let isOpen = true;
        const ng: Guest = {
          via: 'relay',
          get open() {
            return isOpen;
          },
          send: (m) => isOpen && relay.send(from, m),
          close: () => {
            isOpen = false;
            relayGuests.delete(key);
          },
          client: null,
          seat: null,
          name: 'Friend',
          seen: Date.now(),
        };
        g = ng;
        relayGuests.set(key, ng);
        guests.current.add(ng);
      }
      handle(g, msg);
    };

    // direct links through the PeerJS room server
    const open = () => {
      if (closed) return;
      if (retry) clearTimeout(retry);
      retry = null;
      peer?.destroy();
      setDirectReady(false);
      setStatus('Opening the room…');
      // the same token every time lets a reloaded or woken-up tab take the room
      // code straight back instead of waiting for the server to drop the old one
      const p = new Peer(hostPeerId(room), { debug: 0, token: roomToken(room), config: rtcConfig(), ...brokerOptions() });
      peer = p;
      p.on('open', () => setDirectReady(true));
      p.on('connection', (conn) => {
        const g: Guest = {
          via: 'direct',
          get open() {
            return conn.open;
          },
          send: (m) => {
            try {
              if (conn.open) conn.send(m);
            } catch {
              // connection dropped; its close handler cleans up
            }
          },
          close: () => conn.close(),
          client: null,
          seat: null,
          name: 'Friend',
          seen: Date.now(),
        };
        guests.current.add(g);
        conn.on('data', (d) => handle(g, d as GuestMessage));
        conn.on('close', () => drop(g));
        conn.on('error', () => drop(g));
      });
      p.on('disconnected', () => {
        if (closed || p.destroyed) return;
        setDirectReady(false);
        setStatus('Reconnecting to the room server…');
        try {
          p.reconnect();
        } catch {
          // handled by the error/retry path
        }
      });
      p.on('error', (err: { type?: string; message?: string }) => {
        if (closed || peer !== p) return;
        const type = err?.type ?? '';
        if (type === 'peer-unavailable') return; // a guest vanished; not fatal
        setDirectReady(false);
        setStatus(
          type === 'unavailable-id'
            ? 'The room code is still held by an earlier session; retrying…'
            : `Connection problem (${type || err?.message || 'unknown'}); retrying…`,
        );
        p.destroy();
        retry = setTimeout(open, type === 'unavailable-id' ? 6000 : 3000);
      });
    };
    // Phones pause a page that is not on screen (e.g. while the host sends the
    // code in a chat app) and drop its links. Check them whenever the page is
    // back and every few seconds.
    const wake = () => {
      if (closed) return;
      relay.wake();
      if (retry) return;
      if (!peer || peer.destroyed) open();
      else if (peer.disconnected) {
        setDirectReady(false);
        setStatus('Reconnecting to the room server…');
        try {
          peer.reconnect();
        } catch {
          open();
        }
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', wake);
    const watchdog = setInterval(() => {
      wake();
      const now = Date.now();
      for (const g of [...guests.current]) if (now - g.seen > GUEST_SILENCE_LIMIT) drop(g);
    }, 5000);
    open();
    const unsub = ctrl.subscribe(broadcast);
    return () => {
      closed = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', wake);
      clearInterval(watchdog);
      if (retry) clearTimeout(retry);
      for (const g of guests.current) g.close();
      guests.current.clear();
      relay.close();
      peer?.destroy();
      hub.current = null;
      setChat([]);
      setDirectReady(false);
      setRelayReady(false);
      setStatus('');
    };
  }, [ctrl, room]);

  useEffect(() => {
    // online flags changed: tell everyone
    broadcast();
  }, [online]);

  const ready = directReady || relayReady;
  return useMemo(
    () => ({
      status: ready ? `Room ${room} · ${online.size} friend${online.size === 1 ? '' : 's'} online` : status,
      ready,
      online,
      newRoomCode: randomRoomCode,
      broadcast,
      chat,
      sendChat,
    }),
    [status, ready, online, room, ctrl, chat],
  );
}

function shareUrl(code: string): string {
  return `${location.origin}${location.pathname}${location.search}#join=${code}`;
}

export function HostLobby({ ctrl, net, onPlay, onHome }: { ctrl: GameController; net: HostNet; onPlay(): void; onHome(): void }) {
  const code = ctrl.record.room ?? '';
  const [copied, setCopied] = useState(false);
  const claimed = new Set(Object.values(ctrl.record.claims ?? {}));
  const remote = ctrl.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'remote');
  const missing = remote.filter(({ i }) => !claimed.has(i));
  const url = shareUrl(code);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Island Traders', text: `Join my Island Traders game: room ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch {
      // cancelled
    }
  };
  const start = () => {
    for (const { i } of missing) ctrl.setSeatKind(i, 'bot');
    ctrl.markStarted();
    net.broadcast();
    onPlay();
  };
  return (
    <main class="lobby">
      <header class="setup-head">
        <button type="button" class="icon-btn" onClick={onHome} aria-label="Home">
          ←
        </button>
        <h1>Online room</h1>
      </header>
      <section class="lobby-code">
        <p>Friends open this game and enter the code:</p>
        <div class="code big-code">{code}</div>
        <div class="row">
          <button type="button" class="primary" onClick={share}>
            {copied ? 'Link copied' : 'Share invite link'}
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
              } catch {
                // clipboard blocked
              }
            }}
          >
            Copy code
          </button>
        </div>
        <p class={net.ready ? 'hint ok' : 'hint'}>{net.status || 'Opening the room…'}</p>
        <p class="hint">After sending the code, come back to this screen: friends can only join while it is open.</p>
      </section>
      <section class="setup-section">
        <h2>Seats</h2>
        <div class="seat-list">
          {ctrl.seats.map((s, i) => (
            <div class="seat lobby-seat" key={i}>
              <span class="swatch" style={{ background: PLAYER_COLORS[s.color].fill, borderColor: PLAYER_COLORS[s.color].stroke }} />
              <span class="seat-name">{s.name}</span>
              <span class="seat-state">
                {s.kind === 'human' ? 'this device' : s.kind === 'bot' ? 'computer' : claimed.has(i) ? (net.online.has(i) ? '🟢 online' : '⚪ offline') : 'waiting…'}
              </span>
              {s.kind === 'remote' && (
                <button type="button" class="small-btn" onClick={() => ctrl.setSeatKind(i, 'bot')}>
                  Computer
                </button>
              )}
              {s.kind === 'bot' && ctrl.record.room && (
                <button type="button" class="small-btn" onClick={() => ctrl.setSeatKind(i, 'remote')}>
                  Friend
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
      <div class="setup-foot">
        {ctrl.record.started ? (
          <button type="button" class="primary big wide" onClick={onPlay}>
            Back to the game
          </button>
        ) : (
          <button type="button" class="primary big wide" onClick={start}>
            {missing.length > 0 ? `Start (${missing.length} empty seat${missing.length === 1 ? '' : 's'} → computer)` : 'Start the game'}
          </button>
        )}
        <p class="hint">Keep this screen open while you play: your phone runs the game for everyone.</p>
      </div>
    </main>
  );
}

// --- guest ----------------------------------------------------------------------------------

export function JoinScreen({ initialCode, onJoin, onBack }: { initialCode: string; onJoin(code: string, name: string): void; onBack(): void }) {
  const [code, setCode] = useState(initialCode || loadJson<string>('lastRoom') || '');
  const [name, setName] = useState(loadJson<string>('playerName') || '');
  const ok = normalizeCode(code).length >= 4 && name.trim().length > 0;
  return (
    <main class="join">
      <header class="setup-head">
        <button type="button" class="icon-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h1>Join a game</h1>
      </header>
      <form
        class="join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          saveJson('playerName', name.trim());
          saveJson('lastRoom', normalizeCode(code));
          onJoin(normalizeCode(code), name.trim());
        }}
      >
        <label>
          Room code
          <input
            class="code-input"
            value={code}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={8}
            onInput={(e) => setCode(normalizeCode((e.target as HTMLInputElement).value))}
          />
        </label>
        <label>
          Your name
          <input value={name} maxLength={16} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <button type="submit" class="primary big wide" disabled={!ok}>
          Join
        </button>
      </form>
    </main>
  );
}

type GuestState =
  | { kind: 'connecting'; msg: string }
  | { kind: 'lobby'; seats: LobbySeat[]; host: string; seat: number | null; note?: string }
  | { kind: 'game'; snap: SeatSnapshot; seats: LobbySeat[]; last: { action: Action; at: number } | null; seat: number | null; note?: string };

export function GuestScreen({ code, playerName, onHome, onRules }: { code: string; playerName: string; onHome(): void; onRules(): void }) {
  const [st, setSt] = useState<GuestState>({ kind: 'connecting', msg: 'Looking for the room…' });
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const conn = useRef<GuestConnector | null>(null);
  const seatRef = useRef<number | null>(null);
  const [online, setOnline] = useState<Via | null>(null);
  // null until the host sends a chat history (a host without chat never does)
  const [chat, setChat] = useState<ChatMessage[] | null>(null);

  useEffect(() => {
    const say = (msg: string) => setSt((cur) => (cur.kind === 'connecting' ? { kind: 'connecting', msg } : { ...cur, note: msg }));
    const g = new GuestConnector(
      code,
      { t: 'hello', v: PROTOCOL, name: playerName, client: clientId() },
      {
        status: say,
        online: (via) => {
          setOnline(via);
          if (via) setSt((cur) => (cur.kind === 'connecting' ? cur : { ...cur, note: undefined }));
        },
        message: (msg) => {
          if (msg.t === 'welcome') {
            seatRef.current = msg.seat;
            if (msg.reason) setError(msg.reason);
          } else if (msg.t === 'lobby') {
            setSt({ kind: 'lobby', seats: msg.seats, host: msg.host, seat: seatRef.current });
          } else if (msg.t === 'state') {
            setSt({ kind: 'game', snap: msg.snap, seats: msg.seats, last: msg.last, seat: msg.snap.seat });
          } else if (msg.t === 'error') {
            setError(msg.message);
          } else if (msg.t === 'chatHistory') {
            setChat((cur) => mergeChat(cur ?? [], msg.msgs));
          } else if (msg.t === 'chat') {
            setChat((cur) => (cur ? mergeChat(cur, [msg.msg]) : cur));
          }
        },
      },
    );
    conn.current = g;
    // back on screen or back online: check the link straight away
    const wake = () => g.wake();
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', wake);
      g.close();
      conn.current = null;
    };
  }, [code, playerName]);

  const send = (a: Action) => {
    if (!conn.current?.send({ t: 'action', action: a })) setError('Not connected to the host right now.');
  };
  const sendChat = (text: string) => conn.current?.send({ t: 'chat', text }) ?? false;

  if (st.kind === 'connecting') {
    return (
      <main class="join">
        <div class="home-card">
          <Logo />
          <h1>Room {code}</h1>
          <p class="hint">{st.msg}</p>
          <span class="spinner big" />
          <button type="button" onClick={onHome}>
            Cancel
          </button>
        </div>
      </main>
    );
  }
  if (st.kind === 'lobby') {
    return (
      <main class="lobby">
        <header class="setup-head">
          <button type="button" class="icon-btn" onClick={onHome} aria-label="Leave">
            ←
          </button>
          <h1>Room {code}</h1>
        </header>
        <section class="setup-section">
          <p>
            {st.seat === null ? 'You are watching.' : `You are seated as ${st.seats[st.seat]?.name}.`} Waiting for {st.host} to start the game…
          </p>
          <div class="seat-list">
            {st.seats.map((s, i) => (
              <div class="seat lobby-seat" key={i}>
                <span class="swatch" style={{ background: PLAYER_COLORS[s.color].fill, borderColor: PLAYER_COLORS[s.color].stroke }} />
                <span class="seat-name">
                  {s.name}
                  {i === st.seat ? ' (you)' : ''}
                </span>
                <span class="seat-state">{s.kind === 'human' ? 'host' : s.kind === 'bot' ? 'computer' : s.taken ? (s.online ? '🟢' : '⚪') : 'waiting…'}</span>
              </div>
            ))}
          </div>
          {st.note && <p class="hint">{st.note}</p>}
          {error && <p class="hint">{error}</p>}
          <span class="spinner" />
        </section>
      </main>
    );
  }
  const colors = st.seats.map((s) => PLAYER_COLORS[s.color]);
  return (
    <>
      <GameScreen
        view={st.snap.view}
        legal={st.snap.legal}
        seat={st.seat}
        colors={colors}
        kinds={st.seats.map((s) => s.kind)}
        send={send}
        error={error}
        clearError={() => setError(null)}
        flash={flashOf(st.last?.action, st.last?.at ?? 0)}
        last={st.last}
        onMenu={() => setMenu(true)}
        onHome={onHome}
        note={online ? `Room ${code}${online === 'relay' ? ' · via relay' : ''}` : st.note ?? 'Offline'}
        chat={chat && <ChatWindow messages={chat} seat={st.seat} colors={colors} room={code} onSend={sendChat} />}
      />
      {menu && (
        <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setMenu(false)}>
          <section class="sheet" role="dialog" aria-label="Menu">
            <header class="sheet-head">
              <h2>Room {code}</h2>
              <button type="button" class="icon-btn" aria-label="Close" onClick={() => setMenu(false)}>
                ✕
              </button>
            </header>
            <div class="sheet-body menu">
              <button type="button" class="wide" onClick={() => setMenu(false)}>
                Back to the game
              </button>
              <button
                type="button"
                class="wide"
                onClick={() => {
                  setMenu(false);
                  onRules();
                }}
              >
                How to play
              </button>
              <button type="button" class="wide danger-outline" onClick={onHome}>
                Leave (you can rejoin with the same code)
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
