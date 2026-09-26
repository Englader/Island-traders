import { expect, test, type Page } from '@playwright/test';

const BASE = '/?peer=127.0.0.1:9000/broker';

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

test('a friend joins with the room code and both play the setup', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto(BASE);
  await host.getByRole('button', { name: /Host online game/ }).click();
  await host.locator('.seat').nth(2).getByRole('button', { name: 'Computer' }).click();
  await host.getByRole('button', { name: /Open the room/ }).click();
  const code = ((await host.locator('.big-code').textContent()) ?? '').trim();
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  await expect(host.locator('.lobby-code .hint')).toContainText(/Room .* online/);

  await guest.goto(`${BASE}#join=${code}`);
  await expect(guest.locator('.code-input')).toHaveValue(code);
  await guest.getByLabel('Your name').fill('Guesty');
  await guest.getByRole('button', { name: 'Join' }).click();
  await expect(guest.locator('main')).toContainText('Waiting for');
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('Guesty');
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('online');

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
  await expect(guest.locator('.player', { hasText: 'Guesty' })).toContainText('you');
  await hostCtx.close();
  await guestCtx.close();
});
