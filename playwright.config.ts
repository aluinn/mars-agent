import { defineConfig } from '@playwright/test';

// Declared locally so the config typechecks without adding @types/node as a dependency.
declare const process: { env: Record<string, string | undefined> };

/** One smoke test against the production build. WebGL runs on a software renderer so it works on any CI machine. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 120_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1600, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 180_000 },
});
