// River traffic and the harbour: boats, berths and anchorage, the stone yard,
// stevedores who lever stone ashore, porters who carry goods to the store.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Path, wait, until, walk, turnTo, lerpAngle, v3, yawTo } from './core.js';
import { SITE, WATER_Y } from './world.js';
import { GEO, MAT } from './assets.js';

// ---- boat model ------------------------------------------------------------
function hullGeometry(len, beam) {
  const nu = 28, nv = 12, pos = [], idx = [];
  for (let a = 0; a <= nu; a++) {
    const u = -1 + (2 * a) / nu;
    const w = (beam / 2) * Math.pow(Math.max(0, 1 - u * u), 0.55);
    const top = 0.55 + 1.5 * Math.pow(Math.abs(u), 6);
    const bot = -0.55 * Math.pow(Math.max(0, 1 - u * u), 0.7) + 0.35 * Math.pow(Math.abs(u), 4);
    for (let b = 0; b <= nv; b++) {
      const v = (b / nv) * Math.PI;
      pos.push(-w * Math.cos(v), top - (top - bot) * Math.sin(v), (u * len) / 2);
    }
  }
  for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
    const i = a * (nv + 1) + b;
    idx.push(i, i + nv + 1, i + 1, i + 1, i + nv + 1, i + nv + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const hullMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3c, roughness: 0.8, side: THREE.DoubleSide });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0x2f5f86, roughness: 0.7 });

export class Boat {
  constructor(scene, kind) {
    this.kind = kind; // 'barge' | 'cargo'
    const len = kind === 'barge' ? 17 : 12, beam = kind === 'barge' ? 4.6 : 3.4;
    this.len = len; this.beam = beam;
    this.group = new THREE.Group();
    const hull = new THREE.Mesh(hullGeometry(len, beam), hullMat);
    hull.castShadow = true; hull.receiveShadow = true;
    this.group.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.84, 0.08, len * 0.7), MAT.wood);
    deck.position.y = 0.3; deck.receiveShadow = true; this.group.add(deck);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.9, 0.12, len * 0.6), stripeMat);
    stripe.position.y = 0.5; stripe.scale.set(1.01, 1, 1); this.group.add(stripe);
    stripe.visible = false;
    // stern cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(beam * 0.5, 1.3, 1.8), MAT.reed);
    cabin.position.set(0, 0.95, -len * 0.32); cabin.castShadow = true; this.group.add(cabin);
    // mast, yard and sail
    this.mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 9, 6), MAT.darkWood);
    this.mast.position.set(0, 4.8, len * 0.08); this.mast.castShadow = true; this.group.add(this.mast);
    this.sail = new THREE.Mesh(new THREE.PlaneGeometry(beam * 1.5, 6.2, 4, 4), MAT.linen);
    this.sail.position.set(0, 5.4, len * 0.08 + 0.15); this.sail.castShadow = true; this.group.add(this.sail);
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, beam * 1.6, 5), MAT.darkWood);
    yard.rotation.z = Math.PI / 2; yard.position.set(0, 8.5, len * 0.08 + 0.12); this.group.add(yard);
    this.yard = yard;
    // steering oars at the stern
    for (const s of [-1, 1]) {
      const so = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 4.2, 5), MAT.darkWood);
      so.position.set(s * beam * 0.35, 0.6, -len * 0.42); so.rotation.set(-1.0, 0, s * 0.2); this.group.add(so);
    }
    // rowing oars
    this.oars = [];
    const oarGeo = mergeGeometries([new THREE.CylinderGeometry(0.035, 0.035, 3.4, 5).translate(0, -1.7, 0).toNonIndexed(), new THREE.BoxGeometry(0.04, 0.6, 0.22).translate(0, -3.3, 0).toNonIndexed()]);
    const nOar = kind === 'barge' ? 5 : 3;
    for (let i = 0; i < nOar; i++) for (const s of [-1, 1]) {
      const o = new THREE.Mesh(oarGeo, MAT.darkWood);
      o.position.set(s * beam * 0.44, 0.75, -len * 0.18 + i * 1.5);
      o.userData = { side: s, i }; this.group.add(o); this.oars.push(o);
    }
    this.cargo = []; // {type, mesh, local: Vector3, block?}
    this.speed = 0;
    this.rowing = 0;
    this.visible = false;
    this.group.visible = false;
    scene.add(this.group);
  }
  deckPoint(local) { return local.clone().applyMatrix4(this.group.matrixWorld); }
  slots() {
    const out = [];
    if (this.kind === 'barge') {
      for (const z of [-3.6, -1.2, 1.2, 3.6]) for (const x of [-0.9, 0.9]) out.push(v3(x, 0.34, z));
    } else {
      for (const z of [-3.2, -2.2, -1.2, -0.2, 0.8, 1.8, 2.8, 3.8]) for (const x of [-0.8, 0, 0.8]) out.push(v3(x, 0.34, z));
    }
    return out;
  }
  animate(t, dt) {
    this.rowing = THREE.MathUtils.lerp(this.rowing, this.speed > 0.2 ? 1 : 0, Math.min(1, dt * 2));
    for (const o of this.oars) {
      const ph = t * 2.2 + o.userData.i * 0.05;
      const sweep = Math.sin(ph) * 0.5 * this.rowing;
      const lift = (Math.cos(ph) * 0.15 + 0.15) * this.rowing;
      o.rotation.set(sweep, 0, o.userData.side * (1.1 - lift + (1 - this.rowing) * 0.35));
    }
    const sailing = this.sailing ? 1 : 0;
    this.sail.scale.y = THREE.MathUtils.lerp(this.sail.scale.y, sailing ? 1 : 0.06, Math.min(1, dt));
    this.sail.position.y = 8.45 - 3.1 * this.sail.scale.y;
    // gentle bobbing on the water
    this.group.position.y = WATER_Y - 0.15 + Math.sin(t * 1.3 + this.len) * 0.03;
    this.group.rotation.z = Math.sin(t * 0.9 + this.len) * 0.012;
  }
}

// ---- cargo meshes on deck --------------------------------------------------
const CARGO_MESH = {
  mortar: () => new THREE.Mesh(GEO.jar, MAT.whiteJar),
  beer: () => new THREE.Mesh(GEO.jar, MAT.clay),
  food: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(GEO.basket, MAT.reed)); g.add(new THREE.Mesh(GEO.basketFill, MAT.bread)); return g; },
  tools: () => new THREE.Mesh(GEO.crate, MAT.darkWood),
  timber: () => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(GEO.beam, MAT.wood); b.position.set((i - 1) * 0.2, 0, 0); g.add(b); } return g; },
  goods: () => new THREE.Mesh(GEO.chest, MAT.paint),
  statue: () => new THREE.Mesh(GEO.statue, MAT.gold),
};
// carry style for porters: [item mesh on the worker, pose]
export const CARRY = {
  mortar: ['jar', 'carryShoulder'], beer: ['jar', 'carryShoulder'], food: ['bread', 'carryHead'], tools: ['crate', 'carryHead'],
  timber: ['beam', 'carryShoulder'], goods: ['crate', 'carryHead'], statue: ['crate', 'carryHead'],
};

// ---- harbour ---------------------------------------------------------------
export class Harbour {
  constructor(sim) {
    this.sim = sim;
    this.boats = [];
    this.berths = SITE.berths.map((b) => ({ ...b, boat: null }));
    this.anchor = { x: 72, z: -3 };
    // stone yard slots (4 x 5)
    this.slots = [];
    for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) {
      this.slots.push({ x: 42.0 + b * 2.6, z: -27 + a * 3.6, item: null, reserved: false });
    }
    this.goodsQueue = []; // {boat, cargo}
    this.blockQueue = [];
    this.manifestLog = [];
  }

  freeSlot() { return this.slots.find((s) => !s.item && !s.reserved); }
  yardCount(material) { return this.slots.filter((s) => s.item && s.item.material === material && !s.item.claimed).length; }

  // send a boat with a manifest: [{type, n}]
  dispatchBoat(kind, manifest, from = 'south') {
    let boat = this.boats.find((b) => b.kind === kind && !b.busy);
    if (!boat) { boat = new Boat(this.sim.scene, kind); this.boats.push(boat); }
    boat.busy = true;
    for (const m of manifest) this.sim.inTransit[m.type] = (this.sim.inTransit[m.type] || 0) + m.n;
    this.sim.sched.spawn(this.boatTrip(boat, manifest, from), 'boat');
    return boat;
  }

  *boatTrip(boat, manifest, from) {
    const sim = this.sim;
    // load deck
    const slots = boat.slots();
    let si = 0;
    for (const m of manifest) {
      for (let n = 0; n < m.n; n++) {
        const local = slots[si++ % slots.length].clone();
        let mesh;
        const isStone = ['tura', 'granite', 'cap', 'sarcophagus'].includes(m.type);
        if (isStone) mesh = sim.makeStoneMesh(m.type);
        else mesh = CARGO_MESH[m.type]();
        if (m.type === 'sarcophagus') local.set(0, 0.34, 0);
        mesh.position.copy(local); mesh.rotation.y = m.type === 'sarcophagus' ? Math.PI / 2 : 0;
        mesh.traverse((o) => { o.castShadow = true; });
        boat.group.add(mesh);
        boat.cargo.push({ type: m.type, mesh, local, stone: isStone });
      }
    }
    const rz = from === 'south' ? 320 : -320;
    const sgn = from === 'south' ? 1 : -1;
    boat.sailing = from === 'north'; // heading upstream (south) uses the north wind
    const riverX = 120 + sgn * 7;
    boat.group.position.set(riverX, WATER_Y, rz);
    boat.group.rotation.y = from === 'south' ? Math.PI : 0;
    boat.group.visible = true;
    yield* this.sail(boat, new Path([v3(riverX, 0, rz), v3(riverX, 0, rz * 0.4), v3(riverX, 0, sgn * 40)]), 4.2, 2.0);
    // wait at anchor in the river if both berths are taken
    if (!this.berths.some((b) => !b.boat)) {
      boat.sailing = false;
      yield* this.sail(boat, new Path([boat.group.position.clone(), v3(riverX + sgn * 2, 0, sgn * 34)]), 1.2, 0.0);
      boat.anchored = true;
      yield* until(() => this.berths.some((b) => !b.boat));
      boat.anchored = false;
    }
    const berth = this.berths.find((b) => !b.boat);
    berth.boat = boat;
    boat.sailing = false;
    const p = boat.group.position;
    const bz = berth.z, sd = berth.side; // -1: north berth, docks facing south; +1: south berth, docks facing north
    // in through the canal, a wide turn in the basin, then a straight run alongside the quay
    const swing = sd < 0
      ? [v3(84, 0, -6), v3(77, 0, -28), v3(68, 0, -38), v3(60.5, 0, -29), v3(58.8, 0, -20)]
      : [v3(84, 0, 6), v3(76, 0, 19), v3(67, 0, 25), v3(60.5, 0, 16), v3(58.8, 0, 7)];
    yield* this.sail(boat, new Path([p.clone(), v3(riverX - sgn * 4, 0, sgn * 12), v3(106, 0, 0), v3(96, 0, 0), ...swing, v3(berth.x, 0, bz)]), 3.0, 0.15);
    yield* this.settle(boat, berth.yaw, 2.5);
    boat.docked = berth;
    // unloading: queue every item
    for (const c of boat.cargo) (c.stone ? this.blockQueue : this.goodsQueue).push({ boat, cargo: c });
    yield* until(() => boat.cargo.length === 0);
    yield* wait(3);
    boat.docked = null;
    berth.boat = null;
    // leave: back out stern first along the quay, then row out through the canal's outbound lane
    const backTo = sd < 0 ? v3(62, 0, -31) : v3(62, 0, 18);
    yield* this.sail(boat, new Path([p.clone(), v3(berth.x + 0.2, 0, bz + sd * 5), backTo]), 1.2, 0.3, true);
    const outLegs = sd < 0 ? [v3(78, 0, -27), v3(92, 0, -14)] : [v3(78, 0, 14), v3(90, 0, -2), v3(94, 0, -10)];
    const out = new Path([p.clone(), ...outLegs, v3(100, 0, -12), v3(106, 0, -12), v3(riverX, 0, -12 + sgn * 25), v3(riverX, 0, rz)]);
    boat.sailing = from === 'south';
    yield* this.sail(boat, out, 4.2, 4.2);
    boat.group.visible = false;
    boat.busy = false;
  }

  // follow a path, easing speed down to endSpeed at the end
  *sail(boat, path, speed, endSpeed, astern = false) {
    let s = 0;
    const g = boat.group;
    while (s < path.length) {
      const dt = yield;
      const remain = path.length - s;
      const v = Math.max(endSpeed, 0.3, Math.min(speed, 0.35 * remain + endSpeed));
      boat.speed = v;
      s = Math.min(path.length, s + v * dt);
      const p = path.at(s);
      g.position.x = p.x; g.position.z = p.z;
      // steer toward the course a little ahead; going astern the bow points back along the path
      const ty = path.yaw(Math.min(path.length - 0.01, s + 2), 3) + (astern ? Math.PI : 0);
      g.rotation.y = lerpAngle(g.rotation.y, ty, Math.min(1, dt * (astern ? 0.6 : 1.6)));
      boat.animate(this.sim.sched.time, dt);
    }
    boat.speed = 0;
  }
  *settle(boat, yaw, dur) {
    let t = 0; const y0 = boat.group.rotation.y;
    while (t < dur) { const dt = yield; t += dt; boat.group.rotation.y = lerpAngle(y0, yaw, Math.min(1, t / dur)); boat.animate(this.sim.sched.time, dt); }
  }
  animateDocked(dt) {
    for (const b of this.boats) if (b.group.visible && (b.docked || b.anchored)) b.animate(this.sim.sched.time, dt);
  }

  // ---- dock workers ---------------------------------------------------------
  // Porter: carries jars, baskets, crates and beams from the boat to the store.
  *porterLoop(w) {
    const sim = this.sim;
    const home = w.pos.clone();
    while (true) {
      w.inJob = false;
      // lent out to another task (carrying the burial goods): stay out of the way until released
      if (w.reserved) { yield* wait(1); continue; }
      w.inJob = true;
      const job = this.goodsQueue.shift();
      if (!job) { w.pose = 'rest'; yield* walk(w, [home], 1.2, 'walk'); w.pose = 'rest'; yield* wait(1); continue; }
      const { boat, cargo } = job;
      boat.group.updateMatrixWorld();
      const wp = boat.deckPoint(cargo.local);
      const edge = v3(SITE.quayX - 0.55, 0.15, wp.z);
      yield* walk(w, [v3(SITE.quayX - 3, 0.15, wp.z), edge], 1.35, 'walk', sim.speedMul);
      yield* turnTo(w, Math.PI / 2, 0.3);
      w.pose = 'lever'; yield* wait(1.0);
      cargo.mesh.parent?.remove(cargo.mesh);
      boat.cargo.splice(boat.cargo.indexOf(cargo), 1);
      const [item, pose] = CARRY[cargo.type];
      w.item = item; w.pose = pose;
      const door = v3(SITE.store.x - SITE.store.w / 2 - 1.5, 0, SITE.store.z);
      yield* walk(w, [v3(SITE.quayX - 3, 0.15, wp.z), v3(SITE.quayX - 3, 0.15, SITE.basin.z1), door, v3(SITE.store.x - 2, 0, SITE.store.z + 1)], 1.15, pose, sim.speedMul);
      w.pose = 'lever'; yield* wait(0.8);
      w.item = null;
      sim.receive(cargo.type, 1);
      yield* walk(w, [door], 1.35, 'walk', sim.speedMul);
    }
  }

  // Stevedore gang (4 men): lever stones off the barge onto a sled and drag them to the yard.
  *stevedoreLoop(gang, sled, idx = 0) {
    const sim = this.sim;
    const home = v3(48 - idx * 4, 0, -5 + idx * 2);
    const sledHome = v3(50 - idx * 4, 0, -7.5);
    while (true) {
      const job = this.blockQueue[0];
      const big = !!job && job.cargo.type === 'sarcophagus';
      let slot = job && !big ? this.freeSlot() : null, slot2 = null;
      if (big) {
        // the sarcophagus needs two neighbouring slots in one row
        for (const a of this.slots) {
          const b = this.slots.find((x) => x !== a && Math.abs(x.z - a.z) < 0.1 && Math.abs(x.x - a.x - 2.6) < 0.1);
          if (b && !a.item && !a.reserved && !b.item && !b.reserved) { slot = a; slot2 = b; break; }
        }
      }
      if (!job || !slot) {
        for (const [n, w] of gang.entries()) if (w.pos.distanceTo(home) > 3 && !w.walking) sim.sched.spawn(walk(w, [home.clone().add(v3(n * 0.8, 0, 0))], 1.2, 'walk'));
        gang.forEach((w) => { if (!w.walking) w.pose = 'rest'; });
        yield* wait(0.5); continue;
      }
      this.blockQueue.shift();
      slot.reserved = true;
      if (slot2) slot2.reserved = true;
      const { boat, cargo } = job;
      boat.group.updateMatrixWorld();
      const wp = boat.deckPoint(cargo.local);
      // bring the sled along the quay to the stone, then turn it to face inland
      const sledAt = v3(SITE.quayX - 1.4, 0.15, wp.z);
      yield* sim.dragSled(gang, sled, [sled.pos.clone(), v3(52, 0, wp.z + 7), v3(sledAt.x, 0.15, wp.z + 4.5), sledAt], 1.5, 'empty');
      yield* sim.turnSled(sled, -Math.PI / 2, 1.2);
      const mesh = cargo.mesh;
      sim.scene.attach(mesh);
      // timber skids laid from deck to sled while two men lever, two haul
      yield* sim.leverOnto(gang, mesh, sled, sledAt, big);
      // only now is the stone off the boat, so it can't sail with men still on deck
      boat.cargo.splice(boat.cargo.indexOf(cargo), 1);
      // drag to the yard, along the lane beside the slot, then lever it sideways into place
      const sx = big ? (slot.x + slot2.x) / 2 : slot.x;
      const lane = slot.z + 1.5;
      yield* sim.dragSled(gang, sled, [sled.pos.clone(), v3(52, 0, sled.pos.z), v3(52, 0, lane), v3(sx, 0, lane)], 1.0, 'loaded');
      yield* sim.leverOff(gang, sled, v3(sx, 0, slot.z), big ? 0 : 0);
      const item = { material: cargo.type, mesh, slot, slot2 };
      slot.item = item; if (slot2) slot2.item = item;
      slot.reserved = false; if (slot2) slot2.reserved = false;
      sled.load = null;
      sim.receive(cargo.type, 1, true);
      yield* sim.dragSled(gang, sled, [sled.pos.clone(), v3(sx - 4, 0, lane), v3(41, 0, lane), v3(41, 0, -9), sledHome], 1.5, 'empty');
    }
  }
}
