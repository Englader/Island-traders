import { expect, test, type Page } from '@playwright/test';
import { SAVE_KEY, tradeGame } from './tradeState.js';

// "Ask before building": a Yes/No dialog before a build, a purchase or a placement.
// The saved game (tradeState.ts): your turn after the roll, with 5 brick, 2 lumber,
// 1 wool, 3 grain and 4 ore, and two settlements on harbors.

/** Opens the saved game from the home screen. */
async function openGame(page: Page) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(tradeGame().record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
}

/** The game log as saved after every move. */
async function gameLog(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const rec = JSON.parse(localStorage.getItem(key) ?? 'null') as { state: { log: Array<{ msg: string }> } } | null;
    return rec ? rec.state.log.map((e) => e.msg) : [];
  }, SAVE_KEY);
}

/** Your hand: brick, lumber, wool, grain, ore and development cards. */
async function hand(page: Page): Promise<number[]> {
  return (await page.locator('.panel .hand .rtile-n').allTextContents()).map(Number);
}

/** Clicks the first highlighted board spot of a kind that can be clicked. */
async function pickSpot(page: Page, kind: 'v' | 'e'): Promise<void> {
  const spots = page.locator(`[data-pick^="${kind}:"]`);
  await expect(spots.first()).toBeAttached();
  const n = await spots.count();
  for (let i = 0; i < n; i++) {
    try {
      await spots.nth(i).click({ timeout: 1500 });
      return;
    } catch {
      // an upright path has no width to click: the next one
    }
  }
  throw new Error(`no ${kind} spot could be clicked`);
}

const START = [5, 2, 1, 3, 4, 0];
const devDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Buy a development card?' });
const roadDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Build a road here?' });

test.describe('on a computer', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('a development card: No keeps the hand, Yes buys; the keys answer the dialog and reach nothing behind it', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openGame(page);
    expect(await hand(page)).toEqual(START);

    // the Dev card tile asks first: the cost, and what the hand keeps
    await page.locator('.btile.dev').click();
    const dialog = devDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/You.ll have 0 wool, 2 grain and 3 ore left/);
    await expect(dialog).toContainText('development cards left in the deck');
    const yes = dialog.getByRole('button', { name: /^Yes, buy/ });
    const no = dialog.getByRole('button', { name: /^No/ });
    await expect(yes).toBeFocused();
    // the focus stays in the dialog
    await page.keyboard.press('Tab');
    await expect(no).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(yes).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(no).toBeFocused();
    await no.click();
    await expect(dialog).toHaveCount(0);
    expect(await hand(page)).toEqual(START);

    // the shortcut (4: the fourth tile) asks too; other shortcuts don't reach past the dialog
    await page.keyboard.press('4');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('e');
    await page.keyboard.press('t');
    await expect(dialog).toBeVisible();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /End turn/ })).toBeVisible();
    // Esc and N say no
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('4');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('n');
    await expect(dialog).toHaveCount(0);
    expect(await hand(page)).toEqual(START);
    expect((await gameLog(page)).some((m) => m.includes('buys a development card'))).toBe(false);

    // Enter says yes
    await page.keyboard.press('4');
    await expect(yes).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => hand(page)).toEqual([5, 2, 0, 2, 3, 1]);
    expect(await gameLog(page)).toContain('Sam buys a development card');
    expect(errors).toEqual([]);
  });

  test('a road: Esc goes back to picking a spot, Enter builds it', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('1');
    await expect(page.locator('.mode-hint')).toContainText('build a road');
    await pickSpot(page, 'e');
    const dialog = roadDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/You.ll have 4 brick and 1 lumber left/);
    // the road waits on the board behind the dialog
    await expect(page.locator('[data-ghost]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-ghost]')).toHaveCount(0);
    // still building: pick again
    await expect(page.locator('.mode-hint')).toContainText('build a road');
    await pickSpot(page, 'e');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => gameLog(page)).toContain('Sam builds a road');
    expect(await hand(page)).toEqual([4, 1, 1, 3, 4, 0]);
  });
});

test('on a phone: a road, No goes back to picking a spot and Yes builds; a card from the Build menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openGame(page);
  await page.getByRole('button', { name: /Build/ }).click();
  await page.locator('.build-item', { hasText: 'Road' }).click();
  await expect(page.locator('.mode-hint')).toContainText('Tap a highlighted spot to build a road');
  await pickSpot(page, 'e');
  const dialog = roadDialog(page);
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-ghost]')).toHaveCount(1);
  await dialog.getByRole('button', { name: /^No/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.mode-hint')).toContainText('build a road');
  expect(await hand(page)).toEqual(START);
  await pickSpot(page, 'e');
  await dialog.getByRole('button', { name: /^Yes, build/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => gameLog(page)).toContain('Sam builds a road');
  expect(await hand(page)).toEqual([4, 1, 1, 3, 4, 0]);

  // a development card from the Build menu: No goes back to the menu, Yes buys and closes it
  await page.getByRole('button', { name: /Build/ }).click();
  const sheet = page.locator('.sheet[aria-label="Build"]');
  await sheet.locator('.build-item', { hasText: 'Development card' }).click();
  await expect(devDialog(page)).toBeVisible();
  await devDialog(page).getByRole('button', { name: /^No/ }).click();
  await expect(devDialog(page)).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await sheet.locator('.build-item', { hasText: 'Development card' }).click();
  await devDialog(page).getByRole('button', { name: /^Yes, buy/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => hand(page)).toEqual([4, 1, 0, 2, 3, 1]);
  expect(errors).toEqual([]);
});

test('turned off in the menu, building works without asking, also after a reload', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  const ask = page.getByRole('switch', { name: 'Ask before building' });
  await expect(ask).toBeChecked();
  await ask.click();
  await expect(ask).not.toBeChecked();
  await page.getByRole('button', { name: 'Back to the game' }).click();

  // a card is bought at once
  await page.getByRole('button', { name: /Build/ }).click();
  await page.locator('.build-item', { hasText: 'Development card' }).click();
  await expect(page.locator('.sheet[aria-label="Build"]')).toHaveCount(0);
  await expect.poll(() => hand(page)).toEqual([5, 2, 0, 2, 3, 1]);
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);

  // still off after a reload (the saved game starts over from the same position)
  await page.reload();
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(ask).not.toBeChecked();
  await page.getByRole('button', { name: 'Back to the game' }).click();
  // a road: the spot is confirmed in the bar under the board, as before
  await page.getByRole('button', { name: /Build/ }).click();
  await page.locator('.build-item', { hasText: 'Road' }).click();
  await pickSpot(page, 'e');
  await expect(page.locator('.confirm-bar')).toContainText('Build a road here?');
  await expect(page.locator('.confirm-dialog')).toHaveCount(0);
  await page.locator('.confirm-bar button.primary').click();
  await expect.poll(() => gameLog(page)).toContain('Sam builds a road');
});
