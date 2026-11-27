// Guided tour of the 20-year build (Phase 7). It follows the timeline's milestones: the first
// course, the Queen's Chamber roofed, the ramps changing (or, for a theory with no switch,
// what it offers instead), the King's Chamber roofed and the capstone set. At each stop:
//  - travel: the camera swings round to a wide view of the place while the timeline races
//    ahead to the stop (the pyramid rises during the move);
//  - wait: the worker is asked for that exact time, so the gangs of that moment are known;
//  - approach: the timeline plays at 1× while the camera closes in on a gang that is hauling
//    (a ramp stop) or circles the room (a room stop);
//  - hold: a few more seconds at 1×, the camera following the gang, then on to the next stop.
// After the finished monument, a walk inside: the camera comes down to the entrance on the
// north face and becomes the walker, which glides down the descending passage, up the
// ascending passage and the Grand Gallery, through the antechamber into the King's Chamber;
// then cuts to a look round the Queen's Chamber and the subterranean chamber.
// Then out again, X-ray off, for one slow circle round the finished pyramid.
// No DOM here: main.js gives it the timeline, the worker client, the bubble, the camera and
// a few switches, and draws the captions it returns.
import * as THREE from 'three';
import { HALF, HEIGHT, COURSES, ELEMENTS, LEVELS, SPOTS, AXIS_X, floorY } from './data.js';
import { ACT } from './sim/gangs.js';
import { DEFAULTS, DAY, YEAR, YEAR_DAYS } from './sim/params.js';

export const TRAVEL = 4.5, APPROACH = 3, HOLD = 7, CROWN = 6, OUTRO = 5, DOOR = 3.5, RISE = 3, CIRCLE = 28; // seconds of wall time
// the closing circle: radius and height of the camera, and the height it looks at
const RING = { r: 430, y: 120, look: 50 };
const WAIT_MAX = 6; // give up waiting for the worker after this long and carry on
const ease = (u) => u * u * (3 - 2 * u);
// share of a leg's length covered at time u: speeding up over the first `a`, a steady pace,
// slowing down over the last `a` (the top speed is 1 / (1 - a) of the average)
const glide = (u, a = 0.15) => {
  const v = 1 / (1 - a); // top speed, in lengths per leg
  if (u < a) return (v * u * u) / (2 * a);
  if (u > 1 - a) return 1 - (v * (1 - u) * (1 - u)) / (2 * a);
  return v * (u - a / 2);
};
const lerp = (a, b, u) => a + (b - a) * u;
const angLerp = (a, b, u) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * u; };
const yearOf = (t) => Math.floor(t / YEAR) + 1;
const dayOf = (t) => Math.floor(t / DAY) + 1;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

// height of the bed being laid at time t, from the run's course times
export function topAt(S, t) {
  let ci = 0;
  for (let i = 0; i < S.courseOpen.length; i++) if (S.courseOpen[i] >= 0 && S.courseOpen[i] <= t) ci = i;
  return COURSES[ci].y0;
}
// a little below a room's X-ray label (null if there is no such room, and its stop is skipped)
const roomAt = (id) => { const el = ELEMENTS.find((e) => e.id === id); return el?.label ? new THREE.Vector3(el.label[0], el.label[1] - 3, el.label[2]) : null; };

// ---- the walk inside --------------------------------------------------------------
const EYE = 1.62; // the walker's eye above its feet, standing
// a polyline through 3D points (the walker's feet), measured along its length
class Path {
  constructor(pts) {
    this.pts = pts.map((p) => new THREE.Vector3(...p));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum.at(-1);
  }
  at(d, out = new THREE.Vector3()) {
    d = Math.max(0, Math.min(this.length, d));
    let i = 1;
    while (i < this.pts.length - 1 && this.cum[i] < d) i++;
    const a = this.cum[i - 1], b = this.cum[i];
    return out.lerpVectors(this.pts[i - 1], this.pts[i], b > a ? (d - a) / (b - a) : 1);
  }
}
// heading that looks from a toward b (the walker looks along (-sin yaw, -cos yaw))
const faceYaw = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

// The legs of the walk, each with its caption. The floors are the rooms' own (data.js), so
// the feet stay on them: every passage floor is a straight slope along the axis.
export function walkLegs() {
  const el = (id) => ELEMENTS.find((e) => e.id === id), L = LEVELS, X = AXIS_X;
  const D = el('descending').voids[0], A = el('ascending').voids[0], G = el('gallery').voids[0];
  const dy = (z) => floorY(D, z), ay = (z) => floorY(A, z), gy = (z) => floorY(G, z);
  const door = SPOTS.find((s) => s.key === 'entrance').pos, king = SPOTS.find((s) => s.key === 'king').pos;
  const KC = L.kingsChamber, kf = KC.y0, sarc = el('king').sarcophagus, QC = L.queensChamber, SUB = L.subterranean;
  const queen = SPOTS.find((s) => s.key === 'queen'), sub = SPOTS.find((s) => s.key === 'subterranean');
  // up through the hole where the ascending passage leaves the descending passage's roof:
  // straight up where the whole body fits in the hole, onto the ascending floor's line
  const zHole = L.ascendingStartZ - 0.35;
  // the great step is climbed straight up where the gallery floor and the step overlap
  const gz0 = L.galleryFoot.z, gz1 = L.galleryTop.z - 0.03, zStep = L.greatStepSouth - 0.2;
  const note = (id) => el(id).note.replace(/;/g, ',');
  return [
    { dur: 7, path: new Path([door, [X, L.entranceSill, L.entranceZ], [X, dy(zHole), zHole]]),
      title: 'Walking in', sub: `The entrance is on the north face, ${L.entranceSill.toFixed(0)} m up. The descending passage drops at 26°, only 1.05 m wide and 1.2 m high.` },
    { dur: 8, path: new Path([[X, dy(zHole), zHole], [X, ay(zHole), zHole], [X, ay(gz0), gz0]]),
      title: 'The ascending passage', sub: 'It leaves through the roof of the descending passage and climbs at 26°. The granite plugs that seal its lower end are left out, so it can be walked.' },
    { dur: 9, path: new Path([[X, gy(gz0), gz0], [X, gy(gz1), gz1], [X, kf, gz1], [X, kf, zStep]]),
      title: 'The Grand Gallery', sub: `${note('gallery')}. At its top, the great step.` },
    { dur: 5, path: new Path([[X, kf, zStep], [X, kf, KC.z0 + 0.4], king]),
      title: 'The antechamber', sub: `${note('antechamber')}.` },
    { dur: 5, look: new THREE.Vector3(sarc.x, kf + 0.6, sarc.z), at: new THREE.Vector3(...king),
      title: "The King's Chamber", sub: `${note('king')}. The sarcophagus stands at its west end.` },
    // cuts (cut: the walker is put there, facing yaw0) to the two rooms off the way up
    { dur: 5.5, cut: true, yaw0: queen.yaw, at: new THREE.Vector3(...queen.pos),
      look: new THREE.Vector3(QC.x1, QC.y0 + 1.8, 0.6), // the niche in the east wall
      title: "The Queen's Chamber", sub: `${note('queen')}. It lies off the foot of the Grand Gallery, along a low horizontal passage.` },
    { dur: 5.5, cut: true, yaw0: Math.PI, at: new THREE.Vector3(...sub.pos),
      look: new THREE.Vector3((SUB.x0 + SUB.x1) / 2 - 3, SUB.y0 + 1.5, (SUB.z0 + SUB.z1) / 2), // toward the uncut west half
      title: 'The subterranean chamber', sub: `${note('subterranean')}. It is 30 m under the base, at the bottom of the descending passage.` },
  ];
}

// The stops for a finished run (summary from the worker) and its ramp theory. A stop whose
// milestone is missing is left out (for the spiral's stand-in too): each stop is only built
// from a milestone that exists.
export function tourStops(S, theoryId = 'straight-zigzag') {
  const R = DEFAULTS.ramp, find = (label) => S.milestones.find((m) => m.label === label);
  const span = APPROACH + HOLD; // working seconds played at 1× in a stop
  const stops = [];
  const add = (m, make) => { if (!m) return; const s = make(m); if (s && Number.isFinite(s.t) && (s.kind !== 'room' || s.room)) stops.push({ milestone: m.label, ...s }); };
  const first = find('First course complete');
  add(first, (m) => ({
    kind: 'gang', t: m.t, angle: 0.75, xray: false,
    title: (t) => `Year ${yearOf(t)}: the first course`,
    sub: (t) => `Gangs of ${DEFAULTS.haul.crew} drag each block on a sled from the quarry south of the plateau, along a wetted track. Course 1 was finished on working day ${fmt(dayOf(m.t))}; the second is under way.`,
  }));
  const queen = find("Queen's Chamber roofed");
  // a room stop starts a little before its milestone, so the roof is finished while it plays
  add(queen, (m) => ({
    kind: 'room', t: m.t - span + 1, room: roomAt('queen'), angle: 2.3, xray: true,
    title: (t) => `Year ${yearOf(t)}: the Queen's Chamber roofed`,
    sub: (t) => `The chamber is roofed as the courses rise round it; the masonry stands ${topAt(S, t).toFixed(0)} m high. Seen in X-ray.`,
  }));
  // the ramp stop comes a few courses after the switch, once the new ramp has some length
  // and gangs are on it (minY: watch a gang above this height)
  const sw = S.milestones.find((m) => m.kind === 'ramp' && !m.top);
  const after = (y) => { const ci = COURSES.findIndex((c) => c.y0 >= y); return ci >= 0 && S.courseOpen[ci] >= 0 ? S.courseOpen[ci] : sw.t; };
  if (sw && theoryId === 'internal') {
    add(sw, () => ({
      kind: 'gang', t: after(R.switchY + 4), angle: 3.6, xray: true, minY: R.switchY + 0.5,
      title: (t) => `Year ${yearOf(t)}: into the internal ramp`,
      sub: () => `Above ${R.switchY} m the straight ramps are given up. Sleds climb a gallery inside the masonry, ${R.internal.inset} m in from the face at 1 in ${Math.round(1 / R.internal.grade)}, and are turned with levers at each corner. Seen in X-ray.`,
    }));
  } else if (sw) {
    add(sw, () => ({
      kind: 'gang', t: after(R.switchY + 6), angle: 0.4, xray: false, minY: R.switchY + 0.5,
      title: (t) => `Year ${yearOf(t)}: the zigzags begin`,
      sub: () => `At ${R.switchY} m the straight ramps stopped growing. Sleds still climb them, then turn onto a single-lane zigzag up the face at 1 in ${Math.round(1 / R.zigzag.grade)}, pausing at every switchback.`,
    }));
  } else {
    // no switch (the spiral): the ledges halfway up instead
    const half = find('Half the height reached');
    add(half, (m) => ({
      kind: 'gang', t: m.t, angle: 0.4, xray: false, minY: HEIGHT / 4,
      title: (t) => `Year ${yearOf(t)}: halfway up the spiral`,
      sub: () => `Four ledges wind up round the faces, one from each corner, at 1 in ${Math.round(1 / R.spiral.grade)}. A sled is turned round the edge of the pyramid at every corner.`,
    }));
  }
  const king = find("King's Chamber roofed");
  add(king, (m) => ({
    kind: 'room', t: m.t - span + 1, room: roomAt('king'), angle: 5.2, xray: true,
    title: (t) => `Year ${yearOf(t)}: the King's Chamber roofed`,
    sub: (t) => `Nine granite beams from Aswan, each dragged up by a heavy gang of ${DEFAULTS.heavy.crew} and levered across the chamber. The masonry stands ${topAt(S, t).toFixed(0)} m high. Seen in X-ray.`,
  }));
  const cap = find('Capstone set');
  add(cap, (m) => ({
    // (it ends just before the set: once the capstone is on, the build is done and the gangs
    // go home, and the gangs' drawing does not follow that moment smoothly)
    kind: 'capstone', t: m.t - span - 0.5, angle: 1.2, xray: false,
    title: (t) => `Year ${yearOf(t)}: the capstone set`,
    sub: () => `A heavy gang of ${DEFAULTS.heavy.crew} levers the capstone into place, ${HEIGHT} m above the plateau.`,
  }));
  return stops.filter((s) => s.t >= 0).sort((a, b) => a.t - b.t);
}

export class KhufuTour {
  // app: { timeline, client, bubble, camera, orbit, theoryId, setXray, isXray, onCaption(title, sub), onEnd() }
  constructor(app) {
    this.app = app; this.active = false; this.gen = 0;
    this.pos = new THREE.Vector3(); this.target = new THREE.Vector3();
  }

  start({ from = 0 } = {}) {
    const { timeline, client } = this.app;
    if (!timeline.ready) return false;
    this.S = client.summary;
    this.stops = tourStops(this.S, this.app.theoryId);
    this.active = true; this.gen++;
    this.xrayBefore = this.app.isXray();
    this.speedBefore = timeline.speedIdx;
    this.target.copy(this.app.orbit.target);
    timeline.setPlaying(false);
    this.idx = Math.max(0, Math.min(from, this.stops.length)) - 1;
    // the tour starts at the first day: a cut, then the build rises during the first move
    if (from === 0) timeline.seek(0);
    this.next();
    return true;
  }

  stop() {
    if (!this.active) return;
    this.active = false; this.gen++;
    const { timeline } = this.app;
    timeline.setSpeed(this.speedBefore);
    this.app.setXray(this.xrayBefore);
    // (after the X-ray: leaving the walk inside turns X-ray on, to show where it ended)
    if (this.app.walker.driven) this.app.leaveWalk();
    this.app.onCaption(null);
  }

  // the camera as it is now, where the next move starts from
  grab() {
    const c = this.app.camera;
    this.from = { pos: c.position.clone(), target: this.target.clone() };
  }

  next() {
    this.idx++;
    this.grab();
    this.phase = 'travel'; this.u = 0;
    this.t0 = this.app.timeline.t;
    const S = this.S;
    if (this.idx >= this.stops.length) {
      // the finished monument
      this.stop1 = { kind: 'end', t: S.endT, angle: (this.stops.at(-1)?.angle ?? 1) + 0.6, xray: false };
      this.wide = this.widePose(this.stop1, HEIGHT);
      this.caption('Finished', `${fmt(S.blocks)} blocks in ${(S.endT / YEAR).toFixed(1)} years of ${YEAR_DAYS} ten-hour working days. Now a walk inside.`);
      return;
    }
    const s = this.stop1 = this.stops[this.idx];
    this.wide = this.widePose(s, topAt(S, s.t));
    if (this.idx === 0) this.caption("Khufu's pyramid · Giza", `${fmt(S.blocks)} blocks in ${(S.endT / YEAR).toFixed(1)} years, every stone and sled gang simulated. Ramps: ${S.rampName.toLowerCase()}.`);
    else this.caption(s.title(s.t), s.sub(s.t));
  }

  caption(title, sub) { this.cap = { title, sub }; this.app.onCaption(title, sub); }

  // a wide view of the stop: from its side of the pyramid, looking at the working height
  widePose(s, top) {
    if (s.kind === 'room') {
      const c = s.room, r = 150;
      return { pos: new THREE.Vector3(c.x + Math.cos(s.angle) * r, c.y + 80, c.z + Math.sin(s.angle) * r), target: c.clone() };
    }
    const r = HALF + 120 + top * 0.6;
    return {
      pos: new THREE.Vector3(Math.cos(s.angle) * r, Math.max(30, top + 50), Math.sin(s.angle) * r),
      target: new THREE.Vector3(0, s.kind === 'end' ? 50 : top * 0.7, 0),
    };
  }

  // the gang to watch once the stop's time has arrived: the capstone's gang, or the hauling
  // gang nearest the camera (on a ramp for a ramp stop)
  pickGang(s) {
    const { bubble, camera } = this.app;
    let best = -1, bd = Infinity;
    for (let g = 0; g < bubble.trips.length; g++) {
      const trip = bubble.trips[g], o = bubble.bufs[g];
      if (!trip || !o || trip.away) continue;
      if (s.kind === 'capstone') { if (trip.load?.[3] === 3) return g; continue; }
      const act = bubble.acts[g];
      if (act !== ACT.HAUL) continue;
      if (s.minY && o[1] < s.minY) continue;
      const d = Math.hypot(o[0] - camera.position.x, o[2] - camera.position.z);
      if (d < bd) { bd = d; best = g; }
    }
    if (best < 0 && s.kind !== 'capstone') return s.minY ? this.pickGang({ ...s, minY: 0 }) : bubble.nearestGang(camera.position);
    return best;
  }

  // where the camera wants to be now, for the stop being played: following its gang from
  // outside the pyramid, or circling its room
  livePose(s, held) {
    const out = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    if (s.kind === 'room') {
      const a = s.angle + held * 0.05, c = s.room;
      out.target.copy(c);
      out.pos.set(c.x + Math.cos(a) * 42, c.y + 26, c.z + Math.sin(a) * 42);
      return out;
    }
    const { bubble } = this.app;
    if (this.gang >= 0 && bubble.sledAt(this.gang, out.target)) this.lastSled = out.target.clone();
    else out.target.copy(this.lastSled || this.wide.target);
    out.target.y += 1;
    // outward from the pyramid's axis, turned a little to see the gang from the side
    const k = Math.hypot(out.target.x, out.target.z) > 5 ? Math.atan2(out.target.z, out.target.x) : s.angle;
    const a = k + 0.55 + held * 0.03, near = s.kind === 'capstone' ? 30 : 26;
    out.pos.set(out.target.x + Math.cos(a) * near, out.target.y + (s.kind === 'capstone' ? 14 : 10), out.target.z + Math.sin(a) * near);
    return out;
  }

  place(pos, target) {
    const { camera } = this.app;
    camera.position.copy(pos); this.target.copy(target); camera.lookAt(target);
    this.app.orbit.target.copy(target); // so the orbit controls take over from here, without a jump
  }

  // one frame of the tour (dt: wall seconds); returns the target the camera looks at
  // (drewBubble: the gangs were already placed for this frame and camera)
  update(dt) {
    this.drewBubble = false;
    if (!this.active) return null;
    const { timeline, client } = this.app, s = this.stop1;
    if (this.phase === 'travel') {
      this.u = Math.min(1, this.u + dt / TRAVEL);
      const e = ease(this.u), A = this.from, W = this.wide;
      // swing round the axis rather than cut through the masonry
      const ra = Math.hypot(A.pos.x, A.pos.z), rb = Math.hypot(W.pos.x, W.pos.z);
      const aa = Math.atan2(A.pos.z, A.pos.x), ab = Math.atan2(W.pos.z, W.pos.x), ang = angLerp(aa, ab, e), rr = lerp(ra, rb, e);
      this.pos.set(Math.cos(ang) * rr, lerp(A.pos.y, W.pos.y, e), Math.sin(ang) * rr);
      this.place(this.pos, new THREE.Vector3().lerpVectors(A.target, W.target, e));
      timeline.seek(lerp(this.t0, s.t, e));
      if (this.u >= 1) {
        if (s.kind === 'end') { this.phase = 'hold'; this.held = 0; timeline.seek(s.t); return this.target; }
        this.app.setXray(s.xray);
        if (this.idx === 0) this.caption(s.title(s.t), s.sub(s.t));
        this.phase = 'wait'; this.waited = 0;
        const gen = this.gen;
        client.seekAndWait(s.t).then(() => { if (gen === this.gen && this.phase === 'wait') this.arrive(); });
      }
      return this.target;
    }
    if (this.phase === 'wait') {
      this.waited += dt;
      if (this.waited > WAIT_MAX) this.arrive();
      return this.target;
    }
    if (this.phase === 'crown') return this.updateCrown(dt);
    if (this.phase === 'door') return this.updateDoor(dt);
    if (this.phase === 'walk') return this.updateWalk(dt);
    if (this.phase === 'rise' || this.phase === 'circle') return this.updateFinale(dt);
    if (s.kind === 'end') {
      // a slow turn round the finished monument, then the tour hands back the controls
      this.held += dt;
      const W = this.wide, a = Math.atan2(W.pos.z, W.pos.x) + this.held * 0.03, r = Math.hypot(W.pos.x, W.pos.z);
      this.place(this.pos.set(Math.cos(a) * r, W.pos.y, Math.sin(a) * r), W.target);
      if (this.held >= OUTRO) this.toDoor();
      return this.target;
    }
    // approach and hold: the timeline plays at 1×
    this.held += dt;
    timeline.seek(s.t + this.held);
    this.app.bubble.update(timeline.t, this.app.camera, dt);
    const live = this.livePose(s, this.held);
    if (this.phase === 'approach') {
      const e = ease(Math.min(1, this.held / APPROACH));
      this.place(this.pos.lerpVectors(this.wide.pos, live.pos, e), new THREE.Vector3().lerpVectors(this.wide.target, live.target, e));
      if (this.held >= APPROACH) this.phase = 'hold';
    } else {
      this.place(live.pos, live.target);
      if (this.held >= APPROACH + HOLD) { if (s.kind === 'capstone') this.toCrown(); else this.next(); }
    }
    this.drewBubble = true;
    return this.target;
  }

  // the stop's time has come back from the worker: choose what to watch and close in
  arrive() {
    const { timeline, bubble, camera } = this.app, s = this.stop1;
    timeline.seek(s.t);
    bubble.update(s.t, camera, 0);
    this.gang = s.kind === 'room' ? -1 : this.pickGang(s);
    this.lastSled = null;
    timeline.setSpeed(0); // the label reads 1× while the stop plays
    this.wide = { pos: this.app.camera.position.clone(), target: this.target.clone() };
    this.phase = 'approach'; this.held = 0;
  }

  // ---- the capstone set ------------------------------------------------------------
  // The capstone stop ends just before the set; then the build is finished, the gangs go
  // home, and the camera closes in on the gilded pyramidion and turns round it.
  toCrown() {
    this.app.timeline.seek(this.S.endT);
    this.grab();
    this.crown0 = Math.atan2(this.from.pos.z, this.from.pos.x);
    this.phase = 'crown'; this.u = 0;
    this.caption('The capstone set', `The pyramidion crowns the pyramid, ${HEIGHT} m above the plateau. None survives at Giza; it is drawn here gilded, as many think it was.`);
  }
  updateCrown(dt) {
    this.u = Math.min(1, this.u + dt / CROWN);
    const a = this.crown0 + this.u * 0.9, k = ease(Math.min(1, this.u / 0.4)), A = this.from;
    // from where the capstone stop left the camera onto a ring round the apex
    const ring = new THREE.Vector3(Math.cos(a) * 9, HEIGHT + 1.2, Math.sin(a) * 9), look = new THREE.Vector3(0, HEIGHT - 1.2, 0);
    this.place(this.pos.lerpVectors(A.pos, ring, k), new THREE.Vector3().lerpVectors(A.target, look, k));
    if (this.u >= 1) this.next();
    return this.target;
  }

  // ---- the walk inside ------------------------------------------------------------
  // the camera comes down to the entrance, where the walker's eye will be
  toDoor() {
    this.legs = walkLegs();
    this.grab();
    const p = this.legs[0].path.pts[0];
    this.door = { pos: new THREE.Vector3(p.x, p.y + EYE, p.z), target: new THREE.Vector3(p.x, p.y + EYE - 0.2, p.z + 5) };
    this.phase = 'door'; this.u = 0;
  }
  updateDoor(dt) {
    this.u = Math.min(1, this.u + dt / DOOR);
    const e = ease(this.u), A = this.from, W = this.door;
    // round the axis to the north face, then in to the door (the last part straight)
    const ra = Math.hypot(A.pos.x, A.pos.z), rb = Math.hypot(W.pos.x, W.pos.z);
    const ang = angLerp(Math.atan2(A.pos.z, A.pos.x), Math.atan2(W.pos.z, W.pos.x), Math.min(1, e * 1.4)), rr = lerp(ra, rb, e);
    this.pos.set(Math.cos(ang) * rr, lerp(A.pos.y, W.pos.y, e), Math.sin(ang) * rr);
    this.place(this.pos, new THREE.Vector3().lerpVectors(A.target, W.target, e));
    if (this.u >= 1) {
      const p = this.legs[0].path.pts[0];
      this.app.enterWalk(p, Math.PI);
      this.yaw = Math.PI; this.pitch = Math.atan2(-0.2, 5);
      this.app.walker.drive(p, this.yaw, this.pitch);
      this.phase = 'walk'; this.leg = -1; this.nextLeg();
    }
    return this.target;
  }
  nextLeg() {
    this.leg++; this.u = 0;
    if (this.leg >= this.legs.length) { this.toFinale(); return; }
    const g = this.legs[this.leg];
    if (g.cut) { this.yaw = g.yaw0; this.pitch = 0; this.app.walker.drive(g.at, this.yaw, this.pitch); }
    // look at the thing: turn to it and raise or lower the eyes to it
    if (g.look) this.lookFrom = { yaw: this.yaw, pitch: this.pitch, to: faceYaw(g.at, g.look),
      pitchTo: Math.max(-0.35, Math.min(0.35, Math.atan2(g.look.y - (g.at.y + EYE), Math.hypot(g.look.x - g.at.x, g.look.z - g.at.z)))) };
    this.caption(g.title, g.sub);
  }
  // one frame of a leg: the feet along the path at an eased distance, the head turned to
  // where the path goes (or, at the end, to what there is to see)
  updateWalk(dt) {
    const g = this.legs[this.leg], W = this.app.walker;
    this.u = Math.min(1, this.u + dt / g.dur);
    const e = glide(this.u);
    let speed = 0;
    if (g.look) {
      const F = this.lookFrom, k = ease(Math.min(1, this.u * 1.6));
      this.yaw = angLerp(F.yaw, F.to, k);
      this.pitch = lerp(F.pitch, F.pitchTo, k);
      W.drive(g.at, this.yaw, this.pitch);
    } else {
      const d = g.path.length * e, p = g.path.at(d), ahead = g.path.at(d + 1.5);
      const h = Math.hypot(ahead.x - p.x, ahead.z - p.z);
      // turn smoothly toward the way ahead, and look a little up or down the slope
      const k = Math.min(1, dt * 4);
      if (h > 0.05) this.yaw = angLerp(this.yaw, Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z)), k);
      const want = h > 0.05 ? Math.max(-0.45, Math.min(0.45, Math.atan2(ahead.y - p.y, h) * 0.7)) : this.pitch;
      this.pitch += (want - this.pitch) * k;
      speed = (g.path.length * (glide(Math.min(1, this.u + 0.01)) - e)) / (0.01 * g.dur);
      W.drive(p, this.yaw, this.pitch, speed, g.path.at(d + Math.max(0.8, speed * 0.4)));
    }
    if (this.u >= 1) this.nextLeg();
    return null;
  }

  // ---- the closing circle ----------------------------------------------------------
  // out of the walk (it leaves the camera outside, above where the walker was), X-ray off,
  // up to the ring, then once round the finished pyramid
  toFinale() {
    this.app.leaveWalk();
    this.app.setXray(false);
    this.xrayBefore = false; // the tour ends with X-ray off, whatever it was before
    // leaving a walk puts the camera above and behind the walker, which from the rooms
    // underground or deep inside is in the masonry: start outside, on the same side
    const c = this.app.camera.position, a = Math.atan2(c.z, c.x);
    this.place(this.pos.set(Math.cos(a) * (HALF + 90), 30, Math.sin(a) * (HALF + 90)), new THREE.Vector3(0, 40, 0));
    this.grab();
    this.ring0 = Math.atan2(this.from.pos.z, this.from.pos.x);
    this.phase = 'rise'; this.u = 0;
    const S = this.S;
    this.caption("Khufu's pyramid", `Finished after ${(S.endT / YEAR).toFixed(1)} years: ${fmt(S.blocks)} blocks, ${HEIGHT} m high on a ${(2 * HALF).toFixed(1)} m base, the tallest building on Earth for about 3,800 years. Scrub the timeline, see through it in X-ray, or walk inside.`);
  }
  ringAt(a, out = new THREE.Vector3()) { return out.set(Math.cos(a) * RING.r, RING.y, Math.sin(a) * RING.r); }
  updateFinale(dt) {
    const look = new THREE.Vector3(0, RING.look, 0);
    if (this.phase === 'rise') {
      this.u = Math.min(1, this.u + dt / RISE);
      const e = ease(this.u), A = this.from, ra = Math.hypot(A.pos.x, A.pos.z), rr = lerp(ra, RING.r, e);
      this.pos.set(Math.cos(this.ring0) * rr, lerp(A.pos.y, RING.y, e), Math.sin(this.ring0) * rr);
      this.place(this.pos, new THREE.Vector3().lerpVectors(A.target, look, e));
      if (this.u >= 1) { this.phase = 'circle'; this.u = 0; }
      return this.target;
    }
    // a full turn, easing in and out of it
    this.u = Math.min(1, this.u + dt / CIRCLE);
    this.place(this.ringAt(this.ring0 + 2 * Math.PI * glide(this.u, 0.1), this.pos), look);
    if (this.u >= 1) { this.stop(); this.app.onEnd?.(); }
    return this.target;
  }

  // where the tour is, for measurements
  get info() {
    if (!this.active) return { active: false };
    const s = this.stop1;
    return { active: true, stop: this.idx, of: this.stops.length, milestone: s.milestone || 'finished', phase: this.phase, gang: this.gang, leg: this.phase === 'walk' ? this.leg : undefined, t: this.app.timeline.t };
  }
}
