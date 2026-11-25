// Unit tests for the build planner (src/khufu/sim/planner.js): block grid, rooms, casing,
// roof beams, sectors and the farthest-first setting order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrateCell, classify, summarize, buildPlan, tagOf, VOID, CORE, CASING, DRESSED, COVERED, HEAVY } from '../../src/khufu/sim/planner.js';
import { DEFAULTS } from '../../src/khufu/sim/params.js';
import { createTheory } from '../../src/khufu/sim/ramps/index.js';
import { COURSES, KC_FLOOR, courseAt } from '../../src/khufu/data.js';

const side = calibrateCell(DEFAULTS.targetBlocks);
const D = DEFAULTS.density;
const summary = summarize(side, D);

test('the cell size gives about the target number of blocks', () => {
  assert.ok(side > 0.5 && side < 3, `cell ${side}`);
  const b = summary.totals.blocks;
  assert.ok(Math.abs(b / DEFAULTS.targetBlocks - 1) < 0.01, `${b} blocks for a target of ${DEFAULTS.targetBlocks}`);
});

test('every course has a casing ring and a core; only the pyramidion has no grid', () => {
  for (const ci of [0, 50, 120, COURSES.length - 2]) {
    const p = classify(ci, side, D), n = p.n;
    assert.ok(n > 0);
    for (let i = 0; i < n; i++) for (const idx of [i, (n - 1) * n + i, i * n, i * n + n - 1]) assert.ok([CASING, VOID, COVERED, HEAVY].includes(p.type[idx]), `course ${ci} edge cell ${idx} is ${p.type[idx]}`);
    if (n > 2) assert.ok(p.type.some((t) => t === CORE || t === DRESSED));
  }
  const top = classify(COURSES.length - 1, side, D);
  assert.equal(top.n, 0);
  assert.deepEqual(top.heavy.map((h) => h.kind), ['capstone']);
});

test("the King's Chamber is open, lined with granite and roofed with granite beams across its width", () => {
  const king = tagOf('king');
  const inside = COURSES.findIndex((c) => c.y0 >= KC_FLOOR + 1);
  const p = classify(inside, side, D);
  assert.ok(p.type.some((t, i) => t === VOID && p.elem[i] === king), 'open cells in the chamber');
  assert.ok(p.heavy.some((h) => h.kind === 'lining' && h.elem === king && h.granite), 'granite lining');
  // the course over the chamber: one granite beam per row across its short side
  let roofCi = -1;
  for (let ci = inside; ci < COURSES.length - 1 && roofCi < 0; ci++) if (classify(ci, side, D).heavy.some((h) => h.kind === 'roof' && h.elem === king)) roofCi = ci;
  const beams = classify(roofCi, side, D).heavy.filter((h) => h.kind === 'roof' && h.elem === king);
  // nine as built; the block grid (cells of about 1.2 m) gives one per row along its 10.5 m
  assert.ok(beams.length >= 8 && beams.length <= 10, `${beams.length} beams`);
  assert.ok(beams.every((b) => b.granite && b.span > 5.2 && b.span < 8 && b.axis === beams[0].axis), beams.map((b) => b.span).join(' '));
});

test('room stones are counted in their element totals', () => {
  for (const id of ['queen', 'gallery', 'king', 'relieving', 'antechamber', 'pyramidion']) assert.ok(summary.elemTotal[tagOf(id)] > 0, id);
  assert.equal(courseAt(KC_FLOOR + 0.01) !== null, true);
});

test('a plan puts every block in exactly one sector, set farthest-first from its landing', () => {
  const th = createTheory(DEFAULTS.ramp);
  for (const ci of [0, 30, 100]) {
    const p = buildPlan(ci, side, D, DEFAULTS.sectorM, th.layout(ci));
    assert.ok(p.k >= 2);
    const seen = new Uint8Array(p.n * p.n);
    for (const s of p.sectors) {
      for (const key of ['giza', 'tura']) {
        const list = s[key], d = s[key + 'D'];
        for (let j = 0; j < list.length; j++) { seen[list[j]]++; if (j) assert.ok(d[j] <= d[j - 1] + 1e-4, `course ${ci} sector ${s.id} ${key} order`); }
        for (const i of list) assert.equal(p.type[i] === CASING, key === 'tura');
      }
      assert.ok(s.landing[0] >= s.x0 - 1e-9 && s.landing[0] <= s.x1 + 1e-9 && s.landing[1] >= s.z0 - 1e-9 && s.landing[1] <= s.z1 + 1e-9, 'landing inside its sector');
    }
    for (let i = 0; i < seen.length; i++) {
      const placed = [CORE, DRESSED, CASING].includes(p.type[i]);
      assert.equal(seen[i], placed ? 1 : 0, `course ${ci} cell ${i}`);
    }
    for (const h of p.heavy) assert.ok(h.route >= 0 && h.route < th.layout(ci).routes.length);
  }
});
