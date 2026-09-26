import { defineConfig, devices } from '@playwright/test';

// PLAYWRIGHT_CHROMIUM_PATH lets the smoke test use a preinstalled Chromium
// (e.g. a sandbox without `npx playwright install`).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        // WebRTC between two pages on one machine: expose plain local addresses.
        launchOptions: { ...(executablePath ? { executablePath } : {}), args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] },
      },
    },
  ],
  webServer: [
    {
      command: 'npm run web:build && npm run web:preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // local PeerJS broker for the online test (the public one may be unreachable from CI)
      command: 'node scripts/peer-broker.mjs',
      url: 'http://127.0.0.1:9000/broker/peerjs/id',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // local MQTT broker standing in for the public relay brokers
      command: 'node scripts/mqtt-broker.mjs 9001',
      url: 'http://127.0.0.1:9001/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
