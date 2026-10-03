import { render } from 'preact';
import { App } from './app';
import { sound } from './game/sound';
import './styles.css';

render(<App />, document.getElementById('app')!);
// the audio starts with the first tap or key press (browsers allow sound only after one)
sound.listen(window);

// After one visit the game starts offline too (games on this device need no network).
// Secure pages only: https, or localhost for the browser tests.
if (import.meta.env.PROD && !import.meta.env.VITE_NO_ONLINE && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // not available here (private mode, embedded frame): the game still works online
  });
}
