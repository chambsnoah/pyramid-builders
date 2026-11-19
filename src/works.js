// Substructure excavation, ramp raising/removal and furnishing the finished tomb.
import * as THREE from 'three';
import { Path, wait, until, walk, all, turnTo, v3, yawTo } from './core.js';
import { B, HALF, LAYERS, cx, cz, edgeX, edgeZ, rockCells, getRock, descFloor, stairFloor, deckCells, DESC } from './plan.js';
import { GEO, MAT } from './assets.js';
import { SITE } from './world.js';

// ---- burial goods ----------------------------------------------------------------
// A painted cedar chest with a hinged lid; what is inside differs by chamber.
function makeChest(where) {
  const g = new THREE.Group();
  // hollow box (floor and four sides) so the contents show when the lid is up
  const T = 0.04;
  const base = new THREE.Group();
  for (const [w, h, d, x, y, z] of [[0.8, T, 0.5, 0, T / 2, 0], [0.8, 0.38, T, 0, 0.19, 0.25 - T / 2], [0.8, 0.38, T, 0, 0.19, -0.25 + T / 2],
    [T, 0.38, 0.5 - 2 * T, 0.4 - T / 2, 0.19, 0], [T, 0.38, 0.5 - 2 * T, -0.4 + T / 2, 0.19, 0]]) {
    base.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(x, y, z), MAT.paint));
  }
  base.add(new THREE.Mesh(new THREE.BoxGeometry(0.8 - 2 * T, 0.03, 0.5 - 2 * T).translate(0, T + 0.015, 0), MAT.linen)); // linen lining
  const band = new THREE.Group(); // gold collar round the outside of the box, open in the middle
  for (const [w, d, x, z] of [[0.84, 0.02, 0, 0.26], [0.84, 0.02, 0, -0.26], [0.02, 0.5, 0.41, 0], [0.02, 0.5, -0.41, 0]]) {
    band.add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d).translate(x, 0.33, z), MAT.gold));
  }
  const lid = new THREE.Group(); lid.position.set(0, 0.38, -0.25); // hinge along the back edge
  lid.add(new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.54).translate(0, 0.06, 0.25), MAT.paint));
  lid.add(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.04, 0.56).translate(0, 0.07, 0.25), MAT.gold)); // rim sits below the lid top so the faces never overlap
  const contents = new THREE.Group();
  for (let n = 0; n < 5; n++) {
    const piece = new THREE.Mesh(n % 2 ? GEO.jar : new THREE.BoxGeometry(0.18, 0.05, 0.1), n % 2 ? MAT.whiteJar : MAT.gold);
    piece.scale.setScalar(n % 2 ? 0.45 : 1);
    piece.position.set(-0.28 + n * 0.14, n % 2 ? 0.07 : 0.095, (n % 3 - 1) * 0.08); // resting on the lining
    contents.add(piece);
  }
  g.add(base, band, lid, contents);
  g.userData.lid = lid;
  g.userData.inspect = where === 'upper'
    ? { name: 'Cedar chest', detail: 'Gold collars, ingots and jars of perfumed oil for the king', open: 'E to open' }
    : { name: 'Cedar chest', detail: 'Linen, gold amulets and alabaster jars of food for the afterlife', open: 'E to open' };
  return g;
}

// ---- interior routes -------------------------------------------------------
export const OUTSIDE_N = () => v3(cx(8), 0, -HALF - 4);
const ANTE = () => v3(edgeX(7) + 0.35, 0, cz(4));
export function routeToAntechamber() {
  return [OUTSIDE_N(), v3(cx(8), 0, -HALF - 0.5), v3(cx(8), 0, cz(2)), v3(cx(8), 0, cz(4))];
}
export function routeToUpperChamber() {
  const pts = [...routeToAntechamber(), v3(cx(8), 0, cz(5) + 0.3)];
  for (let z = edgeZ(6); z <= edgeZ(10) + 0.01; z += 0.5) pts.push(v3(cx(8), stairFloor(z), z));
  pts.push(v3(cx(8), 2 * B, cz(10)));
  return pts;
}
const walkable = (i, k) => { const c = getRock(i, k, 2); return !!c && c.state === 'dug'; };
const floorAt = (i, k) => {
  if (i === 3 && k === 4) return descFloor(cx(3));
  const c3 = getRock(i, k, 3);
  return c3 && c3.state === 'dug' ? -3 * B : -2 * B;
};
// route from outside down the rock-cut stair and through the cut galleries to stand next to cell c
export function routeToRock(c) {
  const pts = [...routeToAntechamber(), ANTE()];
  if (c.zone === 'stair') {
    const sc = c.i + 1;
    if (sc >= 7) return { pts, face: -Math.PI / 2 };
    const sx = cx(sc) - 0.1;
    for (let x = edgeX(7) - 0.3; x > sx; x -= 0.5) pts.push(v3(x, descFloor(x), cz(4)));
    pts.push(v3(sx, descFloor(sx), cz(4)));
    return { pts, face: -Math.PI / 2 };
  }
  for (let x = edgeX(7) - 0.3; x > cx(3); x -= 0.5) pts.push(v3(x, descFloor(x), cz(4)));
  pts.push(v3(cx(3), descFloor(cx(3)), cz(4)));
  // BFS over cut galleries from the stair foot
  const start = '3,4', prev = new Map([[start, null]]), q = [[3, 4]];
  while (q.length) {
    const [i, k] = q.shift();
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nk = k + dk, key = `${ni},${nk}`;
      if (prev.has(key) || !walkable(ni, nk)) continue;
      prev.set(key, [i, k]); q.push([ni, nk]);
    }
  }
  // stand on the reachable neighbour of the target (or the stair foot)
  let best = null;
  for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const ni = c.i + di, nk = c.k + dk, key = `${ni},${nk}`;
    if (!prev.has(key)) continue;
    let d = 0, p = prev.get(key); while (p) { d++; p = prev.get(`${p[0]},${p[1]}`); }
    if (!best || d < best.d) best = { d, i: ni, k: nk };
  }
  if (!best) return { pts, face: -Math.PI / 2 };
  const chain = [];
  let cur = [best.i, best.k];
  while (cur) { chain.unshift(cur); cur = prev.get(`${cur[0]},${cur[1]}`); }
  for (const [i, k] of chain.slice(1)) pts.push(v3(cx(i), floorAt(i, k), cz(k)));
  const last = pts[pts.length - 1];
  const tgt = v3(cx(c.i), last.y, cz(c.k));
  const toward = tgt.clone().sub(last).setY(0).normalize();
  pts.push(last.clone().addScaledVector(toward, 0.3));
  return { pts, face: Math.atan2(toward.x, toward.z) };
}
export function routeToLowerChamber() {
  const all = rockCells.find((c) => c.i === 8 && c.k === 8 && c.d === 2);
  return routeToRock(all).pts;
}

// walk an indoor route, starting from the waypoint nearest the walker
function* walkRoute(w, pts, speed, pose, mul) {
  let best = 0, bd = Infinity;
  pts.forEach((p, j) => { const d = p.distanceTo(w.pos); if (d < bd) { bd = d; best = j; } });
  const rest = pts.slice(best);
  if (rest.length) yield* walk(w, rest, speed, pose, mul);
}
function* walkRouteBack(w, pts, speed, pose, mul) {
  const rev = pts.slice().reverse();
  yield* walkRoute(w, rev, speed, pose, mul);
}

// a place to stand at the foot of the spoil heap, on its side facing the site
export function heapSpot(sim, j) {
  const r = 4 * sim.spoilHeap.scale.x + 0.5;
  const a = Math.PI * (0.75 + 0.09 * (j % 6)); // spread round the side facing the site
  return v3(SITE.spoil.x + Math.cos(a) * r, 0, SITE.spoil.z + Math.sin(a) * r);
}

// ---- excavation ----------------------------------------------------------------
export function* tunnelling(sim) {
  const diggers = sim.diggers;
  sim.note('Quarrymen begin cutting the descending passage into the bedrock');
  for (const c of rockCells) {
    if (sim.stocks.get('tools') <= 0) {
      diggers.forEach((w) => { w.pose = 'rest'; });
      sim.waitingFor = 'copper tools';
      yield* until(() => sim.stocks.get('tools') > 0);
    }
    c.state = 'digging';
    sim.digging = { cell: c, progress: 0 };
    sim.pyramid.rebuildRock();
    const { pts, face } = routeToRock(c);
    const right = v3(Math.cos(face), 0, -Math.sin(face));
    yield* all(diggers.map((w, j) => walkRoute(w, pts.map((p, n) => (n === pts.length - 1 ? p.clone().addScaledVector(right, j ? 0.32 : -0.32) : p)), 1.2, 'walk', sim.speedMul)));
    diggers.forEach((w) => { w.yaw = face; w.pose = 'pick'; w.item = 'pick'; w.actRate = 0.9 + w.id % 3 * 0.08; });
    sim.digging.stand = pts[pts.length - 1].clone();
    let p = 0;
    while (p < 1) {
      const dt = yield;
      p += dt / 30 * sim.speedMul();
      sim.digging.progress = p;
      sim.pyramid.setDigging([{ cell: c, progress: p }]);
    }
    sim.stocks.take('tools', 1);
    c.state = 'dug';
    sim.dugCount++;
    sim.pyramid.setDigging([]);
    sim.pyramid.rebuildRock();
    sim.spoilHeap.scale.setScalar(0.45 + sim.dugCount * 0.011);
    if (c.zone === 'stair' && !rockCells.some((x) => x.zone === 'stair' && x.state !== 'dug')) sim.note('Rock-cut stair finished; driving the passage south');
    if (c.zone === 'passage' && !rockCells.some((x) => x.zone === 'passage' && x.state !== 'dug')) sim.note('Passage reaches the burial chamber site');
  }
  sim.digging = null;
  diggers.forEach((w) => { w.item = null; });
  sim.note('Subterranean burial chamber fully cut');
  sim.tunnelDone = true;
  yield* all(diggers.map((w, j) => (function* () { yield* walkRouteBack(w, routeToLowerChamber(), 1.2, 'walk'); yield* walk(w, [v3(-3 + j, 0, -16)], 1.2, 'walk'); w.pose = 'rest'; })()));
}

export function* spoilCarrier(sim, w, j) {
  yield* wait(4 + j * 6);
  while (!sim.tunnelDone) {
    const d = sim.digging;
    if (!d || !d.stand) { if (!w.walking) w.pose = 'rest'; yield* wait(1); continue; }
    const { pts } = routeToRock(d.cell);
    const inPts = pts.slice(0, -1);
    yield* walkRoute(w, inPts, 1.3, 'walk', sim.speedMul);
    w.pose = 'kneel'; w.item = 'basket'; yield* wait(2.2);
    w.pose = 'carryHead';
    yield* walkRouteBack(w, inPts, 1.15, 'carryHead', sim.speedMul);
    yield* walk(w, [heapSpot(sim, j)], 1.15, 'carryHead', sim.speedMul);
    w.pose = 'dump'; w.act = 0; yield* wait(2.4);
    w.item = null;
    sim.stocks.add('rubble', 1);
  }
  w.pose = 'rest';
}

// ---- ramp ------------------------------------------------------------------------
function* basketTrip(sim, w, j, dir, dh) {
  // dir +1: carry rubble up and tip it at the head of the ramp; -1: dig it away and carry it down
  const heap = heapSpot(sim, 2 + j);
  // builders alternate between the two ramps; once the west ramp is finished only the east one
  // is raised, and when dismantling the taller east ramp comes down first
  const westInUse = dir > 0 ? !sim.westRetired : !(sim.rampHW < sim.rampH - 1e-3);
  const sd = j % 2 && westInUse ? -1 : 1;
  const zl = 0.6 * ((j % 3) - 1);
  const climb = () => { const { xFoot, xTop } = sim.ramp(sd); return [v3(sd * (xFoot + 3), 0, 5.2), ...sim.lanePoints(zl, sd * (xFoot + 1), sd * (xTop + 1.0 + (j % 3) * 0.4))]; };
  const descend = (extra) => { const { xFoot } = sim.ramp(sd); return [...sim.lanePoints(zl, w.pos.x, sd * (xFoot + 1)).slice(1), v3(sd * (xFoot + 3), 0, 5.2), ...(sd < 0 ? [v3(-(xFoot + 3), 0, -17), v3(12, 0, -17)] : []), ...extra]; };
  if (dir > 0) {
    yield* walk(w, [heap], 1.3, 'walk', sim.speedMul);
    if (sd < 0) { const { xFoot } = sim.ramp(sd); yield* walk(w, [v3(12, 0, -17), v3(-(xFoot + 3), 0, -17)], 1.2, 'walk', sim.speedMul); }
    w.pose = 'kneel'; w.item = 'basket'; yield* wait(1.6);
    w.pose = 'carryHead';
    yield* walk(w, climb(), 1.05, 'carryHead', sim.speedMul);
    w.pose = 'dump'; w.act = 0; yield* wait(2.4);
    w.item = null;
    sim.rampH = Math.min(sim.rampGoal, sim.rampH + dh);
    if (!sim.westRetired) sim.rampHW = sim.rampH;
    sim.pyramid.setRamp(sim.rampH, sim.rampHW);
    yield* walk(w, descend([]), 1.3, 'walk', sim.speedMul);
  } else {
    if (sd < 0) { const { xFoot } = sim.ramp(sd); yield* walk(w, [v3(12, 0, -17), v3(-(xFoot + 3), 0, -17)], 1.3, 'walk', sim.speedMul); }
    yield* walk(w, climb(), 1.25, 'walk', sim.speedMul);
    w.pose = 'pick'; w.item = 'pick'; yield* wait(2.0);
    w.pose = 'kneel'; w.item = 'basket'; yield* wait(1.2);
    sim.rampH = Math.max(0, sim.rampH - dh);
    sim.rampHW = Math.min(sim.rampHW, sim.rampH); // the taller east ramp comes down to meet the west one first
    sim.pyramid.setRamp(sim.rampH, sim.rampHW);
    w.pose = 'carryHead';
    yield* walk(w, descend([heap]), 1.1, 'carryHead', sim.speedMul);
    w.pose = 'dump'; w.act = 0; yield* wait(2.0);
    w.item = null;
  }
}

export function* raiseRamp(sim, L) {
  sim.rampReady = false;
  yield* until(() => !sim.lanes.some((l) => l.busy || l.crew.busy) && !sim.teams.some((t) => t.job && t.job.onRamp));
  const H1 = L * B;
  sim.rampGoal = H1;
  if (L >= LAYERS - 2 && !sim.westRetired) { sim.westRetired = true; sim.note('The west ramp is no longer needed; the last courses go up the east ramp'); }
  // timber centering for openings bridged by this course
  const decks = deckCells.filter((b) => b.L === L);
  if (decks.length) {
    if (sim.stocks.get('timber') < decks.length) { sim.waitingFor = 'timber'; yield* until(() => sim.stocks.get('timber') >= decks.length); }
    sim.stocks.take('timber', decks.length);
    decks.forEach((b) => sim.pyramid.showDeck(b, true));
    sim.note(`Carpenters lay timber centering over the openings in course ${L + 1}`);
  }
  sim.note(`Raising the construction ramp to course ${L + 1}`);
  const trips = 6 + L * 2;
  const dh = (H1 - sim.rampH) / trips;
  // setting crews step down off the landing while it is built up
  sim.lanes.forEach((l, n) => l.crew.members.forEach((w, j) => { const sd = n < 2 ? 1 : -1; if (Math.abs(w.pos.y) < 0.05 && sd < 0 && sim.westRetired) return; sim.sched.spawn(walk(w, [...sim.lanePoints(n % 2 ? 0.4 : -0.4, w.pos.x, sd * (sim.ramp(sd).xFoot + 2)).slice(1), v3(sd * (sim.ramp(sd).xFoot + 6 + j * 0.7), 0, n % 2 ? 8 : -8)], 1.3, 'walk')); }));
  let trip = 0;
  const workers = sim.rampCrew.map((w, j) => (function* () {
    while (sim.rampH < H1 - 1e-6 && trip < trips) { trip++; yield* basketTrip(sim, w, j, 1, dh); }
  })());
  yield* all(workers);
  sim.rampH = H1; if (!sim.westRetired) sim.rampHW = H1;
  sim.pyramid.setRamp(sim.rampH, sim.rampHW);
  sim.layer = L;
  sim.rampReady = true;
  // crews climb back up to the new landing
  // crews climb back up to the new landing (the west crews stay down once their ramp is finished)
  sim.lanes.forEach((l, n) => l.crew.members.forEach((w, j) => { const sd = n < 2 ? 1 : -1; if (sd < 0 && sim.westRetired) { w.pose = 'rest'; return; } sim.sched.spawn(walk(w, [...sim.lanePoints(n % 2 ? 0.4 : -0.4, sd * (sim.ramp(sd).xFoot + 1), sd * (sim.ramp(sd).xTop + 2.2 + j * 0.5))], 1.2, 'walk')); }));
}

// ---- completion ---------------------------------------------------------------------
export function* finishWorks(sim) {
  sim.note('The gilded capstone crowns the pyramid');
  sim.rampReady = false;
  yield* until(() => !sim.lanes.some((l) => l.busy || l.crew.busy));
  sim.phase = 'dismantling';
  sim.lanes.forEach((l, n) => l.crew.members.forEach((w, j) => { const sd = n < 2 ? 1 : -1; sim.sched.spawn(walk(w, [...sim.lanePoints(n % 2 ? 0.4 : -0.4, w.pos.x, sd * (sim.ramp(sd).xFoot + 2)).slice(1), v3(sd * (30 + j), 0, n % 2 ? 14 : -14)], 1.2, 'walk')); }));
  sim.stocks.v.landingMortar = 0;
  yield* wait(4);
  sim.note('Dismantling the ramp; the white casing is revealed from the top down');
  const trips = 70;
  const dh = sim.rampH / trips;
  let trip = 0;
  yield* all(sim.rampCrew.concat(sim.mortarPorters).map((w, j) => (function* () {
    while (sim.rampH > 1e-4 && trip < trips) { trip++; yield* basketTrip(sim, w, j, -1, dh); }
    w.pose = 'rest';
  })()));
  sim.rampH = 0; sim.rampHW = 0; sim.pyramid.setRamp(0, 0);
  sim.phase = 'furnishing';
  if (!sim.tunnelDone) { sim.note('Waiting for the tunnellers to finish the burial chamber'); yield* until(() => sim.tunnelDone); }
  if (sim.stocks.get('goods') < 6 || sim.stocks.get('statue') < 2) { sim.waitingFor = 'burial goods'; yield* until(() => sim.stocks.get('goods') >= 6 && sim.stocks.get('statue') >= 2); }
  sim.note('Porters carry the burial goods into the chambers');
  const store = v3(SITE.store.x - SITE.store.w / 2 - 1.5, 0, SITE.store.z);
  // upper chamber: the sarcophagus is against the west wall; goods go along the east and south walls
  const upper = (px, pz, sx, sz) => ({ route: routeToUpperChamber(), stand: v3(sx, 2 * B, sz), place: v3(px, 2 * B, pz) });
  const lowerY = -3 * B;
  const jobs = [
    // chest fronts (local +z, opposite the hinge) face into the room
  { type: 'goods', where: 'lower', place: v3(cx(7), lowerY, cz(7) - 0.1), yaw: 0 },
    { type: 'goods', where: 'lower', place: v3(cx(9), lowerY, cz(7) - 0.1), yaw: 0 },
    { type: 'goods', where: 'lower', place: v3(cx(10) + 0.1, lowerY, cz(9)), yaw: -Math.PI / 2 },
    { type: 'goods', where: 'lower', place: v3(cx(8), lowerY, cz(11) + 0.1), yaw: Math.PI },
    { type: 'goods', where: 'upper', yaw: -Math.PI / 2, ...upper(2.55, 2.4, 1.6, 2.4) },
    { type: 'goods', where: 'upper', yaw: -Math.PI / 2, ...upper(2.55, 5.0, 1.6, 5.0) },
    { type: 'statue', where: 'upper', yaw: Math.PI, ...upper(-0.7, 5.2, -0.7, 4.2) },
    { type: 'statue', where: 'upper', yaw: Math.PI, ...upper(0.9, 5.2, 0.9, 4.2) },
  ];
  const porters = sim.porters.concat(sim.mortarPorters.slice(0, 1));
  // borrow the dock porters once they finish what they are carrying
  sim.porters.forEach((w) => { w.reserved = true; });
  yield* until(() => sim.porters.every((w) => !w.inJob));
  let next = 0;
  yield* all(porters.map((w) => (function* () {
    while (next < jobs.length) {
      const job = jobs[next++];
      yield* walk(w, [store], 1.35, 'walk', sim.speedMul);
      sim.stocks.take(job.type, 1);
      w.item = 'crate'; w.pose = 'carryFront';
      let route;
      if (job.where === 'lower') {
        route = routeToLowerChamber();
        route.push(v3(job.place.x - Math.sign(job.place.x - cx(8)) * 0.9 * (Math.abs(job.place.x - cx(8)) > 0.1 ? 1 : 0), lowerY, job.place.z - Math.sign(job.place.z - cz(9)) * 0.9 * (Math.abs(job.place.x - cx(8)) > 0.1 ? 0 : 1)));
      } else {
        route = job.route.slice();
        route.push(v3(job.stand.x, 2 * B, cz(10)), job.stand.clone());
      }
      yield* walk(w, [OUTSIDE_N(), ...route], 1.15, 'carryFront', sim.speedMul);
      w.yaw = yawTo(w.pos, job.place);
      w.pose = 'kneel'; yield* wait(1.4);
      w.item = null;
      const mesh = job.type === 'statue' ? new THREE.Group() : makeChest(job.where);
      if (job.type === 'statue') {
        mesh.add(new THREE.Mesh(GEO.statue, MAT.gold));
        mesh.userData.inspect = { name: 'Gilded statue of the king', detail: 'Wood covered in gold leaf, set to guard the burial' };
      }
      mesh.position.copy(job.place); mesh.rotation.y = job.yaw;
      mesh.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      sim.goodsGroup.add(mesh);
      sim.goodsPlaced++;
      sim.extraSolids.push({ x: job.place.x, z: job.place.z, r: job.type === 'statue' ? 0.35 : 0.45, y0: job.place.y, y1: job.place.y + (job.type === 'statue' ? 1.7 : 0.5) });
      yield* walk(w, [...route.slice().reverse(), OUTSIDE_N(), store.clone().add(v3(0, 0, 2))], 1.35, 'walk', sim.speedMul);
      w.pose = 'rest';
    }
  })()));
  sim.porters.forEach((w) => { w.reserved = false; });
  sim.phase = 'complete';
  sim.note('The tomb is complete. Walk inside in first person to explore');
}
