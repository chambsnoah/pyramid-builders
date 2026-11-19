// Ground navigation: a coarse occupancy grid of buildings, stone, heaps, water and the
// built pyramid, used to route walkers around obstacles and keep them from overlapping.
// Everything here runs on simulation state only, so replays stay identical.
import * as THREE from 'three';
import { HALF, N, B, getBlock, edgeX, edgeZ } from './plan.js';
import { SITE, isWater } from './world.js';
import { rampHeightAt } from './pyramid.js';

const X0 = -66, Z0 = -54, RES = 0.5, W = 280, D = 250; // covers x -66..74, z -54..71
const INFLATE = 0.3; // body radius kept clear of obstacles
let sim = null;
let grid = new Uint8Array(W * D);
let base = null; // static obstacles, computed once
let builtAt = -1e9;
// A* scratch space, reused between searches (allocating it per search caused GC pauses)
const cost = new Float32Array(W * D), prev = new Int32Array(W * D), stamp = new Uint32Array(W * D), closed = new Uint32Array(W * D);
let searchId = 0;

export function attachNav(s) { sim = s; builtAt = -1e9; base = null; }

const gi = (x, z) => {
  const i = Math.floor((x - X0) / RES), k = Math.floor((z - Z0) / RES);
  return i < 0 || k < 0 || i >= W || k >= D ? -1 : k * W + i;
};
const cellX = (i) => X0 + (i + 0.5) * RES, cellZ = (k) => Z0 + (k + 0.5) * RES;

function markRect(x0, x1, z0, z1) {
  const i0 = Math.max(0, Math.floor((x0 - INFLATE - X0) / RES)), i1 = Math.min(W - 1, Math.floor((x1 + INFLATE - X0) / RES));
  const k0 = Math.max(0, Math.floor((z0 - INFLATE - Z0) / RES)), k1 = Math.min(D - 1, Math.floor((z1 + INFLATE - Z0) / RES));
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) grid[k * W + i] = 1;
}
function markCircle(cx, cz, r) {
  const rr = r + INFLATE;
  for (let k = Math.floor((cz - rr - Z0) / RES); k <= Math.floor((cz + rr - Z0) / RES); k++) {
    for (let i = Math.floor((cx - rr - X0) / RES); i <= Math.floor((cx + rr - X0) / RES); i++) {
      if (i < 0 || k < 0 || i >= W || k >= D) continue;
      if (Math.hypot(cellX(i) - cx, cellZ(k) - cz) <= rr) grid[k * W + i] = 1;
    }
  }
}

function rebuildStatic() {
  grid.fill(0);
  const { store, quarryFace: q } = SITE;
  // water, except the stone quay
  for (let k = 0; k < D; k++) for (let i = 0; i < W; i++) {
    const x = cellX(i), z = cellZ(k);
    const onQuay = x > SITE.quayX - 2.7 && x < SITE.quayX + 0.3 && z > SITE.basin.z0 - 2 && z < SITE.basin.z1 + 2;
    if (!onQuay && isWater(x, z)) grid[k * W + i] = 1;
  }
  // storehouse walls, leaving the west doorway open
  const sx0 = store.x - store.w / 2, sx1 = store.x + store.w / 2, sz0 = store.z - store.d / 2, sz1 = store.z + store.d / 2;
  markRect(sx0, sx1, sz0 - 0.25, sz0 + 0.25); markRect(sx0, sx1, sz1 - 0.25, sz1 + 0.25);
  markRect(sx1 - 0.25, sx1 + 0.25, sz0, sz1);
  markRect(sx0 - 0.25, sx0 + 0.25, sz0, store.z - 1); markRect(sx0 - 0.25, sx0 + 0.25, store.z + 1, sz1);
  // camp huts and the water station stand
  for (let n = 0; n < 6; n++) { const hx = SITE.camp.x - 18 + (n % 3) * 9, hz = SITE.camp.z - 6 + Math.floor(n / 3) * 9; markRect(hx - 2.5, hx + 2.5, hz - 2, hz + 2); }
  markRect(SITE.waterStation.x - 1.6, SITE.waterStation.x + 1.6, SITE.waterStation.z - 0.7, SITE.waterStation.z + 0.7);
  // quarry outcrop and its chip heaps
  markRect(q.x0 - 5.6, q.x1 + 5.6, q.z + 0.1, q.z + 26);
  markCircle(q.x0 - 8, q.z - 1, 3.4);
  base = grid.slice();
}

function rebuild() {
  if (!base) rebuildStatic();
  grid.set(base);
  // spoil heap (grows as the tunnels are cut)
  if (sim.spoilHeap) markCircle(SITE.spoil.x, SITE.spoil.z, 4 * sim.spoilHeap.scale.x * 1.05);
  // stone waiting in the yard and at the quarry
  for (const s of sim.harbour.slots) if (s.item) markRect(s.x - 0.63, s.x + 0.63, s.z - 0.63, s.z + 0.63);
  for (const p of sim.quarry.pile) if (p.item) markRect(p.x - 0.63, p.x + 0.63, p.z - 0.63, p.z + 0.63);
  // the first course of the pyramid, and the body of both ramps
  for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
    const b = getBlock(0, i, k);
    if (b && b.placed && !b.stair) markRect(edgeX(i) + 0.05, edgeX(i) + B - 0.05, edgeZ(k) + 0.05, edgeZ(k) + B - 0.05);
  }
  if (Math.max(sim.rampH, sim.rampHW) > 0.6) {
    // only scan the strip the two ramps can occupy
    const reach = HALF + 4 + 4 * Math.max(sim.rampH, sim.rampHW);
    for (let k = Math.floor((-8 - Z0) / RES); k <= Math.floor((8 - Z0) / RES); k++) {
      for (let i = Math.max(0, Math.floor((-reach - X0) / RES)); i <= Math.min(W - 1, Math.floor((reach - X0) / RES)); i++) {
        const x = cellX(i), z = cellZ(k);
        if (Math.abs(x) > HALF - 1 && rampHeightAt(x < 0 ? sim.rampHW : sim.rampH, x, z) > 0.6) grid[k * W + i] = 1;
      }
    }
  }
}

function fresh() {
  if (!sim) return false;
  if (sim.sched.time - builtAt > 2) { rebuild(); builtAt = sim.sched.time; }
  return true;
}
const blockedAt = (x, z) => { const c = gi(x, z); return c >= 0 && grid[c] === 1; };

// is the straight line a→b blocked, ignoring the ends (walkers start and stop beside things)
function lineBlocked(a, b, skip = 0.35) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  for (let d = skip; d < len - skip; d += 0.25) {
    const t = d / len;
    if (blockedAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return true;
  }
  return false;
}

function nearestClear(p) {
  if (!blockedAt(p.x, p.z)) return p;
  for (let r = 0.5; r <= 1.5; r += 0.5) {
    for (let n = 0; n < 12; n++) {
      const ang = (n / 12) * Math.PI * 2, x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r;
      if (!blockedAt(x, z)) return new THREE.Vector3(x, p.y, z);
    }
  }
  return null;
}

// grid A* between two ground points; returns intermediate waypoints or null
const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
function astar(a, b) {
  const s = gi(a.x, a.z), g = gi(b.x, b.z);
  if (s < 0 || g < 0) return null;
  const gx = g % W, gz = Math.floor(g / W);
  const near = (c, p) => Math.hypot(cellX(c % W) - p.x, cellZ(Math.floor(c / W)) - p.z) < 0.6;
  const free = (c) => grid[c] === 0 || near(c, a) || near(c, b);
  searchId++;
  const seen = (c) => stamp[c] === searchId;
  const touch = (c) => { if (!seen(c)) { stamp[c] = searchId; cost[c] = Infinity; prev[c] = -1; } };
  touch(s); cost[s] = 0;
  const h = (c) => { const dx = Math.abs(c % W - gx), dz = Math.abs(Math.floor(c / W) - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  // binary heap of [priority, cell]
  const heap = [[h(s), s]];
  const push = (e) => { heap.push(e); let n = heap.length - 1; while (n > 0) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top; };
  let guard = 0;
  while (heap.length && guard++ < 30000) { // enough to go right round the pyramid; goals inside obstacles are filtered out first
    const [, c] = pop();
    if (closed[c] === searchId) continue; // a stale heap entry for a cell already expanded
    closed[c] = searchId;
    if (c === g) break;
    const ci = c % W, ck = Math.floor(c / W);
    for (const [di, dk, w] of STEPS) {
      const ni = ci + di, nk = ck + dk;
      if (ni < 0 || nk < 0 || ni >= W || nk >= D) continue;
      const nc = nk * W + ni;
      if (!free(nc)) continue;
      if (di && dk && (!free(ck * W + ni) || !free(nk * W + ci))) continue; // no corner cutting
      touch(nc);
      const nCost = cost[c] + w;
      if (nCost < cost[nc]) { cost[nc] = nCost; prev[nc] = c; push([nCost + h(nc), nc]); }
    }
  }
  touch(g);
  if (prev[g] < 0 && g !== s) return null;
  const cells = [];
  for (let c = g; c !== s && c >= 0; c = prev[c]) cells.unshift(c);
  // string-pull: keep only the turns needed to stay clear
  const pts = cells.map((c) => new THREE.Vector3(cellX(c % W), 0, cellZ(Math.floor(c / W))));
  const out = [];
  let from = a;
  for (let n = 0; n < pts.length; n++) {
    const next = pts[n + 1];
    if (next && !lineBlocked(from, next, 0)) continue;
    if (n < pts.length - 1) { out.push(pts[n]); from = pts[n]; }
  }
  return out;
}

// Expand a list of waypoints so ground-level legs go round obstacles.
export function routeAround(start, pts) {
  if (!fresh()) return pts;
  const out = [];
  let a = start;
  for (const b of pts) {
    const ground = a.y < 0.35 && b.y < 0.35;
    const inPyramid = (p) => Math.abs(p.x) < HALF - 0.05 && Math.abs(p.z) < HALF - 0.05;
    if (ground && !inPyramid(a) && !inPyramid(b) && lineBlocked(a, b)) {
      // a leg that starts or ends tight against something routes from the nearest clear spot;
      // one that ends somewhere unreachable (a boat deck, the face of a block) stays straight
      const a2 = nearestClear(a), b2 = nearestClear(b);
      const detour = a2 && b2 ? astar(a2, b2) : null;
      if (detour) {
        if (a2 !== a) out.push(a2.clone().setY(a.y));
        for (const p of detour) out.push(p.setY(a.y + (b.y - a.y) * 0.5));
        if (b2 !== b) out.push(b2.clone().setY(b.y));
      }
    }
    out.push(b);
    a = b;
  }
  return out;
}

// ---- keeping walkers apart -------------------------------------------------------
// a 1 m bucket grid over the site, rebuilt each tick without allocating
const HX0 = -70, HZ0 = -60, HW = 150, HD = 140;
const head = new Int32Array(HW * HD).fill(-1);
let nextIdx = new Int32Array(256), list = [];
export function indexWorkers(workers) {
  head.fill(-1);
  if (nextIdx.length < workers.length) nextIdx = new Int32Array(workers.length * 2);
  list = workers;
  for (let n = 0; n < workers.length; n++) {
    const p = workers[n].pos;
    const i = Math.floor(p.x - HX0), k = Math.floor(p.z - HZ0);
    if (i < 0 || k < 0 || i >= HW || k >= HD) { nextIdx[n] = -2; continue; }
    const c = k * HW + i;
    nextIdx[n] = head[c]; head[c] = n;
  }
}
// sideways shift (metres, + = to the walker's right) that steers round people just ahead
export function sidestep(w, dirX, dirZ) {
  const px = w.pos.x, pz = w.pos.z;
  if (w.pos.y > 0.35 || (Math.abs(px) < HALF + 1 && Math.abs(pz) < HALF + 1)) return 0;
  let push = 0;
  const ci = Math.floor(px - HX0), ck = Math.floor(pz - HZ0);
  for (let i = ci - 1; i <= ci + 1; i++) for (let k = ck - 1; k <= ck + 1; k++) {
    if (i < 0 || k < 0 || i >= HW || k >= HD) continue;
    for (let n = head[k * HW + i]; n >= 0; n = nextIdx[n]) {
      const o = list[n];
      if (o === w) continue;
      const dx = o.pos.x - px, dz = o.pos.z - pz;
      const ahead = dx * dirX + dz * dirZ, side = dx * dirZ - dz * dirX; // side > 0: other is to one side
      if (ahead < -0.2 || ahead > 1.6 || Math.abs(side) > 0.65) continue;
      push += (side >= 0 ? 1 : -1) * (0.65 - Math.abs(side)) * (1 - ahead / 1.8);
    }
  }
  return Math.max(-0.6, Math.min(0.6, push));
}
export function isClear(x, z) { return !blockedAt(x, z); }
