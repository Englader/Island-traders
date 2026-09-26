import { expect, test, type Browser, type Page } from '@playwright/test';

// local room server and relay broker (see playwright.config.ts)
const BASE = '/?peer=127.0.0.1:9000/broker&mqtt=ws://127.0.0.1:9001';

/** The yes button: of the "Ask before building" dialog (pieces), or of the confirm bar (the robber). */
const yesButton = (page: Page) => page.locator('.confirm-dialog button.primary, .confirm-bar button.primary').first();

/** Places a starting piece if this page is asked to. */
async function place(page: Page): Promise<boolean> {
  // a dialog still up from an earlier try is answered first (it covers the board)
  if (await page.locator('.confirm-dialog').isVisible()) {
    await yesButton(page)
      .click({ timeout: 2000 })
      .catch(() => page.keyboard.press('Escape'));
    return true;
  }
  const status = (await page.locator('.status-text').textContent()) ?? '';
  const kind = /Place settlement/.test(status) ? 'v' : /Place a road/.test(status) ? 'e' : null;
  if (!kind) return false;
  const targets = page.locator(`[data-pick^="${kind}:"]`);
  const n = await targets.count();
  // start from the middle of the list: spots inland touch more tiles and bring in more cards
  for (let k = 0; k < n; k++) {
    const i = (Math.floor(n / 2) + k) % n;
    try {
      await targets.nth(i).click({ timeout: 800 });
    } catch {
      // covered or already gone: try the next one
      continue;
    }
    try {
      await yesButton(page).click({ timeout: 2000 });
      return true;
    } catch {
      // the game moved on meanwhile: close the dialog if it is still up, then try again
      if (await page.locator('.confirm-dialog').isVisible()) await page.keyboard.press('Escape');
    }
  }
  return false;
}

/** The board's tiles as "hex terrain token", sorted, to compare two boards. */
async function tiles(board: ReturnType<Page['locator']>): Promise<string[]> {
  const list = await board.locator('[data-tile]').evaluateAll((els) =>
    els.map((e) => `${e.getAttribute('data-tile')} ${e.getAttribute('data-terrain')} ${e.getAttribute('data-token')}`),
  );
  return list.sort();
}

/** The host opens a room for three: host, one friend, one computer. `setup` may change the new-game screen first. */
async function openRoom(host: Page, setup?: (host: Page) => Promise<void>): Promise<string> {
  await host.goto(BASE);
  await host.getByRole('button', { name: /Host online game/ }).click();
  await host.locator('.seat').nth(2).getByRole('button', { name: 'Computer' }).click();
  if (setup) await setup(host);
  await host.getByRole('button', { name: /Open the room/ }).click();
  const code = ((await host.locator('.big-code').textContent()) ?? '').trim();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  await expect(host.locator('.lobby-code .hint').first()).toContainText(/Room .* online/);
  return code;
}

async function join(guest: Page, code: string, name: string, extra = '') {
  await guest.goto(`${BASE}${extra}#join=${code}`);
  await expect(guest.locator('.code-input')).toHaveValue(code);
  await guest.getByLabel('Your name').fill(name);
  await guest.getByRole('button', { name: 'Join' }).click();
}

/** Both play the setup; the board must look the same on both devices. */
async function playSetup(host: Page, guest: Page, name: string) {
  await host.getByRole('button', { name: /Start/ }).click();
  await expect(host.locator('svg.board')).toBeVisible();
  await expect(guest.locator('svg.board')).toBeVisible();

  // The setup is over once turn 1 has begun. (Waiting for a Roll button instead
  // stalled when the computer player went first and made a trade offer.)
  const started = async () => /Turn [1-9]/.test((await host.locator('.hud .sub').textContent()) ?? '');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const a = await place(host);
    const b = await place(guest);
    if (await started()) break;
    if (!a && !b) await host.waitForTimeout(250);
  }
  // 3 players x 2 settlements, seen the same on both devices
  await expect(host.locator('g.building')).toHaveCount(6);
  await expect(guest.locator('g.building')).toHaveCount(6);
  // the guest sees their own hand but only card counts for others
  await expect(guest.locator('.player', { hasText: name })).toContainText('you');
}

async function pages(browser: Browser) {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  return { hostCtx, guestCtx, host: await hostCtx.newPage(), guest: await guestCtx.newPage() };
}

test('a friend joins with the room code and both play the setup on the random map the host picked', async ({ browser }) => {
  const { hostCtx, guestCtx, host, guest } = await pages(browser);
  let preview: string[] = [];
  const code = await openRoom(host, async (h) => {
    await h.locator('.map-row').getByRole('button', { name: 'Random' }).click();
    const thumb = h.locator('.map-thumb svg.board');
    const before = (await tiles(thumb)).join();
    await h.getByRole('button', { name: '🎲 New map' }).click();
    await expect.poll(async () => (await tiles(thumb)).join()).not.toBe(before);
    preview = await tiles(thumb);
  });
  await join(guest, code, 'Guesty');
  await expect(guest.locator('main')).toContainText('Waiting for');
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('Guesty');
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('online');
  await playSetup(host, guest, 'Guesty');
  await expect(guest.locator('.hud')).not.toContainText('via relay');
  // the game uses the host's previewed map, on both devices
  expect(await tiles(host.locator('.board-area svg.board'))).toEqual(preview);
  expect(await tiles(guest.locator('.board-area svg.board'))).toEqual(preview);
  await hostCtx.close();
  await guestCtx.close();
});

test('a friend whose network blocks direct links plays through the relay', async ({ browser }) => {
  const { hostCtx, guestCtx, host, guest } = await pages(browser);
  const code = await openRoom(host);
  await join(guest, code, 'Relay', '&link=relay');
  await expect(guest.locator('main')).toContainText('Waiting for');
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('online');
  await playSetup(host, guest, 'Relay');
  await expect(guest.locator('.hud')).toContainText('via relay');
  await hostCtx.close();
  await guestCtx.close();
});

test('a friend who tries while the host is away gets in once the host is back', async ({ browser }) => {
  const { hostCtx, guestCtx, host, guest } = await pages(browser);
  const code = await openRoom(host);
  // the host's phone drops the page (e.g. while sending the code in a chat app)
  await host.close();
  await join(guest, code, 'Patient');
  await expect(guest.locator('main')).toContainText(/Trying to reach the host again|isn't answering/, { timeout: 40_000 });
  // the host comes back and continues: the same room opens again
  const back = await hostCtx.newPage();
  await back.goto(BASE);
  await back.getByRole('button', { name: /Continue/ }).click();
  await expect(back.locator('.big-code')).toHaveText(code);
  await expect(guest.locator('main')).toContainText('Waiting for', { timeout: 40_000 });
  await expect(back.locator('.lobby-seat').nth(1)).toContainText('Patient');
  await expect(back.locator('.lobby-seat').nth(1)).toContainText('online');
  await hostCtx.close();
  await guestCtx.close();
});

test('open trade: the active player asks what a friend would give for a card; the friend answers and the deal is done', async ({ browser }) => {
  const { hostCtx, guestCtx, host, guest } = await pages(browser);
  const code = await openRoom(host);
  await join(guest, code, 'Trader');
  await expect(guest.locator('main')).toContainText('Waiting for');
  await playSetup(host, guest, 'Trader');

  // play until the host or the friend may trade a card the other can answer with a different
  // one (rolling, moving the robber after a 7, and passing turns until the hands allow it)
  let actor: Page | null = null;
  let other: Page | null = null;
  let offered = -1;
  const deadline = Date.now() + 90_000;
  while (!actor && Date.now() < deadline) {
    for (const [a, b] of [
      [host, guest],
      [guest, host],
    ] as const) {
      // the computer player may offer a trade on its turn: not now, thanks
      const botOffer = a.locator('.sheet[aria-label="Trade offer"]');
      if (await botOffer.isVisible()) await botOffer.getByRole('button', { name: 'No thanks' }).first().click();
      const roll = a.getByRole('button', { name: /Roll/ });
      if (await roll.isVisible()) {
        await roll.click();
        await a.locator('.roll-overlay').click({ timeout: 2000 }).catch(() => {});
      }
      if (/Move the robber/.test((await a.locator('.status-text').textContent()) ?? '')) {
        await a.locator('[data-pick^="h:"]').first().click();
        await yesButton(a).click();
      }
      if (await a.getByRole('button', { name: /Trade/ }).first().isVisible()) {
        // early hands are small (and can be empty after a second settlement by the desert or
        // the sea, or the robber): the friend must hold something other than the card offered
        const cards = async (p: Page) => (await p.locator('.hand .rtile:not(.dev) .rtile-n').allTextContents()).map(Number);
        const mine = await cards(a);
        const theirs = await cards(b);
        offered = mine.findIndex((n, r) => n > 0 && theirs.some((m, s) => s !== r && m > 0));
        if (offered >= 0) {
          actor = a;
          other = b;
          break;
        }
        await a.getByRole('button', { name: /End turn/ }).click();
      }
    }
    if (!actor) await host.waitForTimeout(250);
  }
  expect(actor).not.toBeNull();
  const a = actor!;
  const b = other!;
  const otherName = b === guest ? 'Trader' : 'Host';

  // "what will you give for my card?"
  await a.getByRole('button', { name: /Trade/ }).first().click();
  const before = (await a.locator('.your-cards .rtile-n').allTextContents()).map(Number);
  expect(before[offered]).toBeGreaterThan(0);
  const card = ['Brick', 'Lumber', 'Wool', 'Grain', 'Ore'][offered];
  await a.getByRole('button', { name: `Give one more ${card}` }).click();
  await a.getByRole('button', { name: 'Ask for offers' }).click();
  await expect(a.locator('.offer.open')).toContainText('what will they give for it?');

  // the friend sees the open offer and answers with a card of their own
  const sheet = b.locator('.sheet[aria-label="Trade offer"]');
  await expect(sheet).toContainText('What will you give for it?');
  await sheet.getByRole('button', { name: /Make an offer/ }).click();
  // the card offered is locked in; the friend gives one of theirs for it (▼)
  await expect(b.locator('.tbox.locked')).toHaveAttribute('data-value', '1');
  await b.locator('.tbox:not(.locked) .tbox-btn.down:not([disabled])').first().click();
  await b.getByRole('button', { name: 'Send offer' }).click();

  // the answer shows up under the open offer; accepting it makes the trade and closes the offer
  const answer = a.locator('.answer', { hasText: otherName });
  await expect(answer).toBeVisible();
  await answer.getByRole('button', { name: 'Accept' }).click();
  await expect(a.locator('.offer.open')).toHaveCount(0);
  const after = (await a.locator('.your-cards .rtile-n').allTextContents()).map(Number);
  expect(after[offered]).toBe(before[offered] - 1);
  expect(after.reduce((x, y) => x + y, 0)).toBe(before.reduce((x, y) => x + y, 0));
  await hostCtx.close();
  await guestCtx.close();
});

// --- chat ------------------------------------------------------------------------------------------

const chatButton = (p: Page) => p.getByRole('button', { name: /^Chat/ });
const chatWindow = (p: Page) => p.getByRole('dialog', { name: 'Chat' });

/** The host starts the game once the friend is seated; both see the board. */
async function startWithFriend(host: Page, guest: Page) {
  await expect(guest.locator('main')).toContainText('Waiting for');
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('online');
  await host.getByRole('button', { name: /Start/ }).click();
  await expect(host.locator('svg.board')).toBeVisible();
  await expect(guest.locator('svg.board')).toBeVisible();
}

async function openChat(p: Page) {
  const win = chatWindow(p);
  if (!(await win.isVisible())) await chatButton(p).click();
  await expect(win).toBeVisible();
  return win;
}

/** Types a message and sends it with Enter; it shows as ours once the host has passed it on. */
async function say(p: Page, text: string) {
  const win = await openChat(p);
  const box = win.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
  await expect(box).toHaveValue('');
  await expect(win.locator('.chat-msg.mine .chat-text').last()).toHaveText(text);
}

/** The friend reloads the page and joins again with the name the page remembers. */
async function rejoin(guest: Page, code: string) {
  await guest.reload();
  await expect(guest.locator('.code-input')).toHaveValue(code);
  await guest.getByRole('button', { name: 'Join' }).click();
  await expect(guest.locator('svg.board')).toBeVisible();
}

test('friends chat during an online game: unread badge, replies, quick phrases, history after a reload', async ({ browser }) => {
  const { hostCtx, guestCtx, host, guest } = await pages(browser);
  const code = await openRoom(host);
  await join(guest, code, 'Chatty');
  await startWithFriend(host, guest);

  // the friend writes (markup stays plain text)
  const hello = 'Hi! <b>Anyone</b> have wood?';
  // the host gets a preview by the button for a few seconds: watch for it while the message goes out
  await Promise.all([say(guest, hello), expect(host.locator('.chat-peek')).toContainText(hello)]);

  // and a badge until the chat is opened
  await expect(chatButton(host)).toHaveAccessibleName('Chat, 1 unread message');
  await expect(host.locator('.chat-badge')).toHaveText('1');
  const hostWin = await openChat(host);
  await expect(host.locator('.chat-badge')).toHaveCount(0);
  const theirs = hostWin.locator('.chat-msg:not(.mine)').last();
  await expect(theirs).toContainText('Chatty');
  await expect(theirs.locator('.chat-text')).toHaveText(hello);
  await expect(hostWin.locator('.chat-text b')).toHaveCount(0);

  // the host answers with the send button; the friend sees it with the host's name
  await hostWin.getByRole('textbox', { name: 'Message' }).fill('Sorry, no wood here');
  await hostWin.getByRole('button', { name: 'Send' }).click();
  await expect(hostWin.locator('.chat-msg.mine .chat-text').last()).toHaveText('Sorry, no wood here');
  const guestWin = chatWindow(guest);
  await expect(guestWin.locator('.chat-msg:not(.mine)').last()).toContainText('Host');
  await expect(guestWin.locator('.chat-text').last()).toHaveText('Sorry, no wood here');

  // quick phrases
  await guestWin.getByRole('button', { name: 'Deal!' }).click();
  await guestWin.getByRole('button', { name: '👍' }).click();
  const all = [hello, 'Sorry, no wood here', 'Deal!', '👍'];
  await expect(hostWin.locator('.chat-text')).toHaveText(all);
  await expect(guestWin.locator('.chat-text')).toHaveText(all);

  // Escape closes the window
  await guestWin.getByRole('textbox', { name: 'Message' }).press('Escape');
  await expect(guestWin).toHaveCount(0);

  // after a reload the friend gets the chat so far back, already read
  await rejoin(guest, code);
  await expect(chatButton(guest)).toHaveAccessibleName('Chat');
  const again = await openChat(guest);
  await expect(again.locator('.chat-text')).toHaveText(all);
  await say(host, 'Welcome back');
  await expect(again.locator('.chat-text').last()).toHaveText('Welcome back');
  await hostCtx.close();
  await guestCtx.close();
});

test('chat goes through the relay too, and comes back after a reload', async ({ browser }) => {
  const { hostCtx, guestCtx, host, guest } = await pages(browser);
  const code = await openRoom(host);
  await join(guest, code, 'Relayer', '&link=relay');
  await startWithFriend(host, guest);
  await expect(guest.locator('.hud')).toContainText('via relay');

  await say(guest, 'Over the relay');
  await expect(host.locator('.chat-badge')).toHaveText('1');
  const hostWin = await openChat(host);
  await expect(hostWin.locator('.chat-text').last()).toHaveText('Over the relay');
  await say(host, 'Loud and clear');
  const guestWin = chatWindow(guest);
  await expect(guestWin.locator('.chat-text').last()).toHaveText('Loud and clear');
  await guestWin.getByRole('button', { name: 'Good game' }).click();
  await expect(hostWin.locator('.chat-text').last()).toHaveText('Good game');

  await rejoin(guest, code);
  await expect(guest.locator('.hud')).toContainText('via relay');
  const again = await openChat(guest);
  await expect(again.locator('.chat-text')).toHaveText(['Over the relay', 'Loud and clear', 'Good game']);
  await hostCtx.close();
  await guestCtx.close();
});

test('games on this device have no chat', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(page.locator('.chat-fab')).toHaveCount(0);
});

// --- the game clock ----------------------------------------------------------------------------

/** The game time in the header, in seconds. */
async function gameTime(p: Page): Promise<number> {
  const text = (await p.locator('.hud-clock').innerText()).replace(/[^\d:]/g, '');
  return text.split(':').reduce((t, n) => t * 60 + Number(n), 0);
}

test('the host keeps the game time and a friend sees the same clock', async ({ browser }) => {
  const { hostCtx, guestCtx, host, guest } = await pages(browser);
  const code = await openRoom(host);
  await join(guest, code, 'Clocky');
  await startWithFriend(host, guest);
  await expect(host.locator('.hud-clock')).toBeVisible();
  await expect(guest.locator('.hud-clock')).toBeVisible();
  await expect.poll(() => gameTime(host), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  // read side by side (a second may tick between the two readings)
  await expect(async () => {
    const [h, g] = await Promise.all([gameTime(host), gameTime(guest)]);
    expect(Math.abs(h - g)).toBeLessThanOrEqual(2);
  }).toPass({ timeout: 10_000 });
  // the friend's reading runs on between the host's updates
  const g = await gameTime(guest);
  await expect.poll(() => gameTime(guest), { timeout: 5000 }).toBeGreaterThan(g);
  // and the turn in play shows by the player whose turn it is, on both
  await expect(host.locator('.player .pturn')).toHaveCount(1);
  await expect(guest.locator('.player .pturn')).toHaveCount(1);
  await hostCtx.close();
  await guestCtx.close();
});

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
const within = (a: Box, b: Box) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;

/** Boxes of what is on screen for these selectors. */
async function boxes(p: Page, selectors: string[]): Promise<Array<{ sel: string; box: Box }>> {
  const out: Array<{ sel: string; box: Box }> = [];
  for (const sel of selectors)
    for (const el of await p.locator(sel).all()) {
      const box = (await el.isVisible()) ? await el.boundingBox() : null;
      if (box) out.push({ sel, box });
    }
  return out;
}

test('the chat keeps clear of the board tools, the log and the panels, on a computer and on a phone', async ({ browser }) => {
  const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  // the host doesn't ask before building (the menu setting): a picked spot shows the confirm bar
  await hostCtx.addInitScript(() => localStorage.setItem('island-traders:v1:ui:askBuild', 'false'));
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const code = await openRoom(host);
  await join(guest, code, 'Layout');
  await startWithFriend(host, guest);
  // the host picks a spot for its first settlement: a confirm bar at the bottom of the board too
  // (a roll decides who starts: the friend may place first, the computer places by itself)
  await expect(async () => {
    await place(guest);
    await expect(host.locator('.status-text')).toContainText('Place settlement', { timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await expect(async () => {
    const spots = host.locator('[data-pick^="v:"]');
    const n = await spots.count();
    // from the middle of the board: a spot no panel covers
    for (let k = 0; k < n && !(await host.locator('.confirm-bar').isVisible()); k++)
      await spots
        .nth((Math.floor(n / 2) + k) % n)
        .click({ timeout: 800 })
        .catch(() => {});
    await expect(host.locator('.confirm-bar')).toBeVisible({ timeout: 1000 });
  }).toPass();

  for (const p of [host, guest]) {
    const board = (await p.locator('.board-area').boundingBox())!;
    const fab = (await chatButton(p).boundingBox())!;
    // the bottom-right corner of the board
    expect(within(fab, board)).toBe(true);
    expect(board.x + board.width - (fab.x + fab.width)).toBeLessThan(24);
    expect(board.y + board.height - (fab.y + fab.height)).toBeLessThan(24);
    for (const { sel, box } of await boxes(p, ['.hud', '.panel', '.zoom-controls', '.glog', '.feed', '.confirm-bar', '.mode-hint']))
      expect(overlap(fab, box), `chat button over ${sel}`).toBe(false);

    // the window opens over the board, never over the panels or the board tools
    const win = await openChat(p);
    // measured once the opening animation is over
    await win.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const w = (await win.boundingBox())!;
    expect(within(w, board)).toBe(true);
    for (const { sel, box } of await boxes(p, ['.hud', '.panel', '.zoom-controls', '.glog']))
      expect(overlap(w, box), `chat window over ${sel}`).toBe(false);
    if (p === host) {
      // a computer: a compact window above the button
      expect(w.width).toBeGreaterThanOrEqual(300);
      expect(w.width).toBeLessThanOrEqual(340);
      expect(w.height).toBeGreaterThanOrEqual(340);
      expect(w.height).toBeLessThanOrEqual(400);
      expect(w.y + w.height).toBeLessThanOrEqual(fab.y);
    } else {
      // a phone: along the bottom of the board, the top of the board still in view
      expect(w.y - board.y).toBeGreaterThan(board.height * 0.3);
    }
    await win.getByRole('button', { name: 'Close chat' }).click();
    await expect(win).toHaveCount(0);
    await expect(chatButton(p)).toBeFocused();
  }
  await hostCtx.close();
  await guestCtx.close();
});
