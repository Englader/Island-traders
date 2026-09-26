import { render } from 'preact';
import { App } from './app';
import './styles.css';

render(<App />, document.getElementById('app')!);

// After one visit the game starts offline too (games on this device need no network).
// Secure pages only: https, or localhost for the browser tests.
if (import.meta.env.PROD && !import.meta.env.VITE_NO_ONLINE && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // not available here (private mode, embedded frame): the game still works online
  });
}
