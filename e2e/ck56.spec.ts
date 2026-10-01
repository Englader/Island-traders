import { expect, test, type Page } from '@playwright/test';

// Cities & Knights with 6 players (the C&K 5-6 extension): the base game's
// 5-6 board, six players at the table, and the special build phase, where
// knights and city improvements are on offer but trades are not.

/** Clicks the first clickable board target of a kind ('v', 'e' or 'h'). */
async function pickTarget(page: Page, kind: 'v' | 'e' | 'h'): Promise<boolean> {
  const targets = page.locator(`[data-pick^="${kind}:"]`);
  const n = await targets.count();
  for (let k = 0; k < n; k++) {
    const i = (Math.floor(n / 2) + k) % n;
    try {
      await targets.nth(i).click({ timeout: 1500 });
      return true;
    } catch {
      // covered by another element: try the next one
    }
  }
  return false;
}

/** Does the next sensible thing for Sam until a special build phase; returns what it did. */
async function step(page: Page): Promise<string> {
  const yes = page.locator('.confirm-dialog button.primary, .confirm-bar button.primary').first();
  if (await page.locator('.confirm-dialog').isVisible()) {
    await yes.click();
    return 'confirm';
  }
  const offer = page.locator('.sheet[aria-label="Trade offer"]');
  if (await offer.isVisible()) {
    await offer.getByRole('button', { name: 'No thanks' }).first().click();
    return 'decline';
  }
  const discard = page.locator('.sheet[aria-label^="Discard"]');
  if (await discard.isVisible()) {
    const need = Number(/Discard (\d+)/.exec((await discard.getAttribute('aria-label')) ?? '')?.[1] ?? 0);
    const more = discard.locator('button[aria-label^="Discard one more"]');
    let picked = 0;
    for (let i = 0; i < 8 && picked < need; i++) {
      while (picked < need && (await more.nth(i).isEnabled())) {
        await more.nth(i).click();
        picked++;
      }
    }
    await discard.locator('button.primary.wide').click();
    return 'discard';
  }
  const status = (await page.locator('.status-text').textContent()) ?? '';
  if (/Special build phase/.test(status)) return 'special';
  const pick: Array<[RegExp, 'v' | 'e' | 'h']> = [
    [/Place settlement|Place your city/, 'v'],
    [/Place a road/, 'e'],
  ];
  for (const [re, kind] of pick) {
    if (re.test(status) && (await pickTarget(page, kind))) {
      await yes.click({ timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
      return kind;
    }
  }
  const bar = page.locator('.action-bar');
  for (const name of [/Roll/, /End turn/]) {
    const button = bar.getByRole('button', { name });
    if (await button.isVisible()) {
      await button.click();
      return String(name);
    }
  }
  return '';
}

test('a 6-player Cities & Knights game: the 5-6 board, and knights and improvements in the special build phase', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  const sw = page.getByRole('switch', { name: 'Play with Cities & Knights' });
  await sw.click();
  await expect(sw).toBeChecked();
  // 3-6 players with the expansion now
  const players = page.locator('.stepper[aria-label="players"]');
  while (Number(await players.locator('.stepper-value').textContent()) < 6) await players.getByRole('button', { name: 'more' }).click();
  await expect(players.getByRole('button', { name: 'more' })).toBeDisabled();
  await expect(page.locator('.seat')).toHaveCount(6);

  // no C&K map for 5-6 is printed: the base game's 5-6 beginners' map, its robber asleep on one of two deserts
  await page.locator('.map-row').getByRole('button', { name: 'Official' }).click();
  const thumb = page.locator('.map-thumb svg.board');
  await expect(thumb.locator('[data-tile]:not([data-terrain="sea"])')).toHaveCount(30);
  await expect(thumb.locator('[data-tile][data-terrain="desert"]')).toHaveCount(2);
  await expect(page.locator('.map-thumb [data-asleep="true"]')).toHaveCount(1);
  await expect(page.locator('.map-note')).toHaveText('The 5–6 beginners’ map of the CATAN 5–6 rules: Cities & Knights prints none for 5–6.');

  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByText('Special build phase instead of paired players').click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(page.locator('.players .player')).toHaveCount(6);
  await expect(page.locator('.hud .sub')).toContainText('Cities & Knights');
  await expect(page.locator('.hud .sub')).toContainText('13 VP');
  await expect(page.locator('.ck-track')).toBeVisible();

  // the set-up and the first turns, until Sam may build after another player's turn
  const deadline = Date.now() + 150_000;
  let did = '';
  while (Date.now() < deadline && did !== 'special') {
    did = await step(page);
    if (!did) await page.waitForTimeout(200);
  }
  expect(did).toBe('special');
  // build, knights and improvements; no dice, no trading, no cards (C&K 5-6 rules, 2020)
  const bar = page.locator('.action-bar');
  for (const name of ['Build', 'Knights', 'Improve', 'End turn']) await expect(bar.getByRole('button', { name })).toBeVisible();
  for (const name of [/Roll/, /Trade/, /Cards/]) await expect(bar.getByRole('button', { name })).toHaveCount(0);
  // Sam's settlement and city are on the board with everyone else's
  expect(await page.locator('g.building').count()).toBeGreaterThanOrEqual(12);
  await bar.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('.status-text')).not.toHaveText(/Special build phase: build or pass/);
  expect(errors).toEqual([]);
});
