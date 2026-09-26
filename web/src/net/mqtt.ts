/**
 * A small MQTT 3.1.1 client over WebSocket: connect, subscribe and publish at
 * QoS 0, with keep-alive pings. That is all the relay needs (see relay.ts).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function mqttString(s: string): Uint8Array {
  const b = enc.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8;
  out[1] = b.length & 255;
  out.set(b, 2);
  return out;
}

/** Fixed header (type byte + variable-length size) followed by the parts. */
export function mqttPacket(type: number, ...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const head = [type];
  let x = len;
  do {
    let byte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) byte |= 128;
    head.push(byte);
  } while (x > 0);
  const out = new Uint8Array(head.length + len);
  out.set(head, 0);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Splits a byte stream into packets; returns the leftover bytes. */
export function mqttSplit(buf: Uint8Array, onPacket: (type: number, body: Uint8Array) => void): Uint8Array {
  let at = 0;
  for (;;) {
    if (buf.length - at < 2) break;
    let len = 0;
    let mul = 1;
    let i = at + 1;
    let complete = false;
    for (let n = 0; n < 4 && i < buf.length; n++, i++) {
      len += (buf[i] & 127) * mul;
      mul *= 128;
      if ((buf[i] & 128) === 0) {
        complete = true;
        i++;
        break;
      }
    }
    if (!complete || buf.length - i < len) break;
    onPacket(buf[at], buf.subarray(i, i + len));
    at = i + len;
  }
  return buf.slice(at);
}

export class MqttClient {
  private ws: WebSocket;
  private buf: Uint8Array = new Uint8Array(0);
  private nextId = 1;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private lastHeard = Date.now();
  private subs = new Map<number, () => void>();
  private connack: ((ok: boolean) => void) | null = null;
  private ended = false;
  readonly ready: Promise<void>;
  onmessage: ((topic: string, payload: Uint8Array) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string, clientId: string, private keepAlive = 30) {
    this.ws = new WebSocket(url, 'mqtt');
    this.ws.binaryType = 'arraybuffer';
    this.ready = new Promise<void>((resolve, reject) => {
      this.connack = (ok) => (ok ? resolve() : reject(new Error('the broker refused the connection')));
      this.ws.onerror = () => reject(new Error('could not reach the broker'));
      this.ws.onclose = () => {
        reject(new Error('the broker closed the connection'));
        this.end();
      };
    });
    this.ready.catch(() => {});
    this.ws.onopen = () => {
      // protocol "MQTT" level 4, clean session, keep-alive in seconds
      const head = new Uint8Array([0, 4, 77, 81, 84, 84, 4, 2, keepAlive >> 8, keepAlive & 255]);
      this.write(mqttPacket(0x10, head, mqttString(clientId)));
    };
    this.ws.onmessage = (e) => {
      const data = new Uint8Array(e.data as ArrayBuffer);
      const merged = new Uint8Array(this.buf.length + data.length);
      merged.set(this.buf, 0);
      merged.set(data, this.buf.length);
      this.buf = mqttSplit(merged, (type, body) => this.handle(type, body));
    };
  }

  get connected(): boolean {
    return !this.ended && this.ws.readyState === WebSocket.OPEN;
  }

  private write(p: Uint8Array) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(p);
  }

  private handle(type: number, body: Uint8Array) {
    this.lastHeard = Date.now();
    const kind = type >> 4;
    if (kind === 2) {
      // CONNACK
      const ok = body[1] === 0;
      this.connack?.(ok);
      this.connack = null;
      if (!ok) this.close();
      else
        this.pinger = setInterval(() => {
          if (Date.now() - this.lastHeard > this.keepAlive * 1500) this.close();
          else this.write(new Uint8Array([0xc0, 0]));
        }, (this.keepAlive * 1000) / 2);
    } else if (kind === 3) {
      // PUBLISH
      const qos = (type >> 1) & 3;
      const tlen = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tlen));
      let off = 2 + tlen;
      if (qos > 0) {
        this.write(new Uint8Array([0x40, 2, body[off], body[off + 1]]));
        off += 2;
      }
      this.onmessage?.(topic, body.slice(off));
    } else if (kind === 9) {
      // SUBACK
      const id = (body[0] << 8) | body[1];
      this.subs.get(id)?.();
      this.subs.delete(id);
    }
  }

  /** Resolves once the broker has confirmed the subscription. */
  subscribe(topic: string): Promise<void> {
    const id = this.nextId++ & 0xffff || 1;
    return new Promise<void>((resolve) => {
      this.subs.set(id, resolve);
      this.write(mqttPacket(0x82, new Uint8Array([id >> 8, id & 255]), mqttString(topic), new Uint8Array([0])));
    });
  }

  publish(topic: string, payload: Uint8Array): void {
    this.write(mqttPacket(0x30, mqttString(topic), payload));
  }

  private end() {
    if (this.ended) return;
    this.ended = true;
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
    this.onclose?.();
  }

  close(): void {
    if (this.ended) return;
    this.write(new Uint8Array([0xe0, 0]));
    try {
      this.ws.close();
    } catch {
      // already closed
    }
    this.end();
  }
}
