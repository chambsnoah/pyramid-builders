// The special works that are not stones of a course (Phase 5), drawn from the schedule in
// sim/works.js at the timeline's time:
//  - the rock face at the end of the tunnel while the descending passage and the subterranean
//    chamber are being cut, with the tunnellers: diggers kneeling at the face and spoil
//    carriers walking up and down the cut (the room linings themselves are cut at the face
//    by Rooms.setReveal);
//  - the three granite plugs: lowered into the foot of the Grand Gallery, resting there, and
//    slid down into the ascending passage at the end of the build. They are not drawn while
//    walking, so the ascending passage can still be walked as before.
// Everything is a pure function of the time, so seeking or playing at any speed shows the
// same thing.
import * as THREE from 'three';
import { tunnelAt, diggersAt, plugsAt, MAX_DIGGERS, DIG, FIG_S, PLUGS, PLUG_SIZE } from './sim/works.js';
import { farFigureGeometry } from './bubble.js';
import { TX } from './textures.js';

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E3 = new THREE.Euler(0, 0, 0, 'YXZ'), V = new THREE.Vector3(), SC = new THREE.Vector3();

export class SpecialWorks {
  constructor(scene) {
    this.W = null;
    this.group = new THREE.Group(); this.group.name = 'special-works';
    scene.add(this.group);
    // the working face: a quad across the end of the cut
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: TX.rock.map, normalMap: TX.rock.normalMap, roughness: 0.95, side: THREE.DoubleSide }));
    this.face.name = 'tunnel-face'; this.face.visible = false;
    this.group.add(this.face);
    this.diggers = new THREE.InstancedMesh(farFigureGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), MAX_DIGGERS);
    this.diggers.name = 'tunnellers'; this.diggers.count = 0; this.diggers.frustumCulled = false;
    this.group.add(this.diggers);
    this.plugs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: TX.granite.map, normalMap: TX.granite.normalMap, roughness: 0.45, color: 0xc9a59b }), PLUGS.length);
    this.plugs.name = 'plugs'; this.plugs.count = 0; this.plugs.frustumCulled = false; this.plugs.castShadow = true;
    this.group.add(this.plugs);
    this.dig = new Float32Array(MAX_DIGGERS * DIG);
    this.plug = new Float32Array(PLUGS.length * 5);
    this.info = { stage: -1, diggers: 0, plugs: 0 };
  }

  setSchedule(W) { this.W = W; }

  // t: the timeline's time; walking: the walker is on (plugs hidden); cam: the camera (the
  // tunnellers are only placed when it is within 300 m of the face)
  update(t, walking = false, cam = null) {
    const W = this.W;
    if (!W) return;
    const tn = tunnelAt(W, t);
    // the face
    const f = tn.face;
    this.face.visible = !!f;
    if (f) { this.face.position.set((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, f.z); this.face.scale.set(f.x1 - f.x0, f.y1 - f.y0, 1); }
    // the tunnellers: kneeling diggers swing their picks, carriers stoop under their baskets
    let n = 0;
    if (f && (!cam || Math.hypot(cam.position.x - f.x0, cam.position.y - f.y0, cam.position.z - f.z) < 300)) {
      diggersAt(W, t, this.dig);
      for (let i = 0; i < MAX_DIGGERS; i++) {
        const o = i * DIG, d = this.dig;
        if (d[o + 4] === 2) continue;
        // (the lean and the kneel come from the schedule: low enough for the roof over him)
        E3.set(d[o + 5], d[o + 3], 0); Q.setFromEuler(E3);
        M4.compose(V.set(d[o], d[o + 1] - d[o + 6], d[o + 2]), Q, SC.setScalar(FIG_S));
        this.diggers.setMatrixAt(n++, M4);
      }
    }
    this.diggers.count = n; this.diggers.instanceMatrix.needsUpdate = true;
    // the plugs
    let k = 0;
    if (!walking) {
      plugsAt(W, t, this.plug);
      for (let j = 0; j < PLUGS.length; j++) {
        const o = j * 5;
        if (!this.plug[o + 4]) continue;
        E3.set(-this.plug[o + 3], 0, 0); Q.setFromEuler(E3);
        M4.compose(V.set(this.plug[o], this.plug[o + 1], this.plug[o + 2]), Q, SC.set(PLUG_SIZE[0], PLUG_SIZE[1], PLUGS[j].len));
        this.plugs.setMatrixAt(k++, M4);
      }
    }
    this.plugs.count = k; this.plugs.instanceMatrix.needsUpdate = true;
    this.info = { stage: tn.stage, diggers: n, plugs: k };
    return tn;
  }
}
