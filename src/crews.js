// Work gangs and their behaviours.
import * as THREE from 'three';
import { Path, wait, until, walk, all, turnTo, v3, yawTo, random } from './core.js';
import {
  B, N, HALF, LAYERS, cx, cz, edgeX, edgeZ, blocks, rockCells, getRock, getBlock, inLayer, supportSolid, pushPath,
  ENTRY_ROWS, LANE_UP, LANE_DOWN, descFloor, stairFloor, deckCells, obstacles, DESC,
} from './plan.js';
import { GEO, MAT, dressedGeometry } from './assets.js';
import { SITE } from './world.js';
import { rampProfile, RAMP_LANDING, blockMatrix } from './pyramid.js';
import { Sled } from './sim.js';
import { tunnelling, spoilCarrier, raiseRamp, finishWorks } from './works.js';

const TEAMS = 12, HAULERS = 6;

export function setup(sim) {
  const crowd = sim.crowd;
  const mk = (x, y, z, o = {}) => { const w = crowd.add(o); w.pos.set(x, y, z); w.lastPos = null; return w; };

  // haul teams: 6 haulers and a water pourer each; only teams with a sled are active
  sim.teams = [];
  for (let t = 0; t < TEAMS; t++) {
    const depot = v3(12 + (t % 4) * 5.2, 0, -19 - Math.floor(t / 4) * 5.5);
    const at = t < 6 ? depot : v3(SITE.camp.x - 6 + (t % 4) * 3, 0, SITE.camp.z + 12 + Math.floor(t / 4) * 2);
    const members = [];
    for (let j = 0; j < HAULERS; j++) members.push(mk(at.x + (j % 2) * 0.7, 0, at.z + Math.floor(j / 2) * 0.9 + 1));
    const pourer = mk(at.x + 1.6, 0, at.z, { water: 10 });
    const team = { id: t, members, pourer, depot, active: t < 6, job: null, helping: null, sled: null };
    if (team.active) { team.sled = new Sled(sim.scene); team.sled.pos.copy(depot).add(v3(-1.5, 0, 0)); team.sled.yaw = Math.PI; team.sled.sync(); }
    sim.teams.push(team);
    members.concat(pourer).forEach((w) => { w.pose = 'rest'; });
  }
  // setting crews, one per landing lane
  sim.lanes = [0, 1, 2, 3].map((l) => ({
    l, busy: false, queue: [], crew: { busy: false, members: [0, 1, 2, 3].map((j) => mk((l < 2 ? 1 : -1) * (HALF + 2 + j * 0.6), 0, l % 2 ? 4 : -4)), reserved: null },
  }));
  sim.leveller = [];
  sim.rampCrew = [0, 1, 2, 3, 4, 5].map((j) => mk(16 + j, 0, 12));
  sim.quarry = { pile: [], pairs: [] };
  const QZ = SITE.quarryFace.z;
  for (let j = 0; j < 12; j++) sim.quarry.pile.push({ x: 1.5 + j * 2.6, z: QZ - 3.4, item: null, reserved: false });
  sim.quarry.pairs = [0, 1, 2, 3].map((p) => ({ face: v3(4 + p * 7.5, 0, QZ), men: [mk(3 + p * 7.5, 0, QZ - 1.5), mk(5 + p * 7.5, 0, QZ - 1.5)], cut: null }));
  sim.quarry.loaders = [mk(10, 0, QZ - 1.6), mk(11, 0, QZ - 1.6), mk(20, 0, QZ - 1.6), mk(21, 0, QZ - 1.6)];
  sim.yardLoaders = [mk(42, 0, -9), mk(42.8, 0, -9)];
  sim.masons = [mk(44.2, 0, -9.4), mk(45, 0, -9.4)];
  sim.diggers = [mk(-2, 0, -14), mk(-1, 0, -14)];
  sim.spoilers = [mk(1, 0, -15), mk(2, 0, -15)];
  sim.waterCarriers = [mk(54, 0.15, 9), mk(53, 0.15, 9.5)];
  sim.mortarPorters = [mk(38, 0, 12), mk(38, 0, 13)];
  sim.porters = [mk(50, 0, 4), mk(50.8, 0, 4.5), mk(51.6, 0, 4)];
  sim.stevedores = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => mk(48 + (j % 4) * 0.8, 0, j < 4 ? -5 : -3));
  sim.carpenters = [mk(SITE.workshop.x - 1, 0, SITE.workshop.z), mk(SITE.workshop.x + 1, 0, SITE.workshop.z)];
  sim.overseers = [mk(20, 0, 9, { pose: 'point' }), mk(-1, 0, 31, { pose: 'point' })];
  sim.harbourMaster = mk(53.6, 0.15, -6.5, { pose: 'rest' });
  sim.scribe = mk(SITE.store.x - SITE.store.w / 2 - 0.9, 0, SITE.store.z + 1.6, { pose: 'kneel' });
  const quaySleds = [0, 1].map((g) => { const q = new Sled(sim.scene); q.pos.set(50 - g * 4, 0, -7.5); q.yaw = Math.PI; q.sync(); return q; });

  // spoil heap grows as the substructure is cut
  // a lumpy mound of limestone rubble rather than a smooth cone
  const heapGeo = new THREE.SphereGeometry(4, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const hp = heapGeo.attributes.position;
  for (let v = 0; v < hp.count; v++) {
    const x = hp.getX(v), y = hp.getY(v), z = hp.getZ(v);
    const a = Math.atan2(z, x), lump = 1 + 0.12 * Math.sin(a * 5 + 1) + 0.08 * Math.sin(a * 11) + 0.06 * Math.sin(y * 3 + a * 7);
    hp.setXYZ(v, x * lump, y * 0.55 * (0.9 + 0.1 * Math.sin(a * 3)), z * lump);
  }
  heapGeo.computeVertexNormals();
  sim.spoilHeap = new THREE.Mesh(heapGeo, new THREE.MeshStandardMaterial({ map: MAT.rock.map, color: 0xeadcc0, roughness: 1, flatShading: true }));
  sim.spoilHeap.position.set(SITE.spoil.x, -0.05, SITE.spoil.z); sim.spoilHeap.scale.set(0.45, 0.45, 0.45);
  sim.spoilHeap.castShadow = true; sim.spoilHeap.receiveShadow = true;
  sim.scene.add(sim.spoilHeap);
  // mortar jars standing at the ramp landing
  sim.landingJars = new THREE.InstancedMesh(GEO.jar, MAT.whiteJar, 8);
  sim.landingJars.castShadow = true; sim.landingJars.count = 0; sim.scene.add(sim.landingJars);
  // grave goods placed in the chambers
  sim.goodsGroup = new THREE.Group(); sim.scene.add(sim.goodsGroup);

  const S = sim.sched;
  S.spawn(levelling(sim), 'level');
  S.spawn(harbourMaster(sim), 'harbour');
  sim.porters.forEach((w) => S.spawn(sim.harbour.porterLoop(w), 'porter'));
  [0, 1].forEach((g) => S.spawn(sim.harbour.stevedoreLoop(sim.stevedores.slice(g * 4, g * 4 + 4), quaySleds[g], g), 'stevedores'));
  sim.quarry.pairs.forEach((p) => S.spawn(quarryPair(sim, p), 'quarry'));
  S.spawn(quarryLoaders(sim, sim.quarry.loaders.slice(0, 2)), 'loaders');
  S.spawn(quarryLoaders(sim, sim.quarry.loaders.slice(2, 4)), 'loaders');
  S.spawn(yardLoaders(sim), 'yardLoaders');
  sim.waterCarriers.forEach((w, j) => S.spawn(waterCarrier(sim, w, j), 'water'));
  sim.mortarPorters.forEach((w, j) => S.spawn(mortarPorter(sim, w, j), 'mortar'));
  S.spawn(carpentry(sim), 'carpentry');
  sim.teams.forEach((t) => S.spawn(teamIdle(sim, t), 'teamIdle'));
  S.spawn(overseers(sim), 'overseers');
  S.spawn(harbourOfficials(sim), 'harbourMaster');
}

// ---- site levelling ------------------------------------------------------
function* levelling(sim) {
  const gang = sim.rampCrew.concat(sim.teams[0].members);
  sim.note('Levelling the bedrock and setting out the base');
  const lines = gang.map((w, j) => {
    const z0 = -HALF + 0.8 + j * ((2 * HALF - 1.6) / (gang.length - 1));
    return (function* () {
      yield* walk(w, [v3(-HALF - 1, 0, z0)], 1.3, 'walk');
      w.item = 'hoe';
      for (let pass = 0; pass < 3; pass++) {
        const dir = pass % 2 ? -1 : 1;
        yield* walk(w, [v3(dir * (HALF - 0.5), 0.05, z0 + (pass - 1) * 0.3)], 0.45, 'hoe', sim.speedMul);
        w.pose = 'hoe'; yield* wait(1.5);
      }
      w.item = null; w.pose = 'walk';
    })();
  });
  let t = 0;
  const work = all(lines);
  let dt = 0;
  while (!work.next(dt).done) {
    dt = yield; t += dt;
    sim.levelProgress = Math.min(0.97, t / 75);
    sim.pyramid.setLevelling(sim.levelProgress);
  }
  sim.levelProgress = 1;
  sim.pyramid.setLevelling(1);
  sim.phase = 'building';
  sim.note('Site level. Hauling of the first course begins');
  sim.sched.spawn(tunnelling(sim), 'tunnel');
  sim.spoilers.forEach((w, j) => sim.sched.spawn(spoilCarrier(sim, w, j), 'spoil'));
  sim.rampReady = true;
  // send the levelling hands back to their posts
  sim.rampCrew.forEach((w, j) => sim.sched.spawn(walk(w, [v3(18 + j * 0.8, 0, 13)], 1.3, 'walk')));
  sim.teams[0].members.forEach((w, j) => sim.sched.spawn(walk(w, [sim.teams[0].depot.clone().add(v3((j % 2) * 0.7, 0, 1 + Math.floor(j / 2) * 0.9))], 1.3, 'walk')));
}

// ---- haul teams ------------------------------------------------------------
function* teamIdle(sim, team) {
  while (true) {
    yield* until(() => team.active && !team.job);
    if (team.away !== undefined && team.away !== null) {
      yield* wait(2.5);
      if (!team.job) {
        team.homing = true;
        const sled = team.sled;
        yield* sim.dragSled(team.members, sled, [sled.pos.clone(), ...groundRoute.home(sim, sled, team.depot.clone().add(v3(-1.5, 0, 0)))], 1.5, 'empty');
        team.homing = false;
      }
      team.away = null;
      continue;
    }
    const p = team.pourer;
    // refill the water jar at the station between trips
    if ((p.water ?? 10) < 6 && sim.stocks.get('water') >= 2 && !p.walking && !team.job) {
      const ws = v3(SITE.waterStation.x + 0.5, 0, SITE.waterStation.z + 1.4);
      yield* walk(p, [ws], 1.3, 'walk');
      p.pose = 'kneel'; p.item = 'waterjar'; yield* wait(2.5);
      sim.stocks.take('water', 2); p.water = 10;
      yield* walk(p, [team.depot.clone().add(v3(1.6, 0, 0))], 1.3, 'walk');
    }
    if (!team.job) { team.members.forEach((w) => { if (!w.walking) w.pose = 'rest'; }); p.pose = 'rest'; }
    yield* wait(1);
  }
}

const QL = SITE.quarryLane;
export const sideOf = (lane) => (lane < 2 ? 1 : -1);
const laneRow = (lane) => lane % 2;
const NORTH_ROAD = -17;
const groundRoute = {
  // one-way circulation: east of the ramp foot, west along the quarry face, back to a ramp.
  // Teams on the west side come round the north of the site.
  viaNorth: (from) => (from.x < 12 ? [v3(from.x, 0, NORTH_ROAD), v3(14, 0, NORTH_ROAD)] : []),
  toQuarry: (sim, pile, from) => { const { xFoot } = sim.ramp(); const xe = Math.min(52, Math.max(34, xFoot + 12)); /* stay on land, short of the basin */ return [...groundRoute.viaNorth(from), v3(Math.max(from.x, xe), 0, Math.min(from.z, 8)), v3(xe, 0, 18), v3(xe, 0, QL), v3(pile.x + 3, 0, QL), v3(pile.x, 0, QL)]; },
  quarryToRamp: (sim, side) => {
    const { xFoot } = sim.ramp(); const xr = Math.max(16, xFoot + 9);
    return side > 0 ? [v3(-3, 0, QL), v3(-6, 0, 25), v3(-1, 0, 17), v3(xr, 0, 15)] : [v3(-3, 0, QL), v3(-8, 0, 27), v3(-xr, 0, 15)];
  },
  toYard: (sim, slot, from) => [...groundRoute.viaNorth(from), v3(Math.max(from.x, 40), 0, Math.min(from.z, -9)), v3(54, 0, -9), v3(54, 0, slot.z + 1.5), v3(slot.x, 0, slot.z + 1.5)],
  yardToRamp: (sim, slot, side) => {
    const { xFoot } = sim.ramp(); const xr = Math.max(16, xFoot + 9);
    return side > 0 ? [v3(40, 0, slot.z + 1.5), v3(xr, 0, -10)] : [v3(40, 0, slot.z + 1.5), v3(36, 0, NORTH_ROAD), v3(-xr + 4, 0, NORTH_ROAD), v3(-xr, 0, -10)];
  },
  home: (sim, sled, depot) => {
    const p = sled.pos;
    if (p.x < 12) { const { xFoot } = sim.ramp(); return [v3(Math.min(p.x, -(xFoot + 8)), 0, NORTH_ROAD), v3(14, 0, NORTH_ROAD), depot]; }
    return [v3(Math.max(p.x, 30), 0, Math.min(p.z, -12)), depot];
  },
};

export function* haulJob(sim, job) {
  const team = job.team, helper = job.helper;
  const gang = helper ? team.members.concat(helper.members) : team.members.slice();
  const sled = team.sled;
  const pourer = team.pourer;
  const t = job.target;
  const ranks = gang.length / 2;
  const s = sideOf(job.lane), lr = laneRow(job.lane);
  try {
    if (helper) yield* all(helper.members.map((w) => walk(w, [team.depot.clone()], 1.4, 'walk')));
    // 1. empty sled to the stone
    job.stage = 'toSource';
    let pickup;
    if (job.src === 'quarry') {
      yield* sim.dragSled(gang, sled, [sled.pos.clone(), ...groundRoute.toQuarry(sim, job.pile, sled.pos)], 1.9, 'empty');
      pickup = sim.quarryLoadRequests;
    } else {
      yield* sim.dragSled(gang, sled, [sled.pos.clone(), ...groundRoute.toYard(sim, job.slot, sled.pos)], 1.9, 'empty');
      pickup = sim.yardLoadRequests;
    }
    // 2. loaders lever the stone onto the sled (oriented for its final bed)
    const req = { item: job.item, sled, ready: true, loaded: false, loadYaw: predictLoadYaw(sim, t, job.lane) - sled.yaw, dress: t.kind === 'casing' || t.kind === 'corner' ? t.kind : null };
    pickup.push(req);
    job.stage = 'loading';
    gang.forEach((w) => { w.pose = 'rest'; });
    yield* until(() => req.loaded);
    if (job.pile) job.pile.item = null;
    if (job.slot) { job.slot.item = null; if (job.item.slot2) job.item.slot2.item = null; }
    if (t.special) sled.group.scale.set(1.25, 1, 1.45);
    // 3. haul to the ramp approach
    const lane = sim.lanes[job.lane];
    const road = job.src === 'quarry' ? groundRoute.quarryToRamp(sim, s) : groundRoute.yardToRamp(sim, job.slot, s);
    job.stage = 'toRamp';
    yield* sim.dragSled(gang, sled, [sled.pos.clone(), ...road], 1.25, 'loaded', pourer);
    job.stage = 'waitTurn';
    // wait for our turn on this lane (and for the ramp to reach our course)
    const turn = () => lane.queue[0] === job.seq && !lane.busy && sim.rampReady && t.L === sim.layer;
    if (!turn()) {
      const spot = parkingSpot(sim, job);
      yield* sim.dragSled(gang, sled, [sled.pos.clone(), spot, spot.clone().add(v3(-2.5 * s, 0, 0))], 0.9, 'loaded');
      gang.forEach((w) => { w.pose = 'rest'; }); pourer.pose = 'rest';
      yield* until(turn);
    }
    lane.busy = true;
    job.onRamp = true;
    lane.queue.shift();
    // 4. up the ramp lane to the landing
    job.stage = 'ascend';
    const { xFoot } = sim.ramp();
    const z = LANE_UP[lr];
    const stop = sim.landingStop(job.lane, ranks);
    const up = [sled.pos.clone(), v3(s * Math.max(Math.abs(sled.pos.x), xFoot + 6), 0, z), ...sim.lanePoints(z, s * (xFoot + 3), stop.x)];
    yield* sim.dragSled(gang, sled, up, 1.0, 'loaded', pourer);
    // 5. haulers step across to the down lane and wait; the setting crew takes over
    const { xTop } = sim.ramp();
    const dz = LANE_DOWN[lr];
    const handBack = v3(s * (xTop + 3.4), sim.rampH, dz);
    yield* all(gang.map((w, j) => {
      const ax = Math.abs(handBack.x) + 1.55 + Math.floor(j / 2) * 0.95 + 0.6;
      return walk(w, [v3(w.pos.x + 0.8 * s, sim.rampH, (w.pos.z + dz) / 2), v3(s * ax, sim.rampY(ax), dz + (j % 2 ? 0.33 : -0.33))], 1.1, 'walk');
    }));
    const px = xTop + RAMP_LANDING + 1.5;
    sim.sched.spawn(walk(pourer, [v3(s * px, sim.rampY(px), 0)], 1.2, 'walk'));
    gang.forEach((w) => { w.pose = 'rest'; w.yaw = -s * Math.PI / 2; });
    job.stage = 'setting';
    yield* setBlock(sim, job, sled, lane, handBack);
    job.stage = 'descend';
    // 6. haul the empty sled back down
    if (t.special) sled.group.scale.set(1, 1, 1);
    const xf = sim.ramp().xFoot;
    const down = [sled.pos.clone(), ...sim.lanePoints(dz, handBack.x + 0.1 * s, s * (xf + 4)).slice(1), v3(s * (xf + 8), 0, dz + (lr ? 4 : -4))];
    yield* sim.dragSled(gang, sled, down, 1.8, 'empty', pourer); // the water carrier comes down with them
    job.onRamp = false;
    team.away = sim.sched.time;
    if (helper) yield* all(helper.members.map((w, j) => walk(w, [...groundRoute.viaNorth(w.pos), helper.depot.clone().add(v3((j % 2) * 0.7, 0, 1 + Math.floor(j / 2) * 0.9))], 1.3, 'walk')));
  } finally {
    team.job = null;
    if (helper) { helper.job = null; helper.helping = null; }
  }
}

function parkingSpot(sim, job) {
  const { xFoot } = sim.ramp();
  const s = sideOf(job.lane);
  const j = job.seq % 6;
  const zs = laneRow(job.lane) ? 1 : -1;
  // a short row beside the ramp foot, kept on dry, open ground (clear of the stone yard and the harbour)
  const base = Math.min(Math.max(16, xFoot + 10), 38);
  return v3(s * (base + (j % 3) * 4.4), 0, zs * (9.6 + Math.floor(j / 3) * 1.6));
}

const entryCol = (L, s) => (s > 0 ? N - 1 - L : L);
const outerEdge = (L, s) => (s > 0 ? edgeX(N - L) : edgeX(L));

function finalApproach(sim, t, lane) {
  // returns { cells, yaw, row } — push path cells, the sled's final heading and the entry row used.
  // The crew prefers its own entry but may cross the landing to the other entry on the same ramp.
  const L = t.L, s = sideOf(lane), own = laneRow(lane);
  for (const r of [own, 1 - own]) {
    const row = ENTRY_ROWS[r];
    const cells = pushPath(L, t, row, otherReserved(sim, lane), s);
    if (!cells) continue;
    if (cells.length === 0) return { cells, yaw: -s * Math.PI / 2, row };
    const last = cells[cells.length - 1];
    return { cells, yaw: Math.atan2(cx(t.i) - cx(last[0]), cz(t.k) - cz(last[1])), row };
  }
  return null;
}
function predictLoadYaw(sim, t, lane) {
  const fa = finalApproach(sim, t, lane);
  const yaw = fa ? fa.yaw : -sideOf(lane) * Math.PI / 2;
  return (t.rot || 0) - yaw;
}

function otherReserved(sim, lane) {
  const set = new Set();
  sim.lanes.forEach((l, n) => { if (n !== lane && l.crew.reserved) for (const c of l.crew.reserved.cells) set.add(c); });
  return set;
}

export function reachableFromSide(L, t, side) {
  if (L === LAYERS - 1) return true;
  return ENTRY_ROWS.some((r) => pushPath(L, t, r, null, side) !== null);
}

// would placing t leave every other unset block of its course reachable from a landing?
function placementSafe(sim, t, lane) {
  if (t.special) return true;
  const L = t.L;
  const tmp = [t];
  sim.lanes.forEach((l, n) => { const r = l.crew.reserved; if (n !== lane && r && r.target && !r.target.special) tmp.push(r.target); });
  tmp.forEach((b) => { b.placed = true; });
  const seen = new Set();
  const q = [];
  const entries = [];
  if (L < LAYERS - 1) for (const s of sim.westRetired ? [1] : [1, -1]) for (const r of ENTRY_ROWS) entries.push([entryCol(L, s), r]);
  for (const [i, k] of entries) if (supportSolid(L, i, k) && !getBlock(L, i, k)?.placed) { seen.add(`${i},${k}`); q.push([i, k]); }
  while (q.length) {
    const [i, k] = q.shift();
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nk = k + dk, key = `${ni},${nk}`;
      if (seen.has(key) || !inLayer(L, ni, nk) || !supportSolid(L, ni, nk) || getBlock(L, ni, nk)?.placed) continue;
      seen.add(key); q.push([ni, nk]);
    }
  }
  let ok = true;
  for (const b of blocks) {
    if (b.L !== L || b.placed) continue;
    if (entries.some(([i, k]) => b.i === i && b.k === k)) continue;
    if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dk]) => seen.has(`${b.i + di},${b.k + dk}`))) { ok = false; break; }
  }
  // stones already on their way must still be reachable from the ramp their team is using
  if (ok) {
    for (const tm of sim.teams) {
      const j = tm.job;
      if (!j || tm.helping || !j.target || j.target === t || j.target.special || j.target.L !== L || j.target.placed) continue;
      if (!reachableFromSide(L, j.target, sideOf(j.lane))) { ok = false; break; }
    }
  }
  tmp.forEach((b) => { b.placed = false; });
  return ok;
}

// swap a stuck stone onto another unset block of the same kind that can be set safely now
function swapTarget(sim, job) {
  const t = job.target;
  if (t.special) return false;
  // the cheap filters first, and only a handful of full safety checks per attempt
  let budget = 10;
  const ok = (c) => c.L === t.L && c.kind === t.kind && !c.special && !c.placed && budget-- > 0 && placementSafe(sim, c, job.lane) && finalApproach(sim, c, job.lane);
  const cand = sim.queue.find((c) => c.L === t.L && c.kind === t.kind && ok(c));
  if (!cand) {
    // trade targets with a team that has not yet climbed its ramp
    const other = sim.teams.map((tm) => tm.job).find((j) => j && j !== job && !j.onRamp && j.target && ok(j.target));
    if (!other) return false;
    const mine = job.target;
    job.target = other.target; other.target = mine;
    return true;
  }
  sim.queue.splice(sim.queue.indexOf(cand), 1);
  let idx = sim.queue.findIndex((c) => c.L > t.L || (c.L === t.L && c.dist < t.dist));
  if (idx < 0) idx = sim.queue.length;
  sim.queue.splice(idx, 0, t);
  // hand the returned block to a lane that can actually reach it
  for (let l = 0; l < 4; l++) if (pushPath(t.L, t, ENTRY_ROWS[l % 2], null, sideOf(l))) { t.lane = l; break; }
  cand.lane = job.lane;
  job.target = cand;
  return true;
}

function* setBlock(sim, job, sled, lane, handBack) {
  const crew = lane.crew;
  let t = job.target;
  const s = sideOf(job.lane), lr = laneRow(job.lane);
  job.stage = 'waitCrew';
  yield* until(() => !crew.busy);
  crew.busy = true;
  job.stage = 'crewWalk';
  const men = crew.members;
  // crew comes up behind the sled
  const back = (j) => {
    const yaw = sled.yaw;
    const f = v3(Math.sin(yaw), 0, Math.cos(yaw)), r = v3(Math.cos(yaw), 0, -Math.sin(yaw));
    return sled.pos.clone().addScaledVector(f, -1.05 - (j === 3 ? 0.85 : 0)).addScaledVector(r, j === 3 ? 0 : (j - 1) * 0.38);
  };
  yield* all(men.map((w, j) => walk(w, [v3(w.pos.x, sim.rampY(w.pos.x), w.pos.z * 0.5), back(j)], 1.4, 'walk')));
  men.forEach((w) => { w.yaw = sled.yaw; w.pose = 'idle'; });
  // mortar for the bed joint, and a clear, safe path
  let fa = null;
  job.stage = 'waitSafe';
  let tCheck = 0, waited = 0;
  while (true) {
    const dt = yield; tCheck -= dt; waited += dt;
    if (tCheck > 0) continue;
    tCheck = 0.4;
    if (sim.stocks.get('landingMortar') <= 0) { sim.waitingFor = 'mortar'; continue; }
    fa = placementSafe(sim, t, job.lane) ? finalApproach(sim, t, job.lane) : null;
    if (fa) break;
    if (waited > 6 && swapTarget(sim, job)) { t = job.target; waited = 0; }
  }
  sim.mortarUses = (sim.mortarUses || 0) + 1;
  if (sim.mortarUses >= 6) { sim.mortarUses = 0; sim.stocks.take('landingMortar', 1); }
  const L = t.L, y = L * B;
  const ez = cz(fa.row);
  const xo = outerEdge(L, s);
  crew.reserved = { cells: new Set(fa.cells.map(([i, k]) => `${i},${k}`).concat(`${t.i},${t.k}`)), target: t };
  // push path: landing -> entry cell -> ... -> cell next to the target
  const pts = [sled.pos.clone()];
  if (fa.row !== ENTRY_ROWS[lr]) pts.push(v3(xo + s * 2.0, y, cz(ENTRY_ROWS[lr])), v3(xo + s * 1.6, y, ez));
  if (fa.cells.length === 0) pts.push(v3(xo + s * 0.66, y, ez));
  else { pts.push(v3(xo + s * 0.9, y, ez)); for (const [i, k] of fa.cells) pts.push(v3(cx(i), y, cz(k))); }
  const path = new Path(pts);
  // pushers keep to the cells the sled has already passed through, so they never cut a corner
  const behind = (j, d) => {
    const at = d - 1.05 - (j === 3 ? 0.85 : 0), yaw = path.yaw(at, 0.4);
    return path.at(at).add(v3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(j === 3 ? 0 : (j - 1) * 0.36));
  };
  let d = 0, released = false;
  job.stage = 'push';
  men.forEach((w) => { w.pose = 'push'; });
  while (d < path.length) {
    const dt = yield;
    d = Math.min(path.length, d + 0.85 * sim.speedMul() * dt);
    sim.placeSled(sled, path, d);
    men.forEach((w, j) => { w.pos.copy(behind(j, d)); w.yaw = path.yaw(d, 0.4); });
    if (!released && d > 4) { released = true; lane.busy = false; } // landing is clear for the next team
  }
  if (!released) lane.busy = false;
  yield* sim.turnSled(sled, fa.yaw, 0.8);
  men.forEach((w) => { w.pose = 'idle'; });
  // lever from directly behind the stone if that cell is open, otherwise from the cell they came from
  const last = fa.cells[fa.cells.length - 1];
  let leverFrom = null;
  if (last) {
    const ri = last[0] - Math.round(Math.sin(fa.yaw)), rk = last[1] - Math.round(Math.cos(fa.yaw));
    const rearOpen = !inLayer(L, ri, rk) || (supportSolid(L, ri, rk) && !getBlock(L, ri, rk)?.placed);
    if (!rearOpen) leverFrom = pts[pts.length - 2].clone();
  }
  // lever the stone forward into its bed
  const target = t.special ? v3(cx(6) + 0.2, 2 * B, cz(11)) : v3(cx(t.i), y, cz(t.k));
  job.stage = 'lever';
  const mesh = yield* sim.leverOff(men, sled, target, t.rot || 0, t.special ? 8 : 4.5, leverFrom);
  if (t.special) {
    t.placed = true; [10, 11, 12].forEach((k) => obstacles.add(`2,6,${k}`));
    sim.sarcophagusMesh = mesh;
    mesh.userData.inspect = { name: 'Granite sarcophagus', detail: 'Cut from Aswan granite; hauled in before the chamber was roofed, because it is too wide for the passages' };
    sim.note('The granite sarcophagus is set in the upper chamber');
  } else {
    mesh.parent?.remove(mesh);
    sim.pyramid.place(t);
  }
  sim.onPlaced(t);
  crew.reserved = { cells: new Set(fa.cells.map(([i, k]) => `${i},${k}`)), target: null };
  // two men pull the empty sled back to the down lane; two walk back
  const backPts = [sled.pos.clone(), ...fa.cells.slice().reverse().map(([i, k]) => v3(cx(i), y, cz(k))), v3(xo + s * 0.7, y, ez), v3(handBack.x - s * 1.2, y, ez + (LANE_DOWN[lr] - ez) * 0.4), handBack];
  const pullers = men.slice(0, 2);
  const others = men.slice(2);
  const idle = (j) => { const ax = sim.ramp().xTop + 2.2 + j * 0.5; return v3(s * ax, sim.rampH, lr ? 0.4 : -0.4); };
  sim.sched.spawn(all(others.map((w, j) => walk(w, [...backPts.slice(1, -1), idle(j + 2)], 1.2, 'walk'))));
  job.stage = 'return';
  yield* sim.dragSled(pullers, sled, new Path(backPts), 1.4, 'empty');
  crew.reserved = null;
  yield* all(pullers.map((w, j) => walk(w, [idle(j)], 1.3, 'walk')));
  men.forEach((w) => { w.pose = 'rest'; });
  crew.busy = false;
}

// ---- quarry ----------------------------------------------------------------
function* quarryPair(sim, pair) {
  const [a, b] = pair.men;
  const fx = pair.face.x, fz = pair.face.z;
  while (true) {
    const slot = sim.quarry.pile.filter((p) => !p.item && !p.reserved).sort((p, q) => Math.abs(p.x - fx) - Math.abs(q.x - fx))[0];
    if (!slot || Math.abs(slot.x - fx) > 7 || sim.stocks.get('tools') <= 0) {
      if (sim.stocks.get('tools') <= 0) sim.waitingFor = 'copper tools';
      a.pose = b.pose = 'rest'; a.item = b.item = null; yield* wait(2); continue;
    }
    slot.reserved = true;
    // the block is freed from the bench by cutting channels around it with copper chisels
    const mesh = sim.makeStoneMesh('limestone');
    mesh.position.set(fx, 0, fz + 0.62);
    sim.scene.add(mesh);
    yield* all([walk(a, [v3(fx - 0.8, 0, fz - 1.0)], 1.2, 'walk'), walk(b, [v3(fx + 0.8, 0, fz - 1.0)], 1.2, 'walk')]);
    a.yaw = b.yaw = 0; a.pose = b.pose = 'chisel'; a.item = b.item = 'mallet';
    let p = 0;
    while (p < 1) {
      const dt = yield;
      p += dt / 18 * sim.speedMul();
      mesh.position.z = fz + 0.62 - Math.min(1, p) * 0.62;
    }
    sim.toolWear = (sim.toolWear || 0) + 1;
    if (sim.toolWear >= 2) { sim.toolWear = 0; sim.stocks.take('tools', 1); }
    a.item = b.item = null;
    // lever it out of its bed and on to the pile in short strokes
    const lb = [a, b].map((w, j) => ({ w, end: () => mesh.position.clone().add(v3(j ? 0.4 : -0.4, 0.1, 0.5)) }));
    const from = mesh.position.clone(), to = v3(slot.x, 0, slot.z);
    const dir = to.clone().sub(from).normalize();
    a.pose = b.pose = 'lever';
    lb.forEach((x) => sim.leverBindings.add(x));
    let t = 0;
    while (t < 1) {
      const dt = yield; t += dt / 8;
      const tt = Math.min(1, t);
      const e = (Math.floor(tt * 6) + Math.min(1, ((tt * 6) % 1) * 1.6)) / 6;
      mesh.position.lerpVectors(from, to, Math.min(1, e));
      const back = mesh.position.clone().addScaledVector(dir, -1.15);
      const side = v3(-dir.z, 0, dir.x);
      a.pos.copy(back).addScaledVector(side, -0.45); b.pos.copy(back).addScaledVector(side, 0.45);
      a.yaw = b.yaw = Math.atan2(dir.x, dir.z);
    }
    lb.forEach((x) => sim.leverBindings.delete(x));
    slot.item = { material: 'limestone', mesh, claimed: false };
    slot.reserved = false;
    a.pose = b.pose = 'idle';
  }
}

function* yardLoaders(sim) {
  const loaders = sim.yardLoaders;
  while (true) {
    const req = sim.yardLoadRequests.shift();
    if (!req) { loaders.forEach((w) => { if (!w.walking) w.pose = 'rest'; }); yield* wait(0.5); continue; }
    if (req.dress) yield* dressStone(sim, req.item.mesh, req.dress);
    yield* sim.loadOntoSled(loaders, req);
  }
}

// Casing stones arrive from Tura as squared blocks. Before one is hauled, two masons cut
// its outer face back to the pyramid's slope, now that its place (edge or corner) is known.
function* dressStone(sim, mesh, kind) {
  const [a, b] = sim.masons;
  const p = mesh.position;
  yield* all([walk(a, [v3(p.x - 0.45, 0, p.z - 1.05)], 1.3, 'walk'), walk(b, [v3(p.x + 0.45, 0, p.z - 1.05)], 1.3, 'walk')]);
  a.yaw = b.yaw = 0; a.pose = b.pose = 'chisel'; a.item = b.item = 'mallet';
  let t = 0;
  while (t < 1) {
    const dt = yield;
    t = Math.min(1, t + dt / 12 * sim.speedMul());
    mesh.geometry = dressedGeometry(kind, t);
  }
  a.item = b.item = null;
  sim.sched.spawn(all([walk(a, [v3(44.2, 0, -9.4)], 1.3, 'walk'), walk(b, [v3(45, 0, -9.4)], 1.3, 'walk')]));
}

function* quarryLoaders(sim, loaders) {
  while (true) {
    const req = sim.quarryLoadRequests.shift();
    if (!req) { loaders.forEach((w) => { if (!w.walking) w.pose = 'rest'; }); yield* wait(0.5); continue; }
    yield* sim.loadOntoSled(loaders, req);
  }
}

// ---- carpentry: sleds from imported timber -----------------------------------
function* carpentry(sim) {
  const [a, b] = sim.carpenters;
  const bench = v3(SITE.workshop.x, 0, SITE.workshop.z);
  while (true) {
    const next = sim.teams.find((t) => !t.active && !t.sled && !t.building);
    if (!next || sim.stocks.get('timber') < 2) { a.pose = b.pose = 'rest'; yield* wait(2); continue; }
    sim.stocks.take('timber', 2);
    next.building = true;
    const store = v3(SITE.store.x - SITE.store.w / 2 - 1.5, 0, SITE.store.z);
    yield* all([a, b].map((w, j) => (function* () {
      yield* walk(w, [store.clone().add(v3(0, 0, j))], 1.35, 'walk', sim.speedMul);
      w.item = 'beam'; w.pose = 'carryShoulder';
      yield* walk(w, [bench.clone().add(v3(j ? 1.3 : -1.3, 0, 0))], 1.2, 'carryShoulder', sim.speedMul);
      w.item = null;
    })()));
    const sled = new Sled(sim.scene);
    sled.pos.copy(bench); sled.yaw = 0; sled.sync();
    sled.group.scale.set(1, 0.05, 0.4);
    a.pose = b.pose = 'kneel'; a.item = b.item = 'mallet';
    a.yaw = Math.PI / 2; b.yaw = -Math.PI / 2;
    let t = 0;
    while (t < 1) { const dt = yield; t += dt / 30 * sim.speedMul(); sled.group.scale.set(1, Math.min(1, 0.05 + t), Math.min(1, 0.4 + t)); }
    sled.group.scale.set(1, 1, 1);
    a.item = b.item = null; a.pose = b.pose = 'idle';
    next.sled = sled;
    sim.note(`Carpenters finish a sled: haul team ${next.id + 1} joins`);
    // the new team walks over from the camp and drags its sled to the depot
    yield* all(next.members.concat(next.pourer).map((w) => walk(w, [bench.clone().add(v3(3, 0, 2))], 1.4, 'walk')));
    sim.sched.spawn((function* () {
      yield* sim.dragSled(next.members, sled, [sled.pos.clone(), v3(bench.x + 6, 0, bench.z), v3(bench.x + 8, 0, -17), v3(10, 0, -17), next.depot.clone().add(v3(-1.5, 0, 0))], 1.3, 'empty');
      yield* walk(next.pourer, [next.depot.clone().add(v3(1.6, 0, 0))], 1.3, 'walk');
      next.active = true;
    })());
  }
}

// ---- water supply ------------------------------------------------------------
function* waterCarrier(sim, w, j) {
  const well = v3(SITE.quayX - 0.6, 0.15, 9 + j * 1.2);
  const station = v3(SITE.waterStation.x + 1.5 + j, 0, SITE.waterStation.z - 1.1);
  while (true) {
    if (sim.stocks.get('water') > 90) { w.pose = 'rest'; yield* wait(3); continue; }
    yield* walk(w, [v3(48, 0, 4), well], 1.35, 'walk', sim.speedMul);
    w.yaw = Math.PI / 2; w.pose = 'kneel'; w.item = 'waterjar'; yield* wait(2.5);
    w.pose = 'carryShoulder';
    yield* walk(w, [v3(48, 0, 4), v3(30, 0, -8), station], 1.15, 'carryShoulder', sim.speedMul);
    w.pose = 'pour'; yield* wait(2.2);
    w.item = null; sim.stocks.add('water', 8);
  }
}

// ---- mortar to the working course -------------------------------------------------
function* mortarPorter(sim, w, j) {
  const store = v3(SITE.store.x - SITE.store.w / 2 - 1.5, 0, SITE.store.z - 0.5 + j);
  while (true) {
    if (sim.stocks.get('landingMortar') >= 6 || sim.phase !== 'building' || !sim.rampReady) { if (!w.walking) w.pose = 'rest'; yield* wait(2); continue; }
    if (sim.stocks.get('mortar') <= 0) { sim.waitingFor = 'mortar'; yield* wait(2); continue; }
    yield* walk(w, [store], 1.35, 'walk', sim.speedMul);
    sim.stocks.take('mortar', 1);
    w.item = 'jar'; w.pose = 'carryShoulder';
    const sd = j % 2 && !sim.westRetired ? -1 : 1; // one porter serves each landing
    const { xFoot, xTop } = sim.ramp();
    const dest = sd * (xTop + 2.4 + (j * 0.5));
    const approach = sd > 0 ? [v3(xFoot + 5, 0, 6)] : [v3(12, 0, -17), v3(-(xFoot + 5), 0, -17), v3(-(xFoot + 5), 0, -6)];
    yield* walk(w, [...approach, ...sim.lanePoints(0, sd * (xFoot + 2), dest)], 1.1, 'carryShoulder', sim.speedMul);
    w.pose = 'lever'; yield* wait(0.8);
    w.item = null; sim.stocks.add('landingMortar', 1);
    const back = sim.ramp();
    yield* walk(w, [...sim.lanePoints(0, w.pos.x, sd * (back.xFoot + 2)).slice(1), ...approach.slice().reverse(), store], 1.35, 'walk', sim.speedMul);
  }
}

// ---- harbour master: orders boats to keep materials flowing ------------------------
function* harbourMaster(sim) {
  const H = sim.harbour;
  const need = (mat) => {
    // blocks of a material still to be hauled in the current and next two courses
    let n = 0;
    for (const b of blocks) if (!b.placed && b.L <= sim.layer + 2 && (mat === 'tura' ? b.material === 'tura' : b.material === mat)) n++;
    return n;
  };
  const timers = { cargo: 0 };
  yield* wait(2);
  H.dispatchBoat('cargo', [{ type: 'timber', n: 6 }, { type: 'mortar', n: 8 }, { type: 'food', n: 6 }, { type: 'tools', n: 3 }], 'north');
  yield* wait(25);
  H.dispatchBoat('barge', [{ type: 'tura', n: 8 }], 'south');
  while (true) {
    yield* wait(6);
    const busy = H.boats.filter((b) => b.busy).length;
    if (busy >= 4) continue;
    const yardTura = H.yardCount('tura') + (sim.inTransit.tura || 0);
    const yardGranite = H.yardCount('granite') + (sim.inTransit.granite || 0);
    const freeSlots = H.slots.filter((x) => !x.item && !x.reserved).length - (sim.inTransit.tura || 0) - (sim.inTransit.granite || 0) - (sim.inTransit.sarcophagus || 0) * 2 - (sim.inTransit.cap || 0);
    // the sarcophagus is set first on course 3, so it is shipped late in course 2
    if (!sim.sarcophagusOrdered && sim.layer >= 1 && sim.layerRemaining[1] < 70 && freeSlots >= 2) {
      sim.sarcophagusOrdered = true;
      H.dispatchBoat('barge', [{ type: 'sarcophagus', n: 1 }], 'south');
      sim.note('A barge brings the granite sarcophagus from Aswan');
      continue;
    }
    // order what the next courses will need, always keeping yard room for granite
    const soon = (mat) => blocks.filter((b) => !b.placed && b.L <= sim.layer + 1 && b.material === mat).length;
    const turaNeed = soon('tura'), granNeed = soon('granite');
    const graniteRoom = granNeed > yardGranite ? Math.min(6, granNeed - yardGranite) : 0;
    if (granNeed > yardGranite && yardGranite < 6 && freeSlots >= 1 && (sim.waitingFor === 'granite' || freeSlots >= 3)) {
      H.dispatchBoat('barge', [{ type: 'granite', n: Math.min(6, freeSlots, granNeed - yardGranite) }], 'south');
      continue;
    }
    const turaCap = graniteRoom > 0 ? 8 : 12;
    const turaRoom = Math.min(8, turaCap - yardTura, freeSlots - graniteRoom, turaNeed - yardTura);
    if (turaRoom >= (sim.waitingFor === 'tura' ? 1 : 4)) {
      H.dispatchBoat('barge', [{ type: 'tura', n: turaRoom }], 'south');
      continue;
    }
    if (!sim.capOrdered && sim.layer >= 6) {
      sim.capOrdered = true;
      H.dispatchBoat('barge', [{ type: 'cap', n: 1 }, { type: 'goods', n: 6 }, { type: 'statue', n: 2 }], 'south');
      sim.note('The gilded capstone and the burial goods are on their way');
      continue;
    }
    timers.cargo -= 6;
    const st = sim.stocks;
    const low = st.get('mortar') + (sim.inTransit.mortar || 0) < 16 || st.get('food') + (sim.inTransit.food || 0) * 30 < 160 ||
      st.get('tools') + (sim.inTransit.tools || 0) * 20 < 16 || ((st.get('timber') + (sim.inTransit.timber || 0) < 4 && sim.teams.some((t) => !t.active)) || st.get('timber') + (sim.inTransit.timber || 0) < deckCells.filter((b) => b.L > sim.layer).length);
    if (low && timers.cargo <= 0 && sim.phase !== 'complete') {
      timers.cargo = 40;
      const m = [];
      if (st.get('mortar') < 24) m.push({ type: 'mortar', n: 12 });
      if (st.get('food') < 220) m.push({ type: 'food', n: 5 }, { type: 'beer', n: 3 });
      if (st.get('tools') < 30) m.push({ type: 'tools', n: 3 });
      if (sim.teams.some((t) => !t.active) || st.get('timber') < deckCells.filter((b) => b.L > sim.layer).length) m.push({ type: 'timber', n: 4 });
      if (m.length) H.dispatchBoat('cargo', m, random() < 0.5 ? 'north' : 'south');
    }
  }
}

// The harbour master meets each boat at its berth and directs the unloading; a scribe
// at the storehouse door tallies what comes in.
function* harbourOfficials(sim) {
  const hm = sim.harbourMaster, scribe = sim.scribe;
  const home = v3(53.6, 0.15, -6.5);
  scribe.yaw = Math.PI; scribe.pose = 'kneel';
  while (true) {
    const boat = sim.harbour.boats.find((b) => b.docked && b.cargo.length);
    if (boat) {
      const spot = v3(53.6, 0.15, boat.docked.z - 10);
      if (hm.pos.distanceTo(spot) > 0.5) yield* walk(hm, [v3(52.6, 0.15, (hm.pos.z + spot.z) / 2), spot], 1.2, 'walk');
      hm.yaw = Math.PI / 2 + 0.5; hm.pose = 'point';
    } else {
      const waiting = sim.harbour.boats.some((b) => b.anchored || (b.busy && b.group.visible && !b.docked));
      if (hm.pos.distanceTo(home) > 0.5) yield* walk(hm, [home], 1.2, 'walk');
      hm.yaw = Math.PI / 2; hm.pose = waiting ? 'point' : 'rest';
    }
    yield* wait(2);
  }
}

function* overseers(sim) {
  const [a, b] = sim.overseers;
  while (true) {
    const { xFoot } = sim.ramp();
    const target = v3(Math.max(16, xFoot + 3), 0, 8.5);
    if (a.pos.distanceTo(target) > 2) yield* walk(a, [target], 1.1, 'walk');
    a.pose = 'point'; a.yaw = -Math.PI / 2 - 0.4;
    b.pose = 'point'; b.yaw = -Math.PI / 2 - 0.3;
    yield* wait(5);
  }
}

export { raiseRamp, finishWorks };
