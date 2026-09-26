import { expect, test, type Page } from '@playwright/test';
import type { TradeOffer } from '../src/index.js';
import { SAVE_KEY, tradeGame } from './tradeState.js';

/** Opens a saved game (see tradeState.ts) from the home screen. */
async function openGame(page: Page, record: unknown) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(record)] as const);
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

/** The counts on the "Your cards" strip, brick to ore. */
async function yourCards(page: Page): Promise<number[]> {
  return (await page.locator('.your-cards .rtile-n').allTextContents()).map(Number);
}

/** The element is on screen: the sheet has not been scrolled and nothing is cut off. */
async function expectOnScreen(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(await page.locator('.sheet-body').evaluate((el) => el.scrollTop)).toBe(0);
}

test('trade screen: offers with the arrows, asking for offers, and the bank', async ({ page }) => {
  const game = tradeGame();
  // brick trades at the generic harbor's 3:1 below
  expect(game.special).not.toBe('brick');
  await openGame(page, game.record);
  await page.getByRole('button', { name: /Trade/ }).first().click();
  const sheet = page.locator('.sheet[aria-label="Trade"]');
  const send = sheet.locator('.tsend button');
  expect(await yourCards(page)).toEqual([5, 2, 1, 3, 4]);

  // five boxes side by side, the send button on screen without scrolling
  const tops = await sheet.locator('.tbox').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(tops).toHaveLength(5);
  expect(new Set(tops).size).toBe(1);
  await expectOnScreen(page, '.sheet .tsend button');
  await expect(send).toBeDisabled();
  await expect(sheet.locator('.tsum')).toContainText('a card you want');

  // ▼ gives, ▲ gets: give 1 brick for 2 wool
  const brick = sheet.locator('.tbox[data-res="brick"]');
  await sheet.getByRole('button', { name: 'Give one more Brick' }).click();
  await expect(brick).toHaveAttribute('data-value', '-1');
  await expect(brick).toHaveAttribute('aria-label', 'Brick: you give 1');
  await expect(brick.locator('.tbox-n')).toHaveText('−1');
  // only 1 wool in hand: ▼ stops at −1
  await sheet.getByRole('button', { name: 'Give one more Wool' }).click();
  await expect(sheet.getByRole('button', { name: 'Give one more Wool' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Give one fewer Wool' }).click();
  await sheet.getByRole('button', { name: 'Get one more Wool' }).click();
  await sheet.getByRole('button', { name: 'Get one more Wool' }).click();
  await expect(sheet.locator('.tbox[data-res="wool"]')).toHaveAttribute('aria-label', 'Wool: you get 2');
  await expect(sheet.locator('.tsum')).toHaveText('You give 1 brick · You get 2 wool');
  await expect(send).toHaveText('Make offer');
  await expectOnScreen(page, '.sheet .tsend button');
  // nobody to offer it to: disabled, with the reason
  for (const name of ['Ada', 'Björn']) await sheet.getByRole('button', { name }).click();
  await expect(send).toBeDisabled();
  await expect(sheet.locator('.twhy')).toHaveText('Choose who to offer to');
  await sheet.getByRole('button', { name: 'Ada' }).click();
  await send.click();
  await expect(sheet.locator('.tbox[data-value="0"]')).toHaveCount(5);
  await expect(sheet.locator('.offers')).toContainText('Your offers');
  expect(await gameLog(page)).toContain('Sam offers 1 brick for 2 wool');

  // only one side: "Ask for offers" makes an open offer
  await sheet.getByRole('button', { name: 'Get one more Ore' }).click();
  await expect(sheet.locator('.tsum')).toHaveText('You get 1 ore');
  await expect(send).toHaveText('Ask for offers');
  await send.click();
  await expect.poll(() => gameLog(page)).toContain('Sam asks for 1 ore: what will you give?');
  await expect(sheet.locator('.offer.open')).toContainText('what will they give?');

  // the bank: ▼ gives a whole lot at the harbor rate, ▲ takes one card
  await sheet.getByRole('tab', { name: /Bank/ }).click();
  // a generic harbor (3:1) and a 2:1 harbor
  const rates = ['brick', 'lumber', 'wool', 'grain', 'ore'].map((r) => (r === game.special ? '2:1' : '3:1'));
  await expect(sheet.locator('.tnote')).toHaveText(rates);
  await sheet.getByRole('button', { name: 'Give 3 more Brick' }).click();
  await expect(sheet.locator('.tbox[data-res="brick"]')).toHaveAttribute('data-value', '-3');
  // 5 brick is one lot of 3: no second lot
  await expect(sheet.getByRole('button', { name: 'Give 3 more Brick' })).toBeDisabled();
  await expect(send).toBeDisabled();
  await expect(sheet.locator('.twhy')).toContainText('pick 1 more');
  await sheet.getByRole('button', { name: 'Get one more Ore' }).click();
  await expect(sheet.locator('.tsum')).toHaveText('You give 3 brick · You get 1 ore');
  await expectOnScreen(page, '.sheet .tsend button');
  await send.click();
  await expect.poll(() => yourCards(page)).toEqual([2, 2, 1, 3, 5]);
  expect(await gameLog(page)).toContain('Sam trades 3 brick with the bank for 1 ore');
});

test('answering an open offer: the side it names is locked', async ({ page }) => {
  // Ada, on her turn, asks who gives her 1 brick
  const offer: TradeOffer = { id: 1, from: 1, to: [0], give: {}, get: { brick: 1 }, accepted: [], rejected: [], open: 'give' };
  await openGame(page, tradeGame({ actor: 1, trades: [offer] }).record);
  await page.locator('.sheet[aria-label="Trade offer"]').getByRole('button', { name: /Make an offer/ }).click();
  const sheet = page.locator('.sheet[aria-label="Your offer to Ada"]');
  const brick = sheet.locator('.tbox[data-res="brick"]');
  await expect(brick).toHaveClass(/locked/);
  await expect(brick).toHaveAttribute('data-value', '-1');
  await expect(brick.getByRole('button')).toHaveCount(2);
  for (const b of await brick.getByRole('button').all()) await expect(b).toBeDisabled();
  // the brick is all she gets: the other boxes can only ask
  await expect(sheet.getByRole('button', { name: 'Give one more Ore' })).toBeDisabled();
  const send = sheet.getByRole('button', { name: 'Send offer' });
  await expect(send).toBeDisabled();
  await expect(sheet.locator('.twhy')).toHaveText('Pick what you want for it (▲)');
  await sheet.getByRole('button', { name: 'Get one more Grain' }).click();
  await expect(sheet.locator('.tsum')).toHaveText('You give 1 brick · You get 1 grain');
  await expectOnScreen(page, '.sheet .tsend button');
  await send.click();
  await expect.poll(() => gameLog(page)).toContain('Sam offers 1 brick for 1 grain');
});

test.describe('narrow phone', () => {
  test.use({ viewport: { width: 360, height: 640 } });
  test('the five boxes fit side by side and the send button is on screen', async ({ page }) => {
    await openGame(page, tradeGame().record);
    await page.getByRole('button', { name: /Trade/ }).first().click();
    for (const tab of ['Players', 'Bank & harbors']) {
      await page.getByRole('tab', { name: new RegExp(tab) }).click();
      const boxes = await page.locator('.sheet .tbox').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
      expect(boxes).toHaveLength(5);
      expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
      expect(Math.max(...boxes.map((b) => b.right))).toBeLessThanOrEqual(360);
      await expectOnScreen(page, '.sheet .tsend button');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
