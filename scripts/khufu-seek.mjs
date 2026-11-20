// Seek benchmark and check for the Khufu timeline (Phase 3 "done when": any day can be
// reached in a few seconds, backward or forward). Uses the same seeker() and viewState()
// as the browser worker.
//   npm run khufu:seek            exits non-zero if a seek is wrong or slower than 3 s
import { runFull, createModel, DAY, MONTH, YEAR } from '../src/khufu/sim/index.js';
import { seeker, viewState, courseLayout } from '../src/khufu/sim/view.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const t0 = performance.now();
const run = runFull({ seed: 1 });
console.log(`full run ${((performance.now() - t0) / 1000).toFixed(2)} s, ${run.snapshots.length} snapshots, ends day ${Math.floor(run.sim.t / DAY)}`);

const at = seeker(run);
// one seek as the page does it: move the model, read the panels, and the course layout if it changed
let lastCourse = -2;
function timed(t) {
  const a = performance.now();
  const sim = at.seekTo(t);
  const b = performance.now();
  const v = viewState(sim);
  const ci = v.course ? v.course.ci : -1;
  if (ci !== lastCourse) { lastCourse = ci; if (ci >= 0) courseLayout(sim, ci); }
  return { seek: b - a, total: performance.now() - a, v };
}
const end = run.sim.t;
const steps = [
  ['early: day 10', 10 * DAY], ['late: year 19.9', 19.9 * YEAR], ['middle: year 10', 10 * YEAR],
  ['back to day 3', 3 * DAY], ['forward one day', 4 * DAY], ['forward one month', 4 * DAY + MONTH],
  ['back one day', 3 * DAY + MONTH], ['the last day', end - DAY / 2], ['the end', end], ['back to day 0', 0],
];
for (const [name, t] of steps) {
  const r = timed(t);
  console.log(`  ${name.padEnd(20)} seek ${r.seek.toFixed(1).padStart(6)} ms, with panels ${r.total.toFixed(1).padStart(6)} ms → course ${r.v.built}, ${r.v.blocksSet.toLocaleString('en-US')} blocks`);
  check(r.total < 3000, `${name} under 3 s`);
}

// random days, in random order (backward and forward)
let s = 12345; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const ts = [];
for (let i = 0; i < 300; i++) ts.push(timed(rnd() * end).total);
ts.sort((a, b) => a - b);
console.log(`  300 random days: median ${ts[150].toFixed(1)} ms, p95 ${ts[285].toFixed(1)} ms, max ${ts[299].toFixed(1)} ms`);
check(ts[299] < 3000, 'every random seek under 3 s');

// the reused model lands on exactly the state of a straight run to the same time
for (const t of [0.4 * MONTH, 7.3 * YEAR + 0.4 * MONTH, 2 * YEAR + 3.5 * DAY, 15 * YEAR + 1234]) {
  const direct = createModel({ seed: 1 }); direct.runUntil(t);
  const got = at.seekTo(t);
  check(got.hash() === direct.hash(), `seek to day ${(t / DAY).toFixed(1)} after others matches a direct run (${direct.hash()})`);
}
check(at.seekTo(end).hash() === run.sim.hash(), `seek to the end gives the final hash ${run.sim.hash()}`);

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
