import { expect, test, type Page } from '@playwright/test';
import { applyAction, createGame, heuristicAction, legalActions, playersToAct, topo, type GameState } from '../src/index.js';
import { SAVE_KEY, ckRecord, giveCards } from './ckState.js';

/**
 * Cities & Knights on a Seafarers scenario (docs/cities-and-knights.md,
 * section 16): the new-game screen, then a crafted game of Heading for New
 * Shores in which Sam builds a ship and a knight and the barbarians' first
 * attack brings the robber and the pirate onto the board.
 */

const NAMES = ['Sam', 'Ada', 'Björn'];

/** The yes button: of the "Ask before building" dialog, or of the confirm bar. */
const yes = (page: Page) => page.locator('.confirm-dialog button.primary, .confirm-bar button.primary').first();

async function gameLog(page: Page): Promise<string[]> {
  return page.evaluate((k) => {
    const rec = JSON.parse(localStorage.getItem(k) ?? 'null') as { state: { log: Array<{ msg: string }> } } | null;
    return rec ? rec.state.log.map((e) => e.msg) : [];
  }, SAVE_KEY);
}

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
 * New Shores with C&K after the set-up: Sam about to roll, the barbarian ship
 * one space from landing, the dice loaded for a ship on the event die, and the
 * cards for a ship and a knight. The seed is chosen so the roll leaves Sam in
 * his main phase with a ship and a knight to build.
 */
function beforeTheAttack(): GameState {
  for (let n = 0; n < 40; n++) {
    const s = playUntil(
      createGame({ scenario: 'seafarers-1-new-shores', players: NAMES, seed: `e2e-ck-sea-${n}`, options: { firstPlayer: 0, citiesAndKnights: true } }),
      (x) => x.phase.kind === 'preRoll' && x.turn.actor === 0,
    );
    s.ck!.barbarians = 6;
    giveCards(s, 0, { lumber: 1, wool: 2, ore: 1 });
    for (let i = 0; i < 3000; i++, s.rng.s++) {
      const r = applyAction(s, { type: 'rollDice', player: 0 });
      if (!r.ok || r.state.ck!.event !== 'ship' || r.state.phase.kind !== 'main') continue;
      const acts = legalActions(r.state, 0);
      if (acts.some((a) => a.type === 'buildShip') && acts.some((a) => a.type === 'buildKnight')) return s;
      break;
    }
  }
  throw new Error('no suitable game');
}

test('Cities & Knights on the new-game screen: New Shores to 16 VP, The Four Islands refused with the reason', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  await page.getByRole('button', { name: /The Four Islands/ }).click();
  const blocked = page.locator('.ck-toggle.blocked');
  await expect(blocked).toContainText("The rulebook doesn't combine Cities & Knights with this scenario");
  await expect(page.getByRole('switch', { name: 'Play with Cities & Knights' })).toBeDisabled();

  await page.getByRole('button', { name: /Heading for New Shores/ }).click();
  const sw = page.getByRole('switch', { name: 'Play with Cities & Knights' });
  await expect(sw).toBeEnabled();
  await sw.click();
  await expect(sw).toBeChecked();
  await expect(page.locator('.ck-toggle')).toContainText('16 VP (the scenario’s 14 + 2)');
  await expect(page.locator('.map-note')).toContainText('the robber and the pirate wait by the barbarian track');
  await page.getByRole('button', { name: 'less' }).first().click();
  await page.getByRole('button', { name: /Options/ }).click();
  await page.getByRole('button', { name: 'fast' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(page.locator('.hud .sub')).toContainText('Heading for New Shores + C&K');
  await expect(page.locator('.hud .sub')).toContainText('16 VP');
  // the robber and the pirate wait on the track's last space, not on the board
  await expect(page.locator('.ck-track .bt-wait')).toHaveAttribute('data-waiting', 'robber pirate');
  await expect(page.locator('svg.board g.robber')).toHaveCount(0);
  await expect(page.locator('svg.board g.pirate')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a ship, a knight and the first barbarian attack: the robber and the pirate come on the board (crafted save)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = beforeTheAttack();
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(ckRecord(s))] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
  await expect(page.locator('.ck-track')).toHaveAttribute('data-pos', '6');
  await expect(page.locator('.ck-track .bt-wait')).toBeVisible();

  // the barbarian roll: the ship lands
  await page.locator('.action-bar').getByRole('button', { name: /Roll/ }).click();
  await expect(page.locator('.roll-event')).toContainText('The barbarians attack!');
  const fx = page.locator('.fx-attack');
  await expect(fx).toBeVisible({ timeout: 15_000 });
  await fx.click();
  await expect.poll(() => gameLog(page)).toContain(
    'The barbarians return home; the robber and the pirate take their places on the board and can be moved from now on',
  );
  await expect(page.locator('.ck-track')).toHaveAttribute('data-pos', '0');
  await expect(page.locator('.ck-track .bt-wait')).toHaveCount(0);
  await expect(page.locator('svg.board g.robber')).toHaveCount(1);
  await expect(page.locator('svg.board g.pirate')).toHaveCount(1);

  // a ship: Build → Ship, a sea path, yes
  await page.locator('.action-bar').getByRole('button', { name: 'Build' }).click();
  await page.getByRole('button', { name: /^Ship/ }).click();
  await page.locator('[data-pick^="e:"]').first().click();
  await expect(page.locator('.confirm-dialog, .confirm-bar')).toContainText('Build a ship here?');
  await yes(page).click();
  await expect.poll(() => gameLog(page)).toContain('Sam builds a ship');

  // a knight: Build → Knight (basic), a spot by a road or ship, yes
  await page.locator('.action-bar').getByRole('button', { name: 'Build' }).click();
  await page.getByRole('button', { name: /Knight \(basic\)/ }).click();
  await page.locator('[data-pick^="v:"]').first().click();
  await expect(page.locator('.confirm-dialog')).toContainText('Hire a basic knight here?');
  await yes(page).click();
  await expect.poll(() => gameLog(page)).toContain('Sam hires a basic knight');
  await expect(page.locator('svg.board [data-knight][data-owner="0"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('a knight next to the pirate chases it once the barbarians have attacked (crafted save)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const s = playUntil(
    createGame({ scenario: 'seafarers-1-new-shores', players: NAMES, seed: 'e2e-ck-sea-chase', options: { firstPlayer: 0, citiesAndKnights: true } }),
    (x) => x.phase.kind === 'preRoll' && x.turn.actor === 0,
  );
  // after the first attack: the robber and pirate on their starting hexes
  const { robber, pirate } = s.ck!.asleep!;
  delete s.ck!.asleep;
  s.ck!.attacks = 1;
  s.board.robber = robber;
  s.board.pirate = pirate;
  s.phase = { kind: 'main' };
  s.turn.dice = [3, 5];
  s.ck!.event = 'politics';
  const at = topo(s).hexVertices[pirate!].find((v) => !s.board.buildings[v] && !s.ck!.knights[v])!;
  s.ck!.knights[at] = { owner: 0, level: 2, active: true, activatedPart: -1, promotedPart: -1 };
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(ckRecord(s))] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board g.pirate')).toHaveCount(1);

  await page.locator('.action-bar').getByRole('button', { name: 'Knights' }).click();
  await page.locator(`[data-pick="v:${at}"]`).click();
  const bar = page.locator('.knight-bar');
  await expect(bar).toContainText('Strong knight');
  await bar.getByRole('button', { name: 'Chase pirate' }).click();
  await expect(page.locator('.confirm-dialog')).toContainText('Chase the pirate away?');
  await yes(page).click();
  await expect.poll(() => gameLog(page)).toContain('Sam\'s knight chases away the pirate');
  await expect(page.locator('.status-text')).toContainText('Chase the pirate to another sea hex');
  // only sea hexes are offered
  const hexes = page.locator('[data-pick^="h:"]');
  await expect(hexes.first()).toBeVisible();
  const picks = await hexes.evaluateAll((els) => els.map((e) => e.getAttribute('data-pick')!.slice(2)));
  for (const h of picks) expect(s.board.hexes[h].terrain).toBe('sea');
  await hexes.first().click();
  await yes(page).click();
  await expect.poll(() => gameLog(page)).toContain('Sam moves the pirate');
  expect(errors).toEqual([]);
});
