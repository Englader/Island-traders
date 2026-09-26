import { render } from 'preact';
import { App } from './app';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Installed on a phone, the game starts offline too (games against the computer need no network).
if (import.meta.env.PROD && !import.meta.env.VITE_NO_ONLINE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // not available here (private mode, embedded frame): the game still works online
  });
}
