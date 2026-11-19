// Pyramid layout: block grid, interior voids, rock-cut substructure and the
// placement/excavation plan the simulation works through.
//
// Grid: N x N cells of size B, centred on the origin. Column i grows east (+x),
// row k grows south (+z). Layer L spans cells [L, N-1-L] and sits at y = L*B.
export const B = 1.25;
export const N = 17;
export const LAYERS = 9;
export const HALF = (N * B) / 2;

export const cx = (i) => -HALF + (i + 0.5) * B;
export const cz = (k) => -HALF + (k + 0.5) * B;
export const edgeX = (i) => -HALF + i * B; // west edge of column i
export const edgeZ = (k) => -HALF + k * B; // north edge of row k
export const toCol = (x) => Math.floor((x + HALF) / B);
export const toRow = (z) => Math.floor((z + HALF) / B);
export const inLayer = (L, i, k) => i >= L && k >= L && i <= N - 1 - L && k <= N - 1 - L;

const key = (L, i, k) => `${L},${i},${k}`;

// ---- Interior definition -------------------------------------------------
const voids = new Set();
const addVoid = (L, i0, i1, k0, k1) => {
  for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) voids.add(key(L, i, k));
};
// Entrance passage (north face, ground level) and antechamber
for (const L of [0, 1]) { addVoid(L, 8, 8, 0, 2); addVoid(L, 7, 9, 3, 5); }
// Opening for the descending stair, west of the antechamber
addVoid(0, 5, 6, 4, 4); addVoid(1, 5, 6, 4, 4); addVoid(0, 4, 4, 4, 4);
// Ascending stair to the upper chamber (col 8, rows 6..9)
for (const L of [0, 1, 2]) addVoid(L, 8, 8, 6, 7);
for (const L of [1, 2, 3]) addVoid(L, 8, 8, 8, 9);
// Upper (granite) burial chamber
for (const L of [2, 3]) addVoid(L, 6, 10, 10, 12);

// Stair pieces occupy otherwise void cells: [layer, col, row]
export const STAIR_PIECES = [[0, 8, 6], [0, 8, 7], [1, 8, 8], [1, 8, 9]];
export const STAIR = { z0: edgeZ(6), z1: edgeZ(10), y0: 0, y1: 2 * B };
export const stairFloor = (z) => STAIR.y0 + (STAIR.y1 - STAIR.y0) * Math.min(1, Math.max(0, (z - STAIR.z0) / (STAIR.z1 - STAIR.z0)));

// Rock-cut descending stair (row 4, going west from the antechamber)
export const DESC = { x0: edgeX(7), x1: edgeX(3), y0: 0, y1: -3 * B, row: 4 };
export const descFloor = (x) => DESC.y0 + (DESC.y1 - DESC.y0) * Math.min(1, Math.max(0, (DESC.x0 - x) / (DESC.x0 - DESC.x1)));

// Granite lining around the upper chamber
const graniteSet = new Set();
for (let i = 6; i <= 10; i++) for (let k = 10; k <= 12; k++) graniteSet.add(key(1, i, k));
for (const L of [2, 3]) for (let i = 5; i <= 11; i++) for (let k = 9; k <= 13; k++) {
  if (i === 5 || i === 11 || k === 9 || k === 13) graniteSet.add(key(L, i, k));
}
for (let i = 6; i <= 10; i++) for (let k = 10; k <= 12; k++) graniteSet.add(key(4, i, k));

// ---- Blocks ----------------------------------------------------------------
// kind: core | casing | corner | granite | cap ; material: limestone | tura | granite | gold
export function cellKind(L, i, k) {
  if (!inLayer(L, i, k) || voids.has(key(L, i, k))) return null;
  if (L === LAYERS - 1) return 'cap';
  const e = [i === L, i === N - 1 - L, k === L, k === N - 1 - L];
  const edges = e.filter(Boolean).length;
  if (edges >= 2) return 'corner';
  if (edges === 1) return 'casing';
  if (graniteSet.has(key(L, i, k))) return 'granite';
  return 'core';
}

// Rotation (about +y) of the outward-facing casing/corner geometry.
// Casing geometry faces +x; corner geometry faces +x and +z.
export function casingRot(L, i, k) {
  const w = i === L, e = i === N - 1 - L, n = k === L, s = k === N - 1 - L;
  if ((e && s)) return 0;
  if (e && n) return Math.PI / 2;
  if (w && n) return Math.PI;
  if (w && s) return -Math.PI / 2;
  if (e) return 0;
  if (n) return Math.PI / 2;
  if (w) return Math.PI;
  return -Math.PI / 2;
}

export const MATERIAL_OF = { core: 'limestone', casing: 'tura', corner: 'tura', granite: 'granite', cap: 'gold', stair: 'limestone' };

export const blocks = [];       // every block cell, index = instance slot within its kind
export const blockAt = new Map(); // key -> block
for (let L = 0; L < LAYERS; L++) {
  for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
    const kind = cellKind(L, i, k);
    if (!kind) continue;
    const b = { id: blocks.length, L, i, k, kind, material: MATERIAL_OF[kind], placed: false, rot: kind === 'casing' || kind === 'corner' ? casingRot(L, i, k) : 0 };
    blocks.push(b); blockAt.set(key(L, i, k), b);
  }
}
for (const [L, i, k] of STAIR_PIECES) {
  const b = { id: blocks.length, L, i, k, kind: 'stair', material: 'limestone', placed: false, rot: 0, stair: true };
  blocks.push(b); blockAt.set(key(L, i, k), b);
}
export const getBlock = (L, i, k) => blockAt.get(key(L, i, k));
export const isVoid = (L, i, k) => voids.has(key(L, i, k));

// ---- Substructure (rock cut) ----------------------------------------------
// Depth level d=1..3 spans y in [-d*B, -(d-1)*B].
export const rockCells = [];
const rockMap = new Map();
const addRock = (i, k, d, zone) => {
  const c = { id: rockCells.length, i, k, d, zone, state: 'rock', progress: 0 };
  rockCells.push(c); rockMap.set(`${i},${k},${d}`, c);
};
// excavation order follows the passage from the antechamber
addRock(6, 4, 1, 'stair');
addRock(5, 4, 1, 'stair'); addRock(5, 4, 2, 'stair');
for (const i of [4, 3]) for (const d of [1, 2, 3]) addRock(i, 4, d, 'stair');
// passages: each cell's upper heading (d=2) is cut first, then the bench (d=3) below it,
// so the diggers always work from full-height space
const pass = [[2, 4]]; for (let k = 5; k <= 9; k++) pass.push([2, k]); for (let i = 3; i <= 5; i++) pass.push([i, 9]);
pass.forEach(([i, k]) => { addRock(i, k, 2, 'passage'); addRock(i, k, 3, 'passage'); });
{
  // burial chamber cols 6..10 rows 7..11, dug outward from the doorway at (6,9)
  const cells = [];
  for (let i = 6; i <= 10; i++) for (let k = 7; k <= 11; k++) cells.push([i, k]);
  cells.sort((a, b) => (Math.abs(a[0] - 6) + Math.abs(a[1] - 9)) - (Math.abs(b[0] - 6) + Math.abs(b[1] - 9)));
  cells.forEach(([i, k]) => { addRock(i, k, 2, 'chamber'); addRock(i, k, 3, 'chamber'); });
}
export function digFrom(c) {
  // which open neighbour the cell is worked from: 'up' or [di, dk]
  const above = c.d > 1 && getRock(c.i, c.k, c.d - 1);
  if (above && above.state === 'dug') return 'up';
  for (const [di, dk] of [[1, 0], [0, -1], [-1, 0], [0, 1]]) {
    const n = getRock(c.i + di, c.k + dk, c.d);
    if (n && n.state === 'dug') return [di, dk];
  }
  if (c.d === 1) return 'top';
  return [1, 0];
}
export const getRock = (i, k, d) => rockMap.get(`${i},${k},${d}`);
export const isDug = (i, k, d) => { const c = getRock(i, k, d); return !!c && c.state === 'dug'; };
// a cell counts as open for rendering once digging has started on it
export const isOpenRock = (i, k, d) => { const c = getRock(i, k, d); return !!c && c.state !== 'rock'; };

// Underground route: waypoints from the antechamber to each excavation zone
export const ROUTE_IN = [
  [cx(8), 0, edgeZ(0) - 4], [cx(8), 0, cz(1)], [cx(8), 0, cz(4)], [edgeX(7) + 0.2, 0, cz(4)],
];
export function rockApproach(c) {
  // waypoints from the top of the descending stair to the face of rock cell c
  const pts = [];
  const sx = (x) => [x, descFloor(x), cz(4)];
  if (c.zone === 'stair') {
    const tx = Math.min(cx(c.i) + B * 0.9, edgeX(7) - 0.2);
    for (let x = edgeX(7) - 0.4; x > tx; x -= 0.7) pts.push(sx(x));
    pts.push(sx(tx));
    return pts;
  }
  for (let x = edgeX(7) - 0.4; x > cx(2) + 0.3; x -= 0.7) pts.push(sx(x));
  pts.push([cx(2), -3 * B, cz(4)]);
  const yb = -3 * B;
  if (c.zone === 'passage' && c.i === 2) { pts.push([cx(2), yb, cz(c.k) - B * 0.9]); return pts; }
  pts.push([cx(2), yb, cz(9)]);
  if (c.zone === 'passage') { pts.push([cx(c.i) - B * 0.9, yb, cz(9)]); return pts; }
  pts.push([cx(6) - 0.2, yb, cz(9)]);
  // inside the chamber: stand next to the cell, on the side toward the doorway
  const dx = c.i - 6, dk = c.k - 9;
  const ox = Math.abs(dx) >= Math.abs(dk) ? -Math.sign(dx || 1) * B * 0.9 : 0;
  const oz = Math.abs(dx) >= Math.abs(dk) ? 0 : -Math.sign(dk) * B * 0.9;
  pts.push([cx(c.i) + ox, yb, cz(c.k) + oz]);
  return pts;
}

// ---- Layer placement order -------------------------------------------------
// Each layer is fed from a ramp on the east face with two landing lanes (north
// and south of the ramp centre line), each served by its own setting crew.
// Blocks are set farthest-first from the landings so the push path to every
// remaining block stays clear; crews reserve their path so they never cross.
export const LANE_UP = [cz(7), cz(9)];
export const LANE_DOWN = [cz(6), cz(10)];
export const ENTRY_ROWS = [7, 9];
export const layerEastEdge = (L) => HALF - L * B;

export const obstacles = new Set(); // "L,i,k" cells blocked by objects (e.g. the sarcophagus)
export const supportSolid = (L, i, k) => {
  // can a loaded sled travel over cell (i,k) at the base of layer L?
  if (!inLayer(L, i, k) || obstacles.has(`${L},${i},${k}`)) return false;
  const own = getBlock(L, i, k);
  if (L === 0) {
    if (!own || own.stair) return false;
    return !getRock(i, k, 1) || needsDeck(0, i, k);
  }
  const below = getBlock(L - 1, i, k);
  if (below) return !below.stair;
  return needsDeck(L, i, k);
};

// Cells set over an open space (chamber, passage, trench) are carried on timber
// decking (centering) while the course is laid; the deck sits just under the block.
export function needsDeck(L, i, k) {
  const own = getBlock(L, i, k);
  if (!own || own.stair) return false;
  if (L === 0) return !!getRock(i, k, 1);
  return !getBlock(L - 1, i, k);
}
export const deckCells = blocks.filter((b) => needsDeck(b.L, b.i, b.k));

export function layerPlan(L, sides = [1, -1]) {
  const dist = new Map();
  const q = [];
  const srcs = L === LAYERS - 1 ? [[8, 8]] : ENTRY_ROWS.flatMap((r) => sides.map((s) => [s > 0 ? N - 1 - L : L, r]));
  for (const [i, r] of srcs) { dist.set(`${i},${r}`, 0); q.push([i, r]); }
  while (q.length) {
    const [i, k] = q.shift();
    const d = dist.get(`${i},${k}`);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nk = k + dk, nkey = `${ni},${nk}`;
      if (dist.has(nkey) || !inLayer(L, ni, nk)) continue;
      dist.set(nkey, d + 1);
      if (supportSolid(L, ni, nk)) q.push([ni, nk]);
    }
  }
  const list = [];
  for (const b of blocks) {
    if (b.L !== L) continue;
    const d = dist.get(`${b.i},${b.k}`);
    if (d === undefined) { console.warn('unreachable block', b.L, b.i, b.k); continue; }
    b.dist = d; list.push(b);
  }
  // farthest first; stairs before same-distance blocks; roughly alternate north/south
  list.sort((a, b) => b.dist - a.dist || (b.kind === 'stair') - (a.kind === 'stair') || a.k - b.k);
  return list;
}

// Cell path on layer L from a landing entry cell to the cell next to the target,
// through free cells. Returns null when blocked, [] when the target is the entry.
export function pushPath(L, target, entryRow, blockedSet, side = 1) {
  const e = side > 0 ? N - 1 - L : L;
  if (L === LAYERS - 1) return [];
  const entry = [e, entryRow];
  if (target.i === entry[0] && target.k === entry[1]) return [];
  const free = (i, k) => supportSolid(L, i, k) && !(getBlock(L, i, k)?.placed) && !(blockedSet && blockedSet.has(`${i},${k}`));
  if (!free(entry[0], entry[1])) return null;
  const start = `${entry[0]},${entry[1]}`;
  const prev = new Map([[start, null]]);
  const q = [entry];
  let found = null;
  while (q.length && !found) {
    const [i, k] = q.shift();
    for (const [di, dk] of [[-1, 0], [0, 1], [0, -1], [1, 0]]) {
      const ni = i + di, nk = k + dk, nk2 = `${ni},${nk}`;
      if (ni === target.i && nk === target.k) { found = [i, k]; break; }
      if (prev.has(nk2) || !inLayer(L, ni, nk) || !free(ni, nk)) continue;
      prev.set(nk2, [i, k]); q.push([ni, nk]);
    }
  }
  if (!found) return null;
  const cells = [];
  let cur = found;
  while (cur) { cells.unshift(cur); cur = prev.get(`${cur[0]},${cur[1]}`); }
  return cells;
}

// ---- Solid query for first-person movement ---------------------------------
// Returns merged solid intervals [[y0,y1],...] for the column at (x,z), ignoring
// terrain outside the footprint (handled by the world).
export function casingTop(b, x, z) {
  const lx = x - edgeX(b.i), lz = z - edgeZ(b.k);
  const dOut = [];
  const L = b.L;
  if (b.i === L) dOut.push(lx); if (b.i === N - 1 - L) dOut.push(B - lx);
  if (b.k === L) dOut.push(lz); if (b.k === N - 1 - L) dOut.push(B - lz);
  if (b.kind === 'cap') return L * B + Math.min(...dOut) * 1.0;
  return L * B + Math.min(B, Math.min(...dOut));
}

export function columnSolids(x, z) {
  const i = toCol(x), k = toRow(z);
  const out = [];
  if (i < 0 || k < 0 || i >= N || k >= N) return null;
  // bedrock with excavated cells removed
  let top = 0;
  const dug = [1, 2, 3].map((d) => isOpenRock(i, k, d) && getRock(i, k, d).state === 'dug');
  if (dug[2]) { out.push([-99, -3 * B]); }
  else if (dug[1]) { out.push([-99, -2 * B]); }
  else if (dug[0]) { out.push([-99, -B]); }
  else out.push([-99, 0]);
  if (!dug[2] && dug[1]) { /* d2 dug, d3 rock already included */ }
  if (dug[2] && !dug[1]) out.push([-2 * B, -B]);
  if ((dug[2] || dug[1]) && !dug[0]) out.push([-B, 0]);
  if (k === DESC.row && i >= 3 && i <= 6) {
    const f = descFloor(x);
    if (getRock(i, k, 1)?.state === 'dug') out.push([-99, f]);
  }
  for (let L = 0; L < LAYERS; L++) {
    const b = getBlock(L, i, k);
    if (!b || !b.placed) continue;
    if (b.stair) out.push([L * B, Math.max(L * B + 0.01, stairFloor(z))]);
    else if (b.kind === 'casing' || b.kind === 'corner' || b.kind === 'cap') out.push([L * B, casingTop(b, x, z)]);
    else out.push([L * B, (L + 1) * B]);
  }
  void top;
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of out) {
    const m = merged[merged.length - 1];
    if (m && s[0] <= m[1] + 1e-4) m[1] = Math.max(m[1], s[1]); else merged.push([s[0], s[1]]);
  }
  return merged;
}

export const TOTAL_BLOCKS = blocks.length;
export const TOTAL_ROCK = rockCells.length;
