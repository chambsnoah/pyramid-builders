// The road graph: the quarry, the harbour, waypoints round the corners of the pyramid and
// the foot of every ramp. Roads run straight between any two points that can see each other
// past the pyramid, so the shortest route from the quarry to a ramp on the far side goes
// round a corner. Distances are worked out once per course (ramp feet move as ramps grow).
import { HALF } from '../data.js';

const KEEP_OUT = HALF + 2; // roads stay off the pyramid (and its pavement)
const CORNER = HALF + 25;
export const CORNERS = [[CORNER, CORNER], [-CORNER, CORNER], [-CORNER, -CORNER], [CORNER, -CORNER]];

// does the segment a→b cross the open square |x|, |z| < KEEP_OUT? (Liang–Barsky clip)
function blocked([ax, az], [bx, bz]) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax + KEEP_OUT], [dx, KEEP_OUT - ax], [-dz, az + KEEP_OUT], [dz, KEEP_OUT - az]]) {
    if (Math.abs(p) < 1e-12) { if (q <= 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t0) t0 = r; } else if (r < t1) t1 = r;
    if (t0 >= t1) return false;
  }
  return t1 - t0 > 1e-6;
}

// shortest paths from each source over a visibility graph. sources and targets are [x, z].
// Returns { dist[s][t], path[s][t] = [[x, z], …] }.
export function roadNetwork(sources, targets) {
  const nodes = [...sources, ...CORNERS, ...targets];
  const N = nodes.length;
  const w = Array.from({ length: N }, () => new Float64Array(N).fill(Infinity));
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    if (blocked(nodes[i], nodes[j])) continue;
    w[i][j] = w[j][i] = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
  }
  const dist = [], path = [];
  sources.forEach((_, s) => {
    const d = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    d[s] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0) break;
      done[u] = 1;
      for (let v = 0; v < N; v++) if (w[u][v] < Infinity && d[u] + w[u][v] < d[v]) { d[v] = d[u] + w[u][v]; prev[v] = u; }
    }
    dist.push(targets.map((_, k) => d[sources.length + CORNERS.length + k]));
    path.push(targets.map((_, k) => {
      const p = [];
      for (let v = sources.length + CORNERS.length + k; v >= 0; v = prev[v]) p.unshift(nodes[v]);
      return p;
    }));
  });
  return { dist, path };
}
