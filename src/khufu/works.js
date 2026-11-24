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
import { tunnelAt, diggersAt, plugsAt, MAX_DIGGERS, PLUGS, PLUG_SIZE } from './sim/works.js';
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
    this.dig = new Float32Array(MAX_DIGGERS * 5);
    this.plug = new Float32Array(PLUGS.length * 5);
    this.info = { stage: -1, diggers: 0, plugs: 0 };
  }

  setSchedule(W) { this.W = W; }

  // t: the timeline's time; walking: the walker is on (plugs hidden)
  update(t, walking = false) {
    const W = this.W;
    if (!W) return;
    const tn = tunnelAt(W, t);
    // the face
    const f = tn.face;
    this.face.visible = !!f;
    if (f) { this.face.position.set((f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2, f.z); this.face.scale.set(f.x1 - f.x0, f.y1 - f.y0, 1); }
    // the tunnellers: kneeling diggers swing their picks, carriers stoop under the low roof
    let n = 0;
    if (f) {
      diggersAt(W, t, this.dig);
      for (let i = 0; i < MAX_DIGGERS; i++) {
        const o = i * 5, pose = this.dig[o + 4];
        if (pose === 2) continue;
        const kneel = pose === 0, lean = kneel ? 0.35 + 0.3 * Math.max(0, Math.sin(t * 2.6 + i * 1.7)) : 0.45;
        E3.set(lean, this.dig[o + 3], 0); Q.setFromEuler(E3);
        M4.compose(V.set(this.dig[o], this.dig[o + 1] - (kneel ? 0.45 : 0.1), this.dig[o + 2]), Q, SC.set(0.9, 0.9, 0.9));
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
