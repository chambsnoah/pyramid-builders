// Both pages load in a headless browser with no console error, and Khufu's event model runs
// in its worker to the expected build.
import { test, expect, openKhufu, MODEL_HASH } from './fixtures.mjs';

test('index.html (the small pyramid) loads and its simulation runs', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__sim && document.querySelector('canvas'));
  const t0 = await page.evaluate(() => __sim.sched.time);
  await page.waitForFunction((t0) => __sim.sched.time > t0 + 1, t0, { timeout: 30_000 });
  await expect(page.locator('#tour')).toBeVisible();
});

test('khufu.html loads, runs the model in its worker and shows the finished monument', async ({ page }) => {
  const run = await openKhufu(page);
  expect(run.hash).toBe(MODEL_HASH);
  expect(run.blocks).toBe(2295833);
  expect(run.endT / (300 * 36000)).toBeCloseTo(19.86, 2);
  await expect(page.locator('#tour')).toBeEnabled();
  await expect(page.locator('#where')).toHaveText(/finished monument/);
  await expect(page.locator('#sBlocks')).toHaveText('2,295,833 of 2,295,833 blocks');
  await expect(page.locator('#rooms button')).toHaveCount(6);
});

for (const ramp of ['spiral', 'internal']) {
  test(`khufu.html?ramp=${ramp} runs that theory`, async ({ page }) => {
    const run = await openKhufu(page, `?ramp=${ramp}`);
    expect(run.hash).not.toBe(MODEL_HASH);
    expect(await page.evaluate(() => __khufu.summary.theory.id)).toBe(ramp);
  });
}
