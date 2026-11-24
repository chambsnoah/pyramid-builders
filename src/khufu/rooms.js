// Room and passage linings: the walls, floors and ceilings of every void in data.js,
// cut out of the masonry. Each face of a void has the parts that lie inside any other void
// removed (so doorways, junctions and the gallery's corbel ledges open up by themselves),
// and anything outside the casing trimmed off. One mesh per element and material, so a
// later phase can show rooms as they are built.
import * as THREE from 'three';
import { ELEMENTS, TAN, HALF, COURSES, floorY } from './data.js';
import { plane, split, clip, subtract, volumePlanes, volumeBounds, volumeFaces, newell } from './geom.js';
import { TX } from './textures.js';

const EXTERIOR = [
  plane(0, 1, -TAN, -TAN * HALF), plane(0, 1, TAN, -TAN * HALF),
  plane(TAN, 1, 0, -TAN * HALF), plane(-TAN, 1, 0, -TAN * HALF),
];
const GROUND = plane(0, 1, 0, 0);
const OPEN = 1e6; // a cut plane this far away cuts nothing
// Chambers roofed with flat granite beams over the whole room (sim/planner.js). (The Queen's
// Chamber, the gallery and the antechamber have passages roofed lower down while their walls
// still rise, and one cut plane per room cannot hide one ceiling and keep the other walls.)
const BEAM_ROOFED = new Set(['king', 'relieving']);
// The flat ceilings of the rooms roofed with beams, each with the top of the course its beams
// lie in: until that course is finished the room is open to the sky (its beams are drawn by
// the working course as they are set), so its ceiling is not drawn. { element id: [{ y, done }] }
function lids() {
  const out = {};
  for (const el of ELEMENTS) {
    if (!BEAM_ROOFED.has(el.id)) continue;
    out[el.id] = el.voids
      .filter((v) => v.ceil.length === 1 && v.ceil[0][1] === 0 && v.x1 - v.x0 >= 0.3) // flat, not a shaft
      .map((v) => { const y = v.ceil[0][0], c = COURSES.findIndex((co) => co.y0 >= y - 1e-6); return { y, done: COURSES[c].y1 }; });
  }
  return out;
}

function polyBounds(p) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const [x, y, z] of p) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); }
  return b;
}
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0;

// texture coordinates: floors and ceilings mapped from above, walls from the side, with
// the joint rows either level or parallel to the passage floor
function uvOf(p, n, v, j) {
  if (!j) {
    const a = Math.abs(n[0]) > Math.abs(n[2]) ? p[2] : p[0];
    return Math.abs(n[1]) > 0.6 ? [p[0] / 2.5, p[2] / 2.5] : [a / 2.5, p[1] / 2.5];
  }
  if (Math.abs(n[1]) > 0.6) return [p[0] / (2 * j.w), p[2] / (2 * j.w)];
  const horiz = Math.abs(n[0]) > Math.abs(n[2]) ? p[2] : p[0];
  const vert = j.mode === 'slope' ? p[1] - floorY(v, p[2]) : p[1] - (j.y0 ?? 0);
  return [horiz / (2 * j.w), vert / (2 * (j.h ?? 1))];
}

class Buffers {
  constructor() { this.pos = []; this.nor = []; this.uv = []; }
  poly(pts, n, uvFn) {
    // wind the triangles to face along n (front faces are the visible side)
    const m = newell(pts), l = Math.hypot(...m);
    if (l < 1e-9) return;
    if (!n) n = m.map((k) => k / l);
    else if (m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < 0) pts = [...pts].reverse();
    for (let i = 1; i + 1 < pts.length; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) { this.pos.push(...p); this.nor.push(...n); this.uv.push(...uvFn(p, n)); }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// open granite box: outer walls, rim, inner walls and floor
function sarcophagus(buf, s, j) {
  const hx = s.wid / 2, hz = s.len / 2, t = s.wall;
  const outer = { x0: s.x - hx, x1: s.x + hx, z0: s.z - hz, z1: s.z + hz, floor: [s.y, 0], ceil: [[s.y + s.ht, 0]] };
  const inner = { x0: outer.x0 + t, x1: outer.x1 - t, z0: outer.z0 + t, z1: outer.z1 - t, floor: [s.y + s.floor, 0], ceil: [[s.y + s.ht, 0]] };
  const uv = (v) => (p, n) => uvOf(p, n, v, j);
  for (const f of volumeFaces(outer, false, ['bottom', 'top'])) buf.poly(f.pts, f.n, uv(outer));
  for (const f of volumeFaces(inner, true, ['top'])) buf.poly(f.pts, f.n, uv(inner));
  const y = s.y + s.ht, O = outer, I = inner;
  for (const q of [
    [[O.x0, y, O.z0], [O.x0, y, O.z1], [I.x0, y, I.z1], [I.x0, y, I.z0]],
    [[I.x1, y, I.z0], [I.x1, y, I.z1], [O.x1, y, O.z1], [O.x1, y, O.z0]],
    [[I.x0, y, I.z0], [I.x1, y, I.z0], [O.x1, y, O.z0], [O.x0, y, O.z0]],
    [[O.x0, y, O.z1], [O.x1, y, O.z1], [I.x1, y, I.z1], [I.x0, y, I.z1]],
  ]) buf.poly(q, [0, 1, 0], uv(outer));
  return outer;
}

export class Rooms {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'rooms';
    scene.add(this.group);
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
    this.mats = {
      limestone: std({ map: TX.lime.map, normalMap: TX.lime.normalMap, normalScale: new THREE.Vector2(0.7, 0.7) }),
      granite: std({ map: TX.granite.map, normalMap: TX.granite.normalMap, roughness: 0.42, normalScale: new THREE.Vector2(0.5, 0.5) }),
      rock: std({ map: TX.rock.map, normalMap: TX.rock.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 }),
    };
    // each room its own copy of the materials, so each can be cut at its own height (it
    // rises with the course being laid) and the tunnel at its working face (setReveal)
    this.planes = {}; this.elMats = {};
    for (const el of ELEMENTS) {
      const pl = [new THREE.Plane(new THREE.Vector3(0, -1, 0), OPEN), new THREE.Plane(new THREE.Vector3(0, 0, -1), OPEN)];
      this.planes[el.id] = pl;
      this.elMats[el.id] = Object.fromEntries(Object.entries(this.mats).map(([k, m]) => { const c = m.clone(); c.clippingPlanes = pl; return [k, c]; }));
    }
    this.lids = lids();
    const all = [];
    for (const el of ELEMENTS) for (const v of el.voids) all.push({ v, el, planes: volumePlanes(v), bb: volumeBounds(v) });
    this.meshes = {}; // element id -> [mesh]
    this.solidBoxes = []; // for collision: solids not described in data (the sarcophagus)
    for (const el of ELEMENTS) {
      const bufs = {};
      const buf = (m) => (bufs[m] ||= new Buffers());
      for (const v of el.voids) {
        const j = el.joint ? { ...el.joint, ...(v.joint || {}) } : null;
        for (const f of volumeFaces(v, true)) {
          let pieces = [f.pts];
          for (const o of all) {
            if (o.v === v) continue;
            pieces = pieces.flatMap((p) => (overlaps(polyBounds(p), o.bb) ? subtract(p, o.planes) : [p]));
            if (!pieces.length) break;
          }
          for (const P of EXTERIOR) pieces = pieces.map((p) => clip(p, P)).filter(Boolean);
          for (const p of pieces) {
            if (el.material === 'limestone') {
              // passages that run down into the bedrock change to rock below the base
              const s = split(p, GROUND);
              if (s.coplanar) { buf(p[0][1] < 0 ? 'rock' : 'limestone').poly(p, f.n, (q, n) => uvOf(q, n, v, j)); continue; }
              if (s.front) buf('limestone').poly(s.front, f.n, (q, n) => uvOf(q, n, v, j));
              if (s.back) buf('rock').poly(s.back, f.n, (q, n) => uvOf(q, n, v, null));
            } else buf(el.material).poly(p, f.n, (q, n) => uvOf(q, n, v, j));
          }
        }
      }
      for (const s of el.solids || []) {
        const j = el.joint ? { ...el.joint, ...(s.joint || {}) } : null;
        for (const f of volumeFaces(s, false, s.skip)) buf(el.material).poly(f.pts, f.n, (q, n) => uvOf(q, n, s, j));
      }
      if (el.sarcophagus) this.solidBoxes.push(sarcophagus(buf('granite'), el.sarcophagus, { w: 0.6, h: 0.5, mode: 'level', y0: el.sarcophagus.y }));
      this.meshes[el.id] = Object.entries(bufs).map(([m, b]) => {
        const mesh = new THREE.Mesh(b.geometry(), this.elMats[el.id][m]);
        mesh.name = `${el.id}:${m}`; mesh.receiveShadow = true; mesh.userData.element = el;
        this.group.add(mesh);
        return mesh;
      });
    }
  }

  // hide everything above y (a section through an unfinished pyramid); null clears it
  setSection(y) { this.setReveal(y); }
  // Each room cut at its own height: `rise` (element id -> y) for the rooms whose lining is
  // being set in the course being laid (WorkingCourse.rooms), else y, the top of the finished
  // courses (null: the finished monument, nothing cut). `tunnel` (works.js tunnelAt) cuts
  // the descending passage and the subterranean works at their working faces: everything
  // south of the face is still rock.
  setReveal(y, rise = {}, tunnel = null) {
    for (const el of ELEMENTS) {
      const [py, pz] = this.planes[el.id];
      let cut = y == null ? OPEN : rise[el.id] ?? y;
      // a beam-roofed chamber whose beams are not all on yet: cut just under its ceiling
      if (y != null) for (const l of this.lids[el.id] || []) if (l.y < cut && y < l.done - 1e-4) cut = l.y - 0.01;
      py.constant = cut;
      let face = OPEN;
      if (tunnel && el.id === 'descending') face = tunnel.desc;
      if (tunnel && el.id === 'subterranean') face = tunnel.sub;
      pz.constant = face === Infinity ? OPEN : face === -Infinity ? -OPEN : face;
      for (const m of this.meshes[el.id]) m.visible = face !== -Infinity;
    }
  }
  // seen from outside, the interior is dark (the sky light is not shadowed, so it is dimmed here)
  setBrightness(k) {
    if (Math.abs(k - (this.brightness ?? 1)) < 0.005) return;
    this.brightness = k;
    for (const m of this.allMats()) m.color.setScalar(k);
  }
  setXray(on) {
    for (const m of this.allMats()) { m.side = on ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; }
  }
  allMats() { return [...Object.values(this.mats), ...Object.values(this.elMats).flatMap((o) => Object.values(o))]; }
}
