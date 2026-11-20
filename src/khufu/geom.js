// Convex-polygon helpers for the room linings: the faces of each volume, splitting by a
// plane, and removing the part of a face that lies inside another (convex) volume.
// Points are [x, y, z]; a plane is [nx, ny, nz, d] with signed distance n·p + d
// (negative = inside the half-space).
import { floorY, ceilY } from './data.js';

const EPS = 1e-5;

export function plane(nx, ny, nz, d) { const l = Math.hypot(nx, ny, nz); return [nx / l, ny / l, nz / l, d / l]; }
const dist = (p, P) => P[0] * p[0] + P[1] * p[1] + P[2] * p[2] + P[3];

export function newell(poly) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z]; // length = 2 × area
}
const area = (poly) => Math.hypot(...newell(poly)) / 2;

// split a convex polygon into the parts in front of (outside) and behind (inside) a plane
export function split(poly, P) {
  const ds = poly.map((p) => dist(p, P));
  if (ds.every((d) => Math.abs(d) <= EPS)) return { coplanar: true };
  const front = [], back = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = ds[i], db = ds[(i + 1) % poly.length];
    if (da > EPS) front.push(a); else if (da < -EPS) back.push(a); else { front.push(a); back.push(a); }
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
      const t = da / (da - db);
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      front.push(q); back.push(q);
    }
  }
  return { front: front.length >= 3 && area(front) > 1e-7 ? front : null, back: back.length >= 3 && area(back) > 1e-7 ? back : null };
}

// keep only the part of a polygon inside the half-space (a face lying on the plane is kept)
export function clip(poly, P) {
  const s = split(poly, P);
  return s.coplanar ? poly : s.back;
}

// the planes bounding a volume (see data.js), each with the inside on its negative side
export function volumePlanes(v) {
  return [
    plane(-1, 0, 0, v.x0), plane(1, 0, 0, -v.x1), plane(0, 0, -1, v.z0), plane(0, 0, 1, -v.z1),
    plane(0, -1, v.floor[1], v.floor[0]),
    ...v.ceil.map(([a, b]) => plane(0, 1, -b, -a)),
  ];
}
export function volumeBounds(v) {
  const ys = [floorY(v, v.z0), floorY(v, v.z1), ceilY(v, v.z0), ceilY(v, v.z1), ...ceilBreaks(v).map((z) => ceilY(v, z))];
  return { x0: v.x0, x1: v.x1, z0: v.z0, z1: v.z1, y0: Math.min(...ys), y1: Math.max(...ys) };
}

// remove from `poly` the part strictly inside the convex volume; returns the pieces left.
// A face lying on the volume's boundary is not inside, so shared walls survive.
export function subtract(poly, planes) {
  const out = [];
  let cur = poly;
  for (const P of planes) {
    const s = split(cur, P);
    if (s.coplanar) { out.push(cur); return out; }
    if (s.front) out.push(s.front);
    if (!s.back) return out;
    cur = s.back;
  }
  return out;
}

// z values where the active ceiling plane changes (ridge of a gable), with the ends
export function ceilBreaks(v) {
  const zs = [v.z0, v.z1];
  for (let i = 0; i < v.ceil.length; i++) for (let j = i + 1; j < v.ceil.length; j++) {
    const [ai, bi] = v.ceil[i], [aj, bj] = v.ceil[j];
    if (Math.abs(bi - bj) < 1e-9) continue;
    const z = (aj - ai) / (bi - bj);
    if (z > v.z0 + 1e-6 && z < v.z1 - 1e-6) zs.push(z);
  }
  return zs.sort((a, b) => a - b);
}

// The faces of a volume. Inward normals for a void (seen from inside), outward for a solid.
// Each face: { pts, n: [x, y, z] unit normal, side: 'floor'|'ceil'|'x0'|'x1'|'z0'|'z1' }
export function volumeFaces(v, inward, skip = []) {
  const f = (z) => floorY(v, z), c = (z) => ceilY(v, z);
  const zs = ceilBreaks(v);
  const faces = [];
  const add = (side, pts, want) => {
    if (skip.includes(side === 'floor' ? 'bottom' : side === 'ceil' ? 'top' : side)) return;
    let n = newell(pts);
    const l = Math.hypot(...n);
    if (l < 1e-9) return;
    n = n.map((k) => k / l);
    const w = inward ? want : want.map((k) => -k);
    if (n[0] * w[0] + n[1] * w[1] + n[2] * w[2] < 0) { pts.reverse(); n = n.map((k) => -k); }
    faces.push({ pts, n, side });
  };
  add('floor', [[v.x0, f(v.z0), v.z0], [v.x1, f(v.z0), v.z0], [v.x1, f(v.z1), v.z1], [v.x0, f(v.z1), v.z1]], [0, 1, 0]);
  for (let i = 0; i + 1 < zs.length; i++) {
    const za = zs[i], zb = zs[i + 1];
    add('ceil', [[v.x0, c(za), za], [v.x1, c(za), za], [v.x1, c(zb), zb], [v.x0, c(zb), zb]], [0, -1, 0]);
  }
  for (const [side, x, want] of [['x0', v.x0, [1, 0, 0]], ['x1', v.x1, [-1, 0, 0]]]) {
    const pts = [[x, f(v.z0), v.z0], [x, f(v.z1), v.z1]];
    for (let i = zs.length - 1; i >= 0; i--) pts.push([x, c(zs[i]), zs[i]]);
    add(side, pts, want);
  }
  for (const [side, z, want] of [['z0', v.z0, [0, 0, 1]], ['z1', v.z1, [0, 0, -1]]]) {
    add(side, [[v.x0, f(z), z], [v.x1, f(z), z], [v.x1, c(z), z], [v.x0, c(z), z]], want);
  }
  return faces;
}

// the part of a volume cut by the horizontal plane y: an x–z rectangle, or null
export function sectionAt(v, y) {
  let lo = v.z0, hi = v.z1;
  const need = (a, b, sign) => { // sign +1: a + b z < y ; -1: a + b z > y
    if (Math.abs(b) < 1e-12) { if (sign > 0 ? a >= y : a <= y) { lo = 1; hi = 0; } return; }
    const z = (y - a) / b;
    if ((b > 0) === (sign > 0)) hi = Math.min(hi, z); else lo = Math.max(lo, z);
  };
  need(v.floor[0], v.floor[1], 1);
  for (const [a, b] of v.ceil) need(a, b, -1);
  return hi > lo + 1e-6 ? { x0: v.x0, x1: v.x1, z0: lo, z1: hi } : null;
}
