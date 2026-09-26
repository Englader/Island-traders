// Checks online play against the real outside services, from a machine with
// open internet (e.g. a GitHub Actions runner):
//   node scripts/online-check.mjs [site-url]
// - a host opens a room and a guest joins: the normal way, through the relay
//   only, and through each relay broker on its own
// - STUN/TURN servers and the WebSocket endpoints, for information
// Exits with an error when a friend can't join the normal way or through the relay.
import { chromium } from '@playwright/test';

const SITE = process.argv[2] ?? 'https://englader.github.io/Island-traders/';
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081'];

const ICE = [
  { name: 'google stun', urls: 'stun:stun.l.google.com:19302', policy: 'all', want: 'srflx' },
  { name: 'cloudflare stun', urls: 'stun:stun.cloudflare.com:3478', policy: 'all', want: 'srflx' },
  { name: 'peerjs turn eu', urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
  { name: 'peerjs turn us', urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjsp' },
];

const SOCKETS = [
  { name: 'peerjs room server', url: `wss://0.peerjs.com/peerjs?key=peerjs&id=it-probe-${Date.now()}&token=probe` },
  ...BROKERS.map((url) => ({ name: new URL(url).hostname, url, protocol: 'mqtt' })),
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});

/** A host opens a room and a guest joins it; returns true when the guest got a seat. */
async function joinFlow(label, query) {
  console.log(`== ${label}`);
  const url = `${SITE}${query ? `?${query}` : ''}`;
  const hostCtx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const guestCtx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  for (const [who, p] of [
    ['host', host],
    ['guest', guest],
  ]) {
    p.on('pageerror', (e) => console.log(`  [${who} pageerror] ${e}`));
  }
  let joined = false;
  try {
    await host.goto(url);
    await host.getByRole('button', { name: /Host online game/ }).click();
    await host.locator('.seat').nth(2).getByRole('button', { name: 'Computer' }).click();
    await host.getByRole('button', { name: /Open the room/ }).click();
    const code = ((await host.locator('.big-code').textContent()) ?? '').trim();
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < 30000) {
      const s = (await host.locator('.lobby-code .hint').first().textContent()) ?? '';
      if (s !== last) console.log(`  host  +${String(Date.now() - t0).padStart(5)} ms: ${s}`);
      last = s;
      if (/online/.test(s)) break;
      await host.waitForTimeout(250);
    }
    await guest.goto(`${url}#join=${code}`);
    await guest.getByLabel('Your name').fill('Probe');
    await guest.getByRole('button', { name: 'Join' }).click();
    const t1 = Date.now();
    last = '';
    while (Date.now() - t1 < 60000) {
      const s = ((await guest.locator('main').textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 120);
      if (s !== last) console.log(`  guest +${String(Date.now() - t1).padStart(5)} ms: ${s}`);
      last = s;
      if (/Waiting for/.test(s)) {
        joined = true;
        break;
      }
      await guest.waitForTimeout(250);
    }
  } catch (e) {
    console.log(`  error: ${e}`);
  }
  console.log(joined ? 'OK   the guest joined' : 'FAIL the guest did not join');
  await hostCtx.close();
  await guestCtx.close();
  return joined;
}

const normal = await joinFlow('Join (direct link, relay as fallback)', '');
const relayed = await joinFlow('Join through the relay only', 'link=relay');
for (const b of BROKERS) await joinFlow(`Join through ${new URL(b).hostname} only`, `link=relay&mqtt=${encodeURIComponent(b)}`);

const page = await browser.newPage();
await page.goto(SITE);

console.log('== ICE servers (for information)');
for (const s of ICE) {
  const r = await page.evaluate(async (s) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: s.urls, username: s.username, credential: s.credential }],
      iceTransportPolicy: s.policy ?? 'relay',
    });
    const types = new Set();
    const errors = new Set();
    pc.onicecandidate = (e) => e.candidate && types.add(e.candidate.type ?? '?');
    pc.onicecandidateerror = (e) => errors.add(`${e.errorCode} ${e.errorText}`.trim());
    pc.createDataChannel('probe');
    const t0 = performance.now();
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((res) => {
      const t = setTimeout(res, 8000);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(t);
          res();
        }
      };
    });
    const ms = Math.round(performance.now() - t0);
    pc.close();
    return { ok: types.has(s.want ?? 'relay'), ms, types: [...types].join(','), errors: [...errors].join('; ') };
  }, s);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${s.name.padEnd(20)} ${String(r.ms).padStart(6)} ms  candidates: ${r.types || 'none'}${r.errors ? `  errors: ${r.errors}` : ''}`);
}

console.log('== WebSockets (for information)');
for (const s of SOCKETS) {
  const r = await page.evaluate(
    (s) =>
      new Promise((res) => {
        const t0 = performance.now();
        const ws = s.protocol ? new WebSocket(s.url, s.protocol) : new WebSocket(s.url);
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

await browser.close();
if (!normal || !relayed) process.exit(1);
