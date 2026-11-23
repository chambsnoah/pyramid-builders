// Articulated workers drawn with one InstancedMesh per body part; poses are solved
// with simple forward kinematics every frame. Walk cycles advance with the distance
// actually travelled, so feet do not skate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GEO, MAT } from './assets.js';
import { random } from './core.js';

const HIP_H = 0.9, THIGH = 0.44, SHIN = 0.44, UARM = 0.29, FARM = 0.27, STRIDE = 1.5;

function limb(r0, r1, len) { return new THREE.CylinderGeometry(r0, r1, len, 7).translate(0, -len / 2, 0); }
function partGeometries() {
  const torso = new THREE.CylinderGeometry(0.185, 0.14, 0.52, 9).scale(1, 1, 0.62).translate(0, 0.26, 0);
  const chest = new THREE.SphereGeometry(0.16, 9, 6).scale(1.15, 0.7, 0.72).translate(0, 0.44, 0.01);
  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6).translate(0, 0.56, 0);
  const shin = mergeGeometries([limb(0.055, 0.042, SHIN).toNonIndexed(), new THREE.BoxGeometry(0.085, 0.05, 0.22).translate(0, -SHIN - 0.0, 0.05).toNonIndexed()]);
  const farm = mergeGeometries([limb(0.042, 0.034, FARM - 0.04).toNonIndexed(), new THREE.SphereGeometry(0.045, 6, 5).translate(0, -FARM + 0.02, 0).toNonIndexed()]);
  return {
    torso: mergeGeometries([torso.toNonIndexed(), chest.toNonIndexed(), neck.toNonIndexed()]),
    head: new THREE.SphereGeometry(0.105, 10, 8).scale(0.92, 1.05, 1).translate(0, 0.13, 0.01),
    hair: new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.15, -0.012),
    kilt: new THREE.CylinderGeometry(0.17, 0.25, 0.4, 10, 1, true).translate(0, -0.15, 0),
    thigh: limb(0.075, 0.058, THIGH),
    shin,
    uarm: limb(0.052, 0.044, UARM),
    farm,
  };
}

const ITEM_TYPES = ['basket', 'jar', 'crate', 'beam', 'mallet', 'pick', 'hoe', 'bread', 'waterjar'];

export class Crowd {
  // opts.ropes / opts.poles: how many rope and pole segments can be drawn at once
  constructor(scene, max = 160, opts = {}) {
    this.max = max;
    this.workers = [];
    const g = partGeometries();
    const skin = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
    const parts = {
      torso: [g.torso, skin, 1], head: [g.head, skin, 1], hair: [g.hair, new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 }), 1],
      kilt: [g.kilt, MAT.linen, 1], thigh: [g.thigh, skin, 2], shin: [g.shin, skin, 2], uarm: [g.uarm, skin, 2], farm: [g.farm, skin, 2],
    };
    this.parts = {};
    for (const [name, [geo, mat, mult]] of Object.entries(parts)) {
      const im = new THREE.InstancedMesh(geo, mat, max * mult);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      im.count = 0;
      this.parts[name] = im; scene.add(im);
    }
    const itemGeo = {
      basket: [GEO.basket, MAT.reed], jar: [GEO.jar, MAT.clay], waterjar: [GEO.jar, MAT.clay], crate: [GEO.crate, MAT.darkWood],
      beam: [GEO.beam, MAT.wood], mallet: [GEO.mallet, MAT.darkWood], pick: [GEO.pick, MAT.copper], hoe: [GEO.hoe, MAT.darkWood],
      bread: [GEO.basket, MAT.bread],
    };
    this.items = {};
    for (const t of ITEM_TYPES) {
      const im = new THREE.InstancedMesh(itemGeo[t][0], itemGeo[t][1], max);
      im.castShadow = true; im.frustumCulled = false; im.count = 0;
      this.items[t] = im; scene.add(im);
    }
    // straight segments: ropes and lever poles
    this.ropes = new THREE.InstancedMesh(GEO.rope, MAT.rope, opts.ropes ?? 600);
    this.ropes.frustumCulled = false; this.ropes.castShadow = true; this.ropes.count = 0;
    this.poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.05, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2), MAT.darkWood, opts.poles ?? 200);
    this.poles.frustumCulled = false; this.poles.castShadow = true; this.poles.count = 0;
    scene.add(this.ropes, this.poles);
    this.segRope = []; this.segPole = [];
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3();
  }

  add(opts = {}) {
    const n = this.workers.length;
    const tone = 0.55 + ((n * 37) % 17) / 60;
    const w = {
      id: n, pos: new THREE.Vector3(), yaw: 0, pose: 'idle', item: null, walkPhase: random() * 6, act: random() * 6,
      actRate: 1, lastPos: null, speed: 0, visible: true, ang: null, color: new THREE.Color(0.86 * tone + 0.12, 0.6 * tone + 0.08, 0.42 * tone + 0.04),
      handL: new THREE.Vector3(), handR: new THREE.Vector3(), shoulder: new THREE.Vector3(), lookPitch: 0, itemTilt: 0, ...opts,
    };
    this.workers.push(w);
    return w;
  }

  segment(kind, a, b) { (kind === 'rope' ? this.segRope : this.segPole).push(a.clone(), b.clone()); }

  // A worker with `dist` set (metres walked, and `spd` in m/s) is driven from outside, e.g. by
  // a model that knows where everyone is at any time: its walk cycle follows that distance
  // exactly instead of the movement since the last frame, so it never depends on frame history.
  update(dt) {
    for (const w of this.workers) {
      if (w.dist != null) {
        const stride = w.pose === 'pull' || w.pose === 'push' ? STRIDE * 0.62 : STRIDE;
        w.walkPhase = (w.dist / stride) * Math.PI * 2;
        w.speed = w.spd || 0;
        w.act += dt * w.actRate;
        continue;
      }
      if (!w.lastPos) w.lastPos = w.pos.clone();
      const d = Math.hypot(w.pos.x - w.lastPos.x, w.pos.z - w.lastPos.z);
      w.speed = dt > 0 ? THREE.MathUtils.lerp(w.speed, d / dt, Math.min(1, dt * 8)) : w.speed;
      const stride = w.pose === 'pull' || w.pose === 'push' ? STRIDE * 0.62 : STRIDE;
      w.walkPhase += (d / stride) * Math.PI * 2;
      w.act += dt * w.actRate;
      w.lastPos.copy(w.pos);
    }
  }

  // ---- pose solving -------------------------------------------------------
  targetAngles(w) {
    const walking = Math.min(1, w.speed / 0.5);
    const ph = w.walkPhase, s = Math.sin(ph), c = Math.cos(ph);
    const a = {
      lean: 0.04, sway: 0, head: 0, bob: 0,
      aL: [0, 0.08, 0.15], aR: [0, -0.08, 0.15], lL: [0, 0], lR: [0, 0],
    };
    const legAmp = (w.pose === 'pull' || w.pose === 'push') ? 0.36 : 0.42;
    a.lL = [legAmp * s * walking, (0.1 + 0.75 * Math.max(0, c)) * walking];
    a.lR = [-legAmp * s * walking, (0.1 + 0.75 * Math.max(0, -c)) * walking];
    a.bob = -0.035 * Math.abs(s) * walking;
    a.aL = [-0.38 * s * walking, 0.08, 0.25 + 0.2 * walking];
    a.aR = [0.38 * s * walking, -0.08, 0.25 + 0.2 * walking];
    const t = w.act;
    switch (w.pose) {
      case 'pull': // rope over the shoulder, hands gripping at the chest, leaning hard
        a.lean = 0.42 + 0.04 * Math.sin(ph * 2); a.head = -0.25;
        a.aL = [1.25, 0.15, 1.75]; a.aR = [1.05, -0.15, 1.85];
        if (walking < 0.2) { a.lL = [0.35, 0.25]; a.lR = [-0.3, 0.05]; }
        break;
      case 'push':
        a.lean = 0.55; a.head = -0.35;
        a.aL = [1.45, 0.12, 0.35]; a.aR = [1.45, -0.12, 0.35];
        if (walking < 0.2) { a.lL = [0.45, 0.35]; a.lR = [-0.35, 0.05]; }
        break;
      case 'lever': { // bear down on a lever pole in a slow rhythm
        const k = 0.5 + 0.5 * Math.sin(t * 2.4);
        a.lean = 0.25 + 0.4 * k; a.head = -0.2;
        a.aL = [1.0 - 0.35 * k, 0.1, 0.4]; a.aR = [1.0 - 0.35 * k, -0.1, 0.4];
        a.lL = [0.25, 0.2 + 0.25 * k]; a.lR = [-0.2, 0.1 + 0.25 * k]; a.bob = -0.08 * k;
        break;
      }
      case 'chisel': { // mallet in the right hand striking a chisel held in the left
        const k = Math.pow(0.5 + 0.5 * Math.sin(t * 5), 2);
        a.lean = 0.3; a.head = -0.3;
        a.aL = [0.95, 0.25, 0.6]; a.aR = [0.6 + 1.6 * k, -0.15, 0.6 + 0.9 * k];
        a.lL = [0.3, 0.35]; a.lR = [-0.1, 0.35]; a.bob = -0.08;
        break;
      }
      case 'pick': { // two-handed swing of a copper-tipped pick
        const k = Math.pow(0.5 + 0.5 * Math.sin(t * 3.2), 1.5);
        a.lean = 0.15 + 0.45 * (1 - k); a.head = -0.2;
        a.aL = [0.7 + 2.0 * k, 0.12, 0.3 + 0.6 * k]; a.aR = [0.7 + 2.0 * k, -0.12, 0.3 + 0.6 * k];
        a.lL = [0.3, 0.3]; a.lR = [-0.25, 0.15]; a.bob = -0.06;
        break;
      }
      case 'hoe': {
        const k = 0.5 + 0.5 * Math.sin(t * 3);
        a.lean = 0.45 + 0.15 * k; a.head = -0.3;
        a.aL = [0.6 + 0.9 * k, 0.1, 0.5]; a.aR = [0.6 + 0.9 * k, -0.1, 0.6];
        if (walking < 0.2) { a.lL = [0.3, 0.3]; a.lR = [-0.25, 0.2]; }
        break;
      }
      case 'carryHead': // basket/crate balanced on the head, steadied by both hands
        a.aL = [2.75, 0.35, 0.9]; a.aR = [2.75, -0.35, 0.9]; a.lean = 0.02;
        break;
      case 'carryShoulder': // jar or beam on the left shoulder
        a.aL = [2.6, 0.5, 2.1]; a.lean = 0.05; a.sway = 0.06;
        break;
      case 'carryFront': // heavy item held at the belly with both arms
        a.aL = [0.7, 0.1, 1.2]; a.aR = [0.7, -0.1, 1.2]; a.lean = -0.08;
        break;
      case 'pour': { // tip a water jar in front of the sled runners
        const k = 0.5 + 0.5 * Math.sin(t * 1.7);
        a.lean = 0.35 + 0.15 * k; a.head = -0.4;
        a.aL = [1.1 + 0.2 * k, 0.15, 0.7]; a.aR = [0.9 + 0.2 * k, -0.15, 0.5];
        w.itemTilt = 0.6 + 0.9 * k;
        break;
      }
      case 'dump': { // tip a basket out
        const k = Math.min(1, (t % 2.4) / 1.2);
        a.lean = 0.3 + 0.3 * k; a.aL = [1.2 + 0.4 * k, 0.15, 0.9]; a.aR = [1.2 + 0.4 * k, -0.15, 0.9];
        w.itemTilt = 1.6 * k;
        break;
      }
      case 'kneel':
        a.lean = 0.35; a.lL = [1.5, 1.6]; a.lR = [0.1, 2.0]; a.bob = -0.42; a.aL = [0.8, 0.1, 0.8]; a.aR = [0.9 + 0.3 * Math.sin(t * 2), -0.1, 0.9];
        break;
      case 'rest':
        a.lean = -0.02; a.aL = [0.1, 0.2, 0.3]; a.aR = [-0.1, -0.2, 0.2]; a.head = 0.05 * Math.sin(t * 0.4);
        break;
      case 'point': // overseer gesturing
        a.aR = [1.4 + 0.15 * Math.sin(t * 1.3), -0.4, 0.2]; a.head = -0.05;
        break;
      default: break;
    }
    return a;
  }

  solve(w, dt) {
    const tgt = this.targetAngles(w);
    if (!w.ang) w.ang = JSON.parse(JSON.stringify(tgt));
    const k = Math.min(1, dt * 10);
    const L = (o, t) => { for (const key in t) { if (Array.isArray(t[key])) t[key].forEach((v, i) => { o[key][i] += (v - o[key][i]) * k; }); else o[key] += (t[key] - o[key]) * k; } };
    // walk-cycle legs track exactly so the stride keeps pace with movement
    const legs = [tgt.lL, tgt.lR];
    L(w.ang, tgt);
    if (w.speed > 0.3) { w.ang.lL = legs[0].slice(); w.ang.lR = legs[1].slice(); }
    return w.ang;
  }

  render(dt) {
    const m = this._m, P = this.parts;
    const T = new THREE.Matrix4(), R = new THREE.Matrix4();
    const root = new THREE.Matrix4(), pelvis = new THREE.Matrix4(), torso = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    let n = 0;
    const itemCount = Object.fromEntries(ITEM_TYPES.map((t) => [t, 0]));
    const put = (name, idx, mat, color) => { P[name].setMatrixAt(idx, mat); if (color) P[name].setColorAt(idx, color); };
    for (const w of this.workers) {
      if (!w.visible) continue;
      const a = this.solve(w, dt);
      root.makeRotationY(w.yaw).setPosition(w.pos);
      pelvis.copy(root).multiply(T.makeTranslation(0, HIP_H + a.bob, 0));
      put('kilt', n, pelvis, null);
      torso.copy(pelvis).multiply(R.makeRotationX(a.lean)).multiply(tmp.makeRotationZ(a.sway));
      put('torso', n, torso, w.color);
      const head = tmp.copy(torso).multiply(T.makeTranslation(0, 0.53, 0)).multiply(R.makeRotationX(a.head)).clone();
      put('head', n, head, w.color); put('hair', n, head, null);
      const hands = [];
      [[-1, a.aL], [1, a.aR]].forEach(([side, arm], j) => {
        const sh = torso.clone().multiply(T.makeTranslation(side * 0.2, 0.47, 0))
          .multiply(R.makeRotationX(-arm[0])).multiply(tmp.makeRotationZ(-side * Math.abs(arm[1])));
        put('uarm', n * 2 + j, sh, w.color);
        const el = sh.clone().multiply(T.makeTranslation(0, -UARM, 0)).multiply(R.makeRotationX(-arm[2]));
        put('farm', n * 2 + j, el, w.color);
        hands.push(new THREE.Vector3(0, -FARM + 0.02, 0).applyMatrix4(el));
      });
      w.handL.copy(hands[0]); w.handR.copy(hands[1]);
      w.shoulder.set(-0.2, 0.5, 0).applyMatrix4(torso);
      [[-1, a.lL], [1, a.lR]].forEach(([side, leg], j) => {
        const hip = pelvis.clone().multiply(T.makeTranslation(side * 0.1, 0, 0)).multiply(R.makeRotationX(-leg[0]));
        put('thigh', n * 2 + j, hip, w.color);
        const knee = hip.multiply(T.makeTranslation(0, -THIGH, 0)).multiply(R.makeRotationX(leg[1]));
        put('shin', n * 2 + j, knee, w.color);
      });
      // carried / held item
      if (w.item && this.items[w.item]) {
        const it = this.items[w.item];
        let im;
        if (w.pose === 'carryHead') im = head.clone().multiply(T.makeTranslation(0, 0.24, 0));
        else if (w.pose === 'carryShoulder') {
          im = torso.clone().multiply(T.makeTranslation(-0.2, 0.6, 0.02));
          if (w.item === 'beam') im.multiply(R.makeRotationY(0.0));
          else im.multiply(R.makeRotationZ(0.5)).multiply(T.makeTranslation(0, -0.08, 0));
        } else if (w.pose === 'pour' || w.pose === 'dump' || w.pose === 'carryFront') {
          const mid = w.handL.clone().add(w.handR).multiplyScalar(0.5);
          im = new THREE.Matrix4().makeRotationY(w.yaw).multiply(R.makeRotationX(w.pose === 'carryFront' ? 0 : w.itemTilt)).setPosition(mid);
          im.multiply(T.makeTranslation(0, w.pose === 'carryFront' ? -0.15 : -0.2, 0.05));
        } else if (w.item === 'mallet' || w.item === 'pick' || w.item === 'hoe') {
          const hold = w.item === 'mallet' ? w.handR : w.handL.clone().add(w.handR).multiplyScalar(0.5);
          // tool shaft points out of the fist along the forearm direction
          const elR = new THREE.Vector3(0, 0, 0);
          im = new THREE.Matrix4().makeRotationY(w.yaw).multiply(R.makeRotationX(Math.PI / 2 - (a.aR[0] - a.aR[2] * 0.5))).setPosition(hold);
          void elR;
        } else {
          // default: held at the side in the right hand
          im = new THREE.Matrix4().makeRotationY(w.yaw).setPosition(w.handR).multiply(T.makeTranslation(0, -0.35, 0));
        }
        it.setMatrixAt(itemCount[w.item]++, im);
      }
      n++;
    }
    for (const name in P) {
      const mult = ['thigh', 'shin', 'uarm', 'farm'].includes(name) ? 2 : 1;
      P[name].count = n * mult;
      P[name].instanceMatrix.needsUpdate = true;
      if (P[name].instanceColor) P[name].instanceColor.needsUpdate = true;
    }
    for (const t of ITEM_TYPES) { this.items[t].count = itemCount[t]; this.items[t].instanceMatrix.needsUpdate = true; }
  }

  // draw the ropes and lever poles queued since the last flush (after render() has placed the hands)
  flush() {
    this.flushSegments(this.ropes, this.segRope, 1);
    this.flushSegments(this.poles, this.segPole, 1);
    this.segRope.length = 0; this.segPole.length = 0;
  }

  flushSegments(im, segs) {
    const m = this._m, dir = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const Z = new THREE.Vector3(0, 0, 1);
    let c = 0;
    for (let i = 0; i + 1 < segs.length && c < im.instanceMatrix.count; i += 2) {
      dir.subVectors(segs[i + 1], segs[i]);
      const len = dir.length();
      if (len < 1e-4) continue;
      q.setFromUnitVectors(Z, dir.divideScalar(len));
      m.compose(segs[i], q, s.set(1, 1, len));
      im.setMatrixAt(c++, m);
    }
    im.count = c; im.instanceMatrix.needsUpdate = true;
  }
}
