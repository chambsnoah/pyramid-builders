// Rendering: fixed camera views on fixed days compared with stored reference pictures
// (tests/e2e/__screenshots__), and frame-time budgets with the detail bubble full.
//   npx playwright test rendering --update-snapshots   to refresh the references
import { test, expect, sharedPage } from './fixtures.mjs';
import { VIEWS, showView, HIDE_UI } from './view-helpers.mjs';

// Frame times are generous: software WebGL takes 0.8–1 s a frame at 960×600 on an Apple M3
// (its GPU does the same view in ~11 ms at 2048×1536), and a shared CI runner is slower.
// What the GPU is given (triangles, draw calls) is the same on every machine, so it is held
// to a tight budget instead: 1.33 M triangles and 21 draw calls for this view now.
const BUDGET = {
  frameMeanMs: Number(process.env.KHUFU_FRAME_BUDGET_MS || 6000), placeMeanMs: Number(process.env.KHUFU_PLACE_BUDGET_MS || 40),
  tris: 1.6e6, calls: 32,
};

// (not serial: a view that fails does not skip the views after it; the page is opened again)
const shared = sharedPage(test, { setup: (p) => p.addStyleTag({ content: HIDE_UI }) });

for (const v of VIEWS) {
  test(`view: ${v.name}`, async () => {
    const { page } = shared;
    await showView(page, v);
    await expect(page).toHaveScreenshot(`${v.name}.png`, { animations: 'disabled', ...v.shot });
  });
}

test('frame-time budget with the bubble full of gangs', async () => {
  const { page } = shared;
  await showView(page, VIEWS.find((v) => v.name === 'quarry-gangs'));
  const r = await page.evaluate(() => __khufu.benchFrames(30, 1));
  console.log(`frame ${JSON.stringify(r.frameMs)} ms, placing ${JSON.stringify(r.placeMs)} ms, ${r.bubble.near} gangs / ${r.bubble.workers} workers in detail, ${r.tris} tris, ${r.calls} draw calls`);
  expect(r.tris, 'triangles drawn').toBeLessThan(BUDGET.tris);
  expect(r.calls, 'draw calls').toBeLessThan(BUDGET.calls);
  expect(r.bubble.workers, 'workers in detail').toBeGreaterThan(300);
  expect(r.frameMs.mean, 'mean frame time (ms)').toBeLessThan(BUDGET.frameMeanMs);
  expect(r.placeMs.mean, 'mean time placing the gangs (ms)').toBeLessThan(BUDGET.placeMeanMs);
});
