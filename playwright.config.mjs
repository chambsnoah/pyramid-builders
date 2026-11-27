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
  // Screenshots: a pixel counts as different past a colour distance of 0.02 (pixelmatch), and
  // a view fails past 0.1 % of such pixels. The Mac (where the references were made) and the
  // CI runner both run SwiftShader: their pictures differ by rounding, in at most 0.009 % of
  // pixels at 0.02 on every view but quarry-gangs, which has its own tolerance (view-helpers).
  expect: { timeout: 30_000, toHaveScreenshot: { maxDiffPixelRatio: 0.001, threshold: 0.02 } },
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
