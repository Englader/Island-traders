import Peer, { type DataConnection } from 'peerjs';
import { brokerOptions, hostPeerId, linkMode, rtcConfig, type GuestMessage, type HostMessage } from './protocol';
import { RelayGuest, relayUrls } from './relay';

export type Via = 'direct' | 'relay';

export interface GuestEvents {
  /** What is happening, in words for the player. */
  status(msg: string): void;
  message(msg: HostMessage): void;
  /** Connected to the host (and how), or null when the link is gone. */
  online(via: Via | null): void;
}

/** Try the relay when a direct link hasn't opened after this long. */
const RELAY_AFTER = 4000;
/** Give up on an attempt after this long and start a fresh one. */
const ATTEMPT_TIMEOUT = 20000;
/** The host must answer the hello within this time. */
const WELCOME_TIMEOUT = 10000;
/** Say hello again this often until the host answers (a relay broker may still be subscribing). */
const HELLO_EVERY = 2500;
const PING_EVERY = 10000;
/** No word from the host for this long: the link is dead. */
const SILENCE_LIMIT = 30000;

interface Link {
  via: Via;
  send(msg: GuestMessage): void;
  close(): void;
}

/**
 * Keeps a guest connected to the host. Each attempt tries a direct WebRTC
 * link and, if that hasn't opened after a few seconds, the relay too; the
 * first one to open is used. A heartbeat notices a dead link and the guest
 * tries again, for as long as the screen is open.
 */
export class GuestConnector {
  private peer: Peer | null = null;
  private direct: DataConnection | null = null;
  private wantDirect = false;
  private relay: RelayGuest | null = null;
  private active: Link | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private beat: ReturnType<typeof setInterval>;
  private closed = false;
  private trying = false;
  private attempt = 0;
  private heard = 0;
  private pinged = 0;
  private mode = linkMode();

  constructor(
    private code: string,
    private hello: GuestMessage,
    private ev: GuestEvents,
  ) {
    this.beat = setInterval(() => this.heartbeat(), 2000);
    this.start();
  }

  /** Sends a message to the host; false when not connected. */
  send(msg: GuestMessage): boolean {
    if (!this.active || !this.heard) return false;
    this.active.send(msg);
    return true;
  }

  /** The page is back on screen or back online: check the link now. */
  wake(): void {
    if (this.closed) return;
    if (this.active) {
      // the page may have been asleep: if the host doesn't answer a ping
      // quickly, don't wait for the heartbeat to notice
      const at = Date.now();
      this.pinged = at;
      this.active.send({ t: 'ping' });
      this.later('wake', 5000, () => {
        if (this.active && this.heard < at) this.retry('Connection to the host lost.', 0);
      });
    } else if (!this.trying) {
      this.start();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.beat);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.active && this.heard) this.active.send({ t: 'bye' });
    this.active = null;
    this.dropPending();
    this.peer?.destroy();
    this.peer = null;
  }

  private later(name: string, ms: number, fn: () => void) {
    this.clear(name);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        if (!this.closed) fn();
      }, ms),
    );
  }

  private clear(...names: string[]) {
    for (const n of names) {
      const t = this.timers.get(n);
      if (t) clearTimeout(t);
      this.timers.delete(n);
    }
  }

  private start() {
    if (this.closed || this.active) return;
    this.clear('retry');
    this.dropPending();
    this.trying = true;
    this.attempt++;
    this.ev.status(this.attempt === 1 ? 'Looking for the room…' : `Trying to reach the host again (attempt ${this.attempt})…`);
    if (this.mode !== 'relay') this.dialDirect();
    if (this.mode === 'relay') this.dialRelay();
    else if (this.mode === 'both') this.later('relay', RELAY_AFTER, () => this.dialRelay());
    this.later('attempt', ATTEMPT_TIMEOUT, () =>
      this.retry("The host isn't answering. They need Island Traders open on screen, not in the background."),
    );
  }

  /** Abandons the current attempt or link and starts over shortly. */
  private retry(msg: string, wait = 2000) {
    if (this.closed) return;
    const wasOnline = this.active !== null && this.heard > 0;
    this.active = null;
    this.heard = 0;
    this.dropPending();
    this.clear('relay', 'attempt', 'welcome', 'wake');
    this.trying = false;
    if (wasOnline) this.ev.online(null);
    this.ev.status(`${msg} Retrying…`);
    this.later('retry', wait, () => this.start());
  }

  /** Closes every link except the active one (all of them when none is active). */
  private dropPending() {
    this.wantDirect = false;
    if (this.active?.via !== 'direct') this.dropDirect();
    if (this.relay && this.active?.via !== 'relay') {
      const r = this.relay;
      this.relay = null;
      r.onmessage = null;
      r.onclose = null;
      r.close();
    }
  }

  // --- direct link (PeerJS / WebRTC) ---------------------------------------------------------

  private dropDirect() {
    const d = this.direct;
    this.direct = null;
    if (d) {
      d.removeAllListeners();
      d.close();
    }
  }

  private dialDirect() {
    this.wantDirect = true;
    const p = this.peer;
    if (p && !p.destroyed && p.open) {
      this.connectDirect(p);
      return;
    }
    if (p && !p.destroyed && p.disconnected) {
      try {
        p.reconnect(); // its 'open' event dials
        return;
      } catch {
        p.destroy();
      }
    }
    if (p && !p.destroyed) return; // still opening; its 'open' event dials
    const np = new Peer({ debug: 0, config: rtcConfig(), ...brokerOptions() });
    this.peer = np;
    np.on('open', () => {
      if (this.peer === np && this.wantDirect && !this.direct && !this.active) this.connectDirect(np);
    });
    np.on('error', (err: { type?: string }) => {
      if (this.peer !== np || this.closed) return;
      const type = err?.type ?? '';
      if (type !== 'peer-unavailable') {
        // the room server itself is the problem: start from a fresh one next time
        np.destroy();
        this.peer = null;
      }
      if (this.active) return;
      this.dropDirect();
      if (this.mode === 'direct') {
        this.retry(type === 'peer-unavailable' ? `Room ${this.code} isn't open right now.` : "Can't reach the room server.", 3000);
      } else {
        this.dialRelay();
      }
    });
  }

  private connectDirect(p: Peer) {
    this.wantDirect = false;
    const c = p.connect(hostPeerId(this.code), { reliable: true, serialization: 'json' });
    this.direct = c;
    c.on('iceStateChanged', (state) => {
      if (this.direct === c && !this.active && state === 'checking') this.ev.status('Found the room. Connecting to the host…');
    });
    c.on('open', () => {
      if (this.direct !== c) return;
      if (this.active) {
        this.direct = null;
        c.close();
        return;
      }
      this.activate({ via: 'direct', send: (m) => c.open && c.send(m), close: () => c.close() });
    });
    c.on('data', (raw) => {
      if (this.direct === c && this.active?.via === 'direct') this.receive(raw as HostMessage);
    });
    const gone = () => {
      if (this.direct !== c) return;
      this.direct = null;
      if (this.active?.via === 'direct') this.retry('Connection to the host lost.', 1000);
      else if (!this.active && this.mode === 'both') this.dialRelay();
    };
    c.on('close', gone);
    c.on('error', gone);
  }

  // --- relay (public MQTT broker) --------------------------------------------------------------

  private dialRelay() {
    if (this.closed || this.active || this.relay || this.mode === 'direct') return;
    this.clear('relay');
    // start with a different broker on each attempt, in case the host can't use the first
    const r = new RelayGuest(this.code, Math.max(0, this.attempt - 1) % relayUrls().length);
    this.relay = r;
    r.onmessage = (m) => {
      if (this.relay === r && this.active?.via === 'relay') this.receive(m);
    };
    r.onclose = () => {
      if (this.relay !== r) return;
      this.relay = null;
      if (this.active?.via === 'relay') this.retry('Connection to the host lost.', 1000);
    };
    r.connect().then(
      () => {
        if (this.relay !== r) return;
        if (this.active) {
          this.relay = null;
          r.close();
          return;
        }
        this.activate({ via: 'relay', send: (m) => r.send(m), close: () => r.close() });
      },
      () => {
        if (this.relay === r) this.relay = null;
      },
    );
  }

  // --- the chosen link -------------------------------------------------------------------------

  private activate(link: Link) {
    this.active = link;
    this.heard = 0;
    this.dropPending();
    this.clear('relay', 'attempt');
    this.ev.status('Connected. Joining…');
    const started = Date.now();
    const hello = () => {
      if (this.active !== link || this.heard) return;
      if (Date.now() - started >= WELCOME_TIMEOUT) {
        this.retry("The host didn't reply.");
        return;
      }
      link.send(this.hello);
      this.later('welcome', HELLO_EVERY, hello);
    };
    hello();
  }

  private receive(msg: HostMessage) {
    if (!msg || typeof msg !== 'object') return;
    const first = this.heard === 0;
    this.heard = Date.now();
    if (first) {
      this.clear('welcome');
      this.trying = false;
      this.attempt = 0;
      this.pinged = Date.now();
      this.ev.online(this.active!.via);
    }
    if (msg.t !== 'pong') this.ev.message(msg);
  }

  private heartbeat() {
    if (this.closed || !this.active || !this.heard) return;
    const now = Date.now();
    if (now - this.heard > SILENCE_LIMIT) {
      this.retry('Connection to the host lost.', 500);
      return;
    }
    if (now - this.pinged >= PING_EVERY) {
      this.pinged = now;
      this.active.send({ t: 'ping' });
    }
  }
}
