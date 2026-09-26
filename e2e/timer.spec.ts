import { expect, test, type Page } from '@playwright/test';
import { clockFor } from './endgameState.js';
import { SAVE_KEY, tradeGame } from './tradeState.js';

/** The game time in the header, in seconds (m:ss or h:mm:ss). */
async function gameTime(page: Page): Promise<number> {
  const text = (await page.locator('.hud-clock').innerText()).replace(/[^\d:]/g, '');
  return text.split(':').reduce((t, n) => t * 60 + Number(n), 0);
}

async function newGame(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();
}

/** Stands in for the phone switching apps (Playwright pages are always "visible"). */
async function setVisible(page: Page, visible: boolean) {
  await page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'visible' : 'hidden') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !v });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

async function timerSwitch(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  return page.getByRole('switch', { name: 'Show timer' });
}

test('a live timer in the header and by the player whose turn it is; the menu hides it for good', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newGame(page);
  const clock = page.locator('.hud-clock');
  await expect(clock).toBeVisible();
  await expect(clock).toHaveCSS('font-variant-numeric', 'tabular-nums');
  const start = await gameTime(page);
  await expect.poll(() => gameTime(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(start + 2);
  // the turn in play: one reading, by the player whose turn it is
  await expect(page.locator('.player .pturn')).toHaveCount(1);
  await expect(page.locator('.player.active .pturn')).toHaveText(/\d+:\d\d$/);

  // turned off in the menu: gone, and still gone after a reload
  const sw = await timerSwitch(page);
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(sw).not.toBeChecked();
  await page.getByRole('button', { name: 'Back to the game' }).click();
  await expect(clock).toHaveCount(0);
  await expect(page.locator('.pturn')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(clock).toHaveCount(0);
  const again = await timerSwitch(page);
  await expect(again).not.toBeChecked();
  // and back on: the time kept counting all along
  await again.click();
  await page.getByRole('button', { name: 'Back to the game' }).click();
  await expect(clock).toBeVisible();
  expect(await gameTime(page)).toBeGreaterThanOrEqual(start + 2);
  expect(errors).toEqual([]);
});

test('the clock pauses while the page is hidden or closed, and carries on from its time', async ({ page }) => {
  await newGame(page);
  await expect.poll(() => gameTime(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  // off screen: the clock stops, and the game is saved with the time so far
  await setVisible(page, false);
  await page.waitForTimeout(500);
  const paused = await gameTime(page);
  await page.waitForTimeout(3000);
  expect(await gameTime(page)).toBe(paused);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).clock, SAVE_KEY);
  expect(saved.runningSince).toBeUndefined();
  expect(Math.floor(saved.playedMs / 1000)).toBe(paused);

  // back on screen: it runs again
  await setVisible(page, true);
  await expect.poll(() => gameTime(page), { timeout: 5000 }).toBeGreaterThan(paused);

  // closed, then opened again a while later: the time away doesn't count
  const before = await gameTime(page);
  await page.reload();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  const after = await gameTime(page);
  expect(after).toBeGreaterThanOrEqual(before);
  expect(after).toBeLessThanOrEqual(before + 2);
  await expect.poll(() => gameTime(page), { timeout: 5000 }).toBeGreaterThan(after);
});

test("the turn time of a player at the far end of the players strip doesn't make the page scroll sideways", async ({ page }) => {
  // the last of three players (long names) is on turn, and the only human: nobody else moves
  const game = tradeGame({ actor: 2, hand: { brick: 1 } });
  const names = ['Samantha', 'Adalbert', 'Björn Borg'];
  const state = { ...game.record.state, players: game.record.state.players.map((p, i) => ({ ...p, name: names[i] })) };
  const record = {
    ...game.record,
    state,
    seats: game.record.seats.map((s, i) => ({ ...s, name: names[i], kind: i === 2 ? 'human' : 'bot' })),
    clock: clockFor(state, 2),
  };
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  const chip = page.locator('.player.active');
  await expect(chip).toContainText('Björn Borg');
  await expect(chip.locator('.pturn')).toHaveText(/\d+:\d\d$/);
  const width = page.viewportSize()!.width;
  // the reading is out of view in the strip, and stays there: not in the page
  expect((await chip.locator('.pturn').boundingBox())!.x).toBeGreaterThan(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
