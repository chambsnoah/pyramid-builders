// The Khufu timeline: scrubbing across the whole build, stepping by days and months,
// playing, the milestone marks, and the statistics panel checked against the event model
// run here in Node (the same seed and code as the page's worker).
import { test, expect, openKhufu, seekTo } from './fixtures.mjs';
import { runFull, DAY, MONTH_DAYS } from '../../src/khufu/sim/index.js';
import { seeker, viewState } from '../../src/khufu/sim/view.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
let at = null;
const modelView = (t) => { at ||= seeker(runFull({ seed: 1 })); return viewState(at.seekTo(t)); };

// scrub as the range input does: drag (input events), then let go (change)
async function scrubTo(page, day) {
  await page.evaluate((day) => {
    const s = document.querySelector('#scrub');
    s.value = String(day); s.dispatchEvent(new Event('input', { bubbles: true }));
    s.value = String(day); s.dispatchEvent(new Event('change', { bubbles: true }));
  }, day);
  await page.waitForFunction((day) => __khufu.state?.day === day && !__khufu.client.busy, day);
}

test('scrubbing across the build: courses rise, and the statistics panel matches the model', async ({ page }) => {
  const run = await openKhufu(page);
  const last = Math.floor(run.endT / DAY);
  let prev = { built: -1, blocks: -1 };
  const forward = [0, 7, 260, 1100, 2400, 3300, 4100, 5000, last - 1];
  for (const day of [...forward, 2000, 40]) { // then back again
    await scrubTo(page, day);
    const v = modelView(day * DAY);
    const got = await page.evaluate(() => ({ built: __khufu.state.built, blocks: __khufu.state.blocksSet, shown: __khufu.monument.built, scrub: +document.querySelector('#scrub').value }));
    expect(got.scrub).toBe(day);
    expect(got.blocks, `day ${day}: blocks in the page's model`).toBe(v.blocksSet);
    expect(got.built).toBe(v.built);
    expect(got.shown, `day ${day}: courses drawn`).toBe(Math.min(v.built, 215));
    if (forward.includes(day)) { expect(got.blocks).toBeGreaterThan(prev.blocks); expect(got.built).toBeGreaterThanOrEqual(prev.built); prev = got; }
    // the panel, as text
    await expect(page.locator('#sBlocks')).toHaveText(`${fmt(v.blocksSet)} of 2,295,833 blocks`);
    await expect(page.locator('#sWork')).toHaveText(`about ${fmt(v.workforce)} people on site`);
    const rows = await page.locator('#sGangs tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => +td.textContent)));
    expect(rows, `day ${day}: gangs out / back / waiting`).toEqual([v.gangs.giza, v.gangs.tura, v.gangs.heavy].map((a) => [a[1], a[2], a[0]]));
    await expect(page.locator('#sStocks b').first()).toHaveText(fmt(v.quarry.stock));
    if (v.course) await expect(page.locator('#sCourse')).toContainText(`${fmt(v.course.total - v.course.left)} of ${fmt(v.course.total)} set`);
    const q = v.queues.slice(0, 5).map((r) => [r.name, r.waiting]);
    const qs = await page.locator('#sQueues tr:not(.dim)').evaluateAll((trs) => trs.map((tr) => [tr.querySelector('th').textContent, +tr.querySelector('td').textContent]));
    expect(qs, `day ${day}: longest queues`).toEqual(q);
  }
});

test('stepping by days and months, and the milestone marks', async ({ page }) => {
  await openKhufu(page);
  await scrubTo(page, 1000);
  const day = () => page.evaluate(() => __khufu.state.day);
  for (const [btn, d] of [['#nextDay', 1001], ['#nextDay', 1002], ['#prevDay', 1001], ['#nextMonth', 1001 + MONTH_DAYS], ['#prevMonth', 1001], ['#prevMonth', 1001 - MONTH_DAYS]]) {
    await page.click(btn);
    await page.waitForFunction((d) => __khufu.state.day === d && !__khufu.client.busy, d);
    expect(await day()).toBe(d);
  }
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((d) => __khufu.state.day === d, 1001 - MONTH_DAYS + 1);
  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForFunction((d) => __khufu.state.day === d, 1001 - 2 * MONTH_DAYS + 1);
  await page.click('#toStart');
  await page.waitForFunction(() => __khufu.state.day === 0);
  // each milestone mark jumps to its time
  const marks = page.locator('#marks > *');
  const n = await marks.count();
  expect(n).toBeGreaterThan(8);
  const ms = await page.evaluate(() => __khufu.summary.milestones.map((m) => m.t));
  for (const i of [0, Math.floor(n / 2), n - 1]) {
    await marks.nth(i).dispatchEvent('click');
    await page.waitForFunction((t) => __khufu.state.t === t, ms[i]);
  }
});

test('playing moves the time on and the model with it; pausing stops it', async ({ page }) => {
  await openKhufu(page);
  await scrubTo(page, 2000);
  const t0 = await page.evaluate(() => __khufu.timeline.t);
  await page.click('#play');
  expect(await page.evaluate(() => __khufu.timeline.playing)).toBe(true);
  await page.waitForFunction((t0) => __khufu.state.t > t0 + 3600, t0, { timeout: 20_000 });
  await page.click('#play');
  expect(await page.evaluate(() => __khufu.timeline.playing)).toBe(false);
  const t1 = await page.evaluate(() => __khufu.timeline.t);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => __khufu.timeline.t)).toBe(t1);
  // the page's state after play matches a seek straight there
  await page.waitForFunction((t) => __khufu.state.t === t && !__khufu.client.busy, t1);
  const v = modelView(t1);
  expect(await page.evaluate(() => __khufu.state.blocksSet)).toBe(v.blocksSet);
  // playing into the end stops there
  await seekTo(page, (await page.evaluate(() => __khufu.timeline.end)) - 5);
  await page.click('#play');
  await page.waitForFunction(() => !__khufu.timeline.playing && __khufu.timeline.t === __khufu.timeline.end, null, { timeout: 20_000 });
  await expect(page.locator('#where')).toHaveText(/finished monument/);
});
