import { expect, test, type Page } from '@playwright/test';
import {
  HOST_SAVE_KEY,
  SAVE_KEY,
  ckAfterSetup,
  ckMain,
  ckRecord,
  giveCards,
  knightSpots,
  loadDice,
  makeCity,
  placeKnight,
} from './ckState.js';

// local room server and relay broker (see playwright.config.ts)
const BASE = '/?peer=127.0.0.1:9000/broker&mqtt=ws://127.0.0.1:9001';

/** The yes button: of the "Ask before building" dialog, or of the confirm bar. */
const yes = (page: Page) => page.locator('.confirm-dialog button.primary, .confirm-bar button.primary').first();

/** The saved game's log. */
async function gameLog(page: Page, key = SAVE_KEY): Promise<string[]> {
  return page.evaluate((k) => {
    const rec = JSON.parse(localStorage.getItem(k) ?? 'null') as { state: { log: Array<{ msg: string }> } } | null;
    return rec ? rec.state.log.map((e) => e.msg) : [];
  }, key);
}

async function openSave(page: Page, record: unknown, key = SAVE_KEY): Promise<void> {
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(record)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
}

/** Answers whatever the game asks of Sam that isn't placing a piece: a trade offer (no thanks), a discard. */
async function answer(page: Page): Promise<boolean> {
  const offer = page.locator('.sheet[aria-label="Trade offer"]');
  if (await offer.isVisible()) {
    await offer.getByRole('button', { name: 'No thanks' }).first().click();
    return true;
  }
  const discard = page.locator('.sheet[aria-label^="Discard"]');
  if (await discard.isVisible()) {
    const prog = discard.locator('.prog-list button.primary:not([disabled])');
    if ((await prog.count()) > 0) {
      await prog.first().click();
      return true;
    }
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
    return true;
  }
  return false;
}

/** Places a starting piece when asked to: a settlement, the city of the second round, or a road. `seen` gets the status it acts on. */
async function place(page: Page, seen?: (status: string) => void): Promise<boolean> {
  if (await answer(page)) return true;
  if (await page.locator('.confirm-dialog').isVisible()) {
    await yes(page)
      .click({ timeout: 2000 })
      .catch(() => page.keyboard.press('Escape'));
    return true;
  }
  const status = (await page.locator('.status-text').textContent()) ?? '';
  seen?.(status);
  const kind = /Place settlement|Place your city/.test(status) ? 'v' : /Place a road/.test(status) ? 'e' : null;
  if (!kind) return false;
  const targets = page.locator(`[data-pick^="${kind}:"]`);
  const n = await targets.count();
  for (let k = 0; k < n; k++) {
    const i = (Math.floor(n / 2) + k) % n;
    try {
      await targets.nth(i).click({ timeout: 800 });
      await yes(page).click({ timeout: 2000 });
      return true;
    } catch {
      if (await page.locator('.confirm-dialog').isVisible()) await page.keyboard.press('Escape');
    }
  }
  return false;
}

test('a Cities & Knights game against the computer: the beginners’ map, a city to start, three dice and the barbarians', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  // the option sits under the base game, with its line of explanation
  const sw = page.getByRole('switch', { name: 'Play with Cities & Knights' });
  await expect(page.locator('.ck-toggle')).toContainText('Knights, barbarians, city improvements · 13 VP');
  await sw.click();
  await expect(sw).toBeChecked();
  // 3-6 players: the stepper goes on past 4 (6 players: e2e/ck56.spec.ts)
  await expect(page.getByRole('button', { name: 'more' }).first()).toBeEnabled();
  await expect(page.locator('.map-note')).toContainText('beginners’ map from the Cities & Knights rulebook');
  // the preview shows the beginners' map: a sleeping robber on the desert, mountains 2 at the top
  await expect(page.locator('.map-thumb [data-asleep="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'less' }).first().click();
  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(page.locator('.hud .sub')).toContainText('Cities & Knights');
  await expect(page.locator('.hud .sub')).toContainText('13 VP');
  await expect(page.locator('.ck-track')).toBeVisible();

  // the setup: a settlement, then a city; the second round's piece is a city
  const roll = page.locator('.action-bar').getByRole('button', { name: /Roll/ });
  const deadline = Date.now() + 90_000;
  let sawCity = false;
  // (the prompt can come up between two reads of the status: note the one place() acts on too)
  const note = (status: string) => {
    if (/Place your city/.test(status)) sawCity = true;
  };
  while (Date.now() < deadline && !(await roll.isVisible())) {
    note((await page.locator('.status-text').textContent()) ?? '');
    if (!(await place(page, note))) await page.waitForTimeout(200);
  }
  expect(sawCity).toBe(true);
  await expect(page.locator('[data-tile][data-terrain="desert"]')).toHaveCount(1);
  expect(await page.locator("g.building").count()).toBeGreaterThanOrEqual(6);
  // the robber sleeps until the barbarians first attack
  await expect(page.locator('svg.board [data-asleep="true"]')).toHaveCount(1);

  // three dice: white, red and the event die
  await roll.click();
  await expect(page.locator('.roll-overlay')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.hud .dice .die')).toHaveCount(3);
  await expect(page.locator('.hud .dice .die.event')).toHaveCount(1);
  await expect.poll(async () => (await gameLog(page)).some((m) => m.startsWith('The event die shows'))).toBe(true);
  expect(errors).toEqual([]);
});

test('knights, a city improvement and the barbarian track (crafted save)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Sam's turn after the roll, with what a knight, its activation and the Abbey cost
  const s = ckMain(ckAfterSetup(), { wool: 1, ore: 1, grain: 1, paper: 2 });
  await openSave(page, ckRecord(s));
  const before = await page.locator('svg.board [data-knight]').count();

  // hire a knight: Build → Knight, a spot on the road, yes
  await page.locator('.action-bar').getByRole('button', { name: 'Build' }).click();
  await page.getByRole('button', { name: /Knight \(basic\)/ }).click();
  await page.locator('[data-pick^="v:"]').first().click();
  await expect(page.locator('.confirm-dialog')).toContainText('Hire a basic knight here?');
  await yes(page).click();
  await expect(page.locator('svg.board [data-knight][data-owner="0"]')).toHaveCount(1);
  expect(await page.locator('svg.board [data-knight]').count()).toBe(before + 1);
  await expect.poll(() => gameLog(page)).toContain('Sam hires a basic knight');
  await expect(page.locator('svg.board [data-knight][data-owner="0"] .knight.idle')).toHaveCount(1);

  // activate it: Knights, the knight, Activate (1 grain), yes
  await page.locator('.action-bar').getByRole('button', { name: 'Knights' }).click();
  await page.locator('[data-pick^="v:"]').first().click();
  const bar = page.locator('.knight-bar');
  await expect(bar).toContainText('Basic knight');
  await bar.getByRole('button', { name: /Activate/ }).click();
  await expect(page.locator('.confirm-dialog')).toContainText('Activate this basic knight?');
  await yes(page).click();
  await expect.poll(() => gameLog(page)).toContain('Sam activates a basic knight');
  await expect(page.locator('svg.board [data-knight][data-owner="0"] .knight.active')).toHaveCount(1);
  // the knights' strength in the header follows
  await expect(page.locator('.ck-track .bt-k')).toContainText('1');

  // a city improvement, paid with paper: Improve → the science track → yes
  const paper = page.locator('.panel .hand .rtile.r-paper .rtile-n');
  await expect(paper).toHaveText('2');
  await page.locator('.action-bar').getByRole('button', { name: 'Improve' }).click();
  const flip = page.locator('.flip');
  await expect(flip.locator('.flip-col')).toHaveCount(3);
  await flip.locator('.flip-buy[data-track="science"]').click();
  const dialog = page.locator('.confirm-dialog');
  await expect(dialog).toContainText('Build the Abbey?');
  await expect(dialog).toContainText('you draw a science card on a red 1–2');
  await yes(page).click();
  await expect.poll(() => gameLog(page)).toContain('Sam builds the Abbey (science level 1)');
  await expect(paper).toHaveText('1');
  await page.locator('.action-bar').getByRole('button', { name: 'Improve' }).click();
  await expect(page.locator('.flip-col.tr-science .flip-level.done')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close' }).click();
  expect(errors).toEqual([]);
});

test('the barbarian ship sails closer on a ship roll (crafted save)', async ({ page }) => {
  const s = ckAfterSetup();
  s.ck!.barbarians = 2;
  loadDice(s, { event: 'ship', sum: 8 });
  await openSave(page, ckRecord(s));
  await expect(page.locator('.ck-track')).toHaveAttribute('data-pos', '2');
  await page.locator('.action-bar').getByRole('button', { name: /Roll/ }).click();
  await expect(page.locator('.roll-event')).toContainText('Barbarians advance');
  await expect(page.locator('.roll-overlay')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.ck-track')).toHaveAttribute('data-pos', '3');
  await expect(page.locator('.hud .dice .die.event')).toHaveAttribute('aria-label', 'event die: barbarian ship');
  await expect.poll(() => gameLog(page)).toContain('The barbarian ship sails closer (3 of 7)');
});

test('the barbarians attack: the strength of both sides, the city Sam loses, and the robber wakes up (crafted save)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // one more ship roll brings them in; nobody has an active knight, and Sam has two cities to choose from
  const s = ckAfterSetup();
  s.ck!.barbarians = 6;
  makeCity(s, 0);
  placeKnight(s, 1, knightSpots(s, 1)[0], 1, false);
  loadDice(s, { event: 'ship', sum: 9 });
  await openSave(page, ckRecord(s));
  await expect(page.locator('.ck-track .bt-vs')).toHaveClass(/lose/);
  await page.locator('.action-bar').getByRole('button', { name: /Roll/ }).click();
  await expect(page.locator('.roll-event')).toContainText('The barbarians attack!');

  // the moment: 4 cities against 0 knights, and who pays
  const fx = page.locator('.fx-attack');
  await expect(fx).toBeVisible({ timeout: 15_000 });
  await expect(fx.locator('.fx-side.barb b')).toHaveText('4');
  await expect(fx.locator('.fx-side.kn b')).toHaveText('0');
  await expect(fx.locator('.fx-outcome')).toContainText('The barbarians win');
  await expect(fx.locator('.fx-outcome')).toContainText('you choose a city to lose');
  await fx.click();

  // Sam picks the city on the board
  await expect(page.locator('.status-text')).toContainText('pick a city to lose');
  await expect(page.locator('.forced-hint')).toBeVisible();
  await expect(page.locator('[data-pick^="v:"]')).toHaveCount(2);
  await page.locator('[data-pick^="v:"]').first().click();
  await yes(page).click();
  await expect.poll(() => gameLog(page)).toContain('The barbarians pillage a city of Sam');
  // the ship is home again and the robber is awake
  await expect(page.locator('.ck-track')).toHaveAttribute('data-pos', '0');
  await expect(page.locator('svg.board [data-asleep="true"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a Wedding the computer plays: give 2 cards of your choice (crafted save)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Ada (a computer player) plays a Wedding on her turn: Sam, with more points, gives her 2 cards of his choice
  const s = ckAfterSetup('ck-cards');
  s.turn.current = 1;
  s.turn.actor = 1;
  s.phase = { kind: 'main' };
  s.turn.dice = [2, 3];
  giveCards(s, 0, { brick: 2, wool: 1, paper: 1 });
  const sam = s.players[0].resources;
  const before = { brick: sam.brick, paper: s.ck!.players[0].commodities.paper };
  s.ck!.players[1].progress.push('wedding');
  s.ck!.decks.politics.splice(s.ck!.decks.politics.indexOf('wedding'), 1);
  // Sam leads: give him a Defender of Catan card
  s.ck!.players[0].defenders = 1;
  s.phase = { kind: 'ck', step: 'card', card: 'wedding', player: 1, stage: 'give', pending: { 0: 2 }, resume: { kind: 'main' } };
  await openSave(page, ckRecord(s));
  const sheet = page.locator('.sheet[aria-label="Give Ada 2 cards"]');
  await expect(sheet).toBeVisible();
  await expect(page.locator('.status-text')).toContainText('Wedding: give Ada 2 cards');
  await expect(sheet.locator('.pick-lead').first()).toContainText('Ada played a Wedding');
  await sheet.getByRole('button', { name: 'Give one more Brick' }).click();
  await sheet.getByRole('button', { name: 'Give one more Paper' }).click();
  await expect(sheet.locator('.tsum')).toHaveText('You give 1 brick and 1 paper');
  await sheet.getByRole('button', { name: 'Give 2 cards' }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => gameLog(page)).toContain('Sam gives Ada 2 cards');
  await expect.poll(() => gameLog(page)).toContain('(1 brick, 1 paper)');
  await expect(page.locator('.panel .hand .rtile.r-brick .rtile-n')).toHaveText(String(before.brick - 1));
  await expect(page.locator('.panel .hand .rtile.r-paper .rtile-n')).toHaveText(String(before.paper - 1));
  expect(errors).toEqual([]);
});

test('a Deserter played on you: pick the knight you remove on the board (crafted save)', async ({ page }) => {
  const s = ckAfterSetup('ck-cards');
  s.turn.current = 1;
  s.turn.actor = 1;
  s.turn.dice = [2, 3];
  const [a, b] = knightSpots(s, 0);
  placeKnight(s, 0, a, 1, true);
  placeKnight(s, 0, b, 2, false);
  s.phase = { kind: 'ck', step: 'card', card: 'deserter', player: 1, stage: 'desert', target: 0, pending: { 0: 1 }, resume: { kind: 'main' } };
  await openSave(page, ckRecord(s));
  await expect(page.locator('.status-text')).toContainText('Deserter: remove one of your knights');
  await expect(page.locator('.forced-hint')).toContainText('the knight you remove');
  await expect(page.locator('[data-pick^="v:"]')).toHaveCount(2);
  await page.locator(`[data-pick="v:${b}"]`).click();
  await expect(page.locator('.confirm-bar')).toContainText('Remove this knight?');
  await yes(page).click();
  await expect.poll(() => gameLog(page)).toContain('Sam removes a strong knight');
  await expect(page.locator(`svg.board [data-knight="${b}"]`)).toHaveCount(0);
});

test('a Commercial Harbor offer: give a commodity of your choice (crafted save)', async ({ page }) => {
  const s = ckAfterSetup('ck-cards');
  s.turn.current = 1;
  s.turn.actor = 1;
  s.turn.dice = [2, 3];
  giveCards(s, 0, { cloth: 1, coin: 2 });
  giveCards(s, 1, { ore: 1 });
  s.ck!.turnEffects.push({ player: 1, effect: 'commercialHarbor', data: { offered: [0] } });
  s.phase = { kind: 'ck', step: 'card', card: 'commercialHarbor', player: 1, stage: 'exchange', target: 0, pending: { 0: 1 }, data: { resource: 'ore' }, resume: { kind: 'main' } };
  await openSave(page, ckRecord(s));
  const sheet = page.locator('.sheet[aria-label="Give Ada a commodity"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Give Paper' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Give Coin' }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => gameLog(page)).toContain('Ada trades a resource to Sam for a commodity');
  await expect(page.locator('.panel .hand .rtile.r-coin .rtile-n')).toHaveText('1');
});

test('online: a friend sees their own commodities, and only card counts for the others', async ({ browser }) => {
  const room = 'CKNTS';
  const s = ckAfterSetup('ck-online');
  s.players[1].name = 'Friend';
  giveCards(s, 1, { paper: 2, cloth: 1, brick: 1 });
  giveCards(s, 2, { coin: 3 });
  const record = ckRecord(s, {
    mode: 'host',
    room,
    id: 'ck-room',
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

  // the friend's own hand: resources and commodities
  const tile = (r: string) => guest.locator(`.panel .hand .rtile.r-${r} .rtile-n`);
  await expect(tile('paper')).toHaveText('2');
  await expect(tile('cloth')).toHaveText('1');
  await expect(tile('coin')).toHaveText('0');
  await expect(guest.locator('.ck-track')).toBeVisible();
  await expect(guest.locator('.hud .sub')).toContainText('Cities & Knights');
  // Björn's three coins are only a count: his chip shows his hand size, never what is in it
  const bjorn = s.players[2].resources;
  const bjornCards = bjorn.brick + bjorn.lumber + bjorn.wool + bjorn.grain + bjorn.ore + 3;
  await expect(guest.locator('.player', { hasText: 'Björn' })).toContainText(String(bjornCards));
  await expect(guest.locator('.player', { hasText: 'Björn' })).toHaveAttribute('aria-label', new RegExp(`${bjornCards} cards, 0 progress cards`));
  // the host sees the friend's hand as a count too
  const friendCards = s.players[1].resources.brick + s.players[1].resources.lumber + s.players[1].resources.wool + s.players[1].resources.grain + s.players[1].resources.ore + 3;
  await expect(host.locator('.player', { hasText: 'Friend' })).toHaveAttribute('aria-label', new RegExp(`${friendCards} cards`));
  await hostCtx.close();
  await guestCtx.close();
});
