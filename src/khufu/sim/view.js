// What the timeline, the statistics panel and the renderer read from the event model
// (Phase 3). Plain data out of a model positioned at some time, so it can be posted from
// the worker to the page. No three.js, no DOM: it also runs in Node (scripts/khufu-seek.mjs).
import { COURSES, HEIGHT } from '../data.js';
import { DAY, MONTH } from './params.js';
import { seek } from './index.js';
import { ELEM, HV } from './planner.js';
import { GIZA, TURA, HEAVY, LAST } from './model.js';
import { worksSchedule } from './works.js';
import { theoryStats } from './compare.js';
import { courseSurface, stockSpot } from './gangs.js';
import { FACES } from './ramps/straightZigzag.js';

// Live state of a queue resource at time t (see resource.js): `pend` holds the service start
// times of users not yet served, `nf` when each server comes free.
export function waitingAt(R, t) { let n = 0; for (const v of R.pend) if (v > t) n++; return n; }
export function inUseAt(R, t) { let n = 0; for (const v of R.nf) if (v > t) n++; return Math.min(n, R.cap); }

const FACE = ['south', 'east', 'north', 'west'];
const CORNER = ['south-west', 'south-east', 'north-east', 'north-west'];
export function laneName(key) {
  const m = /^(straight|zigzag|spiral|internal)(\d+)$/.exec(key);
  if (!m) return key;
  if (m[1] === 'internal') return 'Internal ramp';
  if (m[1] === 'spiral') return `Spiral ramp from the ${CORNER[+m[2]] || `route ${m[2]}`} corner`;
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
  const gangs = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; // waiting, out, returning, off site (a levy gone home)
  for (let g = 0; g < S.gang.kind.length; g++) gangs[S.gang.kind[g]][S.gang.task[g]]++;
  let facesCutting = 0, facesFull = 0, facesDone = 0, facesAway = 0;
  for (let f = 0; f < S.quarry.idle.length; f++) { const s = S.quarry.idle[f]; if (s === 0) facesCutting++; else if (s === 1) facesFull++; else if (s === 2) facesDone++; else facesAway++; }
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
      ci: S.cur, open: rt.open, total, left: rt.setLeft + rt.heavyLeft, t,
      gSet: rt.gSet.slice(), tSet: rt.tSet.slice(), gClaim: rt.gClaim.slice(), tClaim: rt.tClaim.slice(), heavyState: rt.heavyState.slice(),
      // stones claimed but not yet set (drawn on their way: stonesView): [sector, kind, claim index, arrives]
      work: workOf(rt),
    };
  }
  const built = sim.builtCourses();
  return {
    t, day: Math.floor(t / DAY), done: S.done, built, cur: S.cur,
    topY: built > LAST ? HEIGHT : built > 0 ? COURSES[built - 1].y1 : 0,
    blocksSet: S.blocksSet, events: S.ev,
    workforce: sim.workforce(),
    rotation: sim.rotation(),
    gangs: { giza: gangs[GIZA], tura: gangs[TURA], heavy: gangs[HEAVY] },
    quarry: { stock: S.quarry.stock, cap: P.quarry.yardCap, cut: S.quarry.cut, faces: S.quarry.idle.length, facesCutting, facesFull, facesDone, facesAway },
    harbour: { tura: S.harbour.tura, cap: P.tura.stockCap, shipped: S.harbour.shipped, delivered: S.harbour.delivered, granite: S.harbour.granite, graniteDelivered: S.harbour.graniteDelivered, boats: P.tura.boats, boatsLoaded },
    queues: queues.slice(0, 8), landingWaiting, landings,
    elemSet: Array.from(S.elemSet),
    course,
    stones: stonesView(sim),
  };
}

const workOf = (rt) => rt.work.flatMap((list, s) => list.map((w) => [s, w[0], w[1], w[2] + w[4]]));

// The stones lying at the landings and those being moved to their places, in the course being
// laid and the next one (stonesAt() in gangs.js places them at any time after this one).
export function stonesView(sim) {
  const S = sim.state, piles = [], work = [];
  for (const ci of new Set([S.cur, S.look])) {
    const rt = !S.done && S.rt[ci];
    if (!rt) continue;
    const p = sim.plan(ci);
    for (let s = 0; s < rt.nSec; s++) {
      const gp = rt.gPile[s], tp = rt.tPile[s], wk = rt.work[s];
      if (!gp.length && !tp.length && !wk.length) continue;
      const [x, z, fx, fz] = stockSpot(p, s), pi = piles.length;
      const top = (a) => a.slice(-6).reverse(); // (the top ones are still being levered onto the pile)
      piles.push({ ci, s, x, z, fx, fz, y: COURSES[ci].y0, cell: p.cell, hw: p.hw, h: p.h, sw: p.cell * 0.96, sh: p.h * 0.97, gn: gp.length, tn: tp.length, gTop: top(gp), tTop: top(tp) });
      const sec = p.sectors[s];
      for (const [kind, i, t0, t1, move, rank, td] of wk) {
        const cell = kind === 0 ? sec.giza[i] : sec.tura[i];
        work.push({ pile: pi, kind, i, t0, t1, move, rank, td, x: -p.hw + ((cell % p.n) + 0.5) * p.cell, z: -p.hw + (((cell / p.n) | 0) + 0.5) * p.cell });
      }
    }
  }
  return { t: S.t, piles, work };
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
  const type = new Uint8Array(n), elem = new Uint8Array(n);
  for (let j = 0; j < n; j++) { type[j] = p.type[cells[j]]; elem[j] = p.elem[cells[j]]; }
  // heavy items, HV numbers each: x, z, granite (0/1), length along its axis (a roof beam's
  // span plus its bearings; else a cell), axis (0 x, 1 z), element tag, roof beam (0/1)
  const heavy = new Float32Array(p.heavy.length * HV);
  p.heavy.forEach((h, j) => {
    const roof = h.kind === 'roof';
    heavy.set([h.x, h.z, h.granite ? 1 : 0, roof ? h.span + 1 : p.cell, h.axis === 'x' ? 0 : 1, h.elem, roof ? 1 : 0], HV * j);
  });
  // where each ramp (or ledge) arrives at the edge of the course: the stones of the outer ring
  // there are left open (see rampOpening() in gangs.js), [face, along the face, half width]
  const R = sim.P.ramp, openings = [];
  for (const rt of p.layout.routes) {
    const [nrm, tan] = FACES[rt.face % 4], last = rt.segs[rt.segs.length - 1];
    if (rt.head[0] * nrm[0] + rt.head[1] * nrm[1] < p.hw - p.cell) continue; // (an internal ramp comes up inside)
    const half = last.kind === 'straight' ? R.straight.width / 2 : (R[last.kind]?.width ?? R.zigzag.width) / 2 + 1.5;
    openings.push([rt.face % 4, rt.head[0] * tan[0] + rt.head[1] * tan[1], half]);
  }
  return { ci, n: p.n, cell: p.cell, hw: p.hw, y0: p.y0, h: p.h, sectors: k, off, cells, type, elem, heavy, openings, trench: rampTrench(sim, p.y0, p.y0 + p.h) };
}

// A ramp inside the masonry (the internal ramp) is a gallery with `clearance` m of masonry
// over it, but where it comes up to the course being laid that roof thins out: from where its
// floor is `clearance` below the top of the built courses (y0) up to the top of this course
// (y1) it is drawn as a trench open to the sky. Its plan as rectangles [x0, x1, z0, z1]: the
// top of the built courses is cut there (Monument.setHoles) and the stones of this course are
// left out (rampOpening() in gangs.js), so gangs climbing it are not drawn in the masonry.
export function rampTrench(sim, y0, y1) {
  const th = sim.ctx.theory;
  if (!th.ledgeInside || !(y1 > th.switchY)) return [];
  const I = sim.P.ramp.internal, w = I.width / 2, lo = y0 - I.clearance, p = th.ledge(0, y1).pts, out = [];
  for (let i = 3; i < p.length; i += 3) {
    let ax = p[i - 3], ay = p[i - 2], az = p[i - 1], bx = p[i], by = p[i + 1], bz = p[i + 2];
    if (Math.max(ay, by) <= lo) continue;
    if (ay < lo) { const k = (lo - ay) / (by - ay); ax += (bx - ax) * k; az += (bz - az) * k; ay = lo; }
    out.push([Math.min(ax, bx) - w, Math.max(ax, bx) + w, Math.min(az, bz) - w, Math.max(az, bz) + w]);
  }
  return out;
}

// The course being laid at the model's current time as gangs walk on it (courseSurface() in
// gangs.js), from the same counts as viewState().course: for scripts and tests, which place
// the figures as the page does.
const surfaces = new WeakMap();
export function courseSurfaceOf(sim) {
  const S = sim.state, rt = !S.done && S.rt[S.cur];
  if (!rt) return null;
  const course = { ci: S.cur, t: S.t, gClaim: rt.gClaim, tClaim: rt.tClaim, heavyState: rt.heavyState, work: workOf(rt) };
  const sig = `${S.cur}:${rt.gClaim.join(',')}:${rt.tClaim.join(',')}:${rt.heavyState.join('')}:${course.work.filter((w) => w[3] > S.t).map((w) => w.join(',')).join(';')}`;
  let c = surfaces.get(sim);
  if (!c || c.ci !== S.cur) surfaces.set(sim, (c = { ci: S.cur, L: courseLayout(sim, S.cur), sig: null, surf: null }));
  if (c.sig !== sig) { c.sig = sig; c.surf = courseSurface(c.L, course); }
  return c.surf;
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
  if (ctx.theory.switchLabel) add(S.courseOpen[ctx.theory.switchCi], ctx.theory.switchLabel, 'ramp');
  // (the tour's ramp stop is the switch, not this: see tour.js)
  if (ctx.theory.top && S.courseOpen[ctx.theory.top.ci] >= 0) out.push({ t: S.courseOpen[ctx.theory.top.ci], label: ctx.theory.top.label, kind: 'ramp', top: true });
  add(E('antechamber'), 'Antechamber complete', 'room');
  add(E('king'), "King's Chamber roofed", 'room');
  add(E('gallery'), 'Grand Gallery complete', 'room');
  add(E('queen-shafts'), "Queen's Chamber shafts complete", 'room');
  add(E('relieving'), 'Relieving chambers complete', 'room');
  add(E('king-shafts'), "King's Chamber shafts complete", 'room');
  // the special works scheduled on top of the model (works.js)
  const W = worksSchedule(worksInput(run));
  for (const w of W.order) if (/^(subterranean-stop|plugs-stored|relieving-[1-4]|plugged)$/.test(w.id)) add(w.t, w.label, 'room');
  add(W.stair.t1, 'Access stair built', 'course');
  // half the stone, from the per-day history
  const by = run.sim.hist.blocksByDay, half = S.blocksSet / 2;
  for (let d = 0, sum = 0; d < by.length; d++) { sum += by[d]; if (sum >= half) { add((d + 1) * DAY, 'Half the stone set', 'course'); break; } }
  const halfCourse = COURSES.findIndex((c) => c.y1 >= HEIGHT / 2);
  add(S.courseDone[halfCourse], 'Half the height reached', 'course');
  add(E('pyramidion'), 'Capstone set', 'capstone');
  return out.sort((a, b) => a.t - b.t);
}

const worksInput = (run) => { const S = run.sim.state; return { courseOpen: S.courseOpen, courseDone: S.courseDone, elemDone: S.elemDone, elem: ELEM, endT: S.t }; };

// The summary posted once the whole build has run.
export function runSummary(run) {
  const S = run.sim.state, days = Math.ceil(S.t / DAY);
  const out = {
    endT: S.t, days, months: Math.ceil(S.t / MONTH), hash: run.sim.hash(), blocks: S.blocksSet, courses: LAST + 1,
    blocksByDay: run.sim.hist.blocksByDay.slice(0, days),
    courseOpen: S.courseOpen.slice(), courseDone: S.courseDone.slice(), elemDone: S.elemDone.slice(),
    elem: ELEM, elemTotal: Array.from(run.sim.ctx.elemTotal),
    milestones: milestones(run), snapshots: run.snapshots.length,
    switchCi: run.sim.ctx.theory.switchCi, rampName: run.sim.ctx.theory.name, theory: theoryStats(run.sim),
    works: worksSchedule(worksInput(run)),
  };
  // the timeline runs on past the capstone (endT) until the access stair is built
  out.finishT = out.works.stair.t1;
  return out;
}
