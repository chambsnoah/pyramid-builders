// Automated check of the Khufu event model (Phase 2 "done when"):
//   1. a full build runs in under 60 s;
//   2. the same seed gives the same final-state hash, a different seed a different one;
//   3. restoring a monthly snapshot and replaying forward reaches the same final state;
//   4. the rate lands near the calibration (2.3M blocks in 20 years of 300 × 10 h).
// Exits non-zero if any check fails.   npm run khufu:check
import { runFull, createModel, seek, YEAR, MONTH, T, NT, TASK } from '../src/khufu/sim/index.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const t0 = performance.now();
const a = runFull({ seed: 1 });
const wall = (performance.now() - t0) / 1000;
const S = a.sim.state, hours = S.t / 3600, rate = S.blocksSet / hours, years = S.t / YEAR;
check(wall < 60, `full build with monthly snapshots in ${wall.toFixed(2)} s (< 60 s)`);

const b = createModel({ seed: 1 }); b.runUntil(Infinity);
check(b.hash() === a.sim.hash(), `same seed, same hash: ${a.sim.hash()} = ${b.hash()} (snapshotting does not change the build)`);
const c = createModel({ seed: 2 }); c.runUntil(Infinity);
check(c.hash() !== a.sim.hash(), `different seed, different hash: ${c.hash()}`);

for (const m of [1, Math.floor(a.snapshots.length / 2), a.snapshots.length - 1]) {
  const r = createModel({ seed: 1 });
  r.restore(a.snapshots[m - 1]);
  r.runUntil(Infinity);
  check(r.hash() === a.sim.hash(), `restore month ${m} and replay to the end: ${r.hash()}`);
}
// seeking to a time mid-month matches running straight there
const target = 7.3 * YEAR + 0.4 * MONTH;
const direct = createModel({ seed: 1 }); direct.runUntil(target);
const sought = seek(a, target);
check(sought.hash() === direct.hash() && sought.builtCourses() === direct.builtCourses(), `seek to year 7.3 matches a direct run (course ${direct.builtCourses()}, ${direct.state.blocksSet} blocks)`);

const target38 = 2.3e6 / (20 * 300 * 10);
check(Math.abs(rate / target38 - 1) < 0.1, `rate ${rate.toFixed(2)} blocks/h within 10 % of ${target38.toFixed(2)}`);
check(years > 18 && years < 22, `build takes ${years.toFixed(2)} years (18–22)`);
check(S.blocksSet > 2.25e6 && S.blocksSet < 2.35e6, `${S.blocksSet} blocks (about 2.3 million)`);
check(S.elemDone.slice(1).every((t, i) => t >= 0 || a.sim.ctx.elemTotal[i + 1] === 0), 'every room and shaft completed');

// levy rotation: after each changeover only crews of the arriving group wait for work or set
// off, and the outgoing group's crews go home as they come back. With the default 5 h
// changeover every outgoing crew is home before the next group arrives; with 15 minutes some
// sleds are still out, and the arriving crew takes each over when it comes back.
for (const over of [{}, { rotation: { changeoverHours: 0.25 } }]) {
  const m = createModel({ seed: 1, ...over }), core = m.ctx.coreGangs, P = m.P;
  let bad = 0, checked = 0, handovers = 0;
  for (let k = 1; k * MONTH < a.sim.t * 0.9; k += 3) for (const dh of [P.rotation.changeoverHours + 0.05, P.rotation.changeoverHours + 1, 30]) {
    m.runUntil((k - 1) * MONTH + dh * 3600);
    const S = m.state, G = S.gang;
    if (S.levy.group === 0) continue;
    for (let g = core; g < P.haul.gangs; g++) {
      const fresh = G.t[g * NT + T.START] >= S.levy.since; // set off since the group arrived
      if ((G.task[g] === TASK.WAITING || (G.task[g] !== TASK.AWAY && fresh)) && G.group[g] !== S.levy.group) bad++;
      if (G.task[g] !== TASK.AWAY && G.group[g] !== S.levy.group) handovers++;
      checked++;
    }
  }
  const name = `${P.rotation.changeoverHours} h changeover`;
  check(bad === 0 && checked > 1000 && (over.rotation ? handovers > 0 : true), `levy rotation, ${name}: no crew of an outgoing group waits for work or sets off again (${checked} gang states, ${handovers} sleds still out with an outgoing crew)`);
}

console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
