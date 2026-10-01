import { afterEach } from 'vitest';

/*
 * Many tests are long synchronous loops (whole games, hundreds of maps).
 * Vitest reports results to its main process over an RPC whose replies are
 * only read when the event loop gets a turn; after a minute of back-to-back
 * synchronous tests in one file the reply times out ("Timeout calling
 * onTaskUpdate") and the run fails although every test passed. A turn of the
 * event loop after each test lets the replies in.
 */
const tick = globalThis.setTimeout; // taken before any test fakes the timers
afterEach(() => new Promise<void>((resolve) => tick(resolve, 0)));
