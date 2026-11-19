// Simulation director: stocks, sleds, shared handling motions (hauling, levering),
// dispatch of blocks to haul teams and the overall phase of the project.
import * as THREE from 'three';
import { Path, Scheduler, Stocks, wait, until, walk, all, turnTo, lerpAngle, v3, yawTo } from './core.js';
import {
  B, HALF, LAYERS, cx, cz, blocks, layerPlan, rockCells, getBlock, obstacles, deckCells, needsDeck, LANE_UP, LANE_DOWN, ENTRY_ROWS, N,
} from './plan.js';
import { GEO, MAT } from './assets.js';
import { rampProfile, RAMP_LANDING } from './pyramid.js';
import { Harbour } from './boats.js';
import { SITE } from './world.js';
import * as Crews from './crews.js';
import { attachNav, indexWorkers } from './nav.js';

export const SLED_DECK = 0.2;

export class Sled {
  constructor(scene) {
    this.group = new THREE.Group();
    const m = new THREE.Mesh(GEO.sled, MAT.wood);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.load = null;
  }
  sync() { this.group.position.copy(this.pos); this.group.rotation.set(this.pitch, this.yaw, 0); }
  // front hitch point in world space
  hitch(out = new THREE.Vector3()) { return out.set(0, 0.2, 0.8).applyEuler(this.group.rotation).add(this.pos); }
}

export class Sim {
  constructor({ scene, pyramid, crowd }) {
    this.scene = scene; this.pyramid = pyramid; this.crowd = crowd;
    this.sched = new Scheduler();
    this.stocks = new Stocks({ mortar: 12, food: 260, tools: 30, timber: 6, goods: 0, statue: 0, beer: 4, water: 60, landingMortar: 2 });
    this.received = {};
    this.inTransit = {};
    this.harbour = new Harbour(this);
    this.ropeBindings = new Set();
    this.leverBindings = new Set();
    this.yardLoadRequests = [];
    this.quarryLoadRequests = [];
    this.layer = 0;
    this.rampH = 0;   // east ramp
    this.rampHW = 0;  // west ramp (stops rising for the last two courses)
    this.westRetired = false;
    this.rampTarget = 0;
    this.phase = 'levelling';
    this.levelProgress = 0;
    this.placedCount = 0;
    this.totalBlocks = blocks.length;
    this.dugCount = 0;
    this.log = [];
    this.seq = 0;
    this.nextAscend = 0;
    this.queue = [];      // targets waiting for dispatch, in order
    this.plannedLayers = -1;
    this.layerRemaining = new Array(LAYERS).fill(0);
    this.speedMul = () => (this.stocks.get('food') > 0 ? 1 : 0.65);
    this.events = [];
    this.history = [];
    this.goodsPlaced = 0;
    this.sarcophagus = { kind: 'sarcophagus', L: 2, i: 6, k: 11, material: 'sarcophagus', placed: false, rot: Math.PI / 2, special: true }; // west end of the chamber
    this.capRequested = false;
    Crews.setup(this);
    attachNav(this);
    this.drags = new Set(); // sled teams currently hauling, for keeping teams apart
  }

  note(msg) {
    this.events.push({ t: this.sched.time, msg }); if (this.events.length > 6) this.events.shift();
    this.history.push({ t: this.sched.time, msg }); // full log, used by the guided tour
  }

  // ---- stocks -------------------------------------------------------------
  receive(type, n, yard = false) {
    this.inTransit[type] = Math.max(0, (this.inTransit[type] || 0) - n);
    this.received[type] = (this.received[type] || 0) + n;
    if (!yard) {
      const unit = { food: 30, mortar: 1, tools: 20, timber: 1, beer: 1, goods: 1, statue: 1 }[type] || 1;
      this.stocks.add(type === 'beer' ? 'food' : type, type === 'beer' ? 12 : n * unit);
    }
  }

  makeStoneMesh(type) {
    if (type === 'sarcophagus') { const m = new THREE.Mesh(GEO.sarcophagus, MAT.granite); m.castShadow = true; return m; }
    const kind = type === 'granite' ? 'granite' : type === 'cap' ? 'cap' : 'core';
    const m = new THREE.Mesh(kind === 'core' ? GEO.core : GEO[kind], type === 'tura' ? MAT.tura : type === 'granite' ? MAT.granite : type === 'cap' ? MAT.gold : MAT.limestone);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // ---- ramp helpers -------------------------------------------------------
  rampHeight(side = 1) { return side < 0 ? this.rampHW : this.rampH; }
  ramp(side = 1) { return rampProfile(this.rampHeight(side)); }
  landingStop(lane, ranks) {
    const { xTop } = this.ramp();
    const s = lane < 2 ? 1 : -1;
    return v3(s * (xTop + RAMP_LANDING - 0.6 + Math.max(0, ranks * 0.95 - 3.6)), this.rampHeight(s), LANE_UP[lane % 2]);
  }
  rampY(x) {
    const side = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const H = this.rampHeight(side); if (H <= 0) return 0;
    const { xLand, xFoot } = this.ramp(side);
    if (x <= xLand) return H;
    if (x >= xFoot) return 0;
    return H * (xFoot - x) / (xFoot - xLand);
  }
  // waypoints up (or down) a lane between ground point and the top (either ramp: sign of x)
  lanePoints(z, fromX, toX) {
    const sg = Math.sign(fromX + toX) || 1;
    const a = Math.abs(fromX), b = Math.abs(toX);
    const { xLand, xFoot } = this.ramp(sg);
    const xs = [a];
    for (const x of [xFoot, xLand]) if ((x - a) * (x - b) < 0) xs.push(x);
    xs.push(b);
    xs.sort((p, q) => (a > b ? q - p : p - q));
    return xs.map((x) => v3(sg * x, this.rampY(sg * x), z));
  }

  // ---- shared handling motions --------------------------------------------
  formation(path, s, j, lead = 1.55) {
    const r = Math.floor(j / 2), side = j % 2 ? 1 : -1;
    const along = s + lead + r * 0.95;
    const p = path.at(along);
    const yaw = path.yaw(along, 0.5);
    const lat = side * 0.33;
    p.x += Math.cos(yaw) * lat; p.z -= Math.sin(yaw) * lat;
    return { p, yaw };
  }

  placeSled(sled, path, s) {
    path.at(s, sled.pos);
    sled.yaw = lerpAngle(sled.yaw, path.yaw(s, 0.55), 0.35);
    const a = path.at(s - 0.6), b = path.at(s + 0.6);
    sled.pitch = -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    sled.sync();
  }

  // Haulers line up ahead of the sled on the rope, then drag it along the path.
  *dragSled(gang, sled, pts, speed, mode, pourer = null) {
    const path = pts instanceof Path ? pts : new Path(pts);
    if (path.length < 0.05) return;
    // fall in
    const fallIn = gang.map((w, j) => {
      const f = this.formation(path, 0, j);
      return (function* () { yield* walk(w, [f.p], 1.4, 'walk'); yield* turnTo(w, f.yaw, 0.3); })();
    });
    if (pourer) { // the water carrier walks to his place beside the runners too
      const f = this.formation(path, 0, 0, 0.9), yaw = path.yaw(0.9);
      f.p.x += Math.cos(yaw) * 0.55; f.p.z -= Math.sin(yaw) * 0.55;
      fallIn.push(walk(pourer, [f.p], 1.4, 'walk'));
    }
    yield* all(fallIn);
    const binds = gang.map((w) => ({ w, sled }));
    binds.forEach((b) => this.ropeBindings.add(b));
    const loaded = mode === 'loaded';
    let s = 0;
    gang.forEach((w) => { w.pose = loaded ? 'pull' : 'walk'; });
    if (pourer) { pourer.item = 'waterjar'; }
    // register so other teams can keep their distance; the lowest-numbered team has right of way
    const me = { rank: gang[0].id, tail: sled.pos.clone(), head: sled.pos.clone(), dir: new THREE.Vector3(), moving: true, ground: true };
    this.drags.add(me);
    let held = 0;
    try {
    while (s < path.length) {
      const dt = yield;
      const a = path.at(s), b = path.at(s + 1);
      me.dir.subVectors(b, a).setY(0).normalize();
      me.ground = a.y < 0.2;
      if (me.ground && held < 8 && this.teamAhead(me, this.formation(path, s + 1.2, gang.length - 1).p)) {
        held += dt; me.moving = false;
        gang.forEach((w) => { w.pose = 'rest'; });
        continue;
      }
      if (!me.moving) { me.moving = true; gang.forEach((w) => { w.pose = loaded ? 'pull' : 'walk'; }); }
      if (held >= 8) held = 0; // waited long enough: squeeze past rather than block for good
      const climb = b.y - a.y > 0.05 ? 0.75 : 1;
      let wet = 1;
      if (pourer && loaded) {
        if (this.teamWater(pourer, dt)) pourer.pose = 'pour'; else { wet = 0.7; pourer.pose = 'walk'; }
      } else if (pourer) pourer.pose = 'walk';
      s = Math.min(path.length, s + speed * climb * wet * this.speedMul() * dt);
      this.placeSled(sled, path, s);
      gang.forEach((w, j) => {
        const f = this.formation(path, s, j);
        w.pos.copy(f.p); w.yaw = lerpAngle(w.yaw, f.yaw, Math.min(1, dt * 6));
      });
      if (pourer) {
        const f = this.formation(path, s, 0, 0.9);
        const yaw = path.yaw(s + 0.9);
        f.p.x += Math.cos(yaw) * 0.55; f.p.z -= Math.sin(yaw) * 0.55;
        pourer.pos.copy(f.p); pourer.yaw = lerpAngle(pourer.yaw, yaw - 0.6, Math.min(1, dt * 5));
      }
      me.tail.copy(sled.pos); me.head.copy(gang[gang.length - 1].pos);
    }
    } finally { this.drags.delete(me); }
    binds.forEach((b) => this.ropeBindings.delete(b));
    gang.forEach((w) => { w.pose = 'idle'; });
    if (pourer) { pourer.pose = 'idle'; }
  }

  // is another hauling team in the way just ahead of `point`?
  teamAhead(me, point) {
    const seg = new THREE.Vector3(), rel = new THREE.Vector3();
    for (const o of this.drags) {
      if (o === me || !o.ground) continue;
      seg.subVectors(o.head, o.tail);
      const len2 = Math.max(1e-6, seg.lengthSq());
      const t = Math.max(0, Math.min(1, rel.subVectors(point, o.tail).dot(seg) / len2));
      const dx = o.tail.x + seg.x * t - point.x, dz = o.tail.z + seg.z * t - point.z;
      if (dx * dx + dz * dz > 1.3 * 1.3) continue;
      const sameWay = me.dir.dot(o.dir) > 0.3;
      if (sameWay || (o.moving && o.rank < me.rank)) return true; // follow behind, or give way
    }
    return false;
  }

  teamWater(pourer, dt) {
    pourer.water = (pourer.water ?? 10) - dt * 0.12;
    return pourer.water > 0;
  }

  *turnSled(sled, yaw, dur = 1.2) {
    let t = 0; const y0 = sled.yaw;
    while (t < dur) { t += yield; sled.yaw = lerpAngle(y0, yaw, Math.min(1, t / dur)); sled.pitch *= 0.9; sled.sync(); }
  }

  // Two men with levers ease a stone from where it lies onto a sled (others steady it with a rope).
  *leverOnto(gang, mesh, sled, sledAt, big = false, loadYaw = 0) {
    sled.pos.copy(sledAt); sled.pitch = 0; sled.sync();
    sled.group.updateMatrixWorld(true);
    const start = mesh.position.clone(), q0 = mesh.quaternion.clone();
    const deck = new THREE.Vector3(0, SLED_DECK, 0).applyMatrix4(sled.group.matrixWorld);
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sled.yaw + loadYaw, 0));
    const dir = deck.clone().sub(start).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const levers = gang.slice(0, 2), pullers = gang.length >= 4 ? gang.slice(2, 4) : [];
    const behind = start.clone().addScaledVector(dir, -1.35);
    yield* all([
      ...levers.map((w, j) => walk(w, [behind.clone().addScaledVector(side, j ? 0.55 : -0.55)], 1.3, 'walk')),
      ...pullers.map((w, j) => walk(w, [deck.clone().addScaledVector(dir, 2.4).addScaledVector(side, j ? 0.45 : -0.45).setY(sledAt.y)], 1.3, 'walk')),
    ]);
    levers.forEach((w) => { w.yaw = Math.atan2(dir.x, dir.z); w.pose = 'lever'; });
    pullers.forEach((w) => { w.yaw = Math.atan2(-dir.x, -dir.z); w.pose = 'pull'; });
    const lb = levers.map((w, j) => ({ w, end: () => mesh.position.clone().addScaledVector(dir, -0.5).addScaledVector(side, j ? 0.4 : -0.4).setY(mesh.position.y + 0.05) }));
    lb.forEach((b) => this.leverBindings.add(b));
    const rb = pullers.map((w) => ({ w, point: () => mesh.position.clone().setY(mesh.position.y + 0.5) }));
    rb.forEach((b) => this.ropeBindings.add(b));
    const dur = big ? 8 : 4.5;
    let t = 0;
    while (t < dur) {
      const dt = yield; t += dt;
      // the stone advances in lever strokes
      const k = Math.min(1, t / dur);
      const stroke = (k * 6 - Math.floor(k * 6));
      const e = (Math.floor(k * 6) + Math.min(1, stroke * 1.6)) / 6;
      mesh.position.lerpVectors(start, deck, Math.min(1, e));
      mesh.position.y = THREE.MathUtils.lerp(start.y, deck.y, Math.min(1, e * 1.4)) + Math.sin(Math.min(1, e) * Math.PI) * 0.12;
      mesh.quaternion.slerpQuaternions(q0, q1, Math.min(1, e));
      levers.forEach((w) => { w.pos.copy(behind).addScaledVector(side, w === levers[0] ? -0.55 : 0.55).addScaledVector(dir, Math.min(1, e) * Math.max(0, deck.distanceTo(start) - 1.6)); w.pos.y = THREE.MathUtils.lerp(start.y, sledAt.y, Math.min(1, e)); });
    }
    lb.forEach((b) => this.leverBindings.delete(b));
    rb.forEach((b) => this.ropeBindings.delete(b));
    sled.group.attach(mesh);
    mesh.position.set(0, SLED_DECK, 0);
    mesh.rotation.set(0, loadYaw, 0);
    sled.load = mesh;
    gang.forEach((w) => { w.pose = 'idle'; });
  }

  // Lever a stone forward off the sled onto its resting place.
  *leverOff(gang, sled, target, worldYaw, dur = 4.5, standAt = null) {
    const mesh = sled.load;
    if (!mesh) return;
    this.scene.attach(mesh);
    sled.load = null;
    const start = mesh.position.clone(), q0 = mesh.quaternion.clone();
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, worldYaw, 0));
    const dir = target.clone().sub(start).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(Math.sin(sled.yaw), 0, Math.cos(sled.yaw));
    dir.normalize();
    const levers = gang.slice(0, 2);
    // stand behind the stone, or at a given open spot (then lever along the line from there)
    const rear = standAt ? standAt.clone().setY(sled.pos.y) : sled.pos.clone().addScaledVector(dir, -1.15);
    const face = standAt ? sled.pos.clone().sub(rear).setY(0).normalize() : dir;
    const side = new THREE.Vector3(-face.z, 0, face.x);
    yield* all(levers.map((w, j) => walk(w, [rear.clone().addScaledVector(side, j ? 0.4 : -0.4)], 1.2, 'walk')));
    levers.forEach((w) => { w.yaw = Math.atan2(face.x, face.z); w.pose = 'lever'; });
    const bside = new THREE.Vector3(-dir.z, 0, dir.x);
    const lb = levers.map((w, j) => ({ w, end: () => mesh.position.clone().addScaledVector(dir, -0.55).addScaledVector(bside, j ? 0.42 : -0.42).setY(mesh.position.y + 0.06) }));
    lb.forEach((b) => this.leverBindings.add(b));
    let t = 0;
    while (t < dur) {
      const dt = yield; t += dt;
      const k = Math.min(1, t / dur);
      const e = (Math.floor(k * 5) + Math.min(1, (k * 5 - Math.floor(k * 5)) * 1.7)) / 5;
      const ee = Math.min(1, e);
      mesh.position.lerpVectors(start, target, ee);
      // stays on the deck height until it clears the runners, then settles
      const drop = THREE.MathUtils.smoothstep(ee, 0.7, 1.0);
      mesh.position.y = THREE.MathUtils.lerp(start.y, target.y, drop);
      mesh.quaternion.slerpQuaternions(q0, q1, ee);
    }
    mesh.position.copy(target); mesh.quaternion.copy(q1);
    lb.forEach((b) => this.leverBindings.delete(b));
    levers.forEach((w) => { w.pose = 'idle'; });
    return mesh;
  }

  // loaders at a pile lever a waiting stone onto a team's sled
  *loadOntoSled(loaders, job) {
    const { item, sled } = job;
    yield* until(() => job.ready);
    yield* this.leverOnto(loaders, item.mesh, sled, sled.pos.clone(), item.material === 'sarcophagus', job.loadYaw || 0);
    job.loaded = true;
  }

  // ---- dispatch -------------------------------------------------------------
  planLayer(L) {
    if (L === 2) for (const k of [10, 11, 12]) obstacles.add(`2,6,${k}`);
    const eastOnly = L >= LAYERS - 2; // 9 blocks, then the capstone: one ramp is enough
    const list = layerPlan(L, eastOnly ? [1] : [1, -1]);
    if (L === 2) for (const k of [10, 11, 12]) obstacles.delete(`2,6,${k}`);
    if (L === 2) list.unshift(this.sarcophagus);
    this.layerRemaining[L] = list.length;
    const alt = [0, 0];
    for (const t of list) {
      const e = N - 1 - L;
      // each block is set from the nearer ramp (east or west), alternating its two lanes
      const side = t.special || eastOnly ? 1 : t.i > 8 ? 1 : t.i < 8 ? -1 : (alt[0] + alt[1]) % 2 ? -1 : 1;
      const base = side > 0 ? 0 : 2;
      const entryCol = side > 0 ? e : L;
      if (t.i === entryCol && t.k === ENTRY_ROWS[0]) t.lane = base;
      else if (t.i === entryCol && t.k === ENTRY_ROWS[1]) t.lane = base + 1;
      else if (t.special) t.lane = 1;
      else if (L === LAYERS - 1) t.lane = 0;
      else t.lane = base + (t.k < 8 ? 0 : t.k > 8 ? 1 : alt[base / 2]++ % 2);
      this.queue.push(t);
    }
    this.plannedLayers = L;
  }

  sourceFor(material) {
    if (material === 'limestone') return this.quarry.pile.find((p) => p.item && !p.item.claimed) ? 'quarry' : null;
    return this.harbour.slots.find((s) => s.item && !s.item.claimed && s.item.material === material) ? 'yard' : null;
  }
  materialOf(t) { return t.special ? 'sarcophagus' : t.material === 'gold' ? 'cap' : t.material; }

  dispatch() {
    if (this.phase !== 'building') return;
    if (this.queue.length < 30 && this.plannedLayers < LAYERS - 1 && this.plannedLayers <= this.layer) this.planLayer(this.plannedLayers + 1);
    // Dispatch in plan order per lane. A block whose stone is not yet available holds back
    // the rest of its lane (keeping each lane farthest-first), but other lanes carry on.
    const blockedLanes = new Set();
    let dispatched = 0;
    for (let qi = 0; qi < Math.min(this.queue.length, 48) && dispatched < 4; qi++) {
      const t = this.queue[qi];
      if (t.L > this.layer + 1) break;
      if (blockedLanes.has(t.lane)) continue;
      // keep teams spread over the four lanes
      const outstanding = this.lanes[t.lane].queue.length;
      if (outstanding >= 3) { blockedLanes.add(t.lane); continue; }
      const mat = this.materialOf(t);
      const heavy = mat === 'granite' || mat === 'sarcophagus';
      const idle = this.teams.filter((tm) => tm.active && !tm.job && !tm.helping && !tm.homing);
      if (idle.length < (heavy ? 2 : 1)) { if (heavy) { blockedLanes.add(t.lane); continue; } return; }
      const src = this.sourceFor(mat);
      if (!src) { this.waitingFor = mat; blockedLanes.add(t.lane); continue; }
      // send it up whichever ramp can still reach its spot
      if (!t.special && !this.westRetired && t.L === this.layer && !Crews.reachableFromSide(t.L, t, t.lane < 2 ? 1 : -1)) {
        const other = t.lane < 2 ? t.lane + 2 : t.lane - 2;
        if (Crews.reachableFromSide(t.L, t, other < 2 ? 1 : -1) && this.lanes[other].queue.length < 3) t.lane = other;
      }
      this.queue.splice(qi, 1); qi--;
      dispatched++;
      // nearest idle team to the source
      const team = idle[0];
      const helper = heavy ? idle[1] : null;
      const job = { seq: this.seq++, target: t, material: mat, src, lane: t.lane, team, helper };
      if (src === 'quarry') { const p = this.quarry.pile.find((q) => q.item && !q.item.claimed); p.item.claimed = true; job.item = p.item; job.pile = p; }
      else { const s = this.harbour.slots.find((q) => q.item && !q.item.claimed && q.item.material === mat); s.item.claimed = true; job.item = s.item; job.slot = s; }
      team.job = job; if (helper) { helper.helping = team; helper.job = job; }
      this.lanes[t.lane].queue.push(job.seq);
      this.sched.spawn(Crews.haulJob(this, job), 'haul');
    }
    if (blockedLanes.size === 0) this.waitingFor = null;
  }

  // ---- per tick -------------------------------------------------------------
  tick(dt) {
    indexWorkers(this.crowd.workers);
    this.sched.tick(dt);
    this.dispatch();
    // food is eaten by the whole workforce
    if (this.phase !== 'complete') this.stocks.v.food = Math.max(0, this.stocks.v.food - dt * this.crowd.workers.length * 0.0011);
    if (this.rampH !== this.rampTarget) {
      // ramp height follows the builders' progress (set in crews)
      this.pyramid.setRamp(this.rampH, this.rampHW);
    }
  }

  // layer bookkeeping when a block is set
  onPlaced(t) {
    this.placedCount += t.special ? 0 : 1;
    this.layerRemaining[t.L]--;
    if (this.layerRemaining[t.L] === 0 && t.L === this.layer) {
      this.note(`Course ${t.L + 1} of ${LAYERS} complete`);
      if (t.L < LAYERS - 1) this.sched.spawn(Crews.raiseRamp(this, t.L + 1), 'ramp');
      else this.sched.spawn(Crews.finishWorks(this), 'finish');
    }
  }

  progress() {
    const dig = rockCells.filter((c) => c.state === 'dug').length / rockCells.length;
    return { blocks: this.placedCount / this.totalBlocks, dig, layer: this.layer };
  }

  fastForward(seconds, step = 1 / 30) {
    const n = Math.ceil(seconds / step);
    for (let i = 0; i < n; i++) this.tick(step);
  }
}
