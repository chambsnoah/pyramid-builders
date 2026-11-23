// Checks for the detail bubble (Phase 4 "done when": zooming onto any working ramp shows
// correct, continuous animation that matches the event model). Uses the same seeker(),
// gangTracker() and figures() as the worker and the page.
//   npm run khufu:gangs        exits non-zero if a check fails
//
// 1. Continuity: plays short windows second by second, as the page does (a seek per step,
//    keeping each gang's latest trip), and checks that no sled, stone or crew member moves
//    faster than a man can walk between two steps: early, middle, late, across a month
//    boundary (the seeker restores a snapshot there), across a course completion and on the
//    zigzag.
// 2. Late trips: the page draws with the trips of its last reply, a frame or more old. A trip
//    read at t1 must give the same pose at t2 > t1 as the trip read at t2, up to its last knot.
// 3. Model match: at the model's own event times the sled is where the model says: at the
//    ramp foot when the model lets it into the lane (or a gang length behind, when another
//    gang entered just before), on the landing (or by the heavy stone's place) while it
//    unloads, passing the top of a straight ramp close to the model's time; and what each
//    gang is doing agrees with its task in the model. Also reported: how often two working
//    gangs are drawn on top of each other.
import { runFull, DAY, MONTH, YEAR, T, NT, TASK, HEAVY } from '../src/khufu/sim/index.js';
import { seeker } from '../src/khufu/sim/view.js';
import { COURSES } from '../src/khufu/data.js';
import { gangTracker, gangTrips, figures, crewSpec, tokenAt, tripHorizon, capBack, ACT, ACT_NAME, SLED, FIG, KN } from '../src/khufu/sim/gangs.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const t0 = performance.now();
const run = runFull({ seed: 1 });
const end = run.sim.t, S0 = run.sim.state;
console.log(`full run ${((performance.now() - t0) / 1000).toFixed(2)} s, ends day ${Math.floor(end / DAY)}, hash ${run.sim.hash()}`);
const at = seeker(run);

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
    sent += u.trips.length;
    const before = new Map(trips);
    for (const trip of u.trips) trips.set(trip.g, trip);
    // 2. the trip from the previous reply, evaluated now, agrees with the new one
    for (const trip of u.trips) {
      const o = before.get(trip.g);
      if (!o || t > tripHorizon(o) || o.sig.split('|')[1] !== trip.sig.split('|')[1]) continue; // a new trip, or past what the old one knew
      const a = new Float32Array(size(o)), b = new Float32Array(size(trip));
      figures(o, t, a); figures(trip, t, b);
      if (a.length !== b.length) continue;
      let d = 0;
      for (let i = 0; i < a.length; i = i ? i + FIG : SLED) d = Math.max(d, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
      stale.n++; if (d > stale.worst) { stale.worst = d; stale.at = `gang ${trip.g} day ${(t / DAY).toFixed(4)}`; }
    }
    for (const [g, trip] of trips) {
      const buf = cur.get(g) || new Float32Array(size(trip));
      if (buf.length !== size(trip)) { cur.set(g, new Float32Array(size(trip))); continue; }
      const tok = figures(trip, t, buf);
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
const windows = [
  ['early: day 20, 08:00', 19 * DAY + 2 * 3600, 900],
  ['middle: year 10', 10 * YEAR + 4 * 3600, 900],
  ['late: year 19.5', 19.5 * YEAR + 4 * 3600, 900],
  ['across a month boundary (year 4)', 4 * YEAR + 3 * MONTH - 300, 600],
  ['across course 20 complete', course(19) - 300, 600],
  ['across course 120 complete', course(119) - 300, 600],
];
if (zigCourse > 0) windows.push([`on the zigzag (course ${zigCourse + 1})`, S0.courseOpen[zigCourse] + 2 * DAY + 3600, 1200]);
for (const [name, t, len] of windows) play(name, t, len);
// a coarser pass over a whole working day, as at 1 min/s
play('a whole day in 20 s steps (year 7)', 7 * YEAR + 30 * DAY, DAY, 20);

// ---- 3. model match ---------------------------------------------------------------------
{
  const P = run.sim.P;
  let n = 0, worst = 0, worstAt = '', bad = 0, acts = 0, actBad = 0;
  const headErr = [];
  let close = 0, pairs = 0, moving = 0;
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
      const okAct = task === TASK.WAITING ? tok.act === ACT.IDLE
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
      if (!heavy) targets.push([mid, plan.sectors[G.sector[g]].landing, 'landing', 2.4]);
      else { const it = plan.heavy[G.sector[g]]; targets.push([mid, [it.x, it.z], 'stone place', 0]); }
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
      if (rt.segs.length === 1 && G.t[tb + T.LAND] <= t && G.t[tb + T.LAND] <= tripHorizon(trip)) {
        const a = G.t[tb + T.CLIMB], b = G.t[tb + T.LAND];
        let lo = a, hi = b;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; figures(trip, m, buf); if (Math.max(Math.abs(buf[0]), Math.abs(buf[2])) > Math.max(Math.abs(rt.head[0]), Math.abs(rt.head[1])) + 0.01) lo = m; else hi = m; }
        if (b > a + 1) headErr.push(Math.abs(lo - G.t[tb + T.TOP]) / (b - a));
      }
    }
  }
  console.log(`  ${n} event times checked over the build; sled farthest ${worst.toFixed(2)} m from the model's point (${worstAt}; lanes are 1.4 and 3.6 m off the centre line, berths 2.4 m to either side, plus a gang length behind another)`);
  check(n > 100 && bad === 0, 'the sled is at the ramp foot and on the landing at the model\'s times');
  console.log(`  overlap: ${close} pairs of working gangs with sleds under 1.5 m apart, at 60 moments with ${moving} working gangs in all`);
  headErr.sort((a, b) => a - b);
  const med = headErr[headErr.length >> 1] ?? 0, max = headErr.at(-1) ?? 0;
  console.log(`  top of the straight ramp: ${headErr.length} climbs, the sled passes the head ${(med * 100).toFixed(1)} % (median), ${(max * 100).toFixed(1)} % (worst) of the climb off the model's time`);
  check(headErr.length > 50 && med < 0.05, 'the sled reaches the top of the straight ramp close to the model\'s time');
  check(actBad === 0, `what each gang does agrees with its task in the model (${acts} checked)`);
  void P; void KN;
}

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
