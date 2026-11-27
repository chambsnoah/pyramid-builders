// Checks for the special works (Phase 5 "done when": each room is built in the right order
// and can be watched being built).   npm run khufu:works   exits non-zero if a check fails
//
// 1. Order: the rooms are built in an order that could be built: the tunnel is cut and left
//    before the plan moves up into the masonry; the Queen's Chamber is roofed before the
//    Grand Gallery above its passage is finished; the King's Chamber walls stand before its
//    beams go on, and its roof before the relieving chambers', which are roofed from the
//    lowest up; the plugs are lowered into the gallery before it is roofed over them and slid
//    down last, before the capstone; and so on.
// 2. Each room can be watched: its stones are set over a span of time (not all at once), and
//    the tunnel and the plugs move continuously (no jumps between 1 s steps).
// 3. The tunnelling rate the schedule implies is plausible for copper tools in limestone.
// 4. Where the plugs rest: inside the gallery's central channel while stored, filling the
//    lower end of the ascending passage at the end.
// 5. The access stair: not there while the pyramid (and its ramps) are being built, then
//    built after the capstone in layers at the course heights, and finished at the end of
//    the timeline.
import { runFull, DAY, YEAR, ELEM, tagOf } from '../src/khufu/sim/index.js';
import { runSummary } from '../src/khufu/sim/view.js';
import { worksSchedule, tunnelAt, diggersAt, plugsAt, stairAt, STAIR_LAYERS, MAX_DIGGERS, DIG, FIGURE, FIG_S, PLUGS, PLUG_SIZE } from '../src/khufu/sim/works.js';
import * as THREE from 'three';
import { COURSES, ELEMENTS, LEVELS, ENTRANCE_Y, floorY, ceilY } from '../src/khufu/data.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const day = (t) => `day ${(t / DAY).toFixed(1)}`;

const run = runFull({ seed: 1 });
const sum = runSummary(run), W = sum.works, S = run.sim.state;
console.log(`full run, hash ${sum.hash}, ends ${day(sum.endT)}`);
check(sum.hash === '9b89b2cc698ebefb', `the event model's hash is the current one (seasons, levy rotation, one ramp at the top; hash ${sum.hash})`);

// ---- when each room's stones are set, from the course plans --------------------------
// first and last course holding a stone of each element, and of its roof beams
const span = {};
for (let c = 0; c < COURSES.length; c++) {
  const p = run.sim.plan(c);
  const note = (tag, kind) => { const k = ELEM[tag - 1] + (kind ? `:${kind}` : ''); const s = (span[k] ||= [c, c]); s[1] = c; };
  for (let i = 0; i < p.elem.length; i++) if (p.elem[i] && (p.type[i] === 1 || p.type[i] === 2 || p.type[i] === 3)) note(p.elem[i]);
  for (const h of p.heavy) { note(h.elem); note(h.elem, h.kind); }
  run.sim.ctx.plans.delete(c);
}
const first = (k) => S.courseOpen[span[k][0]], last = (k) => S.courseDone[span[k][1]];
const T = Object.fromEntries(W.order.map((w) => [w.id, w.t]));
console.log('  the special works in order:');
for (const w of W.order) console.log(`    ${day(w.t).padEnd(11)} ${w.label}`);

// ---- 1. order ----------------------------------------------------------------------------
const before = (a, b, what) => check(a <= b, `${what} (${day(a)} ≤ ${day(b)})`);
before(T['subterranean-stop'], T['ascending-start'], 'the subterranean chamber is left before the ascending passage is begun');
before(W.stages[0].t1, W.stages[1].t0, 'the descending passage reaches the bottom before the horizontal passage is cut');
before(first('queen:roof'), T.queen, "the Queen's Chamber is roofed with beams");
before(T.queen, T.gallery, "the Queen's Chamber is roofed before the Grand Gallery is finished");
before(last('king:lining'), first('king:roof'), "the King's Chamber's granite walls are all set before its first roof beam");
before(T.king, T['relieving-1'], "the King's Chamber is roofed before the first relieving chamber");
check(W.relieving.every((r, i) => i === 0 || W.relieving[i - 1].t < r.t), `the relieving chambers are roofed from the lowest up (courses ${W.relieving.map((r) => r.course + 1).join(', ')})`);
check(W.relieving.every((r) => r.yTop > LEVELS.kingsChamber.y1), 'every relieving chamber is above the King\'s Chamber');
before(T['plugs-stored'], T['gallery-roof-over-plugs'], 'the plugs are lowered into the gallery before it is roofed over them');
before(T.antechamber, T.king, "the antechamber's granite is set before the King's Chamber is roofed");
before(T.queen, T['queen-shafts'], "the Queen's Chamber shafts are finished after the chamber");
before(T.king, T['king-shafts'], "the King's Chamber shafts are finished after the chamber");
const others = W.order.filter((w) => w.id !== 'plugged' && w.id !== 'pyramidion' && w.id !== 'stair').map((w) => w.t);
before(Math.max(...others), W.plugs.slide[0][0], 'the plugs are slid down after every other room is finished');
before(T.plugged, T.pyramidion, 'the ascending passage is plugged before the end of the build');
check(sum.milestones.some((m) => m.label === 'Subterranean chamber left unfinished') && sum.milestones.some((m) => m.label === 'Ascending passage plugged'), 'the milestones include the tunnel and the plugs');

// ---- 2. watchable: each room's stones over a span of time --------------------------------
for (const id of ['queen', 'gallery', 'antechamber', 'king', 'relieving', 'queen-shafts', 'king-shafts']) {
  const a = first(id), b = last(id);
  check(b - a > 5 * DAY, `${id}: built over ${((b - a) / DAY).toFixed(0)} working days (courses ${span[id][0] + 1}–${span[id][1] + 1})`);
}
// continuity: the face, the tunnellers and the plugs between 1 s steps
function play(name, from, seconds, fn, vmax) {
  let prev = null, worst = 0, at = 0;
  for (let t = from; t <= from + seconds; t += 1) {
    const p = fn(t);
    if (prev) for (let i = 0; i < p.length; i++) {
      if (!p[i] || !prev[i]) continue;
      const d = Math.hypot(p[i][0] - prev[i][0], p[i][1] - prev[i][1], p[i][2] - prev[i][2]);
      if (d > worst) { worst = d; at = t; }
    }
    prev = p;
  }
  check(worst <= vmax, `${name}: fastest move ${worst.toFixed(3)} m/s (≤ ${vmax}) ${worst ? `at ${day(at)}` : ''}`);
}
const buf = new Float32Array(MAX_DIGGERS * DIG), pbuf = new Float32Array(PLUGS.length * 5);
const people = (t) => { diggersAt(W, t, buf); return Array.from({ length: MAX_DIGGERS }, (_, i) => (buf[i * DIG + 4] === 2 ? null : [buf[i * DIG], buf[i * DIG + 1], buf[i * DIG + 2]])); };
const plugs = (t) => { plugsAt(W, t, pbuf); return PLUGS.map((_, k) => (pbuf[k * 5 + 4] ? [pbuf[k * 5], pbuf[k * 5 + 1], pbuf[k * 5 + 2]] : null)); };
for (const [i, st] of W.stages.entries()) play(`tunnellers, ${st.name}`, (st.t0 + st.t1) / 2, 900, people, 1.6);
play('tunnellers, from the descending passage into the horizontal one', W.stages[1].t0 - 450, 900, people, 1.6);
play('tunnellers, from the passage into the chamber', W.stages[2].t0 - 450, 900, people, 1.6);
play('tunnellers, the chamber heading widening', W.stages[2].t0 + (W.stages[2].t1 - W.stages[2].t0) * 0.12 - 3600, 7200, people, 1.6);
play('tunnellers, from the chamber into the blind passage', W.stages[3].t0 - 450, 900, people, 1.6);
{ // where the carriers' way across the chamber turns into the blind passage (face at z1 − 0.5)
  const st = W.stages[2], ch2 = ELEMENTS.find((e) => e.id === 'subterranean').voids[1];
  const tTurn = st.t0 + ((st.t1 - st.t0) * (ch2.z1 - 0.5 - st.z0)) / (st.z1 - st.z0);
  play('tunnellers, the way turning into the blind passage', tTurn - 1800, 3600, people, 1.6);
}
play('plugs being lowered into the gallery', W.plugs.lower[0][0] - 60, W.plugs.lower[2][1] - W.plugs.lower[0][0] + 120, plugs, 0.2);
play('plugs sliding down the ascending passage', W.plugs.slide[0][0] - 60, W.plugs.slide[2][1] - W.plugs.slide[0][0] + 120, plugs, 0.45);
// the face only ever moves south, and stops for good when the work is left
let zPrev = -Infinity, back = 0;
for (let t = 0; t <= W.stop + 10 * DAY; t += DAY / 4) { const tn = tunnelAt(W, t), z = tn.face ? tn.face.z : tn.desc === Infinity ? Infinity : tn.desc; if (tn.face && z < zPrev - 1e-9) back++; if (tn.face) zPrev = z; }
check(back === 0 && !tunnelAt(W, W.stop + 1).face, 'the working face only advances, and work stops when the chamber is left');

// the tunnellers stand in the part already cut, never inside the uncut rock
{
  const voids = ['descending', 'subterranean'].flatMap((id) => ELEMENTS.find((e) => e.id === id).voids);
  const solids = ELEMENTS.find((e) => e.id === 'subterranean').solids;
  let bad = 0, n = 0, tall = 0, sunk = 0, out_ = 0, ahead = 0;
  // the drawn figure's vertices (bubble.js farFigureGeometry is built from the same FIGURE)
  const figVerts = FIGURE.flatMap((p) => Array.from((p.sphere ? new THREE.SphereGeometry(...p.sphere) : new THREE.CylinderGeometry(...p.cyl)).translate(...p.at).attributes.position.array));
  const M = new THREE.Matrix4(), V3 = new THREE.Vector3(), Qn = new THREE.Quaternion(), Eu = new THREE.Euler(), Sc = new THREE.Vector3();
  for (let t = 0; t < W.stop; t += DAY / 3) {
    const tn = tunnelAt(W, t), face = tn.desc < Infinity ? tn.desc : tn.sub;
    diggersAt(W, t, buf);
    for (let i = 0; i < MAX_DIGGERS; i++) {
      const o = i * DIG;
      if (buf[o + 4] === 2) continue;
      const x = buf[o], y = buf[o + 1], z = buf[o + 2];
      // the figure as drawn (the same geometry and transform as the page): every vertex under
      // the roof, none in the floor, and the lowest touching it
      M.compose(V3.set(x, y - buf[o + 6], z), Qn.setFromEuler(Eu.set(buf[o + 5], buf[o + 3], 0, 'YXZ')), Sc.setScalar(FIG_S));
      let low = Infinity;
      for (let k = 0; k < figVerts.length; k += 3) {
        V3.set(figVerts[k], figVerts[k + 1], figVerts[k + 2]).applyMatrix4(M);
        if (V3.z > face + 0.005) { ahead++; if (ahead < 4) console.log(`    tunneller ${i} on ${day(t)}: ${(V3.z - face).toFixed(3)} m past the face (lean ${buf[o + 5].toFixed(2)}, feet z ${z.toFixed(2)}, face ${face.toFixed(2)})`); continue; }
        const under = voids.filter((v) => V3.x >= v.x0 && V3.x <= v.x1 && V3.z >= v.z0 && V3.z <= v.z1);
        if (!under.length) { out_++; continue; } // a point outside every void (counted below)
        const floor = Math.max(...under.map((v) => floorY(v, V3.z))), roof = Math.min(...under.map((v) => ceilY(v, V3.z)));
        low = Math.min(low, V3.y - floor);
        if (V3.y > roof + 0.005) { tall++; if (tall < 4) console.log(`    tunneller ${i} on ${day(t)}: ${(V3.y - roof).toFixed(3)} m into the roof`); break; }
      }
      if (low < -0.005 || low > 0.06) { sunk++; if (sunk < 4) console.log(`    tunneller ${i} on ${day(t)}: lowest point ${low.toFixed(3)} m from the floor`); }
      n++;
      const inVoid = voids.some((v) => x >= v.x0 && x <= v.x1 && z >= v.z0 - 0.05 && z <= v.z1 + 0.05 && y >= floorY(v, z) - 0.05 && y < ceilY(v, z));
      const inRock = z > face + 0.01 || solids.some((v) => x > v.x0 + 0.05 && x < v.x1 - 0.05 && z > v.z0 && z < v.z1 && y < ceilY(v, z) - 0.05);
      if (!inVoid || inRock) { bad++; if (bad < 4) console.log(`    tunneller ${i} at ${[x, y, z].map((q) => q.toFixed(2))} on ${day(t)}: in the cut ${inVoid}, in rock ${inRock}`); }
    }
  }
  check(n > 1000 && bad === 0, `the tunnellers stand in the cut, never in the rock (${n} placings)`);
  check(tall === 0, 'every tunneller, as drawn, fits under the roof: stooping in the passages, bent double in the 0.91 m horizontal passage and the 0.75 m blind passage');
  check(ahead === 0, `no part of a drawn tunneller reaches past the working face into the rock (${ahead} vertices)`);
  check(out_ === 0, `no part of a drawn tunneller sticks out of the cut sideways (${out_} vertices)`);
  check(sunk === 0, 'every tunneller, as drawn, stands on the floor: nothing below it, the lowest point within 6 cm of it');
}

// ---- 3. tunnelling rate ------------------------------------------------------------------
for (const st of W.stages) console.log(`  ${st.name.padEnd(22)} ${day(st.t0)} – ${day(st.t1)}: ${st.mPerDay.toFixed(3)} m a day`);
const passages = W.stages.filter((s) => s.name !== 'subterranean chamber');
check(passages.every((s) => s.mPerDay > 0.1 && s.mPerDay < 0.5), 'the passages advance 0.1–0.5 m a working day (a crew with copper chisels and pounders in limestone)');
const ch = W.stages.find((s) => s.name === 'subterranean chamber'), sub = LEVELS.subterranean;
const m3 = ((sub.x1 - sub.x0) * (sub.y1 - sub.y0) * ch.mPerDay);
check(m3 > 0.5 && m3 < 6, `the chamber is cut at about ${m3.toFixed(1)} m³ a working day (0.5–6)`);

// ---- 4. where the plugs are --------------------------------------------------------------
const gal = ELEMENTS.find((e) => e.id === 'gallery').voids[0], asc = ELEMENTS.find((e) => e.id === 'ascending').voids[0];
// each plug as a block: its eight corners from the centre, its size and its pitch (its long
// axis rises southward); every corner within the passage, its underside on the floor
function plugFits(v, k, what) {
  const o = k * 5, p = pbuf[o + 3], len = PLUGS[k].len, [w, h] = PLUG_SIZE;
  const u = [0, Math.sin(p), Math.cos(p)], n = [0, Math.cos(p), -Math.sin(p)];
  let ok = true, gap = 0;
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) {
    const x = pbuf[o] + (c * w) / 2, y = pbuf[o + 1] + (a * len / 2) * u[1] + (b * h / 2) * n[1], z = pbuf[o + 2] + (a * len / 2) * u[2] + (b * h / 2) * n[2];
    if (x < v.x0 - 1e-6 || x > v.x1 + 1e-6 || z < v.z0 - 1e-6 || z > v.z1 + 1e-6 || y < floorY(v, z) - 0.02 || y > ceilY(v, z) + 0.02) ok = false;
    if (b === -1) gap = Math.max(gap, Math.abs(y - floorY(v, z)));
  }
  if (!ok || gap > 0.02) console.log(`    plug ${k + 1} ${what}: inside ${ok}, underside ${gap.toFixed(3)} m off the floor`);
  return ok && gap <= 0.02;
}
// (stored on the gallery floor: the floor of its central channel, between the benches)
const galCh = { ...gal, x0: asc.x0, x1: asc.x1 };
plugsAt(W, W.plugs.lower[2][1] + DAY, pbuf);
check(PLUGS.every((_, k) => plugFits(galCh, k, 'stored')), 'the stored plugs lie whole inside the Grand Gallery\'s central channel, on its floor');
plugsAt(W, sum.endT, pbuf);
check(PLUGS.every((_, k) => plugFits(asc, k, 'at the end')), 'at the end the plugs lie whole inside the lower end of the ascending passage, on its floor');
const low = pbuf[2] + (PLUG_SIZE[1] / 2) * Math.sin(pbuf[3]) - (PLUGS[0].len / 2) * Math.cos(pbuf[3]); // its bottom edge, on the floor
check(Math.abs(low - LEVELS.ascendingStartZ) < 0.2, `the lowest plug's lower end is at the bottom of the ascending passage (z ${low.toFixed(2)} vs ${LEVELS.ascendingStartZ.toFixed(2)})`);

// ---- 5. the access stair -----------------------------------------------------------------
const st = W.stair, stairDays = (st.t1 - st.t0) / DAY;
console.log(`  access stair: ${STAIR_LAYERS.length} layers over ${stairDays.toFixed(1)} working days, ${day(st.t0)} to ${day(st.t1)}`);
check(st.t0 === sum.endT && sum.finishT === st.t1, 'the stair is begun when the capstone is set, and the timeline ends when it is finished');
check([0, sum.endT / 2, sum.endT - 1, sum.endT].every((t) => stairAt(W, t) === 0), 'no stair stands while the pyramid and its ramps are being built');
check(stairAt(W, st.t1) === ENTRANCE_Y, `finished, the stair reaches the entrance (${stairAt(W, st.t1).toFixed(2)} m)`);
check(STAIR_LAYERS.every(([y], i) => i === STAIR_LAYERS.length - 1 ? y === ENTRANCE_Y : Math.abs(y - COURSES[i].y1) < 1e-9), 'its layers are laid at the heights of the pyramid\'s courses');
{ // it rises layer by layer, never down, a layer at a time
  let prev = 0, ok = true, seen = 0;
  for (let t = st.t0; t < st.t1 + 600; t += 600) { const y = stairAt(W, t); if (y < prev || (y > prev && STAIR_LAYERS.findIndex(([h]) => h === y) !== STAIR_LAYERS.findIndex(([h]) => h === prev) + 1)) ok = false; if (y !== prev) seen++; prev = y; }
  check(ok && seen === STAIR_LAYERS.length, `it rises one layer at a time (${seen} layers seen in 10-minute steps)`);
}
check(stairDays > 10 && stairDays < 60, `it takes a crew ${stairDays.toFixed(0)} working days (10–60)`);
check(sum.milestones.some((m) => m.label === 'Access stair built' && m.t === st.t1), 'the milestones include the access stair');
void tagOf; void YEAR;

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
