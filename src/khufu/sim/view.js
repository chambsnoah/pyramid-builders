// What the timeline, the statistics panel and the renderer read from the event model
// (Phase 3). Plain data out of a model positioned at some time, so it can be posted from
// the worker to the page. No three.js, no DOM: it also runs in Node (scripts/khufu-seek.mjs).
import { COURSES, HEIGHT } from '../data.js';
import { DAY, MONTH } from './params.js';
import { seek } from './index.js';
import { ELEM } from './planner.js';
import { GIZA, TURA, HEAVY, LAST } from './model.js';

// Live state of a queue resource at time t (see resource.js): `pend` holds the service start
// times of users not yet served, `nf` when each server comes free.
export function waitingAt(R, t) { let n = 0; for (const v of R.pend) if (v > t) n++; return n; }
export function inUseAt(R, t) { let n = 0; for (const v of R.nf) if (v > t) n++; return Math.min(n, R.cap); }

const FACE = ['south', 'east', 'north', 'west'];
export function laneName(key) {
  const m = /^(straight|zigzag)(\d+)$/.exec(key);
  if (!m) return key;
  const face = FACE[+m[2]]; // a theory with more routes than faces just numbers them
  return `${m[1] === 'straight' ? 'Straight' : 'Zigzag'} ramp, ${face ? `${face} face` : `route ${m[2]}`}`;
}

// A reusable model for one run that can be moved to any time. Forward within the month it is
// already in, it just runs on; anything else restores that month's snapshot and replays
// (seek() in index.js), so no seek replays more than one month of events.
export function seeker(run) {
  let sim = null;
  return {
    get sim() { return sim; },
    seekTo(t) {
      const end = run.sim.t;
      if (t >= end) t = end;
      if (sim && !sim.done && sim.t <= t && sim.t >= Math.floor(t / MONTH) * MONTH) sim.runUntil(t);
      else if (!(sim && sim.done && t >= end)) sim = seek(run, t, sim);
      return sim;
    },
  };
}

const queueRow = (kind, name, R, t) => ({ kind, name, waiting: waitingAt(R, t), inUse: inUseAt(R, t), cap: R.cap, maxQ: R.maxQ });

// Everything the panels show at the model's current time.
export function viewState(sim) {
  const S = sim.state, P = sim.P, t = S.t;
  // gangs by kind (Giza sleds, Tura sleds, heavy) and task (waiting, out, returning)
  const gangs = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let g = 0; g < S.gang.kind.length; g++) gangs[S.gang.kind[g]][S.gang.task[g]]++;
  let facesCutting = 0, facesFull = 0, facesDone = 0;
  for (let f = 0; f < S.quarry.idle.length; f++) { const s = S.quarry.idle[f]; if (s === 0) facesCutting++; else if (s === 1) facesFull++; else facesDone++; }
  const boatsLoaded = S.harbour.boatLoad.reduce((a, b) => a + (b > 0), 0);

  // queues on ramps, landings, berths and bays, as they stand right now
  const queues = [
    queueRow('bay', 'Quarry loading bays', S.quarry.bays, t),
    queueRow('berth', 'Harbour berths', S.harbour.berths, t),
    queueRow('bay', 'Harbour loading bays', S.harbour.bays, t),
    ...Object.keys(S.lanes).sort().map((k) => queueRow('ramp', laneName(k), S.lanes[k], t)),
  ];
  let landingWaiting = 0, landings = 0;
  for (const ci of [S.cur, S.look]) {
    const rt = S.rt[ci];
    if (!rt) continue;
    rt.land.forEach((R, s) => {
      const row = queueRow('landing', `Landing ${s + 1}, course ${ci + 1}`, R, t);
      landingWaiting += row.waiting; landings++;
      if (row.waiting > 0 || row.inUse > 0) queues.push(row);
    });
  }
  queues.sort((a, b) => b.waiting - a.waiting || b.inUse / b.cap - a.inUse / a.cap);

  // the course being laid: how far each sector has got
  let course = null;
  const rt = !S.done && S.rt[S.cur];
  if (rt) {
    const total = rt.gTot.reduce((a, b) => a + b, 0) + rt.tTot.reduce((a, b) => a + b, 0) + rt.heavyState.length;
    course = {
      ci: S.cur, open: rt.open, total, left: rt.setLeft + rt.heavyLeft,
      gSet: rt.gSet.slice(), tSet: rt.tSet.slice(), gClaim: rt.gClaim.slice(), tClaim: rt.tClaim.slice(), heavyState: rt.heavyState.slice(),
    };
  }
  const built = sim.builtCourses();
  return {
    t, day: Math.floor(t / DAY), done: S.done, built, cur: S.cur,
    topY: built > LAST ? HEIGHT : built > 0 ? COURSES[built - 1].y1 : 0,
    blocksSet: S.blocksSet, events: S.ev,
    workforce: sim.workforce(),
    gangs: { giza: gangs[GIZA], tura: gangs[TURA], heavy: gangs[HEAVY] },
    quarry: { stock: S.quarry.stock, cap: P.quarry.yardCap, cut: S.quarry.cut, faces: S.quarry.idle.length, facesCutting, facesFull, facesDone },
    harbour: { tura: S.harbour.tura, cap: P.tura.stockCap, shipped: S.harbour.shipped, delivered: S.harbour.delivered, granite: S.harbour.granite, graniteDelivered: S.harbour.graniteDelivered, boats: P.tura.boats, boatsLoaded },
    queues: queues.slice(0, 8), landingWaiting, landings,
    elemSet: Array.from(S.elemSet),
    course,
  };
}

// Where each block of course ci goes, in setting order, for drawing the part-laid course.
// cells: all cell indices, sector by sector (that sector's Giza list, then its Tura list);
// off[2s] / off[2s+1] = where sector s's Giza / Tura lists start (off[2k] = cells.length).
export function courseLayout(sim, ci) {
  const p = sim.plan(ci);
  const k = p.sectors.length;
  const off = new Int32Array(2 * k + 1);
  let n = 0;
  p.sectors.forEach((s, i) => { off[2 * i] = n; n += s.giza.length; off[2 * i + 1] = n; n += s.tura.length; });
  off[2 * k] = n;
  const cells = new Int32Array(n);
  p.sectors.forEach((s, i) => { cells.set(s.giza, off[2 * i]); cells.set(s.tura, off[2 * i + 1]); });
  const type = new Uint8Array(n);
  for (let j = 0; j < n; j++) type[j] = p.type[cells[j]];
  const heavy = new Float32Array(p.heavy.length * 3);
  p.heavy.forEach((h, j) => { heavy[3 * j] = h.x; heavy[3 * j + 1] = h.z; heavy[3 * j + 2] = h.granite ? 1 : 0; });
  return { ci, n: p.n, cell: p.cell, hw: p.hw, y0: p.y0, h: p.h, sectors: k, off, cells, type, heavy };
}

// Milestones for the timeline, from the finished run: room completions (S.elemDone), course
// times (S.courseDone / courseOpen) and the running total of blocks.
export function milestones(run) {
  const S = run.sim.state, ctx = run.sim.ctx, out = [];
  const add = (t, label, kind) => { if (t >= 0) out.push({ t, label, kind }); };
  const E = (id) => S.elemDone[ELEM.indexOf(id) + 1];
  add(S.courseDone[0], 'First course complete', 'course');
  add(E('descending'), 'Descending passage complete', 'room');
  add(E('ascending'), 'Ascending passage complete', 'room');
  add(E('queen'), "Queen's Chamber roofed", 'room');
  add(S.courseOpen[ctx.theory.switchCi], 'Straight ramps topped out: zigzags begin', 'ramp');
  add(E('antechamber'), 'Antechamber complete', 'room');
  add(E('king'), "King's Chamber roofed", 'room');
  add(E('gallery'), 'Grand Gallery complete', 'room');
  add(E('queen-shafts'), "Queen's Chamber shafts complete", 'room');
  add(E('relieving'), 'Relieving chambers complete', 'room');
  add(E('king-shafts'), "King's Chamber shafts complete", 'room');
  // half the stone, from the per-day history
  const by = run.sim.hist.blocksByDay, half = S.blocksSet / 2;
  for (let d = 0, sum = 0; d < by.length; d++) { sum += by[d]; if (sum >= half) { add((d + 1) * DAY, 'Half the stone set', 'course'); break; } }
  const halfCourse = COURSES.findIndex((c) => c.y1 >= HEIGHT / 2);
  add(S.courseDone[halfCourse], 'Half the height reached', 'course');
  add(E('pyramidion'), 'Capstone set', 'capstone');
  return out.sort((a, b) => a.t - b.t);
}

// The summary posted once the whole build has run.
export function runSummary(run) {
  const S = run.sim.state, days = Math.ceil(S.t / DAY);
  return {
    endT: S.t, days, months: Math.ceil(S.t / MONTH), hash: run.sim.hash(), blocks: S.blocksSet, courses: LAST + 1,
    blocksByDay: run.sim.hist.blocksByDay.slice(0, days),
    courseOpen: S.courseOpen.slice(), courseDone: S.courseDone.slice(), elemDone: S.elemDone.slice(),
    elem: ELEM, elemTotal: Array.from(run.sim.ctx.elemTotal),
    milestones: milestones(run), snapshots: run.snapshots.length,
    switchCi: run.sim.ctx.theory.switchCi, rampName: run.sim.ctx.theory.name,
  };
}
