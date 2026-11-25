// Walking: from each walk spot (the "Walk to" buttons) into every room of the finished
// pyramid, with the real walker, pressing Space at the climb prompts (the checks done by
// hand for #6).
import { test, expect, openKhufu } from './fixtures.mjs';
import { NODES, SPOT_NODE, ROOM_NODE, route, walkInPage } from './walk-helpers.mjs';

const SPOT_KEYS = Object.keys(SPOT_NODE);
const ROOMS = Object.keys(ROOM_NODE);


let page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openKhufu(page, '?nolock');
  await page.evaluate(() => { __khufu.hold = true; }); // the test drives the walker's frames
});
test.afterAll(async () => page?.close());

for (const [si, spot] of SPOT_KEYS.entries()) {
  test(`from the ${spot} spot into every room`, async () => {
    const report = [];
    for (const roomId of ROOMS) {
      await page.locator('#rooms button').nth(si).click(); // walk to the spot
      expect(await page.evaluate(() => __khufu.walker.enabled)).toBe(true);
      const names = route(SPOT_NODE[spot], ROOM_NODE[roomId]);
      const pts = names.map((n) => NODES[n]);
      let r = { i: 0 }, climbs = 0;
      for (let guard = 0; guard < 20; guard++) {
        r = await page.evaluate(walkInPage, { pts, i: r.i, maxSeconds: 240 });
        if (r.status !== 'climb') break;
        await expect(page.locator('#climb')).toBeHidden(); // (the frame loop is held: the prompt is shown by it)
        await page.keyboard.press('Space');
        climbs++;
      }
      report.push(`${roomId}: ${r.status} via ${names.join('→')} (${climbs} climbs) at ${r.pos.map((v) => v.toFixed(2))} rooms ${r.rooms}`); console.log(report.at(-1));
      expect.soft(r.status, `${spot} → ${roomId}: ${report.at(-1)}`).toBe('arrived');
      expect.soft(r.room, `${spot} → ${roomId}: ends in the room`).toBe(roomId);
    }

  });
}
