// Comparing the ramp theories (Phase 6). theoryStats() sums up a finished run: how long the
// build took, its throughput, and how much ramp had to be built. compareTheories() runs the
// whole build once per theory with the same settings otherwise. Used by
// scripts/khufu-theories.mjs and by the page (the worker answers a 'compare' message).
// No three.js, no DOM.
import { COURSES, HEIGHT } from '../data.js';
import { createModel, LAST } from './model.js';
import { DAY, YEAR, withDefaults } from './params.js';
import { resourceStats } from './resource.js';
import { THEORY_IDS } from './ramps/index.js';
import { laneName } from './view.js';

// a finished model (sim.done) → plain numbers
export function theoryStats(sim) {
  const S = sim.state, th = sim.ctx.theory, days = S.t / DAY;
  let peakFill = 0, peakCi = 0;
  for (let ci = 0; ci <= LAST; ci++) { const v = th.fill(ci).total; if (v > peakFill) { peakFill = v; peakCi = ci; } }
  const halfCourse = COURSES.findIndex((c) => c.y1 >= HEIGHT / 2);
  const halfT = S.courseDone[halfCourse];
  // the busiest ramp lane: the longest mean wait to enter it
  let busiest = null;
  for (const k of Object.keys(S.lanes).sort()) {
    const r = resourceStats(S.lanes[k]);
    if (!busiest || r.meanWait > busiest.meanWait) busiest = { key: k, name: laneName(k), meanWait: r.meanWait, maxQueue: r.maxQueue };
  }
  // what the ramps can take near the top: sleds an hour, from each lane's headway
  const top = th.layout(LAST - 1);
  const topCap = top.routes.reduce((a, r) => a + Math.min(...r.segs.map((s) => (s.lanes * 3600) / s.headway)), 0);
  // blocks set per year of the build
  const perYear = [];
  const by = sim.hist.blocksByDay;
  for (let y = 0; y * 300 < Math.ceil(days); y++) { let n = 0; for (let d = y * 300; d < Math.min((y + 1) * 300, by.length); d++) n += by[d]; perYear.push(n); }
  return {
    id: th.id, name: th.name, short: th.short || th.id,
    days, years: S.t / YEAR, blocks: S.blocksSet, perDay: S.blocksSet / days, perHour: S.blocksSet / (S.t / 3600),
    peakFill, peakFillCourse: peakCi, peakFillY: COURSES[peakCi].y0, endFill: th.fill(LAST).total, fillParts: th.fill(peakCi).parts,
    halfHeightYears: halfT / YEAR, upperHalfYears: (S.t - halfT) / YEAR,
    busiest, topCap, perYear, hash: sim.hash(), complete: S.done && S.elemDone.slice(1).every((t, i) => t >= 0 || sim.ctx.elemTotal[i + 1] === 0),
  };
}

// every theory (or `ids`) with the same overrides otherwise; onEach(stats, i) as each finishes
export function compareTheories(overrides = {}, ids = THEORY_IDS, onEach = null) {
  return ids.map((id, i) => {
    const sim = createModel(withDefaults({ ramp: { id } }, overrides));
    sim.runUntil(Infinity);
    const st = theoryStats(sim);
    onEach?.(st, i);
    return st;
  });
}
