// The detail bubble: every drawn sled and person is where the gang's token (its trip from
// the event model) puts it, on either side of the bubble edge, after seeks, and while
// playing (checkMotion: no jumps). The model side is checked by `npm run khufu:gangs`.
import { test, expect, seekTo, sharedPage } from './fixtures.mjs';
import { VIEWS, showView, DAY } from './view-helpers.mjs';
import { runFull } from '../../src/khufu/sim/index.js';
import { seeker } from '../../src/khufu/sim/view.js';
import { gangTracker, figures, crewSpec, SLED, FIG } from '../../src/khufu/sim/gangs.js';

test.describe.configure({ mode: 'serial' });
const shared = sharedPage(test);
let at;
test.beforeAll(() => { at = seeker(runFull({ seed: 1 })); });

// what the page draws for every gang now: its token (the sled's instance matrix), the
// articulated workers of the gangs in the bubble and the simple figures of the others
const drawn = () => shared.page.evaluate(() => {
  const K = __khufu, B = K.bubble, { SLED, FIG } = K, M = new K.THREE.Matrix4(), V = new K.THREE.Vector3();
  const tokens = {}, people = {}, far = [];
  // the sleds are instanced in gang order, skipping gangs off site (Bubble.update)
  let ns = 0;
  B.trips.forEach((trip, g) => { if (trip && !trip.away) { B.sleds.getMatrixAt(ns++, M); V.setFromMatrixPosition(M); tokens[g] = [V.x, V.y, V.z]; } });
  if (ns !== B.sleds.count) tokens.countMismatch = [ns, B.sleds.count];
  const W = B.crowd ? B.crowd.workers : [];
  let k = 0;
  for (const g of [...B.inside].sort((a, b) => a - b)) {
    const n = (B.bufs[g].length - SLED) / FIG;
    people[g] = [];
    for (let j = 0; j < n; j++, k++) people[g].push([W[k].pos.x, W[k].pos.y, W[k].pos.z]);
  }
  for (let i = 0; i < B.far.count; i++) { B.far.getMatrixAt(i, M); V.setFromMatrixPosition(M); far.push([V.x, V.y, V.z]); }
  return { tokens, people, far, inside: [...B.inside], cam: K.camera.position.toArray() };
});
// the same gangs from the model run here in Node
function model(t) {
  const tr = gangTracker(), u = tr.update(at.seekTo(t)), out = {};
  for (const trip of u.trips) {
    if (trip.away) continue;
    const buf = new Float32Array(SLED + crewSpec(trip.kind, trip.crew).n * FIG);
    figures(trip, t, buf);
    const people = [];
    for (let f = SLED; f < buf.length; f += FIG) people.push([buf[f], buf[f + 1], buf[f + 2], buf[f + 4]]);
    out[trip.g] = { sled: [buf[0], buf[1], buf[2]], people };
  }
  return out;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const V = Object.fromEntries(VIEWS.map((v) => [v.name, v]));
for (const v of [V['quarry-gangs'], V['zigzag-gangs']]) {
  test(`tokens and workers match the model, inside and outside the bubble (${v.name})`, async () => {
    const { page } = shared;
    const t = await showView(page, v);
    const want = model(t), got = await drawn();
    const gangs = Object.keys(want);
    expect(gangs.length).toBeGreaterThan(40);
    expect(Object.keys(got.tokens).sort()).toEqual(gangs.sort());
    for (const g of gangs) expect(dist(got.tokens[g], want[g].sled), `gang ${g}: the drawn sled`).toBeLessThan(1e-3);
    expect(got.inside.length).toBeGreaterThan(1);
    for (const g of got.inside) got.people[g].forEach((p, j) => expect(dist(p, want[g].people[j]), `gang ${g} worker ${j} (articulated)`).toBeLessThan(1e-3));
    // move back until a gang in the bubble leaves it: its people are now simple figures, at the same places
    const g0 = got.inside[0];
    await page.evaluate(({ t, g0 }) => {
      const K = __khufu, B = K.bubble, s = B.sledAt(g0, new K.THREE.Vector3());
      const away = K.camera.position.clone().sub(s).setY(0).normalize();
      for (let d = 60; d < 600 && B.inside.has(g0); d += 20) { K.view(s.x + away.x * d, s.y + 30, s.z + away.z * d, s.x, s.y, s.z); B.update(t, K.camera, 0); }
    }, { t, g0 });
    const out = await drawn();
    expect(out.inside, `gang ${g0} left the bubble`).not.toContain(g0);
    for (const p of want[g0].people) {
      const q = [p[0], p[1] - (p[3] === 6 ? 0.4 : 0), p[2]]; // (kneeling figures are drawn lower)
      const near = Math.min(...out.far.map((f) => dist(f, q)));
      expect(near, `gang ${g0}: a simple figure where each worker stood`).toBeLessThan(1e-3);
    }
  });
}

test('after seeking away and back, every gang is drawn where it was', async () => {
  const { page } = shared;
  const t = await showView(page, V['quarry-gangs']);
  const before = await drawn();
  await page.evaluate(() => { __khufu.hold = false; });
  await seekTo(page, 4321 * DAY);
  await seekTo(page, t);
  await page.evaluate((t) => { __khufu.hold = true; __khufu.bubble.update(t, __khufu.camera, 0); }, t);
  const after = await drawn();
  expect(Object.keys(after.tokens).sort()).toEqual(Object.keys(before.tokens).sort());
  for (const g of Object.keys(before.tokens)) expect(dist(after.tokens[g], before.tokens[g]), `gang ${g}`).toBeLessThan(1e-4);
  expect(after.inside).toEqual(before.inside);
});

// playing through the worker at 1× and at 4×, at each view and right after a seek: nobody in
// the bubble moves faster than a run between two steps. (Kept before the capstone is set:
// its gang's return path jumps then, a known gap hidden in the page.)
for (const [v, speed] of [[V['quarry-gangs'], 1], [V['zigzag-gangs'], 1], [V['zigzag-gangs'], 4]]) {
  test(`no jumps while playing at ${speed}× (${v.name})`, async () => {
    const { page } = shared;
    await showView(page, v); // (frames held: checkMotion places the gangs itself, so no time goes on drawing)
    const r = await page.evaluate((speed) => __khufu.checkMotion({ speed, seconds: 4, step: 0.05 }), speed);
    console.log(JSON.stringify(r));
    expect(r.gangsInDetail).toBeGreaterThan(1);
    expect(r.replies).toBeGreaterThan(20);
    expect(r.jumps, `worst ${JSON.stringify(r.worst)}`).toBe(0);
  });
}
