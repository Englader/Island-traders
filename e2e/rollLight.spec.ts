import { expect, test, type Page } from '@playwright/test';
import { HOST_SAVE_KEY } from './discardState.js';
import { ROLL_LIGHT, rollLightGame } from './rollLightState.js';
import { SAVE_KEY } from './tradeState.js';

// local room server and relay broker (see playwright.config.ts)
const BASE = '/?peer=127.0.0.1:9000/broker&mqtt=ws://127.0.0.1:9001';

/** The saved game's log. */
async function gameLog(page: Page, key: string): Promise<string[]> {
  return page.evaluate((k) => {
    const rec = JSON.parse(localStorage.getItem(k) ?? 'null') as { state: { log: Array<{ msg: string }> } } | null;
    return rec ? rec.state.log.map((e) => e.msg) : [];
  }, key);
}

/** Once the dice have landed: only the tile that paid glows, and the robber shakes over the one it blocked. */
async function expectLight(page: Page): Promise<void> {
  await expect(page.locator('.roll-overlay')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.hud .dice')).toHaveAttribute('aria-label', 'rolled 8');
  const glow = page.locator('svg.board .roll-glow-hex');
  await expect(glow).toHaveCount(1);
  await expect(glow).toHaveAttribute('data-hex', ROLL_LIGHT.pays);
  await expect(page.locator('svg.board .robber-blocked')).toHaveCount(1);
}

test('after a roll only the tiles that pay light up: not an 8 nobody builds on, the robber’s, or one the bank cannot pay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(rollLightGame())] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  // four 8s on the board
  await expect(page.locator('svg.board [data-tile][data-token="8"]')).toHaveCount(4);
  await page.getByRole('button', { name: /Roll/ }).first().click();
  // nothing glows while the dice tumble
  await expect(page.locator('.roll-overlay')).toBeVisible();
  await expect(page.locator('svg.board .roll-glow-hex')).toHaveCount(0);
  await expectLight(page);
  const log = await gameLog(page, SAVE_KEY);
  expect(log).toContain('Sam receives 1 lumber');
  expect(log).toContain('The bank is short of grain: it is not paid out');
  expect(errors).toEqual([]);
});

test('a friend in an online game sees the same tiles light up as the host', async ({ browser }) => {
  const room = 'RLGHT';
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await host.addInitScript(([key, value]) => localStorage.setItem(key, value), [HOST_SAVE_KEY, JSON.stringify(rollLightGame(room))] as const);
  await host.goto(BASE);
  await host.getByRole('button', { name: /Continue/ }).click();
  await expect(host.locator('.lobby-code .hint').first()).toContainText(/Room .* online/);
  await guest.goto(`${BASE}#join=${room}`);
  await expect(guest.locator('.code-input')).toHaveValue(room);
  await guest.getByLabel('Your name').fill('Friend');
  await guest.getByRole('button', { name: 'Join' }).click();
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('online');
  await host.getByRole('button', { name: /Start the game/ }).click();
  await expect(guest.locator('svg.board [data-tile][data-token="8"]')).toHaveCount(4);

  await host.getByRole('button', { name: /Roll/ }).first().click();
  await expectLight(host);
  await expectLight(guest);
  await hostCtx.close();
  await guestCtx.close();
});
