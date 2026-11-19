import { expect, test, type Page } from '@playwright/test';
import { applyAction, createGame, heuristicAction, legalActions, playersToAct, type GameState } from '../src/index.js';
import { SAVE_KEY, ckRecord, giveCards } from './ckState.js';

/**
 * Cities & Knights on a Seafarers scenario on a computer screen: the build
 * tiles have the ship as well as the knight and the city wall (six tiles,
 * keys 1-6), the ship can be moved, and End turn stays on screen. On a
 * phone, the build sheet has the ship too.
 */

const NAMES = ['Sam', 'Ada', 'Björn'];

function playUntil(s: GameState, done: (s: GameState) => boolean): GameState {
  let state = s;
  for (let i = 0; i < 4000 && !done(state); i++) {
    const p = playersToAct(state)[0];
    const a = heuristicAction(state, p, 'medium') ?? legalActions(state, p)[0];
    const r = applyAction(state, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error}`);
    state = r.state;
  }
  return state;
}

/**
 * New Shores with C&K, Sam in his main phase after a quiet roll (no 7, no
 * barbarian ship), with the cards for a ship and a knight and a ship he can
 * move.
 */
function seaMain(): GameState {
  for (let n = 0; n < 60; n++) {
    let s = playUntil(
      createGame({ scenario: 'seafarers-1-new-shores', players: NAMES, seed: `e2e-ck-sea-desk-${n}`, options: { firstPlayer: 0, citiesAndKnights: true } }),
      (x) => x.phase.kind === 'preRoll' && x.turn.actor === 0,
    );
    // a first ship, one turn earlier, so that it can be moved
    giveCards(s, 0, { lumber: 1, wool: 1 });
    let r = applyAction(s, { type: 'rollDice', player: 0 });
    if (!r.ok || r.state.phase.kind !== 'main') continue;
    const ship = legalActions(r.state, 0).find((a) => a.type === 'buildShip');
    if (!ship) continue;
    r = applyAction(r.state, ship);
    if (!r.ok) continue;
    r = applyAction(r.state, { type: 'endTurn', player: 0 });
    if (!r.ok) continue;
    s = playUntil(r.state, (x) => x.phase.kind === 'preRoll' && x.turn.actor === 0);
    giveCards(s, 0, { lumber: 2, wool: 2, ore: 1 });
    for (let i = 0; i < 200; i++, s.rng.s++) {
      r = applyAction(s, { type: 'rollDice', player: 0 });
      if (!r.ok || r.state.phase.kind !== 'main' || r.state.ck!.event === 'ship') continue;
      const acts = legalActions(r.state, 0);
      if (['buildShip', 'buildKnight', 'moveShip', 'endTurn'].every((t) => acts.some((a) => a.type === t))) return r.state;
      break;
    }
  }
  throw new Error('no suitable game');
}

async function openGame(page: Page, s: GameState) {
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(ckRecord(s))] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
}

test.describe('a computer screen', () => {
  test.use({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('six build tiles with the ship, keys 1-6, Move ship, and End turn on screen at 1366×768 (crafted save)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openGame(page, seaMain());

    const tiles = page.locator('.bgrid .btile');
    await expect(tiles).toHaveCount(6);
    await expect(tiles.locator('.bt-name')).toHaveText(['Road', 'Ship', 'Settlement', 'City', 'Knight', 'City wall']);
    await expect(page.locator('.deck-cap-hint')).toContainText('1–6');
    await expect(tiles.nth(1)).toHaveAttribute('aria-keyshortcuts', '2');
    await expect(tiles.nth(5)).toHaveAttribute('aria-keyshortcuts', '6');

    // End turn and Move ship are on screen without scrolling anything
    const end = page.locator('.deck-main').getByRole('button', { name: /End turn/ });
    await expect(end).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.deck-row').getByRole('button', { name: /Move ship/ })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
    const vp = page.viewportSize()!;
    const box = (await end.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    // ... nor in the side panel, which fits without a scroll bar
    const panel = await page.locator('.panel').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, top: el.scrollTop }));
    expect(panel.scroll).toBeLessThanOrEqual(panel.client + 1);
    expect(panel.top).toBe(0);
    const pbox = (await page.locator('.panel').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(pbox.y + pbox.height);

    // Move ship: pick the ship, Esc cancels
    await page.locator('.deck-row').getByRole('button', { name: /Move ship/ }).click();
    await expect(page.locator('.mode-hint')).toContainText('the ship to move');
    await page.keyboard.press('Escape');
    await expect(page.locator('.mode-hint')).toHaveCount(0);

    // 2 picks the ship tile, Esc cancels; 5 the knight
    await page.keyboard.press('2');
    await expect(page.locator('.mode-hint')).toContainText('build a ship');
    await expect(tiles.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.mode-hint')).toHaveCount(0);
    await page.keyboard.press('5');
    await expect(page.locator('.mode-hint')).toContainText('hire a knight');
    await page.keyboard.press('Escape');

    // the ship tile builds a ship, after the question
    await tiles.nth(1).click();
    await page.locator('[data-pick^="e:"]').first().click();
    await expect(page.locator('.confirm-dialog, .confirm-bar')).toContainText('Build a ship here?');
    await page.locator('.confirm-dialog button.primary, .confirm-bar button.primary').first().click();
    await expect
      .poll(() => page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? 'null') as { state: { log: Array<{ msg: string }> } }).state.log.map((e) => e.msg), SAVE_KEY))
      .toContain('Sam builds a ship');
    expect(errors).toEqual([]);
  });
});

test('a phone: the build sheet has the ship next to the knight and the city wall (crafted save)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openGame(page, seaMain());
  await expect(page.locator('.action-bar').getByRole('button', { name: /Move ship/ })).toBeVisible();
  await page.locator('.action-bar').getByRole('button', { name: 'Build' }).click();
  const items = page.locator('.build-list .build-item .build-name');
  await expect(items).toHaveText(['Road', 'Ship', 'Settlement', 'City', 'Knight (basic)', 'City wall']);
  await expect(page.locator('.build-list .build-item').nth(1)).toBeEnabled();
  expect(errors).toEqual([]);
});
