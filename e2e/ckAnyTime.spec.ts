import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/index.js';
import { SAVE_KEY, ckAfterSetup, ckGameAfterSetup, ckMain, ckRecord, cityOf, giveCards, setLevels } from './ckState.js';

/*
 * Cities & Knights: what every player can see at any time, not only on their
 * own turn: their own city improvements (levels, abilities, the next level's
 * cost and whether they can pay it), everyone's public levels, and each
 * player's hand as two counts, resource cards and commodity cards.
 */

/**
 * Ada's turn, waiting on her (an online seat that never moves here): Sam
 * watches with trade 2, science 3 and cloth 2, coin 1, paper 0 in hand; Ada
 * holds the politics metropolis.
 */
function offTurn(base: GameState = ckAfterSetup('ck-any')): GameState {
  const s = ckMain(base, { cloth: 2, coin: 1, brick: 1 });
  setLevels(s, 0, { trade: 2, science: 3 });
  setLevels(s, 1, { politics: 4 });
  s.ck!.metropolises.politics = { owner: 1, vertex: cityOf(s, 1) };
  giveCards(s, 1, { paper: 2, wool: 1 });
  s.turn.actor = 1;
  return s;
}

async function openOffTurn(page: Page, s: GameState): Promise<void> {
  const record = ckRecord(s, { seats: s.players.map((p, i) => ({ name: p.name, kind: i === 0 ? 'human' : i === 1 ? 'remote' : 'bot', color: i })) });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(page.locator('.status-text')).not.toHaveText(/Your turn/);
}

/** The flip chart, opened out of turn: Sam's levels, what comes next and whether he can pay, everyone's levels. */
async function checkChart(page: Page, s: GameState): Promise<void> {
  const sheet = page.locator('.sheet[aria-label="City improvements"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.flip-off')).toContainText('Wait for your turn');
  // looking only: no build buttons out of turn
  await expect(sheet.locator('.flip-buy')).toHaveCount(0);
  await expect(sheet.locator('.flip-col.tr-trade')).toHaveAttribute('data-level', '2');
  await expect(sheet.locator('.flip-col.tr-trade .flip-mine')).toHaveText('2/5');
  // trade 3 (Merchant Guild) costs 3 cloth: Sam has 2
  await expect(sheet.locator('.flip-next[data-track="trade"]')).toContainText('Merchant Guild');
  await expect(sheet.locator('.flip-next[data-track="trade"]')).toContainText('need 1 more');
  // politics 1 (Town Hall) costs 1 coin: Sam has it
  await expect(sheet.locator('.flip-next[data-track="politics"]')).toContainText('Town Hall');
  await expect(sheet.locator('.flip-next[data-track="politics"]')).toContainText('✓ you have 1');
  // science 3 is the Aqueduct: his
  await expect(sheet.locator('.flip-notes li[data-ability="science"] .fn-state')).toHaveText('yours');
  await expect(sheet.locator('.flip-notes li[data-ability="trade"] .fn-state')).toHaveText('at level 3');
  // everyone's levels are public: Ada's politics 4 and her metropolis
  const ada = sheet.locator('.flip-table tr[data-player="1"]');
  await expect(ada.locator('td[data-track="politics"] b')).toHaveText('4');
  await expect(ada.locator('td[data-track="politics"] .ft-tower')).toHaveCount(1);
  await expect(sheet.locator('.flip-table tbody tr')).toHaveCount(s.players.length);
  // never anyone else's commodities
  await expect(sheet).not.toContainText('paper 2');
}

/** Each player's hand as resource and commodity counts, matching the game. */
async function checkCounts(page: Page, s: GameState): Promise<void> {
  for (const p of s.players) {
    const res = Object.values(p.resources).reduce((a, b) => a + b, 0);
    const com = Object.values(s.ck!.players[p.id].commodities).reduce((a, b) => a + b, 0);
    const card = page.locator('.players .player').nth(p.id);
    await expect(card.locator('[data-count="resources"]')).toHaveText(String(res));
    await expect(card.locator('[data-count="commodities"]')).toHaveText(String(com));
    // and the improvement levels, on every screen
    await expect(card.locator('.pm-levels .lvl')).toHaveText([String(s.ck!.players[p.id].improvements.trade), String(s.ck!.players[p.id].improvements.politics), String(s.ck!.players[p.id].improvements.science)]);
  }
}

test('phone: out of turn, the Improvements button opens your city improvements to look at', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = offTurn();
  await openOffTurn(page, s);
  await checkCounts(page, s);
  const button = page.locator('.action-bar').getByRole('button', { name: 'Improvements' });
  await expect(button).toBeVisible();
  await expect(button.locator('.ltracks .lpips')).toHaveCount(3);
  // trade 2, politics 0, science 3: the pips filled
  await expect(button.locator('.lpips.tr-trade i.on')).toHaveCount(2);
  await expect(button.locator('.lpips.tr-science i.on')).toHaveCount(3);
  await button.click();
  await checkChart(page, s);
  await page.getByRole('button', { name: 'Close' }).click();
  // the scores sheet splits the hands too
  await page.locator('.players .player').nth(1).click();
  const adaRes = Object.values(s.players[1].resources).reduce((a, b) => a + b, 0);
  await expect(page.locator('.score-row').nth(1).locator('.score-split')).toHaveAttribute('data-split', `${adaRes}/2`);
  expect(errors).toEqual([]);
});

test('phone: 5 players with Seafarers, out of turn: the improvements and the split hands are there too', async ({ page }) => {
  const s = offTurn(ckGameAfterSetup({ scenario: 'seafarers-1-new-shores', players: 5, seed: 'ck-any-5' }));
  await openOffTurn(page, s);
  await expect(page.locator('.players .player')).toHaveCount(5);
  await checkCounts(page, s);
  await page.locator('.action-bar').getByRole('button', { name: 'Improvements' }).click();
  await checkChart(page, s);
});

test.describe('computer screen', () => {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('out of turn, Improve on the side panel (or the I key) opens the chart to look at', async ({ page }) => {
    const s = offTurn();
    await openOffTurn(page, s);
    await checkCounts(page, s);
    const improve = page.locator('.deck').getByRole('button', { name: /Improve/ });
    await expect(improve.locator('.ltracks')).toHaveCount(1);
    await improve.click();
    await checkChart(page, s);
    await page.getByRole('button', { name: 'Close' }).click();
    await page.keyboard.press('i');
    await expect(page.locator('.sheet[aria-label="City improvements"]')).toBeVisible();
  });
});
