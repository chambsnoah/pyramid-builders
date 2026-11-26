// Browser tests (tests/e2e): headless Chromium against the production build, served by
// `vite preview`. WebGL runs on SwiftShader (software), so the pictures are the same on a
// laptop and on the CI runner up to small rounding differences.
//   npm run test:e2e              (builds first)
//   npx playwright test --update-snapshots   to refresh the reference pictures
import { defineConfig } from '@playwright/test';

const PORT = 5182;
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.mjs',
  timeout: 240_000,
  expect: { timeout: 30_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, threshold: 0.25 } },
  fullyParallel: false,
  workers: 1, // one GPU-less browser at a time: the frame-time budgets need the CPU
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/khufu.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
