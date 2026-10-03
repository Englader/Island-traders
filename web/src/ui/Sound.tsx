import { useEffect, useState } from 'preact/hooks';
import { sound, type SoundPrefs } from '../game/sound';
import { useMedia } from './common';

/** Wide screens, where the game has keyboard shortcuts (GameScreen's DESK). */
const KEYS = '(min-width: 900px) and (min-height: 620px)';

/** The sound settings, following changes made anywhere (the header button, the menu, the M key). */
export function useSound(): SoundPrefs {
  const [prefs, setPrefs] = useState(() => sound.settings);
  useEffect(() => {
    const update = () => setPrefs(sound.settings);
    update();
    return sound.subscribe(update);
  }, []);
  return prefs;
}

/** Sound on or off; turning it on says so with a small tick. */
export function toggleSound(): void {
  if (sound.toggle()) sound.play('click');
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg class="speaker-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.2h3.6L12.4 5v14l-4.8-4.2H4z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
      {on ? (
        <>
          <path d="M15.6 9.3a4 4 0 0 1 0 5.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
          <path d="M18.2 6.8a7.6 7.6 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
        </>
      ) : (
        <path d="M15.8 9.4l5 5.2M20.8 9.4l-5 5.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
      )}
    </svg>
  );
}

/**
 * The mute button (a toggle: pressed = muted). `shortcut`: wide screens,
 * where the M key does the same.
 */
export function SoundButton({ shortcut, extraClass }: { shortcut?: boolean; extraClass?: string }) {
  const { on } = useSound();
  const tip = `${on ? 'Mute sounds' : 'Unmute sounds'}${shortcut ? ' (M)' : ''}`;
  return (
    <button
      type="button"
      class={`icon-btn sound-btn${on ? '' : ' muted'}${extraClass ? ` ${extraClass}` : ''}`}
      aria-label="Mute sounds"
      aria-pressed={!on}
      aria-keyshortcuts={shortcut ? 'M' : undefined}
      title={tip}
      onClick={toggleSound}
    >
      <SpeakerIcon on={on} />
    </button>
  );
}

/** The menu's "Sound" section: on or off, and the volume. */
export function SoundSettings() {
  const { on, volume } = useSound();
  const shortcut = useMedia(KEYS);
  const pct = Math.round(volume * 100);
  return (
    <div class="menu-pref sound-pref">
      <label class="row switch-row">
        <span>Sound</span>
        <input
          type="checkbox"
          role="switch"
          class="switch"
          checked={on}
          onChange={(e) => {
            const want = (e.target as HTMLInputElement).checked;
            if (want !== sound.on) toggleSound();
          }}
        />
      </label>
      <label class={on ? 'row volume-row' : 'row volume-row off'}>
        <span>Volume</span>
        <input
          type="range"
          class="volume"
          min={0}
          max={100}
          step={5}
          value={pct}
          disabled={!on}
          aria-valuetext={`${pct}%`}
          onInput={(e) => sound.setVolume(Number((e.target as HTMLInputElement).value) / 100)}
          // let go: a soft sample at the new level
          onChange={() => sound.play('nudge')}
        />
        <span class="volume-pct" aria-hidden="true">
          {pct}%
        </span>
      </label>
      <p class="hint">Dice, building, trades and your turn{shortcut ? '. M switches the sound on or off' : '; phones also buzz gently when your turn comes'}.</p>
    </div>
  );
}
