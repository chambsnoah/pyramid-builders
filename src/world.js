// Landscape: desert terrain, Nile, canal and harbour, quay, stores, quarry, sky and light.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF } from './plan.js';
import { MAT, GEO } from './assets.js';

export const WATER_Y = -0.55;
export const SITE = {
  river: { x0: 104, x1: 146 },
  basin: { x0: 56, x1: 96, z0: -46, z1: 30 }, // room for a 17 m barge to turn
  canal: { x0: 94, x1: 106, z0: -16, z1: 4 },
  quayX: 56,
  berths: [{ x: 58.7, z: -16, yaw: 0, side: -1 }, { x: 58.7, z: 3, yaw: Math.PI, side: 1 }], // moored bow to bow
  stoneYard: { x0: 44, x1: 52, z0: -19, z1: -9 },
  store: { x: 51, z: 40, w: 12, d: 8 }, // south of the harbour, clear of the ramp traffic
  workshop: { x: -16, z: -27 },
  waterStation: { x: 20, z: -12 },
  spoil: { x: 34, z: -40 },
  quarryFace: { z: 36, x0: -2, x1: 32 }, // limestone bench south of the site, worked from its north face
  quarryLane: 30.8,
  camp: { x: -26, z: -34 },
};

const inRect = (x, z, r, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
export function isWater(x, z) {
  return (x > SITE.river.x0 && x < SITE.river.x1) || inRect(x, z, SITE.basin) || inRect(x, z, SITE.canal);
}

function smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }
function noise2(x, z) {
  return Math.sin(x * 0.045 + Math.sin(z * 0.031) * 2) * Math.cos(z * 0.038 + Math.sin(x * 0.027)) +
    0.5 * Math.sin(x * 0.11 + z * 0.07) * Math.cos(z * 0.09 - x * 0.05);
}

// Ground height outside the pyramid footprint (ignores ramp/quay).
export function terrainHeight(x, z) {
  // distance into water regions -> depth
  const dRiver = Math.min(x - SITE.river.x0, SITE.river.x1 - x);
  const rectD = (r) => Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
  const d = Math.max(dRiver, rectD(SITE.basin), rectD(SITE.canal));
  if (d > -3) return -2.2 * smooth((d + 3) / 4) + 0 * 1;
  // flat work area near the site, dunes far away
  const r = Math.hypot(x - 10, z);
  const dune = Math.max(0, noise2(x, z) + 0.4) * 2.2 * smooth((r - 70) / 80);
  // west plateau rises gently behind the quarry
  const plateau = smooth((-x - 60) / 120) * 6;
  // green floodplain is lower and flat near the river
  return dune + plateau;
}

function buildTerrain() {
  const axis = [];
  for (let v = -340; v < -85; v += 8.5) axis.push(v);
  for (let v = -85; v < 85; v += 2.125) axis.push(v);
  for (let v = 85; v <= 340; v += 8.5) axis.push(v);
  const n = axis.length;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  const c = new THREE.Color();
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const x = axis[b], z = axis[a], o = a * n + b;
    const y = terrainHeight(x, z);
    pos.set([x, y, z], o * 3); uv.set([x / 6, z / 6], o * 2);
    // floodplain green near river, wet dark at waterline
    const toRiver = Math.abs(x - 125) - 21;
    const green = smooth(1 - (toRiver - 2) / 22) * (x > 85 ? 1 : 0);
    c.setRGB(1, 1, 1).lerp(new THREE.Color(0.55, 0.62, 0.38), green * 0.85);
    if (y < -0.2) c.lerp(new THREE.Color(0.5, 0.42, 0.3), 0.7);
    col.set([c.r, c.g, c.b], o * 3);
  }
  const idx = [];
  for (let a = 0; a < n - 1; a++) for (let b = 0; b < n - 1; b++) {
    const mx = (axis[b] + axis[b + 1]) / 2, mz = (axis[a] + axis[a + 1]) / 2;
    if (Math.abs(mx) < HALF && Math.abs(mz) < HALF) continue; // hole for the pyramid platform
    const i0 = a * n + b, i1 = i0 + 1, i2 = i0 + n, i3 = i2 + 1;
    idx.push(i0, i2, i1, i1, i2, i3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = MAT.sand.clone();
  m.vertexColors = true; m.map = MAT.sand.map.clone(); m.map.repeat.set(1, 1); m.map.needsUpdate = true;
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

function box(w, h, d, mat, x, y, z, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z); m.castShadow = cast; m.receiveShadow = true;
  return m;
}

function buildPalm(rand) {
  const g = new THREE.Group();
  const h = 6 + rand() * 4, lean = (rand() - 0.5) * 0.3;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, h, 6), MAT.palmTrunk);
  trunk.position.y = h / 2; trunk.rotation.z = lean; trunk.castShadow = true; g.add(trunk);
  const crown = new THREE.Group(); crown.position.set(-Math.sin(lean) * h, h, 0); g.add(crown);
  const leaf = new THREE.PlaneGeometry(0.7, 3.2, 1, 4);
  const p = leaf.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 1.6; p.setZ(i, -0.12 * y * y); p.setY(i, y); }
  leaf.computeVertexNormals();
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(leaf, MAT.palmLeaf);
    l.rotation.set(-0.6 - rand() * 0.4, (i / 9) * Math.PI * 2, 0, 'YXZ'); l.castShadow = true;
    crown.add(l);
  }
  return g;
}

function buildStore() {
  const g = new THREE.Group();
  const { x, z, w, d } = SITE.store;
  const wall = 0.5, h = 2.3; // low courtyard walls so the stores inside stay in view
  g.add(box(w, h, wall, MAT.mud, x, 0, z - d / 2));
  g.add(box(w, h, wall, MAT.mud, x, 0, z + d / 2));
  g.add(box(wall, h, d, MAT.mud, x + w / 2, 0, z));
  // west wall with a doorway facing the yard
  g.add(box(wall, h, d / 2 - 1, MAT.mud, x - w / 2, 0, z - d / 4 - 0.5));
  g.add(box(wall, h, d / 2 - 1, MAT.mud, x - w / 2, 0, z + d / 4 + 0.5));
  g.add(box(wall, 0.8, 2, MAT.mud, x - w / 2, h - 0.8, z));
  // reed roof over half, open courtyard for the rest; posts carry the roof's open edge
  const roof = box(w / 2, 0.25, d, MAT.reed, x + w / 4, h, z); g.add(roof);
  for (const pz of [z - d / 2 + 0.6, z - 1.7, z + 1.7, z + d / 2 - 0.6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, h, 6), MAT.darkWood);
    post.position.set(x + 0.15, h / 2, pz); post.castShadow = true; g.add(post);
  }
  g.add(box(0.22, 0.22, d, MAT.darkWood, x + 0.15, h - 0.22, z));
  return g;
}

// What is in the storehouse, laid out in its courtyard and under its roof. Counts follow
// the stocks, so deliveries pile up here and use draws them down.
export function buildStoreDisplay(scene) {
  const { x, z, w, d } = SITE.store;
  const xw = x - w / 2, zn = z - d / 2, zs = z + d / 2;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const groups = [];
  const add = (geo, mat, places) => {
    const im = new THREE.InstancedMesh(geo, mat, places.length);
    places.forEach(([px, py, pz, yaw = 0], n) => im.setMatrixAt(n, m.compose(new THREE.Vector3(px, py, pz), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), one)));
    im.castShadow = true; im.receiveShadow = true; im.count = 0;
    scene.add(im); groups.push(im);
    return im;
  };
  const jarsAt = [], basketsAt = [], cratesAt = [], beamsAt = [], chestsAt = [], statuesAt = [];
  for (let j = 0; j < 26; j++) jarsAt.push([xw + 0.6 + (j % 13) * 0.4, 0, zn + 0.6 + Math.floor(j / 13) * 0.42]);
  for (let j = 0; j < 11; j++) basketsAt.push([xw + 0.6 + j * 0.47, 0, zs - 0.65]);
  for (let j = 0; j < 6; j++) cratesAt.push([xw + 0.7 + j * 0.62, 0, zs - 1.35]);
  for (let j = 0; j < 15; j++) beamsAt.push([x - 0.8 + ((j % 3) - 1) * 0.2, Math.floor(j / 3) * 0.18, zn + 2.8]);
  for (let j = 0; j < 6; j++) chestsAt.push([x + 1.2 + j * 0.9, 0, zn + 0.7]);
  statuesAt.push([x + w / 2 - 1.2, 0, zs - 1.0, -Math.PI / 2], [x + w / 2 - 1.2, 0, zs - 2.2, -Math.PI / 2]);
  const jars = add(GEO.jar, MAT.whiteJar, jarsAt);
  const baskets = add(GEO.basket, MAT.reed, basketsAt), bread = add(GEO.basketFill, MAT.bread, basketsAt);
  const crates = add(GEO.crate, MAT.darkWood, cratesAt);
  const beams = add(GEO.beam, MAT.wood, beamsAt);
  const chests = add(GEO.chest, MAT.paint, chestsAt), trims = add(GEO.chestTrim, MAT.gold, chestsAt);
  const statues = add(GEO.statue, MAT.gold, statuesAt);
  const set = (im, n) => { im.count = Math.max(0, Math.min(im.instanceMatrix.count, Math.round(n))); };
  return {
    update(stocks) {
      set(jars, stocks.get('mortar'));
      const food = Math.ceil(stocks.get('food') / 30);
      set(baskets, food); set(bread, food);
      set(crates, Math.ceil(stocks.get('tools') / 20));
      set(beams, stocks.get('timber'));
      set(chests, stocks.get('goods')); set(trims, stocks.get('goods'));
      set(statues, stocks.get('statue'));
    },
  };
}

function buildWorkshop() {
  const g = new THREE.Group();
  const { x, z } = SITE.workshop;
  for (const [dx, dz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3, 6), MAT.darkWood);
    post.position.set(x + dx, 1.5, z + dz); post.castShadow = true; g.add(post);
  }
  g.add(box(9, 0.2, 7, MAT.reed, x, 3, z));
  return g;
}

function buildQuay() {
  const g = new THREE.Group();
  const { basin, quayX } = SITE;
  // dressed stone quay wall along the west side of the basin
  const len = basin.z1 - basin.z0 + 4;
  g.add(box(3, 2.6, len, MAT.limestone, quayX - 1.2, -2.45, (basin.z0 + basin.z1) / 2));
  // timber mooring posts
  for (const bz of [-27, -6.5, 12]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.2, 6), MAT.darkWood);
    p.position.set(quayX - 0.4, 0.75, bz); p.castShadow = true; g.add(p);
  }
  return g;
}

function buildQuarry() {
  // stepped limestone outcrop south of the site, worked from its north face
  const g = new THREE.Group();
  const { z, x0, x1 } = SITE.quarryFace;
  const xc = (x0 + x1) / 2, len = x1 - x0;
  // freshly cut faces are pale; the weathered top of the outcrop is darker
  const cut = new THREE.MeshStandardMaterial({ map: MAT.rock.map, color: 0xfff1d6, roughness: 0.85 });
  const top = new THREE.MeshStandardMaterial({ map: MAT.rock.map, color: 0xd9c4a0, roughness: 1 });
  cut.emissive = new THREE.Color(0x2a2214); // pale stone still reads as pale in the shade of the north face
  const mat = [cut, cut, top, MAT.rock, MAT.rock, cut]; // BoxGeometry faces: +x, -x, +y, -y, +z, -z (north)
  const rnd = (() => { let s = 91; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const C = 1.25;
  // Three benches. Each one's front edge is cut back block by block, so the faces show the
  // stepped sockets left where blocks were taken out, as in the Giza quarries.
  const benches = [
    { y: 0, h: 2.5, zf: z, depth: 3, xa: -6, xb: 36.5, back: [len + 10, 26] },
    { y: 2.5, h: 2.5, zf: z + 6, depth: 1, xa: -4.75, xb: 34, back: [len + 6, 22] },
    { y: 5, h: 2.0, zf: z + 14, depth: 1, xa: -2.25, xb: 31.5, back: [len, 16] },
  ];
  const work = [4, 11.5, 19, 26.5]; // where the quarry pairs free blocks (crews.js)
  const cols = [];
  for (const [n, bn] of benches.entries()) {
    const zBack = bn.zf + bn.depth * C;
    const bz = bn.zf + 6 + bn.back[1] / 2 - 6; // keep the old back edge
    const backDepth = bz + bn.back[1] / 2 - zBack;
    g.add(box(bn.back[0], bn.h, backDepth, mat, xc, bn.y - 0.01, zBack + backDepth / 2));
    for (let x = bn.xa; x <= bn.xb + 1e-6; x += C) {
      const atWork = n === 0 && work.some((w) => Math.abs(w - x) < 0.01);
      let taken = atWork ? 1 : Math.min(bn.depth, Math.floor(rnd() * (bn.depth + 1.6)));
      if (n > 0 && rnd() < 0.45) taken = bn.depth;
      for (let r = taken; r < bn.depth; r++) {
        // the front-most block of a column has often had its top course lifted off already
        const h = r === taken && !atWork && rnd() < 0.4 && bn.h > 2.2 ? C : bn.h;
        cols.push(new THREE.BoxGeometry(C, h, C).translate(x, bn.y + h / 2, bn.zf + r * C + C / 2).toNonIndexed());
      }
    }
  }
  const sockets = new THREE.Mesh(mergeGeometries(cols), cut);
  sockets.castShadow = true; sockets.receiveShadow = true;
  g.add(sockets);
  // heaps of limestone chips knocked off while cutting, and chips littering the working floor
  const chipMat = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 1, map: MAT.rock.map });
  for (const [hx, hz, r, h] of [[x0 - 8, z - 1, 3.6, 2.2]]) {
    const heap = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14, 3), chipMat);
    const p = heap.geometry.attributes.position;
    for (let v = 0; v < p.count; v++) if (p.getY(v) < h / 2 - 0.01) { p.setX(v, p.getX(v) * (0.9 + rnd() * 0.25)); p.setZ(v, p.getZ(v) * (0.9 + rnd() * 0.25)); }
    heap.geometry.computeVertexNormals();
    heap.position.set(hx, h / 2 - 0.05, hz); heap.castShadow = true; heap.receiveShadow = true;
    g.add(heap);
  }
  const chips = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), chipMat, 520);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  for (let n = 0; n < 520; n++) {
    const onBench = n % 3 === 0;
    const s = 0.08 + rnd() * rnd() * 0.32;
    if (onBench) pos.set(-4 + rnd() * 37, 2.5 + s * 0.3, z + 3.9 + rnd() * 1.9);
    else pos.set(-6 + rnd() * 43, s * 0.3, z - 2.6 + rnd() * 2.5);
    e.set(rnd() * 0.6, rnd() * Math.PI, rnd() * 0.6);
    chips.setMatrixAt(n, m.compose(pos, q.setFromEuler(e), sc.set(s, s * 0.6, s * 0.8)));
  }
  chips.receiveShadow = true;
  g.add(chips);
  // blocks marked out on the upper benches by cut channels, waiting to be freed
  const groove = new THREE.MeshStandardMaterial({ color: 0x5e4a33, roughness: 1 });
  for (const [ty, zf, xa, xb] of [[5.0, z + 7.6, -4, 33.5], [7.0, z + 15.6, -1.5, 31]]) {
    for (let x = xa; x <= xb; x += C) g.add(box(0.07, 0.03, 2.5, groove, x, ty, zf + 1.25, false));
    for (const dz of [0, 1.25, 2.5]) g.add(box(xb - xa, 0.03, 0.07, groove, (xa + xb) / 2, ty, zf + dz, false));
  }
  return g;
}

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sunDir; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.2, 1.0);
        vec3 horizon = vec3(0.93, 0.84, 0.70), zenith = vec3(0.32, 0.55, 0.85);
        vec3 c = mix(horizon, zenith, pow(max(h,0.0), 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0,0.85,0.6) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}

export function buildWorld(scene) {
  const world = { group: new THREE.Group() };
  scene.add(world.group);
  world.sky = buildSky(scene);
  scene.fog = new THREE.Fog(0xe8d8bc, 160, 700);

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x9a7448, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b8, 3.0);
  sun.position.set(70, 62, 45);
  sun.target.position.set(10, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 260;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  world.sun = sun; world.hemi = hemi;
  world.sky.material.uniforms.sunDir.value.copy(sun.position).normalize();

  world.terrain = buildTerrain();
  world.group.add(world.terrain);

  // water only where there is water (river, canal, basin), so it doesn't show under the land in X-ray;
  // the rectangles run a little under the banks and don't overlap each other
  const rects = [[101, 149, -350, 350], [99, 101, SITE.canal.z0 - 3, SITE.canal.z1 + 3], [SITE.basin.x0 - 1.5, 99, SITE.basin.z0 - 3, SITE.basin.z1 + 3]];
  const wpos = [], wuv = [], widx = [];
  for (const [x0, x1, z0, z1] of rects) {
    const b = wpos.length / 3;
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) { wpos.push(x, 0, z); wuv.push(x / 23, z / 23); }
    widx.push(b, b + 3, b + 1, b + 1, b + 3, b + 2);
  }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wgeo.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  wgeo.setIndex(widx); wgeo.computeVertexNormals();
  MAT.water.normalMap.repeat.set(1, 1);
  const water = new THREE.Mesh(wgeo, MAT.water);
  water.position.set(0, WATER_Y, 0);
  water.receiveShadow = true;
  world.group.add(water);
  world.water = water;

  world.group.add(buildQuay(), buildStore(), buildWorkshop(), buildQuarry());

  // camp huts south-west of the site
  for (let i = 0; i < 6; i++) {
    const hx = SITE.camp.x - 18 + (i % 3) * 9, hz = SITE.camp.z - 6 + Math.floor(i / 3) * 9;
    world.group.add(box(5, 2.4, 4, MAT.mud, hx, 0, hz));
    world.group.add(box(5.4, 0.2, 4.4, MAT.reed, hx, 2.4, hz));
  }
  // water station: large storage jars on a stand
  const ws = SITE.waterStation;
  world.group.add(box(3.2, 0.3, 1.4, MAT.darkWood, ws.x, 0, ws.z));
  for (let j = 0; j < 4; j++) {
    const jar = new THREE.Mesh(GEO.jar, MAT.clay); jar.scale.setScalar(2.2);
    jar.position.set(ws.x - 1.2 + j * 0.8, 0.3, ws.z); jar.castShadow = true; world.group.add(jar);
  }

  // palms along the river banks and the canal
  const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 70; i++) {
    const side = rand() > 0.5;
    const x = side ? 92 + rand() * 10 : 150 + rand() * 30;
    const z = -260 + rand() * 520;
    if (isWater(x, z) || terrainHeight(x, z) < -0.2 || (x < 110 && z > -20 && z < 8)) continue;
    const p = buildPalm(rand); p.position.set(x, terrainHeight(x, z), z); world.group.add(p);
  }
  for (let i = 0; i < 10; i++) {
    const x = 62 + rand() * 30, z = 34 + rand() * 12;
    if (isWater(x, z) || terrainHeight(x, z) < -0.2) continue;
    const p = buildPalm(rand); p.position.set(x, terrainHeight(x, z), z); world.group.add(p);
  }

  // distant pyramids on the horizon for scale
  for (const [x, z, s] of [[-180, -260, 50], [-260, -140, 34], [-120, 300, 26]]) {
    const pm = new THREE.Mesh(new THREE.ConeGeometry(s * 0.72, s * 0.65, 4, 1), MAT.tura);
    pm.rotation.y = Math.PI / 4; pm.position.set(x, s * 0.32 + terrainHeight(x, z) - 1, z);
    world.group.add(pm);
  }

  world.update = (t) => {
    MAT.water.normalMap.offset.set(t * 0.004, -t * 0.012);
  };
  return world;
}

// Merge helper used by other modules for static clutter
export function mergedMesh(geos, mat) {
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
