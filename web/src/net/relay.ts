import { MqttClient } from './mqtt';
import type { GuestMessage, HostMessage } from './protocol';

/**
 * The relay: when two phones can't reach each other directly (common on
 * mobile data), game messages go through a public MQTT broker over a secure
 * WebSocket instead. Both phones only make outgoing connections, so any
 * network that can open a web page works.
 *
 * Everything sent through a broker is compressed and encrypted (AES-GCM) with
 * a key derived from the room code, and the topic names are hashes, so the
 * broker and anyone listening on it see neither the code nor the game.
 */

const PUBLIC_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];

/**
 * Brokers in the order a guest tries them. `?mqtt=url,url` in the page URL
 * narrows them down or points at a broker on this machine (tests); a link
 * can't send players to some other broker.
 */
export function relayUrls(): string[] {
  const q = new URLSearchParams(location.search).get('mqtt');
  const picked = (q ?? '').split(',').filter((u) => PUBLIC_BROKERS.includes(u) || /^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(u));
  return picked.length > 0 ? picked : PUBLIC_BROKERS;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function randomId(n = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

async function pipe(data: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(await out);
}

const keyCache = new Map<string, Promise<RoomKey>>();

/** The room's topic names and encryption key, derived from the room code. */
export class RoomKey {
  private constructor(
    private key: CryptoKey,
    readonly base: string,
  ) {}

  /** Derived once per room code (it takes a moment on a phone). */
  static derive(code: string): Promise<RoomKey> {
    let k = keyCache.get(code);
    if (!k) {
      k = RoomKey.compute(code);
      keyCache.set(code, k);
      k.catch(() => keyCache.delete(code));
    }
    return k;
  }

  private static async compute(code: string): Promise<RoomKey> {
    const material = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
    const topicBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('island-traders relay topic'), iterations: 20000 },
      material,
      96,
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('island-traders relay key'), iterations: 100000 },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const hex = Array.from(new Uint8Array(topicBits), (b) => b.toString(16).padStart(2, '0')).join('');
    return new RoomKey(key, `island-traders/v1/${hex}`);
  }

  /** version byte, compressed flag, 12-byte IV, ciphertext */
  async seal(value: unknown): Promise<Uint8Array> {
    let data: Uint8Array = enc.encode(JSON.stringify(value));
    const zip = typeof CompressionStream !== 'undefined';
    if (zip) data = await pipe(data, new CompressionStream('gzip'));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, data as BufferSource));
    const out = new Uint8Array(14 + ct.length);
    out[0] = 1;
    out[1] = zip ? 1 : 0;
    out.set(iv, 2);
    out.set(ct, 14);
    return out;
  }

  /** Returns null for anything not sealed with this room's key. */
  async open(bytes: Uint8Array): Promise<unknown> {
    if (bytes.length < 15 || bytes[0] !== 1) return null;
    try {
      let data: Uint8Array = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(2, 14) }, this.key, bytes.slice(14)));
      if (bytes[1] === 1) data = await pipe(data, new DecompressionStream('gzip'));
      return JSON.parse(dec.decode(data));
    } catch {
      return null;
    }
  }
}

/** Where a relayed guest can be reached: its broker and its own topic. */
export interface RelayAddress {
  broker: number;
  id: string;
}

interface Envelope {
  from: string;
  m: GuestMessage;
}

/**
 * The host listens on every broker at once, so a guest can use whichever one
 * its network reaches, and answers on the broker the guest wrote from.
 */
export class RelayHost {
  private clients: (MqttClient | null)[];
  private subscribed: boolean[];
  private backoff: number[];
  private timers: (ReturnType<typeof setTimeout> | null)[];
  private key: Promise<RoomKey>;
  private outbox: Promise<void> = Promise.resolve();
  private closed = false;
  private urls = relayUrls();
  onmessage: ((from: RelayAddress, msg: GuestMessage) => void) | null = null;
  onstatus: (() => void) | null = null;

  constructor(code: string) {
    this.key = RoomKey.derive(code);
    this.clients = this.urls.map(() => null);
    this.subscribed = this.urls.map(() => false);
    this.backoff = this.urls.map(() => 2000);
    this.timers = this.urls.map(() => null);
    this.urls.forEach((_, i) => this.connect(i));
  }

  /** Brokers this room is listening on right now. */
  get ready(): number {
    return this.subscribed.filter(Boolean).length;
  }

  private connect(i: number) {
    if (this.closed) return;
    this.timers[i] = null;
    const c = new MqttClient(this.urls[i], `ith${randomId(18)}`);
    this.clients[i] = c;
    let inbox: Promise<void> = Promise.resolve();
    c.onmessage = (_topic, payload) => {
      // keep messages in order while they are decrypted
      inbox = inbox.then(async () => {
        const env = (await (await this.key).open(payload)) as Envelope | null;
        if (!env || typeof env.from !== 'string' || !env.m || typeof env.m !== 'object') return;
        this.onmessage?.({ broker: i, id: env.from.slice(0, 40) }, env.m);
      });
    };
    c.onclose = () => {
      if (this.clients[i] !== c) return;
      this.clients[i] = null;
      this.subscribed[i] = false;
      this.onstatus?.();
      if (this.closed) return;
      this.timers[i] = setTimeout(() => this.connect(i), this.backoff[i]);
      this.backoff[i] = Math.min(this.backoff[i] * 2, 30000);
    };
    c.ready
      .then(async () => {
        await c.subscribe(`${(await this.key).base}/h`);
        if (this.clients[i] !== c) return;
        this.subscribed[i] = true;
        this.backoff[i] = 2000;
        this.onstatus?.();
      })
      .catch(() => {});
  }

  /** Reconnects dropped brokers now (e.g. when the page is back on screen). */
  wake(): void {
    this.urls.forEach((_, i) => {
      if (this.clients[i] || this.closed) return;
      if (this.timers[i]) clearTimeout(this.timers[i]!);
      this.connect(i);
    });
  }

  send(to: RelayAddress, msg: HostMessage): void {
    this.outbox = this.outbox
      .then(async () => {
        const key = await this.key;
        const data = await key.seal(msg);
        this.clients[to.broker]?.publish(`${key.base}/g/${to.id}`, data);
      })
      .catch(() => {});
  }

  close(): void {
    this.closed = true;
    for (const t of this.timers) if (t) clearTimeout(t);
    for (const c of this.clients) c?.close();
    this.clients = this.urls.map(() => null);
  }
}

/** A guest's link through one broker. */
export class RelayGuest {
  readonly id = randomId();
  private client: MqttClient | null = null;
  private key: Promise<RoomKey>;
  private outbox: Promise<void> = Promise.resolve();
  private closed = false;
  onmessage: ((msg: HostMessage) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    code: string,
    private first = 0,
  ) {
    this.key = RoomKey.derive(code);
  }

  get open(): boolean {
    return !this.closed && !!this.client?.connected;
  }

  /** Tries the brokers in turn (starting with `first`) until one takes us. */
  async connect(timeoutMs = 6000): Promise<void> {
    const key = await this.key;
    const urls = relayUrls();
    for (let n = 0; n < urls.length; n++) {
      if (this.closed) throw new Error('closed');
      const c = new MqttClient(urls[(this.first + n) % urls.length], `itg${this.id}`);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)));
      try {
        await Promise.race([c.ready.then(() => c.subscribe(`${key.base}/g/${this.id}`)), timeout]);
      } catch {
        c.close();
        continue;
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (this.closed) {
        c.close();
        throw new Error('closed');
      }
      this.client = c;
      let inbox: Promise<void> = Promise.resolve();
      c.onmessage = (_topic, payload) => {
        inbox = inbox.then(async () => {
          const msg = (await key.open(payload)) as HostMessage | null;
          if (msg && typeof msg === 'object' && !this.closed) this.onmessage?.(msg);
        });
      };
      c.onclose = () => {
        if (!this.closed) this.onclose?.();
      };
      return;
    }
    throw new Error('no broker reachable');
  }

  send(msg: GuestMessage): void {
    this.outbox = this.outbox
      .then(async () => {
        const key = await this.key;
        this.client?.publish(`${key.base}/h`, await key.seal({ from: this.id, m: msg } satisfies Envelope));
      })
      .catch(() => {});
  }

  close(): void {
    if (this.closed) return;
    if (this.client?.connected) {
      // say goodbye so the host frees the seat's link at once
      this.send({ t: 'bye' });
      const c = this.client;
      void this.outbox.then(() => c.close());
    }
    this.closed = true;
  }
}
