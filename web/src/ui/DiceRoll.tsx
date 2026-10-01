import type { EventFace } from 'engine';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RollTiming } from '../game/seats';
import { DiePips } from './common';
import { EventFaceArt } from './ckArt';

export interface RollInfo {
  /** Changes for every roll (the flash key of the roll). */
  key: number;
  dice: [number, number];
  /** Cities & Knights: the event die, and what it did (shown under the total). */
  event?: EventFace;
  caption?: { title: string; sub: string; tone: 'ship' | 'attack' | ImprovementTone };
}

type ImprovementTone = 'trade' | 'politics' | 'science';

/** The event die's six faces on the cube: three ships and a gate of each colour (in the number slots of FACES). */
const EVENT_SLOTS: Record<number, EventFace> = { 1: 'ship', 6: 'trade', 2: 'ship', 5: 'politics', 3: 'ship', 4: 'science' };
const EVENT_SHOW: Record<EventFace, number> = { ship: 1, trade: 6, politics: 5, science: 4 };

/** Each face's place on the cube; opposite faces add up to 7. */
const FACES: Array<[number, string]> = [
  [1, 'rotateY(0deg)'],
  [6, 'rotateY(180deg)'],
  [2, 'rotateY(90deg)'],
  [5, 'rotateY(-90deg)'],
  [3, 'rotateX(90deg)'],
  [4, 'rotateX(-90deg)'],
];
/** How to turn the cube so that a face looks at the player: [rotateX, rotateY]. */
const SHOW: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };

/**
 * Two dice thrown into the middle of the screen: they bounce and tumble,
 * land on the rolled numbers with the total below, then fly up into the
 * header, where `targets` are the header's dice. Tap to skip.
 */
export function DiceRoll({ roll, timing, targets, onDone }: { roll: RollInfo; timing: RollTiming; targets(): Element[]; onDone(): void }) {
  const wraps = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const cubes = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  // the event die rolls as a third cube, its face given as the slot that holds it
  const faces = roll.event ? [...roll.dice, EVENT_SHOW[roll.event]] : [...roll.dice];
  const [stage, setStage] = useState<'tumble' | 'landed' | 'leaving'>('tumble');
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useLayoutEffect(() => {
    done.current = false;
    setStage('tumble');
    if (typeof Element === 'undefined' || !('animate' in Element.prototype)) {
      finish();
      return;
    }
    const anims: Animation[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const { tumble, flight } = timing;
    // the event's caption needs a moment longer to read
    const hold = timing.hold + (roll.caption ? 900 : 0);
    faces.forEach((n, i) => {
      const cube = cubes[i].current;
      const wrap = wraps[i].current;
      if (!cube || !wrap) return;
      const [fx, fy] = SHOW[n] ?? [0, 0];
      const side = i === 1 ? -1 : 1;
      // several turns on every axis, ending on the rolled face
      anims.push(
        cube.animate(
          [
            { transform: `rotateX(${fx + 540 + 90 * i}deg) rotateY(${fy - 450 * side}deg) rotateZ(${140 * side}deg)` },
            { transform: `rotateX(${fx}deg) rotateY(${fy}deg) rotateZ(0deg)` },
          ],
          { duration: tumble, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' },
        ),
      );
      // thrown in from below, two bounces, then still
      anims.push(
        wrap.animate(
          [
            { transform: `translate(${-110 * side}px, 38vh) scale(.6)`, offset: 0 },
            { transform: `translate(${-24 * side}px, -46px) scale(1.06)`, offset: 0.38 },
            { transform: 'translate(0px, 0px) scale(1)', offset: 0.6 },
            { transform: 'translate(0px, -16px) scale(1)', offset: 0.76 },
            { transform: 'translate(0px, 0px) scale(1)', offset: 0.9 },
            { transform: 'translate(0px, 0px) scale(1)', offset: 1 },
          ],
          { duration: tumble, delay: i * 50, easing: 'ease-out', fill: 'both' },
        ),
      );
    });
    timers.push(setTimeout(() => setStage('landed'), tumble + 50));
    timers.push(
      setTimeout(() => {
        setStage('leaving');
        const to = targets();
        faces.forEach((_, i) => {
          const wrap = wraps[i].current;
          const target = to[i];
          if (!wrap || !target) return;
          const a = wrap.getBoundingClientRect();
          const b = target.getBoundingClientRect();
          if (!a.width || !b.width) return;
          const dx = b.left + b.width / 2 - (a.left + a.width / 2);
          const dy = b.top + b.height / 2 - (a.top + a.height / 2);
          anims.push(
            wrap.animate([{ transform: 'translate(0px, 0px) scale(1)' }, { transform: `translate(${dx}px, ${dy}px) scale(${b.width / a.width})` }], {
              duration: flight,
              easing: 'cubic-bezier(.55,0,.3,1)',
              fill: 'forwards',
            }),
          );
        });
      }, tumble + 50 + hold),
    );
    timers.push(setTimeout(finish, tumble + 50 + hold + flight));
    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
    };
  }, [roll.key]);

  const sum = roll.dice[0] + roll.dice[1];
  const said = `Rolled ${roll.dice[0]} and ${roll.dice[1]}: ${sum}${roll.caption ? `. ${roll.caption.title}. ${roll.caption.sub}` : ''}`;
  return (
    <div class={`roll-overlay ${stage}${roll.event ? ' three' : ''}`} onClick={finish} role="img" aria-label={said}>
      <div class="roll-stage">
        {faces.map((n, i) => (
          <div key={i} class={i === 1 ? 'cube-wrap red' : i === 2 ? 'cube-wrap event' : 'cube-wrap'} ref={wraps[i]}>
            <div class="cube" ref={cubes[i]} style={{ transform: `rotateX(${SHOW[n]?.[0] ?? 0}deg) rotateY(${SHOW[n]?.[1] ?? 0}deg)` }}>
              {FACES.map(([face, turn]) => (
                <div key={face} class="cube-face" style={{ transform: `${turn} translateZ(var(--half))` }}>
                  {i === 2 ? (
                    <svg class="die-pips" viewBox="0 0 1 1" aria-hidden="true">
                      <EventFaceArt face={EVENT_SLOTS[face]} />
                    </svg>
                  ) : (
                    <DiePips n={face} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div class="roll-sum">{sum}</div>
      {roll.caption && (
        <div class={`roll-event tone-${roll.caption.tone}`}>
          <b>{roll.caption.title}</b>
          <span>{roll.caption.sub}</span>
        </div>
      )}
    </div>
  );
}
