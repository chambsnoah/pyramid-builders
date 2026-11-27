// Shared fixtures for the browser tests: every page fails its test on any console error or
// uncaught exception, and helpers to open the Khufu page once its model has run.
import { test as base, expect } from '@playwright/test';

// collects the console errors and uncaught exceptions of a page (and of its workers)
export function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  page.on('worker', (w) => w.on('console', (m) => { if (m.type() === 'error') errors.push(`worker console.error: ${m.text()}`); }));
  return errors;
}

// A page shared by the tests of a file (made in beforeAll with browser.newPage()): its errors
// are checked after every test, so the test during which one was logged fails.
export function sharedPage(test, { query = '', setup } = {}) {
  const shared = { page: null, errors: [] };
  test.beforeAll(async ({ browser }) => {
    shared.page = await browser.newPage();
    shared.errors = watchErrors(shared.page);
    await openKhufu(shared.page, query);
    if (setup) await setup(shared.page);
  });
  test.afterEach(() => { const e = shared.errors.splice(0); expect(e, 'console errors on the page').toEqual([]); });
  test.afterAll(async () => shared.page?.close());
  return shared;
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const errors = watchErrors(page);
    await use(page);
    if (testInfo.annotations.some((a) => a.type === 'allow-console-errors')) return;
    expect(errors, 'console errors on the page').toEqual([]);
  },
});
export { expect };

export const MODEL_HASH = '9b89b2cc698ebefb';

// open khufu.html (with a query) and wait until the event model has run in the worker and
// the first state has arrived
export async function openKhufu(page, query = '') {
  await page.goto(`/khufu.html${query}`);
  await page.waitForFunction(() => window.__khufu?.summary && window.__khufu.timeline.ready && window.__khufu.state, null, { timeout: 90_000 });
  return page.evaluate(() => ({ hash: __khufu.summary.hash, endT: __khufu.summary.endT, blocks: __khufu.summary.blocks, runMs: __khufu.runMs }));
}

// seek the timeline to t (working seconds) as the scrub bar does, and wait for the model's
// state at exactly that time (past the capstone, while the access stair is built, the
// model's state stays at the end of the build)
export async function seekTo(page, t) {
  await page.evaluate((t) => { __khufu.timeline.seek(t); }, t);
  await page.waitForFunction((t) => __khufu.state && __khufu.state.t === Math.min(t, __khufu.summary.endT) && !__khufu.client.busy, t);
}
