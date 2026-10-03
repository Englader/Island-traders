import { describe, expect, it } from 'vitest';
import { CUES, DEFAULT_PREFS, QUIET, SoundEngine, masterGain, sound, type SoundDeps, type SoundPrefs } from '../web/src/game/sound.js';

/*
 * The sound engine against a stand-in AudioContext that only counts what it
 * is asked to make: whether anything plays, how loud, and how often.
 */

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
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class Node {
  outs: Node[] = [];
  connect(n: Node) {
    this.outs.push(n);
    return n;
  }
  disconnect() {
    this.outs = [];
  }
}

class FakeContext {
  static made: FakeContext[] = [];
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new Node();
  /** How many nodes of each kind were made, and how many sources started. */
  made: Record<string, number> = {};
  started = 0;
  gains: Array<Node & { gain: Param }> = [];
  constructor() {
    FakeContext.made.push(this);
  }
  private count(kind: string) {
    this.made[kind] = (this.made[kind] ?? 0) + 1;
  }
  get nodes() {
    return Object.values(this.made).reduce((a, b) => a + b, 0);
  }
  createGain() {
    this.count('gain');
    const n = Object.assign(new Node(), { gain: new Param(1) });
    this.gains.push(n);
    return n;
  }
  createOscillator() {
    this.count('oscillator');
    return Object.assign(new Node(), {
      type: 'sine',
      frequency: new Param(440),
      detune: new Param(0),
      start: () => this.started++,
      stop: () => undefined,
    });
  }
  createBufferSource() {
    this.count('source');
    return Object.assign(new Node(), { buffer: null as unknown, start: () => this.started++, stop: () => undefined });
  }
  createBiquadFilter() {
    this.count('filter');
    return Object.assign(new Node(), { type: 'lowpass', frequency: new Param(350), Q: new Param(1) });
  }
  createDynamicsCompressor() {
    this.count('compressor');
    return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

/** An engine with the stand-in context, a hand-moved clock and settings kept in a variable. */
function setup(stored: unknown = null, extra: Partial<SoundDeps> = {}) {
  let t = 10_000;
  const saved: SoundPrefs[] = [];
  const buzzes: Array<number | number[]> = [];
  const played: string[] = [];
  const engine = new SoundEngine({
    audio: () => FakeContext as unknown as new () => AudioContext,
    now: () => t,
    load: () => stored,
    save: (p) => saved.push(p),
    vibrate: (p) => buzzes.push(p),
    touch: () => true,
    played: (cue) => played.push(cue),
    ...extra,
  });
  return {
    engine,
    saved,
    buzzes,
    played,
    tick: (ms: number) => (t += ms),
    /** The context the engine made (after unlock). */
    ctx: () => FakeContext.made[FakeContext.made.length - 1],
  };
}

/** The master gain: the first gain node the context made. */
const master = (ctx: FakeContext) => ctx.gains[0].gain.value;

describe('sound: on, off and the volume', () => {
  it('is on at a moderate volume until told otherwise', () => {
    const { engine } = setup();
    expect(engine.on).toBe(true);
    expect(engine.volume).toBe(DEFAULT_PREFS.volume);
    expect(DEFAULT_PREFS.volume).toBeGreaterThan(0.3);
    expect(DEFAULT_PREFS.volume).toBeLessThan(0.8);
  });

  it('starts the audio only with a tap: nothing plays before', () => {
    const before = FakeContext.made.length;
    const { engine, ctx } = setup();
    expect(engine.play('road')).toBeNull();
    expect(FakeContext.made.length).toBe(before);
    engine.unlock();
    expect(FakeContext.made.length).toBe(before + 1);
    // a second tap reuses the same context
    engine.unlock();
    expect(FakeContext.made.length).toBe(before + 1);
    const v = engine.play('road');
    expect(v?.cue).toBe('road');
    expect(ctx().started).toBeGreaterThan(1);
  });

  it('muting stops all output: the master gain goes to 0 and nothing new is made', () => {
    const { engine, ctx, saved, played } = setup();
    engine.unlock();
    expect(engine.play('settlement')).not.toBeNull();
    const c = ctx();
    expect(master(c)).toBeCloseTo(masterGain(DEFAULT_PREFS.volume));
    engine.setOn(false);
    expect(master(c)).toBe(0);
    const nodes = c.nodes;
    const started = c.started;
    for (const cue of CUES) expect(engine.play(cue)).toBeNull();
    expect(c.nodes).toBe(nodes);
    expect(c.started).toBe(started);
    expect(played).toEqual(['settlement']);
    expect(saved[saved.length - 1]).toEqual({ on: false, volume: DEFAULT_PREFS.volume });
    // and back on: the volume as it was
    engine.toggle();
    expect(master(c)).toBeCloseTo(masterGain(DEFAULT_PREFS.volume));
    expect(engine.play('city')).not.toBeNull();
  });

  it('with sound off, a tap does not even start the audio', () => {
    const before = FakeContext.made.length;
    const { engine } = setup({ on: false, volume: 0.5 });
    expect(engine.on).toBe(false);
    engine.unlock();
    expect(FakeContext.made.length).toBe(before);
    expect(engine.play('yourTurn')).toBeNull();
  });

  it('the volume sets the master gain (and is kept)', () => {
    const { engine, ctx, saved } = setup();
    engine.unlock();
    engine.setVolume(0.5);
    expect(master(ctx())).toBeCloseTo(masterGain(0.5));
    engine.setVolume(1);
    expect(master(ctx())).toBeCloseTo(masterGain(1));
    expect(masterGain(1)).toBeGreaterThan(masterGain(0.5));
    expect(saved[saved.length - 1]).toEqual({ on: true, volume: 1 });
    // out of range is clamped; nonsense is ignored
    engine.setVolume(7);
    expect(engine.volume).toBe(1);
    engine.setVolume(Number.NaN);
    expect(engine.volume).toBe(1);
    // at 0 nothing plays
    engine.setVolume(0);
    expect(master(ctx())).toBe(0);
    expect(engine.play('road')).toBeNull();
  });

  it("other players' moves play softer", () => {
    const { engine, ctx } = setup();
    engine.unlock();
    // each sound goes through a gain of its own: the first gain made for it
    const bus = (play: () => void) => {
      const count = ctx().gains.length;
      play();
      return ctx().gains[count].gain.value;
    };
    expect(bus(() => engine.play('city'))).toBe(1);
    expect(bus(() => engine.play('settlement', { quiet: true }))).toBeCloseTo(QUIET);
  });

  it('reads the stored settings, and falls back on the defaults for anything odd', () => {
    expect(setup({ on: false, volume: 0.25 }).engine.settings).toEqual({ on: false, volume: 0.25 });
    expect(setup({ on: 'yes', volume: 'loud' }).engine.settings).toEqual(DEFAULT_PREFS);
    expect(setup({ volume: 3 }).engine.settings).toEqual({ on: true, volume: 1 });
    expect(setup('garbage').engine.settings).toEqual(DEFAULT_PREFS);
  });

  it('tells subscribers about every change', () => {
    const { engine } = setup();
    let n = 0;
    const off = engine.subscribe(() => n++);
    engine.toggle();
    engine.setVolume(0.3);
    off();
    engine.toggle();
    expect(n).toBe(2);
  });

  it('a stopped sound fades out (a skipped dice roll)', () => {
    const { engine, ctx } = setup();
    engine.unlock();
    const count = ctx().gains.length;
    const v = engine.play('roll', { duration: 1, dice: 2 })!;
    const bus = ctx().gains[count];
    expect(bus.gain.value).toBeGreaterThan(0);
    v.stop();
    expect(bus.gain.value).toBe(0);
  });

  it('every sound can be made', () => {
    const { engine, ctx, tick } = setup();
    engine.unlock();
    for (const cue of CUES) {
      tick(5000);
      const before = ctx().nodes;
      expect(engine.play(cue), cue).not.toBeNull();
      expect(ctx().nodes, cue).toBeGreaterThan(before + 1);
    }
  });

  it('the dice rattle as long as they tumble, more with three dice', () => {
    const { engine, ctx, tick } = setup();
    engine.unlock();
    const starts = (o: { duration: number; dice?: number }) => {
      tick(5000);
      const s = ctx().started;
      engine.play('roll', o);
      return ctx().started - s;
    };
    const short = starts({ duration: 0.55 });
    const long = starts({ duration: 1.15 });
    expect(long).toBeGreaterThan(short);
    expect(starts({ duration: 1.15, dice: 3 })).toBeGreaterThan(long * 0.9);
  });

  it('buzzes on your turn, on touch screens, only with sound on', () => {
    const a = setup();
    a.engine.unlock();
    a.engine.play('yourTurn');
    expect(a.buzzes).toHaveLength(1);
    a.engine.play('road');
    expect(a.buzzes).toHaveLength(1);
    const off = setup({ on: false, volume: 0.6 });
    off.engine.play('yourTurn');
    expect(off.buzzes).toHaveLength(0);
    const desk = setup(null, { touch: () => false });
    desk.engine.play('yourTurn');
    expect(desk.buzzes).toHaveLength(0);
  });
});

describe('sound: a burst of moves never turns into noise', () => {
  it('the same sound again at once is dropped, and plays again a moment later', () => {
    const { engine, tick } = setup();
    engine.unlock();
    expect(engine.play('road')).not.toBeNull();
    expect(engine.play('road')).toBeNull();
    tick(40);
    expect(engine.play('road')).toBeNull();
    tick(100);
    expect(engine.play('road')).not.toBeNull();
    // "your turn" waits longer before it repeats
    expect(engine.play('yourTurn')).not.toBeNull();
    tick(600);
    expect(engine.play('yourTurn')).toBeNull();
    tick(1000);
    expect(engine.play('yourTurn')).not.toBeNull();
  });

  it('at most four sounds start at once; important ones always get through', () => {
    const { engine, tick } = setup();
    engine.unlock();
    const many = ['road', 'ship', 'settlement', 'city', 'knight', 'wall', 'cardDraw'] as const;
    const got = many.map((c) => engine.play(c) !== null);
    expect(got.filter(Boolean)).toHaveLength(4);
    expect(got.slice(0, 4)).toEqual([true, true, true, true]);
    // the 7, your turn and stolen cards are never dropped
    expect(engine.play('seven')).not.toBeNull();
    expect(engine.play('yourTurn')).not.toBeNull();
    expect(engine.play('stolen')).not.toBeNull();
    // once the burst has passed, the rest play again
    tick(700);
    expect(engine.play('wall')).not.toBeNull();
  });

  it("other players' quick moves: one sound at a time", () => {
    const { engine, tick } = setup();
    engine.unlock();
    expect(engine.play('road', { quiet: true })).not.toBeNull();
    tick(100);
    expect(engine.play('settlement', { quiet: true })).toBeNull();
    // your own move still sounds
    expect(engine.play('city')).not.toBeNull();
    tick(200);
    expect(engine.play('settlement', { quiet: true })).not.toBeNull();
  });

  it('a hundred computer moves in a row make only a handful of sounds', () => {
    const { engine, played, tick } = setup();
    engine.unlock();
    const cues = ['road', 'settlement', 'knight', 'cardDraw', 'ship'] as const;
    for (let i = 0; i < 100; i++) {
      engine.play(cues[i % cues.length], { quiet: true });
      tick(20);
    }
    // two seconds of moves: about one sound per QUIET_GAP
    expect(played.length).toBeGreaterThan(3);
    expect(played.length).toBeLessThanOrEqual(9);
  });
});

describe('sound: never fails, whatever the browser', () => {
  it('without Web Audio: silent, no errors', () => {
    const { engine } = setup(null, { audio: () => undefined });
    expect(() => engine.unlock()).not.toThrow();
    for (const cue of CUES) expect(engine.play(cue)).toBeNull();
    expect(() => engine.toggle()).not.toThrow();
    expect(() => engine.setVolume(0.2)).not.toThrow();
  });

  it('an AudioContext that cannot be made, or breaks while playing', () => {
    const throwing = setup(null, {
      audio: () =>
        class {
          constructor() {
            throw new Error('too many AudioContexts');
          }
        } as unknown as new () => AudioContext,
    });
    expect(() => throwing.engine.unlock()).not.toThrow();
    expect(throwing.engine.play('city')).toBeNull();

    const { engine, ctx } = setup();
    engine.unlock();
    ctx().createOscillator = () => {
      throw new Error('no oscillators today');
    };
    expect(() => engine.play('yourTurn')).not.toThrow();
    expect(engine.play('victory')).toBeNull();
  });

  it('storage that throws: the settings last for this visit', () => {
    const { engine } = setup(null, {
      load: () => {
        throw new Error('blocked');
      },
      save: () => {
        throw new Error('blocked');
      },
    });
    expect(engine.on).toBe(true);
    expect(() => engine.setOn(false)).not.toThrow();
    expect(engine.on).toBe(false);
  });

  it('a context still asleep (no tap yet allowed it) plays nothing later in a heap', () => {
    const { engine, ctx, tick } = setup();
    engine.unlock();
    const c = ctx();
    c.state = 'suspended';
    c.resume = () => Promise.resolve();
    // just started: sounds are scheduled (it is about to run)
    expect(engine.play('road')).not.toBeNull();
    tick(3000);
    // long asleep: dropped
    expect(engine.play('city')).toBeNull();
  });

  it('the shared engine in a place without audio (this test run) is silent', () => {
    expect(() => sound.unlock()).not.toThrow();
    expect(sound.play('roll', { duration: 1 })).toBeNull();
  });
});
