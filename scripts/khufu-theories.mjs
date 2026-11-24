// Runs the whole build once per ramp theory and compares them (Phase 6 "done when": each
// ramp theory runs end to end and their throughputs can be compared). The page shows the
// same numbers (sim/compare.js) in its "Ramp theories" panel.
//   npm run khufu:theories              exits non-zero if a check fails
//   npm run khufu:theories -- --json    also prints the numbers as JSON
// Checks: every theory finishes every course and room with the same stone; the default
// theory lands near the calibration; each theory's ramp is where it claims to be (spiral
// ledges outside the faces, the internal ramp inside the masonry) and its model length is
// the drawn path's; every ramp foot can be reached by road in every course.
import { compareTheories } from '../src/khufu/sim/compare.js';
import { createModel, DEFAULTS } from '../src/khufu/sim/index.js';
import { THEORY_IDS } from '../src/khufu/sim/ramps/index.js';
import { COURSES, halfWidthAt } from '../src/khufu/data.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const n = (x, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

const t0 = performance.now();
const res = compareTheories({ seed: 1 }, THEORY_IDS, (s) => console.log(`  ran ${s.short.padEnd(18)} in ${((performance.now() - t0) / 1000).toFixed(1)} s (cumulative)`));

console.log('\ntheory               years  blocks/day  blocks/h  half height  upper half  peak ramp m³ (at)        at the end   top cap/h  busiest lane (mean wait)');
for (const s of res) {
  console.log(`${s.short.padEnd(19)} ${n(s.years, 2).padStart(6)}  ${n(s.perDay, 0).padStart(10)}  ${n(s.perHour, 1).padStart(8)}  ${n(s.halfHeightYears, 1).padStart(9)} y  ${n(s.upperHalfYears, 1).padStart(8)} y  ${n(s.peakFill).padStart(12)} (${s.peakFillY.toFixed(0)} m)  ${n(s.endFill).padStart(12)}  ${n(s.topCap).padStart(9)}  ${s.busiest.name} (${n(s.busiest.meanWait / 60, 1)} min)`);
}
console.log('');

const blocks = res[0].blocks;
for (const s of res) check(s.complete && s.blocks === blocks, `${s.short}: runs end to end, every course and room finished, ${n(s.blocks)} blocks`);
const def = res.find((s) => s.id === DEFAULTS.ramp.id);
check(def.years > 18 && def.years < 22 && Math.abs(def.perHour / 38.33 - 1) < 0.1, `default theory (${def.short}) near the calibration: ${def.years.toFixed(2)} years, ${def.perHour.toFixed(1)} blocks/h`);

// each theory's ramps: where they are, and that the model climbs the drawn path
for (const id of THEORY_IDS) {
  const sim = createModel({ seed: 1, ramp: { id } }), th = sim.ctx.theory;
  let unreachable = 0, lenErr = 0, side = 0, checked = 0;
  for (let ci = 0; ci < COURSES.length; ci += 7) {
    const p = sim.plan(ci);
    p.road.q.forEach((d, r) => { if (!Number.isFinite(d) || !Number.isFinite(p.road.h[r])) unreachable++; });
    if (!th.ledge) continue;
    for (const rt of p.layout.routes) {
      const seg = rt.segs.find((s) => s.kind !== 'straight');
      if (!seg) continue;
      const L = th.ledge(rt.id, COURSES[ci].y0);
      lenErr = Math.max(lenErr, Math.abs(L.length - seg.length));
      // every point of the path above the ground: outside the face (a ledge) or inside it
      for (let i = 3; i < L.pts.length; i += 3) {
        const x = L.pts[i], y = L.pts[i + 1], z = L.pts[i + 2], m = Math.max(Math.abs(x), Math.abs(z)), hw = halfWidthAt(y);
        if (y < 0.5) continue; // (the passage in, on the ground)
        checked++;
        if (th.ledgeInside ? m > hw - 1 && hw > 5 : m < hw - 1e-6) side++;
      }
    }
    sim.ctx.plans.delete(ci);
  }
  check(unreachable === 0, `${th.short}: every ramp foot can be reached by road (every 7th course)`);
  if (th.ledge) {
    check(lenErr < 1e-6, `${th.short}: the model's ramp length is the drawn path's (worst ${lenErr.toExponential(1)} m)`);
    check(checked > 100 && side === 0, `${th.short}: the ramp runs ${th.ledgeInside ? 'inside the masonry' : 'outside the faces'} (${checked} points, ${side} on the wrong side)`);
  }
}

if (process.argv.includes('--json')) console.log(JSON.stringify(res.map(({ perYear, ...s }) => s), null, 1));
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
