// The detail bubble: every drawn sled and person is where the gang's token (its trip from
// the event model) puts it, on either side of the bubble edge, after seeks, and while
// playing (checkMotion: no jumps). The model side is checked by `npm run khufu:gangs`.
import { test, expect, seekTo, sharedPage } from './fixtures.mjs';
import { VIEWS, showView, DAY } from './view-helpers.mjs';
import { runFull, T, NT, HEAVY } from '../../src/khufu/sim/index.js';
import { seeker, courseSurfaceOf } from '../../src/khufu/sim/view.js';
import { gangTracker, figures, crewSpec, SLED, FIG } from '../../src/khufu/sim/gangs.js';

test.describe.configure({ mode: 'serial' });
const shared = sharedPage(test);
let at, end, capGang;
test.beforeAll(() => {
  const run = runFull({ seed: 1 });
  at = seeker(run); end = run.sim.t;
  // the heavy gang that sets the capstone: its stone is set at the very end of the build
  const G = run.sim.state.gang;
  capGang = G.kind.findIndex((k, g) => k === HEAVY && G.t[g * NT + T.DONE] === end);
});

// what the page draws for every gang now: its token (the sled's instance matrix), the
// articulated workers of the gangs in the bubble and the simple figures of the others
const drawn = () => shared.page.evaluate(() => {
  const K = __khufu, B = K.bubble, { SLED, FIG } = K, M = new K.THREE.Matrix4(), V = new K.THREE.Vector3();
  const tokens = {}, people = {}, far = [];
  // the sleds are instanced in gang order, skipping gangs off site (Bubble.update)
  let ns = 0;
  B.trips.forEach((trip, g) => { if (trip && !trip.away) { B.sleds.getMatrixAt(ns++, M); V.setFromMatrixPosition(M); tokens[g] = [V.x, V.y, V.z]; } });
  const W = B.crowd ? B.crowd.workers : [];
  let k = 0;
  for (const g of [...B.inside].sort((a, b) => a - b)) {
    const n = (B.bufs[g].length - SLED) / FIG;
    people[g] = [];
    for (let j = 0; j < n; j++, k++) people[g].push([W[k].pos.x, W[k].pos.y, W[k].pos.z]);
  }
  for (let i = 0; i < B.far.count; i++) { B.far.getMatrixAt(i, M); V.setFromMatrixPosition(M); far.push([V.x, V.y, V.z]); }
  return { tokens, sleds: { gangs: ns, drawn: B.sleds.count }, people, far, inside: [...B.inside], cam: K.camera.position.toArray() };
});
// the same gangs from the model run here in Node
// (people stand on the stones of the course being laid, as the page draws them)
function model(t) {
  const sim = at.seekTo(t), tr = gangTracker(), u = tr.update(sim), surf = courseSurfaceOf(sim), out = {};
  for (const trip of u.trips) {
    if (trip.away) continue;
    const buf = new Float32Array(SLED + crewSpec(trip.kind, trip.crew).n * FIG);
    figures(trip, t, buf, 0, surf);
    const people = [];
    for (let f = SLED; f < buf.length; f += FIG) people.push([buf[f], buf[f + 1], buf[f + 2], buf[f + 4]]);
    out[trip.g] = { sled: [buf[0], buf[1], buf[2]], people };
  }
  return out;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// every gang drawn where the model puts it at view v, its workers inside the bubble, and the
// people of gang g0 (by default the first in the bubble) as simple figures once it leaves it
async function matchModel(v, { minInside = 2, g0 = null } = {}) {
  const { page } = shared;
  const t = await showView(page, v);
  const want = model(t), got = await drawn();
  const gangs = Object.keys(want);
  expect(gangs.length).toBeGreaterThan(40);
  expect(Object.keys(got.tokens).sort()).toEqual(gangs.sort());
  expect(got.sleds.drawn, 'one sled instance drawn for each gang on site').toBe(got.sleds.gangs);
  for (const g of gangs) expect(dist(got.tokens[g], want[g].sled), `gang ${g}: the drawn sled`).toBeLessThan(1e-3);
  expect(got.inside.length).toBeGreaterThanOrEqual(minInside);
  for (const g of got.inside) got.people[g].forEach((p, j) => expect(dist(p, want[g].people[j]), `gang ${g} worker ${j} (articulated)`).toBeLessThan(1e-3));
  // move back until a gang in the bubble leaves it: its people are now simple figures, at the same places
  if (g0 === null) g0 = got.inside[0];
  expect(got.inside, `gang ${g0} in the bubble`).toContain(g0);
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
}
const V = Object.fromEntries(VIEWS.map((v) => [v.name, v]));
for (const v of [V['quarry-gangs'], V['zigzag-gangs']]) {
  test(`tokens and workers match the model, inside and outside the bubble (${v.name})`, () => matchModel(v));
}

// On the course being laid: gangs crossing it to their landings stand on the stones already
// set (the page builds that surface from the same counts it draws the stones from), and the
// page and the model in Node put every one of them in the same place.
const LANDING = { name: 'landing-gangs', day: 1545.4, cam: { gangNear: [-74.5, -97.7], dist: 25, height: 12 } };
test('on the course being laid, people stand on its stones where the model puts them', async () => {
  await matchModel(LANDING, { minInside: 1 });
  const t = LANDING.day * DAY, sim = at.seekTo(t), surf = courseSurfaceOf(sim);
  expect(surf, 'a course is being laid').not.toBeNull();
  expect(await shared.page.evaluate(() => !!__khufu.bubble.surf), 'the page stands gangs on it').toBe(true);
  // some of them are up on stones already set
  let up = 0;
  for (const g of Object.values(model(t))) for (const p of g.people) if (Math.abs(p[1] - surf.y0 - surf.h) < 0.02 && Math.max(Math.abs(p[0]), Math.abs(p[2])) < surf.hw) up++;
  expect(up, 'people standing on set stones').toBeGreaterThan(0);
});

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
// the bubble moves faster than a run between two steps
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

// The capstone set ends the build. The capstone gang, still on the top, is sent a new trip for
// its walk home at that moment (the model is done): it must go on from where it stood, with
// the camera beside it, played across the moment at 1× and 4× (half the time before it, half
// at the end, where a trip arriving a step late is compared too), and drawn where the model
// puts it, inside and outside the bubble, once it is set.
const capstone = (before = 0) => ({ name: 'capstone', day: 'end', before, cam: { gangNear: [0, 0], dist: 30, height: 15 } });
for (const speed of [1, 4]) {
  test(`no jumps across the capstone set at ${speed}×`, async () => {
    const { page } = shared;
    expect(capGang, 'the capstone gang').toBeGreaterThanOrEqual(0);
    const seconds = 4;
    const t0 = await showView(page, capstone((seconds * speed) / 2));
    expect(await page.evaluate(() => [...__khufu.bubble.inside]), 'the capstone gang in the bubble before the set').toContain(capGang);
    const r = await page.evaluate((speed) => __khufu.checkMotion({ speed, seconds: 4, step: 0.05 }), speed);
    console.log(JSON.stringify(r));
    expect(t0).toBeLessThan(end);
    expect(r.t, 'played across the set (the timeline runs on while the access stair is built)').toBeCloseTo(t0 + seconds * speed, 3);
    expect(r.t).toBeGreaterThan(end);
    expect(r.inDetail, 'the capstone gang in the bubble after the set').toContain(capGang);
    expect(r.replies).toBeGreaterThan(20);
    expect(r.jumps, `worst ${JSON.stringify(r.worst)}`).toBe(0);
  });
}
test('once the capstone is set, its gang and every other is drawn where the model puts it', () => matchModel(capstone(), { minInside: 1, g0: capGang }));
