import { expect, test, type Page } from '@playwright/test';

/** Clicks the first clickable board target of a kind ('v', 'e' or 'h'). */
async function pickTarget(page: Page, kind: 'v' | 'e' | 'h'): Promise<boolean> {
  const targets = page.locator(`[data-pick^="${kind}:"]`);
  const n = await targets.count();
  for (let i = 0; i < n; i++) {
    try {
      await targets.nth(i).click({ timeout: 1500 });
      return true;
    } catch {
      // covered by another element: try the next one
    }
  }
  return false;
}

/** Confirms whatever is selected on the board (first choice if there are several). */
async function confirm(page: Page): Promise<void> {
  const bar = page.locator('.confirm-bar');
  await expect(bar).toBeVisible();
  await bar.locator('button.primary').first().click();
}

async function turnNumber(page: Page): Promise<number> {
  const text = (await page.locator('.hud .sub').textContent()) ?? '';
  return Number(/Turn (\d+)/.exec(text)?.[1] ?? 0);
}

/** Does the next sensible thing for the human seat; returns false when there is nothing to do. */
async function step(page: Page): Promise<string> {
  const status = (await page.locator('.status-text').textContent()) ?? '';
  if (await page.locator('.sheet[aria-label^="Discard"]').isVisible()) {
    const sheet = page.locator('.sheet[aria-label^="Discard"]');
    const need = Number(/Discard (\d+)/.exec((await sheet.getAttribute('aria-label')) ?? '')?.[1] ?? 0);
    const plus = sheet.locator('button[aria-label="more"]');
    let picked = 0;
    for (let i = 0; i < 5 && picked < need; i++) {
      while (picked < need && (await plus.nth(i).isEnabled())) {
        await plus.nth(i).click();
        picked++;
      }
    }
    await sheet.locator('button.primary').click();
    return 'discard';
  }
  if (await page.locator('.sheet[aria-label^="Choose"]').isVisible()) {
    const sheet = page.locator('.sheet[aria-label^="Choose"]');
    const need = Number(/Choose (\d+)/.exec((await sheet.getAttribute('aria-label')) ?? '')?.[1] ?? 0);
    for (let i = 0; i < need; i++) await sheet.locator('button[aria-label="more"]').first().click();
    await sheet.locator('button.primary').click();
    return 'gold';
  }
  if (await page.locator('.sheet[aria-label="Trade offer"]').isVisible()) {
    await page.locator('.sheet[aria-label="Trade offer"] button', { hasText: 'No thanks' }).first().click();
    return 'decline';
  }
  if (/Place settlement/.test(status)) {
    if (await pickTarget(page, 'v')) {
      await confirm(page);
      return 'settlement';
    }
  }
  if (/Place a road/.test(status)) {
    if (await pickTarget(page, 'e')) {
      await confirm(page);
      return 'road';
    }
  }
  if (/Move the robber/.test(status)) {
    if (await pickTarget(page, 'h')) {
      await confirm(page);
      return 'robber';
    }
  }
  const roll = page.getByRole('button', { name: /Roll/ });
  if (await roll.isVisible()) {
    await roll.click();
    return 'roll';
  }
  const end = page.getByRole('button', { name: /End turn/ });
  if (await end.isVisible()) {
    await end.click();
    return 'end';
  }
  return '';
}

test('start a game against the computer, play a few turns, resume after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Island Traders' })).toBeVisible();
  await page.getByRole('button', { name: /New game/ }).click();

  // 3 players, fast computer players
  await page.getByRole('button', { name: 'less' }).first().click();
  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();

  const deadline = Date.now() + 120_000;
  let rolls = 0;
  while (Date.now() < deadline && rolls < 3) {
    const did = await step(page);
    if (did === 'roll') rolls++;
    if (!did) await page.waitForTimeout(200);
  }
  expect(rolls).toBeGreaterThanOrEqual(3);
  const turn = await turnNumber(page);
  expect(turn).toBeGreaterThan(3);
  // our pieces are on the board
  expect(await page.locator('g.building').count()).toBeGreaterThanOrEqual(6);

  // the game is saved: reload and continue
  await page.reload();
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  expect(await turnNumber(page)).toBeGreaterThanOrEqual(turn);
  expect(errors).toEqual([]);
});

test('Seafarers scenario renders ships and the pirate', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Heading for New Shores/ }).click();
  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(page.locator('[fill="url(#tile-gold)"]').first()).toBeVisible();
  await expect(page.locator('.status-text')).toContainText(/Place|placing/);
});

test('pass-and-play hides hands behind a hand-over screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: 'less' }).first().click();
  // second seat becomes a human on this device
  await page.locator('.seat').nth(1).getByRole('button', { name: 'Human' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const pass = page.getByRole('heading', { name: 'Pass the device to' });
  await expect(pass).toBeVisible();
  await expect(page.locator('svg.board')).toHaveCount(0);
  const first = ((await page.locator('.pass-name').textContent()) ?? '').trim();
  await page.getByRole('button', { name: /show my cards/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(page.locator('.status-text')).toContainText('Place settlement 1');
  // place settlement + road, then the device must go to someone else before they see anything
  // (pickTarget skips targets Playwright can't click, e.g. an upright path has no width)
  expect(await pickTarget(page, 'v')).toBe(true);
  await page.locator('.confirm-bar button.primary').click();
  expect(await pickTarget(page, 'e')).toBe(true);
  await page.locator('.confirm-bar button.primary').click();
  await expect(pass).toBeVisible({ timeout: 20_000 });
  expect(((await page.locator('.pass-name').textContent()) ?? '').trim()).not.toBe(first);
});

test('a tap near a highlighted spot selects it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const spot = page.locator('.target-vertex').nth(4);
  await expect(spot).toBeVisible({ timeout: 20_000 });
  const b = (await spot.boundingBox())!;
  // a finger landing 16px beside the dot still picks it
  await page.touchscreen.tap(b.x + b.width / 2 + 16, b.y + b.height / 2 + 4);
  await expect(page.locator('.confirm-bar')).toBeVisible();
});

test.describe('phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  test('the board gets most of the screen and nothing scrolls sideways', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /New game/ }).click();
    await page.getByRole('button', { name: 'Start game' }).click();
    const board = (await page.locator('.board-area').boundingBox())!;
    const panel = (await page.locator('.panel').boundingBox())!;
    expect(board.width).toBeGreaterThan(470);
    expect(board.height).toBeGreaterThan(300);
    expect(panel.x).toBeGreaterThanOrEqual(board.x + board.width - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
  });
});

test('after one visit the game starts offline; online play says it needs a connection', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /New game/ })).toBeVisible();
  // wait until the service worker has stored the game
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 50; i++) {
      const keys = await (await caches.open('island-traders-v1')).keys();
      if (keys.some((r) => r.url.includes('/assets/') && r.url.endsWith('.js'))) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('the game was not stored for offline use');
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /Host online game/ })).toBeDisabled();
  await expect(page.locator('.home')).toContainText("You're offline");
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /^Start/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await context.setOffline(false);
});

test('a roll plays the dice animation, then the dice sit in the header; a tap skips it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: 'less' }).first().click();
  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();

  // play the setup until it is our turn to roll
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(await page.getByRole('button', { name: /Roll/ }).isVisible())) {
    if (!(await step(page))) await page.waitForTimeout(200);
  }
  await page.getByRole('button', { name: /Roll/ }).click();

  // the dice tumble in the middle of the screen, the header dice wait
  const overlay = page.locator('.roll-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('.hud .dice')).toBeHidden();
  const sum = Number(await page.locator('.roll-sum').textContent());
  expect((await overlay.getAttribute('aria-label')) ?? '').toMatch(new RegExp(`: ${sum}$`));
  expect(sum).toBeGreaterThanOrEqual(2);
  expect(sum).toBeLessThanOrEqual(12);
  // ...then fly into the header, showing the same roll
  await expect(overlay).toHaveCount(0, { timeout: 4000 });
  await expect(page.locator('.hud .dice')).toBeVisible();
  await expect(page.locator('.hud .dice')).toHaveAttribute('aria-label', `rolled ${sum}`);

  // a computer player's roll can be skipped with a tap (after a 7, move the robber first)
  const end = page.getByRole('button', { name: /End turn/ });
  while (Date.now() < deadline + 60_000 && !(await end.isVisible())) {
    if (!(await step(page))) await page.waitForTimeout(200);
  }
  await end.click();
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  await overlay.click();
  await expect(overlay).toHaveCount(0, { timeout: 500 });
  await expect(page.locator('.hud .dice')).toBeVisible();
});

test('the computer level is picked for a new game, remembered, and can be changed from the menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await expect(page.locator('.level-pick .seg button.on')).toHaveText('Medium');
  await page.getByRole('button', { name: 'Hard' }).click();
  await expect(page.locator('.level-pick .hint')).toContainText('robber on the leader');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  const sheet = page.locator('.sheet[aria-label="Menu"]');
  await expect(sheet.locator('.seg button.on', { hasText: 'Hard' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Easy' }).click();
  await expect(sheet.locator('.seg button.on', { hasText: 'Easy' })).toBeVisible();
  // the next new game starts from the level chosen last time
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await expect(page.locator('.level-pick .seg button.on')).toHaveText('Hard');
});

/** The board's tiles as "hex terrain token", sorted: what a board shows, to compare two boards. */
async function tiles(board: ReturnType<Page['locator']>): Promise<string[]> {
  const list = await board.locator('[data-tile]').evaluateAll((els) =>
    els.map((e) => `${e.getAttribute('data-tile')} ${e.getAttribute('data-terrain')} ${e.getAttribute('data-token')}`),
  );
  return list.sort();
}

test('the chosen map can be previewed before the game starts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Four Islands/ }).click();
  // the rulebook's map is the default: always the same, so there is nothing to reroll
  await expect(page.locator('.map-row .seg button.on')).toHaveText('Official');
  await expect(page.locator('.map-note')).toHaveText('Official map from the rulebook.');
  await expect(page.getByRole('button', { name: '🎲 New map' })).toHaveCount(0);
  const thumb = page.getByRole('button', { name: 'Show the The Four Islands map' });
  await expect(thumb).toBeVisible();
  await expect(thumb.locator('svg.board')).toBeVisible();
  await thumb.click();
  const sheet = page.locator('.sheet[aria-label="The Four Islands"]');
  await expect(sheet.locator('.map-big svg.board')).toBeVisible();
  await expect(sheet.locator('.hint')).toContainText('Official map from the rulebook');
  await sheet.getByRole('button', { name: 'Close' }).click();
  // the fog scenario keeps its unexplored tiles hidden and shuffled
  await page.getByRole('button', { name: /Fog Islands/ }).click();
  await expect(page.locator('.map-note')).toContainText('unexplored and shuffled');
  await expect(page.getByRole('button', { name: '🎲 New map' })).toHaveCount(0);
});

test('a random map: the preview is the board the game is played on, and 🎲 deals another', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.locator('.map-row').getByRole('button', { name: 'Random' }).click();
  await expect(page.locator('.map-note')).toHaveText('Random layout — tap 🎲 for another.');
  const preview = page.locator('.map-thumb svg.board');
  const first = await tiles(preview);
  expect(first).toHaveLength(19); // the land hexes of the base island
  await page.getByRole('button', { name: '🎲 New map' }).click();
  await expect.poll(async () => (await tiles(preview)).join()).not.toBe(first.join());
  const shown = await tiles(preview);
  await page.getByRole('button', { name: 'Start game' }).click();
  const board = page.locator('.board-area svg.board');
  await expect(board).toBeVisible();
  expect(await tiles(board)).toEqual(shown);
  // the choice is remembered for the next new game
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await expect(page.locator('.map-row .seg button.on')).toHaveText('Random');
});

test('dice statistics count every roll, for everyone and per player', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: 'less' }).first().click();
  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  const deadline = Date.now() + 120_000;
  let rolls = 0;
  while (Date.now() < deadline && rolls < 2) {
    const did = await step(page);
    if (did === 'roll') rolls++;
    if (!did) await page.waitForTimeout(200);
  }
  await page.locator('.roll-overlay').click({ timeout: 1000 }).catch(() => {});
  await page.getByRole('button', { name: 'Dice statistics' }).click();
  const sheet = page.locator('.sheet[aria-label="Dice statistics"]');
  const total = Number(await sheet.locator('.stat-tile .stat-value').first().textContent());
  expect(total).toBeGreaterThanOrEqual(2);
  // the bars add up to the number of rolls (the table shows each count)
  const cells = await sheet.locator('.dice-table tbody tr td:nth-child(2)').allTextContents();
  expect(cells.reduce((n, c) => n + Number(c.split(' ')[0]), 0)).toBe(total);
  // one player's rolls: fewer (or as many) as everyone's
  await sheet.locator('.dice-who .chip').nth(1).click();
  const mine = Number(await sheet.locator('.stat-tile .stat-value').first().textContent());
  expect(mine).toBeGreaterThanOrEqual(2);
  expect(mine).toBeLessThanOrEqual(total);
});
