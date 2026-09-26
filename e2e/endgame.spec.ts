import { expect, test, type Page } from '@playwright/test';
import { nearlyWonGame } from './endgameState.js';
import { SAVE_KEY } from './tradeState.js';

/** Opens a saved game from the home screen and rolls the winning roll. */
async function winGame(page: Page) {
  const game = nearlyWonGame();
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(game.record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await page.getByRole('button', { name: /Roll/ }).click();
  return game;
}

test('the end of the game: results, the final map, and the game stats', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const game = await winGame(page);
  const popup = page.locator('.sheet[aria-label="You win!"]');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.eg-ranking li')).toHaveCount(4);
  await expect(popup.locator('.eg-ranking li').first()).toContainText(game.name);
  // how long it took, from the game clock saved with the game
  await expect(popup.locator('.eg-hero-text span')).toHaveText(/ · \d+ turns · \d+ min$/);
  await expect(popup.getByRole('button', { name: 'Home' })).toBeVisible();

  // View map: the popup goes and the whole board can be seen and zoomed
  await popup.getByRole('button', { name: /View map/ }).click();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  await expect(page.locator('svg.board')).toBeVisible();
  const chip = page.getByRole('button', { name: /results/i });
  await expect(chip).toBeVisible();
  await expect(page.locator('.board-area .results-chip')).toHaveCount(1);
  // nothing covers the board: it zooms, and fits back
  const board = page.locator('svg.board');
  const fitted = await board.getAttribute('viewBox');
  // (a wheel turn: phones pinch, which the test browser can't do)
  await board.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true };
    for (let i = 0; i < 3; i++) el.dispatchEvent(new WheelEvent('wheel', { ...at, deltaY: -120 }));
  });
  await expect.poll(() => board.getAttribute('viewBox')).not.toBe(fitted);
  await page.getByRole('button', { name: 'Fit board' }).click();
  await expect.poll(() => board.getAttribute('viewBox')).toBe(fitted);

  // the chip brings the results back
  await chip.click();
  await expect(popup).toBeVisible();

  // Game stats: scores, charts and tables
  await popup.getByRole('button', { name: /Game stats/ }).click();
  const stats = page.locator('.sheet[aria-label="Game stats"]');
  await expect(stats).toBeVisible();
  await expect(stats.locator('.gs-scores tbody tr')).toHaveCount(4);
  await expect(stats.locator('.gs-scores tr.gs-win')).toContainText(game.name);
  await expect(stats.locator('section[aria-label="Highlights"] .gs-tile')).toHaveCount(6);
  await expect(stats.locator('.gs-empty')).toHaveCount(0);
  const race = stats.locator('section[aria-label="Race to the finish"]');
  await expect(race.locator('path.gs-line')).toHaveCount(4);
  await expect(race.locator('text.gs-end')).toHaveCount(4);
  // a tap on the chart reads out every player's points at that turn
  const plot = race.locator('.gs-plot > svg');
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  await plot.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(race.locator('.gs-tip-row')).toHaveCount(4);
  await expect(race.locator('.gs-tip-head')).toContainText(/After turn \d+/);
  // and the same numbers as a table
  await race.getByText('Show as a table').click();
  await expect(race.locator('details[open] tbody tr').first()).toContainText('setup');
  const produced = stats.locator('section[aria-label="Resources produced"]');
  await expect(produced.locator('svg path[fill]').first()).toBeVisible();
  await produced.getByText('Show as a table').click();
  await expect(produced.locator('details[open] tbody tr')).toHaveCount(4);
  await expect(stats.locator('.gs-ledger tbody tr').first()).toContainText('From the dice');
  // time: the whole game, each player's share, their pace, the longest turn
  const time = stats.locator('section[aria-label="Time"]');
  await expect(time.locator('.tm-hero .tm-value')).toHaveText(/^\d+ min \d+ s$/);
  await expect(time.locator('.gs-tile', { hasText: 'Longest turn' })).toContainText(/turn \d+/);
  // (the human took longer over each turn than the computer players)
  await expect(time.locator('.gs-tile', { hasText: 'Slowest player' })).toContainText(game.name);
  await expect(time.locator('.gs-tile', { hasText: 'Fastest player' })).toContainText('computer');
  const rows = time.locator('.tm-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'computer' })).toHaveCount(3);
  const shares = (await time.locator('.tm-tip').allInnerTexts()).map((t) => Number(/(\d+)%/.exec(t)![1]));
  expect(Math.abs(shares.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(2);
  await expect(time.locator('.tm-bar')).toHaveCount(4);
  // a tap on a player's bar tells their time and pace
  await rows.filter({ hasText: game.name }).click();
  await expect(time.locator('.tm-pop')).toContainText(/of the game/);
  await time.getByText('Show as a table').click();
  await expect(time.locator('details[open] tbody tr')).toHaveCount(4);
  // nothing is wider than the phone screen
  const overflow = await stats.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // the dice statistics are one tap away, and closing them comes back here
  await stats.getByRole('button', { name: /Dice statistics/ }).click();
  const dice = page.locator('.sheet[aria-label="Dice statistics"]');
  await expect(dice).toBeVisible();
  await dice.getByRole('button', { name: 'Close' }).click();
  await expect(stats).toBeVisible();
  await stats.getByRole('button', { name: 'Close' }).click();
  await expect(popup).toBeVisible();
  expect(errors).toEqual([]);
});

test('games saved before the stats existed say so instead', async ({ page }) => {
  const game = nearlyWonGame();
  delete (game.record.state as { stats?: unknown }).stats;
  delete game.record.clock;
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(game.record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Roll/ }).click();
  await page.locator('.sheet[aria-label="You win!"]').getByRole('button', { name: /Game stats/ }).click();
  const stats = page.locator('.sheet[aria-label="Game stats"]');
  await expect(stats.locator('.gs-scores tbody tr')).toHaveCount(4);
  await expect(stats.locator('.gs-empty', { hasText: /^Not recorded for this game/ })).toHaveCount(3);
  await expect(stats.locator('section[aria-label="Time"] .gs-empty')).toContainText("Time wasn't recorded for this game");
  // and no live timer for it either
  await expect(page.locator('.hud-clock')).toHaveCount(0);
});
