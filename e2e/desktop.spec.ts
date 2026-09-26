import { expect, test, type Page } from '@playwright/test';
import { SAVE_KEY, tradeGame } from './tradeState.js';

// A computer screen: the game log docked in the bottom-left corner, the build
// tiles and big buttons on the side panel, and keyboard shortcuts.
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

/** Opens a saved game (see tradeState.ts) from the home screen. */
async function openGame(page: Page, record: unknown) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
}

const lines = (page: Page) => page.locator('.glog .glog-list > li').count();

test('the game log sits in the bottom-left corner, follows the game and never covers the action panel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // a small hand: nobody has to discard on a 7
  await openGame(page, tradeGame({ hand: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 } }).record);

  const log = page.locator('.glog');
  await expect(log).toBeVisible();
  const vp = page.viewportSize()!;
  const box = (await log.boundingBox())!;
  const board = (await page.locator('.board-area').boundingBox())!;
  const panel = (await page.locator('.panel').boundingBox())!;
  // bottom-left corner of the screen, over the board
  expect(box.x).toBeGreaterThanOrEqual(board.x);
  expect(box.x).toBeLessThan(board.x + 24);
  expect(box.y + box.height).toBeGreaterThan(vp.height - 24);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  // big: about a third of the screen high and 340-420px wide
  expect(box.width).toBeGreaterThanOrEqual(320);
  expect(box.width).toBeLessThanOrEqual(430);
  expect(box.height).toBeGreaterThanOrEqual(vp.height * 0.28);
  // the action panel (players, hand, buttons) is beside it, not under it
  expect(box.x + box.width).toBeLessThanOrEqual(panel.x);
  const deck = (await page.locator('.deck').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(deck.x);
  await expect(page.locator('.btile')).toHaveCount(4);

  // 1 picks the road tile, Esc cancels
  await page.keyboard.press('1');
  await expect(page.locator('.mode-hint')).toContainText('build a road');
  await expect(page.getByRole('button', { name: /^Road/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.mode-hint')).toHaveCount(0);

  // E ends the turn; the computer players' moves come in at the bottom of the log
  const before = await lines(page);
  await page.keyboard.press('e');
  await expect.poll(() => lines(page), { timeout: 30_000 }).toBeGreaterThan(before + 2);
  await expect(page.locator('.glog .glog-list > li').last()).toBeInViewport();
  const grown = (await log.boundingBox())!;
  expect(grown.x + grown.width).toBeLessThanOrEqual(panel.x);

  // back to us: R rolls the dice
  const roll = page.getByRole('button', { name: /Roll/ });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !(await roll.isVisible())) {
    const offer = page.locator('.sheet[aria-label="Trade offer"]');
    if (await offer.isVisible()) await offer.getByRole('button', { name: 'No thanks' }).first().click();
    else await page.waitForTimeout(200);
  }
  await expect(roll).toHaveAttribute('aria-keyshortcuts', 'R');
  await page.keyboard.press('r');
  await expect(roll).toHaveCount(0);
  await expect(page.locator('.glog .glog-list > li.is-roll').last()).toContainText('Sam rolls');

  // folding the log is remembered
  await page.getByRole('button', { name: 'Fold the game log' }).click();
  await expect(page.locator('.glog-body')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('.glog.folded')).toBeVisible();
  await page.getByRole('button', { name: 'Open the game log' }).click();
  await expect(page.locator('.glog-body')).toBeVisible();
  expect(errors).toEqual([]);
});
