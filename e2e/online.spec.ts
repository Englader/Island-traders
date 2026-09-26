import { expect, test, type Browser, type Page } from '@playwright/test';

// local room server and relay broker (see playwright.config.ts)
const BASE = '/?peer=127.0.0.1:9000/broker&mqtt=ws://127.0.0.1:9001';

/** Places a starting piece if this page is asked to. */
async function place(page: Page): Promise<boolean> {
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
      await page.locator('.confirm-bar button.primary').first().click({ timeout: 2000 });
      return true;
    } catch {
      // covered or already gone: try the next one
    }
  }
  return false;
}

/** The host opens a room for three: host, one friend, one computer. */
async function openRoom(host: Page): Promise<string> {
  await host.goto(BASE);
  await host.getByRole('button', { name: /Host online game/ }).click();
  await host.locator('.seat').nth(2).getByRole('button', { name: 'Computer' }).click();
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

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const a = await place(host);
    const b = await place(guest);
    if ((await host.getByRole('button', { name: /Roll/ }).isVisible()) || (await guest.getByRole('button', { name: /Roll/ }).isVisible())) break;
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

test('a friend joins with the room code and both play the setup', async ({ browser }) => {
  const { hostCtx, guestCtx, host, guest } = await pages(browser);
  const code = await openRoom(host);
  await join(guest, code, 'Guesty');
  await expect(guest.locator('main')).toContainText('Waiting for');
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('Guesty');
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('online');
  await playSetup(host, guest, 'Guesty');
  await expect(guest.locator('.hud')).not.toContainText('via relay');
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
        await a.locator('.confirm-bar button.primary').first().click();
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
