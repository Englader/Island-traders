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
  for (let i = 0; i < n; i++) {
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
