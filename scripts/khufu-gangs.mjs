// Checks for the detail bubble (Phase 4 "done when": zooming onto any working ramp shows
// correct, continuous animation that matches the event model). Uses the same seeker(),
// gangTracker() and figures() as the worker and the page.
//   npm run khufu:gangs                   exits non-zero if a check fails
//   npm run khufu:gangs -- --ramp spiral  the same checks for another ramp theory
//
// 1. Continuity: plays short windows second by second, as the page does (a seek per step,
//    keeping each gang's latest trip), and checks that no sled, stone or crew member moves
//    faster than a man can walk between two steps: early, middle, late, across a month
//    boundary (the seeker restores a snapshot there), across a course completion, on the
//    zigzag and across the capstone set at the very end.
// 2. Late trips: the page draws with the trips of its last reply, a frame or more old. A trip
//    read at t1 must give the same pose at t2 > t1 as the trip read at t2, up to its last knot.
// 3. Model match: at the model's own event times the sled is where the model says: at the
//    ramp foot when the model lets it into the lane (or a gang length behind, when another
//    gang entered just before), on the landing (or by the heavy stone's place) while it
//    unloads, passing the top of a straight ramp close to the model's time; and what each
//    gang is doing agrees with its task in the model. Also reported: how often two working
//    gangs are drawn on top of each other.
// 4. The special works: roof beams levered across their openings.
// 5. Nobody walks through anything: at 60 moments over the build, every person of every gang
//    placed as the page places them (on the course being laid as it is drawn), and counted:
//    people of two gangs in the same spot, people inside another gang's sled, people inside
//    the stones already set, and people standing in the air or in the ground.
import { runFull, DAY, MONTH, YEAR, T, NT, TASK, HEAVY, tagOf } from '../src/khufu/sim/index.js';
import * as View from '../src/khufu/sim/view.js';
import { COURSES, halfWidthAt } from '../src/khufu/data.js';
import * as Gangs from '../src/khufu/sim/gangs.js';
const { gangTracker, gangTrips, figures, crewSpec, tokenAt, tripHorizon, capBack, rampScene, terrainY, ACT, ACT_NAME, SLED, FIG, KN } = Gangs;

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const t0 = performance.now();
const ri = process.argv.indexOf('--ramp'), rampId = ri > 0 ? process.argv[ri + 1] : null;
const run = runFull(rampId ? { seed: 1, ramp: { id: rampId } } : { seed: 1 });
console.log(`ramp theory: ${run.sim.ctx.theory.name}`);
const end = run.sim.t, S0 = run.sim.state;
console.log(`full run ${((performance.now() - t0) / 1000).toFixed(2)} s, ends day ${Math.floor(end / DAY)}, hash ${run.sim.hash()}`);
const at = View.seeker(run);

const size = (trip) => SLED + crewSpec(trip.kind, trip.crew).n * FIG;
// m/s: a run, faster than anyone in a gang moves. Hauling is 0.55, walking back 1.1 (up to
// 1.4 where the drawn way is longer than the model's, as on the zigzag), regrouping 1.2, and
// a man on the outside of a hairpin turns about twice as fast as the sled for a moment. The
// discontinuities this check has caught were all above 4.5 m/s.
const VMAX = 3.5;

// ---- 1. continuity --------------------------------------------------------------------
function play(name, from, seconds, dt = 1) {
  const tr = gangTracker(), trips = new Map();
  let prev = null, worst = { v: 0 }, nan = 0, sent = 0, steps = 0, people = 0;
  const stale = { n: 0, worst: 0 };
  const cur = new Map(), old = new Map();
  for (let t = from; t <= from + seconds + 1e-9; t += dt) {
    const sim = at.seekTo(t);
    const u = tr.update(sim);
    // (the course being laid as the page draws it: people stand on its stones)
    const surf = View.courseSurfaceOf ? View.courseSurfaceOf(sim) : null;
    sent += u.trips.length;
    const before = new Map(trips);
    for (const trip of u.trips) trips.set(trip.g, trip);
    // 2. the trip from the previous reply, evaluated now, agrees with the new one
    for (const trip of u.trips) {
      const o = before.get(trip.g);
      if (!o || t > tripHorizon(o) || o.sig.split('|')[1] !== trip.sig.split('|')[1]) continue; // a new trip, or past what the old one knew
      const a = new Float32Array(size(o)), b = new Float32Array(size(trip));
      figures(o, t, a, 0, surf); figures(trip, t, b, 0, surf);
      if (a.length !== b.length) continue;
      let d = 0;
      for (let i = 0; i < a.length; i = i ? i + FIG : SLED) d = Math.max(d, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
      stale.n++; if (d > stale.worst) { stale.worst = d; stale.at = `gang ${trip.g} day ${(t / DAY).toFixed(4)}`; }
    }
    for (const [g, trip] of trips) {
      const buf = cur.get(g) || new Float32Array(size(trip));
      if (buf.length !== size(trip)) { cur.set(g, new Float32Array(size(trip))); continue; }
      const tok = figures(trip, t, buf, 0, surf);
      cur.set(g, buf);
      const p = old.get(g);
      const n = (buf.length - SLED) / FIG;
      if (prev !== null && p && p.length === buf.length) {
        // the sled, the stone and each person
        const pts = [[0, 'sled'], [5, 'stone'], ...Array.from({ length: n }, (_, j) => [SLED + j * FIG, `man ${j}`])];
        for (const [o, who] of pts) {
          if (o === 5 && (!buf[8] || !p[8])) continue; // the stone appears or is set down
          const d = Math.hypot(buf[o] - p[o], buf[o + 1] - p[o + 1], buf[o + 2] - p[o + 2]);
          if (!Number.isFinite(d)) { nan++; continue; }
          const v = d / dt;
          if (v > worst.v) worst = { v, g, who, t, act: ACT_NAME[tok.act], d };
        }
      }
      people += n;
      old.set(g, Float32Array.from(buf));
    }
    prev = t; steps++;
  }
  const w = worst.v ? `${worst.v.toFixed(2)} m/s (gang ${worst.g}, ${worst.who}, ${worst.act}, day ${(worst.t / DAY).toFixed(3)})` : '0';
  console.log(`  ${name.padEnd(34)} ${steps} steps of ${dt} s, ${trips.size} gangs, ${Math.round(people / steps)} people, ${sent} trips sent; fastest ${w}; late trips: ${stale.n} compared, worst ${stale.worst.toFixed(3)} m${stale.worst > 0.05 ? ` (${stale.at})` : ''}`);
  const G = run.sim.state.gang.kind.length;
  check(trips.size === G && people > 0, `${name}: the tracker delivers all ${G} gangs (${trips.size})`);
  check(nan === 0, `${name}: no NaN`);
  check(worst.v <= VMAX, `${name}: nobody moves faster than ${VMAX} m/s between steps`);
  // (only meaningful at fine steps: news about a gang ahead in a queue reaches the others at
  // the next step, so with 20 s steps a queue moves up to 20 s late)
  if (dt <= 1) check(stale.worst < 0.05, `${name}: a trip read a step late gives the same places`);
  return worst;
}

const course = (n) => S0.courseDone[n];
const sw = run.sim.ctx.theory.switchY;
const zigCourse = Number.isFinite(sw) ? COURSES.findIndex((c) => c.y0 > sw + 5) : -1;
const above = { 'straight-zigzag': 'the zigzag', spiral: 'the spiral', internal: 'the internal ramp' }[run.sim.ctx.theory.id] || 'the upper ramp';
const windows = [
  ['early: day 20, 08:00', 19 * DAY + 2 * 3600, 900],
  ['middle: year 10', 10 * YEAR + 4 * 3600, 900],
  ['late: year 19.5', 19.5 * YEAR + 4 * 3600, 900],
  ['across a month boundary (year 4)', 4 * YEAR + 3 * MONTH - 300, 600],
  ['across course 20 complete', course(19) - 300, 600],
  ['across course 120 complete', course(119) - 300, 600],
  ['a levy group arriving (year 4, month 4)', 4 * YEAR + 3 * MONTH + run.sim.P.rotation.changeoverHours * 3600 - 300, 600],
  ['high up: course 150', S0.courseOpen[149] + DAY + 3600, 900],
];
if (zigCourse > 0) windows.push([`on ${above} (course ${zigCourse + 1})`, S0.courseOpen[zigCourse] + 2 * DAY + 3600, 1200]);
for (const [name, t, len] of windows) play(name, t, len);
// the capstone set: the build is done, and the capstone gang, still on the top, gets a new
// trip for its walk home; it must start where the last one left it. (Quarter-second steps,
// ending exactly on the end: a jump of a couple of metres is under VMAX at 1 s steps.)
play('across the capstone set (the end)', end - 120, 120, 0.25);
// a coarser pass over a whole working day, as at 1 min/s
play('a whole day in 20 s steps (year 7)', 7 * YEAR + 30 * DAY, DAY, 20);

// ---- 3. model match ---------------------------------------------------------------------
const roofBeams = { n: 0, bad: 0, worst: 0 }; // filled by sections 3 and 4
{
  const P = run.sim.P;
  let n = 0, worst = 0, worstAt = '', bad = 0, acts = 0, actBad = 0;
  const headErr = [];
  let close = 0, pairs = 0, moving = 0;
  const beams = { n: 0, bad: 0, worst: 0 };
  const buf = new Float32Array(SLED + 200 * FIG);
  for (let k = 0; k < 60; k++) {
    const t = (0.3 + k * 0.33) * YEAR + (k % 10) * 3600;
    if (t >= end) break;
    const sim = at.seekTo(t), G = sim.state.gang;
    const trips = gangTrips(sim);
    // sleds closer than 1.5 m to another gang's (both out of the yards): the model lets a
    // faster gang catch up with a slower one in the same lane, so some overlap is expected
    const at3 = [];
    for (const trip of trips) { const tk = figures(trip, t, buf); if (tk.act !== ACT.IDLE) at3.push([buf[0], buf[1], buf[2]]); }
    for (let i = 0; i < at3.length; i++) for (let j = i + 1; j < at3.length; j++) { pairs++; if (Math.hypot(at3[i][0] - at3[j][0], at3[i][1] - at3[j][1], at3[i][2] - at3[j][2]) < 1.5) close++; }
    moving += at3.length;
    for (const trip of trips) {
      const g = trip.g, tb = g * NT, task = G.task[g];
      // what the gang is doing now agrees with the model
      const tok = tokenAt(trip, t);
      acts++;
      const okAct = task === TASK.WAITING || task === TASK.AWAY ? tok.act === ACT.IDLE
        : task === TASK.RETURNING ? tok.act === ACT.RETURN || (tok.act === ACT.IDLE && t >= G.t[tb + T.HOME] - 1e-6) || tok.act === ACT.UNLOAD || tok.act === ACT.SET
        : tok.act !== ACT.IDLE && tok.act !== ACT.RETURN || t < G.t[tb + T.START] || t >= G.t[tb + T.DONE];
      if (!okAct) { actBad++; if (actBad < 4) console.log(`    gang ${g} task ${task} shows ${ACT_NAME[tok.act]} at day ${(t / DAY).toFixed(2)}`); }
      if (task === TASK.WAITING || G.course[g] < 0 || G.t[tb + T.FOOT] > t) continue;
      const plan = sim.ctx.plans.get(G.course[g]) || sim.plan(G.course[g]);
      const rt = plan.layout.routes[G.route[g]];
      const heavy = trip.kind === HEAVY;
      const tol = trip.lane + 0.3;
      // at the foot when the model has it there; on the landing (or by the heavy stone's
      // place) halfway through unloading or setting
      // (a gang waiting in a queue at the foot is held back by the gangs ahead: check it when
      // the model lets it into the lane, allowing for one that entered just before)
      const mid = (G.t[tb + T.UNLOAD] + G.t[tb + T.DONE]) / 2;
      const climb = G.t[tb + T.CLIMB], cap = (trip.caps || []).find((cp) => cp.s === trip.caps[0]?.s && cp.t1 === climb);
      const targets = [[climb, rt.foot, 'foot', cap ? capBack(cap, climb) : 0]];
      // (a berth by the edge of the course is moved over, so that both gangs stand on it)
      if (!heavy) targets.push([mid, plan.sectors[G.sector[g]].landing, 'landing', Math.max(2.4, Math.abs(trip.berth?.[0] ?? 0))]);
      else {
        // by the stone's place, or for a roof beam clear of its opening (it.stand); and the beam
        // lies on its walls, at its place and heading, as the setting ends
        const it = plan.heavy[G.sector[g]];
        targets.push([mid, it.stand || [it.x, it.z], it.stand ? 'beam stand' : 'stone place', 0]);
        const done = G.t[tb + T.DONE];
        if (trip.place && done - 1 <= t && done - 1 <= tripHorizon(trip)) {
          figures(trip, done - 1, buf);
          const pl = trip.place, d = Math.hypot(buf[5] - pl[0], buf[6] - pl[1], buf[7] - pl[2]);
          const turn = Math.abs(Math.sin(buf[9] - pl[3]));
          beams.n++; beams.worst = Math.max(beams.worst, d, turn);
          if (d > 0.02 || turn > 0.02) { beams.bad++; if (beams.bad < 4) console.log(`    gang ${g}: beam ${d.toFixed(3)} m from its place, heading off by ${turn.toFixed(3)}`); }
        }
      }
      for (const [tk, p, what, extra] of targets) {
        if (!p || !(tk <= t + 1e-6) || tk > tripHorizon(trip)) continue;
        figures(trip, tk, buf);
        const d = Math.hypot(buf[0] - p[0], buf[2] - p[1]);
        n++;
        if (d > worst) { worst = d; worstAt = `gang ${g} at the ${what}, day ${(tk / DAY).toFixed(2)}`; }
        if (d > tol + extra) { bad++; if (bad < 4) console.log(`    gang ${g} ${d.toFixed(2)} m from the ${what} (allowed ${(tol + extra).toFixed(2)})`); }
      }
      // the top of a straight ramp: the drawn ramp is not the model's to the metre, so the
      // sled passes the head a little before or after the model's time; how much, as a share
      // of the time from the foot to the landing
      if (rt.segs.length === 1 && rt.segs[0].kind === 'straight' && G.t[tb + T.LAND] <= t && G.t[tb + T.LAND] <= tripHorizon(trip)) {
        const a = G.t[tb + T.CLIMB], b = G.t[tb + T.LAND];
        let lo = a, hi = b;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; figures(trip, m, buf); if (Math.max(Math.abs(buf[0]), Math.abs(buf[2])) > Math.max(Math.abs(rt.head[0]), Math.abs(rt.head[1])) + 0.01) lo = m; else hi = m; }
        if (b > a + 1) headErr.push(Math.abs(lo - G.t[tb + T.TOP]) / (b - a));
      }
    }
  }
  console.log(`  ${n} event times checked over the build; sled farthest ${worst.toFixed(2)} m from the model's point (${worstAt}; lanes are 1.4 and 3.6 m off the centre line, berths 2.4 m to either side, plus a gang length behind another)`);
  check(n > 100 && bad === 0, 'the sled is at the ramp foot and on the landing at the model\'s times');
  // (the roof beams are only set in a few courses, so these come from section 4 below as well)
  roofBeams.n += beams.n; roofBeams.bad += beams.bad; roofBeams.worst = Math.max(roofBeams.worst, beams.worst);
  console.log(`  overlap: ${close} pairs of working gangs with sleds under 1.5 m apart, at 60 moments with ${moving} working gangs in all`);
  headErr.sort((a, b) => a - b);
  const med = headErr[headErr.length >> 1] ?? 0, max = headErr.at(-1) ?? 0;
  console.log(`  top of the straight ramp: ${headErr.length} climbs, the sled passes the head ${(med * 100).toFixed(1)} % (median), ${(max * 100).toFixed(1)} % (worst) of the climb off the model's time`);
  if (run.sim.ctx.theory.switchY > 0) check(headErr.length > 50 && med < 0.05, 'the sled reaches the top of the straight ramp close to the model\'s time');
  check(actBad === 0, `what each gang does agrees with its task in the model (${acts} checked)`);
  void P; void KN;
}

// ---- 4. the special works: roof beams levered across their openings --------------------
// For each course that is roofed with beams (Queen's Chamber, Grand Gallery, King's Chamber,
// the five relieving chambers), find the heavy gangs setting a beam, check that the beam
// ends on its place across the opening, and play the arrival, the levering and the end of
// one setting for continuity.
{
  const roofCourses = [];
  let kingRoof = -1;
  for (let c = 0; c < COURSES.length - 1; c++) {
    const p = run.sim.plan(c);
    if (p.heavy.some((h) => h.kind === 'roof')) roofCourses.push(c);
    if (p.heavy.some((h) => h.kind === 'roof' && h.elem === tagOf('king'))) kingRoof = c;
    run.sim.ctx.plans.delete(c);
  }
  let played = 0;
  for (const c of roofCourses) {
    const t0 = S0.courseOpen[c], t1 = S0.courseDone[c];
    let seen = 0;
    for (let t = t0; t <= t1 && seen < 3; t += 1800) {
      const sim = at.seekTo(t), G = sim.state.gang;
      for (const trip of gangTrips(sim)) {
        const g = trip.g, tb = g * NT;
        if (!trip.place || G.course[g] !== c) continue;
        const un = G.t[tb + T.UNLOAD], done = G.t[tb + T.DONE];
        // (the times of a trip still on its way out are those of the gang's previous trip)
        if (!(G.t[tb + T.FOOT] <= t && un <= t && done - 1 <= tripHorizon(trip))) continue;
        const buf = new Float32Array(size(trip));
        figures(trip, done - 1, buf);
        const pl = trip.place, d = Math.hypot(buf[5] - pl[0], buf[6] - pl[1], buf[7] - pl[2]), turn = Math.abs(Math.sin(buf[9] - pl[3]));
        figures(trip, un, buf);
        const sledOff = Math.max(Math.abs(buf[0]), Math.abs(buf[2])) <= halfWidthAt(COURSES[c].y0); // the sled stands on the course
        roofBeams.n++; roofBeams.worst = Math.max(roofBeams.worst, d, turn);
        if (d > 0.02 || turn > 0.02 || !sledOff) { roofBeams.bad++; console.log(`    course ${c + 1} gang ${g}: beam ${d.toFixed(3)} m from its place, heading off ${turn.toFixed(3)}, sled on the course ${sledOff}`); }
        seen++;
        if (!played && c === kingRoof) {
          played++;
          play(`King's Chamber beam: arrival (course ${c + 1})`, un - 900, 1200, 5);
          play(`King's Chamber beam: levered across`, (un + done) / 2 - 300, 600, 5);
          play(`King's Chamber beam: set, gang turns back`, done - 600, 1200, 5);
        }
      }
    }
  }
  console.log(`  roof beams: ${roofCourses.length} courses with beams (${roofCourses.map((c) => c + 1).join(', ')}); ${roofBeams.n} beam settings checked, worst ${roofBeams.worst.toFixed(4)} m / heading`);
  check(roofBeams.n >= 20 && roofBeams.bad === 0, 'every roof beam checked ends on its place across its opening, from a sled standing on the course');
  check(played > 0, 'a King\'s Chamber beam setting was played for continuity');
}

// ---- 5. nobody walks through anything ---------------------------------------------------
// People are 0.4 m across: two of different gangs closer than that (and at the same height)
// are drawn through each other. A sled is its stone's size plus 0.3 m. The ground is the
// plateau, the straight ramps and the finished courses (terrainY), and on the course being
// laid the top of each stone already set (a step's 0.6 m from its edge either way allowed).
{
  const surfOf = (sim) => (View.courseSurfaceOf ? View.courseSurfaceOf(sim) : null);
  const open = Gangs.rampOpening || (() => false); // (stones left out where a ramp arrives)
  const n = { people: 0, pairs: 0, sled: 0, stone: 0, air: 0, under: 0, corner: 0 };
  const eg = {};
  const note = (k, msg) => { n[k]++; if (!eg[k]) eg[k] = msg; };
  const buf = new Float32Array(SLED + 200 * FIG);
  for (let k = 0; k < 60; k++) {
    const t = (0.3 + k * 0.325) * YEAR + (k % 10) * 3600;
    if (t >= end) break;
    const sim = at.seekTo(t), R = rampScene(sim), surf = surfOf(sim), day = (t / DAY).toFixed(2);
    // the stones of the course being laid, as drawn
    const vs = View.viewState(sim);
    let L = null, set = null;
    if (vs.course) {
      L = View.courseLayout(sim, vs.course.ci); set = new Uint8Array(L.n * L.n);
      for (let s = 0; s < L.sectors; s++) for (const [o, c] of [[L.off[2 * s], vs.course.gClaim[s]], [L.off[2 * s + 1], vs.course.tClaim[s]]]) for (let j = 0; j < c; j++) if (!open(L, L.cells[o + j])) set[L.cells[o + j]] = 1;
    }
    const cellAt = (x, z) => { const i = Math.floor((x + L.hw) / L.cell), q = Math.floor((z + L.hw) / L.cell); return i >= 0 && q >= 0 && i < L.n && q < L.n ? [i, q] : null; };
    // how far (x, z) is inside cell [i, q] (negative: outside)
    const inside = ([i, q], x, z) => Math.min(x + L.hw - i * L.cell, (i + 1) * L.cell - x - L.hw, z + L.hw - q * L.cell, (q + 1) * L.cell - z - L.hw);
    const P = [], sleds = [];
    for (const trip of gangTrips(sim)) {
      if (trip.away) continue;
      const tok = figures(trip, t, buf, 0, surf), m = crewSpec(trip.kind, trip.crew).n, act = ACT_NAME[tok.act];
      sleds.push({ g: trip.g, x: buf[0], y: buf[1], z: buf[2], yaw: buf[3], L: trip.load });
      // (on a ledge, the zigzag or a theory's, nobody stands on the ground: the internal ramp runs
      // inside the masonry)
      const ledge = (trip.narrow || []).some(([p, a, e]) => p === tok.pa && tok.s > a - 25 && tok.s < e + 25);
      for (let j = 0; j < m; j++) { const o = SLED + j * FIG; P.push({ g: trip.g, j, x: buf[o], y: buf[o + 1], z: buf[o + 2], act, ledge }); }
    }
    n.people += P.length;
    // two people of different gangs in one spot
    const grid = new Map(), key = (x, z) => `${Math.floor(x / 0.5)},${Math.floor(z / 0.5)}`;
    P.forEach((p, i) => { const q = key(p.x, p.z); if (grid.has(q)) grid.get(q).push(i); else grid.set(q, [i]); });
    const seen = new Set();
    P.forEach((p, i) => {
      const cx = Math.floor(p.x / 0.5), cz = Math.floor(p.z / 0.5);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(`${cx + a},${cz + b}`) || []) {
        const q = P[j];
        if (j <= i || q.g === p.g || Math.hypot(p.x - q.x, p.z - q.z) >= 0.4 || Math.abs(p.y - q.y) >= 1.5) continue;
        const pk = `${Math.min(p.g, q.g)}:${Math.max(p.g, q.g)}`;
        if (seen.has(pk)) continue;
        seen.add(pk);
        note('pairs', `gangs ${p.g} (${p.act}) and ${q.g} (${q.act}) at day ${day}`);
        if (p.act === 'turning' && q.act === 'turning') note('corner', `gangs ${p.g} and ${q.g} at a switchback, day ${day}`);
      }
    });
    // in another gang's sled
    for (const s of sleds) {
      const hx = (s.L ? s.L[0] / 2 : 0.6) + 0.15, hz = (s.L ? s.L[2] / 2 : 1) + 0.15, sx = Math.sin(s.yaw), cz = Math.cos(s.yaw), hit = new Set();
      for (const p of P) {
        if (p.g === s.g || hit.has(p.g) || Math.abs(p.x - s.x) > 4 || Math.abs(p.z - s.z) > 4 || Math.abs(p.y - s.y) > 1.5) continue;
        const dx = p.x - s.x, dz = p.z - s.z;
        if (Math.abs(dx * sx + dz * cz) < hz && Math.abs(dx * cz - dz * sx) < hx) { hit.add(p.g); note('sled', `a man of gang ${p.g} in gang ${s.g}'s sled at day ${day}`); }
      }
    }
    // in a set stone, in the air, in the ground
    for (const p of P) {
      let top = -Infinity, near = false; // a stone under him (well inside it), or within a step of one
      const c = L && cellAt(p.x, p.z);
      if (c) {
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const cc = [c[0] + a, c[1] + b];
          if (cc[0] < 0 || cc[1] < 0 || cc[0] >= L.n || cc[1] >= L.n || !set[cc[1] * L.n + cc[0]]) continue;
          if (inside(cc, p.x, p.z) > -0.6) near = true;
        }
        if (set[c[1] * L.n + c[0]] && inside(c, p.x, p.z) > 0.25) {
          top = L.y0 + L.h;
          if (p.y < top - 0.1 && p.y > L.y0 - 1) note('stone', `gang ${p.g} man ${p.j} (${p.act}) ${(top - p.y).toFixed(2)} m down in a stone of course ${L.ci + 1}, day ${day}`);
        }
      }
      const ground = terrainY(R, p.x, p.z), up = Math.max(ground, near ? L.y0 + L.h : -Infinity), down = Math.max(ground, inside && top > -Infinity && inside(c, p.x, p.z) > 0.6 ? top : -Infinity);
      if (!p.ledge && p.y > up + 0.15) note('air', `gang ${p.g} man ${p.j} (${p.act}) ${(p.y - up).toFixed(2)} m in the air at day ${day}`);
      if (!p.ledge && p.y < down - 0.15) note('under', `gang ${p.g} man ${p.j} (${p.act}) ${(down - p.y).toFixed(2)} m in the ground at day ${day}`);
    }
  }
  console.log(`  ${n.people} people placed at 60 moments: ${n.pairs} pairs of people of two gangs in one spot (${n.corner} at a switchback), ${n.sled} in another gang's sled, ${n.stone} in a stone already set, ${n.air} in the air, ${n.under} in the ground`);
  for (const k of ['pairs', 'sled', 'stone', 'air', 'under', 'corner']) if (eg[k]) console.log(`    e.g. ${eg[k]}`);
  // (the model lets gangs catch up and two may cross where a yard's aisle meets its avenue, or
  // reach a ramp head side by side: a few such moments remain. The spiral and the internal ramp
  // have a single lane for every gang, and at the foot of it the queue keeps a place one gang
  // length back while the gang ahead is still on its way to the foot: more remain there.)
  const single = run.sim.ctx.theory.id !== 'straight-zigzag';
  const lim = single ? { pairs: 160, sled: 180, corner: 2, stone: 2 } : { pairs: 60, sled: 40, corner: 0, stone: 0 };
  check(n.pairs <= lim.pairs, `people of two gangs are hardly ever in one spot (${n.pairs} pairs, at most ${lim.pairs})`);
  check(n.corner <= lim.corner, `no two gangs stand at a switchback together (${n.corner}, at most ${lim.corner})`);
  check(n.sled <= lim.sled, `people are hardly ever inside another gang's sled (${n.sled}, at most ${lim.sled})`);
  check(n.stone <= lim.stone, `nobody stands inside a stone of the course being laid (${n.stone}, at most ${lim.stone})`);
  check(n.air + n.under <= n.people * 1e-3, `people stand on the ground, the ramps and the stones (${n.air} in the air, ${n.under} in the ground: at most 0.1 %)`);
}

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
