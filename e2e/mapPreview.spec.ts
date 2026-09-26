import { expect, test, type Locator, type Page } from '@playwright/test';

// The map on the new-game screen is the board you get: the small picture, its
// full view ("Tap to see the map") and the started game show the same tiles,
// numbers and harbors, the same way round. On a phone held upright wide maps
// are turned a quarter turn in all three; on a computer screen in none.

interface Seen {
  /** "hex terrain token" for each land tile and "harbor edge type" for each harbor, sorted. */
  content: string[];
  /** Where each tile's top sits on the screen. */
  centres: Record<string, { x: number; y: number }>;
  turned: string | null;
}

async function look(board: Locator): Promise<Seen> {
  await expect(board.locator('[data-tile]').first()).toBeVisible();
  return board.evaluate((svg) => {
    const content: string[] = [];
    const centres: Record<string, { x: number; y: number }> = {};
    for (const g of Array.from(svg.querySelectorAll('[data-tile]'))) {
      const hex = g.getAttribute('data-tile')!;
      content.push(`${hex} ${g.getAttribute('data-terrain')} ${g.getAttribute('data-token')}`);
      const r = g.querySelector('.tile-top')!.getBoundingClientRect();
      centres[hex] = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    for (const h of Array.from(svg.querySelectorAll('[data-harbor]'))) content.push(`harbor ${h.getAttribute('data-harbor')} ${h.getAttribute('data-harbor-type')}`);
    return { content: content.sort(), centres, turned: svg.getAttribute('data-turned') };
  });
}

/** How far board b is turned from board a, in degrees: the average change of direction from one tile to another. */
function turn(a: Seen, b: Seen): number {
  const ids = Object.keys(a.centres).filter((h) => b.centres[h]);
  let x = 0;
  let y = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const [p, q] = [ids[i], ids[j]];
      const da = Math.atan2(a.centres[q].y - a.centres[p].y, a.centres[q].x - a.centres[p].x);
      const db = Math.atan2(b.centres[q].y - b.centres[p].y, b.centres[q].x - b.centres[p].x);
      x += Math.cos(db - da);
      y += Math.sin(db - da);
    }
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function expectSameMap(a: Seen, b: Seen, what: string) {
  expect(b.content, `${what}: the same tiles, numbers and harbors`).toEqual(a.content);
  expect(Math.abs(turn(a, b)), `${what}: turned by (degrees)`).toBeLessThan(3);
  expect(b.turned, `${what}: drawn the same way round`).toBe(a.turned);
}

/**
 * Picks a scenario and map, deals another with 🎲 if asked, then checks the
 * picture against its full view and against the game started from it.
 */
async function checkPreview(page: Page, scenario: RegExp | null, layout: 'Official' | 'Random', reroll: boolean, turned: boolean) {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  if (scenario) await page.getByRole('button', { name: scenario }).click();
  await page.locator('.map-row').getByRole('button', { name: layout }).click();
  const thumb = page.locator('.map-thumb svg.board');
  if (reroll) {
    const before = (await look(thumb)).content.join();
    await page.getByRole('button', { name: '🎲 New map' }).click();
    await expect.poll(async () => (await look(thumb)).content.join()).not.toBe(before);
  } else {
    await expect(page.getByRole('button', { name: '🎲 New map' })).toHaveCount(0);
  }
  const small = await look(thumb);

  await page.locator('.map-thumb').click();
  const sheet = page.locator('.sheet .map-big svg.board');
  await expect(sheet).toBeVisible();
  const big = await look(sheet);
  await page.locator('.sheet').getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  // opening the full view deals nothing new
  expect((await look(thumb)).content).toEqual(small.content);

  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'slow' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const game = await look(page.locator('.board-area svg.board'));

  expectSameMap(small, big, 'picture and full view');
  expectSameMap(small, game, 'picture and game');
  expect(game.turned).toBe(String(turned));
}

const CASES: Array<{ name: string; scenario: RegExp | null; layout: 'Official' | 'Random'; reroll: boolean }> = [
  { name: 'the official base map', scenario: null, layout: 'Official', reroll: false },
  { name: 'an official map, harbors shuffled again with 🎲', scenario: /Heading for New Shores/, layout: 'Official', reroll: true },
  { name: 'a random map, after 🎲', scenario: null, layout: 'Random', reroll: true },
  { name: 'a random Seafarers map, after 🎲', scenario: /Heading for New Shores/, layout: 'Random', reroll: true },
];

test.describe('phone held upright', () => {
  test.use({ viewport: { width: 412, height: 839 } });
  for (const c of CASES) {
    test(`map preview, full view and game match: ${c.name}`, async ({ page }) => {
      await checkPreview(page, c.scenario, c.layout, c.reroll, true);
    });
  }
});

test.describe('computer screen', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  for (const c of CASES) {
    test(`map preview, full view and game match: ${c.name}`, async ({ page }) => {
      await checkPreview(page, c.scenario, c.layout, c.reroll, false);
    });
  }
});
