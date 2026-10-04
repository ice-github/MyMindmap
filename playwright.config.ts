import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    // NOTE: `--host 127.0.0.1` はIPv4ループバックへのbind強制用。
    // 指定なしだと Vite が [::1] のみにlistenし、baseURL(127.0.0.1)へ接続拒否になる環境がある。
    command: './node_modules/.bin/vite --port 5173 --host 127.0.0.1',
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
