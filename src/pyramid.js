// Visual state of the monument: placed blocks, platform, excavations, decking and the ramp.
import * as THREE from 'three';
import {
  B, N, HALF, cx, cz, edgeX, edgeZ, blocks, rockCells, getRock, digFrom, deckCells, DESC, descFloor,
} from './plan.js';
import { MAT, GEO, descStairGeometry, polyGeometry } from './assets.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
export const RAMP_LANDING = 3.6;
export const RAMP_HALF_W = 3.2;
export const RAMP_SLOPE = 4; // horizontal metres per metre of rise

export function blockMatrix(b, out = tmpM) {
  tmpQ.setFromAxisAngle(UP, b.rot);
  return out.compose(tmpP.set(cx(b.i), b.L * B, cz(b.k)), tmpQ, tmpS.set(1, 1, 1));
}

export function rampProfile(H) {
  // x positions of the ramp's key points at height H
  const xTop = HALF - H;
  return { xTop, xLand: xTop + RAMP_LANDING, xFoot: xTop + RAMP_LANDING + RAMP_SLOPE * H };
}
export function rampHeightAt(H, x, z) {
  if (H <= 0.001) return -Infinity;
  x = Math.abs(x);
  const { xTop, xLand, xFoot } = rampProfile(H);
  const w = RAMP_HALF_W + 0.35 * H * 0; // walkable top width (batter ignored for walking)
  if (Math.abs(z) > w || x < HALF - H - 0.2 || x > xFoot) return -Infinity;
  if (x <= xLand) return H;
  return H * (xFoot - x) / (xFoot - xLand);
}

function rampGeometry(H) {
  const { xTop, xLand, xFoot } = rampProfile(H);
  const wt = RAMP_HALF_W, wb = RAMP_HALF_W + 0.45 * H;
  const xA = HALF - 0.12, xB = xTop - 0.12;
  const P = (x, y, side) => [x, y, side * (wb + (wt - wb) * (y / H))];
  return polyGeometry([
    [P(xB, H, -1), P(xB, H, 1), P(xLand, H, 1), P(xLand, H, -1)],
    [P(xLand, H, -1), P(xLand, H, 1), P(xFoot, 0, 1), P(xFoot, 0, -1)],
    [P(xA, 0, -1), P(xB, H, -1), P(xLand, H, -1), P(xFoot, 0, -1)],
    [P(xFoot, 0, 1), P(xLand, H, 1), P(xB, H, 1), P(xA, 0, 1)],
  ], 1 / 2.4);
}

export class Pyramid {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.kinds = {};
    const matFor = { core: MAT.limestone, granite: MAT.granite, casing: MAT.tura, corner: MAT.tura, cap: MAT.gold };
    const geoFor = { core: GEO.core, granite: GEO.granite, casing: GEO.casing, corner: GEO.corner, cap: GEO.cap };
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const kind of Object.keys(matFor)) {
      const list = blocks.filter((b) => b.kind === kind);
      const im = new THREE.InstancedMesh(geoFor[kind], matFor[kind], list.length);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      const col = new THREE.Color();
      list.forEach((b, n) => {
        b.slot = n; im.setMatrixAt(n, zero);
        const v = 0.9 + ((b.i * 7 + b.k * 13 + b.L * 5) % 11) / 55;
        im.setColorAt(n, col.setRGB(v, v * (0.98 + (b.i % 3) * 0.01), v * 0.97));
      });
      im.instanceMatrix.needsUpdate = true;
      this.kinds[kind] = im;
      this.group.add(im);
    }
    // stair pieces are individual meshes
    this.stairMeshes = new Map();
    for (const b of blocks.filter((x) => x.stair)) {
      const r = b.k - 6;
      const m = new THREE.Mesh(GEO.stair[r], MAT.limestone);
      m.position.set(cx(b.i), b.L * B, cz(b.k));
      m.visible = false; m.castShadow = true; m.receiveShadow = true;
      this.group.add(m); this.stairMeshes.set(b.id, m);
    }

    // levelled platform: one paving tile per cell (removed over excavations)
    const tileGeo = new THREE.PlaneGeometry(B, B).rotateX(-Math.PI / 2);
    this.tiles = new THREE.InstancedMesh(tileGeo, MAT.paving, N * N);
    this.tiles.receiveShadow = true;
    for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
      this.tiles.setMatrixAt(i * N + k, tmpM.makeTranslation(cx(i), 0, cz(k)));
    }
    this.group.add(this.tiles);

    // loose sand over the site before levelling
    const sandGeo = new THREE.PlaneGeometry(N * B + 1.6, N * B + 1.6, 24, 24).rotateX(-Math.PI / 2);
    const sp = sandGeo.attributes.position;
    for (let v = 0; v < sp.count; v++) {
      const x = sp.getX(v), z = sp.getZ(v);
      const edge = Math.min(HALF + 0.8 - Math.abs(x), HALF + 0.8 - Math.abs(z));
      sp.setY(v, Math.min(1, edge / 1.5) * (0.55 + 0.25 * Math.sin(x * 0.5) * Math.cos(z * 0.4)));
    }
    sandGeo.computeVertexNormals();
    this.sand = new THREE.Mesh(sandGeo, MAT.sand.clone());
    this.sand.material.map = MAT.sand.map.clone(); this.sand.material.map.repeat.set(4, 4); this.sand.material.map.needsUpdate = true;
    this.sand.position.y = 0.002; this.sand.receiveShadow = true;
    this.group.add(this.sand);

    // timber decking (centering) over open spaces
    this.decks = new THREE.InstancedMesh(GEO.deck, MAT.wood, deckCells.length);
    this.decks.castShadow = true; this.decks.receiveShadow = true;
    deckCells.forEach((b, n) => { b.deckSlot = n; this.decks.setMatrixAt(n, zero); });
    this.group.add(this.decks);

    // excavations
    this.rockMesh = new THREE.Mesh(new THREE.BufferGeometry(), MAT.rock);
    this.rockMesh.receiveShadow = true; this.rockMesh.castShadow = false;
    this.group.add(this.rockMesh);
    this.digBoxes = [];
    for (let j = 0; j < 6; j++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5), MAT.rockFace);
      m.visible = false; m.receiveShadow = true; this.group.add(m); this.digBoxes.push(m);
    }
    this.descStairs = new Map();
    for (let c = 3; c <= 6; c++) {
      const g = descStairGeometry(edgeX(c + 1), edgeX(c), descFloor(edgeX(c + 1)), descFloor(edgeX(c)), cz(DESC.row), 6);
      const m = new THREE.Mesh(g, MAT.rock);
      m.visible = false; m.receiveShadow = true; this.group.add(m); this.descStairs.set(c, m);
    }

    // construction ramp
    this.rampH = 0;
    // two construction ramps, against the east and west faces (the west one is a mirror image)
    this.ramp = new THREE.Mesh(new THREE.BufferGeometry(), MAT.mud);
    this.ramp.castShadow = true; this.ramp.receiveShadow = true;
    this.rampW = new THREE.Mesh(this.ramp.geometry, MAT.mud);
    this.rampW.scale.x = -1; this.rampW.castShadow = true; this.rampW.receiveShadow = true;
    this.group.add(this.ramp, this.rampW);
    this.rebuildRock();
  }

  setLevelling(p) {
    // p: 0..1 progress of levelling the site
    this.sand.scale.y = Math.max(0.0001, 1 - p);
    this.sand.visible = p < 1;
  }

  place(b) {
    b.placed = true;
    if (b.stair) { this.stairMeshes.get(b.id).visible = true; return; }
    const im = this.kinds[b.kind];
    im.setMatrixAt(b.slot, blockMatrix(b));
    im.instanceMatrix.needsUpdate = true;
  }
  unplace(b) {
    b.placed = false;
    if (b.stair) { this.stairMeshes.get(b.id).visible = false; return; }
    const im = this.kinds[b.kind];
    im.setMatrixAt(b.slot, tmpM.makeScale(0, 0, 0));
    im.instanceMatrix.needsUpdate = true;
  }

  // a free-standing mesh of a block, for hauling
  looseMesh(b) {
    if (b.stair) return new THREE.Mesh(GEO.stair[b.k - 6], MAT.limestone);
    const im = this.kinds[b.kind];
    const m = new THREE.Mesh(im.geometry, im.material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  showDeck(b, on) {
    if (b.deckSlot === undefined) return;
    if (on) this.decks.setMatrixAt(b.deckSlot, tmpM.makeTranslation(cx(b.i), b.L * B, cz(b.k)));
    else this.decks.setMatrixAt(b.deckSlot, tmpM.makeScale(0, 0, 0));
    this.decks.instanceMatrix.needsUpdate = true;
  }

  // ---- excavation -------------------------------------------------------
  rebuildRock() {
    const polys = [];
    const open = (i, k, d) => { const c = getRock(i, k, d); return !!c && c.state !== 'rock'; };
    for (const c of rockCells) {
      if (c.state === 'rock') continue;
      const x0 = edgeX(c.i), x1 = x0 + B, z0 = edgeZ(c.k), z1 = z0 + B;
      const y1 = -(c.d - 1) * B, y0 = y1 - B;
      if (!(c.d < 3 && open(c.i, c.k, c.d + 1))) polys.push([[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]]);
      if (c.d > 1 && !open(c.i, c.k, c.d - 1)) polys.push([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]);
      if (!open(c.i - 1, c.k, c.d)) polys.push([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]]);
      if (!open(c.i + 1, c.k, c.d)) polys.push([[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]]);
      if (!open(c.i, c.k - 1, c.d)) polys.push([[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]]);
      if (!open(c.i, c.k + 1, c.d)) polys.push([[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]]);
      // ground tile over a started top-level cell is removed
      if (c.d === 1) this.tiles.setMatrixAt(c.i * N + c.k, tmpM.makeScale(0, 0, 0));
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    this.rockMesh.geometry.dispose();
    this.rockMesh.geometry = polys.length ? polyGeometry(polys, 1 / 2.5) : new THREE.BufferGeometry();
    // rock-cut steps appear once their column is fully cut
    for (const [col, m] of this.descStairs) {
      let all = true;
      for (let d = 1; d <= 3; d++) { const c = getRock(col, DESC.row, d); if (c && c.state !== 'dug') all = false; }
      m.visible = all;
    }
  }

  // progress boxes for cells being dug: [{cell, progress}]
  setDigging(list) {
    this.digBoxes.forEach((m, j) => {
      const it = list[j];
      if (!it) { m.visible = false; return; }
      const c = it.cell, p = Math.min(1, it.progress);
      const from = digFrom(c);
      const e = 0.004;
      let x0 = edgeX(c.i) + e, x1 = x0 + B - 2 * e, z0 = edgeZ(c.k) + e, z1 = z0 + B - 2 * e;
      let y1 = -(c.d - 1) * B - e, y0 = y1 - B + 2 * e;
      const cut = p * B;
      if (from === 'up' || from === 'top') y1 -= cut;
      else if (from[0] === 1) x1 -= cut; else if (from[0] === -1) x0 += cut;
      else if (from[1] === 1) z1 -= cut; else z0 += cut;
      if (c.zone === 'stair') { // the step profile is left standing below the floor
        y0 = Math.max(y0, descFloor(edgeX(c.i)) + 0.01);
        if (y0 >= y1) { m.visible = false; return; }
      }
      m.visible = true;
      m.position.set(x0, y0, z0);
      m.scale.set(Math.max(0.001, x1 - x0), Math.max(0.001, y1 - y0), Math.max(0.001, z1 - z0));
    });
  }

  // ---- ramp ---------------------------------------------------------------
  // east ramp height H, west ramp height HW (the west one stops rising for the last courses)
  setRamp(H, HW = H) {
    if (Math.abs(H - this.rampH) < 0.002 && Math.abs(HW - (this.rampHW ?? -1)) < 0.002 && this.ramp.geometry.attributes.position) return;
    this.rampH = H; this.rampHW = HW;
    this.ramp.visible = H > 0.02;
    this.rampW.visible = HW > 0.02;
    if (this.ramp.visible) { this.ramp.geometry.dispose(); this.ramp.geometry = rampGeometry(H); }
    if (this.rampW.visible) {
      if (this.rampW.geometry !== this.ramp.geometry) this.rampW.geometry.dispose();
      this.rampW.geometry = Math.abs(HW - H) < 1e-6 && this.ramp.visible ? this.ramp.geometry : rampGeometry(HW);
    }
  }

  setXray(on) {
    for (const m of [MAT.limestone, MAT.tura, MAT.granite, MAT.mud, MAT.paving]) {
      m.transparent = on; m.opacity = on ? 0.16 : 1; m.depthWrite = !on; m.needsUpdate = true;
    }
    for (const im of Object.values(this.kinds)) im.castShadow = !on;
    for (const m of this.stairMeshes.values()) m.castShadow = !on;
    this.ramp.castShadow = this.rampW.castShadow = !on;
  }
}
