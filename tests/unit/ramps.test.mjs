// Unit tests for the ramp theories (src/khufu/sim/ramps/): layouts, fill and fixed paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTheory, THEORY_IDS } from '../../src/khufu/sim/ramps/index.js';
import { straightRamp } from '../../src/khufu/sim/ramps/straightZigzag.js';
import { squareSpiral, spiralPrefix } from '../../src/khufu/sim/ramps/spiralPath.js';
import { DEFAULTS, withDefaults } from '../../src/khufu/sim/params.js';
import { COURSES, HEIGHT, halfWidthAt } from '../../src/khufu/data.js';

const theory = (id) => createTheory(withDefaults({ ramp: { id } }).ramp);
const LAST = COURSES.length - 1;

test('there are three theories and an unknown one is refused', () => {
  assert.deepEqual(THEORY_IDS, ['straight-zigzag', 'spiral', 'internal']);
  assert.throws(() => createTheory({ ...DEFAULTS.ramp, id: 'levitation' }), /unknown ramp theory/);
});

for (const id of THEORY_IDS) {
  test(`${id}: every course has routes whose segments climb to the course bed`, () => {
    const th = theory(id);
    assert.equal(th.id, id);
    for (let ci = 0; ci <= LAST; ci += 5) {
      const { routes } = th.layout(ci);
      assert.ok(routes.length >= 1);
      const y = COURSES[ci].y0;
      for (const r of routes) {
        const rise = r.segs.reduce((a, s) => a + s.rise, 0);
        assert.ok(Math.abs(rise - y) < 1e-6, `${id} course ${ci}: rise ${rise} to ${y}`);
        for (const s of r.segs) {
          assert.ok(s.length >= s.rise - 1e-9 && Number.isFinite(s.length), `${id} course ${ci}: length ${s.length}`);
          assert.ok(s.lanes >= 1 && s.headway > 0 && s.turns >= 0);
        }
        // the head lies on the edge of the course or inside it (the internal ramp turns no
        // tighter than 4 m from the axis, so near the apex it ends there)
        const m = Math.max(Math.abs(r.head[0]), Math.abs(r.head[1]));
        assert.ok(m <= Math.max(halfWidthAt(y), id === 'internal' ? 4 : 0) + 1e-6, `${id} course ${ci}: head ${m} beyond the course ${halfWidthAt(y)}`);
      }
    }
  });

  test(`${id}: the ramp material grows as the pyramid rises`, () => {
    const th = theory(id);
    let prev = 0;
    for (let ci = 0; ci <= LAST; ci += 3) {
      const f = th.fill(ci);
      assert.ok(Math.abs(Object.values(f.parts).reduce((a, b) => a + b, 0) - f.total) < 1e-6);
      assert.ok(f.total >= prev - 1e-6, `${id} course ${ci}: fill fell from ${prev} to ${f.total}`);
      prev = f.total;
    }
    assert.ok(prev > 1e5, `${id}: ${prev} m³ at the top`);
  });
}

test('straight + zigzag: straight ramps up to the switch, then a zigzag on each face', () => {
  const th = theory('straight-zigzag');
  assert.ok(Math.abs(th.switchY - DEFAULTS.ramp.switchY) < 1.5);
  const below = th.layout(th.switchCi - 1), above = th.layout(th.switchCi + 40);
  assert.equal(below.routes.length, 4);
  assert.ok(below.routes.every((r) => r.segs.length === 1 && r.segs[0].kind === 'straight'));
  assert.ok(above.routes.every((r) => r.segs.map((s) => s.kind).join() === 'straight,zigzag' && r.segs[1].turns > 0));
  // a straight ramp at its grade: run = rise / grade, foot beyond the base
  const S = straightRamp(DEFAULTS.ramp.straight, 30);
  assert.ok(Math.abs(S.run - 30 / DEFAULTS.ramp.straight.grade) < 1e-9);
  assert.ok(S.foot > S.head);
});

test('the top: one route above topY, on the same ramp as below', () => {
  for (const id of ['straight-zigzag', 'spiral']) {
    const th = theory(id), { top } = th;
    assert.ok(Math.abs(top.y - DEFAULTS.ramp.topY) < 1, `${id}: top at ${top.y}`);
    assert.equal(th.layout(top.ci - 1).routes.length, 4);
    for (const ci of [top.ci, LAST - 1, LAST]) {
      const { routes } = th.layout(ci);
      assert.equal(routes.length, 1, `${id} course ${ci}`);
      assert.equal(routes[0].id, DEFAULTS.ramp.topRoute);
      // the same lanes as the route had below, so its queue carries on
      const below = th.layout(top.ci - 1).routes.find((r) => r.id === routes[0].id);
      assert.deepEqual(routes[0].segs.map((s) => s.res), below.segs.map((s) => s.res));
    }
  }
  assert.equal(theory('internal').top, undefined);
  // without topY every route goes to the apex
  const all = createTheory(withDefaults({ ramp: { topY: Infinity } }).ramp);
  assert.equal(all.top, null);
  assert.equal(all.layout(LAST).routes.length, 4);
});

test('spiral and internal: the model climbs exactly the drawn path', () => {
  for (const id of ['spiral', 'internal']) {
    const th = theory(id);
    for (let ci = th.switchCi; ci <= LAST; ci += 11) {
      const y = COURSES[ci].y0;
      for (const r of th.layout(ci).routes) {
        const seg = r.segs.find((s) => s.kind !== 'straight');
        const L = th.ledge(r.id, y);
        assert.ok(Math.abs(L.length - seg.length) < 1e-6, `${id} course ${ci}`);
        assert.equal(L.turns, seg.turns);
        assert.ok(Math.abs(L.pts[L.pts.length - 2] - y) < 1e-3, `${id}: path ends at the course bed`);
      }
    }
  }
  assert.equal(theory('internal').layout(LAST - 1).routes.length, 1);
  assert.equal(theory('spiral').layout(0).routes.length, 4);
});

test('a square spiral keeps its grade and turns at every corner', () => {
  const grade = 0.1, path = squareSpiral({ face: 0, r: (y) => halfWidthAt(y) + 2, grade });
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], run = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (run > 1e-6 && !a[4]) assert.ok(Math.abs((b[1] - a[1]) / run - grade) < 0.02, `segment ${i}: grade ${(b[1] - a[1]) / run}`);
  }
  assert.ok(Math.abs(path[path.length - 1][1] - HEIGHT) < 1e-6);
  const half = spiralPrefix(path, HEIGHT / 2);
  assert.ok(half.turns >= 4 && half.turns === half.cornerIdx.length);
  assert.ok(Math.abs(half.pts[half.pts.length - 2] - HEIGHT / 2) < 1e-4);
});
