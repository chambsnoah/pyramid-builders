// Both guided tours, from start to end: the small pyramid's (src/tour.js) and Khufu's
// (src/khufu/tour.js, with its walk inside and the closing circle).
import { test, expect, openKhufu } from './fixtures.mjs';

test("the small pyramid's tour plays every shot and hands back the controls", async ({ page }) => {
  await page.goto('/index.html?tour=1');
  await page.waitForFunction(() => window.__tour?.active);
  test.setTimeout(480_000); // software WebGL on a CI runner draws only a few frames a second
  const { shots, length } = await page.evaluate(() => { __tour.speed = 8; return { shots: __tour.shots, length: __tour.length }; });
  // poll the shot shown until the tour ends; fail only if it stops moving on for 30 s
  const seen = new Set(), captions = new Set();
  let lastT = -1, stalled = Date.now();
  while (Date.now() - stalled < 30_000) {
    const s = await page.evaluate(() => ({ active: __tour.active, t: __tour.t, shot: __tour.shot, title: document.querySelector('#tourTitle').textContent }));
    if (!s.active) break;
    if (s.t > lastT) { lastT = s.t; stalled = Date.now(); }
    seen.add(s.shot); captions.add(s.title);
    await page.waitForTimeout(100);
  }
  expect(await page.evaluate(() => __tour.active), 'the tour ended').toBe(false);
  expect([...seen].sort((a, b) => a - b), `every shot of ${length} s shown`).toEqual([...Array(shots).keys()]);
  expect(captions.size).toBeGreaterThan(shots / 2);
  await expect(page.locator('#tourCaption')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/touring/);
  expect(await page.evaluate(() => __sim.phase)).toBe('complete');
});

// Khufu's tour, driven frame by frame from the test (as a hidden tab would starve it of
// frames): the frame loop is held and each step does what it does while touring.
async function driveKhufuTour(page, opts = {}) {
  return page.evaluate(async ({ dt, renderEvery }) => {
    const K = __khufu, tour = K.tour, seen = [], legs = new Set(), captions = new Set();
    K.hold = true;
    K.startTour();
    let frames = 0, lastKey = '';
    while (tour.active && frames < 20000) {
      tour.update(dt);
      if (tour.active && !tour.drewBubble && K.bubble.visible) K.bubble.update(K.timeline.t, K.camera, dt);
      if (K.walker.enabled) K.walker.update(dt);
      if (frames % renderEvery === 0) K.renderer.render(K.scene, K.camera);
      const i = tour.info;
      if (i.active) {
        const key = `${i.stop}:${i.phase}`;
        if (key !== lastKey) { seen.push({ stop: i.stop, phase: i.phase, milestone: i.milestone, t: i.t }); lastKey = key; }
        if (i.leg !== undefined) legs.add(i.leg);
        const c = document.querySelector('#tourCaption');
        if (c.style.display !== 'none') captions.add(document.querySelector('#tourTitle').textContent);
      }
      frames++;
      // let the worker's replies in (a real pause while the tour waits for a seek)
      await new Promise((r) => setTimeout(r, i.phase === 'wait' ? 15 : 0));
    }
    K.hold = false;
    return { frames, seen, legs: [...legs], captions: [...captions], stops: tour.stops.map((s) => s.milestone || s.kind), active: tour.active };
  }, { dt: 1 / 20, renderEvery: 8, ...opts });
}

for (const ramp of ['', 'spiral']) {
  test(`Khufu's tour${ramp ? ` (${ramp} ramps)` : ''} runs from start to end and hands back the controls`, async ({ page }) => {
    await openKhufu(page, ramp ? `?ramp=${ramp}` : '');
    const r = await driveKhufuTour(page);
    expect(r.active, 'the tour ended').toBe(false);
    const tourSeconds = r.frames / 20;
    expect(tourSeconds).toBeGreaterThan(120);
    expect(tourSeconds).toBeLessThan(200);
    // every stop: travel, then the 1× approach and hold
    const stops = r.stops.length;
    expect(stops).toBeGreaterThanOrEqual(5);
    for (let s = 0; s < stops; s++) {
      const phases = r.seen.filter((x) => x.stop === s).map((x) => x.phase);
      expect(phases, `stop ${s} (${r.stops[s]})`).toEqual(expect.arrayContaining(r.stops[s] === 'end' ? ['travel', 'hold'] : ['travel', 'approach', 'hold']));
    }
    const all = r.seen.map((x) => x.phase);
    for (const ph of ['crown', 'door', 'walk', 'rise', 'circle']) expect(all, `phase ${ph}`).toContain(ph);
    expect(all.indexOf('crown')).toBeLessThan(all.indexOf('walk'));
    expect(r.legs.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]); // every leg of the walk, the two cuts too
    expect(r.captions).toEqual(expect.arrayContaining(["The King's Chamber", "The Queen's Chamber", 'The subterranean chamber', "Khufu's pyramid"]));
    // the controls are handed back
    await expect(page.locator('#tour')).toHaveText('Tour');
    await expect(page.locator('body')).not.toHaveClass(/touring/);
    await expect(page.locator('#tourCaption')).toBeHidden();
    expect(await page.evaluate(() => ({ orbit: __khufu.orbit.enabled, walk: __khufu.walker.enabled }))).toEqual({ orbit: true, walk: false });
  });
}

test("Khufu's tour stops on Esc and on End tour", async ({ page }) => {
  await openKhufu(page);
  await page.keyboard.press('t');
  await expect(page.locator('body')).toHaveClass(/touring/);
  await expect(page.locator('#tourCaption')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/touring/);
  await page.click('#tour');
  await expect(page.locator('#tour')).toHaveText('End tour');
  await page.click('#tourEnd');
  await expect(page.locator('#tour')).toHaveText('Tour');
  expect(await page.evaluate(() => __khufu.orbit.enabled)).toBe(true);
});
