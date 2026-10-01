import { expect, test, type Page } from '@playwright/test';

// 5-6 players on the Seafarers 5-6 maps: the rulebook's map for six, the
// computer players at the table, and the paired players' turns.

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

/** Confirms what is selected on the board: the "Ask before building" dialog, or the confirm bar for the robber. */
async function confirm(page: Page): Promise<void> {
  const yes = page.locator('.confirm-dialog button.primary, .confirm-bar button.primary').first();
  await expect(yes).toBeVisible();
  await yes.click();
}

/** Does the next sensible thing for the human seat until its paired turn; returns what it did. */
async function step(page: Page): Promise<string> {
  if (await page.locator('.confirm-dialog').isVisible()) {
    await confirm(page);
    return 'confirm';
  }
  for (const [title, verb] of [['Discard', 'Discard'], ['Choose', 'Take']] as const) {
    const sheet = page.locator(`.sheet[aria-label^="${title}"]`);
    if (!(await sheet.isVisible())) continue;
    const need = Number(new RegExp(`${title} (\\d+)`).exec((await sheet.getAttribute('aria-label')) ?? '')?.[1] ?? 0);
    const more = sheet.locator(`button[aria-label^="${verb} one more"]`);
    let picked = 0;
    for (let i = 0; i < 5 && picked < need; i++) {
      while (picked < need && (await more.nth(i).isEnabled())) {
        await more.nth(i).click();
        picked++;
      }
    }
    await sheet.locator('button.primary').click();
    return title;
  }
  if (await page.locator('.sheet[aria-label="Trade offer"]').isVisible()) {
    await page.locator('.sheet[aria-label="Trade offer"] button', { hasText: 'No thanks' }).first().click();
    return 'decline';
  }
  const status = (await page.locator('.status-text').textContent()) ?? '';
  if (/Your paired turn/.test(status)) return 'paired';
  const pick: Array<[RegExp, 'v' | 'e' | 'h']> = [
    [/Place settlement/, 'v'],
    [/Place a road/, 'e'],
    [/Move the robber/, 'h'],
  ];
  for (const [re, kind] of pick) {
    if (re.test(status) && (await pickTarget(page, kind))) {
      await confirm(page);
      return kind;
    }
  }
  for (const name of [/Roll/, /End turn/]) {
    const button = page.getByRole('button', { name });
    if (await button.isVisible()) {
      await button.click();
      return String(name);
    }
  }
  return '';
}

test('a 6-player game of Through the Desert on the Seafarers 5-6 map, with paired turns', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /Through the Desert/ }).click();
  await expect(page.locator('.scenario-card.on .scenario-meta')).toContainText('3–6 players');
  const players = page.locator('.stepper[aria-label="players"]');
  while (Number(await players.locator('.stepper-value').textContent()) < 6) await players.getByRole('button', { name: 'more' }).click();
  await expect(page.locator('.seat')).toHaveCount(6);

  // the rulebook's 5-6 map: five deserts in a line, 43 land hexes, 10 harbors of shuffled types
  await page.locator('.map-row').getByRole('button', { name: 'Official' }).click();
  const thumb = page.locator('.map-thumb svg.board');
  await expect(thumb.locator('[data-tile]')).toHaveCount(43);
  await expect(thumb.locator('[data-tile][data-terrain="desert"]')).toHaveCount(5);
  await expect(thumb.locator('[data-harbor]')).toHaveCount(10);
  await expect(page.locator('.map-note')).toHaveText('Official map from the rulebook. Its harbors are shuffled — tap 🎲 for another.');

  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const board = page.locator('.board-area svg.board');
  await expect(board).toBeVisible();
  await expect(board.locator('[data-tile]')).toHaveCount(43);
  await expect(board.locator('[data-tile][data-terrain="desert"]')).toHaveCount(5);
  await expect(page.locator('.players .player')).toHaveCount(6);
  await expect(page.locator('.hud .sub')).toContainText('Through the Desert');
  await expect(page.locator('.hud .sub')).toContainText('14 VP');

  // play our part until the third player to our right takes a turn: then we act as its paired player
  const deadline = Date.now() + 150_000;
  let did = '';
  while (Date.now() < deadline && did !== 'paired') {
    did = await step(page);
    if (!did) await page.waitForTimeout(200);
  }
  expect(did).toBe('paired');
  // a paired turn: no dice to roll, but building and the end of the part are ours
  await expect(page.getByRole('button', { name: /Roll/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /End turn/ })).toBeVisible();
  // our settlements and roads (or ships) are on the map, two of each
  expect(await page.locator('g.building').count()).toBeGreaterThanOrEqual(12);
  expect(errors).toEqual([]);
});
