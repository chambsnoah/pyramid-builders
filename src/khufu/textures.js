// Procedural textures for the Khufu view: stone with block joints (colour plus a normal
// map so the joints read as grooves up close), bedrock, sand, and the far-view hull.
import * as THREE from 'three';
import { COURSES, HEIGHT, BASE, HALF, halfWidthAt } from './data.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(g, w, h, n, colors, rmin, rmax, seed, alpha = [0.25, 0.5]) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = alpha[0] + r() * alpha[1];
    g.beginPath(); g.arc(r() * w, r() * h, rmin + r() * (rmax - rmin), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

// Normal map from a height canvas (white = high), Sobel gradient.
function normalFromHeight(hc, strength) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), og = out.getContext('2d'), img = og.createImageData(w, h), d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) * strength;
    const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
    d[o] = (-dx / l * 0.5 + 0.5) * 255; d[o + 1] = (dy / l * 0.5 + 0.5) * 255; d[o + 2] = (1 / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return tex(out, false);
}

// A block-joint tile: `rows` courses tall; each row lists its vertical joints as fractions of the width.
function jointTile({ w, h, base, speck, seed, rows, line = 'rgba(70,52,32,0.55)', lw = 3, variation = 0.06 }) {
  const c = canvas(w, h), g = c.getContext('2d');
  const hc = canvas(w, h), hg = hc.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  hg.fillStyle = '#fff'; hg.fillRect(0, 0, w, h);
  const r = rng(seed);
  const rh = h / rows.length;
  // a slightly different shade for each block
  rows.forEach((joints, j) => {
    const xs = [...joints, joints[0] + 1];
    for (let i = 0; i + 1 < xs.length; i++) {
      const v = (r() - 0.5) * 2 * variation;
      g.fillStyle = v > 0 ? `rgba(255,248,235,${v})` : `rgba(60,40,20,${-v})`;
      const x0 = xs[i] * w, x1 = xs[i + 1] * w;
      for (const off of [0, -w]) g.fillRect(x0 + off, j * rh, x1 - x0, rh);
    }
  });
  speckle(g, w, h, (w * h) / 90, speck, 0.5, 2.2, seed + 1);
  speckle(g, w, h, 40, speck, 8, 22, seed + 2, [0.05, 0.08]);
  for (const [ctx, col, width] of [[g, line, lw], [hg, '#000', lw * 1.6]]) {
    ctx.strokeStyle = col; ctx.lineWidth = width;
    rows.forEach((joints, j) => {
      for (const u of joints) { ctx.beginPath(); ctx.moveTo(u * w, j * rh); ctx.lineTo(u * w, (j + 1) * rh); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(0, j * rh); ctx.lineTo(w, j * rh); ctx.stroke();
    });
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, h); ctx.stroke();
  }
  hg.filter = 'blur(1.5px)'; hg.drawImage(hc, 0, 0); hg.filter = 'none';
  return { map: tex(c), normalMap: normalFromHeight(hc, 2.2) };
}

export const TX = {};
export function buildTextures() {
  // Tura casing: one course per tile height, three blocks per tile width (4.5 m)
  TX.casing = jointTile({ w: 1024, h: 256, base: '#e4d8bf', speck: ['#d6c8aa', '#efe6d2', '#cbbd9f'], seed: 11, rows: [[0, 0.36, 0.7]], line: 'rgba(120,100,70,0.5)', lw: 2.5, variation: 0.04 });
  // limestone lining: two blocks by two courses, joints staggered
  TX.lime = jointTile({ w: 1024, h: 512, base: '#cfba92', speck: ['#b89d70', '#ddc9a2', '#a8906a', '#e2d2ad'], seed: 21, rows: [[0, 0.5], [0.25, 0.75]] });
  TX.granite = jointTile({ w: 1024, h: 512, base: '#9a5f55', speck: ['#2b2222', '#d9a59a', '#6e3d38', '#e8d0c8', '#4a3030'], seed: 31, rows: [[0, 0.5], [0.25, 0.75]], line: 'rgba(30,18,16,0.7)', lw: 2, variation: 0.05 });
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#b39870'; g.fillRect(0, 0, 512, 512);
    speckle(g, 512, 512, 7000, ['#9c8160', '#c9b08a', '#8a7052', '#d6c29c'], 0.8, 4, 41);
    const r = rng(42);
    g.strokeStyle = 'rgba(70,52,34,0.4)'; g.lineWidth = 1.6;
    for (let i = 0; i < 260; i++) { // chisel marks
      const x = r() * 512, y = r() * 512, a = r() * 0.6 - 0.3 + Math.PI / 4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); g.stroke();
    }
    const hc = canvas(512, 512), hg = hc.getContext('2d');
    hg.filter = 'grayscale(1) blur(2px)'; hg.drawImage(c, 0, 0); hg.filter = 'none';
    TX.rock = { map: tex(c), normalMap: normalFromHeight(hc, 1.1) };
  }
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    g.fillStyle = '#d2b07a'; g.fillRect(0, 0, 512, 512);
    speckle(g, 512, 512, 9000, ['#c9a76c', '#e6cb95', '#bf9a5f', '#efd8a6'], 0.5, 2, 51);
    speckle(g, 512, 512, 40, ['#d0ad74', '#d8b984'], 30, 80, 52, [0.06, 0.1]);
    TX.sand = tex(c);
  }
  TX.pave = jointTile({ w: 512, h: 512, base: '#d6c49e', speck: ['#c4ad80', '#e3d4b0'], seed: 61, rows: [[0, 0.5], [0.3, 0.8]], line: 'rgba(100,80,55,0.45)', lw: 2.5 });
  TX.hull = hullTexture();
}

// The far view: one texture over each face triangle, with every course line and the
// vertical joints drawn at their real positions. u runs along the base (0..1), v up (0..1).
function hullTexture() {
  const W = 1024, Hp = 2048;
  const c = canvas(W, Hp), g = c.getContext('2d');
  g.fillStyle = '#e2d6bd'; g.fillRect(0, 0, W, Hp);
  speckle(g, W, Hp, 30000, ['#d6c8aa', '#efe6d2', '#cbbd9f'], 0.6, 1.6, 71);
  const r = rng(72);
  const X = (s) => (s / BASE) * W, Y = (y) => Hp - (y / HEIGHT) * Hp;
  for (const co of COURSES) {
    if (co.kind !== 'course') continue;
    const y0 = Y(co.y0), y1 = Y(co.y1), hw = halfWidthAt(co.y0);
    g.fillStyle = `rgba(${r() > 0.5 ? '255,250,240' : '90,70,40'},${0.03 + r() * 0.05})`;
    g.fillRect(X(HALF - hw), y1, X(2 * hw), y0 - y1);
    g.strokeStyle = 'rgba(120,100,70,0.55)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(HALF - hw), y0); g.lineTo(X(HALF + hw), y0); g.stroke();
    g.strokeStyle = 'rgba(120,100,70,0.3)';
    for (let s = HALF - hw + r() * 1.5; s < HALF + hw; s += 1.2 + r() * 0.9) { g.beginPath(); g.moveTo(X(s), y0); g.lineTo(X(s), y1); g.stroke(); }
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
