// The masonry, drawn as surfaces only: never 2.3 million blocks.
// - Each course contributes just its four outer casing faces (sloped strips of Tura
//   limestone) to one merged geometry, ordered course by course, so showing the pyramid
//   built up to course n is a draw range.
// - The top of the highest built course is a separate cap with the rooms and passages cut
//   out of it (only needed while the pyramid is unfinished).
// - Far away, everything is swapped for a four-triangle hull whose texture carries every
//   course line.
import * as THREE from 'three';
import { COURSES, COURSE_COUNT, HALF, HEIGHT, TAN, halfWidthAt, ELEMENTS, STAIR, ENTRANCE_Y, ENTRANCE_Z } from './data.js';
import { newell, sectionAt } from './geom.js';
import { TX } from './textures.js';

const TILE = 4.5; // metres of casing per texture tile (three blocks)

// Openings where voids (the entrance passage, the King's Chamber shafts) cross the north
// or south face: rectangles in (u = x, y) on that face.
function faceHoles() {
  const holes = { N: [], S: [] };
  for (const el of ELEMENTS) for (const v of el.voids) {
    if (v.ceil.length !== 1) continue;
    for (const face of ['N', 'S']) {
      const s = face === 'N' ? -1 : 1;
      // face: z = s·(HALF − y/TAN)  ⇔  y = TAN·(HALF − s·z)
      const hit = ([a, b]) => { const z = (TAN * HALF - a) / (b + s * TAN); return { z, y: a + b * z }; };
      const f = hit(v.floor), c = hit(v.ceil[0]);
      if (f.z < v.z0 || f.z > v.z1 || f.y < 0 || c.y <= f.y) continue;
      holes[face].push({ u0: v.x0, u1: v.x1, y0: f.y, y1: Math.min(c.y, HEIGHT) });
    }
  }
  return holes;
}

function facePoint(face, u, y) {
  const hw = halfWidthAt(y);
  if (u === -Infinity) u = -hw; else if (u === Infinity) u = hw;
  switch (face) {
    case 'N': return [u, y, -hw];
    case 'S': return [u, y, hw];
    case 'E': return [hw, y, u];
    default: return [-hw, y, u];
  }
}
const OUT = { N: [0, 0, -1], S: [0, 0, 1], E: [1, 0, 0], W: [-1, 0, 0] };

function buildCourses(holes) {
  const pos = [], nor = [], uv = [], col = [], ends = [];
  const r = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const pushQuad = (face, co, quad, tint, stagger) => {
    let n = newell(quad);
    const l = Math.hypot(...n); if (l < 1e-9) return;
    n = n.map((k) => k / l);
    if (n[0] * OUT[face][0] + n[2] * OUT[face][2] < 0) { quad.reverse(); n = n.map((k) => -k); }
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const p = quad[i];
      pos.push(...p); nor.push(...n); col.push(tint, tint, tint * 0.995);
      const u = face === 'N' || face === 'S' ? p[0] : p[2];
      uv.push((u + stagger) / TILE, (p[1] - co.y0) / co.h);
    }
  };
  COURSES.forEach((co, ci) => {
    if (co.kind !== 'course') return;
    const tint = 0.95 + r() * 0.07;
    const stagger = (ci * 1.63) % TILE;
    for (const face of ['N', 'E', 'S', 'W']) {
      const hs = (holes[face] || []).filter((h) => h.y1 > co.y0 && h.y0 < co.y1);
      const ys = [co.y0, co.y1, ...hs.flatMap((h) => [h.y0, h.y1]).filter((y) => y > co.y0 && y < co.y1)].sort((a, b) => a - b);
      for (let b = 0; b + 1 < ys.length; b++) {
        const ya = ys[b], yb = ys[b + 1], ym = (ya + yb) / 2;
        // u-intervals of this band not covered by a hole
        const cut = hs.filter((h) => h.y0 <= ym && h.y1 >= ym).sort((p, q) => p.u0 - q.u0);
        let u = -Infinity;
        for (const h of [...cut, { u0: Infinity, u1: Infinity }]) {
          if (h.u0 > (u === -Infinity ? -HALF - 1 : u)) {
            pushQuad(face, co, [facePoint(face, u, ya), facePoint(face, h.u0, ya), facePoint(face, h.u0, yb), facePoint(face, u, yb)], tint, stagger);
          }
          u = h.u1;
        }
      }
    }
    ends[ci] = pos.length / 3;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return { geometry: g, ends };
}

// Top surface of a course at height y, with every room and passage it cuts through left open.
// With yBed (the bed of that course), also every room that reaches up into the course: a
// chamber whose top lies just under the next course stays open from above until its roof
// beams are set (the King's Chamber, the relieving chambers).
// extra: more openings [x0, x1, z0, z1] (the trench of a ramp inside the masonry).
export function capGeometry(y, yBed = y, extra = []) {
  const hw = halfWidthAt(y);
  const rects = [];
  for (const [x0, x1, z0, z1] of extra) {
    const r = { x0: Math.max(-hw, x0), x1: Math.min(hw, x1), z0: Math.max(-hw, z0), z1: Math.min(hw, z1) };
    if (r.x1 > r.x0 && r.z1 > r.z0) rects.push(r);
  }
  for (const el of ELEMENTS) for (const v of el.voids) {
    // (a sloped void has a different section at each height: keep every one open)
    for (const yy of [y, (y + yBed) / 2, yBed + 0.01]) {
      const s = sectionAt(v, yy);
      if (!s) continue;
      const r = { x0: Math.max(-hw, s.x0), x1: Math.min(hw, s.x1), z0: Math.max(-hw, s.z0), z1: Math.min(hw, s.z1) };
      if (r.x1 > r.x0 && r.z1 > r.z0) rects.push(r);
    }
  }
  const uniq = (a) => [...new Set(a.map((v) => +v.toFixed(5)))].sort((p, q) => p - q);
  const xs = uniq([-hw, hw, ...rects.flatMap((r) => [r.x0, r.x1])]);
  const zs = uniq([-hw, hw, ...rects.flatMap((r) => [r.z0, r.z1])]);
  const pos = [], uv = [];
  // merge each row of open cells into runs to keep the triangle count down
  for (let j = 0; j + 1 < zs.length; j++) {
    const zm = (zs[j] + zs[j + 1]) / 2;
    let run = null;
    const flush = (x1) => {
      if (run === null) return;
      const q = [[run, zs[j]], [run, zs[j + 1]], [x1, zs[j + 1]], [x1, zs[j]]];
      for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(q[i][0], y, q[i][1]); uv.push(q[i][0] / 3.2, q[i][1] / 2.4); }
      run = null;
    };
    for (let i = 0; i + 1 < xs.length; i++) {
      const xm = (xs[i] + xs[i + 1]) / 2;
      const hole = rects.some((r) => xm > r.x0 && xm < r.x1 && zm > r.z0 && zm < r.z1);
      if (hole) flush(xs[i]); else if (run === null) run = xs[i];
    }
    flush(xs[xs.length - 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function pyramidGeometry(y0, y1, uvFor) {
  const hw = halfWidthAt(y0);
  const c = [[-hw, y0, -hw], [hw, y0, -hw], [hw, y0, hw], [-hw, y0, hw]], apex = [0, y1, 0];
  const pos = [], uv = [];
  // N, E, S, W faces, counter-clockwise seen from outside
  for (const [a, b] of [[1, 0], [2, 1], [3, 2], [0, 3]]) {
    pos.push(...c[a], ...c[b], ...apex);
    uv.push(...uvFor);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// A stone stair as one stepped profile (no overlapping boxes), with world-space UVs.
function stairGeometry() {
  const n = Math.round(ENTRANCE_Y / STAIR.rise), rise = ENTRANCE_Y / n, run = (STAIR.zTop - STAIR.zFoot) / n;
  const { x0, x1 } = STAIR;
  const pos = [], nor = [], uv = [];
  const quad = (pts, nrm) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [x, y, z] = pts[i];
      pos.push(x, y, z); nor.push(...nrm);
      uv.push(...(Math.abs(nrm[1]) > 0.5 ? [x / 1.6, z / 1.6] : Math.abs(nrm[0]) > 0.5 ? [z / 1.6, y / 1.6] : [x / 1.6, y / 1.6]));
    }
  };
  const column = (za, zb, h) => { // one step's slice: tread, riser and both sides
    quad([[x0, h, za], [x0, h, zb], [x1, h, zb], [x1, h, za]], [0, 1, 0]);
    quad([[x0, 0, za], [x0, h, za], [x1, h, za], [x1, 0, za]], [0, 0, -1]);
    quad([[x0, 0, za], [x0, 0, zb], [x0, h, zb], [x0, h, za]], [-1, 0, 0]);
    quad([[x1, 0, za], [x1, h, za], [x1, h, zb], [x1, 0, zb]], [1, 0, 0]);
  };
  for (let k = 0; k < n; k++) column(STAIR.zFoot + k * run, STAIR.zFoot + (k + 1) * run, (k + 1) * rise);
  column(STAIR.zTop, ENTRANCE_Z + 0.02, ENTRANCE_Y); // landing at the sill
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export class Monument {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'monument';
    scene.add(this.group);
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
    this.mats = {
      casing: std({ map: TX.casing.map, normalMap: TX.casing.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.6, vertexColors: true }),
      cap: std({ map: TX.lime.map, normalMap: TX.lime.normalMap }),
      // gilded: a warm gold, only a little metallic (there is no environment for a metal to
      // reflect, so a full metal reads brown), with a faint glow so the shaded faces stay gold
      pyramidion: std({ color: 0xe6bf55, metalness: 0.3, roughness: 0.35, emissive: 0x4a3508 }),
      hull: std({ map: TX.hull, roughness: 0.6 }),
      stair: std({ map: TX.pave.map, normalMap: TX.pave.normalMap, color: 0xf2e6cc }),
    };
    this.holes = faceHoles();
    const { geometry, ends } = buildCourses(this.holes);
    this.ends = ends;
    this.courses = new THREE.Mesh(geometry, this.mats.casing);
    this.courses.castShadow = true; this.courses.receiveShadow = true; this.courses.name = 'courses';
    this.group.add(this.courses);
    const top = COURSES[COURSES.length - 1];
    this.pyramidion = new THREE.Mesh(pyramidGeometry(top.y0, top.y1, [0, 0, 1, 0, 0.5, 1]), this.mats.pyramidion);
    this.pyramidion.castShadow = true; this.pyramidion.name = 'pyramidion';
    this.group.add(this.pyramidion);
    this.cap = new THREE.Mesh(new THREE.BufferGeometry(), this.mats.cap);
    this.cap.receiveShadow = true; this.cap.castShadow = true; this.cap.visible = false; this.cap.name = 'cap';
    this.group.add(this.cap);
    this.stair = new THREE.Mesh(stairGeometry(), this.mats.stair);
    this.stair.castShadow = true; this.stair.receiveShadow = true; this.stair.name = 'stair';
    this.group.add(this.stair);
    // far detail level: smooth hull with the course lines in its texture
    this.hull = new THREE.Mesh(pyramidGeometry(0, HEIGHT, [0, 0, 1, 0, 0.5, 1]), this.mats.hull);
    this.hull.castShadow = true; this.hull.visible = false; this.hull.name = 'hull';
    scene.add(this.hull);
    // X-ray outline: the four arrises and the base
    {
      const h = HALF, pts = [];
      const c = [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]];
      for (let i = 0; i < 4; i++) pts.push(...c[i], ...c[(i + 1) % 4], ...c[i], 0, HEIGHT, 0);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.outline = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: 0.7 }));
      this.outline.visible = false; this.outline.name = 'outline';
      this.group.add(this.outline);
    }
    this.built = COURSE_COUNT; this.capstone = true;
    this.far = false;
  }

  // Show the pyramid finished up to `n` courses. n = COURSE_COUNT shows the pyramidion too,
  // unless `capstone` is false (all the masonry done, the capstone not yet set).
  setBuiltCourses(n, capstone = true) {
    n = Math.max(0, Math.min(COURSE_COUNT, Math.round(n)));
    const changed = n !== this.built || capstone !== this.capstone;
    this.built = n; this.capstone = capstone;
    if (!changed) return this.topY();
    this.courses.geometry.setDrawRange(0, n > 0 ? this.ends[n - 1] : 0);
    if (n > 0 && !this.complete) this.rebuildCap();
    this.updateVisibility();
    return this.topY();
  }
  rebuildCap() {
    const n = this.built, y = COURSES[n - 1].y1;
    this.cap.geometry.dispose();
    this.cap.geometry = capGeometry(y, COURSES[n - 1].y0, this.holes && Math.abs(this.holes.y - y) < 1e-6 ? this.holes.rects : []);
  }
  // openings in the top of the built courses, when that top is at height y (the trench of a
  // ramp inside the masonry where it comes up to the course being laid: rampTrench())
  setHoles(y, rects) {
    const sig = rects && rects.length ? `${y}:${rects.flat().map((v) => v.toFixed(2)).join(',')}` : '';
    if (sig === (this.holesSig || '')) return;
    this.holesSig = sig; this.holes = sig ? { y, rects } : null;
    if (this.built > 0 && !this.complete) this.rebuildCap();
  }
  get complete() { return this.built === COURSE_COUNT && this.capstone; }
  topY() { return this.complete ? HEIGHT : this.built > 0 ? COURSES[this.built - 1].y1 : 0; }

  // swap to the hull when the whole pyramid is a small part of the view
  setFar(far) {
    if (far === this.far) return;
    this.far = far;
    this.updateVisibility();
  }

  // The hull stands in only for the finished pyramid. A part-built one keeps its courses
  // and the cap at any distance, since the hull would cover the section.
  updateVisibility() {
    const complete = this.complete;
    this.hull.visible = this.far && complete;
    this.courses.visible = !this.hull.visible;
    this.pyramidion.visible = complete && !this.hull.visible;
    this.cap.visible = this.built > 0 && !complete;
    // (the access stair is modern: it is only there once the pyramid is finished, not under
    // the ramps while it is built)
    this.stair.visible = complete;
  }

  setXray(on) {
    for (const m of [this.mats.casing, this.mats.cap, this.mats.pyramidion, this.mats.hull]) {
      m.transparent = on; m.opacity = on ? 0.16 : 1; m.depthWrite = !on; m.needsUpdate = true;
    }
    this.courses.castShadow = this.pyramidion.castShadow = this.cap.castShadow = this.hull.castShadow = !on;
    this.outline.visible = on;
  }
}
