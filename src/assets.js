// Procedural textures, materials and geometries (no external assets).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { B } from './plan.js';

// ---- textures --------------------------------------------------------------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function canvasTex(size, draw, repeat = 1, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(g, size, n, colors, rmin, rmax, seed) {
  const r = rng(seed);
  const big = rmin > 6;
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = big ? 0.08 + r() * 0.12 : 0.25 + r() * 0.5;
    const rad = rmin + r() * (rmax - rmin);
    g.beginPath(); g.arc(r() * size, r() * size, rad, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

export const TEX = {};
export function buildTextures() {
  TEX.limestone = canvasTex(256, (g, s) => {
    g.fillStyle = '#cdb68c'; g.fillRect(0, 0, s, s);
    speckle(g, s, 2600, ['#b89d70', '#d9c59c', '#a8906a', '#e2d2ad'], 0.6, 3, 11);
    speckle(g, s, 30, ['#c4aa7e', '#d4c096'], 10, 26, 12);
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, 'rgba(70,50,30,0.35)'); grd.addColorStop(0.04, 'rgba(0,0,0,0)');
    grd.addColorStop(0.96, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(70,50,30,0.35)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  });
  TEX.tura = canvasTex(256, (g, s) => {
    g.fillStyle = '#e2d6bd'; g.fillRect(0, 0, s, s);
    speckle(g, s, 1400, ['#d6c8aa', '#eee4cf', '#cbbd9f'], 0.5, 2.2, 21);
  });
  TEX.granite = canvasTex(256, (g, s) => {
    g.fillStyle = '#9a5f55'; g.fillRect(0, 0, s, s);
    speckle(g, s, 5000, ['#2b2222', '#d9a59a', '#6e3d38', '#e8d0c8', '#4a3030'], 0.6, 2.4, 31);
  });
  TEX.rock = canvasTex(256, (g, s) => {
    g.fillStyle = '#b79c74'; g.fillRect(0, 0, s, s);
    speckle(g, s, 3000, ['#9c8160', '#c9b08a', '#8a7052', '#d6c29c'], 0.8, 4, 41);
    g.strokeStyle = 'rgba(80,60,40,0.35)'; g.lineWidth = 1.2;
    const r = rng(42);
    for (let i = 0; i < 60; i++) { // chisel marks
      const x = r() * s, y = r() * s, a = r() * 0.6 - 0.3 + Math.PI / 4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke();
    }
  });
  TEX.sand = canvasTex(512, (g, s) => {
    g.fillStyle = '#d2b07a'; g.fillRect(0, 0, s, s);
    speckle(g, s, 9000, ['#c9a76c', '#e6cb95', '#bf9a5f', '#efd8a6'], 0.5, 2, 51);
    speckle(g, s, 40, ['#d0ad74', '#d8b984'], 30, 80, 52);
  }, 40);
  TEX.paving = canvasTex(256, (g, s) => {
    g.fillStyle = '#d2bd94'; g.fillRect(0, 0, s, s);
    speckle(g, s, 1800, ['#bea67a', '#e0cfa8'], 0.6, 2.5, 61);
    g.strokeStyle = 'rgba(90,70,45,0.45)'; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
  });
  TEX.wood = canvasTex(128, (g, s) => {
    g.fillStyle = '#8a5a32'; g.fillRect(0, 0, s, s);
    const r = rng(71);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = r() > 0.5 ? 'rgba(60,35,15,0.5)' : 'rgba(170,120,70,0.35)';
      g.lineWidth = 1 + r() * 2; const y = r() * s;
      g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + r() * 6 - 3, s * 0.6, y + r() * 6 - 3, s, y); g.stroke();
    }
  });
  TEX.mud = canvasTex(256, (g, s) => {
    g.fillStyle = '#b8966a'; g.fillRect(0, 0, s, s);
    speckle(g, s, 2500, ['#8e6f45', '#b8966a', '#7a5d3a', '#c4a678'], 0.8, 3.5, 81);
    g.strokeStyle = 'rgba(70,50,30,0.35)'; g.lineWidth = 2;
    for (let y = 0; y < s; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); }
  });
  TEX.waterNormal = canvasTex(256, (g, s) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const a = Math.sin((x / s) * Math.PI * 8 + Math.sin((y / s) * Math.PI * 4) * 2) * 0.5;
      const b = Math.cos((y / s) * Math.PI * 10 + Math.sin((x / s) * Math.PI * 6)) * 0.5;
      const o = (y * s + x) * 4;
      img.data[o] = 128 + a * 60; img.data[o + 1] = 128 + b * 60; img.data[o + 2] = 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, 30, false);
}

// ---- materials -------------------------------------------------------------
export const MAT = {};
export function buildMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  MAT.limestone = std({ map: TEX.limestone });
  MAT.tura = std({ map: TEX.tura, roughness: 0.55 });
  MAT.granite = std({ map: TEX.granite, roughness: 0.45 });
  MAT.gold = std({ color: 0xf2c14e, metalness: 0.45, roughness: 0.3, emissive: 0x4a3300 });
  MAT.rock = std({ map: TEX.rock });
  MAT.rockFace = std({ map: TEX.rock, color: 0xe8d2b0 });
  MAT.sand = std({ map: TEX.sand, roughness: 1 });
  MAT.paving = std({ map: TEX.paving });
  MAT.wood = std({ map: TEX.wood, roughness: 0.8 });
  MAT.darkWood = std({ map: TEX.wood, color: 0x8a6a50 });
  MAT.mud = std({ map: TEX.mud, roughness: 1 });
  MAT.rope = std({ color: 0xb9975c, roughness: 1 });
  MAT.clay = std({ color: 0xb4643a, roughness: 0.85 });
  MAT.whiteJar = std({ color: 0xe8dcc4, roughness: 0.7 });
  MAT.copper = std({ color: 0xc27a45, metalness: 0.7, roughness: 0.4 });
  MAT.reed = std({ color: 0xc8a660, roughness: 1 });
  MAT.linen = std({ color: 0xf2ecdc, roughness: 1, side: THREE.DoubleSide });
  MAT.paint = std({ color: 0x2f6f8f, roughness: 0.7 });
  MAT.palmLeaf = std({ color: 0x5f7a2c, roughness: 1, side: THREE.DoubleSide });
  MAT.palmTrunk = std({ color: 0x7a5c3a, roughness: 1 });
  MAT.bread = std({ color: 0xc58b45, roughness: 1 });
  MAT.lamp = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  MAT.water = new THREE.MeshStandardMaterial({ color: 0x2f6b6a, roughness: 0.15, metalness: 0.1, normalMap: TEX.waterNormal, transparent: true, opacity: 0.92 });
  MAT.water.normalScale.set(0.6, 0.6);
}

// ---- geometry helpers ------------------------------------------------------
// Build a flat-shaded geometry from convex polygons, with planar UVs scaled by `uvScale`.
export function polyGeometry(polys, uvScale = 1 / B) {
  const pos = [], nor = [], uv = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const p of polys) {
    a.fromArray(p[0]); b.fromArray(p[1]); c.fromArray(p[2]);
    n.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const proj = (v) => (ay >= ax && ay >= az ? [v[0], v[2]] : ax >= az ? [v[2], v[1]] : [v[0], v[1]]);
    for (let i = 1; i < p.length - 1; i++) {
      for (const v of [p[0], p[i], p[i + 1]]) {
        pos.push(...v); nor.push(n.x, n.y, n.z);
        const t = proj(v); uv.push(t[0] * uvScale, t[1] * uvScale);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export const GEO = {};
export function buildGeometries() {
  const h = B / 2;
  GEO.core = new RoundedBoxGeometry(B, B, B, 1, 0.035).translate(0, h, 0);
  GEO.granite = GEO.core;
  // casing: outward face +x, slope from outer bottom edge to inner top edge
  GEO.casing = polyGeometry([
    [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]], // bottom
    [[-h, 0, h], [h, 0, h], [-h, B, h]],                         // south side
    [[h, 0, -h], [-h, 0, -h], [-h, B, -h]],                      // north side
    [[-h, 0, -h], [-h, 0, h], [-h, B, h], [-h, B, -h]],           // inner (west) face
    [[h, 0, h], [h, 0, -h], [-h, B, -h], [-h, B, h]],             // slope
  ]);
  // corner: slopes toward +x and +z, apex above inner corner (-x,-z)
  const ap = [-h, B, -h];
  GEO.corner = polyGeometry([
    [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]],
    [[-h, 0, -h], [-h, 0, h], ap],
    [[h, 0, -h], [-h, 0, -h], ap],
    [[h, 0, h], [h, 0, -h], ap],
    [[-h, 0, h], [h, 0, h], ap],
  ]);
  const top = [0, h, 0];
  GEO.cap = polyGeometry([
    [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]],
    [[-h, 0, h], [h, 0, h], top], [[h, 0, h], [h, 0, -h], top],
    [[h, 0, -h], [-h, 0, -h], top], [[-h, 0, -h], [-h, 0, h], top],
  ]);
  // ascending stair piece: 4 steps rising toward +z, local base at y=0.
  GEO.stair = [];
  for (let r = 0; r < 4; r++) {
    const base = r < 2 ? 0 : B;
    const parts = [];
    for (let j = 0; j < 4; j++) {
      const topY = (r * 4 + j + 1) * (2 * B / 16) - base;
      const z0 = -h + j * (B / 4);
      const box = new THREE.BoxGeometry(B, topY, B - j * (B / 4));
      box.translate(0, topY / 2, z0 + (B - j * (B / 4)) / 2);
      parts.push(box);
    }
    // only the tallest step box reaches z=+h; merged boxes overlap internally, which is invisible
    GEO.stair.push(mergeGeometries(parts.map((p) => p.toNonIndexed())));
  }
  // timber decking over open spaces
  {
    const parts = [];
    for (let j = 0; j < 5; j++) {
      const bx = new THREE.BoxGeometry(B, 0.11, B / 5 - 0.012);
      bx.translate(0, -0.055, -h + B / 10 + j * (B / 5));
      parts.push(bx.toNonIndexed());
    }
    GEO.deck = mergeGeometries(parts);
  }
  GEO.sled = (() => {
    const parts = [];
    for (const s of [-1, 1]) {
      const r = new THREE.BoxGeometry(0.13, 0.13, 1.3); r.translate(s * 0.42, 0.065, 0); parts.push(r.toNonIndexed());
      const tip = new THREE.BoxGeometry(0.13, 0.13, 0.3); tip.rotateX(-0.55); tip.translate(s * 0.42, 0.13, 0.75); parts.push(tip.toNonIndexed());
    }
    for (let j = -2; j <= 2; j++) { const c = new THREE.BoxGeometry(1.0, 0.07, 0.14); c.translate(0, 0.165, j * 0.28); parts.push(c.toNonIndexed()); }
    return mergeGeometries(parts);
  })();
  GEO.jar = new THREE.LatheGeometry([[0, 0], [0.09, 0.01], [0.16, 0.12], [0.17, 0.25], [0.12, 0.4], [0.07, 0.46], [0.08, 0.5], [0.06, 0.5]].map((p) => new THREE.Vector2(p[0], p[1])), 10);
  GEO.basket = new THREE.LatheGeometry([[0, 0], [0.16, 0.01], [0.24, 0.12], [0.25, 0.16], [0.23, 0.16]].map((p) => new THREE.Vector2(p[0], p[1])), 10);
  GEO.basketFill = new THREE.CylinderGeometry(0.22, 0.2, 0.06, 10).translate(0, 0.13, 0);
  GEO.crate = new THREE.BoxGeometry(0.55, 0.35, 0.4).translate(0, 0.175, 0);
  GEO.beam = new THREE.BoxGeometry(0.18, 0.18, 2.6).translate(0, 0.09, 0);
  GEO.lever = new THREE.CylinderGeometry(0.035, 0.045, 2.2, 6).translate(0, 1.1, 0);
  GEO.rope = new THREE.CylinderGeometry(0.018, 0.018, 1, 4).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  GEO.mallet = (() => { const h1 = new THREE.CylinderGeometry(0.02, 0.02, 0.32, 5).translate(0, 0.16, 0); const hd = new THREE.CylinderGeometry(0.06, 0.07, 0.16, 8).rotateZ(Math.PI / 2).translate(0, 0.32, 0); return mergeGeometries([h1.toNonIndexed(), hd.toNonIndexed()]); })();
  GEO.pick = (() => { const h1 = new THREE.CylinderGeometry(0.02, 0.02, 0.7, 5).translate(0, 0.35, 0); const hd = new THREE.BoxGeometry(0.05, 0.05, 0.32).translate(0, 0.68, 0.08); return mergeGeometries([h1.toNonIndexed(), hd.toNonIndexed()]); })();
  GEO.hoe = (() => { const h1 = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5).translate(0, 0.45, 0); const hd = new THREE.BoxGeometry(0.2, 0.02, 0.18).translate(0, 0.88, 0.1); return mergeGeometries([h1.toNonIndexed(), hd.toNonIndexed()]); })();
  GEO.sarcophagus = (() => {
    const box = new RoundedBoxGeometry(2.1, 0.95, 0.95, 1, 0.03).translate(0, 0.475, 0);
    const lid = new RoundedBoxGeometry(2.14, 0.18, 0.99, 1, 0.04).translate(0, 1.04, 0);
    return mergeGeometries([box, lid]);
  })();
  GEO.chest = new RoundedBoxGeometry(0.8, 0.5, 0.5, 1, 0.03).translate(0, 0.25, 0);
  GEO.chestTrim = mergeGeometries([
    new THREE.BoxGeometry(0.84, 0.06, 0.54).translate(0, 0.42, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.06, 0.52, 0.54).translate(-0.3, 0.26, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.06, 0.52, 0.54).translate(0.3, 0.26, 0).toNonIndexed(),
  ]);
  GEO.statue = (() => {
    const base = new THREE.BoxGeometry(0.5, 0.15, 0.6).translate(0, 0.075, 0);
    const body = new THREE.CylinderGeometry(0.16, 0.2, 1.1, 8).translate(0, 0.7, 0);
    const head = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.38, 0);
    const crown = new THREE.ConeGeometry(0.11, 0.3, 8).translate(0, 1.6, 0);
    return mergeGeometries([base.toNonIndexed(), body.toNonIndexed(), head.toNonIndexed(), crown.toNonIndexed()]);
  })();
}

// Rock-cut descending stair: one solid per column (3..6), steps falling toward -x.
export function descStairGeometry(x0, x1, y0, y1, zc, steps) {
  const parts = [];
  const run = (x0 - x1) / steps, rise = (y0 - y1) / steps;
  for (let s = 0; s < steps; s++) {
    const xa = x0 - s * run, xb = xa - run;
    const topY = y0 - (s + 1) * rise;
    const bottom = -3 * B - 0.02;
    const bx = new THREE.BoxGeometry(run, topY - bottom, B - 0.004);
    bx.translate((xa + xb) / 2, (topY + bottom) / 2, zc);
    parts.push(bx.toNonIndexed());
  }
  return mergeGeometries(parts);
}

// A casing or corner stone part-way through being dressed: t=0 is the squared block as
// delivered, t=1 the finished slope (same shape as GEO.casing / GEO.corner).
const dressCache = new Map();
export function dressedGeometry(kind, t) {
  if (t >= 1) return kind === 'corner' ? GEO.corner : GEO.casing;
  const step = Math.max(0, Math.round(t * 12));
  const keyName = kind + step;
  if (dressCache.has(keyName)) return dressCache.get(keyName);
  const h = B / 2, xt = h - (step / 12) * B;
  const polys = [[[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]]];
  if (kind === 'corner') {
    polys.push(
      [[-h, 0, -h], [-h, 0, h], [-h, B, xt], [-h, B, -h]],
      [[h, 0, -h], [-h, 0, -h], [-h, B, -h], [xt, B, -h]],
      [[-h, B, -h], [-h, B, xt], [xt, B, xt], [xt, B, -h]],
      [[h, 0, h], [h, 0, -h], [xt, B, -h], [xt, B, xt]],
      [[-h, 0, h], [h, 0, h], [xt, B, xt], [-h, B, xt]],
    );
  } else {
    polys.push(
      [[-h, 0, -h], [-h, 0, h], [-h, B, h], [-h, B, -h]],
      [[-h, 0, h], [h, 0, h], [xt, B, h], [-h, B, h]],
      [[h, 0, -h], [-h, 0, -h], [-h, B, -h], [xt, B, -h]],
      [[-h, B, -h], [-h, B, h], [xt, B, h], [xt, B, -h]],
      [[h, 0, h], [h, 0, -h], [xt, B, -h], [xt, B, h]],
    );
  }
  const g = polyGeometry(polys);
  dressCache.set(keyName, g);
  return g;
}
