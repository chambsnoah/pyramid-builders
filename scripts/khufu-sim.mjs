// Headless run of the Khufu event model: the whole 20-year build, with monthly snapshots.
//   npm run khufu:sim                    # default settings, seed 1
//   npm run khufu:sim -- --seed 7        # another seed
//   npm run khufu:sim -- --set quarry.faces=400 --set haul.gangs=80
//   npm run khufu:sim -- --json out.json # also write the report as JSON
import { writeFileSync } from 'node:fs';
import { serialize } from 'node:v8';
import { runFull, DAY, YEAR, YEAR_DAYS, ELEM, tagOf, LAST } from '../src/khufu/sim/index.js';
import { COURSES } from '../src/khufu/data.js';

const args = process.argv.slice(2);
const over = {};
let json = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--seed') over.seed = Number(args[++i]);
  else if (args[i] === '--json') json = args[++i];
  else if (args[i] === '--set') {
    const [path, v] = args[++i].split('=');
    const keys = path.split('.');
    let o = over;
    for (const k of keys.slice(0, -1)) o = o[k] ||= {};
    o[keys.at(-1)] = isNaN(Number(v)) ? v : Number(v);
  }
}

const t0 = performance.now();
const work = [];
const run = runFull(over, { onMonth: (sim) => work.push(sim.workforce()) });
const wall = (performance.now() - t0) / 1000;
const { sim, snapshots } = run;
const S = sim.state, P = sim.P, ctx = sim.ctx, T = ctx.summary.totals;

const hours = S.t / 3600, days = S.t / DAY;
const fmtDay = (t) => (t < 0 ? 'never' : `day ${Math.floor(t / DAY) + 1} (year ${Math.floor(t / YEAR) + 1}, day ${Math.floor((t % YEAR) / DAY) + 1})`);
const perYear = [];
for (let y = 0; y * YEAR_DAYS < days; y++) {
  let b = 0;
  for (let d = y * YEAR_DAYS; d < (y + 1) * YEAR_DAYS; d++) b += sim.hist.blocksByDay[d] || 0;
  const span = Math.min(YEAR_DAYS, days - y * YEAR_DAYS) * 10;
  const coursesDone = [...S.courseDone].filter((t) => t >= 0 && t < (y + 1) * YEAR).length;
  perYear.push({ year: y + 1, blocks: b, perHour: b / span, coursesDone });
}
const theory = ctx.theory;
const milestones = [
  ["Queen's Chamber roofed", S.elemDone[tagOf('queen')]],
  ['Straight ramps topped out; zigzags begin', S.courseOpen[theory.switchCi]],
  ["King's Chamber roofed", S.elemDone[tagOf('king')]],
  ['Grand Gallery complete', S.elemDone[tagOf('gallery')]],
  ['Relieving chambers complete', S.elemDone[tagOf('relieving')]],
  ['Air shafts complete', Math.max(S.elemDone[tagOf('queen-shafts')], S.elemDone[tagOf('king-shafts')])],
  [`Last course (${LAST})`, S.courseDone[LAST - 1]],
  ['Capstone set', S.courseDone[LAST]],
];
const queues = sim.resources().filter((r) => r.maxQueue !== undefined).sort((a, b) => b.maxQueue - a.maxQueue).slice(0, 6);
const waits = sim.resources().sort((a, b) => b.meanWait - a.meanWait).slice(0, 4);
const snapBytes = snapshots.map((s) => serialize(s).length);
const report = {
  wallSeconds: +wall.toFixed(2), seed: P.seed, hash: sim.hash(), events: S.ev,
  simulated: { workingDays: +days.toFixed(1), years: +(days / YEAR_DAYS).toFixed(2), hours: +hours.toFixed(0) },
  blocks: { total: S.blocksSet, perHour: +(S.blocksSet / hours).toFixed(2), calibration: +(2.3e6 / (20 * YEAR_DAYS * 10)).toFixed(2) },
  blockSize: { cellSide: +ctx.side.toFixed(4), cellArea: +(ctx.side ** 2).toFixed(3), meanVolume: +(T.volume / T.cells).toFixed(3), cells: T.cells, giza: T.giza, tura: T.tura, heavy: T.heavy, granite: T.granite, dressed: T.dressed, voidCells: T.voids },
  perYear: perYear.map((y) => ({ ...y, perHour: +y.perHour.toFixed(1) })),
  milestones: milestones.map(([name, t]) => ({ name, t, day: t < 0 ? null : Math.floor(t / DAY) + 1 })),
  queues, ramp: { theory: theory.name, switchCourse: theory.switchCi, switchY: +theory.switchY.toFixed(2), fillAtSwitch: Math.round(theory.fill(theory.switchCi).total), fillAtEnd: Math.round(theory.fill(LAST).total) },
  workforce: { peak: Math.max(...work), mean: Math.round(work.reduce((a, b) => a + b, 0) / work.length) },
  snapshots: { count: snapshots.length, meanBytes: Math.round(snapBytes.reduce((a, b) => a + b, 0) / snapBytes.length), totalMB: +(snapBytes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1) },
};

const n = (x) => x.toLocaleString('en-US');
console.log(`Khufu event model · ramp theory: ${theory.name} · seed ${P.seed}`);
console.log(`  wall-clock run time   ${wall.toFixed(2)} s  (${n(S.ev)} events)`);
console.log(`  simulated duration    ${n(Math.round(days))} working days = ${(days / YEAR_DAYS).toFixed(2)} years of ${YEAR_DAYS} days × 10 h`);
console.log(`  blocks set            ${n(S.blocksSet)}  (Giza ${n(T.giza)}, Tura casing ${n(T.tura)}, heavy ${n(T.heavy)} incl. ${n(T.granite)} granite)`);
console.log(`  block size            ${ctx.side.toFixed(3)} m square in plan × course height; mean ${(T.volume / T.cells).toFixed(2)} m³`);
console.log(`  rate overall          ${(S.blocksSet / hours).toFixed(2)} blocks/hour  (calibration: 2.3M in 20 y = ${report.blocks.calibration})`);
console.log('  rate per year         ' + perYear.map((y) => `y${y.year} ${y.perHour.toFixed(0)}`).join(' · '));
console.log('  courses done by year  ' + perYear.map((y) => y.coursesDone).join(' '));
console.log('  milestones');
for (const [name, t] of milestones) console.log(`    ${name.padEnd(42)} ${fmtDay(t)}`);
console.log('  longest queues (max waiting on arrival · mean wait · max wait)');
for (const q of queues) console.log(`    ${q.name.padEnd(42)} ${String(q.maxQueue).padStart(4)} · ${(q.meanWait / 60).toFixed(1)} min · ${(q.maxWait / 3600).toFixed(1)} h${q.course !== undefined ? ` (course ${q.course})` : ''}`);
console.log('  longest mean waits');
for (const q of waits) console.log(`    ${q.name.padEnd(42)} ${(q.meanWait / 60).toFixed(1)} min mean · ${(q.maxWait / 3600).toFixed(1)} h max`);
console.log(`  granite starvation    ${(S.harbour.starved / DAY).toFixed(1)} working days with heavy gangs idle for want of granite`);
console.log(`  ramp fill             ${n(report.ramp.fillAtSwitch)} m³ at the switch to zigzags (course ${theory.switchCi}, ${theory.switchY.toFixed(1)} m); ${n(report.ramp.fillAtEnd)} m³ at the end`);
console.log(`  workforce on site     peak ${n(report.workforce.peak)}, mean ${n(report.workforce.mean)}`);
console.log(`  snapshots             ${snapshots.length} monthly, mean ${(report.snapshots.meanBytes / 1024).toFixed(1)} KB, ${report.snapshots.totalMB} MB in all`);
console.log(`  final-state hash      ${report.hash}`);
if (json) writeFileSync(json, JSON.stringify(report, null, 2));
