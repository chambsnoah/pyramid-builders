// Walking collision as columns, like the small pyramid's fps.js: for a point (x, z),
// the list of solid intervals [y0, y1] stacked above it. At Khufu's size there is no grid
// of cells; instead the column is worked out on demand: the masonry or ground up to its
// surface, minus every void whose rectangle covers the point, plus every solid (benches,
// rock, stair). Voids and solids are found through a sparse hash of 4 m cells.
import { ELEMENTS, STAIR_SOLIDS, HALF, HEIGHT, surfaceHeight, groundHeight, floorY, ceilY } from './data.js';

const CELL = 4;
const key = (i, k) => i * 100003 + k;

export class Collision {
  constructor(extraSolids = []) {
    this.cells = new Map();
    this.topY = HEIGHT; // top of the built masonry (lower while the pyramid is unfinished)
    this.stair = true; // the modern access stair stands (only once the pyramid is finished)
    for (const el of ELEMENTS) for (const v of el.voids) this.index(v, 'void');
    for (const el of ELEMENTS) for (const s of el.solids || []) this.index(s, 'solid');
    for (const s of STAIR_SOLIDS) this.index(s, 'solid', true);
    for (const s of extraSolids) this.index(s, 'solid');
  }
  index(v, kind, stair = false) {
    const e = { v, kind, stair };
    for (let i = Math.floor(v.x0 / CELL); i <= Math.floor(v.x1 / CELL); i++) {
      for (let k = Math.floor(v.z0 / CELL); k <= Math.floor(v.z1 / CELL); k++) {
        const kk = key(i, k);
        if (!this.cells.has(kk)) this.cells.set(kk, []);
        this.cells.get(kk).push(e);
      }
    }
  }

  // solid intervals over (x, z), sorted bottom to top: [{ y0, y1, walk }]. `walk` is false
  // for the casing, which is too steep and smooth to stand on.
  column(x, z) {
    let top, walk = true;
    if (Math.abs(x) < HALF && Math.abs(z) < HALF) {
      top = surfaceHeight(x, z);
      if (top > this.topY) top = this.topY; else walk = top < 0.05;
    } else top = groundHeight(x, z);
    let s = [{ y0: -1e6, y1: top, walk }];
    const list = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return s;
    const inside = (v) => x >= v.x0 && x <= v.x1 && z >= v.z0 && z <= v.z1;
    for (const { v, kind } of list) {
      if (kind !== 'void' || !inside(v)) continue;
      const lo = floorY(v, z), hi = ceilY(v, z);
      if (hi <= lo) continue;
      const out = [];
      for (const a of s) {
        if (a.y1 <= lo || a.y0 >= hi) { out.push(a); continue; }
        if (a.y0 < lo) out.push({ y0: a.y0, y1: lo, walk: true });
        if (a.y1 > hi) out.push({ y0: hi, y1: a.y1, walk: a.walk });
      }
      s = out;
    }
    let added = false;
    for (const { v, kind, stair } of list) {
      if (kind !== 'solid' || !inside(v) || (stair && !this.stair)) continue;
      const lo = floorY(v, z), hi = ceilY(v, z);
      if (hi > lo) { s.push({ y0: lo, y1: hi, walk: true }); added = true; }
    }
    if (!added) return s;
    s.sort((a, b) => a.y0 - b.y0);
    const m = [];
    for (const a of s) {
      const l = m[m.length - 1];
      if (l && a.y0 <= l.y1 + 1e-4) { if (a.y1 > l.y1) { l.y1 = a.y1; l.walk = a.walk; } } else m.push({ ...a });
    }
    return m;
  }
}
