// The detail bubble (Phase 4): the sled gangs of the event model, drawn at the timeline's
// time. The worker sends each gang's current trip (sim/gangs.js) when it changes; every
// frame figures(trip, t) places the sled, its stone and every member of the crew, as a pure
// function of the trip and the time. So how a gang is drawn never changes where it is:
//  - near the camera (within NEAR m, up to BUDGET people) as the articulated workers of the
//    small pyramid (src/workers.js), with ropes, water jars and levers;
//  - farther out, up to FAR m, as simple figures (one instanced mesh, leaning when they pull);
//  - every sled and stone always (two instanced meshes).
// Gangs join the bubble nearest first and leave it only beyond NEAR_OUT m, so one walking
// along the edge does not flicker between the two.
// It also draws the ramps as the gangs walk on them: the straight ramps against the middle
// of each face and the zigzag ledge above switchY, or the theory's own paths: the spiral
// ledges round the faces, or the floor of the internal ramp inside the masonry
// (rampsForDrawing() in sim/gangs.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Crowd } from '../workers.js';
import { buildTextures as buildAssetTextures, buildMaterials, buildGeometries } from '../assets.js';
import { figures, crewSpec, ACT, POSE, SLED, FIG } from './sim/gangs.js';
import { FACES } from './sim/ramps/straightZigzag.js';
import { TAN } from './data.js';
import { FIGURE } from './sim/works.js';

export const NEAR = 120, NEAR_OUT = 140, FAR = 700, BUDGET = 1500;

const CROWD_POSE = ['rest', 'pull', 'idle', 'pour', 'lever', 'push', 'kneel']; // by POSE
const STONE_COLOR = [0xe2cd9f, 0xf4ecd8, 0x9b7f78, 0xf1e6cf].map((c) => new THREE.Color(c)); // core, casing, granite, capstone
const HAULING = new Set([ACT.HAUL, ACT.WAIT, ACT.TURN]);

// a sled 1 m wide and 1 m long (scaled per gang), 0.22 m high: two runners and crossbars
function sledGeometry() {
  const parts = [];
  for (const x of [-0.42, 0.42]) parts.push(new THREE.BoxGeometry(0.12, 0.16, 1.0).translate(x, 0.08, 0));
  for (const z of [-0.4, -0.13, 0.13, 0.4]) parts.push(new THREE.BoxGeometry(1.0, 0.06, 0.12).translate(0, 0.19, z));
  // upturned nose of the runners
  for (const x of [-0.42, 0.42]) parts.push(new THREE.BoxGeometry(0.12, 0.1, 0.12).translate(x, 0.2, 0.52));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}
// a man seen from afar: body, kilt and head, 1.82 m, with vertex colours (FIGURE in sim/works.js)
export function farFigureGeometry() {
  const paint = (g, c) => { const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g.toNonIndexed(); };
  return mergeGeometries(FIGURE.map((p) => paint((p.sphere ? new THREE.SphereGeometry(...p.sphere) : new THREE.CylinderGeometry(...p.cyl)).translate(...p.at), p.color)));
}

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E3 = new THREE.Euler(0, 0, 0, 'YXZ'), V = new THREE.Vector3(), SC = new THREE.Vector3();
const A = new THREE.Vector3(), B = new THREE.Vector3();

export class Bubble {
  constructor(scene) {
    this.scene = scene;
    this.trips = []; this.bufs = []; this.acts = [];
    this.inside = new Set(); // gangs drawn as articulated workers
    this.crowd = null; // made on first use (it builds the small pyramid's textures)
    this.ramps = null; this.rampKey = null; this.visible = true;
    this.info = { gangs: 0, near: 0, workers: 0, far: 0, ms: 0 };

    this.sleds = new THREE.InstancedMesh(sledGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 }), 256);
    this.stones = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85 }), 256);
    this.stones.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(256 * 3), 3);
    this.far = new THREE.InstancedMesh(farFigureGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 3000);
    for (const m of [this.sleds, this.stones, this.far]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    this.sleds.castShadow = this.stones.castShadow = true; this.sleds.receiveShadow = this.stones.receiveShadow = true;
    this.sleds.name = 'sleds'; this.stones.name = 'stones'; this.far.name = 'far-figures';

    // mud brick and rubble, a little darker than the casing
    this.rampMat = new THREE.MeshStandardMaterial({ color: 0xd2b78c, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    this.rampMesh = null;
  }

  // gangs: the `gangs` field of a worker reply
  apply(gangs) {
    if (gangs.ramps) this.setRamps(gangs.ramps);
    for (const trip of gangs.trips) {
      const n = SLED + crewSpec(trip.kind, trip.crew).n * FIG;
      if (!this.bufs[trip.g] || this.bufs[trip.g].length !== n) this.bufs[trip.g] = new Float32Array(n);
      this.trips[trip.g] = trip;
    }
  }
  reset() { this.trips = []; this.bufs = []; this.inside.clear(); this.rampKey = null; }
  setVisible(on) {
    this.visible = on;
    for (const m of [this.sleds, this.stones, this.far]) m.visible = on;
    if (this.rampMesh) this.rampMesh.visible = on;
    if (this.crowd) for (const m of this.crowdMeshes) m.visible = on;
  }

  makeCrowd() {
    buildAssetTextures(); buildMaterials(); buildGeometries();
    const before = new Set(this.scene.children);
    this.crowd = new Crowd(this.scene, BUDGET, { ropes: 4000, poles: 600 });
    this.crowdMeshes = this.scene.children.filter((o) => !before.has(o));
    for (let i = 0; i < BUDGET; i++) this.crowd.add({ visible: false, dist: 0, spd: 0, owner: -1 });
  }

  // ---- ramps --------------------------------------------------------------------------
  setRamps(r) {
    if (r.key === this.rampKey) return;
    this.rampKey = r.key;
    if (this.rampMesh) { this.scene.remove(this.rampMesh); this.rampMesh.geometry.dispose(); this.rampMesh = null; }
    if (r.done) return;
    const pos = [];
    const P = (f, rr, u, y) => { const [n, t] = FACES[f]; return [n[0] * rr + t[0] * u, y, n[1] * rr + t[1] * u]; };
    // two triangles, wound so that they face `up` (the side a light should hit)
    const tri = (a, b, c, up) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      if (n[0] * up[0] + n[1] * up[1] + n[2] * up[2] < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
    };
    const UP = [0, 1, 0];
    const quad = (a, b, c, d, up = UP) => { tri(a, b, c, up); tri(a, c, d, up); };
    if (r.Y > 0) for (let f = 0; f < 4; f++) {
      // stations from the inner end of the 1:1 drop to the foot, with the height at each
      const st = [[r.hr - r.Y, 0], [r.hr, r.Y], [r.hr + r.plat, r.Y], [r.F, 0]];
      const sec = ([rr, a]) => [P(f, rr, -(r.w / 2 + a), -0.3), P(f, rr, -r.w / 2, a), P(f, rr, r.w / 2, a), P(f, rr, r.w / 2 + a, -0.3)];
      for (let i = 0; i < 3; i++) {
        const s0 = sec(st[i]), s1 = sec(st[i + 1]);
        for (let k = 0; k < 3; k++) quad(s0[k], s1[k], s1[k + 1], s0[k + 1]);
      }
    }
    // the zigzag (or a spiral ledge): a ledge zw wide along the path, with its outer side
    // built down to the face; the internal ramp: just its floor, a slab inside the masonry
    const ledge = (p, w, inside) => {
      for (let i = 0; i + 5 < p.length; i += 3) {
        const a = [p[i], p[i + 1], p[i + 2]], b = [p[i + 3], p[i + 4], p[i + 5]];
        const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
        if (L < 1e-6) continue;
        let px = -dz / L, pz = dx / L;
        if (px * (a[0] + b[0]) + pz * (a[2] + b[2]) < 0) { px = -px; pz = -pz; } // p points away from the pyramid's axis
        const h = w / 2, drop = inside ? 0.4 : w * TAN + 1;
        const ai = [a[0] - px * h, a[1], a[2] - pz * h], ao = [a[0] + px * h, a[1], a[2] + pz * h];
        const bi = [b[0] - px * h, b[1], b[2] - pz * h], bo = [b[0] + px * h, b[1], b[2] + pz * h];
        const ad = [ao[0], ao[1] - drop, ao[2]], bd = [bo[0], bo[1] - drop, bo[2]];
        quad(ai, bi, bo, ao);
        quad(ao, bo, bd, ad, [px, 0, pz]);
        // the ends of each flight, closed down to the face
        const L2 = [dx / L, 0, dz / L];
        tri(ai, ao, ad, [-L2[0], 0, -L2[2]]);
        tri(bi, bo, bd, L2);
      }
    };
    if (r.zig) r.zig.forEach((p) => ledge(p, r.zw, false));
    if (r.ledges) r.ledges.forEach((p) => ledge(p, r.lw, r.inside));
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    this.rampMesh = new THREE.Mesh(g, this.rampMat);
    this.rampMesh.castShadow = true; this.rampMesh.receiveShadow = true; this.rampMesh.name = 'ramps';
    this.rampMesh.visible = this.visible;
    this.scene.add(this.rampMesh);
  }

  // ---- every frame ----------------------------------------------------------------------
  // t: the timeline's time; cam: the camera (its position decides the bubble)
  update(t, cam, dt) {
    const t0 = performance.now();
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    let ns = 0, nst = 0, nfar = 0, people = 0;
    const near = [];
    const S = this.sleds, St = this.stones, F = this.far;
    for (let g = 0; g < this.trips.length; g++) {
      const trip = this.trips[g];
      if (!trip || trip.away) continue; // (a levy gang off site)
      const o = this.bufs[g];
      const tok = figures(trip, t, o);
      this.acts[g] = tok.act;
      const L = trip.load;
      // sled and stone
      E3.set(o[4], o[3], 0);
      Q.setFromEuler(E3);
      M4.compose(V.set(o[0], o[1], o[2]), Q, SC.set((L ? L[0] : 1.2) + 0.35, 1, (L ? L[2] : 1.8) + 0.8));
      S.setMatrixAt(ns++, M4);
      if (L && o[8]) {
        // the stone has its own heading (a roof beam keeps pointing across its opening while
        // the crew turn round); it never pitches off the sled's slope except on the sled
        if (o[9] !== o[3]) { E3.set(0, o[9], 0); Q.setFromEuler(E3); }
        M4.compose(V.set(o[5], o[6], o[7]), Q, SC.set(L[0], L[1], L[2]));
        St.setMatrixAt(nst, M4); St.setColorAt(nst, STONE_COLOR[L[3]]); nst++;
      }
      const d = Math.hypot(o[0] - cx, o[1] - cy, o[2] - cz);
      const n = (o.length - SLED) / FIG;
      people += n;
      if (d < (this.inside.has(g) ? NEAR_OUT : NEAR)) near.push([d, g, n]);
      else if (d < FAR) nfar = this.simpleFigures(o, n, nfar);
    }
    S.count = ns; St.count = nst;
    S.instanceMatrix.needsUpdate = true; St.instanceMatrix.needsUpdate = true; if (St.instanceColor) St.instanceColor.needsUpdate = true;

    // the bubble: nearest first, gangs already in it before others at the same distance
    near.sort((a, b) => a[0] - b[0]);
    const inside = new Set();
    let used = 0;
    for (const [, g, n] of near) {
      if (used + n > BUDGET) {
        // over the budget: drawn as simple figures instead
        nfar = this.simpleFigures(this.bufs[g], n, nfar);
        continue;
      }
      inside.add(g); used += n;
    }
    this.inside = inside;
    F.count = nfar; F.instanceMatrix.needsUpdate = true;

    if (inside.size && !this.crowd) this.makeCrowd();
    if (this.crowd) this.drawCrowd(inside, dt);
    this.info = { gangs: this.trips.filter(Boolean).length, people, near: inside.size, workers: used, far: nfar, ms: performance.now() - t0 };
  }

  // the n people of one gang (figures() output o) as simple figures from instance `at` on;
  // returns the next free instance. One transform whatever the reason a gang is drawn this way.
  simpleFigures(o, n, at) {
    const F = this.far;
    for (let j = 0; j < n && at < F.instanceMatrix.count; j++) {
      const f = SLED + j * FIG, pose = o[f + 4];
      const lean = pose === POSE.PULL ? 0.42 : pose === POSE.PUSH ? 0.55 : pose === POSE.LEVER || pose === POSE.POUR ? 0.3 : 0;
      E3.set(lean, o[f + 3], 0); Q.setFromEuler(E3);
      M4.compose(V.set(o[f], o[f + 1] - (pose === POSE.KNEEL ? 0.4 : 0), o[f + 2]), Q, SC.set(1, 1, 1));
      F.setMatrixAt(at++, M4);
    }
    return at;
  }

  drawCrowd(inside, dt) {
    const W = this.crowd.workers;
    let k = 0;
    const order = [...inside].sort((a, b) => a - b);
    for (const g of order) {
      const o = this.bufs[g], trip = this.trips[g], spec = crewSpec(trip.kind, trip.crew);
      for (let j = 0; j < spec.n; j++) {
        const w = W[k++], f = SLED + j * FIG, key = g * 1000 + j;
        if (w.owner !== key) { w.owner = key; w.ang = null; w.act = (j * 0.37) % 6; }
        w.visible = true;
        w.pos.set(o[f], o[f + 1], o[f + 2]);
        w.yaw = o[f + 3];
        const pose = o[f + 4];
        const extra = j - spec.pullers;
        w.pose = CROWD_POSE[pose] || 'idle';
        w.item = extra >= 0 && extra < spec.pourers ? 'waterjar' : null;
        w.dist = o[f + 5]; w.spd = o[f + 6];
      }
    }
    for (let i = k; i < W.length; i++) if (W[i].visible) { W[i].visible = false; W[i].owner = -1; }
    this.crowd.update(dt);
    this.crowd.render(dt);
    // ropes from the sled's nose through each file of pullers, and lever poles
    k = 0;
    for (const g of order) {
      const o = this.bufs[g], trip = this.trips[g], spec = crewSpec(trip.kind, trip.crew), act = this.acts[g];
      const base = k;
      k += spec.n;
      const fx = Math.sin(o[3]), fz = Math.cos(o[3]), half = ((trip.load ? trip.load[2] : 1.8) + 0.8) / 2;
      // ropes only while the gang is on the move or standing ready to pull
      if (HAULING.has(act)) for (let j = 0; j < spec.files; j++) {
        // the nose of the sled, a little to the side of the file (left of travel is (cos, −sin))
        A.set(o[0] + fx * half + fz * spec.lat[j] * 0.5, o[1] + 0.25, o[2] + fz * half - fx * spec.lat[j] * 0.5);
        for (let r = 0; r < spec.ranks; r++) {
          const w = W[base + r * spec.files + j];
          B.copy(w.handL).add(w.handR).multiplyScalar(0.5);
          this.crowd.segment('rope', A, B);
          A.copy(B);
        }
      }
      for (let e = spec.pourers; e < spec.extra; e++) {
        const w = W[base + spec.pullers + e];
        if (w.pose !== 'lever') continue;
        B.set(o[0] - fx * half * 0.9, o[1] + 0.05, o[2] - fz * half * 0.9);
        this.crowd.segment('pole', B, A.copy(w.handL).add(w.handR).multiplyScalar(0.5));
      }
    }
    this.crowd.flush();
  }

  // where gang g's sled is now (for following it with the camera)
  // (a levy gang off site is not drawn, so it has no place to follow)
  sledAt(g, out) { const o = this.bufs[g]; return o && !this.trips[g]?.away ? out.set(o[0], o[1], o[2]) : null; }
  // the working gang nearest to p (or any gang if none is working)
  nearestGang(p) {
    let best = -1, bd = Infinity;
    for (let pass = 0; pass < 2 && best < 0; pass++) {
      for (let g = 0; g < this.trips.length; g++) {
        const o = this.bufs[g];
        if (!o || this.trips[g]?.away || (pass === 0 && (this.acts[g] === ACT.IDLE || this.acts[g] === undefined))) continue;
        const d = Math.hypot(o[0] - p.x, o[2] - p.z);
        if (d < bd) { bd = d; best = g; }
      }
    }
    return best;
  }
}
