// Checks the outside services online play depends on, from a machine with
// open internet (e.g. a GitHub Actions runner):
//   node scripts/online-check.mjs [site-url]
// - relay (TURN) and STUN servers: a relay-only data channel between two
//   connections in one page must carry a message
// - WebSocket endpoints (room server and possible fallbacks) must open
// - the site itself: a host opens a room and a guest joins it
import { chromium } from '@playwright/test';

const SITE = process.argv[2] ?? 'https://englader.github.io/Island-traders/';

const ICE = [
  { name: 'google stun', urls: 'stun:stun.l.google.com:19302', policy: 'all', want: 'srflx' },
  { name: 'cloudflare stun', urls: 'stun:stun.cloudflare.com:3478', policy: 'all', want: 'srflx' },
  { name: 'peerjs eu udp', urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { name: 'peerjs us udp', urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { name: 'peerjs eu tcp', urls: 'turn:eu-0.turn.peerjs.com:3478?transport=tcp', username: 'peerjs', credential: 'peerjsp' },
  { name: 'peerjs us tcp', urls: 'turn:us-0.turn.peerjs.com:3478?transport=tcp', username: 'peerjs', credential: 'peerjsp' },
  { name: 'openrelay 80', urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { name: 'openrelay 443 tcp', urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { name: 'openrelay turns', urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { name: 'freeturn udp', urls: 'turn:freeturn.net:3478', username: 'free', credential: 'free' },
  { name: 'freeturn tcp', urls: 'turn:freeturn.net:3478?transport=tcp', username: 'free', credential: 'free' },
  { name: 'freeturn turns', urls: 'turns:freeturn.tel:5349', username: 'free', credential: 'free' },
  { name: 'anyfirewall tcp', urls: 'turn:turn.anyfirewall.com:443?transport=tcp', username: 'webrtc', credential: 'webrtc' },
];

const SOCKETS = [
  { name: 'peerjs room server', url: `wss://0.peerjs.com/peerjs?key=peerjs&id=it-probe-${Date.now()}&token=probe` },
  { name: 'emqx mqtt', url: 'wss://broker.emqx.io:8084/mqtt', protocol: 'mqtt' },
  { name: 'hivemq mqtt', url: 'wss://broker.hivemq.com:8884/mqtt', protocol: 'mqtt' },
  { name: 'mosquitto mqtt', url: 'wss://test.mosquitto.org:8081/', protocol: 'mqtt' },
  { name: 'nostr damus', url: 'wss://relay.damus.io' },
  { name: 'nostr nos.lol', url: 'wss://nos.lol' },
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});

const page = await browser.newPage();
await page.goto(SITE);

console.log('== ICE servers');
for (const s of ICE) {
  const r = await page.evaluate(async (s) => {
    const cfg = { iceServers: [{ urls: s.urls, username: s.username, credential: s.credential }], iceTransportPolicy: s.policy ?? 'relay' };
    const a = new RTCPeerConnection(cfg);
    const b = new RTCPeerConnection(cfg);
    const types = new Set();
    const wire = (from, to) => {
      from.onicecandidate = (e) => {
        if (!e.candidate) return;
        types.add(e.candidate.type ?? '?');
        to.addIceCandidate(e.candidate).catch(() => {});
      };
    };
    wire(a, b);
    wire(b, a);
    const ch = a.createDataChannel('probe');
    const t0 = performance.now();
    const got = new Promise((res) => {
      b.ondatachannel = (e) => (e.channel.onmessage = (m) => res(m.data));
    });
    const opened = new Promise((res) => (ch.onopen = res));
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    const msg = await Promise.race([
      opened.then(() => {
        ch.send('ping');
        return got;
      }),
      new Promise((res) => setTimeout(() => res(null), 15000)),
    ]);
    const ms = Math.round(performance.now() - t0);
    a.close();
    b.close();
    return { ok: s.want ? types.has(s.want) : msg === 'ping', ms, types: [...types].join(',') };
  }, s);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${s.name.padEnd(20)} ${String(r.ms).padStart(6)} ms  candidates: ${r.types || 'none'}`);
}

console.log('== WebSockets');
for (const s of SOCKETS) {
  const r = await page.evaluate(
    (s) =>
      new Promise((res) => {
        const t0 = performance.now();
        let ws;
        try {
          ws = s.protocol ? new WebSocket(s.url, s.protocol) : new WebSocket(s.url);
        } catch (e) {
          res({ ok: false, why: String(e) });
          return;
        }
        const done = (ok, why) => {
          try {
            ws.close();
          } catch {}
          res({ ok, why, ms: Math.round(performance.now() - t0) });
        };
        ws.onopen = () => done(true, 'open');
        ws.onerror = () => done(false, 'error');
        setTimeout(() => done(false, 'timeout'), 10000);
      }),
    s,
  );
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${s.name.padEnd(20)} ${String(r.ms ?? '').padStart(6)} ms  ${r.why}`);
}

console.log('== Live site: host opens a room, a guest joins');
const hostCtx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const guestCtx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const host = await hostCtx.newPage();
const guest = await guestCtx.newPage();
for (const [who, p] of [
  ['host', host],
  ['guest', guest],
]) {
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [${who} ${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => console.log(`  [${who} pageerror] ${e}`));
}
try {
  await host.goto(SITE);
  await host.getByRole('button', { name: /Host online game/ }).click();
  await host.locator('.seat').nth(2).getByRole('button', { name: 'Computer' }).click();
  await host.getByRole('button', { name: /Open the room/ }).click();
  const code = ((await host.locator('.big-code').textContent()) ?? '').trim();
  console.log(`  room code ${code}`);
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 30000) {
    const s = (await host.locator('.lobby-code .hint').textContent()) ?? '';
    if (s !== last) console.log(`  host +${Date.now() - t0}ms: ${s}`);
    last = s;
    if (/online/.test(s)) break;
    await host.waitForTimeout(500);
  }
  await guest.goto(`${SITE}#join=${code}`);
  await guest.getByLabel('Your name').fill('Probe');
  await guest.getByRole('button', { name: 'Join' }).click();
  const t1 = Date.now();
  last = '';
  let joined = false;
  while (Date.now() - t1 < 60000) {
    const s = ((await guest.locator('main').textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 140);
    if (s !== last) console.log(`  guest +${Date.now() - t1}ms: ${s}`);
    last = s;
    if (/Waiting for/.test(s)) {
      joined = true;
      break;
    }
    await guest.waitForTimeout(500);
  }
  console.log(joined ? 'OK   guest joined the room' : 'FAIL guest did not join within 60 s');
  console.log(`  host seat 2: ${((await host.locator('.lobby-seat').nth(1).textContent()) ?? '').replace(/\s+/g, ' ')}`);
} catch (e) {
  console.log(`FAIL live flow: ${e}`);
}
await browser.close();
