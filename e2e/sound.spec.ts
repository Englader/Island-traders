import { expect, test, type Locator, type Page } from '@playwright/test';
import { SAVE_KEY, ckAfterSetup, ckMain, ckRecord } from './ckState.js';
import { sevenGame } from './discardState.js';
import { tradeGame } from './tradeState.js';

/** Where the sound settings are kept (web/src/game/sound.ts, storage.ts). */
const SOUND_KEY = 'island-traders:v1:ui:sound';

/**
 * Stands in for the browser's AudioContext: it makes nothing audible, only
 * counts the contexts, nodes and started sounds. The game also announces each
 * sound it plays (the "island-traders:sound" event), collected in __cues.
 */
function stubAudio() {
  const w = window as unknown as Record<string, unknown>;
  const log = { contexts: 0, nodes: 0, started: 0 };
  const cues: string[] = [];
  w.__audio = log;
  w.__cues = cues;
  window.addEventListener('island-traders:sound', (e) => cues.push((e as CustomEvent<{ cue: string }>).detail.cue));
  class Param {
    constructor(public value = 0) {}
    setValueAtTime(v: number) {
      this.value = v;
      return this;
    }
    linearRampToValueAtTime(v: number) {
      this.value = v;
      return this;
    }
    exponentialRampToValueAtTime() {
      return this;
    }
    setTargetAtTime() {
      return this;
    }
    cancelScheduledValues() {
      return this;
    }
  }
  const node = (extra: Record<string, unknown> = {}) => {
    log.nodes++;
    return { connect: (n: unknown) => n, disconnect: () => undefined, ...extra };
  };
  const source = (extra: Record<string, unknown>) => node({ start: () => log.started++, stop: () => undefined, ...extra });
  class FakeAudioContext {
    state = 'running';
    sampleRate = 8000;
    destination = { connect: () => undefined };
    private t0 = performance.now();
    constructor() {
      log.contexts++;
    }
    get currentTime() {
      return (performance.now() - this.t0) / 1000;
    }
    resume() {
      return Promise.resolve();
    }
    createGain() {
      return node({ gain: new Param(1) });
    }
    createOscillator() {
      return source({ type: 'sine', frequency: new Param(440), detune: new Param(0) });
    }
    createBufferSource() {
      return source({ buffer: null });
    }
    createBiquadFilter() {
      return node({ type: 'lowpass', frequency: new Param(350), Q: new Param(1) });
    }
    createDynamicsCompressor() {
      return node({ threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
    }
    createBuffer(_c: number, length: number, rate: number) {
      return { duration: length / rate, getChannelData: () => new Float32Array(length) };
    }
  }
  w.AudioContext = FakeAudioContext;
  w.webkitAudioContext = FakeAudioContext;
}

const audio = (page: Page) => page.evaluate(() => (window as unknown as { __audio: { contexts: number; nodes: number; started: number } }).__audio);
const heard = (page: Page) => page.evaluate(() => [...(window as unknown as { __cues: string[] }).__cues]);

async function openSave(page: Page, record: unknown, sound?: { on: boolean; volume: number }): Promise<void> {
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(record)] as const);
  if (sound) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SOUND_KEY, JSON.stringify(sound)] as const);
  await page.goto('/');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('svg.board')).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The mute button sits in the header, clear of the dice, the barbarian track, the status and the timer. */
async function clearOfTheRest(page: Page, button: Locator): Promise<void> {
  const box = (await button.boundingBox())!;
  const hud = (await page.locator('.hud').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(34);
  expect(box.height).toBeGreaterThanOrEqual(40);
  expect(box.y).toBeGreaterThanOrEqual(hud.y);
  expect(box.y + box.height).toBeLessThanOrEqual(hud.y + hud.height);
  for (const sel of ['.hud .dice', '.hud .ck-track', '.hud .status-text', '.hud-clock', '.hud > .icon-btn[aria-label="Menu"]']) {
    const loc = page.locator(sel);
    if ((await loc.count()) === 0) continue;
    expect(overlaps(box, (await loc.boundingBox())!), sel).toBe(false);
  }
}

/** Sam plays out the 7 (moves the robber), ends the turn and waits for the next one. */
async function playARound(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Roll/ }).first().click();
  await expect(page.locator('.status-text')).toHaveText(/Move the robber/, { timeout: 15_000 });
  const hexes = page.locator('[data-pick^="h:"]');
  for (let i = 0; i < (await hexes.count()); i++) {
    try {
      await hexes.nth(i).click({ timeout: 1500 });
      break;
    } catch {
      // covered: the next one
    }
  }
  await page.locator('.confirm-bar button.primary').first().click();
  await page.getByRole('button', { name: /End turn/ }).first().click();
  const roll = page.getByRole('button', { name: /Roll/ }).first();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !(await roll.isVisible())) {
    const offer = page.locator('.sheet[aria-label="Trade offer"]');
    if (await offer.isVisible()) await offer.getByRole('button', { name: 'No thanks' }).first().click();
    else await page.waitForTimeout(200);
  }
  await expect(roll).toBeVisible();
}

test('the mute button: in the header, a real toggle, remembered after a reload and shared with the menu and the home screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(stubAudio);
  // Cities & Knights: the busiest header (three dice and the barbarian track)
  await openSave(page, ckRecord(ckMain(ckAfterSetup('sound-ui'))));
  const button = page.locator('.hud').getByRole('button', { name: 'Mute sounds' });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toHaveAttribute('title', 'Mute sounds');
  await clearOfTheRest(page, button);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(button).toHaveAttribute('title', 'Unmute sounds');
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), SOUND_KEY)).toMatchObject({ on: false });

  // after a reload: still muted, on the home screen too
  await page.reload();
  const home = page.getByRole('button', { name: 'Mute sounds' });
  await expect(home).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');

  // the menu's Sound section follows, and switches it back on
  await page.getByRole('button', { name: 'Menu' }).click();
  const sw = page.getByRole('switch', { name: 'Sound' });
  const volume = page.getByRole('slider', { name: 'Volume' });
  await expect(sw).not.toBeChecked();
  await expect(volume).toBeDisabled();
  await sw.click();
  await expect(sw).toBeChecked();
  await expect(volume).toBeEnabled();
  await expect(volume).toHaveValue('60');
  await volume.fill('30');
  await expect(page.locator('.volume-pct')).toHaveText('30%');
  await page.getByRole('button', { name: 'Back to the game' }).click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), SOUND_KEY)).toEqual({ on: true, volume: 0.3 });
  await page.reload();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('30');
  expect(errors).toEqual([]);
});

test('the new-game screen has the same button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New game/ }).click();
  const button = page.locator('.setup-head').getByRole('button', { name: 'Mute sounds' });
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Mute sounds' })).toHaveAttribute('aria-pressed', 'true');
});

for (const on of [true, false]) {
  test(on ? 'with sound on, a roll plays the dice and the 7, and the game plays on' : 'muted, no audio is even started, and the game plays the same', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(stubAudio);
    // Sam is about to roll a 7, with one card (nobody discards)
    await openSave(page, sevenGame({ brick: 1 }), on ? undefined : { on: false, volume: 0.6 });
    await playARound(page);
    const cues = await heard(page);
    const a = await audio(page);
    if (on) {
      expect(cues.slice(0, 2)).toEqual(['roll', 'seven']);
      expect(cues).toContain('robber');
      // the computer players' moves, then a chime as Sam's turn comes round
      expect(cues).toContain('yourTurn');
      expect(a.contexts).toBe(1);
      expect(a.started).toBeGreaterThan(20);
    } else {
      expect(cues).toEqual([]);
      expect(a).toEqual({ contexts: 0, nodes: 0, started: 0 });
    }
    expect(errors).toEqual([]);
  });
}

test.describe('wide screens', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('M switches the sound off and on; the button says so', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(stubAudio);
    await openSave(page, ckRecord(ckMain(ckAfterSetup('sound-ui'))));
    const button = page.locator('.hud').getByRole('button', { name: 'Mute sounds' });
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'M');
    await expect(button).toHaveAttribute('title', 'Mute sounds (M)');
    await clearOfTheRest(page, button);
    await page.keyboard.press('m');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    // also with a sheet open
    await page.keyboard.press('t');
    await expect(page.locator('.sheet')).toBeVisible();
    await page.keyboard.press('m');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    // switching it on says so with a tick
    expect(await heard(page)).toEqual(['click']);
    expect(errors).toEqual([]);
  });

  test('a base game: the button sits beside the menu, clear of the dice', async ({ page }) => {
    await openSave(page, tradeGame().record);
    const button = page.locator('.hud').getByRole('button', { name: 'Mute sounds' });
    await clearOfTheRest(page, button);
    const menu = (await page.getByRole('button', { name: 'Menu' }).boundingBox())!;
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThan(menu.x);
    expect(box.x - (menu.x + menu.width)).toBeLessThan(12);
  });
});
