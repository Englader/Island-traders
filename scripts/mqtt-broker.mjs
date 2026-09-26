// A tiny MQTT-over-WebSocket broker for the browser tests: QoS 0, exact
// topic matches, nothing stored. It stands in for the public brokers the
// relay uses (see web/src/net/relay.ts).
//   node scripts/mqtt-broker.mjs [port]
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const port = Number(process.argv[2] ?? 9001);
const subs = new Map(); // topic -> Set<ws>

function split(buf, onPacket) {
  let at = 0;
  for (;;) {
    if (buf.length - at < 2) break;
    let len = 0;
    let mul = 1;
    let i = at + 1;
    let done = false;
    for (let n = 0; n < 4 && i < buf.length; n++, i++) {
      len += (buf[i] & 127) * mul;
      mul *= 128;
      if ((buf[i] & 128) === 0) {
        done = true;
        i++;
        break;
      }
    }
    if (!done || buf.length - i < len) break;
    onPacket(buf[at], buf.subarray(i, i + len), buf.subarray(at, i + len));
    at = i + len;
  }
  return buf.subarray(at);
}

const http = createServer((_req, res) => res.end('mqtt test broker'));
const wss = new WebSocketServer({ server: http, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false) });

wss.on('connection', (ws) => {
  let buf = Buffer.alloc(0);
  const mine = new Set();
  ws.on('message', (data) => {
    buf = Buffer.concat([buf, data]);
    buf = Buffer.from(
      split(buf, (type, body, whole) => {
        const kind = type >> 4;
        if (kind === 1) ws.send(Buffer.from([0x20, 2, 0, 0]));
        else if (kind === 8) {
          const id = body.subarray(0, 2);
          const tlen = (body[2] << 8) | body[3];
          const topic = body.subarray(4, 4 + tlen).toString();
          if (!subs.has(topic)) subs.set(topic, new Set());
          subs.get(topic).add(ws);
          mine.add(topic);
          ws.send(Buffer.from([0x90, 3, id[0], id[1], 0]));
        } else if (kind === 3) {
          const tlen = (body[0] << 8) | body[1];
          const topic = body.subarray(2, 2 + tlen).toString();
          for (const other of subs.get(topic) ?? []) if (other.readyState === 1) other.send(Buffer.from(whole));
        } else if (kind === 12) ws.send(Buffer.from([0xd0, 0]));
        else if (kind === 14) ws.close();
      }),
    );
  });
  ws.on('close', () => {
    for (const t of mine) subs.get(t)?.delete(ws);
  });
});

http.listen(port, '127.0.0.1', () => console.log(`MQTT test broker on ws://127.0.0.1:${port}`));
