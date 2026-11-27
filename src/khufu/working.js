// The course being laid at the timeline's current time, block by block: one instanced box
// per block already set (or being levered into place), on top of the finished courses.
// Everything else stays surfaces (monument.js); this is only ever one course, up to about
// 37,000 blocks at the base.
//
// Which blocks are in place comes straight from the event model: each sector sets its Giza
// and Tura lists farthest-first, so the first gSet[s] / tSet[s] of them are set and the ones
// up to gClaim[s] / tClaim[s] are being set (see courseLayout() and viewState() in sim/view.js).
import * as THREE from 'three';
import { ELEM, HV } from './sim/planner.js';
import { rampOpening, stoneEntries, stoneAt } from './sim/gangs.js';

const CASING = 2, DRESSED = 3; // cell types from sim/planner.js
const C = {
  core: new THREE.Color(0xe2cd9f), dressed: new THREE.Color(0xeadab0), casing: new THREE.Color(0xf4ecd8),
  setting: new THREE.Color(0xe9a93a), granite: new THREE.Color(0x9b7f78), beam: new THREE.Color(0xd8c49a),
};

export class WorkingCourse {
  constructor(scene) {
    this.scene = scene;
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = null;
    this.layout = null;
    this.xray = false;
    this.count = 0;
    // how far up the course being laid each room's lining stands: element id -> height
    // (see rise()); empty when no course is being laid
    this.rooms = {};
  }

  ensure(cap) {
    if (this.mesh && this.mesh.instanceMatrix.count >= cap) return;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.castShadow = !this.xray; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.name = 'working-course';
    this.scene.add(this.mesh);
  }

  setLayout(layout) {
    this.layout = layout; this.sig = '';
    if (layout) this.ensure(layout.cells.length + layout.heavy.length / HV);
  }

  // course: view.course from the worker (null when no course is being laid)
  update(course) {
    const L = this.layout;
    if (!course || !L || course.ci !== L.ci) { if (this.mesh) this.mesh.count = 0; this.count = 0; this.sig = ''; this.rooms = {}; return; }
    // nothing set or claimed since the last update (playing slowly): keep the instances
    let a = 0, b = 0;
    for (let s = 0; s < L.sectors; s++) { a += course.gSet[s] + course.tSet[s]; b += course.gClaim[s] + course.tClaim[s]; }
    const sig = `${L.ci}:${a}:${b}:${course.heavyState.join('')}:${(course.work || []).map((w) => w.join(',')).join(';')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const M = this.mesh.instanceMatrix.array, Cc = this.mesh.instanceColor.array;
    const { n, cell, hw, y0, h, cells, type, off } = L;
    const sx = cell * 0.985, sy = h * 0.995, y = y0 + h / 2;
    let k = 0;
    const put = (x, z, col, i, lx = sx, lz = sx) => {
      const v = 0.94 + (((i * 2654435761) >>> 0) % 1000) / 1000 * 0.08; // each stone a little different
      const o = k * 16;
      M[o] = lx; M[o + 1] = 0; M[o + 2] = 0; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = lz; M[o + 11] = 0;
      M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
      Cc[k * 3] = col.r * v; Cc[k * 3 + 1] = col.g * v; Cc[k * 3 + 2] = col.b * v;
      k++;
    };
    // (a stone a crew is still moving or fitting is drawn by the stones layer: setStones)
    const work = new Set((course.work || []).map(([s, k, i]) => `${s}:${k}:${i}`));
    const run = (start, claim, s, kind) => {
      for (let j = 0; j < claim; j++) {
        const i = cells[start + j], tp = type[start + j];
        if (rampOpening(L, i) || work.has(`${s}:${kind}:${j}`)) continue; // (the way in from a ramp stays open until the course is done)
        put(-hw + ((i % n) + 0.5) * cell, -hw + (((i / n) | 0) + 0.5) * cell, tp === CASING ? C.casing : tp === DRESSED ? C.dressed : C.core, i);
      }
    };
    for (let s = 0; s < L.sectors; s++) {
      run(off[2 * s], course.gClaim[s], s, 0);
      run(off[2 * s + 1], course.tClaim[s], s, 1);
    }
    // heavy items: granite lining blocks, and roof beams lying across their openings on
    // both walls (as big as the gang carried them: the span plus a bearing at each end)
    const H = L.heavy;
    for (let j = 0; j < course.heavyState.length; j++) {
      if (course.heavyState[j] !== 2) continue;
      const o = HV * j, len = H[o + 3], beam = H[o + 6] === 1, w = cell * 0.96;
      put(H[o], H[o + 1], H[o + 2] ? C.granite : C.beam, j, beam ? (H[o + 4] === 0 ? len : w) : sx, beam ? (H[o + 4] === 1 ? len : w) : sx);
    }
    this.rise(course);
    this.mesh.count = k; this.count = k;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }

  // The stones lying at the landings and those being moved to their places (stonesView() in
  // sim/view.js, from the worker), placed at time t (stoneAt() in sim/gangs.js). All of them
  // are written when the view changes (or time goes back); after that, every frame, only those
  // still moving (most lie still on their piles).
  setStones(v) {
    if (v === this.stonesView) return;
    this.stonesView = v; this.entries = v ? stoneEntries(v) : []; this.full = true;
  }
  frame(t) {
    const v = this.stonesView, E = this.entries || [];
    if (!v || t < v.t - 1e-6) { if (this.stones) this.stones.count = 0; return; }
    if (!this.stones || this.stones.instanceMatrix.count < E.length) {
      if (this.stones) { this.scene.remove(this.stones); this.stones.dispose(); }
      this.stones = new THREE.InstancedMesh(this.geo, this.mat, Math.max(64, Math.ceil(E.length * 1.5)));
      this.stones.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.stones.instanceMatrix.count * 3), 3);
      this.stones.castShadow = !this.xray; this.stones.receiveShadow = true; this.stones.frustumCulled = false; this.stones.name = 'stones';
      this.scene.add(this.stones);
      this.full = true;
    }
    const full = this.full || t < (this.stonesT ?? -Infinity);
    const M = this.stones.instanceMatrix.array, Cc = this.stones.instanceColor.array, o = this.so || (this.so = new Float32Array(8));
    const put = (k) => {
      const still = stoneAt(v, E[k], t, o), m = k * 16;
      M.fill(0, m, m + 16);
      M[m] = o[3]; M[m + 5] = o[4]; M[m + 10] = o[5]; M[m + 12] = o[0]; M[m + 13] = o[1]; M[m + 14] = o[2]; M[m + 15] = 1;
      const col = o[6] === 2 ? C.setting : o[7] === 1 ? C.casing : C.core;
      Cc[k * 3] = col.r; Cc[k * 3 + 1] = col.g; Cc[k * 3 + 2] = col.b;
      return still;
    };
    const IM = this.stones.instanceMatrix, IC = this.stones.instanceColor;
    if (full) {
      this.moving = [];
      for (let k = 0; k < E.length; k++) if (put(k) > t) this.moving.push(k);
      IM.clearUpdateRanges(); IC.clearUpdateRanges();
      IM.needsUpdate = true; IC.needsUpdate = true;
    } else if (this.moving.length) {
      // (only the stones still moving are sent again)
      IM.clearUpdateRanges(); IC.clearUpdateRanges();
      for (const k of this.moving) { IM.addUpdateRange(k * 16, 16); IC.addUpdateRange(k * 3, 3); }
      this.moving = this.moving.filter((k) => put(k) > t);
      IM.needsUpdate = true; IC.needsUpdate = true;
    }
    this.full = false; this.stonesT = t;
    this.stones.count = E.length;
  }

  // How far each room's lining has risen in the course being laid: the share of that room's
  // stones in this course already set (its dressed lining, granite blocks and beams), as a
  // height between the bed and the top of the course. Rooms.setReveal() cuts each room's
  // walls there, so a room rises stone by stone with its course instead of a course at a time.
  rise(course) {
    const L = this.layout, tot = {}, set = {};
    const add = (tag, done) => { if (!tag) return; const id = roomOf(tag); tot[id] = (tot[id] || 0) + 1; if (done) set[id] = (set[id] || 0) + 1; };
    for (let s = 0; s < L.sectors; s++) {
      for (const [a, b, n] of [[L.off[2 * s], L.off[2 * s + 1], course.gSet[s]], [L.off[2 * s + 1], L.off[2 * s + 2], course.tSet[s]]]) {
        for (let j = a; j < b; j++) add(L.elem[j], j - a < n);
      }
    }
    for (let j = 0; j < course.heavyState.length; j++) add(L.heavy[HV * j + 5], course.heavyState[j] === 2);
    const out = {};
    for (const id in tot) out[id] = L.y0 + L.h * ((set[id] || 0) / tot[id]);
    this.rooms = out;
  }

  setXray(on) {
    this.xray = on;
    const m = this.mat;
    m.transparent = on; m.opacity = on ? 0.16 : 1; m.depthWrite = !on; m.needsUpdate = true;
    if (this.mesh) this.mesh.castShadow = !on;
    if (this.stones) this.stones.castShadow = !on;
  }
}

// the room (an element of data.js, drawn as one set of meshes) that a planner tag belongs to
const roomOf = (tag) => { const id = ELEM[tag - 1]; return id === 'queen-shafts' ? 'queen' : id === 'king-shafts' ? 'king' : id; };
