// Fixed camera views of Khufu at fixed times, for the rendering and detail-bubble tests.
import { seekTo } from './fixtures.mjs';

export const DAY = 36000;
// name, working day, camera: either [x, y, z, tx, ty, tz] or { gangNear: [x, z], dist, height }
// (the camera put `dist` m south-east of the working gang nearest that point, looking at it)
export const VIEWS = [
  { name: 'year-5-overview', day: 1500, cam: [260, 170, 320, 0, 20, 0] },
  { name: 'quarry-gangs', day: 1500, cam: { gangNear: [22.5, 536], dist: 30, height: 15 } },
  { name: 'south-ramp-gangs', day: 1500, cam: { gangNear: [0, 150], dist: 28, height: 14 } },
  { name: 'zigzag-gangs', day: 4500, cam: { gangNear: [70, 60], dist: 30, height: 16 } },
  { name: 'xray-kings-chamber', day: 'end', xray: true, cam: [70, 75, -70, 4, 42, 8] },
  { name: 'finished-far', day: 'end', cam: [-1400, 500, 1500, 0, 40, 0] },
];

// put the page at a view: seek, aim the camera, and hold the frame loop so the picture stays
// still (gangs placed at the view's time, dt 0)
export async function showView(page, v) {
  await page.evaluate(() => { __khufu.hold = false; });
  const t = v.day === 'end' ? await page.evaluate(() => __khufu.summary.endT) : v.day * DAY;
  await seekTo(page, t);
  await page.evaluate(({ v, t }) => {
    const K = __khufu;
    K.setXray(!!v.xray);
    K.bubble.update(t, K.camera, 0);
    if (Array.isArray(v.cam)) K.view(...v.cam);
    else {
      const [x, z] = v.cam.gangNear, p = new K.THREE.Vector3(x, 0, z);
      const g = K.bubble.nearestGang(p), s = K.bubble.sledAt(g, new K.THREE.Vector3());
      const k = v.cam.dist / Math.SQRT2;
      K.view(s.x + k, s.y + v.cam.height, s.z + k, s.x, s.y, s.z);
    }
  }, { v, t });
  // a few real frames for everything that follows the camera (far hull, rooms), then hold
  await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n > 5 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  await page.evaluate((t) => {
    const K = __khufu;
    K.hold = true;
    K.bubble.update(t, K.camera, 0);
    K.works.update(t, false, K.camera);
    K.renderer.render(K.scene, K.camera);
  }, t);
  return t;
}

// only the 3D view in the picture: hide the panels and labels over it
export const HIDE_UI = 'body > :not(canvas) { visibility: hidden !important; }';
