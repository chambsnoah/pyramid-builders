// Public entry points of the Khufu event model (Phase 2). Plain ES modules, no three.js or
// DOM, so the same code runs in Node (scripts/khufu-sim.mjs) and in the browser.
//
//   const run = runFull({ seed: 1 });   // whole build, a snapshot every simulated month
//   run.sim.hash();                      // fingerprint of the final state
//   const s = seek(run, 4.5 * YEAR);     // a model positioned at any time, for views
//   s.builtCourses(); s.state.rt[s.state.cur] …
import { createModel, LAST } from './model.js';
import { MONTH } from './params.js';

export { createModel, LAST, TASK, T, GIZA, TURA, HEAVY } from './model.js';
export { DEFAULTS, DAY, YEAR, MONTH, YEAR_DAYS, MONTH_DAYS, withDefaults } from './params.js';
export { ELEM, tagOf } from './planner.js';

// Runs the whole build. snapshots[m] is the full model state at the end of month m + 1
// (t = (m + 1) × MONTH), restorable with sim.restore(); `initial` is the state at t = 0.
export function runFull(overrides = {}, { onMonth } = {}) {
  const sim = createModel(overrides);
  const initial = sim.snapshot();
  const snapshots = [];
  for (let m = 1; !sim.done; m++) {
    sim.runUntil(m * MONTH);
    if (!sim.done) snapshots.push(sim.snapshot());
    onMonth?.(sim, m);
  }
  return { sim, snapshots, initial, overrides };
}

// A model positioned at time t: restores the latest snapshot at or before t and replays
// forward from there, so no seek replays more than a month. Pass `into` (a model from
// createModel with the same overrides) to reuse one instead of building a new one.
export function seek(run, t, into = null) {
  const sim = into || createModel(run.overrides);
  const m = Math.min(run.snapshots.length, Math.floor(t / MONTH)) - 1;
  if (m >= 0) sim.restore(run.snapshots[m]);
  else if (into && run.initial) sim.restore(run.initial); // a reused model may be later than t
  if (t >= run.sim.t) { // past the end: the finished state
    if (m < run.snapshots.length - 1 || !sim.done) sim.runUntil(Infinity);
  } else sim.runUntil(t);
  return sim;
}
