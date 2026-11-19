// Simulation primitives: polyline paths, cooperative behaviours (generators) and
// movement helpers shared by every agent.
import * as THREE from 'three';
import { routeAround, sidestep, isClear } from './nav.js';

const YA = new THREE.Vector3(), YB = new THREE.Vector3();

export class Path {
  constructor(points) {
    this.pts = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p)));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }
  // position at arc length s; beyond the ends the path is extended along its end tangents
  at(s, out = new THREE.Vector3()) {
    const p = this.pts, n = p.length;
    if (n === 1) return out.copy(p[0]);
    if (s <= 0) { const d = p[1].clone().sub(p[0]).normalize(); return out.copy(p[0]).addScaledVector(d, s); }
    if (s >= this.length) { const d = p[n - 1].clone().sub(p[n - 2]).normalize(); return out.copy(p[n - 1]).addScaledVector(d, s - this.length); }
    let i = 1;
    while (this.cum[i] < s) i++;
    const t = (s - this.cum[i - 1]) / Math.max(1e-9, this.cum[i] - this.cum[i - 1]);
    return out.copy(p[i - 1]).lerp(p[i], t);
  }
  // horizontal heading (yaw) at arc length s, smoothed over a window
  yaw(s, win = 0.6) {
    const a = this.at(s - win, YA), b = this.at(s + win, YB);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }
}

// Seeded random numbers, so every run (and every replay after a jump back) is the same build.
let seed = 0x9e3779b9;
export function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---- behaviours ------------------------------------------------------------
// A behaviour is a generator; each `yield` hands control back until the next tick,
// and receives the tick's dt. The scheduler runs all of them each tick.
export class Scheduler {
  constructor() { this.tasks = []; this.time = 0; }
  spawn(gen, name = '') { const t = { gen, name, done: false }; this.tasks.push(t); return t; }
  tick(dt) {
    this.time += dt;
    for (const t of this.tasks) {
      if (t.done) continue;
      const r = t.gen.next(dt);
      if (r.done) t.done = true;
    }
    if (this.tasks.length > 64 && this.tasks.some((t) => t.done)) this.tasks = this.tasks.filter((t) => !t.done);
  }
}

export function* wait(seconds) { let t = 0; while (t < seconds) t += yield; }
export function* until(cond) { while (!cond()) yield; }
// run several behaviours in parallel until all finish
export function* all(gens) {
  const live = gens.map((g) => ({ g, done: false }));
  let dt = 0;
  while (live.some((l) => !l.done)) {
    for (const l of live) if (!l.done && l.g.next(dt).done) l.done = true;
    if (live.some((l) => !l.done)) dt = yield;
  }
}

// walk a worker along a path at a speed (m/s); speedFn may modulate (e.g. hunger)
export function* walk(w, pts, speed = 1.35, pose = null, speedMul = () => 1) {
  const path = pts instanceof Path ? pts : new Path([w.pos.clone(), ...routeAround(w.pos, pts)]);
  if (pose) w.pose = pose;
  let s = 0;
  w.side = 0;
  // simulation-side record of who is on the move (the crowd's own speed comes from frame timing)
  w.walking = (w.walking || 0) + 1;
  try {
  while (s < path.length) {
    const dt = yield;
    s = Math.min(path.length, s + speed * speedMul() * dt);
    path.at(s, w.pos);
    const ty = path.yaw(s, 0.3);
    w.yaw = lerpAngle(w.yaw, ty, Math.min(1, dt * 8));
    // step aside for people just ahead, easing back onto the path before arriving
    const dx = Math.sin(ty), dz = Math.cos(ty);
    const want = -sidestep(w, dx, dz) * Math.min(1, (path.length - s) / 1.5);
    w.side += (want - w.side) * Math.min(1, dt * 4);
    if (Math.abs(w.side) > 0.01) {
      const nx = w.pos.x + dz * w.side, nz = w.pos.z - dx * w.side;
      if (isClear(nx, nz)) { w.pos.x = nx; w.pos.z = nz; } else w.side *= 0.5;
    }
  }
  } finally { w.walking--; w.side = 0; }
}

export function* turnTo(w, yaw, dur = 0.4) {
  let t = 0; const y0 = w.yaw;
  while (t < dur) { t += yield; w.yaw = lerpAngle(y0, yaw, Math.min(1, t / dur)); }
}

// stock counter with change listeners (for HUD)
export class Stocks {
  constructor(init) { this.v = { ...init }; this.inTransit = {}; }
  get(k) { return this.v[k] || 0; }
  add(k, n = 1) { this.v[k] = (this.v[k] || 0) + n; }
  take(k, n = 1) { if ((this.v[k] || 0) < n) return false; this.v[k] -= n; return true; }
}
