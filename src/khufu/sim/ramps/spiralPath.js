// A ramp winding round the pyramid as a square spiral, shared by the spiral ledges and the
// internal ramp: at height y it runs r(y) from the centre, parallel to the face it is on,
// climbing at `grade` (rise over horizontal run), and turns a corner whenever it reaches the
// arris. The model (segment length and corners) and the drawing (sim/gangs.js, bubble.js)
// use the same path, so a gang climbs exactly what is drawn.
import { HEIGHT } from '../../data.js';
import { FACES } from './straightZigzag.js';

// Points every `step` m of run and at each corner: { p: [x, y, z, face, corner (0/1)] … }.
// `face`: the face it starts on, at its left-hand end (u = −r). `entry`: an optional [x, z]
// the path starts from on the ground (a passage into the masonry) before the spiral.
export function squareSpiral({ face, r, grade, entry = null, yTop = HEIGHT, step = 6 }) {
  const pts = [];
  const xyz = (f, rr, u, y) => { const [n, t] = FACES[f]; return [n[0] * rr + t[0] * u, y, n[1] * rr + t[1] * u]; };
  let f = face, y = 0, u = -r(0);
  if (entry) pts.push([entry[0], 0, entry[1], f, 0]);
  pts.push([...xyz(f, r(0), u, 0), f, 0]);
  for (let guard = 0; y < yTop - 1e-9 && guard < 1e5; guard++) {
    // run to the corner, solved for r shrinking as the path climbs (r is piecewise linear in y)
    let toCorner = r(y) - u;
    for (let k = 0; k < 4; k++) toCorner = Math.max(0, r(y + toCorner * grade) - u);
    const d = Math.min(step, toCorner, (yTop - y) / grade);
    y = Math.min(yTop, y + d * grade); u += d;
    const corner = d >= toCorner - 1e-9 && y < yTop - 1e-9;
    if (corner) u = r(y);
    pts.push([...xyz(f, r(y), u, y), f, corner ? 1 : 0]);
    if (corner) { f = (f + 1) % 4; u = -r(y); }
  }
  return pts;
}

// The stretch of a spiral from its start up to height y: xyz as a Float32Array, how many
// corners it passes on the way (and their point indices), its length, and its end (x, z, face).
export function spiralPrefix(path, y) {
  const out = [];
  let turns = 0, length = 0, end = path[0];
  const cornerIdx = [];
  out.push(path[0][0], path[0][1], path[0][2]);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    let p = b;
    if (b[1] >= y - 1e-9) {
      const k = b[1] - a[1] > 1e-9 ? (y - a[1]) / (b[1] - a[1]) : 1;
      p = [a[0] + (b[0] - a[0]) * k, y, a[2] + (b[2] - a[2]) * k, b[3], 0];
    }
    length += Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
    out.push(p[0], p[1], p[2]);
    end = p;
    if (p !== b) break;
    if (b[4]) { turns++; cornerIdx.push(i); }
    if (b[1] >= y - 1e-9) break;
  }
  return { pts: Float32Array.from(out), turns, cornerIdx, length, end: [end[0], end[2], end[3]] };
}
