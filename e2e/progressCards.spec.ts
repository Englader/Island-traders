import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/index.js';
import { HOST_SAVE_KEY, SAVE_KEY, ckAfterSetup, ckMain, ckRecord, giveCards, giveProgress } from './ckState.js';

/*
 * Cities & Knights, part 4b: playing your own progress cards in the browser,
 * from crafted saves. Each card is chosen in the hand, its choices made (the
 * dice, a player, two numbers, a road, a hex, the offers), confirmed in the
 * dialog with its face, and the saved game checked afterwards.
 */

// local room server and relay broker (see playwright.config.ts)
const BASE = '/?peer=127.0.0.1:9000/broker&mqtt=ws://127.0.0.1:9001';

/** The saved game, as the browser stored it after the last move. */
async function saved(page: Page, key = SAVE_KEY): Promise<GameState> {
  return page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? 'null') as { state: GameState }).state, key);
}

async function gameLog(page: Page, key = SAVE_KEY): Promise<string[]> {
  return (await saved(page, key)).log.map((e) => e.msg);
}

async function openSave(page: Page, state: GameState): Promise<void> {
  const record = ckRecord(state);
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
}

/** Opens the progress cards and presses Play on `title`. */
async function play(page: Page, title: string): Promise<void> {
  await page.locator('.action-bar').getByRole('button', { name: /Cards/ }).click();
  const sheet = page.locator('.sheet[aria-label="Progress cards"]');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: `Play ${title}` }).click();
}

/** The confirmation with the card's face: check its title, then say yes. */
async function confirm(page: Page, card: string, title: string | RegExp): Promise<void> {
  const dialog = page.locator('.confirm-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(`.ask-card [data-card="${card}"]`)).toBeVisible();
  await expect(dialog.locator('#ask-title')).toHaveText(title);
  await dialog.locator('button.ask-yes').click();
  await expect(dialog).toHaveCount(0);
}

/** Sam's turn after the roll, holding `cards`. */
function withCards(cards: Parameters<typeof giveProgress>[2], seed = 'ck-play'): GameState {
  const s = ckMain(ckAfterSetup(seed));
  giveProgress(s, 0, cards);
  return s;
}

test('the Alchemist: pick both dice before the roll, with a preview of what they bring', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = ckAfterSetup('ck-play');
  giveProgress(s, 0, ['alchemist']);
  await openSave(page, s);
  // the Alchemist sits by the Roll button
  const alc = page.locator('.action-bar').getByRole('button', { name: 'Alchemist' });
  await expect(alc).toBeVisible();
  await alc.click();
  const sheet = page.locator('.sheet[aria-label="Alchemist: choose the dice"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Pick both dice' })).toBeDisabled();
  await sheet.getByRole('radio', { name: 'White die 4' }).click();
  await sheet.getByRole('radio', { name: 'Red die 2' }).click();
  await expect(sheet.locator('.alc-total b')).toHaveText('6');
  await expect(sheet.locator('.alc-lines')).toContainText(/You get/);
  await expect(sheet.locator('.alc-draws li')).toHaveCount(3);
  await sheet.getByRole('button', { name: 'Use 4 and 2' }).click();
  await confirm(page, 'alchemist', 'Set the dice to 4 and 2?');
  await expect.poll(() => gameLog(page)).toContain('Sam plays Alchemist');
  await expect.poll(() => gameLog(page)).toContain('Sam sets the dice to 6 (4+2)');
  const after = await saved(page);
  expect(after.turn.dice).toEqual([4, 2]);
  expect(after.ck!.players[0].progress).not.toContain('alchemist');
  expect(after.rolls?.at(-1)?.chosen).toBe(true);
  expect(errors).toEqual([]);
});

test('the Spy: pick a player, see their progress cards (only you), take one', async ({ page }) => {
  const s = withCards(['spy']);
  giveProgress(s, 1, ['bishop', 'crane']);
  await openSave(page, s);
  await play(page, 'Spy');
  const pick = page.locator('.sheet[aria-label="Spy: pick a player"]');
  await expect(pick.locator('.pp-btn[data-player="1"]')).toContainText('2 progress cards');
  // Björn holds none: he can't be picked
  await expect(pick.locator('.pp-btn[data-player="2"]')).toBeDisabled();
  await pick.locator('.pp-btn[data-player="1"]').click();
  await confirm(page, 'spy', 'Spy on Ada?');
  const seen = page.locator('.sheet[aria-label="Spy: Ada\'s cards"]');
  await expect(seen).toBeVisible();
  await expect(seen.locator('.spy-card')).toHaveCount(2);
  await expect(seen.locator('.spy-card[data-card="bishop"]')).toBeVisible();
  await seen.getByRole('button', { name: 'Take Crane' }).click();
  await expect(seen).toHaveCount(0);
  await expect.poll(() => gameLog(page)).toContain('Sam takes a progress card from Ada');
  const after = await saved(page);
  expect(after.ck!.players[0].progress).toEqual(['crane']);
  expect(after.ck!.players[1].progress).toEqual(['bishop']);
});

test('the Inventor: pick two numbers on the board, only legal pairs lit, and swap them', async ({ page }) => {
  const s = withCards(['inventor']);
  const hexes = Object.entries(s.board.hexes).filter(([, h]) => h.token !== null && ![2, 6, 8, 12].includes(h.token));
  const [a] = hexes.find(([, h]) => h.token === 3)!;
  const [b] = hexes.find(([, h]) => h.token === 10)!;
  const same = hexes.filter(([h, x]) => x.token === 3 && h !== a).map(([h]) => h);
  await openSave(page, s);
  await play(page, 'Inventor');
  await expect(page.locator('.card-bar')).toContainText('a number to swap');
  // every number but 2, 12, 6 and 8 can go
  await expect(page.locator('[data-pick^="h:"]')).toHaveCount(hexes.length);
  await page.locator(`[data-pick="h:${a}"]`).click();
  // then its partners: never the same number again
  await expect(page.locator('[data-selected-hex]')).toHaveAttribute('data-selected-hex', a);
  for (const h of same) await expect(page.locator(`[data-pick="h:${h}"]`)).toHaveCount(0);
  await page.locator(`[data-pick="h:${b}"]`).click();
  await confirm(page, 'inventor', 'Swap the 3 and the 10?');
  await expect.poll(() => gameLog(page)).toContain('Sam swaps the 3 and the 10');
  await expect(page.locator(`[data-tile="${a}"]`)).toHaveAttribute('data-token', '10');
  await expect(page.locator(`[data-tile="${b}"]`)).toHaveAttribute('data-token', '3');
  const after = await saved(page);
  expect(after.board.hexes[a].token).toBe(10);
  expect(after.board.hexes[b].token).toBe(3);
});

test("the Diplomat: an open road is lit; Ada's goes back to her", async ({ page }) => {
  const s = withCards(['diplomat']);
  const adas = Object.entries(s.board.pieces).filter(([, p]) => p.owner === 1).map(([e]) => e);
  await openSave(page, s);
  await play(page, 'Diplomat');
  await expect(page.locator('.card-bar')).toContainText('an open road to remove');
  const lit = await page.locator('[data-pick^="e:"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-pick')!.slice(2)));
  const target = adas.find((e) => lit.includes(e))!;
  expect(target).toBeTruthy();
  await page.locator(`[data-pick="e:${target}"]`).click();
  await confirm(page, 'diplomat', "Remove Ada's road?");
  await expect.poll(() => gameLog(page)).toContain('Sam removes a road of Ada');
  const after = await saved(page);
  expect(after.board.pieces[target]).toBeUndefined();
  expect(after.players[1].supply.roads).toBe(s.players[1].supply.roads + 1);
});

test('the Merchant: pick a hex next to your buildings; the merchant stands there, 1 VP', async ({ page }) => {
  const s = withCards(['merchant']);
  await openSave(page, s);
  const vp = Number(await page.locator('.player').first().locator('.pvp').textContent());
  await play(page, 'Merchant');
  await expect(page.locator('.card-bar')).toContainText('a hex next to your buildings');
  const spots = page.locator('[data-pick^="h:"]');
  expect(await spots.count()).toBeGreaterThan(1);
  const hex = (await spots.first().getAttribute('data-pick'))!.slice(2);
  await spots.first().click();
  await confirm(page, 'merchant', 'Place the merchant here?');
  await expect.poll(async () => (await gameLog(page)).some((m) => /^Sam places the merchant on a \w+ hex/.test(m))).toBe(true);
  await expect(page.locator(`[data-merchant="${hex}"]`)).toHaveCount(1);
  await expect(page.locator('.player').first().locator('.pvp')).toHaveText(String(vp + 1));
  expect((await saved(page)).ck!.merchant).toEqual({ hex, owner: 0 });
});

test('the Commercial Harbor: offer a resource to each opponent with commodities', async ({ page }) => {
  const s = withCards(['commercialHarbor']);
  giveCards(s, 0, { brick: 1 });
  giveCards(s, 1, { cloth: 1 });
  const before = { brick: s.players[0].resources.brick, cloth: s.ck!.players[0].commodities.cloth, adaBrick: s.players[1].resources.brick };
  await openSave(page, s);
  await play(page, 'Commercial Harbor');
  await confirm(page, 'commercialHarbor', 'Play the Commercial Harbor?');
  const offers = page.locator('.sheet[aria-label="Commercial Harbor: your offers"]');
  await expect(offers).toBeVisible();
  // Björn holds no commodity: nothing to offer him
  await expect(offers.locator('.harbor-row[data-player="2"]')).toContainText('No commodities');
  const ada = offers.locator('.harbor-row[data-player="1"]');
  await ada.getByRole('button', { name: 'Offer Brick to Ada' }).click();
  await ada.getByRole('button', { name: 'Offer 1 brick to Ada' }).click();
  await expect(ada).toContainText('Your brick for their cloth');
  await expect.poll(() => gameLog(page)).toContain('Sam trades a resource to Ada for a commodity');
  const after = await saved(page);
  expect(after.players[0].resources.brick).toBe(before.brick - 1);
  expect(after.ck!.players[0].commodities.cloth).toBe(before.cloth + 1);
  expect(after.players[1].resources.brick).toBe(before.adaBrick + 1);
  // the chip by the action bar says the offers are done
  await offers.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.turn-chip[data-chip="harbor"]')).toContainText('offers made');
});

test('a card that cannot be played says why, and cancelling keeps it in the hand', async ({ page }) => {
  const s = withCards(['bishop', 'engineer']);
  await openSave(page, s);
  await page.locator('.action-bar').getByRole('button', { name: /Cards/ }).click();
  const sheet = page.locator('.sheet[aria-label="Progress cards"]');
  // the robber sleeps until the barbarians first attack
  await expect(sheet.getByRole('button', { name: 'Play Bishop' })).toBeDisabled();
  await expect(sheet.locator('.prog-row[data-card="bishop"] .prog-why')).toHaveText('The robber sleeps until the barbarians first attack');
  // the Engineer has one city to wall: straight to the confirmation, and "No" puts it back
  await sheet.getByRole('button', { name: 'Play Engineer' }).click();
  await expect(page.locator('.confirm-dialog #ask-title')).toHaveText('Build a free city wall here?');
  await page.locator('.confirm-dialog button.ask-no').click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.prog-row')).toHaveCount(2);
  expect((await saved(page)).ck!.players[0].progress).toEqual(['bishop', 'engineer']);
});

test('online: a guest plays the Spy and only the guest sees the cards', async ({ browser }) => {
  const room = 'SPYCK';
  const s = ckAfterSetup('ck-online-spy');
  s.players[1].name = 'Friend';
  // the friend's turn, after the roll
  s.turn.current = 1;
  s.turn.actor = 1;
  s.turn.dice = [2, 3];
  s.ck!.event = 'ship';
  s.phase = { kind: 'main' };
  giveProgress(s, 1, ['spy']);
  giveProgress(s, 0, ['bishop', 'medicine']);
  const record = ckRecord(s, {
    mode: 'host',
    room,
    id: 'ck-spy-room',
    seats: [
      { name: 'Sam', kind: 'human', color: 0 },
      { name: 'Friend', kind: 'remote', color: 1 },
      { name: 'Björn', kind: 'bot', color: 2 },
    ],
  });
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  await host.addInitScript(([k, v]) => localStorage.setItem(k, v), [HOST_SAVE_KEY, JSON.stringify(record)] as const);
  await host.goto(BASE);
  await host.getByRole('button', { name: /Continue/ }).click();
  await expect(host.locator('.lobby-code .hint').first()).toContainText(/Room .* online/);
  await guest.goto(`${BASE}#join=${room}`);
  await guest.getByLabel('Your name').fill('Friend');
  await guest.getByRole('button', { name: 'Join' }).click();
  await expect(host.locator('.lobby-seat').nth(1)).toContainText('online');
  await host.getByRole('button', { name: /Start the game/ }).click();
  await expect(guest.locator('svg.board')).toBeVisible();

  // the friend plays the Spy on Sam
  await play(guest, 'Spy');
  await guest.locator('.sheet[aria-label="Spy: pick a player"] .pp-btn[data-player="0"]').click();
  await confirm(guest, 'spy', 'Spy on Sam?');
  const seen = guest.locator('.spy-cards');
  await expect(seen.locator('.spy-card')).toHaveCount(2);
  await expect(seen.locator('.spy-card[data-card="medicine"]')).toBeVisible();
  // Sam, the host, sees that the Spy was played on him, never what the friend sees
  await expect(host.locator('.status-text')).toContainText('Friend plays Spy');
  await expect(host.locator('.spy-cards')).toHaveCount(0);
  await guest.getByRole('button', { name: 'Take Medicine' }).click();
  await expect(seen).toHaveCount(0);
  await expect.poll(() => gameLog(host, HOST_SAVE_KEY)).toContain('Friend takes a progress card from Sam');
  const after = await saved(host, HOST_SAVE_KEY);
  expect(after.ck!.players[1].progress).toEqual(['medicine']);
  expect(after.ck!.players[0].progress).toEqual(['bishop']);
  // the friend's hand shows the card taken
  await guest.locator('.action-bar').getByRole('button', { name: /Cards/ }).click();
  await expect(guest.locator('.sheet[aria-label="Progress cards"] .prog-row[data-card="medicine"]')).toBeVisible();
  await hostCtx.close();
  await guestCtx.close();
});
