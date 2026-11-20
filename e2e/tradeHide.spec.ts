import { expect, test, type Locator, type Page } from '@playwright/test';
import type { TradeOffer } from '../src/index.js';
import { SAVE_KEY, tradeGame } from './tradeState.js';

/**
 * A trade offer to you can be hidden: it folds into a chip over the board
 * while you look at your hand, the players and the log, and opens again as
 * it was. Hiding answers nothing: the computer player waits for your answer.
 */

// Ada, on her turn, offers 1 ore for 1 brick and 1 wool; the log shows what she got and paid
const OFFER: TradeOffer = { id: 1, from: 1, to: [0], give: { ore: 1 }, get: { brick: 1, wool: 1 }, accepted: [], rejected: [] };
const LOG = ['Ada receives 2 wool, 1 grain', 'Björn receives 1 brick', 'Ada receives 1 lumber, 1 wool', 'Ada builds a road', 'Ada receives 1 lumber, 1 brick', 'Ada offers 1 ore for 1 brick, 1 wool'];

async function openGame(page: Page) {
  const { record } = tradeGame({ actor: 1, trades: [OFFER], log: LOG });
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify(record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
}

/** The game as saved after every move: the offers on the table and the log. */
async function saved(page: Page): Promise<{ trades: TradeOffer[]; log: string[] }> {
  return page.evaluate((key) => {
    const rec = JSON.parse(localStorage.getItem(key) ?? 'null') as { state: { turn: { trades: TradeOffer[] }; log: Array<{ msg: string }> } };
    return { trades: rec.state.turn.trades, log: rec.state.log.map((e) => e.msg) };
  }, SAVE_KEY);
}

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

async function expectClear(chip: Locator, others: Locator[]) {
  // (once it has risen into place)
  await chip.page().waitForTimeout(400);
  const c = (await chip.boundingBox())!;
  for (const o of others) {
    const b = (await o.count()) > 0 ? await o.boundingBox() : null;
    if (b) expect(overlap(c, b), `chip over ${o}`).toBe(false);
  }
}

/** Opens a sheet, sees it, and closes it again: the chip is back afterwards. */
async function peekAt(page: Page, open: Locator, title: string) {
  await open.click();
  const sheet = page.locator(`.sheet[aria-label="${title}"]`);
  await expect(sheet).toBeVisible();
  await expect(page.locator('.offer-chip')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.offer-chip')).toBeVisible();
}

async function hideLookAroundAndCounter(page: Page, desk: boolean) {
  await openGame(page);
  const offer = page.locator('.sheet[aria-label="Trade offer"]');
  await expect(offer).toBeVisible();

  // the offer shows your cards as they would be after it, and what Ada was seen to get
  await expect(offer.locator('.your-cards-label')).toHaveText('Your cards if you accept');
  await expect(offer.locator('.yc[data-res="ore"] .yc-was')).toHaveText('4 → 5');
  await expect(offer.locator('.yc[data-res="wool"] .yc-was')).toHaveText('1 → 0');
  const seen = offer.locator('.seen');
  await expect(seen.locator('.seen-head')).toContainText('Ada');
  await expect(seen.locator('.seen-head')).toContainText('9 cards');
  await expect(seen.locator('.seen-chip[data-res="wool"]')).toHaveText('3–5');
  await expect(seen.locator('.seen-chip[data-res="ore"]')).toHaveText('1–3');

  // hide it: a chip at the foot of the map, clear of the hand, the players and the board's tools
  await offer.getByRole('button', { name: 'Hide the offer' }).click();
  await expect(offer).toHaveCount(0);
  const chip = page.locator('.offer-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Ada's offer");
  await expect(chip.locator('.count')).toHaveCount(3);
  await expectClear(chip, [page.locator('.panel'), page.locator('.zoom-controls'), page.locator('.glog')]);
  expect((await chip.boundingBox())!.y + (await chip.boundingBox())!.height).toBeLessThanOrEqual((await page.locator('.board-area').boundingBox())!.y + (await page.locator('.board-area').boundingBox())!.height);

  // everything else can be looked at meanwhile: the players, the log, the dice, your cards
  await peekAt(page, page.locator('.player', { hasText: 'Ada' }), 'Players');
  if (!desk) await peekAt(page, page.getByRole('button', { name: 'Game log' }), 'Game log');
  await peekAt(page, page.getByRole('button', { name: 'Dice statistics' }), 'Dice statistics');
  if (!desk) await peekAt(page, page.getByRole('button', { name: 'Development cards' }), 'Development cards');

  // nobody answered for you: the offer is still open, and Ada still waits
  await page.waitForTimeout(2500);
  const mid = await saved(page);
  expect(mid.trades).toHaveLength(1);
  expect(mid.trades[0].rejected).toEqual([]);
  expect(mid.trades[0].accepted).toEqual([]);
  await expect(page.locator('.status-text')).toHaveText('You have a trade offer');

  // back to the offer, as it was
  await chip.click();
  await expect(offer).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Accept' })).toBeEnabled();
  await expect(offer.getByRole('button', { name: 'No thanks' })).toBeVisible();

  // counter: tapping grain in Ada's hand asks for one more grain
  await offer.getByRole('button', { name: 'Counter…' }).click();
  const counter = page.locator('.sheet[aria-label="Counter-offer to Ada"]');
  await expect(counter).toBeVisible();
  await counter.locator('.seen-chip[data-res="grain"]').click();
  await expect(counter.locator('.tbox[data-res="grain"]')).toHaveAttribute('data-value', '1');
  await expect(counter.locator('.your-cards-label')).toHaveText('Your cards after this trade');
  await expect(counter.locator('.yc[data-res="grain"] .yc-was')).toHaveText('3 → 4');

  // the counter-offer hides too, and keeps what was entered
  await counter.getByRole('button', { name: 'Hide your counter-offer' }).click();
  await expect(counter).toHaveCount(0);
  await expect(chip).toContainText('Your counter-offer to Ada');
  await peekAt(page, page.locator('.player', { hasText: 'Björn' }), 'Players');
  await chip.click();
  await expect(counter).toBeVisible();
  await expect(counter.locator('.tbox[data-res="grain"]')).toHaveAttribute('data-value', '1');
  await expect(counter.locator('.tbox[data-res="ore"]')).toHaveAttribute('data-value', '1');
  await counter.getByRole('button', { name: 'Send offer' }).click();
  await expect.poll(async () => (await saved(page)).log).toContain('Sam offers 1 brick, 1 wool for 1 grain, 1 ore');
}

test('a computer player offers a trade: hide it, look around, come back and counter (phone)', async ({ page }) => {
  await hideLookAroundAndCounter(page, false);
});

test.describe('on a computer', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  test('a computer player offers a trade: hide it, look around, come back and counter', async ({ page }) => {
    await hideLookAroundAndCounter(page, true);
  });

  test('Esc hides the offer; the chip opens it again from the keyboard', async ({ page }) => {
    await openGame(page);
    const offer = page.locator('.sheet[aria-label="Trade offer"]');
    await expect(offer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(offer).toHaveCount(0);
    const chip = page.locator('.offer-chip');
    await expect(chip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(offer).toBeVisible();
    // answering from the offer works as before
    await offer.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(async () => (await saved(page)).log).toContain('Ada trades 1 ore to Sam for 1 brick, 1 wool');
  });
});
