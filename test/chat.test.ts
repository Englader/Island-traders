import { describe, expect, it } from 'vitest';
import {
  CHAT_BURST,
  CHAT_HISTORY,
  CHAT_MAX_LENGTH,
  CHAT_WINDOW_MS,
  ChatHub,
  ChatRateLimiter,
  cleanChatText,
  mergeChat,
  type ChatGuest,
  type ChatMessage,
} from '../web/src/net/chat.js';

const ch = (...codes: number[]) => String.fromCharCode(...codes);

/** A clock the tests move by hand. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

const seats = ['Host', 'Ann', 'Bo'];
const seatName = (s: number) => seats[s];

describe('chat text', () => {
  it('keeps plain text, trimmed and on one line', () => {
    expect(cleanChatText('  Anyone have wood?  ')).toBe('Anyone have wood?');
    expect(cleanChatText(`two${ch(10)}lines${ch(13, 10)}and${ch(9)}a tab`)).toBe('two lines and a tab');
    expect(cleanChatText('many     spaces')).toBe('many spaces');
  });

  it('strips control characters and direction overrides', () => {
    expect(cleanChatText(`a${ch(0)}b${ch(7)}c${ch(0x1b)}[31md${ch(0x7f)}e${ch(0x85)}f`)).toBe('a b c [31md e f');
    // a right-to-left override could make "gnp.exe" read as "exe.png"
    expect(cleanChatText(`look ${ch(0x202e)}gnp.exe${ch(0x202c)} ok`)).toBe('look gnp.exe ok');
    expect(cleanChatText(`${ch(0x2066)}x${ch(0x2069)}`)).toBe('x');
  });

  it('leaves markup as text (it is rendered as text, never as HTML)', () => {
    expect(cleanChatText('<img src=x onerror=alert(1)> & <b>hi</b>')).toBe('<img src=x onerror=alert(1)> & <b>hi</b>');
  });

  it('drops empty messages and anything that is not a string', () => {
    for (const raw of ['', '   ', ch(0, 1, 2), undefined, null, 42, {}, ['hi'], { text: 'hi' }]) expect(cleanChatText(raw)).toBeNull();
  });

  it('cuts at 200 characters without splitting an emoji', () => {
    expect(cleanChatText('x'.repeat(500))).toBe('x'.repeat(CHAT_MAX_LENGTH));
    const smile = String.fromCodePoint(0x1f600);
    const out = cleanChatText('a'.repeat(CHAT_MAX_LENGTH - 1) + smile + smile)!;
    expect(Array.from(out)).toHaveLength(CHAT_MAX_LENGTH);
    expect(out.endsWith(smile)).toBe(true);
    // a thumbs-up with a skin tone stays whole
    const thumb = String.fromCodePoint(0x1f44d, 0x1f3fd);
    expect(cleanChatText(` ${thumb} `)).toBe(thumb);
  });
});

describe('chat rate limit', () => {
  it(`lets ${CHAT_BURST} messages through per ${CHAT_WINDOW_MS / 1000} s and then waits`, () => {
    const lim = new ChatRateLimiter();
    const t0 = 5000;
    for (let i = 0; i < CHAT_BURST; i++) expect(lim.allow('ann', t0 + i * 100)).toBe(true);
    expect(lim.allow('ann', t0 + 1000)).toBe(false);
    expect(lim.allow('ann', t0 + CHAT_WINDOW_MS - 1)).toBe(false);
    // the first message has left the window: one more may go
    expect(lim.allow('ann', t0 + CHAT_WINDOW_MS)).toBe(true);
    expect(lim.allow('ann', t0 + CHAT_WINDOW_MS + 1)).toBe(false);
  });

  it('counts each sender on its own', () => {
    const lim = new ChatRateLimiter(2, 1000);
    expect(lim.allow('ann', 0)).toBe(true);
    expect(lim.allow('ann', 1)).toBe(true);
    expect(lim.allow('ann', 2)).toBe(false);
    expect(lim.allow('bo', 3)).toBe(true);
  });
});

describe('chat on the host', () => {
  const ann: ChatGuest = { client: 'client-ann', seat: 1, name: 'Ann' };

  it('stamps the sender from its own records and ignores what the guest claims', () => {
    const hub = new ChatHub();
    const r = hub.fromGuest(ann, { t: 'chat', text: 'hi all', seat: 0, name: 'Host', from: 'Host' }, seatName);
    expect(r.ok).toBe(true);
    const m = hub.history()[0];
    expect(m).toMatchObject({ seat: 1, name: 'Ann', text: 'hi all' });
    expect(Object.keys(m).sort()).toEqual(['at', 'id', 'name', 'seat', 'text']);
  });

  it('uses the seat name the host knows, and marks someone watching', () => {
    const hub = new ChatHub();
    hub.fromGuest({ client: 'c1', seat: 2, name: 'Imposter' }, { text: 'a' }, seatName);
    hub.fromGuest({ client: 'c2', seat: null, name: 'Zed' }, { text: 'b' }, seatName);
    expect(hub.history().map((m) => [m.seat, m.name])).toEqual([
      [2, 'Bo'],
      [null, 'Zed (watching)'],
    ]);
  });

  it('drops messages from a link that has not said hello', () => {
    const hub = new ChatHub();
    expect(hub.fromGuest({ client: null, seat: null, name: 'Friend' }, { text: 'hello?' }, seatName)).toEqual({ ok: false, reason: 'unknown' });
    expect(hub.history()).toHaveLength(0);
  });

  it('drops empty and malformed messages', () => {
    const hub = new ChatHub();
    for (const msg of [{ text: '   ' }, { text: 42 }, { text: { html: '<b>' } }, null, 'text', {}])
      expect(hub.fromGuest(ann, msg, seatName)).toEqual({ ok: false, reason: 'empty' });
    expect(hub.history()).toHaveLength(0);
  });

  it('cleans the text and cuts it to 200 characters', () => {
    const hub = new ChatHub();
    hub.fromGuest(ann, { text: `${ch(0x202e)}hey${ch(10)}you ${'z'.repeat(400)}` }, seatName);
    const text = hub.history()[0].text;
    expect(text.startsWith('hey you zzz')).toBe(true);
    expect(text).toHaveLength(CHAT_MAX_LENGTH);
  });

  it('rate-limits each guest, and a guest that waits may write again', () => {
    const c = clock();
    const hub = new ChatHub([], c.now);
    const bo: ChatGuest = { client: 'client-bo', seat: 2, name: 'Bo' };
    for (let i = 0; i < CHAT_BURST; i++) {
      expect(hub.fromGuest(ann, { text: `m${i}` }, seatName).ok).toBe(true);
      c.tick(500);
    }
    expect(hub.fromGuest(ann, { text: 'spam' }, seatName)).toEqual({ ok: false, reason: 'limited' });
    // someone else is not held back
    expect(hub.fromGuest(bo, { text: 'me too' }, seatName).ok).toBe(true);
    c.tick(CHAT_WINDOW_MS);
    expect(hub.fromGuest(ann, { text: 'later' }, seatName).ok).toBe(true);
    expect(hub.history().map((m) => m.text)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'me too', 'later']);
  });

  it("does not rate-limit the host's own messages", () => {
    const hub = new ChatHub();
    for (let i = 0; i < CHAT_BURST * 3; i++) expect(hub.post({ seat: 0, name: 'Host' }, `h${i}`).ok).toBe(true);
  });

  it('gives a guest who joins or reconnects the history so far', () => {
    const c = clock();
    const hub = new ChatHub([], c.now);
    expect(hub.joinMessage()).toEqual({ t: 'chatHistory', msgs: [] });
    hub.post({ seat: 0, name: 'Host' }, 'welcome!');
    c.tick(1000);
    hub.fromGuest(ann, { text: 'Anyone have wood?' }, seatName);
    c.tick(1000);
    hub.post({ seat: 0, name: 'Host' }, 'No thanks');

    // Bo joins: he gets everything said before, oldest first, as the host stamped it
    const join = hub.joinMessage();
    expect(join.t).toBe('chatHistory');
    expect(join.msgs.map((m) => `${m.name}: ${m.text}`)).toEqual(['Host: welcome!', 'Ann: Anyone have wood?', 'Host: No thanks']);
    expect(join.msgs.map((m) => m.seat)).toEqual([0, 1, 0]);
    const ids = join.msgs.map((m) => m.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(3);

    // Ann's link drops and comes back: the same history, including what was said meanwhile
    hub.post({ seat: 0, name: 'Host' }, 'still there?');
    expect(hub.joinMessage().msgs.map((m) => m.text)).toEqual(['welcome!', 'Anyone have wood?', 'No thanks', 'still there?']);
    // a copy: changing what was sent doesn't change the host's history
    join.msgs.length = 0;
    expect(hub.history()).toHaveLength(4);
  });

  it(`keeps only the latest ${CHAT_HISTORY} messages`, () => {
    const c = clock();
    const hub = new ChatHub([], c.now);
    for (let i = 0; i < CHAT_HISTORY + 20; i++) {
      hub.post({ seat: 0, name: 'Host' }, `n${i}`);
      c.tick(10);
    }
    const msgs = hub.joinMessage().msgs;
    expect(msgs).toHaveLength(CHAT_HISTORY);
    expect(msgs[0].text).toBe('n20');
    expect(msgs[CHAT_HISTORY - 1].text).toBe(`n${CHAT_HISTORY + 19}`);
  });

  it('picks up a saved history after a host reload, with ids that keep growing', () => {
    const c = clock();
    const first = new ChatHub([], c.now);
    first.post({ seat: 0, name: 'Host' }, 'before the reload');
    const saved = JSON.parse(JSON.stringify(first.history())) as ChatMessage[];
    const again = new ChatHub([...saved, { junk: true } as unknown as ChatMessage], c.now);
    expect(again.history()).toEqual(saved);
    again.post({ seat: 0, name: 'Host' }, 'after');
    const [a, b] = again.history();
    expect(b.id).toBeGreaterThan(a.id);
    // even without the saved history, new ids come after the old ones
    c.tick(5);
    const fresh = new ChatHub([], c.now);
    expect(fresh.post({ seat: 0, name: 'Host' }, 'x').ok && fresh.history()[0].id).toBeGreaterThan(a.id);
  });
});

describe('chat on a guest', () => {
  const m = (id: number, text: string, seat: number | null = 1): ChatMessage => ({ id, seat, name: 'Ann', text, at: id });

  it('merges a history after a reconnect without duplicates, in order', () => {
    const list = [m(1, 'a'), m(2, 'b')];
    const merged = mergeChat(list, [m(2, 'b'), m(3, 'c'), m(1, 'a')]);
    expect(merged.map((x) => x.text)).toEqual(['a', 'b', 'c']);
    expect(mergeChat(merged, [m(3, 'c')])).toBe(merged);
  });

  it('leaves out anything malformed and cleans what a host sends', () => {
    const merged = mergeChat([], [m(1, `hi${ch(0)}there`), { id: 'x' }, null, m(2, '   '), { ...m(3, 'ok'), extra: '<script>' }]);
    expect(merged).toEqual([m(1, 'hi there'), m(3, 'ok')]);
    expect(mergeChat([], 'not a list')).toEqual([]);
  });
});
