// The course being laid at the timeline's current time, block by block: one instanced box
// per block already set (or being levered into place), on top of the finished courses.
// Everything else stays surfaces (monument.js); this is only ever one course, up to about
// 37,000 blocks at the base.
//
// Which blocks are in place comes straight from the event model: each sector sets its Giza
// and Tura lists farthest-first, so the first gSet[s] / tSet[s] of them are set and the ones
// up to gClaim[s] / tClaim[s] are being set (see courseLayout() and viewState() in sim/view.js).
import * as THREE from 'three';

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
    if (layout) this.ensure(layout.cells.length + layout.heavy.length / 3);
  }

  // course: view.course from the worker (null when no course is being laid)
  update(course) {
    const L = this.layout;
    if (!course || !L || course.ci !== L.ci) { if (this.mesh) this.mesh.count = 0; this.count = 0; this.sig = ''; return; }
    // nothing set or claimed since the last update (playing slowly): keep the instances
    let a = 0, b = 0;
    for (let s = 0; s < L.sectors; s++) { a += course.gSet[s] + course.tSet[s]; b += course.gClaim[s] + course.tClaim[s]; }
    const sig = `${L.ci}:${a}:${b}:${course.heavyState.join('')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const M = this.mesh.instanceMatrix.array, Cc = this.mesh.instanceColor.array;
    const { n, cell, hw, y0, h, cells, type, off } = L;
    const sx = cell * 0.985, sy = h * 0.995, y = y0 + h / 2;
    let k = 0;
    const put = (x, z, col, i) => {
      const v = 0.94 + (((i * 2654435761) >>> 0) % 1000) / 1000 * 0.08; // each stone a little different
      const o = k * 16;
      M[o] = sx; M[o + 1] = 0; M[o + 2] = 0; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = sx; M[o + 11] = 0;
      M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
      Cc[k * 3] = col.r * v; Cc[k * 3 + 1] = col.g * v; Cc[k * 3 + 2] = col.b * v;
      k++;
    };
    const run = (start, set, claim) => {
      for (let j = 0; j < claim; j++) {
        const i = cells[start + j], tp = type[start + j];
        put(-hw + ((i % n) + 0.5) * cell, -hw + (((i / n) | 0) + 0.5) * cell,
          j >= set ? C.setting : tp === CASING ? C.casing : tp === DRESSED ? C.dressed : C.core, i);
      }
    };
    for (let s = 0; s < L.sectors; s++) {
      run(off[2 * s], course.gSet[s], course.gClaim[s]);
      run(off[2 * s + 1], course.tSet[s], course.tClaim[s]);
    }
    for (let j = 0; j < course.heavyState.length; j++) {
      if (course.heavyState[j] !== 2) continue;
      put(L.heavy[3 * j], L.heavy[3 * j + 1], L.heavy[3 * j + 2] ? C.granite : C.beam, j);
    }
    this.mesh.count = k; this.count = k;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }

  setXray(on) {
    this.xray = on;
    const m = this.mat;
    m.transparent = on; m.opacity = on ? 0.16 : 1; m.depthWrite = !on; m.needsUpdate = true;
    if (this.mesh) this.mesh.castShadow = !on;
  }
}
