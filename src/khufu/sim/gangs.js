// Gang tokens for the detail bubble (Phase 4): where every sled gang is, and where each of
// its people stands, at any moment. No three.js, no DOM: the worker builds the trips and the
// page (and scripts/khufu-gangs.mjs in Node) places the figures from them.
//
// Two halves:
//  - In the worker, gangTrips(sim) turns each gang's current trip in the event model
//    (S.gang and its times t[g·NT + T.*]) into a plain "trip": a few 3D polylines (the yard,
//    the way out, the way back) and a list of knots (time, activity, from path/arc length,
//    to path/arc length). Between knots a gang moves at a constant speed along its path or
//    stands still, so the knots are exactly the model's events: leaving the loading bay,
//    reaching the ramp foot, entering the lane, the switchbacks, the top, the landing, the
//    unloading, and the walk home. Knots only ever get added as the model learns more (the
//    climb is known once the gang reaches the foot), so a trip read at one time still gives
//    the right place at a later time until its last knot, and holds there after it.
//  - figures(trip, t, out) places the sled, its stone and every member of the crew at time t,
//    as a pure function of the trip and t. Nothing depends on history or on how near the
//    camera is, so a gang drawn as articulated workers, as simple figures or as a bare sled
//    stands in exactly the same place: crossing the edge of the bubble changes only how
//    detailed it looks, never where it is.
//
// Geometry. Roads come from the model (plan.road.qPath/hPath). The ramps are drawn here; for
// the straight-then-zigzag theory:
//  - The straight ramps are wedges against the middle of each face, raised as the course is
//    laid (see rampScene). Gangs on them follow that surface, so every gang stands on the
//    drawn ramp whichever course it is delivering to; one bound for the next course steps up
//    onto its bed at the top.
//  - The zigzag on each face is one fixed path from the top of the straight ramp to the apex
//    (flights across most of the face width at 1:6); a course uses the stretch of it up to
//    its own bed. Gangs pause at each switchback for the model's turning time.
// A theory whose ramp is a fixed path (the spiral ledges, the internal ramp) gives that path
// itself (theory.ledge, see ramps/index.js), and gangs climb it the same way, pausing at its
// corners.
// Times between knots come from the model; the drawn paths are only used for shape, so a
// path a few metres longer or shorter than the model's road just changes the drawn speed.
// Queues (at the ramp foot, the zigzag entry and each landing berth) are part of a trip too:
// who is ahead of the gang and when each leaves is read from the model (see capOf). Gangs
// keep to lanes: on the roads by their number, on a straight ramp the lane the model gave
// them, in the middle of the single-lane zigzag, and to their berth at the landing.
import { HALF, HEIGHT, TAN, COURSES, halfWidthAt, groundHeight } from '../data.js';
import { T, NT, TASK, GIZA, TURA, HEAVY, LAST } from './model.js';
import { roadNetwork } from './roads.js';
import { FACES } from './ramps/straightZigzag.js';
import { HV } from './planner.js';

// lane offsets (m to the left of travel) of the two lanes of a road or straight ramp
const LANES = [1.4, 3.6];
// berths of a landing, to the left (+) and right (−) of the way in
const BERTH = [2.4, -2.4];
// what a gang is doing between two knots
export const ACT = { IDLE: 0, LOAD: 1, HAUL: 2, WAIT: 3, TURN: 4, UNLOAD: 5, RETURN: 6, WALK: 7, SET: 8 };
export const ACT_NAME = ['idle', 'loading', 'hauling', 'waiting', 'turning', 'unloading', 'returning', 'walking', 'setting'];
// crews regroup (walk round the sled) during these instead of moving along the path
const BLEND = [0, 1, 0, 0, 0, 1, 0, 0, 1];
// poses for figures (the page maps them onto the crowd renderer's poses)
export const POSE = { REST: 0, PULL: 1, WALK: 2, POUR: 3, LEVER: 4, PUSH: 5, KNEEL: 6 };
export const KN = 6; // numbers per knot: t, act, path a, s a, path b, s b

// ---- ramps as drawn ---------------------------------------------------------------------
const zigCache = new Map();
// The zigzag up one face as [u, y] corners (u along the face from its middle), from the top
// of the straight ramps to the apex. The same for every face and every course.
function zigCorners(sw, grade) {
  const key = `${sw}:${grade}`;
  if (zigCache.has(key)) return zigCache.get(key);
  const pts = [[0, sw]];
  let u = 0, y = sw, dir = 1;
  while (y < HEIGHT - 1e-6) {
    const A = Math.max(2, 0.8 * halfWidthAt(y)); // flights over most of the face, at least 4 m
    const du = Math.abs(dir * A - u);
    if (y + du * grade >= HEIGHT) { u += dir * (HEIGHT - y) / grade; y = HEIGHT; pts.push([u, y]); break; }
    u = dir * A; y += du * grade; pts.push([u, y]); dir = -dir;
  }
  zigCache.set(key, pts);
  return pts;
}

// The ramps standing at the model's current time (what the page draws, and what gangs walk on).
// The straight ramps are raised as the course is laid: from the bed of the course being laid
// when it opens to the bed of the next one when its last stone is set, in 2 cm lifts. So the
// ramp, and every gang on it, rises a little at a time instead of a course at a time.
export const LIFT = 0.02;
export function rampScene(sim) {
  const S = sim.state, R = sim.P.ramp, th = sim.ctx.theory;
  const look = S.done ? LAST : Math.max(S.cur, S.look);
  const top = COURSES[look].y0;
  const sw = th.switchY ?? Infinity;
  let Y = COURSES[S.cur].y0;
  const rt = !S.done && S.rt[S.cur];
  if (rt && S.cur < LAST) {
    const total = rt.gTot.reduce((a, b) => a + b, 0) + rt.tTot.reduce((a, b) => a + b, 0) + rt.heavyState.length;
    const done = total ? 1 - (rt.setLeft + rt.heavyLeft) / total : 1;
    Y += (COURSES[S.cur].y1 - Y) * done;
  }
  Y = Math.min(sw, Math.floor(Y / LIFT + 1e-6) * LIFT);
  const hr = halfWidthAt(Y);
  const F = Math.max(hr + (R.straight.grade > 0 ? Y / R.straight.grade : 0), HALF + 3);
  const zw = R.zigzag.width;
  const plat = Math.min(zw / 2, (F - hr) / 2); // a flat landing at the top of each straight ramp
  // top of the finished courses, as the gangs walk on it. Once the capstone is set the build
  // is done, but the capstone gang is still on the top and walks home down the same ramps:
  // the ground its trip is built on (this, and the straight ramps in terrainY) stays as it
  // stood when the capstone went up, so the trip the worker sends at that moment puts every
  // man where the trip before it did. Only the drawing of the ramps goes (done).
  const built = COURSES[S.cur].y0;
  return {
    key: `${look}:${Y.toFixed(2)}:${S.cur}:${S.done ? 1 : 0}`, look, done: S.done, top, sw, Y, hr, F, plat, built, w: R.straight.width,
    zw, zgrade: R.zigzag.grade, zig: !th.ledge && Number.isFinite(sw) && R.zigzag.grade > 0 ? zigCorners(sw, R.zigzag.grade) : null, // (a flat zigzag would never reach the top)
  };
}

// point of the zigzag of face f at (u, y): the ledge runs just outside the face
function zigXYZ(R, f, u, y, out, o) {
  const [n, t] = FACES[f], r = halfWidthAt(y) + R.zw / 2;
  out[o] = n[0] * r + t[0] * u; out[o + 1] = y; out[o + 2] = n[1] * r + t[1] * u;
}
// The zigzag of face f from its start up to height y: Float32Array of xyz, and how many
// switchbacks it passes on the way.
export function zigPrefix(R, f, y) {
  const Z = R.zig, pts = [];
  pts.push(Z[0]);
  let turns = 0;
  for (let i = 1; i < Z.length; i++) {
    if (Z[i][1] >= y - 1e-9) {
      const a = Z[i - 1], b = Z[i], k = (y - a[1]) / Math.max(1e-9, b[1] - a[1]);
      pts.push([a[0] + (b[0] - a[0]) * k, y]);
      break;
    }
    pts.push(Z[i]); turns++;
  }
  const out = new Float32Array(pts.length * 3);
  pts.forEach(([u, yy], i) => zigXYZ(R, f, u, yy, out, i * 3));
  return { pts: out, turns };
}

// Height of the straight ramp of face f at (x, z) (−Infinity where there is none): rising
// from its foot to the landing at its head, 1:1 side slopes, and a 1:1 drop off the head
// onto the course below the one it serves.
function wedgeY(R, f, x, z) {
  if (R.Y <= 0) return -Infinity;
  const [n, t] = FACES[f], r = x * n[0] + z * n[1], u = x * t[0] + z * t[1];
  const a = r >= R.hr + R.plat ? R.Y * Math.min(1, Math.max(0, (R.F - r) / (R.F - R.hr - R.plat))) : r >= R.hr ? R.Y : R.Y - (R.hr - r);
  return a - Math.max(0, Math.abs(u) - R.w / 2);
}
// the ground, the straight ramps and the finished courses (their faces and flat top)
export function terrainY(R, x, z) {
  let y = groundHeight(x, z);
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m < HALF) y = Math.max(y, Math.min(R.built, TAN * (HALF - m)));
  for (let f = 0; f < 4; f++) { const w = wedgeY(R, f, x, z); if (w > y) y = w; } // (also once done: see rampScene)
  return y;
}
// axis-aligned boxes around the straight ramps, where the ground is not flat
function wedgeBoxes(R) {
  if (R.Y <= 0) return [];
  const half = R.w / 2 + R.Y + 1;
  return FACES.map(([n, t]) => {
    const r0 = R.hr - R.Y - 1, r1 = R.F + 1;
    const xs = [n[0] * r0 + t[0] * half, n[0] * r0 - t[0] * half, n[0] * r1 + t[0] * half, n[0] * r1 - t[0] * half];
    const zs = [n[1] * r0 + t[1] * half, n[1] * r0 - t[1] * half, n[1] * r1 + t[1] * half, n[1] * r1 - t[1] * half];
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  });
}
// parameter range [t0, t1] of segment a→b inside box [x0, x1, z0, z1], or null
function clip(ax, az, bx, bz, [x0, x1, z0, z1]) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}
const FLAT = 415; // the plateau is flat (groundHeight 0) inside this square

// A polyline under construction: points that follow the ground and the straight ramps (with an
// optional floor, the bed of a course), or fixed 3D points (the zigzag).
class Builder {
  constructor(R) { this.R = R; this.p = []; this.boxes = wedgeBoxes(R); }
  get n() { return this.p.length / 3; }
  fixed(x, y, z) { this.p.push(x, y, z); return this; }
  start(x, z, floor = -Infinity) { this.p.push(x, Math.max(floor, terrainY(this.R, x, z)), z); return this; }
  // follow the surface to (x, z), with samples where it is not flat
  to(x, z, floor = -Infinity) {
    const n = this.p.length, ax = this.p[n - 3], az = this.p[n - 1];
    const len = Math.hypot(x - ax, z - az);
    const ts = [1];
    const add = (a, b, step) => { const k = Math.ceil(((b - a) * len) / step); for (let i = 0; i <= k; i++) ts.push(a + ((b - a) * i) / Math.max(1, k)); };
    for (const box of this.boxes) { const c = clip(ax, az, x, z, box); if (c) add(c[0], c[1], 3); }
    const inner = clip(ax, az, x, z, [-FLAT, FLAT, -FLAT, FLAT]);
    if (!inner) add(0, 1, 10);
    else { if (inner[0] > 0) add(0, inner[0], 10); if (inner[1] < 1) add(inner[1], 1, 10); }
    ts.sort((a, b) => a - b);
    let last = 0;
    for (const t of ts) {
      if (t <= last + 1e-7) continue;
      const px = ax + (x - ax) * t, pz = az + (z - az) * t;
      this.p.push(px, Math.max(floor, terrainY(this.R, px, pz)), pz);
      last = t;
    }
    return this;
  }
  zig(xyz) { for (let i = 3; i < xyz.length; i += 3) this.p.push(xyz[i], xyz[i + 1], xyz[i + 2]); return this; }
  done() { return Float32Array.from(this.p); }
}

// ---- polylines with arc length ------------------------------------------------------------
export class Line {
  constructor(p) {
    this.p = p;
    const n = p.length / 3;
    this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(p[3 * i] - p[3 * i - 3], p[3 * i + 1] - p[3 * i - 2], p[3 * i + 2] - p[3 * i - 1]);
    this.L = this.cum[n - 1];
  }
  // position at arc length s (beyond the ends, along the end segments) into out[o..o+2]
  at(s, out, o = 0) {
    const p = this.p, c = this.cum, n = c.length;
    if (n === 1) { out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; return out; }
    let i;
    if (s <= 0) i = 1;
    else if (s >= this.L) i = n - 1;
    else { let lo = 1, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m] < s) lo = m + 1; else hi = m; } i = lo; }
    // skip zero-length segments at the ends
    while (i < n - 1 && c[i] - c[i - 1] < 1e-9 && s <= 0) i++;
    while (i > 1 && c[i] - c[i - 1] < 1e-9 && s >= this.L) i--;
    const d = Math.max(1e-9, c[i] - c[i - 1]), k = (s - c[i - 1]) / d;
    const a = 3 * (i - 1), b = 3 * i;
    out[o] = p[a] + (p[b] - p[a]) * k; out[o + 1] = p[a + 1] + (p[b + 1] - p[a + 1]) * k; out[o + 2] = p[a + 2] + (p[b + 2] - p[a + 2]) * k;
    return out;
  }
  // horizontal heading (yaw, as in the crowd renderer: atan2(dx, dz)) at s, smoothed over ±win
  yaw(s, win = 1.5) {
    this.at(s - win, TA); this.at(s + win, TB);
    const dx = TB[0] - TA[0], dz = TB[2] - TA[2];
    if (dx * dx + dz * dz < 1e-10) { this.at(s - 4 * win, TA); this.at(s + 4 * win, TB); return Math.atan2(TB[0] - TA[0], TB[2] - TA[2]); }
    return Math.atan2(dx, dz);
  }
  // slope (rise over run) at s
  slope(s, win = 0.8) {
    this.at(s - win, TA); this.at(s + win, TB);
    const h = Math.hypot(TB[0] - TA[0], TB[2] - TA[2]);
    return h < 1e-6 ? 0 : (TB[1] - TA[1]) / h;
  }
}
const TA = [0, 0, 0], TB = [0, 0, 0];

// ---- yards ------------------------------------------------------------------------------
// Gangs wait in rows at the quarry (Giza sleds) and on the quay (Tura sleds and the heavy
// gangs), each in its own spot, facing away from the gate (the model's quarry / harbour
// point). A spot is reached along the yard's avenue, straight out from the gate between the
// two halves of every row, then along the cross-aisle in front of the row, and last straight
// in from behind, so no gang walks through another parked in the yard. Rows are far enough
// apart for a gang to pass between one row's front ranks and the next row's levermen.
function yard(P, kind, i) {
  const q = kind === GIZA;
  const gate = q ? P.quarry.at : P.harbour.at;
  const d = q ? [0, 1] : [1, 0], l = [d[1], -d[0]];
  // cols: spots per row (half on each side of the avenue); dx apart; rows dz apart; the
  // cross-aisle `aisle` m behind each row's sleds (in the cross-aisles gangs keep YARD_LANE m left of
  // the middle: one getting ready in its spot reaches out to 9.5 m in front of its sled)
  const cols = q ? 16 : 6, dx = q ? 5 : 6, dz = q ? 28 : 50, aisle = q ? 13 : 14, avenue = 12; // (room to overtake: see passWindows)
  const col = i % cols, row = Math.floor(i / cols), half = cols / 2;
  const side = (col < half ? -1 : 1) * (avenue + (col % half) * dx);
  const f = 14 + row * dz;
  const at = (ff, ss) => [gate[0] + d[0] * ff + l[0] * ss, gate[1] + d[1] * ff + l[1] * ss];
  const slot = at(f, side), app = at(f - aisle, side), cross = at(f - aisle, 0);
  // from the spot to the gate (the road starts there)
  return { gate, slot, app, way: [slot, app, cross] };
}
// index of gang g among the gangs waiting at the same yard
function yardIndex(P, g, kind) {
  if (kind === GIZA) return g;
  if (kind === TURA) return g - P.haul.gangs;
  return g - P.haul.gangs; // heavy gangs park after the Tura gangs on the quay
}

// ---- trips ------------------------------------------------------------------------------
// A small cache of course plans, so a gang walking back from a course that is already
// finished (and dropped from the model's own cache) does not make the model keep it.
function planner(sim) {
  const mine = new Map();
  return (c) => {
    if (sim.ctx.plans.has(c)) return sim.ctx.plans.get(c);
    if (mine.has(c)) return mine.get(c);
    const S = sim.state, keep = c === S.cur || c === S.look;
    const p = sim.plan(c);
    if (!keep) { sim.ctx.plans.delete(c); mine.set(c, p); if (mine.size > 3) mine.delete(mine.keys().next().value); }
    return p;
  };
}

// The way out for a gang of course c on ramp route `route`, from its yard spot (or from the
// gate) along the road, up the ramp and across the course to `end` ([x, z]). Returns the
// polyline and the arc lengths of the ramp foot, the top of the straight ramp, the head
// (where the ramp meets the course) and the end, plus the switchbacks passed on the zigzag.
function wayOut(sim, R, plan, c, route, src, y, end, via = null) {
  const B = new Builder(R);
  const road = src === 'q' ? plan.road.qPath[route] : plan.road.hPath[route];
  let iCross = 0, iRoad = 0; // where the gang reaches the yard's avenue, and the gate
  if (y) { B.start(y.way[0][0], y.way[0][1]); for (const [x, z] of y.way.slice(1)) B.to(x, z); iCross = B.n - 1; B.to(road[0][0], road[0][1]); iRoad = B.n - 1; }
  else B.start(road[0][0], road[0][1]);
  for (let i = 1; i < road.length; i++) B.to(road[i][0], road[i][1]);
  const iFoot = B.n - 1;
  const rt = plan.layout.routes[route], bed = COURSES[c].y0;
  const f = rt.face, th = sim.ctx.theory;
  // a fixed path (the zigzag, or a theory's ledge): reached up the straight ramp (zigzag) or
  // straight from the foot (spiral, internal ramp)
  const ledge = rt.segs.some((s) => s.kind !== 'straight') && (th.ledge || (rt.segs.length > 1 && R.zig));
  let iSwitch, iHead, corners = [];
  if (ledge) {
    const zp = th.ledge ? th.ledge(rt.id, bed) : zigPrefix(R, f, bed);
    B.to(zp.pts[0], zp.pts[2]); // (the zigzag ledge starts where the straight ramp ends)
    iSwitch = B.n - 1;
    const base = B.n - 1;
    B.zig(zp.pts);
    if (zp.cornerIdx) for (const k of zp.cornerIdx) corners.push(base + k);
    else for (let k = 1; k <= zp.turns; k++) corners.push(base + k); // every zigzag point is a switchback
    iHead = B.n - 1;
  } else {
    B.to(rt.head[0], rt.head[1]);
    iSwitch = iHead = B.n - 1;
  }
  if (via) B.to(via[0], via[1], bed);
  B.to(end[0], end[1], bed);
  const line = new Line(B.done());
  const S = (i) => line.cum[i];
  return { line, sCross: S(iCross), sRoad: S(iRoad), sFoot: S(iFoot), sSwitch: S(iSwitch), sHead: S(iHead), L: line.L, corners: corners.map(S) };
}

// the idle path: the last stretch into the yard spot
function idlePath(R, y) { return new Builder(R).start(y.app[0], y.app[1]).to(y.slot[0], y.slot[1]).done(); }

const hqCache = new Map();
function harbourToQuarry(P) {
  const k = `${P.harbour.at}:${P.quarry.at}`;
  if (!hqCache.has(k)) hqCache.set(k, roadNetwork([P.harbour.at], [P.quarry.at]).path[0][0]);
  return hqCache.get(k);
}

// the stone on the sled: [across, height, along, material] (0 core, 1 casing, 2 granite, 3 capstone)
function loadOf(plan, kind, sector) {
  if (kind !== HEAVY) return [plan.cell * 0.96, plan.h * 0.97, plan.cell * 0.96, kind === TURA ? 1 : 0];
  const it = plan.heavy[sector];
  if (it.kind === 'capstone') return [Math.min(2.6, it.span), plan.h, Math.min(2.6, it.span), 3];
  if (it.kind === 'roof') return [plan.cell * 0.96, plan.h * 0.97, it.span + 1, it.granite ? 2 : 0]; // 0.5 m bearing on each wall
  return [plan.cell * 0.96, plan.h * 0.97, plan.cell * 0.96, 2];
}

// ---- queues ----------------------------------------------------------------------------
// The model queues gangs at the foot of a straight ramp (for one of its lanes), at the entry
// of a zigzag and at each landing berth. A queue is drawn as a line along the gang's own
// path: a gang may not come closer to the waiting point than the length of every gang still
// ahead of it, and moves up (at a slow walk) as each one leaves. Who is ahead, and when it
// leaves, is read from the model, so a gang's place in a queue is part of its trip:
//   cap = { li, t0, t1, s, h: [length, in, out, τ, …] }
// for t0 ≤ t < t1 the gang is no farther along path li than s − Σ length·c(t), where each
// gang ahead counts c = (eased in over τ from `in`) × (eased out over τ from `out`), τ being
// the time to move up one gang length.
// At the foot, the gangs ahead are those that reach it first (the model serves the foot
// first come, first served), counted from just before they arrive until they enter the lane
// (for good while that is not known yet), so news about them only ever changes the future:
// a gang's arrival is known from the moment it sets off, and when it will enter the lane from
// the moment it arrives. Gangs keep to their own road lane there (two lines); heavy gangs,
// which take the whole ramp, count in both.
const QV = 0.5; // m/s moving up in a queue
const YARD_LANE = 1.8; // m to the left of a yard's cross-aisle
const TURN_STOP = 30; // s stopped at each switchback, at most
const QGAP = 2.5; // m between two gangs in a queue
function gangLength(kind, crew, load) {
  const spec = crewSpec(kind, crew), lead = (load ? load[2] / 2 : 0.7) + (kind === HEAVY ? 1.6 : 0.9);
  return lead + spec.ranks * spec.gap + lead * 0.9 + 0.5 + QGAP;
}
function queueIndex(sim, plans) {
  const S = sim.state, P = sim.P, G = S.gang, now = S.t;
  const foot = new Map(), zig = new Map(), land = new Map();
  const add = (m, k, v) => { let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(v); };
  for (let h = 0; h < G.kind.length; h++) {
    // (a gang that has just unloaded still counts while the one behind it moves up)
    if (G.task[h] === TASK.WAITING || G.course[h] < 0) continue;
    const tb = h * NT, c = G.course[h], plan = plans(c), kind = G.kind[h], heavy = kind === HEAVY;
    const rt = plan.layout.routes[G.route[h]];
    const len = gangLength(kind, heavy ? P.heavy.crew : P.haul.crew, loadOf(plan, kind, G.sector[h]));
    const known = G.t[tb + T.FOOT] <= now;
    // (counted until it has cleared the foot, gang and all, a little after it enters the lane:
    // the one behind closes up behind it, not onto it)
    const clear = (len + 14) / (P.haul.vLoaded * (heavy ? P.heavy.speedFactor : 1));
    // (and counted from when it sets off, not only as it arrives: a queue for a single ramp lane,
    // as for the internal ramp, can reach far back down the road, and the gangs on their way to
    // it keep their places in it)
    add(foot, rt.segs[0].res, { h, at: G.t[tb + T.FOOT], from: G.t[tb + T.DEPART], out: known ? G.t[tb + T.CLIMB] + clear : Infinity, len, line: heavy ? -1 : h % 2 });
    if (!known) continue;
    if (rt.segs.length > 1) add(zig, rt.segs[1].res, { h, at: G.t[tb + T.ARR1], serve: G.t[tb + T.ENT1], out: G.t[tb + T.ENT1], len });
    if (!heavy) add(land, `${c}:${G.sector[h]}:${G.berth[h]}`, { h, at: G.t[tb + T.LAND], serve: G.t[tb + T.UNLOAD], out: G.t[tb + T.DONE], len });
  }
  return { foot, zig, land, now };
}
// the cap for gang g in queue list `q` (entries ahead: `ahead(e)`), from t0 to t1, on path li
// below arc length s; eased in from each entry's arrival when `fromArrival`
// (each counted in over τ ending at its arrival `at`)
// (lo: never hold the gang farther back than this, where it already is when the queue starts
// to apply: a queue longer than the stretch before it piles up there rather than reaching
// back past the gang)
function capOf(Q, q, g, ahead, li, t0, t1, s, lo = -Infinity) {
  const h = [];
  for (const e of q || []) {
    if (e.h === g || !ahead(e)) continue;
    // kept even once its effect is over: the gang's own times (when it climbs, when it
    // unloads) are worked out from the whole list, so the list must not shrink under it
    const tau = e.len / QV;
    // (counted in over τ ending at its arrival, or from when it sets off if that is earlier,
    // which is never before its trip is known)
    h.push(e.len, Math.min(e.at - tau, e.from ?? Infinity), e.out, tau);
  }
  return h.length ? { li, t0, t1, s, h, lo } : null;
}
// the farthest along path cap.li the gang may be at time t
export const capLim = (cap, t) => Math.max(cap.lo ?? -Infinity, cap.s - capBack(cap, t));
// how far back from cap.s the gang has to stay at time t
export function capBack(cap, t) {
  const h = cap.h;
  let d = 0;
  for (let i = 0; i < h.length; i += 4) {
    const tau = h[i + 3];
    const cin = smooth((t - h[i + 1]) / tau);
    const cout = h[i + 2] === Infinity ? 1 : 1 - smooth((t - h[i + 2]) / tau);
    d += h[i] * cin * cout;
  }
  return d;
}
const capEnd = (cap) => { let e = -Infinity; for (let i = 0; i < cap.h.length; i += 4) e = Math.max(e, cap.h[i + 2] + cap.h[i + 3]); return e; };

// One gang's trip at the model's current time (see the top of the file). Plain data:
//   { g, kind, crew, lane, sig, paths: [Float32Array | index of a path to reverse], knots: Float64Array(KN·k), load }
function tripOf(sim, R, plans, g, Q) {
  const S = sim.state, P = sim.P, G = S.gang, tb = g * NT, tt = (k) => G.t[tb + k];
  const kind = G.kind[g], task = G.task[g], now = S.t;
  const crew = kind === HEAVY ? P.heavy.crew : P.haul.crew;
  // lanes to the left of the way travelled: on the roads by the gang's number, on the straight
  // ramp the lane the model gave it (heavy gangs take the whole width, in the middle)
  const lane = kind === HEAVY ? 0 : LANES[g % 2];
  const y = yard(P, kind === GIZA ? GIZA : TURA, yardIndex(P, g, kind));
  const idle = idlePath(R, y);
  const Li = new Line(idle).L;
  const K = [];
  const knot = (t, act, pa, sa, pb, sb) => K.push(t, act, pa, sa, pb, sb);
  // the ground the trip's paths were built on, so each man can stand on it where he is (see
  // placeOn): the straight ramps and the top of the finished courses (see terrainY)
  const ground = { Y: R.Y, hr: R.hr, F: R.F, plat: R.plat, w: R.w, built: R.built };
  const base = { g, kind, crew, lane, yard: y, ground };
  if (task === TASK.WAITING || G.course[g] < 0) {
    knot(-1e15, ACT.IDLE, 0, Li, 0, Li);
    // a levy gang whose month is over is off site (not drawn)
    const away = task === TASK.AWAY;
    return { ...base, sig: `${away ? 'a' : 'w'}${R.done ? 'd' : ''}`, paths: [idle], knots: Float64Array.from(K), load: null, away };
  }
  const c = G.course[g], route = G.route[g], sector = G.sector[g];
  const plan = plans(c);
  const heavy = kind === HEAVY, item = heavy ? plan.heavy[sector] : null;
  // heavy gangs stop on the stone's place, or for a roof beam clear of the opening it spans
  const end = heavy ? item.stand || [item.x, item.z] : plan.sectors[sector].landing, via = heavy ? item.via || null : null;
  const climbKnown = tt(T.FOOT) <= now;

  // paths: 0 idle, 1 way out, 2 way back (reverse of 1, or of a way out from the harbour for
  // heavy gangs that loaded limestone at the quarry), 3 walk from the quay to the quarry
  const limestoneHeavy = heavy && !item.granite;
  const out = wayOut(sim, R, plan, c, route, kind === GIZA || limestoneHeavy ? 'q' : 'h', limestoneHeavy ? null : y, end, via);
  const back = limestoneHeavy ? wayOut(sim, R, plan, c, route, 'h', y, end, via) : out;
  const paths = [idle, out.line.p, limestoneHeavy ? reverse(back.line.p) : 1];
  const Lo = out.L, Lb = back.L;

  if (limestoneHeavy) {
    const w = new Builder(R).start(y.way[0][0], y.way[0][1]);
    for (const [x, z] of y.way.slice(1)) w.to(x, z);
    for (const [x, z] of harbourToQuarry(P)) w.to(x, z);
    paths.push(w.done());
    const Lw = new Line(paths[3]).L, walkT = sim.ctx.hq / P.haul.vEmpty;
    knot(-1e15, ACT.IDLE, 0, Li, 0, Li);
    knot(tt(T.START) - walkT, ACT.WALK, 3, 0, 3, Lw);
    knot(tt(T.START), ACT.LOAD, 3, Lw, 1, 0);
  } else {
    knot(-1e15, ACT.IDLE, 0, Li, 0, Li);
    knot(tt(T.START), ACT.LOAD, 0, Li, 1, 0);
  }
  // The yard is not in the model (its road starts at the gate): the gang walks out of it to the
  // gate in the last part of its loading time, at its speed on the road (at least the last
  // 80 % of the loading time), and sets off from the gate at the model's time.
  const vRoad = (out.sFoot - out.sRoad) / Math.max(1, tt(T.FOOT) - tt(T.DEPART));
  let leave = tt(T.DEPART); // when the gang leaves its spot (or the gate)
  if (out.sRoad > 1e-6) {
    leave = Math.max(tt(T.START) + 0.2 * (tt(T.DEPART) - tt(T.START)), tt(T.DEPART) - out.sRoad / vRoad);
    knot(leave, ACT.HAUL, 1, 0, 1, out.sRoad);
  }
  knot(tt(T.DEPART), ACT.HAUL, 1, out.sRoad, 1, out.sFoot);
  // queues (see capOf): at the foot, and once the climb is known at the zigzag and the berth
  const rt = plan.layout.routes[route];
  const caps = [];
  const line = heavy ? -1 : g % 2;
  const footCap = capOf(Q, Q.foot.get(rt.segs[0].res), g, (e) => (e.at < tt(T.FOOT) || (e.at === tt(T.FOOT) && e.h < g)) && (line < 0 || e.line < 0 || e.line === line),
    1, leave, climbKnown ? tt(T.CLIMB) : Infinity, out.sFoot, 0); // (a queue reaching back past the yard keeps the gang in its spot)
  if (footCap) caps.push(footCap);
  // where a queue holds the gang at time t (s: where it would be without it)
  const capAt = (cap, s, t) => (cap ? Math.min(s, capLim(cap, t)) : s);
  if (!climbKnown) {
    knot(tt(T.FOOT), ACT.WAIT, 1, out.sFoot, 1, out.sFoot);
  } else {
    // Up the ramp. The model's own times are kept wherever the gang waits or arrives: at the
    // foot (queueing for the lane), at the top of the straight ramp (queueing for the zigzag)
    // and on the landing. The drawn ramps are not the model's to the metre (the zigzag is one
    // fixed path, a course-0 ramp has no length in the model but a few metres drawn), so the
    // time between two of those moments is shared out over the drawn stretches by their
    // length at the model's speed on each (slower on a slope), plus the switchback pauses.
    // That keeps every drawn speed close to the model's and never makes a stretch instant.
    knot(tt(T.FOOT), ACT.WAIT, 1, out.sFoot, 1, out.sFoot);
    const H = P.haul, vOf = (seg) => 1 / (1 + H.climbK * seg.grade); // relative speeds
    const zig = rt.segs.length > 1;
    // [from s, to s, relative speed] for each stretch, and the switchbacks on the zigzag
    const run = (t0, t1, parts, pauseAll = 0, corners = []) => {
      // (a short stop at each switchback: the rest of the model's turning time is spent climbing
      // more slowly. The model lets the next gang onto the ramp a turning time behind, so a gang
      // that stood the whole of it at a corner would have the next one walk into it there.)
      const nc = corners.length, pause = nc ? Math.min(TURN_STOP, Math.min((t1 - t0) * 0.6, pauseAll) / nc) : 0;
      const w = parts.map(([a, b, v]) => Math.max(0, b - a) / v), W = w.reduce((x, y) => x + y, 0);
      const travel = Math.max(0, t1 - t0 - pause * nc);
      let t = t0;
      parts.forEach(([a, b], i) => {
        const dur = W > 0 ? (travel * w[i]) / W : travel / parts.length;
        const cs = corners.filter((c) => c > a + 1e-6 && c < b - 1e-6);
        if (!cs.length || b <= a) { knot(t, ACT.HAUL, 1, a, 1, b); t += dur; return; }
        let s = a;
        for (const c of [...cs, b]) {
          const d = (dur * (c - s)) / (b - a);
          knot(t, ACT.HAUL, 1, s, 1, c); t += d;
          if (c < b) { knot(t, ACT.TURN, 1, c, 1, c); t += pause; }
          s = c;
        }
      });
    };
    let t0, parts, pauseAll = 0;
    // the climb starts from where the queue at the foot left the gang
    const sClimb = capAt(footCap, out.sFoot, tt(T.CLIMB));
    if (zig) {
      run(tt(T.CLIMB), tt(T.ARR1), [[sClimb, out.sFoot, 1], [out.sFoot, out.sSwitch, vOf(rt.segs[0])]]);
      knot(tt(T.ARR1), ACT.WAIT, 1, out.sSwitch, 1, out.sSwitch);
      // the queue for the zigzag (one lane, served in the model's order)
      const ent = tt(T.ENT1);
      const zcap = capOf(Q, Q.zig.get(rt.segs[1].res), g, (e) => e.serve < ent || (e.serve === ent && e.h < g), 1, tt(T.CLIMB), ent, out.sSwitch, sClimb);
      if (zcap) caps.push(zcap);
      const sZig = capAt(zcap, out.sSwitch, ent);
      // the model's time on the zigzag includes turns × turnTime (twice for heavy gangs);
      // the same total pause is shared between the switchbacks drawn on the way
      const seg = rt.segs[1];
      t0 = ent; parts = [[sZig, out.sSwitch, vOf(rt.segs[0])], [out.sSwitch, out.sHead, vOf(seg)], [out.sHead, Lo, 1]];
      pauseAll = seg.turns * seg.turnTime * (heavy ? 2 : 1);
    } else {
      t0 = tt(T.CLIMB); parts = [[sClimb, out.sFoot, 1], [out.sFoot, out.sHead, vOf(rt.segs[0])], [out.sHead, Lo, 1]];
      // a spiral or internal ramp: the model's turning time is shared between its corners
      pauseAll = rt.segs[0].turns * rt.segs[0].turnTime * (heavy ? 2 : 1);
    }
    // Where the model's stretch is shorter than the drawn one (the course-0 ramp has no
    // length in the model, and the zigzag ends at its own corner, not at the model's head),
    // the gang would have to rush it. It may then reach the landing after the model's time,
    // never more than 30 % above the model's speed, and unload in what is left of the
    // unloading time: the moment it finishes (and everything after) stays the model's.
    // The climb itself is timed by the model's moment at the top of the ramp (T.TOP), the
    // stretch across the course by its landing time, so every gang on the same ramp climbs it
    // as the model has it, in the model's order and spacing: the gang behind keeps behind.
    const vBase = H.vLoaded * (heavy ? P.heavy.speedFactor : 1) * 1.3;
    const need = (ps) => ps.reduce((a, [s0, s1, v]) => a + Math.max(0, s1 - s0) / (vBase * v), 0);
    const up = parts.slice(0, -1), across = parts.slice(-1);
    // (where the drawn way across the course is longer than the model's, the gang reaches the
    // top sooner, never later than leaves it time to cross at that speed)
    const arrive = Math.min(tt(T.DONE) - 1, Math.max(tt(T.LAND), t0 + need(up) + need(across)));
    const top = Math.min(arrive, Math.max(t0 + need(up), Math.min(tt(T.TOP), arrive - need(across))));
    run(t0, top, up, pauseAll, out.corners);
    run(top, arrive, across);
    // the queue for its berth at the landing: it moves onto the berth once the gang there
    // has left (a little after the model's time, taken from its unloading time)
    let unload = Math.max(tt(T.UNLOAD), arrive);
    if (!heavy) {
      const un = tt(T.UNLOAD);
      const lcap = capOf(Q, Q.land.get(`${c}:${sector}:${G.berth[g]}`), g, (e) => e.serve < un || (e.serve === un && e.h < g), 1, t0, Infinity, Lo, parts[0][0]);
      if (lcap) { unload = Math.min(tt(T.DONE) - 1, Math.max(unload, capEnd(lcap))); lcap.t1 = unload; caps.push(lcap); }
    }
    if (!heavy && unload > arrive) knot(arrive, ACT.WAIT, 1, Lo, 1, Lo);
    knot(unload, heavy ? ACT.SET : ACT.UNLOAD, 1, Lo, 2, 0);
    if (task === TASK.RETURNING) {
      // back with the empty sled at one speed all the way, as in the model
      knot(tt(T.DONE), ACT.RETURN, 2, 0, 2, Lb);
      knot(tt(T.HOME), ACT.IDLE, 0, Li, 0, Li);
    } else {
      knot(tt(T.DONE), ACT.RETURN, 2, 0, 2, 0); // unloaded: holds until the walk back is known
    }
  }
  // knots must not go back in time (guards rounding in the zigzag split)
  for (let i = KN; i < K.length; i += KN) if (K[i] < K[i - KN]) K[i] = K[i - KN];
  // the zigzag is a single lane: gangs keep to its middle there (path, from s, to s)
  // (a theory's ledge may meet its road or the course at a hairpin, where "left of travel"
  // swaps sides: the middle is kept for 12 m past each end of it)
  const ext = sim.ctx.theory.ledge ? 12 : 0;
  const narrow = out.sHead > out.sSwitch + 1e-6 || (ext && out.sSwitch > out.sFoot - 1e-6) ? [[1, out.sSwitch - ext, out.sHead + ext], [2, Lb - back.sHead - ext, Lb - back.sSwitch + ext]] : [];
  // once the climb is known, the gang moves over to its model lane on the ramp, after the
  // whole gang (its front rank is up to ~12 m ahead of the sled) has passed the foot
  const rampLane = climbKnown && !heavy ? [out.sFoot + 14, LANES[G.lane[g]]] : null;
  // the two berths of a landing side by side: the gang ends its way out (and starts its way
  // back) beside the landing point, eased in over the last 30 m
  // (only past the foot, as the berth is known from the foot on, and only with room for it)
  // (on the course only: a ledge may meet the course at a hairpin just before the landing)
  const berthLen = Math.min(30, Lo - (out.sFoot + 14), Math.max(4, Lo - out.sHead - 2));
  // (not where a theory's ledge ends close to the landing: the way in may double back there)
  const berth = climbKnown && !heavy && berthLen >= 4 && !(ext && Lo - out.sHead < berthLen + ext) ? [berthOffset(out.line, G.berth[g], kind, crew, loadOf(plan, kind, sector), COURSES[c].y0), berthLen] : null;
  // how the gang moves along the stretches it shares with others (see passWindows), from its
  // knots: out on the road from the yard's avenue to short of the ramp foot (by road lane),
  // up the straight ramp (by the model's lane), and home from the top of the straight ramp to
  // the avenue. Each piece: r(t) = r0 + v·(t − t0) for t0 ≤ t ≤ t1, kept to [lo, hi].
  const mv = [];
  if (!heavy) {
    const spec = crewSpec(kind, crew), lead = (loadOf(plan, kind, sector)[2] / 2) + 0.9;
    const front = lead + (spec.ranks - 1) * spec.gap + 0.3, rear = lead * 0.9 + 0.3, src = kind === GIZA ? 'q' : 'h';
    const road = (src === 'q' ? plan.road.qPath : plan.road.hPath)[route];
    const zigTop = rt.segs.length > 1 ? 20 : 0; // (the queue for the zigzag waits at the top)
    // stretches: [path, key, s of r = 0, lo, hi] (r: metres from the gate along the road out, or
    // to it on the way home; up the ramp, from its foot)
    const stretch = task === TASK.OUT ? [
      [1, `o${src}:${g % 2}`, out.sRoad, out.sCross - out.sRoad, out.sFoot - out.sRoad - 20, road, lane],
      ...(climbKnown ? [[1, `r${route}:${G.lane[g]}`, out.sFoot, 14, out.sSwitch - out.sFoot - zigTop, null, LANES[G.lane[g]]]] : []),
    ] : task === TASK.RETURNING && !limestoneHeavy ? [[2, `b${src}:${g % 2}`, Lb - out.sRoad, -(out.sSwitch - out.sRoad), out.sRoad - out.sCross, road, lane]] : [];
    for (let i = 0; i + KN < K.length; i += KN) {
      const act = K[i + 1], a = K[i], b = K[i + KN];
      if ((act !== ACT.HAUL && act !== ACT.RETURN) || K[i + 2] !== K[i + 4] || b <= a || K[i + 5] <= K[i + 3]) continue;
      const v = (K[i + 5] - K[i + 3]) / (b - a);
      for (const [li, key, s0, lo, hi, rd, ln] of stretch) {
        if (K[i + 2] !== li || K[i + 5] - s0 <= lo || K[i + 3] - s0 >= hi) continue; // (not on this stretch)
        mv.push({ key, road: rd, t0: a, t1: b, r0: K[i + 3] - s0, v, lo, hi, front, rear, li, amt: SWING - ln });
      }
    }
  }
  const sig = [task, G.trips[g], c, route, sector, R.key, climbKnown ? `${G.lane[g]}${G.berth[g]}` : '-', tt(T.START), tt(T.FOOT), climbKnown ? tt(T.TOP) : 0,
    task === TASK.RETURNING ? tt(T.HOME) : 0, ...caps.map((cp) => cp.h.join(','))].join('|');
  const load = loadOf(plan, kind, sector);
  // a roof beam's resting place on its two walls: centre and heading (see figures())
  const place = heavy && item.kind === 'roof' ? [item.x, COURSES[c].y0 + load[1] / 2, item.z, item.axis === 'x' ? Math.PI / 2 : 0] : null;
  // an ordinary stone is levered off onto the sector's stock spot (see stonesAt)
  const drop = heavy ? null : (([x, z]) => [x, COURSES[c].y0 + load[1] / 2, z])(stockSpot(plan, sector));
  // keep-left on a ledge: half its width less the gang's half width (the zigzag and the spiral
  // ledges are 7 m wide: 1.6 m; the internal ramp, 3 m: the middle)
  const th = sim.ctx.theory, lw = th.id === 'internal' ? P.ramp.internal.width : th.id === 'spiral' ? P.ramp.spiral.width : P.ramp.zigzag.width;
  const keep = Math.max(0, Math.min(1.6, lw / 2 - gangHalfWidth(kind, crew, load)));
  // the stretches of the way out and back on the course (see inward())
  const onCourse = { 1: [out.sHead - 15, Lo + 15], 2: [-15, Lb - back.sHead + 15] };
  // where the way out reaches the yard's avenue, and the way home leaves it (see laneAt)
  const aisle = out.sCross > 0 ? { 1: out.sCross, 2: limestoneHeavy ? null : Lb - out.sCross } : null;
  return { ...base, sig, paths, knots: Float64Array.from(K), load, course: c, narrow, rampLane, caps, berth, place, drop, mv, keep, onCourse, aisle };
}

function reverse(p) {
  const n = p.length / 3, out = new Float32Array(p.length);
  for (let i = 0; i < n; i++) { out[3 * i] = p[3 * (n - 1 - i)]; out[3 * i + 1] = p[3 * (n - 1 - i) + 1]; out[3 * i + 2] = p[3 * (n - 1 - i) + 2]; }
  return out;
}

// How far a gang reaches to either side of its line (m): its outer files with the front ranks
// folded back beside the sled at the end of the way out (see formation()), or the water
// pourers beside the stone, plus a body.
export function gangHalfWidth(kind, crew, load) {
  const spec = crewSpec(kind, crew), lat = Math.max(...spec.lat.map(Math.abs));
  return Math.max(lat + foldWidth(kind), load ? load[0] / 2 + 0.55 : 0.8) + 0.25;
}
// a body's width kept between a gang and the edge of the course it walks on
const EDGE = 0.3;
// The two berths of a landing side by side, to the left (+) and right (−) of the way in. On a
// landing by the edge of the course one side may have no room: the pair then moves over (or
// closes up) so that both gangs stand on the course.
function berthOffset(line, k, kind, crew, load, bed) {
  const p = line.p, n = p.length / 3;
  let i = n - 2;
  while (i > 0 && Math.hypot(p[3 * n - 3] - p[3 * i], p[3 * n - 1] - p[3 * i + 2]) < 1) i--;
  const dx = p[3 * n - 3] - p[3 * i], dz = p[3 * n - 1] - p[3 * i + 2], d = Math.hypot(dx, dz) || 1;
  const nl = [dz / d, -dx / d], at = [p[3 * n - 3], p[3 * n - 1]]; // left of travel, the landing
  const W = gangHalfWidth(kind, crew, load), A = halfWidthAt(bed) - W - EDGE;
  // how far the gang can stand to the left (hi) and to the right (−lo) and stay on the course
  let lo = -Infinity, hi = Infinity;
  for (let a = 0; a < 2; a++) {
    if (Math.abs(nl[a]) < 1e-6) continue;
    const u = (A - at[a]) / nl[a], v = (-A - at[a]) / nl[a];
    lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v));
  }
  if (hi - lo >= BERTH[0] - BERTH[1]) return BERTH[k] + (lo > BERTH[1] ? lo - BERTH[1] : hi < BERTH[0] ? hi - BERTH[0] : 0);
  // closer than usual (on a course too small for two, both on the one spot)
  if (hi < lo) return (lo + hi) / 2;
  return k === 0 ? hi : lo;
}

// ---- overtaking ----------------------------------------------------------------------------
// The model lets a faster gang catch up with a slower one on the road (every speed has its own
// spread), and gangs leaving the yard at the same moment from different rows meet in its
// avenue. Where two gangs in the same lane would come within a gang's length of each other,
// the one that reached the shared stretch later steps out to an overtaking line (SWING m to
// the left of the road's middle) for as long as they are side by side, and back after. The
// times come from the model's own (the departure, the arrival at the foot; the walk home),
// known once each gang sets off, so a gang's trip only ever learns of gangs ahead of it.
const SWING = 5.8, SWING_STEP = 2.2, SWING_T = 5, PASS_GAP = 1;
function passWindows(trips) {
  const groups = new Map();
  for (const tr of trips) {
    tr.pass = null;
    for (const m of tr.mv || []) { const a = groups.get(m.key); if (a) a.push([tr, m]); else groups.set(m.key, [[tr, m]]); }
  }
  const wins = [];
  for (const list of groups.values()) {
    // (only pieces at the same time can meet: sorted by start, each is compared with those
    // that start before it ends)
    list.sort((x, y) => x[1].t0 - y[1].t0);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j][1].t0 < list[i][1].t1; j++) for (const [x, y] of [[i, j], [j, i]]) {
      const [ta, A] = list[x], [tb, B] = list[y];
      if (ta === tb) continue;
      // (roads to different ramps share their way from the gate up to where they part, and
      // gangs on them are side by side for a gang's length past it)
      const common = A.road && B.road ? sharedRoad(A.road, B.road) + 12 : Infinity;
      const lo = Math.max(A.lo, B.lo, A.li === 2 ? -common : -Infinity), hi = Math.min(A.hi, B.hi, A.li === 1 ? common : Infinity);
      if (hi <= lo) continue;
      // A steps out if it reaches the shared stretch later (ties: the higher gang number)
      const eA = A.t0 + (lo - A.r0) / A.v, eB = B.t0 + (lo - B.r0) / B.v;
      if (eA < eB || (eA === eB && ta.g < tb.g)) continue;
      // both on the stretch (and in these pieces)
      const c0 = Math.max(eA, eB, A.t0, B.t0), c1 = Math.min(A.t0 + (hi - A.r0) / A.v, B.t0 + (hi - B.r0) / B.v, A.t1, B.t1);
      if (c1 <= c0) continue;
      // A's place less B's: d(t) = d0 + k·(t − c0); too close while −(B.front + A.rear) < d < A.front + B.rear
      const d0 = A.r0 + A.v * (c0 - A.t0) - (B.r0 + B.v * (c0 - B.t0)), k = A.v - B.v;
      const a = -(B.front + A.rear + PASS_GAP), b = A.front + B.rear + PASS_GAP;
      let w0 = c0, w1 = c1;
      if (Math.abs(k) < 1e-9) { if (d0 <= a || d0 >= b) continue; }
      else {
        const t1 = c0 + (a - d0) / k, t2 = c0 + (b - d0) / k;
        w0 = Math.max(c0, Math.min(t1, t2)); w1 = Math.min(c1, Math.max(t1, t2));
        if (w1 <= w0) continue;
      }
      wins.push({ tr: ta, A, w0, w1, e: A.t0 + (A.lo - A.r0) / A.v });
    }
    // a gang passing one that has stepped out itself (to pass another) steps out one line
    // farther (2.2 m): each window, in the order the gangs reached the stretch, goes one line
    // beyond any earlier one at the same time within two gang lengths of it
    wins.sort((x, y) => x.e - y.e || x.tr.g - y.tr.g);
    for (let i = 0; i < wins.length; i++) {
      const W = wins[i];
      W.level = 1;
      for (let j = 0; j < i; j++) {
        const V = wins[j];
        if (V.tr === W.tr || V.w1 <= W.w0 || V.w0 >= W.w1) continue;
        const tm = (Math.max(V.w0, W.w0) + Math.min(V.w1, W.w1)) / 2;
        const d = Math.abs(W.A.r0 + W.A.v * (tm - W.A.t0) - (V.A.r0 + V.A.v * (tm - V.A.t0)));
        if (d < 2 * (W.A.front + W.A.rear)) W.level = Math.max(W.level, V.level + 1);
      }
      (W.tr.pass ||= []).push(W.w0, W.w1, W.A.li, W.A.amt + (W.level - 1) * SWING_STEP);
    }
    wins.length = 0;
  }
  for (const tr of trips) if (tr.pass) tr.sig += `|p${tr.pass.map((x) => x.toFixed(1)).join(',')}`;
}
// length of the road two routes share from the gate (all of it for the same road)
function sharedRoad(a, b) {
  if (a === b) return Infinity;
  let L = 0;
  for (let i = 1; i < Math.min(a.length, b.length); i++) {
    if (Math.abs(a[i][0] - b[i][0]) > 1e-6 || Math.abs(a[i][1] - b[i][1]) > 1e-6) break;
    L += Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]);
  }
  return L;
}
// how far gang `trip` has stepped out to overtake at time t on path li (0 when not overtaking)
function swing(trip, li, t) {
  const p = trip.pass;
  if (!p) return 0;
  let w = 0;
  for (let i = 0; i < p.length; i += 4) if (p[i + 2] === li) w = Math.max(w, p[i + 3] * smooth((t - p[i] + SWING_T) / SWING_T) * (1 - smooth((t - p[i + 1]) / SWING_T)));
  return w;
}

// Tracks what changed since the last call, so the worker only posts the trips that did.
//   const tr = gangTracker(); tr.update(sim) -> { ramps (when they changed), trips: [changed], all }
export function gangTracker() {
  const sigs = [];
  let rampKey = null, plans = null, simRef = null;
  return {
    reset() { sigs.length = 0; rampKey = null; },
    update(sim) {
      if (sim !== simRef) { simRef = sim; plans = planner(sim); }
      const R = rampScene(sim);
      const out = { t: sim.state.t, trips: [], ramps: null, gangs: sim.state.gang.kind.length };
      if (R.key !== rampKey) { rampKey = R.key; out.ramps = rampsForDrawing(sim, R); }
      const Q = queueIndex(sim, plans);
      const all = Array.from(sim.state.gang.kind, (_, g) => tripOf(sim, R, plans, g, Q));
      passWindows(all);
      for (const tr of all) {
        const g = tr.g;
        if (sigs[g] === tr.sig) continue;
        sigs[g] = tr.sig;
        out.trips.push(tr);
      }
      return out;
    },
  };
}

// every gang's trip, for tests and benchmarks
export function gangTrips(sim) {
  const R = rampScene(sim), plans = planner(sim), Q = queueIndex(sim, plans);
  const all = Array.from(sim.state.gang.kind, (_, g) => tripOf(sim, R, plans, g, Q));
  passWindows(all);
  return all;
}

// What the page needs to draw the ramps: the straight wedges and each face's zigzag up to
// the bed of the highest course in use. Above the theory's top (ramps/straightZigzag.js
// topOf) only one route is still raised: the others are drawn as they stopped, at top.y.
export function rampsForDrawing(sim, R = rampScene(sim)) {
  const th = sim.ctx.theory, top = th.top;
  const upTo = (id) => (top && id !== top.route ? Math.min(R.top, top.y) : R.top);
  const zig = R.zig && R.top > R.sw ? FACES.map((_, f) => zigPrefix(R, f, upTo(f)).pts) : null;
  // a theory's own fixed paths, for every route of the highest course in use that has one,
  // and those that stopped at the top
  let ledges = null;
  if (th.ledge && !R.done) {
    const ids = th.layout(R.look).routes.filter((r) => r.segs.some((s) => s.kind !== 'straight')).map((r) => r.id);
    if (top && R.look >= top.ci) for (const r of th.layout(top.ci - 1).routes) if (!ids.includes(r.id) && r.segs.some((s) => s.kind !== 'straight')) ids.push(r.id);
    ledges = ids.map((id) => th.ledge(id, upTo(id)).pts);
    if (!ledges.length) ledges = null;
  }
  const lw = th.id === 'internal' ? sim.P.ramp.internal.width : th.id === 'spiral' ? sim.P.ramp.spiral.width : R.zw;
  return { key: R.key, done: R.done, Y: R.Y, hr: R.hr, F: R.F, plat: R.plat, w: R.w, zw: R.zw, sw: R.sw, top: R.top, zig, ledges, lw, inside: !!th.ledgeInside, built: R.built, clear: sim.P.ramp.internal.clearance };
}

// ---- placing the figures ------------------------------------------------------------------
// Formation of a gang: pullers in files on ropes ahead of the sled, water pourers by its
// front and men at the back with levers. Ordinary sled gangs: 2 files, a pourer and a man
// behind; heavy gangs: 4 files, 4 pourers and 4 levermen.
export function crewSpec(kind, crew) {
  const heavy = kind === HEAVY;
  const files = heavy ? 4 : 2, extra = heavy ? 8 : 2;
  const ranks = Math.max(1, Math.floor((crew - extra) / files));
  const lat = heavy ? [-1.05, -0.35, 0.35, 1.05] : [-0.33, 0.33];
  return { files, ranks, pullers: files * ranks, extra, n: files * ranks + extra, lat, pourers: heavy ? 4 : 1, gap: 0.95 };
}

// Prepared trip: paths with arc lengths (cached per trip object).
export function prep(trip) {
  if (trip._prep) return trip._prep;
  const lines = [];
  trip.paths.forEach((p, i) => { lines[i] = typeof p === 'number' ? null : new Line(p); });
  trip.paths.forEach((p, i) => { if (typeof p === 'number') lines[i] = new Line(reverse(trip.paths[p])); });
  const spec = crewSpec(trip.kind, trip.crew);
  const lead = (trip.load ? trip.load[2] / 2 : 0.7) + (trip.kind === HEAVY ? 1.6 : 0.9);
  return (trip._prep = { lines, spec, lead, W: gangHalfWidth(trip.kind, trip.crew, trip.load) });
}

// Where the trip stands at time t: the knot interval and how far through it.
export function tokenAt(trip, t, out = {}) {
  const K = trip.knots, n = K.length / KN;
  let k = 0;
  // knots are few (≤ ~40): a linear scan from the end is fine
  for (k = n - 1; k > 0 && K[k * KN] > t; k--);
  const t0 = K[k * KN], t1 = k + 1 < n ? K[(k + 1) * KN] : Infinity;
  const a = t1 === Infinity || t1 <= t0 ? (t >= t1 ? 1 : 0) : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const o = k * KN;
  out.k = k; out.act = K[o + 1]; out.pa = K[o + 2]; out.sa = K[o + 3]; out.pb = K[o + 4]; out.sb = K[o + 5];
  out.t0 = t0; out.t1 = t1; out.a = t < t0 ? 0 : a;
  out.blend = !!BLEND[out.act];
  out.s = out.blend ? out.sa : out.sa + (out.sb - out.sa) * out.a;
  out.v = !out.blend && t1 < Infinity && t1 > t0 ? (out.sb - out.sa) / (t1 - t0) : 0;
  // held back in a queue (see capOf)
  if (trip.caps && !out.blend) for (const cap of trip.caps) {
    if (t < cap.t0 || t >= cap.t1 || out.pa !== cap.li) continue;
    const lim = capLim(cap, t);
    if (out.s > lim) {
      out.v = Math.max(0, (capLim(cap, t + 0.5) - lim) / 0.5);
      out.s = lim;
      out.act = out.v > 0.01 ? ACT.HAUL : ACT.WAIT;
    }
  }
  return out;
}
// the last time the trip is known for (after it, the gang holds where it is)
export const tripHorizon = (trip) => trip.knots[trip.knots.length - KN];

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerpAngle = (a, b, k) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
// lane offset (to the left of travel), faded out over the first and last 10 m of a path so
// every path starts and ends on its exact point
const fade = (line, s) => smooth(s / 10) * smooth((line.L - s) / 10);
// how much of the gang's lane offset applies at arc length s of path li: none at the ends of
// a path and on the single-lane zigzag, eased in and out over 8 m; and less of it on sharp
// turns (none on a hairpin), so a gang in the outer lane does not swing wide round them
function laneAt(trip, line, li, s, turn) {
  if (!trip.lane) return 0;
  let lane = trip.lane;
  // in a yard's cross-aisle (before it reaches the avenue), a narrower keep-left
  const a = trip.aisle && trip.aisle[li];
  if (a != null) lane += (YARD_LANE - lane) * (li === 1 ? 1 - smooth((s - a + 3) / 6) : smooth((s - a + 3) / 6));
  if (li === 1 && trip.rampLane) lane += (trip.rampLane[1] - lane) * smooth((s - trip.rampLane[0]) / 10);
  // at the landing the gang moves over to its berth instead (over the last stretch)
  const b = trip.berth ? trip.berth[0] : 0, w = b ? trip.berth[1] : 10;
  let k = li === 1 ? smooth(s / 10) * smooth((line.L - s) / w) : li === 2 ? smooth(s / w) * smooth((line.L - s) / 10) : fade(line, s);
  const berth = !b ? 0 : li === 1 ? b * (1 - smooth((line.L - s) / w)) : li === 2 ? -b * (1 - smooth(s / w)) : 0;
  k *= turn;
  // (on the single-lane ledge, keep-left by trip.keep: room for a gang going up and one coming
  // down to pass)
  let nk = 1;
  if (trip.narrow) for (const [p, a, e] of trip.narrow) if (p === li) nk *= 1 - smooth((s - a + 8) / 8) * smooth((e + 8 - s) / 8);
  return (lane * nk + (trip.keep || 0) * (1 - nk)) * k + berth * turn;
}

const P3 = [0, 0, 0];
// place a point at arc length s of path li, `lat` metres to the left (plus the gang's lane);
// the heading is smoothed over ±4 m, and offsets shrink on sharp turns, so people off the
// centre line round corners at a walk
function placeOn(trip, P, li, s, lat, out, o, t = 0) {
  const line = P.lines[li];
  line.at(s, P3);
  const yaw = line.yaw(s, 4);
  // 1 on the straight, 0 on a hairpin: offsets to the side shrink on sharp turns
  const turn = (1 + Math.cos(line.yaw(s + 8, 3) - line.yaw(s - 8, 3))) / 2;
  const nx = Math.cos(yaw), nz = -Math.sin(yaw); // to the left of travel
  const ref = laneAt(trip, line, li, s, turn) + swing(trip, li, t) * turn + inward(trip, P, li, s);
  const off = ref + lat * (0.4 + 0.6 * turn);
  const x = P3[0] + nx * off, z = P3[2] + nz * off;
  out[o] = x; out[o + 1] = P3[1] + groundStep(trip, P3, x, z); out[o + 2] = z;
  return yaw;
}
// On the course, the gang keeps to the bed: its lane or berth never takes it closer than its
// half width W to the edge (moved over to the side, never along the way). Off the course (on
// the ramps, the roads) nothing changes. Worked out once per trip along each path's stretch
// on the course (trip.onCourse), every half metre, and eased over ±5 m, so a gang that turns
// off the edge of the course moves back to its lane at a walk.
const CL_STEP = 0.5, CL_EASE = 10, CP = [0, 0, 0];
function inward(trip, P, li, s) {
  const r = trip.onCourse && trip.onCourse[li];
  if (!r) return 0;
  P.cl ||= [];
  let c = P.cl[li];
  if (!c) {
    const line = P.lines[li], n = Math.max(2, Math.ceil((r[1] - r[0]) / CL_STEP) + 1), raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ss = r[0] + i * CL_STEP;
      line.at(ss, CP);
      const yaw = line.yaw(ss, 4), turn = (1 + Math.cos(line.yaw(ss + 8, 3) - line.yaw(ss - 8, 3))) / 2;
      raw[i] = onCourse(CP, Math.cos(yaw), -Math.sin(yaw), laneAt(trip, line, li, ss, turn), P.W);
    }
    // (a moving average, twice: eased in and out)
    const ease = (a) => {
      const out = new Float32Array(n), pre = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
      for (let i = 0; i < n; i++) out[i] = (pre[Math.min(n, i + CL_EASE + 1)] - pre[Math.max(0, i - CL_EASE)]) / (2 * CL_EASE + 1);
      return out;
    };
    c = P.cl[li] = { s0: r[0], v: ease(ease(raw)) };
  }
  const x = (s - c.s0) / CL_STEP, i = Math.floor(x);
  if (i < 0 || i >= c.v.length - 1) return 0;
  return c.v[i] + (c.v[i + 1] - c.v[i]) * (x - i);
}
function onCourse(c, nx, nz, ref, W) {
  const hb = halfWidthAt(c[1]), m = Math.max(Math.abs(c[0]), Math.abs(c[2]));
  const w = 1 - smooth((m - hb) / 1.5);
  if (w <= 0) return 0;
  const A = Math.max(0, hb - W - EDGE);
  let d = 0;
  for (const [q0, n] of [[c[0], nx], [c[2], nz]]) {
    const q = q0 + n * (ref + d);
    if (Math.abs(q) <= A || Math.abs(n) < 1e-3) continue;
    const need = (Math.sign(q) * A - q) / n; // (sideways only: a way that runs straight at the edge is not shortened)
    d += Math.max(-6, Math.min(6, need)) * smooth((Math.abs(n) - 0.1) / 0.3);
  }
  return d * w;
}
// Each man stands on the ground where he is, not at the height of the middle of the way: on a
// road across a slope, a ramp's sides or the quay (where the trip's path follows the ground).
function groundStep(trip, c, x, z) {
  const G = trip.ground;
  if (!G) return 0;
  const tc = terrainY(G, c[0], c[2]);
  // (the path follows the ground between samples a few metres apart: within a few cm of it; not
  // on a ledge, or on the bed of the next course, above what is built)
  const w = 1 - smooth((Math.abs(c[1] - tc) - 0.25) / 0.2);
  return w > 0 ? w * (terrainY(G, x, z) - c[1]) : 0;
}

// Layout of the output of figures(): the sled, then FIG numbers per crew member.
export const SLED = 10; // x, y, z, yaw, pitch, stone x, y, z, stone shown (0/1), stone yaw
export const FIG = 7; // x, y, z, yaw, pose, distance walked (for the leg cycle), speed (m/s)

// Static placement of the whole gang standing on path `li` at arc length s (no motion):
// used for each end of a regrouping.
function formation(trip, P, li, s, act, out, o, t, speed) {
  const { spec, lead, lines } = P, line = lines[li];
  const moving = speed > 0.02;
  // sled
  const yaw = placeOn(trip, P, li, s, 0, out, o, t);
  out[o + 3] = yaw;
  out[o + 4] = -Math.atan(line.slope(s));
  let f = o + SLED;
  const pull = act === ACT.HAUL, ret = act === ACT.RETURN || act === ACT.WALK;
  // the way out ends at the landing (or the stone's place): the front ranks do not walk on past
  // it (into the stones already set there, or off the edge of the course) but peel off to either
  // side and stand back along the way they came, beside the sled
  const end = li === 1 ? line.L : Infinity, fw = foldWidth(trip.kind);
  for (let r = 0; r < spec.ranks; r++) for (let j = 0; j < spec.files; j++) {
    let sp = s + lead + r * spec.gap, lat = spec.lat[j], e = 0;
    if (sp > end) { e = sp - end; sp = end - e; lat += Math.sign(lat) * fw * smooth(e / 0.8); }
    const yw = placeOn(trip, P, li, sp, lat, out, f, t);
    out[f + 3] = e > 0 ? lerpAngle(yw, yw + Math.PI, smooth(e / 1.5)) : yw;
    let pose = POSE.REST;
    if (pull) pose = e > 0.8 ? POSE.REST : POSE.PULL;
    else if (ret) pose = moving ? (r === 0 ? POSE.PULL : POSE.WALK) : POSE.REST;
    else if (act === ACT.IDLE && (r * 7 + j * 3) % 5 === 0) pose = POSE.KNEEL;
    out[f + 4] = pose; out[f + 5] = s + lead + r * spec.gap + (r * 0.37 + j * 0.5); out[f + 6] = moving ? speed : 0;
    f += FIG;
  }
  // pourers at the front corners of the sled, levermen behind it
  for (let k = 0; k < spec.extra; k++) {
    const pourer = k < spec.pourers;
    const side = k % 2 ? 1 : -1;
    const sp = pourer ? s + lead * 0.55 + Math.floor(k / 2) * 0.7 : s - lead * 0.9 - Math.floor((k - spec.pourers) / 2) * 0.7;
    const lat = pourer ? side * (trip.load ? trip.load[0] / 2 + 0.55 : 0.8) : spec.extra > 2 ? side * 0.5 : 0;
    out[f + 3] = placeOn(trip, P, li, sp, lat, out, f, t);
    let pose = POSE.REST;
    if (pull) pose = pourer ? POSE.POUR : POSE.PUSH;
    else if (act === ACT.TURN || act === ACT.LOAD || act === ACT.UNLOAD || act === ACT.SET) pose = POSE.LEVER;
    else if (ret && moving) pose = POSE.WALK;
    out[f + 4] = pose; out[f + 5] = sp + k * 0.61; out[f + 6] = moving ? speed : 0;
    f += FIG;
  }
}
// how far out the folded front ranks stand beside their own file (clear of the sled and the
// levermen behind it)
const foldWidth = (kind) => (kind === HEAVY ? 1.2 : 0.9);

// ---- stones on the course: from the sled to their place -------------------------------
// A gang levers its stone off at the landing onto the stock spot, just ahead of the landing
// into the sector. Stones not taken at once lie in two piles beyond it (Giza stone to the
// left, casing to the right), each two layers high. A setting crew takes the stone on top and
// levers it across the bed to its place, in the model's own time for that (the share of the
// setting time that is moving it, see trySet() in model.js), and fits it there until the model
// sets it. So a stone is always somewhere: on the sled, on the spot or the pile, on its way,
// in its place.
//   stonesView(sim) (sim/view.js) describes them at the model's time; stonesAt() places them.
const PILE_W = 8, PILE_H = 2, PILE_V = 0.12; // stones across each pile, layers, m/s levering on the pile
// the stock spot of sector s of a course plan: [x, z, forward x, forward z] (forward: the way
// gangs come in, from the ramp head to the landing)
export function stockSpot(plan, s) {
  const sec = plan.sectors[s], head = plan.layout.routes[sec.route].head, [lx, lz] = sec.landing;
  let fx = lx - head[0], fz = lz - head[1], d = Math.hypot(fx, fz);
  if (d < 1e-6) { fx = (sec.x0 + sec.x1) / 2 - lx; fz = (sec.z0 + sec.z1) / 2 - lz; d = Math.hypot(fx, fz) || 1; }
  fx /= d; fz /= d;
  const k = plan.cell * 0.48 + 1.6; // (clear of the sleds at the landing)
  const x = Math.min(sec.x1 - plan.cell / 2, Math.max(sec.x0 + plan.cell / 2, lx + fx * k)), z = Math.min(sec.z1 - plan.cell / 2, Math.max(sec.z0 + plan.cell / 2, lz + fz * k));
  return [x, z, fx, fz];
}
// where stone number `rank` of a pile (kind 0 Giza, 1 casing) rests: [x, y, z]. The piles
// grow in rows away from the landing, PILE_W stones across on each side of its line, leaving
// out any place off the bed of the course (near the top the courses are small).
const slotCache = new Map();
function pileSlot(P, kind, rank, out) {
  const key = `${P.ci}:${P.s}:${kind}:${P.x}:${P.z}`;
  let list = slotCache.get(key);
  if (!list) { if (slotCache.size > 400) slotCache.clear(); slotCache.set(key, (list = { q: 0, xz: [] })); }
  const need = Math.floor(rank / PILE_H), pitch = P.cell * 1.05, lim = P.hw - P.sw / 2 - 0.05;
  while (list.xz.length <= 2 * need && list.q < 1e5) {
    const q = list.q++;
    const a = (kind === 0 ? -1 : 1) * (0.5 + (q % PILE_W)) * pitch, b = (1 + Math.floor(q / PILE_W)) * pitch;
    const x = P.x + P.fx * b - P.fz * a, z = P.z + P.fz * b + P.fx * a;
    if (Math.max(Math.abs(x), Math.abs(z)) <= lim) list.xz.push(x, z);
  }
  out[0] = list.xz[2 * need] ?? P.x; out[2] = list.xz[2 * need + 1] ?? P.z;
  out[1] = P.y + P.sh / 2 + (rank % PILE_H) * P.h;
  return out;
}
const SA = [0, 0, 0];
// where a pile stone delivered at td, resting at `rank`, is at time t (levered from the spot)
function pileAt(P, kind, rank, td, t, out) {
  pileSlot(P, kind, rank, SA);
  const d = Math.hypot(SA[0] - P.x, SA[2] - P.z), k = smooth((t - td) / Math.max(1, d / PILE_V));
  out[0] = P.x + (SA[0] - P.x) * k; out[1] = P.y + P.sh / 2 + (SA[1] - P.y - P.sh / 2) * k; out[2] = P.z + (SA[2] - P.z) * k;
  return out;
}
// Every stone lying at a landing or being moved at time t: calls fn(x, y, z, sx, sy, sz, state,
// kind) with its centre and size (state 0 lying, 1 moving, 2 fitting in its place; kind 0 Giza
// stone, 1 casing).
// v: stonesView(); stones moved are for t at or after the view's time.
export function stonesAt(v, t, fn) {
  const C = [0, 0, 0];
  for (const P of v.piles) {
    for (const kind of [0, 1]) {
      const n = kind ? P.tn : P.gn, tops = kind ? P.tTop : P.gTop; // (tops: delivery times of the top stones, the last first)
      for (let r = 0; r < n; r++) {
        const top = n - 1 - r, td = top < tops.length ? tops[top] : -Infinity;
        pileAt(P, kind, r, td, t, C);
        fn(C[0], C[1], C[2], P.sw, P.sh, P.sw, 0, kind);
      }
    }
  }
  for (const W of v.work) {
    const P = v.piles[W.pile];
    pileAt(P, W.kind, W.rank, W.td, W.t0, C);
    const k = smooth((t - W.t0) / Math.max(1e-6, W.move));
    fn(C[0] + (W.x - C[0]) * k, C[1] + (P.y + P.sh / 2 - C[1]) * k, C[2] + (W.z - C[2]) * k, P.sw, P.sh, P.sw, t >= W.t0 + W.move ? 2 : 1, W.kind);
  }
}

// ---- the course being laid, as people walk on it ---------------------------------------
// The paths run on the bed of the course (or, for the next course, on top of this one). The
// stones already set (or being levered in) stand a course high on that bed: people and sleds
// on the bed climb onto them, and on the top of the course step down where none is set yet,
// over 0.6 m at each stone's edge (no one jumps a course high at a step).
//   L: courseLayout() (sim/view.js); course: viewState().course (the same counts the page
//   draws the stones from)
export function courseSurface(L, course) {
  if (!L || !course || course.ci !== L.ci || !L.n || !(L.cell > 0)) return null; // (the capstone's course has no grid of stones)
  const set = new Uint8Array(L.n * L.n);
  // (a stone still on its way to its place is not there yet)
  const away = new Set((course.work || []).filter((w) => w[3] > (course.t ?? -Infinity)).map(([s, k, i]) => `${s}:${k}:${i}`));
  for (let s = 0; s < L.sectors; s++) {
    for (let j = 0; j < course.gClaim[s]; j++) { const i = L.cells[L.off[2 * s] + j]; if (!rampOpening(L, i) && !away.has(`${s}:0:${j}`)) set[i] = 1; }
    for (let j = 0; j < course.tClaim[s]; j++) { const i = L.cells[L.off[2 * s + 1] + j]; if (!rampOpening(L, i) && !away.has(`${s}:1:${j}`)) set[i] = 1; }
  }
  // granite lining blocks (not roof beams, which lie across their openings)
  for (let j = 0; j < course.heavyState.length; j++) {
    const H = L.heavy, b = j * HV;
    if (course.heavyState[j] !== 2 || H[b + 6] === 1) continue;
    const i = Math.floor((H[b] + L.hw) / L.cell), k = Math.floor((H[b + 1] + L.hw) / L.cell);
    if (i >= 0 && k >= 0 && i < L.n && k < L.n) set[k * L.n + i] = 1;
  }
  return { y0: L.y0, h: L.h, n: L.n, cell: L.cell, hw: L.hw, set };
}
// Is cell i of the course being laid where a ramp (or a ledge) arrives? The model sets each
// sector's stones farthest first, so the outer ring at a ramp head can stand before the course
// is done, a course high across the way up. As drawn, those stones wait until the course is
// finished (as if set last, behind the ramp): the way onto the course stays open.
export function rampOpening(L, i) {
  const x = -L.hw + ((i % L.n) + 0.5) * L.cell, z = -L.hw + (((i / L.n) | 0) + 0.5) * L.cell;
  // (the trench where a ramp inside the masonry comes up through this course: rampTrench())
  if (L.trench) for (const [x0, x1, z0, z1] of L.trench) if (x > x0 && x < x1 && z > z0 && z < z1) return true;
  if (!L.openings || !L.openings.length) return false;
  for (const [f, u, half] of L.openings) {
    const [n, t] = FACES[f];
    if (x * n[0] + z * n[1] > L.hw - L.cell && Math.abs(x * t[0] + z * t[1] - u) < half) return true;
  }
  return false;
}
const STEP = 0.6;
// how much of the course height stands under (x, z): 1 on a set stone, 0 a step's width from any
function setUnder(S, x, z) {
  const fx = (x + S.hw) / S.cell, fz = (z + S.hw) / S.cell;
  if (!Number.isFinite(fx) || !Number.isFinite(fz)) return 0;
  const i0 = Math.floor(fx), k0 = Math.floor(fz);
  let best = 0;
  for (let k = k0 - 1; k <= k0 + 1; k++) for (let i = i0 - 1; i <= i0 + 1; i++) {
    if (i < 0 || k < 0 || i >= S.n || k >= S.n || !S.set[k * S.n + i]) continue;
    const dx = Math.max(0, i - fx, fx - i - 1) * S.cell, dz = Math.max(0, k - fz, fz - k - 1) * S.cell;
    const v = 1 - Math.min(1, Math.hypot(dx, dz) / STEP);
    if (v > best) best = v;
  }
  return best;
}
// the height to stand at for a point placed at height y on a path (y unchanged off the course's
// bed and top, and on the straight ramps, whose heads stand over its outer stones)
export function onSurface(S, G, x, y, z) {
  if (Math.max(Math.abs(x), Math.abs(z)) > S.hw + STEP) return y;
  const a = Math.abs(y - S.y0), b = Math.abs(y - S.y0 - S.h);
  const w = 1 - smooth((Math.min(a, b) - 0.05) / 0.1);
  if (w <= 0) return y;
  // (not on a straight ramp, eased off where its surface comes down to the bed)
  let r = 0;
  if (G) for (let f = 0; f < 4; f++) r = Math.max(r, smooth((wedgeY(G, f, x, z) - S.y0 + 0.3) / 0.3));
  return y + w * (1 - r) * (S.y0 + S.h * setUnder(S, x, z) - y);
}

const TOK = {};
let A = new Float32Array(0), Bf = new Float32Array(0);
// Places a gang at time t into out (from offset o): SLED numbers, then FIG per crew member
// (crewSpec(kind, crew).n of them). Returns the token state (tokenAt).
// surf (optional, see courseSurface): the course being laid as it is drawn at time t; people
// and sleds on it stand on the stones already set and step down where none is yet.
export function figures(trip, t, out, o = 0, surf = null) {
  const P = prep(trip), tok = tokenAt(trip, t, TOK);
  const n = P.spec.n, size = SLED + n * FIG;
  if (!tok.blend) {
    formation(trip, P, tok.pa, tok.s, tok.act, out, o, t, Math.abs(tok.v));
  } else {
    // regrouping between two standing formations (loading, unloading, setting a heavy
    // stone): the sled turns in place and each man walks to his new spot at 1.2 m/s
    if (A.length < size) { A = new Float32Array(size); Bf = new Float32Array(size); }
    formation(trip, P, tok.pa, tok.sa, tok.act, A, 0, t, 0);
    formation(trip, P, tok.pb, tok.sb, tok.act, Bf, 0, t, 0);
    const dur = tok.t1 < Infinity ? tok.t1 - tok.t0 : 60, el = Math.max(0, t - tok.t0);
    const e = smooth(tok.a);
    for (let i = 0; i < SLED; i++) out[o + i] = A[i] + (Bf[i] - A[i]) * e;
    out[o + 3] = lerpAngle(A[3], Bf[3], e);
    for (let j = 0; j < n; j++) {
      const f = SLED + j * FIG, dx = Bf[f] - A[f], dy = Bf[f + 1] - A[f + 1], dz = Bf[f + 2] - A[f + 2];
      const d = Math.hypot(dx, dz);
      const tau = Math.min(dur, d / 1.2);
      const w = tau > 1e-6 ? Math.min(1, el / tau) : 1;
      const p = o + f;
      out[p] = A[f] + dx * w; out[p + 1] = A[f + 1] + dy * w; out[p + 2] = A[f + 2] + dz * w;
      const walking = w > 0 && w < 1 && d > 0.05;
      const head = Math.atan2(dx, dz);
      // turn toward where he is going at the start, and to his new heading at the end
      out[p + 3] = w <= 0 ? A[f + 3] : w >= 1 ? Bf[f + 3] : lerpAngle(lerpAngle(A[f + 3], head, smooth(w * 6)), Bf[f + 3], smooth((w - 0.85) / 0.15));
      out[p + 4] = walking ? POSE.WALK : w >= 1 ? Bf[f + 4] : A[f + 4];
      out[p + 5] = A[f + 5] + d * w;
      out[p + 6] = walking ? (tau > 0 ? d / tau : 0) : 0;
    }
  }
  if (surf) for (let i = o, e = o + size; i < e; i = i === o ? o + SLED : i + FIG) out[i + 1] = onSurface(surf, trip.ground, out[i], out[i + 1], out[i + 2]);
  // the stone: on the sled while loaded; slid on from beside the sled while loading, levered
  // off ahead of it at the landing, and lowered onto its bed by a heavy gang
  const L = trip.load;
  let shown = 0, side = 0, ahead = 0, lift = 0;
  if (L) {
    const act = tok.act;
    if (act === ACT.LOAD) { shown = 1; const e = smooth((tok.a - 0.4) / 0.6); side = (1 - e) * (L[0] / 2 + 1.2); lift = e - 1; }
    else if (act === ACT.HAUL || act === ACT.WAIT || act === ACT.TURN) shown = 1;
    else if (act === ACT.UNLOAD) { shown = tok.a < 1 ? 1 : 0; ahead = smooth(tok.a) * (L[2] / 2 + 1.0); lift = -smooth((tok.a - 0.5) * 2); }
    else if (act === ACT.SET) { shown = tok.a < 1 ? 1 : 0; lift = -smooth(tok.a); }
  }
  const yaw = out[o + 3];
  // lift: 0 on the deck, −1 on the ground beside or ahead of the sled
  const deck = 0.22, sx = Math.sin(yaw), cz = Math.cos(yaw);
  out[o + 5] = out[o] + sx * ahead + cz * side;
  out[o + 6] = out[o + 1] + (L ? L[1] / 2 : 0) + deck * (1 + lift);
  out[o + 7] = out[o + 2] + cz * ahead - sx * side;
  out[o + 8] = shown;
  out[o + 9] = yaw;
  // An ordinary stone is levered off ahead onto the stock spot of its sector (trip.drop), turned
  // square with the course, and let down on the bed there as the unloading ends: where the
  // stones at the landing are drawn from then on (stonesAt).
  if (L && trip.drop && tok.act === ACT.UNLOAD && tok.blend) {
    const d = trip.drop, e = smooth(tok.a / 0.85), v = smooth((tok.a - 0.35) / 0.65);
    const x0 = A[0], y0 = A[1] + L[1] / 2 + deck, z0 = A[2];
    out[o + 5] = x0 + (d[0] - x0) * e;
    out[o + 6] = y0 + (d[1] - y0) * v;
    out[o + 7] = z0 + (d[2] - z0) * e;
    const sq = Math.round(A[3] / (Math.PI / 2)) * (Math.PI / 2);
    out[o + 9] = lerpAngle(A[3], sq, e);
  }
  // A roof beam of the special works (King's Chamber, relieving chambers, Queen's Chamber,
  // Grand Gallery) is not lowered where the sled stands: the gang stops clear of the opening
  // with the beam pointing across it, and the levermen work it forward off the deck, along
  // its own axis, until it lies on both walls; then it is eased down onto its bearings. The
  // beam keeps its heading while the crew turn round for the walk back.
  if (L && trip.place && tok.act === ACT.SET && tok.blend) {
    const pl = trip.place, h = smooth(tok.a / 0.8), v = smooth((tok.a - 0.75) / 0.25);
    const x0 = A[0], y0 = A[1] + L[1] / 2 + deck, z0 = A[2]; // on the deck as the gang arrived
    out[o + 5] = x0 + (pl[0] - x0) * h;
    out[o + 6] = y0 + (pl[1] - y0) * v;
    out[o + 7] = z0 + (pl[2] - z0) * h;
    out[o + 9] = A[3];
  }
  return tok;
}
