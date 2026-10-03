import { loadJson, saveJson } from './storage';

/*
 * The game's sounds, made on the spot with the Web Audio API: oscillators,
 * a little noise and envelopes, no audio files (nothing to download, license
 * or cache). The audio is started by the player's first tap or key press, as
 * browsers require; until then, and wherever audio is missing or fails,
 * playing a sound quietly does nothing. A master volume and an on/off switch
 * apply to everything, and a burst of moves (computer players on fast) is
 * thinned out so it never turns into noise.
 */

/** Every sound the game makes. */
export type Cue =
  | 'roll'
  | 'seven'
  | 'yourTurn'
  | 'nudge'
  | 'road'
  | 'ship'
  | 'settlement'
  | 'city'
  | 'knight'
  | 'wall'
  | 'improve'
  | 'metropolis'
  | 'tradeOffer'
  | 'tradeDone'
  | 'tradeDeclined'
  | 'cardDraw'
  | 'cardPlay'
  | 'robber'
  | 'stolen'
  | 'barbarianShip'
  | 'attack'
  | 'attackWon'
  | 'attackLost'
  | 'chat'
  | 'victory'
  | 'defeat'
  | 'click';

export interface PlayOptions {
  /** Another player's move: played softer, and dropped first when moves come fast. */
  quiet?: boolean;
  /** Seconds from now. */
  delay?: number;
  /** The dice roll: how long the dice tumble, in seconds. */
  duration?: number;
  /** The dice roll: how many dice (3 with the Cities & Knights event die). */
  dice?: number;
}

/** A sound that has started; stop() fades it out (a skipped dice roll). */
export interface Voice {
  cue: Cue;
  stop(): void;
}

export interface SoundPrefs {
  on: boolean;
  /** 0 to 1. */
  volume: number;
}

/** Sound is on at a moderate volume until the player says otherwise. */
export const DEFAULT_PREFS: SoundPrefs = { on: true, volume: 0.6 };
const PREF_KEY = 'ui:sound';

/** Another player's move, compared to your own. */
export const QUIET = 0.45;
/** The master gain at full volume (the sounds themselves are mixed well below it). */
const MAX_GAIN = 1.25;

/** The volume slider (0-1) as a gain: a square curve, so the low half of the slider stays usable. */
export function masterGain(volume: number): number {
  const v = Math.min(1, Math.max(0, volume));
  return MAX_GAIN * v * v;
}

// --- rate limiting ------------------------------------------------------------------------------

/** The same sound again within this many ms is dropped (default: DEFAULT_GAP). */
const GAP: Partial<Record<Cue, number>> = {
  roll: 250,
  seven: 800,
  yourTurn: 1500,
  nudge: 1200,
  chat: 1200,
  tradeOffer: 350,
  attack: 1500,
  victory: 4000,
  defeat: 4000,
};
const DEFAULT_GAP = 90;
/** At most MAX_BURST sounds start within BURST_MS; important ones always get through. */
const BURST_MS = 600;
const MAX_BURST = 4;
/** Other players' moves: at most one sound per QUIET_GAP ms. */
const QUIET_GAP = 240;
/** Sounds that always play (unless the very same one just played). */
const IMPORTANT = new Set<Cue>(['yourTurn', 'nudge', 'seven', 'stolen', 'attack', 'attackWon', 'attackLost', 'victory', 'defeat', 'tradeOffer']);

// --- the engine ---------------------------------------------------------------------------------

/** What the engine needs from the browser (tests pass stand-ins). */
export interface SoundDeps {
  /** The AudioContext class, looked up when the audio starts (none: no sound, nothing fails). */
  audio?: () => (new () => AudioContext) | null | undefined;
  /** A clock in ms, for the rate limits. */
  now?: () => number;
  load?: () => unknown;
  save?: (p: SoundPrefs) => void;
  /** A short buzz on phones (navigator.vibrate), where there is one. */
  vibrate?: (pattern: number | number[]) => void;
  /** A touch screen (only phones buzz). */
  touch?: () => boolean;
  /** Told about every sound that plays (the page announces it, for tests and curious tools). */
  played?: (cue: Cue, quiet: boolean) => void;
}

function readPrefs(raw: unknown): SoundPrefs {
  const p = raw as Partial<SoundPrefs> | null;
  if (!p || typeof p !== 'object') return { ...DEFAULT_PREFS };
  const volume = typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : DEFAULT_PREFS.volume;
  return { on: typeof p.on === 'boolean' ? p.on : DEFAULT_PREFS.on, volume };
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private broken = false;
  private startedAt = -Infinity;
  private recent: Array<{ cue: Cue; at: number; quiet: boolean }> = [];
  private listeners = new Set<() => void>();
  private prefs: SoundPrefs | null = null;

  constructor(private deps: SoundDeps = {}) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private get p(): SoundPrefs {
    // read on first use (the storage may not be ready while modules load)
    if (!this.prefs) {
      let raw: unknown = null;
      try {
        raw = this.deps.load?.() ?? null;
      } catch {
        raw = null;
      }
      this.prefs = readPrefs(raw);
    }
    return this.prefs;
  }

  get on(): boolean {
    return this.p.on;
  }

  get volume(): number {
    return this.p.volume;
  }

  /** The settings as they are now (a new object after every change). */
  get settings(): SoundPrefs {
    return this.p;
  }

  /** Sound on or off. Turning it on (a tap) also starts the audio. */
  setOn(on: boolean): void {
    this.update({ ...this.p, on });
    if (on) this.unlock();
  }

  /** Flips the switch; returns whether sound is now on. */
  toggle(): boolean {
    this.setOn(!this.p.on);
    return this.p.on;
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.update({ ...this.p, volume: Math.min(1, Math.max(0, volume)) });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private update(next: SoundPrefs): void {
    this.prefs = next;
    try {
      this.deps.save?.(next);
    } catch {
      // kept for this visit only
    }
    this.applyGain();
    for (const fn of this.listeners) fn();
  }

  /** The master gain follows the switch and the slider (a short ramp: no click). */
  private applyGain(): void {
    const ctx = this.ctx;
    const m = this.master;
    if (!ctx || !m) return;
    try {
      const target = this.p.on ? masterGain(this.p.volume) : 0;
      const t = ctx.currentTime;
      m.gain.cancelScheduledValues(t);
      m.gain.setValueAtTime(m.gain.value, t);
      m.gain.linearRampToValueAtTime(target, t + 0.03);
    } catch {
      // ignore
    }
  }

  /**
   * Starts (or wakes) the audio. Call it from a tap or a key press: browsers
   * only let a page make sound after one. With sound off nothing is started.
   */
  unlock(): void {
    if (!this.p.on || this.broken) return;
    try {
      if (!this.ctx) {
        const Ctor = this.deps.audio?.();
        if (!Ctor) return;
        const ctx = new Ctor();
        const master = ctx.createGain();
        master.gain.value = masterGain(this.p.volume);
        // a gentle limiter: several sounds at once never clip
        const limit = ctx.createDynamicsCompressor();
        limit.threshold.value = -12;
        limit.knee.value = 10;
        limit.ratio.value = 4;
        limit.attack.value = 0.003;
        limit.release.value = 0.2;
        master.connect(limit);
        limit.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.startedAt = this.now();
        // iPhones only open the audio once something plays inside the tap: a silent blip
        const blip = ctx.createBufferSource();
        blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
        blip.connect(ctx.destination);
        blip.start(0);
      }
      if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        this.startedAt = this.now();
        this.ctx.resume?.().catch(() => undefined);
      }
    } catch {
      // no audio here (or too many audio contexts): stay silent, never retry
      this.broken = true;
      this.ctx = null;
      this.master = null;
    }
  }

  /** Listens for the first taps and key presses (and later ones, to wake the audio after a phone call). */
  listen(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): () => void {
    const wake = () => this.unlock();
    const events = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
    for (const e of events) target.addEventListener(e, wake, { capture: true, passive: true });
    return () => {
      for (const e of events) target.removeEventListener(e, wake, { capture: true });
    };
  }

  /** Whether a sound may start now (see GAP, BURST_MS, QUIET_GAP); remembers it if so. */
  private allow(cue: Cue, quiet: boolean, now: number): boolean {
    this.recent = this.recent.filter((r) => now - r.at < 5000);
    if (this.recent.some((r) => r.cue === cue && now - r.at < (GAP[cue] ?? DEFAULT_GAP))) return false;
    if (!IMPORTANT.has(cue)) {
      const burst = this.recent.filter((r) => now - r.at < BURST_MS);
      if (burst.length >= MAX_BURST) return false;
      if (quiet && burst.some((r) => r.quiet && now - r.at < QUIET_GAP)) return false;
    }
    this.recent.push({ cue, at: now, quiet });
    return true;
  }

  /** Plays a sound; null when it doesn't (sound off, no audio yet, or too many at once). */
  play(cue: Cue, opts: PlayOptions = {}): Voice | null {
    if (!this.p.on || this.p.volume <= 0) return null;
    const quiet = !!opts.quiet;
    const now = this.now();
    const ctx = this.ctx;
    const master = this.master;
    let ready = !!ctx && !!master && ctx.state !== 'closed';
    // still asleep: wake it; sounds wait only for a moment (else they would all come at once later)
    if (ctx && ready && ctx.state !== 'running') {
      ctx.resume?.().catch(() => undefined);
      if (now - this.startedAt > 1500) ready = false;
    }
    // (a phone still buzzes for your turn without audio)
    if (!ready || !ctx || !master) {
      if (cue === 'yourTurn' && this.allow(cue, quiet, now)) this.buzz(30);
      return null;
    }
    if (!this.allow(cue, quiet, now)) return null;
    if (cue === 'yourTurn') this.buzz(30);
    try {
      const t = ctx.currentTime + 0.012 + Math.max(0, opts.delay ?? 0);
      const bus = ctx.createGain();
      bus.gain.value = (quiet ? QUIET : 1) * (LEVEL[cue] ?? 1);
      bus.connect(master);
      const end = RECIPES[cue](this.kit(ctx, bus), t, opts);
      // let go of the sound's nodes once it is over
      const ms = (end - ctx.currentTime) * 1000 + 400;
      setTimeout(() => {
        try {
          bus.disconnect();
        } catch {
          // ignore
        }
      }, ms);
      try {
        this.deps.played?.(cue, quiet);
      } catch {
        // ignore
      }
      return {
        cue,
        stop: () => {
          try {
            const now = ctx.currentTime;
            bus.gain.cancelScheduledValues(now);
            bus.gain.setValueAtTime(bus.gain.value, now);
            bus.gain.linearRampToValueAtTime(0, now + 0.06);
          } catch {
            // ignore
          }
        },
      };
    } catch {
      return null;
    }
  }

  /** A short buzz on phones that have it (part of the sound switch). */
  buzz(pattern: number | number[]): void {
    if (!this.p.on || !this.deps.vibrate) return;
    try {
      if (this.deps.touch?.() === false) return;
      this.deps.vibrate(pattern);
    } catch {
      // not allowed here
    }
  }

  private kit(ctx: AudioContext, out: AudioNode): Kit {
    if (!this.noiseBuf) {
      const rate = ctx.sampleRate || 44100;
      const buf = ctx.createBuffer(1, rate, rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return { ctx, out, noise: this.noiseBuf };
  }
}

// --- building blocks ------------------------------------------------------------------------

interface Kit {
  ctx: AudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

interface ToneOpts {
  /** Start time (s, audio clock). */
  t: number;
  /** Frequency, and where it glides to over the sound. */
  f: number;
  f2?: number;
  type?: OscillatorType;
  /** Peak gain. */
  g: number;
  /** Attack, hold and decay (s). */
  a?: number;
  h?: number;
  d: number;
  /** A low-pass filter (Hz) to soften it. */
  lp?: number;
  detune?: number;
}

/** An oscillator with an envelope; returns when it has died away. */
function tone(k: Kit, o: ToneOpts): number {
  const { ctx } = k;
  const a = o.a ?? 0.004;
  const h = o.h ?? 0;
  const end = o.t + a + h + o.d;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, o.t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, o.t + a + h + o.d * 0.7);
  if (o.detune) osc.detune.value = o.detune;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, o.t);
  env.gain.linearRampToValueAtTime(o.g, o.t + a);
  if (h > 0) env.gain.setValueAtTime(o.g, o.t + a + h);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  let last: AudioNode = osc;
  if (o.lp) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lp;
    osc.connect(lp);
    last = lp;
  }
  last.connect(env);
  env.connect(k.out);
  osc.start(o.t);
  osc.stop(end + 0.03);
  return end;
}

interface NoiseOpts {
  t: number;
  g: number;
  a?: number;
  d: number;
  /** The filter: kind, centre (or corner) frequency, where it sweeps to, and its Q. */
  type?: BiquadFilterType;
  f: number;
  f2?: number;
  q?: number;
}

/** A burst of filtered noise (taps, knocks, swishes, the dice); returns when it has died away. */
function noise(k: Kit, o: NoiseOpts): number {
  const { ctx } = k;
  const a = o.a ?? 0.002;
  const end = o.t + a + o.d;
  const src = ctx.createBufferSource();
  src.buffer = k.noise;
  const filt = ctx.createBiquadFilter();
  filt.type = o.type ?? 'bandpass';
  filt.frequency.setValueAtTime(o.f, o.t);
  if (o.f2) filt.frequency.exponentialRampToValueAtTime(o.f2, end);
  filt.Q.value = o.q ?? 1;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, o.t);
  env.gain.linearRampToValueAtTime(o.g, o.t + a);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(filt);
  filt.connect(env);
  env.connect(k.out);
  // a different stretch of the noise each time
  const len = k.noise.duration || 1;
  src.start(o.t, Math.random() * Math.max(0, len - (a + o.d) - 0.05), a + o.d + 0.03);
  return end;
}

/** A soft bell: a few harmonics, the higher ones dying away sooner. */
function bell(k: Kit, t: number, f: number, g: number, d: number, type: OscillatorType = 'sine'): number {
  let end = t;
  const parts: Array<[number, number, number]> = [
    [1, 1, 1],
    [2, 0.28, 0.55],
    [3, 0.1, 0.35],
    [4.2, 0.04, 0.2],
  ];
  for (const [m, gm, dm] of parts) end = Math.max(end, tone(k, { t, f: f * m, g: g * gm, a: 0.004, d: d * dm, type: m === 1 ? type : 'sine' }));
  return end;
}

/** A metal clink: a handful of inharmonic partials. */
function clink(k: Kit, t: number, f: number, g: number): number {
  let end = t;
  const parts: Array<[number, number, number]> = [
    [1, 1, 0.32],
    [1.51, 0.7, 0.24],
    [2.15, 0.45, 0.17],
    [2.85, 0.25, 0.11],
  ];
  for (const [m, gm, d] of parts) end = Math.max(end, tone(k, { t, f: f * m, g: g * gm, a: 0.002, d }));
  noise(k, { t, g: g * 0.5, d: 0.015, type: 'highpass', f: 5000 });
  return end;
}

/** A wooden knock: a falling low tone and a short tap of noise. */
function knock(k: Kit, t: number, f: number, g: number, d = 0.09): number {
  noise(k, { t, g: g * 0.4, d: 0.03, type: 'bandpass', f: f * 4.5, q: 1.4 });
  return tone(k, { t, f, f2: f * 0.7, g, a: 0.002, d });
}

/** A low drum: a fast pitch drop and a puff of noise. */
function drum(k: Kit, t: number, g: number): number {
  noise(k, { t, g: g * 0.45, d: 0.12, type: 'lowpass', f: 380 });
  return tone(k, { t, f: 135, f2: 52, g, a: 0.003, d: 0.32 });
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// --- the sounds -------------------------------------------------------------------------------

/**
 * Each sound's overall level (before the quiet factor and the master volume):
 * at the default volume most peak around -20 dBFS, the short taps a little
 * lower, the "click" far below.
 */
const LEVEL: Partial<Record<Cue, number>> = {
  roll: 1.1,
  nudge: 1.5,
  road: 1.6,
  ship: 1.7,
  knight: 1.3,
  wall: 1.7,
  tradeOffer: 1.3,
  tradeDone: 1.3,
  tradeDeclined: 1.8,
  cardDraw: 1.8,
  cardPlay: 1.3,
  attack: 0.8,
  chat: 1.6,
};

type Recipe = (k: Kit, t: number, o: PlayOptions) => number;

const RECIPES: Record<Cue, Recipe> = {
  /**
   * The dice: a rattle while they tumble, a knock as they land (60% of the
   * way, as the animation in ui/DiceRoll.tsx) and a small one after the bounce.
   */
  roll(k, t, o) {
    const dur = Math.max(0.25, o.duration ?? 1);
    const dice = Math.max(1, Math.min(3, o.dice ?? 2));
    const land = t + dur * 0.6;
    let at = t + 0.03;
    let end = t;
    while (at < land - 0.05) {
      const g = rand(0.07, 0.16);
      noise(k, { t: at, g, d: rand(0.018, 0.04), type: 'bandpass', f: rand(1900, 4200), q: rand(2.5, 5) });
      end = tone(k, { t: at, f: rand(700, 1250), g: g * 0.35, a: 0.001, d: 0.03 });
      at += rand(0.04, 0.085) / Math.sqrt(dice / 2);
    }
    for (let i = 0; i < dice; i++) {
      const off = i * 0.05;
      noise(k, { t: land + off, g: 0.22, d: 0.05, type: 'bandpass', f: 1300 + i * 260, q: 2 });
      tone(k, { t: land + off, f: 430 + i * 40, f2: 330, g: 0.16, a: 0.002, d: 0.07 });
      noise(k, { t: t + dur * 0.9 + off, g: 0.08, d: 0.035, type: 'bandpass', f: 1700 + i * 200, q: 2 });
      end = tone(k, { t: t + dur * 0.9 + off, f: 520, f2: 400, g: 0.06, a: 0.002, d: 0.05 });
    }
    return end;
  },
  /** A 7: two low, slow bell notes falling a fourth. */
  seven(k, t) {
    bell(k, t, midi(55), 0.17, 1.1, 'triangle');
    return bell(k, t + 0.22, midi(50), 0.19, 1.3, 'triangle');
  },
  /** Your turn: a gentle rising chime. */
  yourTurn(k, t) {
    bell(k, t, midi(79), 0.11, 0.9);
    return bell(k, t + 0.13, midi(84), 0.12, 1.1);
  },
  /** Something to do out of turn (discard, answer an offer): one soft note. */
  nudge(k, t) {
    return bell(k, t, midi(76), 0.085, 0.6);
  },
  /** A road: a short wooden tap. */
  road(k, t) {
    return knock(k, t, 520, 0.2, 0.07);
  },
  /** A ship: a hollow knock on the hull and a little splash. */
  ship(k, t) {
    noise(k, { t, g: 0.06, a: 0.04, d: 0.22, type: 'lowpass', f: 900, f2: 350 });
    return tone(k, { t, f: 200, f2: 150, type: 'triangle', g: 0.16, a: 0.004, d: 0.14 });
  },
  /** A settlement: knock knock. */
  settlement(k, t) {
    knock(k, t, 250, 0.24);
    return knock(k, t + 0.11, 230, 0.2);
  },
  /** A city: a fuller, deeper thud. */
  city(k, t) {
    noise(k, { t, g: 0.12, d: 0.12, type: 'lowpass', f: 420 });
    tone(k, { t, f: 220, f2: 125, g: 0.1, a: 0.003, d: 0.18 });
    const end = tone(k, { t, f: 112, f2: 62, g: 0.34, a: 0.003, d: 0.34 });
    knock(k, t + 0.13, 300, 0.07, 0.06);
    return end;
  },
  /** A knight: clink, clink. */
  knight(k, t) {
    clink(k, t, 2050, 0.07);
    return clink(k, t + 0.085, 1930, 0.045);
  },
  /** A city wall: stones set in place. */
  wall(k, t) {
    tone(k, { t, f: 95, f2: 70, g: 0.14, a: 0.003, d: 0.12 });
    noise(k, { t, g: 0.2, d: 0.09, type: 'bandpass', f: 520, q: 0.8 });
    noise(k, { t: t + 0.075, g: 0.14, d: 0.08, type: 'bandpass', f: 640, q: 0.8 });
    return noise(k, { t: t + 0.15, g: 0.09, d: 0.07, type: 'bandpass', f: 560, q: 0.8 });
  },
  /** A city improvement: three rising notes. */
  improve(k, t) {
    bell(k, t, midi(72), 0.08, 0.6);
    bell(k, t + 0.09, midi(76), 0.08, 0.6);
    return bell(k, t + 0.18, midi(79), 0.09, 0.9);
  },
  /** A metropolis: the improvement chime, carried on to a ringing octave. */
  metropolis(k, t) {
    [72, 76, 79].forEach((n, i) => bell(k, t + i * 0.08, midi(n), 0.08, 0.5));
    bell(k, t + 0.26, midi(79), 0.07, 1.4);
    return bell(k, t + 0.26, midi(84), 0.1, 1.6);
  },
  /** A trade offer for you: a light two-note ping. */
  tradeOffer(k, t) {
    bell(k, t, midi(81), 0.075, 0.4);
    return bell(k, t + 0.09, midi(88), 0.065, 0.5);
  },
  /** A trade made: two coins. */
  tradeDone(k, t) {
    clink(k, t, 2640, 0.06);
    return clink(k, t + 0.075, 2800, 0.05);
  },
  /** An offer turned down: a soft falling note. */
  tradeDeclined(k, t) {
    return tone(k, { t, f: midi(67), f2: midi(63), type: 'triangle', g: 0.085, a: 0.01, d: 0.26, lp: 1600 });
  },
  /** A card drawn or bought: a flick. */
  cardDraw(k, t) {
    noise(k, { t, g: 0.11, a: 0.006, d: 0.07, type: 'bandpass', f: 1600, f2: 5200, q: 1.2 });
    return noise(k, { t: t + 0.05, g: 0.05, d: 0.02, type: 'highpass', f: 3500 });
  },
  /** A card played: a swish and a little flourish. */
  cardPlay(k, t) {
    noise(k, { t, g: 0.1, a: 0.01, d: 0.12, type: 'bandpass', f: 1200, f2: 4800, q: 1 });
    [79, 83, 86].forEach((n, i) => tone(k, { t: t + 0.06 + i * 0.06, f: midi(n), type: 'triangle', g: 0.06, a: 0.004, d: 0.22 }));
    return bell(k, t + 0.24, midi(91), 0.045, 0.6);
  },
  /** The robber (or the pirate) moves: a low, muffled tone. */
  robber(k, t) {
    noise(k, { t, g: 0.07, d: 0.1, type: 'lowpass', f: 300 });
    tone(k, { t, f: midi(43) * 1.5, type: 'triangle', g: 0.07, a: 0.02, d: 0.4, lp: 600 });
    return tone(k, { t, f: midi(43), f2: midi(41), type: 'triangle', g: 0.2, a: 0.02, d: 0.5, lp: 500 });
  },
  /** Cards taken from you: a low falling pair of notes. */
  stolen(k, t) {
    tone(k, { t, f: midi(62), type: 'triangle', g: 0.11, a: 0.008, d: 0.3, lp: 1400 });
    return tone(k, { t: t + 0.16, f: midi(57), f2: midi(55), type: 'triangle', g: 0.12, a: 0.008, d: 0.45, lp: 1200 });
  },
  /** The barbarian ship sails on: a short, distant horn. */
  barbarianShip(k, t) {
    const o = { t, type: 'sawtooth' as OscillatorType, g: 0.045, a: 0.09, h: 0.28, d: 0.3, lp: 900 };
    tone(k, { ...o, f: midi(50) * 0.97, f2: midi(50) });
    tone(k, { ...o, f: midi(57) * 0.97, f2: midi(57), g: 0.03, detune: 6 });
    return tone(k, { ...o, f: midi(38), f2: midi(38), type: 'triangle', g: 0.05, lp: 400 });
  },
  /** The barbarians attack: war drums. */
  attack(k, t) {
    let end = t;
    for (const [dt, g] of [
      [0, 0.26],
      [0.2, 0.22],
      [0.4, 0.26],
      [0.7, 0.34],
    ] as const)
      end = drum(k, t + dt, g);
    return end;
  },
  /** Catan is saved: a bright rising call. */
  attackWon(k, t) {
    [72, 76, 79].forEach((n, i) => bell(k, t + i * 0.1, midi(n), 0.08, 0.5, 'triangle'));
    return bell(k, t + 0.3, midi(84), 0.1, 1.2, 'triangle');
  },
  /** The barbarians win: falling notes and a dull thud. */
  attackLost(k, t) {
    [64, 60, 57].forEach((n, i) => tone(k, { t: t + i * 0.16, f: midi(n), type: 'triangle', g: 0.1, a: 0.008, d: 0.4, lp: 1400 }));
    return drum(k, t + 0.48, 0.22);
  },
  /** A chat message: a soft double blip. */
  chat(k, t) {
    tone(k, { t, f: 1320, g: 0.06, a: 0.004, d: 0.09 });
    return tone(k, { t: t + 0.075, f: 1760, g: 0.05, a: 0.004, d: 0.12 });
  },
  /** You win: a little fanfare and a held chord. */
  victory(k, t) {
    [67, 72, 76, 79].forEach((n, i) => tone(k, { t: t + i * 0.12, f: midi(n), type: 'triangle', g: 0.09, a: 0.006, d: 0.28 }));
    let end = t;
    for (const n of [72, 76, 79, 84]) end = Math.max(end, bell(k, t + 0.5, midi(n), 0.055, 1.8, 'triangle'));
    return end;
  },
  /** Someone else wins: a gentle, falling close. */
  defeat(k, t) {
    [67, 64, 60].forEach((n, i) => tone(k, { t: t + i * 0.24, f: midi(n), type: 'triangle', g: 0.08, a: 0.01, d: 0.55, lp: 1500 }));
    tone(k, { t: t + 0.72, f: midi(55), type: 'triangle', g: 0.05, a: 0.02, d: 1.2, lp: 900 });
    return tone(k, { t: t + 0.72, f: midi(48), g: 0.09, a: 0.02, d: 1.3 });
  },
  /** A very small tick (sound switched on, the volume slider let go). */
  click(k, t) {
    noise(k, { t, g: 0.03, d: 0.012, type: 'highpass', f: 3000 });
    return tone(k, { t, f: 1800, g: 0.04, a: 0.001, d: 0.025 });
  },
};

/** Every cue, for tests and the gallery. */
export const CUES = Object.keys(RECIPES) as Cue[];

/** The name of the event announced on `window` whenever a sound plays (detail: { cue, quiet }). */
export const SOUND_EVENT = 'island-traders:sound';

function browserDeps(): SoundDeps {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
    navigator?: Navigator;
    matchMedia?: (q: string) => MediaQueryList;
    dispatchEvent?: (e: Event) => boolean;
    CustomEvent?: typeof CustomEvent;
    performance?: Performance;
  };
  return {
    audio: () => g.AudioContext ?? g.webkitAudioContext ?? null,
    now: () => (g.performance ? g.performance.now() : Date.now()),
    load: () => loadJson<SoundPrefs>(PREF_KEY),
    save: (p) => {
      saveJson(PREF_KEY, p);
    },
    vibrate: g.navigator && typeof g.navigator.vibrate === 'function' ? (p) => g.navigator!.vibrate(p) : undefined,
    touch: () => (typeof g.matchMedia === 'function' ? g.matchMedia('(pointer: coarse)').matches : false),
    played: (cue, quiet) => {
      if (typeof g.dispatchEvent === 'function' && typeof g.CustomEvent === 'function') g.dispatchEvent(new g.CustomEvent(SOUND_EVENT, { detail: { cue, quiet } }));
    },
  };
}

/** The game's sound, shared by every screen. */
export const sound = new SoundEngine(browserDeps());
