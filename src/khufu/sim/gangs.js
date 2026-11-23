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
// Geometry. Roads come from the model (plan.road.qPath/hPath). The ramps are drawn here, to
// match the straight-then-zigzag theory:
//  - The straight ramps are wedges against the middle of each face, raised as the course is
//    laid (see rampScene). Gangs on them follow that surface, so every gang stands on the
//    drawn ramp whichever course it is delivering to; one bound for the next course steps up
//    onto its bed at the top.
//  - The zigzag on each face is one fixed path from the top of the straight ramp to the apex
//    (flights across most of the face width at 1:6); a course uses the stretch of it up to
//    its own bed. Gangs pause at each switchback for the model's turning time.
// Times between knots come from the model; the drawn paths are only used for shape, so a
// path a few metres longer or shorter than the model's road just changes the drawn speed.
import { HALF, HEIGHT, TAN, COURSES, halfWidthAt, groundHeight } from '../data.js';
import { T, NT, TASK, GIZA, TURA, HEAVY, LAST } from './model.js';
import { roadNetwork } from './roads.js';
import { FACES } from './ramps/straightZigzag.js';

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
  const built = S.done ? COURSES[LAST].y1 : COURSES[S.cur].y0; // top of the finished courses
  return {
    key: `${look}:${Y.toFixed(2)}:${S.cur}:${S.done ? 1 : 0}`, look, done: S.done, top, sw, Y, hr, F, plat, built, w: R.straight.width,
    zw, zgrade: R.zigzag.grade, zig: Number.isFinite(sw) ? zigCorners(sw, R.zigzag.grade) : null,
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
  if (!R.done) for (let f = 0; f < 4; f++) { const w = wedgeY(R, f, x, z); if (w > y) y = w; }
  return y;
}
// axis-aligned boxes around the straight ramps, where the ground is not flat
function wedgeBoxes(R) {
  if (R.Y <= 0 || R.done) return [];
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
    while (i > 1 && c[i] - c[i - 1] < 1e-9 && s <= 0) i++;
    while (i < n - 1 && c[i] - c[i - 1] < 1e-9 && s >= this.L) i--;
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
// gangs), each in its own spot, reached from the gate (the model's quarry / harbour point)
// along an aisle, so the last stretch into every spot runs the same way whatever ramp the
// gang came back from.
function yard(P, kind, i) {
  const q = kind === GIZA;
  const gate = q ? P.quarry.at : P.harbour.at;
  const d = q ? [0, 1] : [1, 0], l = [d[1], -d[0]];
  const cols = q ? 10 : 6, dx = q ? 5 : 6, dz = q ? 14 : 34;
  const col = i % cols, row = Math.floor(i / cols);
  const f = 14 + row * dz, side = (col - (cols - 1) / 2) * dx;
  const slot = [gate[0] + d[0] * f + l[0] * side, gate[1] + d[1] * f + l[1] * side];
  const app = [slot[0] - d[0] * 8, slot[1] - d[1] * 8];
  return { gate, slot, app };
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
function wayOut(sim, R, plan, c, route, src, y, end) {
  const B = new Builder(R);
  const road = src === 'q' ? plan.road.qPath[route] : plan.road.hPath[route];
  if (y) B.start(y.slot[0], y.slot[1]).to(y.app[0], y.app[1]).to(road[0][0], road[0][1]);
  else B.start(road[0][0], road[0][1]);
  for (let i = 1; i < road.length; i++) B.to(road[i][0], road[i][1]);
  const iFoot = B.n - 1;
  const rt = plan.layout.routes[route], bed = COURSES[c].y0;
  const f = rt.face, [n] = FACES[f];
  const zig = rt.segs.length > 1 && R.zig;
  let iSwitch, iHead, corners = [];
  if (zig) {
    const r0 = halfWidthAt(R.sw) + R.zw / 2; // the straight ramp ends where the zigzag ledge starts
    B.to(n[0] * r0, n[1] * r0);
    iSwitch = B.n - 1;
    const zp = zigPrefix(R, f, bed);
    const base = B.n - 1;
    B.zig(zp.pts);
    for (let k = 1; k <= zp.turns; k++) corners.push(base + k);
    iHead = B.n - 1;
  } else {
    B.to(rt.head[0], rt.head[1]);
    iSwitch = iHead = B.n - 1;
  }
  B.to(end[0], end[1], bed);
  const line = new Line(B.done());
  const S = (i) => line.cum[i];
  return { line, sFoot: S(iFoot), sSwitch: S(iSwitch), sHead: S(iHead), L: line.L, corners: corners.map(S) };
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
  if (it.kind === 'roof') return [plan.cell * 0.96, plan.h * 0.97, it.span, it.granite ? 2 : 0];
  return [plan.cell * 0.96, plan.h * 0.97, plan.cell * 0.96, 2];
}

// One gang's trip at the model's current time (see the top of the file). Plain data:
//   { g, kind, crew, lane, sig, paths: [Float32Array | index of a path to reverse], knots: Float64Array(KN·k), load }
function tripOf(sim, R, plans, g) {
  const S = sim.state, P = sim.P, G = S.gang, tb = g * NT, tt = (k) => G.t[tb + k];
  const kind = G.kind[g], task = G.task[g], now = S.t;
  const crew = kind === HEAVY ? P.heavy.crew : P.haul.crew;
  const lane = kind === HEAVY ? 0 : g % 2 ? 2.4 : 0.9;
  const y = yard(P, kind === GIZA ? GIZA : TURA, yardIndex(P, g, kind));
  const idle = idlePath(R, y);
  const Li = new Line(idle).L;
  const K = [];
  const knot = (t, act, pa, sa, pb, sb) => K.push(t, act, pa, sa, pb, sb);
  const base = { g, kind, crew, lane, yard: y };
  if (task === TASK.WAITING || G.course[g] < 0) {
    knot(-1e15, ACT.IDLE, 0, Li, 0, Li);
    return { ...base, sig: `w${R.done ? 'd' : ''}`, paths: [idle], knots: Float64Array.from(K), load: null };
  }
  const c = G.course[g], route = G.route[g], sector = G.sector[g];
  const plan = plans(c);
  const heavy = kind === HEAVY, item = heavy ? plan.heavy[sector] : null;
  const end = heavy ? [item.x, item.z] : plan.sectors[sector].landing;
  const climbKnown = tt(T.FOOT) <= now;
  const sig = [task, G.trips[g], c, route, sector, R.key, climbKnown ? 1 : 0, tt(T.START), tt(T.FOOT), climbKnown ? tt(T.TOP) : 0, task === TASK.RETURNING ? tt(T.HOME) : 0].join('|');

  // paths: 0 idle, 1 way out, 2 way back (reverse of 1, or of a way out from the harbour for
  // heavy gangs that loaded limestone at the quarry), 3 walk from the quay to the quarry
  const limestoneHeavy = heavy && !item.granite;
  const out = wayOut(sim, R, plan, c, route, kind === GIZA || limestoneHeavy ? 'q' : 'h', limestoneHeavy ? null : y, end);
  const back = limestoneHeavy ? wayOut(sim, R, plan, c, route, 'h', y, end) : out;
  const paths = [idle, out.line.p, limestoneHeavy ? reverse(back.line.p) : 1];
  const Lo = out.L, Lb = back.L;

  if (limestoneHeavy) {
    const w = new Builder(R).start(y.slot[0], y.slot[1]).to(y.app[0], y.app[1]);
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
  knot(tt(T.DEPART), ACT.HAUL, 1, 0, 1, out.sFoot);
  if (!climbKnown) {
    knot(tt(T.FOOT), ACT.WAIT, 1, out.sFoot, 1, out.sFoot);
  } else {
    knot(tt(T.FOOT), ACT.WAIT, 1, out.sFoot, 1, out.sFoot);
    knot(tt(T.CLIMB), ACT.HAUL, 1, out.sFoot, 1, out.sSwitch);
    const rt = plan.layout.routes[route];
    if (out.sHead > out.sSwitch + 1e-6 || rt.segs.length > 1) {
      knot(tt(T.ARR1), ACT.WAIT, 1, out.sSwitch, 1, out.sSwitch);
      // the zigzag: the model's time on it is travel plus turns × turnTime (twice for heavy
      // gangs); the same total pause is shared between the switchbacks drawn on the way
      const seg = rt.segs[1];
      const D = tt(T.TOP) - tt(T.ENT1);
      const pauseAll = seg ? Math.min(D * 0.9, seg.turns * seg.turnTime * (heavy ? 2 : 1)) : 0;
      const nc = out.corners.length, pause = nc ? pauseAll / nc : 0;
      const travel = Math.max(1e-6, D - pause * nc);
      const v = (out.sHead - out.sSwitch) / travel;
      let t = tt(T.ENT1), s = out.sSwitch;
      for (const cs of out.corners) {
        const tc = t + (cs - s) / v;
        knot(t, ACT.HAUL, 1, s, 1, cs);
        knot(tc, ACT.TURN, 1, cs, 1, cs);
        t = tc + pause; s = cs;
      }
      knot(t, ACT.HAUL, 1, s, 1, out.sHead);
    }
    knot(tt(T.TOP), ACT.HAUL, 1, out.sHead, 1, Lo);
    if (!heavy) knot(tt(T.LAND), ACT.WAIT, 1, Lo, 1, Lo);
    knot(tt(T.UNLOAD), heavy ? ACT.SET : ACT.UNLOAD, 1, Lo, 2, 0);
    if (task === TASK.RETURNING) {
      // back at the model's speed: the top, the whole ramp and the road in proportion
      const top = heavy ? item.top : plan.sectors[sector].top;
      const road = (kind === GIZA ? plan.road.q : plan.road.h)[route];
      const tot = top + plan.rampLen[route] + road, D = tt(T.HOME) - tt(T.DONE);
      const t1 = tt(T.DONE) + (D * top) / tot, t2 = t1 + (D * plan.rampLen[route]) / tot;
      knot(tt(T.DONE), ACT.RETURN, 2, 0, 2, Lb - back.sHead);
      knot(t1, ACT.RETURN, 2, Lb - back.sHead, 2, Lb - back.sFoot);
      knot(t2, ACT.RETURN, 2, Lb - back.sFoot, 2, Lb);
      knot(tt(T.HOME), ACT.IDLE, 0, Li, 0, Li);
    } else {
      knot(tt(T.DONE), ACT.RETURN, 2, 0, 2, 0); // unloaded: holds until the walk back is known
    }
  }
  // knots must not go back in time (guards rounding in the zigzag split)
  for (let i = KN; i < K.length; i += KN) if (K[i] < K[i - KN]) K[i] = K[i - KN];
  return { ...base, sig, paths, knots: Float64Array.from(K), load: loadOf(plan, kind, sector), course: c };
}

function reverse(p) {
  const n = p.length / 3, out = new Float32Array(p.length);
  for (let i = 0; i < n; i++) { out[3 * i] = p[3 * (n - 1 - i)]; out[3 * i + 1] = p[3 * (n - 1 - i) + 1]; out[3 * i + 2] = p[3 * (n - 1 - i) + 2]; }
  return out;
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
      for (let g = 0; g < sim.state.gang.kind.length; g++) {
        const tr = tripOf(sim, R, plans, g);
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
  const R = rampScene(sim), plans = planner(sim);
  return sim.state.gang.kind.length ? Array.from(sim.state.gang.kind, (_, g) => tripOf(sim, R, plans, g)) : [];
}

// What the page needs to draw the ramps: the straight wedges and each face's zigzag up to
// the bed of the highest course in use.
export function rampsForDrawing(sim, R = rampScene(sim)) {
  const zig = R.zig && R.top > R.sw ? FACES.map((_, f) => zigPrefix(R, f, R.top).pts) : null;
  return { key: R.key, done: R.done, Y: R.Y, hr: R.hr, F: R.F, plat: R.plat, w: R.w, zw: R.zw, sw: R.sw, top: R.top, zig };
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
  return (trip._prep = { lines, spec, lead });
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
  return out;
}
// the last time the trip is known for (after it, the gang holds where it is)
export const tripHorizon = (trip) => trip.knots[trip.knots.length - KN];

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerpAngle = (a, b, k) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
// lane offset (to the left of travel), faded out over the first and last 10 m of a path so
// every path starts and ends on its exact point
const fade = (line, s) => smooth(s / 10) * smooth((line.L - s) / 10);

const P3 = [0, 0, 0];
// place a point at arc length s of `line`, `lat` metres to the left (plus the gang's lane)
function placeOn(line, s, lat, lane, out, o) {
  line.at(s, P3);
  const yaw = line.yaw(s);
  const off = lat + lane * fade(line, s);
  out[o] = P3[0] + Math.cos(yaw) * off; out[o + 1] = P3[1]; out[o + 2] = P3[2] - Math.sin(yaw) * off;
  return yaw;
}

// Layout of the output of figures(): the sled, then FIG numbers per crew member.
export const SLED = 9; // x, y, z, yaw, pitch, stone x, y, z, stone shown (0/1)
export const FIG = 7; // x, y, z, yaw, pose, distance walked (for the leg cycle), speed (m/s)

// Static placement of the whole gang standing on path `li` at arc length s (no motion):
// used for each end of a regrouping.
function formation(trip, P, li, s, act, out, o, t, speed) {
  const { spec, lead, lines } = P, line = lines[li], lane = trip.lane;
  const moving = speed > 0.02;
  // sled
  const yaw = placeOn(line, s, 0, lane, out, o);
  out[o + 3] = yaw;
  out[o + 4] = -Math.atan(line.slope(s));
  let f = o + SLED;
  const pull = act === ACT.HAUL, ret = act === ACT.RETURN || act === ACT.WALK;
  for (let r = 0; r < spec.ranks; r++) for (let j = 0; j < spec.files; j++) {
    const sp = s + lead + r * spec.gap;
    out[f + 3] = placeOn(line, sp, spec.lat[j], lane, out, f);
    let pose = POSE.REST;
    if (pull) pose = POSE.PULL;
    else if (ret) pose = moving ? (r === 0 ? POSE.PULL : POSE.WALK) : POSE.REST;
    else if (act === ACT.IDLE && (r * 7 + j * 3) % 5 === 0) pose = POSE.KNEEL;
    out[f + 4] = pose; out[f + 5] = sp + (r * 0.37 + j * 0.5); out[f + 6] = moving ? speed : 0;
    f += FIG;
  }
  // pourers at the front corners of the sled, levermen behind it
  for (let k = 0; k < spec.extra; k++) {
    const pourer = k < spec.pourers;
    const side = k % 2 ? 1 : -1;
    const sp = pourer ? s + lead * 0.55 + Math.floor(k / 2) * 0.7 : s - lead * 0.9 - Math.floor((k - spec.pourers) / 2) * 0.7;
    const lat = pourer ? side * (trip.load ? trip.load[0] / 2 + 0.55 : 0.8) : spec.extra > 2 ? side * 0.5 : 0;
    out[f + 3] = placeOn(line, sp, lat, lane, out, f);
    let pose = POSE.REST;
    if (pull) pose = pourer ? POSE.POUR : POSE.PUSH;
    else if (act === ACT.TURN || act === ACT.LOAD || act === ACT.UNLOAD || act === ACT.SET) pose = POSE.LEVER;
    else if (ret && moving) pose = POSE.WALK;
    out[f + 4] = pose; out[f + 5] = sp + k * 0.61; out[f + 6] = moving ? speed : 0;
    f += FIG;
  }
}

const TOK = {};
let A = new Float32Array(0), Bf = new Float32Array(0);
// Places a gang at time t into out (from offset o): SLED numbers, then FIG per crew member
// (crewSpec(kind, crew).n of them). Returns the token state (tokenAt).
export function figures(trip, t, out, o = 0) {
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
  return tok;
}
