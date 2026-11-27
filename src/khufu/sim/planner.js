// The build planner: what has to be laid in each course, where, and in what order.
//
// Blocks. Each course is a square grid of equal cells over its bed, one block per cell. The
// cells all have the same plan size and are as tall as the course, so thick courses have
// big blocks, as at Giza. The plan size is chosen so the whole pyramid comes to about
// TARGET blocks (2.3 million, the usual figure); see calibrateCell().
//
// Rooms. A cell that overlaps any void of ELEMENTS in its course's height is left open.
//   - Cells beside a void are its lining: dressed stone, slower to set ("dressed").
//   - Cells over a void that was open in the course below are its roof.
//   - For the special works the roof is spanning beams, one per row across the short side
//     of the opening (the King's Chamber gets nine, as built), set by heavy gangs.
//   - The lining of the granite rooms (antechamber, King's Chamber) is Aswan granite, also
//     heavy; the relieving chambers have granite beams but mostly limestone walls.
//   - Thin shafts and the plain passages have dressed limestone linings and roofs.
//
// Casing. The outer ring of cells is fine white Tura limestone, brought by boat.
//
// Sectors. A course is split into a k × k grid of sectors about SECTOR_M across, each with
// a landing and setting crews (at least 2 × 2 sectors, even where a single ramp serves the
// whole course near the top). A sector's landing is the point of it nearest the ramp head
// that serves it. Its blocks are set farthest-first from the landing, so the crews work
// back toward it and never wall themselves in.
import { COURSES, ELEMENTS, halfWidthAt, floorY, ceilY } from '../data.js';
import { ceilBreaks } from '../geom.js';

// element tags: index + 1 (0 = plain masonry)
export const ELEM = ['descending', 'subterranean', 'ascending', 'queen', 'gallery', 'antechamber', 'king', 'relieving', 'queen-shafts', 'king-shafts', 'pyramidion'];
export const tagOf = (id) => ELEM.indexOf(id) + 1;
// numbers per heavy item in courseLayout() (sim/view.js), for the page
export const HV = 7;
const CFG = {
  descending: { dress: 1.5 }, subterranean: { dress: 1 }, ascending: { dress: 1.5 },
  queen: { dress: 2, heavyRoof: true }, gallery: { dress: 3, heavyRoof: true }, // gallery lining = corbels
  antechamber: { granite: true, heavyRoof: true }, king: { granite: true, heavyRoof: true },
  relieving: { dress: 2, heavyRoof: true, roofGranite: true }, // granite floor/roof beams, mostly limestone walls
  'queen-shafts': { dress: 1.5 }, 'king-shafts': { dress: 1.5 }, pyramidion: { dress: 1 },
};
export const dressOf = (tag) => (tag ? CFG[ELEM[tag - 1]].dress ?? 1 : 1);

// cell types
export const VOID = 0, CORE = 1, CASING = 2, DRESSED = 3, COVERED = 4, HEAVY = 5;

// every void volume with its element tag and height range
const VOLS = [];
for (const el of ELEMENTS) for (const v of el.voids) {
  const shaft = v.x1 - v.x0 < 0.3; // the 20 cm air shafts
  const id = shaft ? (el.id === 'king' ? 'king-shafts' : 'queen-shafts') : el.id;
  const zs = ceilBreaks(v);
  const yMin = Math.min(floorY(v, v.z0), floorY(v, v.z1));
  const yMax = Math.max(...zs.map((z) => ceilY(v, z)));
  VOLS.push({ v, tag: tagOf(id), yMin, yMax });
}

// calls fn(cellIndex, tag) for every cell of an n × n grid (cell size `cell`, half width hw)
// that overlaps a void somewhere between heights ya and yb
function eachVoidCell(n, cell, hw, ya, yb, fn) {
  for (const { v, tag, yMin, yMax } of VOLS) {
    if (yMax <= ya || yMin >= yb) continue;
    const i0 = Math.max(0, Math.floor((v.x0 + hw) / cell)), i1 = Math.min(n - 1, Math.ceil((v.x1 + hw) / cell) - 1);
    const k0 = Math.max(0, Math.floor((v.z0 + hw) / cell)), k1 = Math.min(n - 1, Math.ceil((v.z1 + hw) / cell) - 1);
    if (i0 > i1 || k0 > k1) continue;
    const brk = ceilBreaks(v);
    for (let k = k0; k <= k1; k++) {
      const za = Math.max(v.z0, -hw + k * cell), zb = Math.min(v.z1, -hw + (k + 1) * cell);
      if (zb - za < 1e-6) continue;
      const f = Math.min(floorY(v, za), floorY(v, zb));
      let c = Math.max(ceilY(v, za), ceilY(v, zb));
      for (const z of brk) if (z > za && z < zb) c = Math.max(c, ceilY(v, z));
      if (c - f < 1e-6 || f >= yb || c <= ya) continue;
      for (let i = i0; i <= i1; i++) fn(k * n + i, tag);
    }
  }
}

export const gridN = (ci, side) => Math.max(1, Math.round((2 * halfWidthAt(COURSES[ci].y0)) / side));

// The plan size (side of the square cell) that makes the masonry courses come to `target`
// cells. The count falls as the side grows, so bisect.
export function calibrateCell(target) {
  const masonry = COURSES.filter((c) => c.kind === 'course').length;
  const total = (s) => { let t = 0; for (let ci = 0; ci < masonry; ci++) t += gridN(ci, s) ** 2; return t; };
  let lo = 0.5, hi = 3;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (total(m) > target) lo = m; else hi = m; }
  return hi;
}

// Cell types, element tags and heavy items of course ci (no sectors yet).
export function classify(ci, side, density) {
  const c = COURSES[ci];
  const hw = halfWidthAt(c.y0);
  if (c.kind === 'pyramidion') {
    const base = 2 * hw;
    return { ci, y0: c.y0, y1: c.y1, h: c.h, hw, n: 0, cell: 0, type: new Uint8Array(0), elem: new Uint8Array(0),
      heavy: [{ elem: tagOf('pyramidion'), kind: 'capstone', x: 0, z: 0, mass: ((base * base * c.h) / 3) * density.limestone, granite: false, span: base }] };
  }
  const n = gridN(ci, side), cell = (2 * hw) / n, N = n * n;
  const type = new Uint8Array(N).fill(CORE), elem = new Uint8Array(N), roof = new Uint8Array(N);
  const eps = 1e-6;
  eachVoidCell(n, cell, hw, c.y0 + eps, c.y1 - eps, (i, tag) => { type[i] = VOID; elem[i] = tag; });
  if (ci > 0) eachVoidCell(n, cell, hw, COURSES[ci - 1].y0 + eps, c.y0 - eps, (i, tag) => { if (type[i] !== VOID) roof[i] = tag; });

  const heavy = [];
  // roofs: heavy beams for the special works, dressed slabs for passages and shafts
  const groups = new Map();
  for (let i = 0; i < N; i++) {
    const tag = roof[i];
    if (!tag) continue;
    if (CFG[ELEM[tag - 1]].heavyRoof) { if (!groups.has(tag)) groups.set(tag, []); groups.get(tag).push(i); } else { type[i] = DRESSED; elem[i] = tag; }
  }
  // lining: cells next to a void of this course
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const idx = k * n + i;
    if (type[idx] !== VOID) continue;
    const tag = elem[idx], cfg = CFG[ELEM[tag - 1]];
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      const kk = k + dk, ii = i + di;
      if (kk < 0 || ii < 0 || kk >= n || ii >= n) continue;
      const j = kk * n + ii;
      if (type[j] === VOID || type[j] === HEAVY || (roof[j] && CFG[ELEM[roof[j] - 1]].heavyRoof)) continue;
      if (cfg.granite) { type[j] = HEAVY; elem[j] = tag; } else if (type[j] === CORE) { type[j] = DRESSED; elem[j] = tag; }
    }
  }
  const at = (i) => [-hw + ((i % n) + 0.5) * cell, -hw + (Math.floor(i / n) + 0.5) * cell];
  for (let i = 0; i < N; i++) if (type[i] === HEAVY) {
    const [x, z] = at(i);
    heavy.push({ elem: elem[i], kind: 'lining', x, z, mass: cell * cell * c.h * density.granite, granite: true, span: cell });
  }
  // beams across the short side of each roofed opening, one per row along the long side
  for (const [tag, cells] of groups) {
    let a = n, b = -1, d0 = n, d1 = -1;
    for (const i of cells) { const ix = i % n, iz = (i / n) | 0; a = Math.min(a, ix); b = Math.max(b, ix); d0 = Math.min(d0, iz); d1 = Math.max(d1, iz); }
    const alongX = b - a >= d1 - d0;
    const rows = new Map();
    for (const i of cells) { const r = alongX ? i % n : (i / n) | 0; if (!rows.has(r)) rows.set(r, []); rows.get(r).push(i); type[i] = COVERED; elem[i] = tag; }
    const granite = !!(CFG[ELEM[tag - 1]].granite || CFG[ELEM[tag - 1]].roofGranite);
    for (const r of [...rows.keys()].sort((p, q) => p - q)) {
      const rc = rows.get(r);
      let sx = 0, sz = 0;
      for (const i of rc) { const [x, z] = at(i); sx += x; sz += z; }
      const span = rc.length * cell;
      heavy.push({ elem: tag, kind: 'roof', x: sx / rc.length, z: sz / rc.length, span, granite, axis: alongX ? 'z' : 'x',
        mass: (span + 1.0) * cell * c.h * (granite ? density.granite : density.limestone) }); // 0.5 m bearing each end
    }
  }
  // the outer ring is Tura casing
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    if (k !== 0 && i !== 0 && k !== n - 1 && i !== n - 1) continue;
    const idx = k * n + i;
    if (type[idx] === CORE || type[idx] === DRESSED) type[idx] = CASING;
  }
  return { ci, y0: c.y0, y1: c.y1, h: c.h, hw, n, cell, type, elem, heavy };
}

// Counts for the whole pyramid (no sector order), for totals and element milestones.
export function summarize(side, density) {
  const per = [], elemTotal = new Int32Array(ELEM.length + 1);
  const T = { cells: 0, giza: 0, tura: 0, heavy: 0, granite: 0, voids: 0, covered: 0, dressed: 0, volume: 0 };
  for (let ci = 0; ci < COURSES.length; ci++) {
    const p = classify(ci, side, density);
    const r = { ci, n: p.n, giza: 0, tura: 0, heavy: p.heavy.length, granite: 0, dressed: 0 };
    for (let i = 0; i < p.type.length; i++) {
      const t = p.type[i];
      if (t === CORE || t === DRESSED) r.giza++;
      if (t === CASING) r.tura++;
      if (t === DRESSED) r.dressed++;
      if (t === VOID) T.voids++;
      if (t === COVERED) T.covered++;
      if ((t === CORE || t === DRESSED || t === CASING) && p.elem[i]) elemTotal[p.elem[i]]++;
    }
    for (const h of p.heavy) { elemTotal[h.elem]++; if (h.granite) r.granite++; }
    T.cells += p.n * p.n; T.giza += r.giza; T.tura += r.tura; T.heavy += r.heavy; T.granite += r.granite; T.dressed += r.dressed;
    T.volume += p.n * p.n * p.cell * p.cell * p.h;
    per.push(r);
  }
  T.blocks = T.giza + T.tura + T.heavy;
  return { per, elemTotal, totals: T };
}

// The full plan of course ci for a ramp layout: sectors, landings and the setting order.
export function buildPlan(ci, side, density, sectorM, layout) {
  const p = classify(ci, side, density);
  const heads = layout.routes.map((r) => r.head);
  const nearest = (x, z) => { let b = 0, bd = Infinity; heads.forEach(([hx, hz], i) => { const d = Math.hypot(hx - x, hz - z); if (d < bd - 1e-9) { bd = d; b = i; } }); return b; };
  for (const h of p.heavy) {
    h.route = nearest(h.x, h.z); h.top = Math.hypot(heads[h.route][0] - h.x, heads[h.route][1] - h.z);
    if (h.kind === 'roof') {
      // For drawing only (the model's times use h.top): a beam cannot be dragged over the
      // opening it spans, so its gang comes in along the beam's axis from the side nearer the
      // ramp head and stops with the sled clear of the opening (`stand`, reached through
      // `via`, 10 m farther out on the same line). The beam is then levered forward off the
      // sled onto its bearings on both walls (see figures() in gangs.js).
      const [hx, hz] = heads[h.route], ax = h.axis === 'x';
      const dir = (ax ? hx - h.x : hz - h.z) >= 0 ? 1 : -1;
      const off = h.span + 0.9, ux = ax ? dir : 0, uz = ax ? 0 : dir;
      h.stand = [h.x + ux * off, h.z + uz * off];
      h.via = [h.x + ux * (off + 10), h.z + uz * (off + 10)];
    }
  }
  if (!p.n) return { ...p, k: 0, sectors: [] };
  const { n, cell, hw, type } = p;
  // at least 2 × 2 sectors while there is room, so the small top courses still have four
  // landings and their crews (served from one ramp head or several)
  const k = n < 4 ? 1 : Math.max(2, Math.round((2 * hw) / sectorM)), ss = (2 * hw) / k;
  const sectors = [];
  for (let sz = 0; sz < k; sz++) for (let sx = 0; sx < k; sx++) {
    const x0 = -hw + sx * ss, x1 = x0 + ss, z0 = -hw + sz * ss, z1 = z0 + ss;
    const route = nearest((x0 + x1) / 2, (z0 + z1) / 2);
    const [hx, hz] = heads[route];
    const landing = [Math.min(x1, Math.max(x0, hx)), Math.min(z1, Math.max(z0, hz))];
    sectors.push({ id: sectors.length, x0, x1, z0, z1, route, landing, top: Math.hypot(landing[0] - hx, landing[1] - hz), giza: [], tura: [] });
  }
  for (let i = 0; i < n * n; i++) {
    const t = type[i];
    if (t !== CORE && t !== DRESSED && t !== CASING) continue;
    const ix = i % n, iz = (i / n) | 0;
    const s = sectors[Math.floor((iz * k) / n) * k + Math.floor((ix * k) / n)];
    (t === CASING ? s.tura : s.giza).push(i);
  }
  for (const s of sectors) {
    for (const key of ['giza', 'tura']) {
      const list = s[key];
      const d = list.map((i) => Math.hypot(-hw + ((i % n) + 0.5) * cell - s.landing[0], -hw + (((i / n) | 0) + 0.5) * cell - s.landing[1]));
      const order = list.map((_, j) => j).sort((a, b) => d[b] - d[a] || list[a] - list[b]); // farthest first
      s[key] = Int32Array.from(order, (j) => list[j]);
      s[key + 'D'] = Float32Array.from(order, (j) => d[j]);
    }
  }
  return { ...p, k, sectors };
}
