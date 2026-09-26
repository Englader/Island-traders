import type { Action } from 'engine';
import Peer, { type DataConnection } from 'peerjs';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { flashOf } from '../ui/flash';
import type { GameController, SeatSnapshot } from '../game/controller';
import { PLAYER_COLORS } from '../game/seats';
import { clientId, loadJson, saveJson } from '../game/storage';
import { GameScreen } from '../ui/GameScreen';
import { Logo } from '../ui/screens';
import { PROTOCOL, brokerOptions, hostPeerId, normalizeCode, randomRoomCode, type GuestMessage, type HostMessage, type LobbySeat } from './protocol';

// --- host -----------------------------------------------------------------------------

interface Guest {
  conn: DataConnection;
  client: string | null;
  seat: number | null;
}

export interface HostNet {
  status: string;
  ready: boolean;
  /** Seats with a connected friend. */
  online: Set<number>;
  newRoomCode(): string;
  broadcast(): void;
}

function lobbySeats(ctrl: GameController, online: Set<number>): LobbySeat[] {
  const claimed = new Set(Object.values(ctrl.record.claims ?? {}));
  return ctrl.seats.map((s, i) => ({ name: s.name, kind: s.kind, color: s.color, taken: claimed.has(i), online: s.kind !== 'remote' || online.has(i) }));
}

/**
 * Runs the host side of an online game: registers the room code with the
 * PeerJS broker, seats friends who connect, applies their moves through the
 * controller and sends every connected friend their own view after each change.
 */
export function useHostNetwork(ctrl: GameController | null): HostNet {
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState<Set<number>>(new Set());
  const guests = useRef(new Set<Guest>());
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const send = (g: Guest, msg: HostMessage) => {
    try {
      if (g.conn.open) g.conn.send(msg);
    } catch {
      // connection dropped; its close handler cleans up
    }
  };

  const sendState = (g: Guest) => {
    if (!ctrl) return;
    const seats = lobbySeats(ctrl, onlineRef.current);
    if (!ctrl.record.started) {
      send(g, { t: 'lobby', scenario: ctrl.state.scenario, seats, started: false, host: ctrl.seats.find((s) => s.kind === 'human')?.name ?? 'Host' });
      return;
    }
    const snap: SeatSnapshot = ctrl.snapshot(g.seat);
    send(g, { t: 'state', snap, seats, last: ctrl.last ? { action: ctrl.last.action, at: ctrl.last.at } : null });
  };

  const broadcast = () => {
    for (const g of guests.current) sendState(g);
  };

  const room = ctrl?.record.room;
  useEffect(() => {
    if (!ctrl || !room) return;
    let peer: Peer | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const refreshOnline = () => {
      const s = new Set<number>();
      for (const g of guests.current) if (g.seat !== null && g.conn.open) s.add(g.seat);
      setOnline(s);
    };

    const handle = (g: Guest, msg: GuestMessage) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        if (msg.v !== PROTOCOL) {
          send(g, { t: 'welcome', seat: null, reason: 'This room runs a different version of the game. Reload the page.' });
          return;
        }
        const client = String(msg.client).slice(0, 40);
        const name = String(msg.name || 'Friend').slice(0, 16);
        g.client = client;
        const claims = ctrl.record.claims ?? {};
        let seat = claims[client];
        if (seat === undefined || ctrl.seats[seat]?.kind !== 'remote') {
          const taken = new Set(Object.values(claims));
          seat = ctrl.seats.findIndex((s, i) => s.kind === 'remote' && !taken.has(i));
          if (seat < 0) {
            send(g, { t: 'welcome', seat: null, reason: 'All seats are taken. You are watching.' });
            g.seat = null;
            sendState(g);
            return;
          }
        }
        // one connection per seat: drop an older one from the same seat
        for (const other of guests.current) if (other !== g && other.seat === seat) other.conn.close();
        g.seat = seat;
        ctrl.claimSeat(client, seat, name);
        send(g, { t: 'welcome', seat });
        refreshOnline();
        broadcast();
        return;
      }
      if (msg.t === 'action') {
        const a = msg.action as Action;
        if (g.seat === null || !a || typeof a !== 'object' || a.player !== g.seat) {
          send(g, { t: 'error', message: 'That is not your seat.' });
          return;
        }
        if (!ctrl.record.started) {
          send(g, { t: 'error', message: 'The host has not started the game yet.' });
          return;
        }
        const err = ctrl.act(a);
        if (err) send(g, { t: 'error', message: err });
      }
    };

    const open = () => {
      if (closed) return;
      setReady(false);
      setStatus('Opening the room…');
      peer = new Peer(hostPeerId(room), { debug: 0, ...brokerOptions() });
      peer.on('open', () => {
        setReady(true);
        setStatus('Room open');
      });
      peer.on('connection', (conn) => {
        const g: Guest = { conn, client: null, seat: null };
        guests.current.add(g);
        conn.on('data', (d) => handle(g, d as GuestMessage));
        conn.on('close', () => {
          guests.current.delete(g);
          refreshOnline();
        });
        conn.on('error', () => {
          guests.current.delete(g);
          refreshOnline();
        });
      });
      peer.on('disconnected', () => {
        if (!closed && peer && !peer.destroyed) {
          setStatus('Reconnecting to the room server…');
          try {
            peer.reconnect();
          } catch {
            // handled by the error/retry path
          }
        }
      });
      peer.on('error', (err: { type?: string; message?: string }) => {
        if (closed) return;
        const type = err?.type ?? '';
        if (type === 'peer-unavailable') return; // a guest vanished; not fatal
        setReady(false);
        setStatus(
          type === 'unavailable-id'
            ? 'The room code is still held by an earlier session; retrying…'
            : `Connection problem (${type || err?.message || 'unknown'}); retrying…`,
        );
        peer?.destroy();
        retry = setTimeout(open, type === 'unavailable-id' ? 6000 : 4000);
      });
    };
    open();
    const unsub = ctrl.subscribe(() => {
      for (const g of guests.current) sendState(g);
    });
    return () => {
      closed = true;
      unsub();
      if (retry) clearTimeout(retry);
      for (const g of guests.current) g.conn.close();
      guests.current.clear();
      peer?.destroy();
      setReady(false);
      setStatus('');
    };
  }, [ctrl, room]);

  useEffect(() => {
    // online flags changed: tell everyone
    broadcast();
  }, [online]);

  return useMemo(
    () => ({
      status: ready ? `Room ${room} · ${online.size} friend${online.size === 1 ? '' : 's'} online` : status,
      ready,
      online,
      newRoomCode: randomRoomCode,
      broadcast,
    }),
    [status, ready, online, room],
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
        <p class="hint">Keep this tab open while you play: your browser runs the game for everyone.</p>
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
  const [st, setSt] = useState<GuestState>({ kind: 'connecting', msg: 'Connecting to the room…' });
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const conn = useRef<DataConnection | null>(null);
  const seatRef = useRef<number | null>(null);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let peer: Peer | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const me = clientId();

    const schedule = (msg: string) => {
      if (closed) return;
      setOnline(false);
      setSt((cur) => (cur.kind === 'connecting' ? { kind: 'connecting', msg } : { ...cur, note: msg }));
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 3500);
    };

    const connect = () => {
      if (closed) return;
      peer?.destroy();
      peer = new Peer({ debug: 0, ...brokerOptions() });
      peer.on('open', () => {
        const c = peer!.connect(hostPeerId(code), { reliable: true, serialization: 'json' });
        conn.current = c;
        c.on('open', () => {
          setOnline(true);
          c.send({ t: 'hello', v: PROTOCOL, name: playerName, client: me } satisfies GuestMessage);
        });
        c.on('data', (raw) => {
          const msg = raw as HostMessage;
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === 'welcome') {
            seatRef.current = msg.seat;
            if (msg.reason) setError(msg.reason);
          } else if (msg.t === 'lobby') {
            setSt({ kind: 'lobby', seats: msg.seats, host: msg.host, seat: seatRef.current });
          } else if (msg.t === 'state') {
            setSt({ kind: 'game', snap: msg.snap, seats: msg.seats, last: msg.last, seat: msg.snap.seat });
          } else if (msg.t === 'error') {
            setError(msg.message);
          }
        });
        c.on('close', () => schedule('Connection lost. Reconnecting…'));
        c.on('error', () => schedule('Connection problem. Reconnecting…'));
      });
      peer.on('error', (err: { type?: string }) => {
        if (err?.type === 'peer-unavailable') schedule(`Room ${code} is not open. Is the host's tab still open? Retrying…`);
        else schedule(`Connection problem (${err?.type ?? 'unknown'}). Retrying…`);
      });
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      conn.current?.close();
      peer?.destroy();
    };
  }, [code, playerName]);

  const send = (a: Action) => {
    if (conn.current?.open) conn.current.send({ t: 'action', action: a } satisfies GuestMessage);
    else setError('Not connected to the host right now.');
  };

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
        onMenu={() => setMenu(true)}
        onHome={onHome}
        note={online ? `Room ${code}` : st.note ?? 'Offline'}
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
