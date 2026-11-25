// Scripted first-person walks for the walking tests: a graph of waypoints through the
// passages of the finished pyramid, and a driver that walks the real walker (its keys,
// gravity, collision, crouching and climbs) from one waypoint to the next, handing back to
// the test whenever the "Space · climb up" prompt shows where the way goes up.

// passage floors (data.js): descending y = -33.85 - 0.5 z, ascending and gallery y = 41.6 + 0.49 z
const X = 7.29;
const desc = (z) => -33.85 - 0.4996 * z;
const asc = (z) => 41.62 + 0.4877 * z;
export const NODES = {
  OUT: [X, 0, -136.0],
  STAIR: [X, 8, -115.0],
  DOOR: [X, 16.97, -102.4],
  HOLE: [X, desc(-75.7), -75.7],       // in the descending passage, under the hole up
  ASC: [X, asc(-73.5), -73.5],         // up through the hole, in the ascending passage
  ASC_TOP: [X, asc(-42.5), -42.5],
  QPASS: [X, 21.7, -38.0],             // the horizontal passage to the Queen's Chamber
  QSTEP: [X, 21.18, -6.0],
  QC: [5.6, 21.18, 0.0],
  GFOOT: [X, 21.7, -40.3],             // the foot of the Grand Gallery (scramble up onto its floor)
  GAL: [X, asc(-38.5), -38.5],         // in the Grand Gallery
  GAL_HI: [X, asc(-6), -6],
  STEP: [X, 43.03, 1.9],               // on the great step
  ANTE: [X, 43.03, 5.4],
  KC: [5.0, 43.03, 11.5],
  DESC_BOT: [X, -30.05, -7.2],
  SUBP: [X, -30.05, 0.4],
  SUB: [5.0, -30.05, 3.5],
};
const EDGES = [['OUT', 'STAIR'], ['STAIR', 'DOOR'], ['DOOR', 'HOLE'], ['HOLE', 'ASC'], ['ASC', 'ASC_TOP'], ['GFOOT', 'QPASS'], ['QPASS', 'QSTEP'], ['QSTEP', 'QC'],
  ['ASC_TOP', 'GFOOT'], ['GFOOT', 'GAL'], ['GAL', 'GAL_HI'], ['GAL_HI', 'STEP'], ['STEP', 'ANTE'], ['ANTE', 'KC'], ['HOLE', 'DESC_BOT'], ['DESC_BOT', 'SUBP'], ['SUBP', 'SUB']];
// where each walk spot (SPOTS in data.js) joins the graph, and the node inside each room
export const SPOT_NODE = { outside: 'OUT', entrance: 'DOOR', subterranean: 'SUB', queen: 'QC', gallery: 'GAL', king: 'KC' };
export const ROOM_NODE = { descending: 'HOLE', ascending: 'ASC', subterranean: 'SUB', queen: 'QC', gallery: 'GAL_HI', antechamber: 'ANTE', king: 'KC' };

export function route(from, to) {
  const prev = { [from]: null }, q = [from];
  while (q.length) {
    const a = q.shift();
    if (a === to) break;
    for (const [u, v] of EDGES) for (const [p, n] of [[u, v], [v, u]]) if (p === a && !(n in prev)) { prev[n] = a; q.push(n); }
  }
  const out = [];
  for (let n = to; n; n = prev[n]) out.unshift(n);
  return out;
}

// In the page: walk toward the waypoints from index i on, a frame of 1/30 s at a time.
// Returns when all are reached, when the climb prompt shows and the next waypoint is above
// (the test then presses Space), or when the walker makes no headway.
export function walkInPage({ pts, i, maxSeconds }) {
  const K = window.__khufu, W = K.walker, dt = 1 / 30;
  const room = () => {
    const p = W.pos;
    for (const el of K.ELEMENTS) for (const v of el.voids) {
      const f = v.floor[0] + v.floor[1] * p.z, c = Math.min(...v.ceil.map(([a, b]) => a + b * p.z));
      if (p.x >= v.x0 && p.x <= v.x1 && p.z >= v.z0 && p.z <= v.z1 && p.y >= f - 0.6 && p.y <= c) return el.id;
    }
    return null;
  };
  const rooms = new Set();
  let best = Infinity, sinceBest = 0, frames = 0;
  W.keys = { KeyW: true, ShiftLeft: true };
  try {
    while (i < pts.length && frames < maxSeconds / dt) {
      const [x, y, z] = pts[i], p = W.pos, h = Math.hypot(x - p.x, z - p.z);
      if (h < 0.5 && Math.abs(y - p.y) < 1.5) { i++; best = Infinity; sinceBest = 0; continue; }
      // a person presses Space at the prompt when the way goes up and walking gets no further:
      // standing under the next waypoint, or held up by a ledge
      if (W.canClimb && !W.climb && y > p.y + 0.6 && (h < 1 || sinceBest > 1)) return { status: 'climb', i, rooms: [...rooms], pos: [p.x, p.y, p.z] };
      W.yaw = Math.atan2(-(x - p.x), -(z - p.z));
      W.keys.ShiftLeft = h > 3; // run along, walk the last few metres
      W.update(dt);
      frames++;
      const r = room(); if (r) rooms.add(r);
      if (h < best - 0.05) { best = h; sinceBest = 0; } else if ((sinceBest += dt) > 6) return { status: 'stuck', i, rooms: [...rooms], pos: [p.x, p.y, p.z] };
    }
    return { status: i >= pts.length ? 'arrived' : 'timeout', i, rooms: [...rooms], room: room(), pos: [W.pos.x, W.pos.y, W.pos.z] };
  } finally { W.keys = {}; }
}
