import { expect, test, type Locator, type Page } from '@playwright/test';
import { HOST_SAVE_KEY, sevenGame, sevenRoom } from './discardState.js';
import { SAVE_KEY } from './tradeState.js';

// local room server and relay broker (see playwright.config.ts)
const BASE = '/?peer=127.0.0.1:9000/broker&mqtt=ws://127.0.0.1:9001';

/** Each tile of the hand shown in the sheet: the count on the card, the change badge and "held → left". */
async function handTiles(sheet: Locator): Promise<Array<{ n: number; delta: string; was: string }>> {
  return sheet.locator('.your-cards .yc').evaluateAll((els) =>
    els.map((el) => ({
      n: Number(el.querySelector('.rtile-n')?.textContent),
      delta: el.querySelector('.yc-delta')?.textContent ?? '',
      was: (el.querySelector('.yc-was')?.textContent ?? '').trim(),
    })),
  );
}

/** The saved game's log. */
async function gameLog(page: Page, key = SAVE_KEY): Promise<string[]> {
  return page.evaluate((k) => {
    const rec = JSON.parse(localStorage.getItem(k) ?? 'null') as { state: { log: Array<{ msg: string }> } } | null;
    return rec ? rec.state.log.map((e) => e.msg) : [];
  }, key);
}

test('discarding on a 7: the hand stays in view, counts follow the picks, and the sheet folds away to peek at the board', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(sevenGame())] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: /Roll/ }).first().click();

  // 9 cards: 3 brick, 2 lumber, 1 wool, 3 grain, no ore
  const sheet = page.locator('.sheet[aria-label="Discard 4 cards"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.pick-lead')).toHaveText('Discard 4 of 9 — you keep 5');
  // the counts are there before any pick
  expect((await handTiles(sheet)).map((t) => t.n)).toEqual([3, 2, 1, 3, 0]);
  await expect(sheet.locator('.yc-delta')).toHaveCount(0);
  await expect(sheet.getByRole('img', { name: 'Brick: 3' })).toBeVisible();
  const confirm = sheet.locator('button.primary');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText('Discard 0/4');
  // no ore to discard
  await expect(sheet.getByRole('button', { name: 'Discard one more Ore' })).toBeDisabled();

  // the counts follow the picks, and the picked cards are marked
  await sheet.getByRole('button', { name: 'Discard one more Brick' }).click();
  await sheet.getByRole('button', { name: 'Discard one more Brick' }).click();
  await sheet.getByRole('button', { name: 'Discard one more Wool' }).click();
  expect(await handTiles(sheet)).toEqual([
    { n: 1, delta: '−2', was: '3 → 1' },
    { n: 2, delta: '', was: '' },
    { n: 0, delta: '−1', was: '1 → 0' },
    { n: 3, delta: '', was: '' },
    { n: 0, delta: '', was: '' },
  ]);
  await expect(sheet.locator('.yc.out')).toHaveCount(2);
  await expect(sheet.getByRole('img', { name: 'Brick: you hold 3, discard 2, keep 1' })).toBeVisible();
  await expect(sheet.locator('.tsum')).toHaveText('You discard 2 brick and 1 wool · 1 more to pick');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toHaveText('Discard 3/4');

  // peek: the sheet folds into a bar, the board and the hand below it are free
  await sheet.getByRole('button', { name: 'Peek at the board' }).click();
  await expect(page.locator('.sheet-backdrop')).toHaveCount(0);
  const bar = page.locator('.board-area .peek-bar');
  await expect(bar).toContainText('Discard 4 cards');
  await expect(bar).toContainText('3 of 4 picked');
  await expect(page.locator('.panel .hand .rtile-n').first()).toHaveText('3');
  // on the map, clear of the hand (once it has slid in)
  const panelTop = (await page.locator('.panel').boundingBox())!.y;
  await expect.poll(async () => ((b) => b.y + b.height)((await bar.boundingBox())!)).toBeLessThanOrEqual(panelTop);
  const box = (await bar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  // another sheet on top (the players) leaves the picks alone too
  await page.locator('.player').first().click();
  await page.locator('.sheet[aria-label="Players"]').getByRole('button', { name: 'Close' }).click();
  // back to the discard: the picks are kept
  await bar.getByRole('button', { name: 'Back to discard' }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Peek at the board' })).toBeFocused();
  expect((await handTiles(sheet)).map((t) => t.n)).toEqual([1, 2, 0, 3, 0]);
  await expect(confirm).toHaveText('Discard 3/4');

  // the fourth card: no box goes further, and the button is ready
  await sheet.getByRole('button', { name: 'Discard one more Grain' }).click();
  await expect(sheet.locator('.tsum')).toHaveText('You discard 2 brick, 1 wool and 1 grain');
  await expect(sheet.getByRole('button', { name: 'Discard one more Lumber' })).toBeDisabled();
  await expect(confirm).toBeEnabled();
  await expect(confirm).toHaveText('Discard 4 cards');
  // one back, one more: still exact
  await sheet.getByRole('button', { name: 'Discard one fewer Brick' }).click();
  await expect(confirm).toBeDisabled();
  await sheet.getByRole('button', { name: 'Discard one more Lumber' }).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // the discard is made: the hand shows what is left and the robber is next
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => gameLog(page)).toContain('Sam discards 1 brick, 1 lumber, 1 wool, 1 grain');
  await expect(page.locator('.panel .hand .rtile-n')).toHaveText(['2', '1', '0', '2', '0', '0']);
  await expect(page.locator('.status-text')).toContainText('Move the robber');
  expect(errors).toEqual([]);
});

test('a friend in an online game discards during the host’s turn, peeking at the board first', async ({ browser }) => {
  const room = 'DSCRD';
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await host.addInitScript(([key, value]) => localStorage.setItem(key, value), [HOST_SAVE_KEY, JSON.stringify(sevenRoom(room))] as const);
  await host.goto(BASE);
  await host.getByRole('button', { name: /Continue/ }).click();
  await expect(host.locator('.lobby-code .hint').first()).toContainText(/Room .* online/);
  await guest.goto(`${BASE}#join=${room}`);
  await expect(guest.locator('.code-input')).toHaveValue(room);
  await guest.getByLabel('Your name').fill('Friend');
  await guest.getByRole('button', { name: 'Join' }).click();
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('online');
  await host.getByRole('button', { name: /Start the game/ }).click();

  // the host rolls the 7; only the friend (10 cards) has to discard
  await host.getByRole('button', { name: /Roll/ }).first().click();
  await expect(host.locator('.status-text')).toHaveText(/Players are discarding/);
  const sheet = guest.locator('.sheet[aria-label="Discard 5 cards"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.pick-lead')).toHaveText('Discard 5 of 10 — you keep 5');
  expect((await handTiles(sheet)).map((t) => t.n)).toEqual([2, 3, 2, 1, 2]);
  await sheet.getByRole('button', { name: 'Discard one more Lumber' }).click();
  await sheet.getByRole('button', { name: 'Discard one more Lumber' }).click();
  await sheet.getByRole('button', { name: 'Peek at the board' }).click();
  await expect(guest.locator('.board-area .peek-bar')).toContainText('2 of 5 picked');
  await guest.getByRole('button', { name: 'Back to discard' }).click();
  expect((await handTiles(sheet)).map((t) => t.n)).toEqual([2, 1, 2, 1, 2]);
  for (const r of ['Brick', 'Wool', 'Ore']) await sheet.getByRole('button', { name: `Discard one more ${r}` }).click();
  await sheet.locator('button.primary').click();
  await expect(sheet).toHaveCount(0);
  await expect(guest.locator('.panel .hand .rtile-n')).toHaveText(['1', '1', '1', '1', '1', '0']);
  await expect(host.locator('.status-text')).toContainText('Move the robber');
  await expect.poll(() => gameLog(host, HOST_SAVE_KEY)).toContain('Friend discards 1 brick, 2 lumber, 1 wool, 1 ore');
  await hostCtx.close();
  await guestCtx.close();
});
