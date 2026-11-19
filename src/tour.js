// Guided tour: one scripted timeline that drives the simulation clock, the camera, X-ray,
// first-person walking and captions. It plays live in the app and renders frame by frame
// for the video. Because the build is deterministic, the sim times below line up with the
// milestones every run.
import * as THREE from 'three';
import { Path, v3 } from './core.js';
import { B, HALF, cx, cz, edgeX, edgeZ, stairFloor, descFloor } from './plan.js';

const ease = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;
// FPS yaw that faces from a toward b (the walker looks along (-sin yaw, -cos yaw))
const faceYaw = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

function orbitCam(center, radius, height, a0, spin, lookY = 2) {
  return (u, dur, cam) => {
    const a = a0 + spin * u * dur;
    cam.position.set(center.x + Math.cos(a) * radius, height, center.z + Math.sin(a) * radius);
    cam.lookAt(center.x, lookY, center.z);
  };
}
function moveCam(p0, p1, l0, l1) {
  return (u, dur, cam) => {
    const e = ease(u);
    cam.position.lerpVectors(p0, p1, e);
    cam.lookAt(new THREE.Vector3().lerpVectors(l0, l1, e));
  };
}

// first-person legs: positions along a path, with the view turned to follow it or held on a point
function walkPts(pts) { return new Path(pts.map((p) => v3(...p))); }

const ANTE = [cx(8), 0, cz(4)];
const stairUp = () => { const pts = [[cx(8), 0, cz(5)]]; for (let z = edgeZ(6); z <= edgeZ(10) + 0.01; z += 0.5) pts.push([cx(8), stairFloor(z), z]); pts.push([cx(8), 2 * B, 2.7]); return pts; };
const stairDown = () => { const pts = [[edgeX(7) + 0.4, 0, cz(4)]]; for (let x = edgeX(7) - 0.3; x > edgeX(3); x -= 0.5) pts.push([x, descFloor(x), cz(4)]); pts.push([cx(2), -3 * B, cz(4)]); return pts; };

export const SHOTS = [
  { dur: 6, sim: [0, 90], cam: orbitCam(v3(14, 0, 4), 78, 46, 2.4, 0.03),
    title: 'Pyramid Builders', sub: 'A simulated build of a small Old Kingdom pyramid, from bare bedrock to a furnished tomb' },
  { dur: 7, sim: [90, 175], cam: moveCam(v3(26, 9, -22), v3(20, 7, -18), v3(2, 0, -2), v3(0, 0, 0)),
    title: 'Day 1: levelling the bedrock', sub: 'Workers with hoes scrape the site flat while the first boats come up the Nile' },
  { dur: 8, sim: [175, 330], cam: moveCam(v3(2, 6, 22), v3(16, 5, 23), v3(10, 1, 34), v3(18, 1, 34)),
    title: 'The quarry', sub: 'Pairs of quarrymen chisel channels round each block, lever it free and roll it to the pile' },
  { dur: 8, sim: [330, 560], cam: moveCam(v3(36, 14, -36), v3(40, 12, -2), v3(54, 0, -20), v3(56, 0, -6)),
    title: 'The harbour', sub: 'Barges bring white Tura casing and Aswan granite. Dock workers lever each stone ashore, and masons cut casing to the slope' },
  { dur: 12, sim: [560, 6940], cam: orbitCam(v3(2, 0, 2), 40, 24, -0.6, 0.06, 1),
    title: 'Course 1: 274 stones', sub: 'Each stone is pushed across the course and levered into its bed, farthest first, so no gap is ever walled in' },
  { dur: 8, sim: [7200, 7380], cam: moveCam(v3(30, 5, 12), v3(26, 5.5, 10), v3(14, 1.2, 0), v3(13, 1.4, 0)),
    title: 'Up the ramp', sub: 'Six haulers drag each four-tonne stone on a sled; a water carrier wets the sand in front of the runners' },
  { dur: 9, sim: [7380, 13900], cam: orbitCam(v3(0, 0, 3.75), 19, 12, 0.9, 0.08, 2.5), xray: true,
    title: 'The granite chamber', sub: 'Aswan granite lines the upper burial chamber. The sarcophagus is hauled in before the roof goes on' },
  { dur: 12, sim: [13900, 33205], cam: orbitCam(v3(2, 0, 2), 48, 28, -1.3, 0.07, 4),
    title: 'Rising course by course', sub: 'Two ramps and four setting crews; the ramps are raised with rubble before every course',
    beats: [[31258, 'One ramp for the last two courses', 'With only nine stones and then the capstone left, the west ramp is no longer needed'],
      [33150, 'The gilded capstone', 'The last stone goes up the east ramp']] },
  { dur: 7, sim: [33205, 35017], cam: orbitCam(v3(4, 0, 2), 52, 22, 2.3, 0.06, 4),
    title: 'The ramps come down', sub: 'Rubble is carried away from the top down, revealing the white casing',
    beats: [[34627, 'Furnishing the tomb', 'Porters carry chests and gilded statues into both chambers']] },
  { dur: 5, sim: 'end', cam: moveCam(v3(-30, 26, -46), v3(-8, 6, -30), v3(0, 5, 0), v3(0, 3, -10)),
    title: 'Finished', sub: '903 stones in 9 courses, two burial chambers, and a passage cut deep into the bedrock' },
  { dur: 7, sim: 'end', walk: { path: () => walkPts([[0, 0, -20], [0, 0, -HALF - 0.5], [cx(8), 0, cz(2)], ANTE]), pitch: 0.05 },
    title: 'Walking in', sub: 'The entrance passage leads to the antechamber, roofed on cedar beams laid as centering' },
  { dur: 6, sim: 'end', walk: { path: () => walkPts(stairUp()), pitch: 0.18 },
    title: 'The ascending stair', sub: 'Four stepped stones climb to the granite chamber' },
  { dur: 7, sim: 'end', look: { from: [0.2, 2 * B, 2.7], at: [[-2.2, 2.9, 3.75], [-2.2, 2.9, 3.75], [2.5, 2.8, 2.4], [2.5, 2.8, 2.4]] }, open: [[4.6, 'upper']],
    title: 'The granite chamber', sub: 'Look at anything to see what it is; E opens a chest' },
  { dur: 7, sim: 'end', cam: orbitCam(v3(0, 0, 0), 30, 9, 3.6, 0.12, -0.5), xray: true, labels: true,
    title: 'X-ray', sub: 'In the masonry: antechamber, stair and granite chamber. In the bedrock: the rock-cut stair, passage and burial chamber' },
  { dur: 10, sim: 'end', walk: { path: () => walkPts([ANTE, ...stairDown(), [cx(2), -3 * B, cz(9)], [cx(5), -3 * B, cz(9)], [-0.6, -3 * B, cz(9)]]), pitch: -0.05 },
    title: 'Into the bedrock', sub: 'A rock-cut stair and a passage, dug by hand with copper chisels, lead to the subterranean chamber' },
  { dur: 5, sim: 'end', look: { from: [-0.6, -3 * B, cz(9)], at: [[2.5, -3.4, 1.25], [2.5, -3.4, 1.25]] }, open: [[1.2, 'lower']],
    title: 'The subterranean chamber', sub: 'Chests of linen, amulets and food for the afterlife' },
  { dur: 5, sim: 'end', cam: orbitCam(v3(6, 0, 2), 80, 30, 0.6, 0.05, 6),
    title: 'Pyramid Builders', sub: 'Built with three.js. Every texture and model is generated in code' },
];
export const TOUR_LENGTH = SHOTS.reduce((s, x) => s + x.dur, 0);

export class Tour {
  constructor(app) { this.app = app; this.t = 0; this.shot = -1; this.opened = new Set(); this.active = false; }

  // advance the tour to time t (seconds); returns the overlay to draw
  apply(t, dt) {
    const { sim, camera, fps } = this.app;
    let start = 0, idx = 0;
    while (idx < SHOTS.length - 1 && t >= start + SHOTS[idx].dur) { start += SHOTS[idx].dur; idx++; }
    const s = SHOTS[idx], u = Math.min(1, (t - start) / s.dur);
    if (idx !== this.shot) { this.enterShot(s); this.shot = idx; }
    // simulation clock
    let simDt = 0;
    const goal = s.sim === 'end' ? Infinity : lerp(s.sim[0], s.sim[1], u);
    const t0 = sim.sched.time;
    while ((goal === Infinity ? sim.phase !== 'complete' : sim.sched.time < goal) && sim.sched.time < 60000) sim.tick(1 / 30);
    simDt = sim.sched.time - t0;
    // camera
    if (s.cam) s.cam(u, s.dur, camera);
    if (s.walk) {
      const path = this.path || (this.path = s.walk.path());
      const d = path.length * ease(u);
      const p = path.at(d);
      fps.pos.copy(p); fps.vel.set(0, 0, 0); fps.vy = 0;
      const ahead = path.at(Math.min(path.length, d + 1.2));
      if (ahead.distanceTo(p) > 0.05) fps.yaw = faceYaw(p, ahead);
      fps.pitch = s.walk.pitch;
      fps.update(dt);
    }
    if (s.look) {
      const from = v3(...s.look.from), seq = s.look.at;
      const k = Math.min(seq.length - 1.001, u * (seq.length - 1));
      const a = v3(...seq[Math.floor(k)]), b = v3(...seq[Math.ceil(k)]);
      const target = a.lerp(b, ease(k - Math.floor(k)));
      fps.pos.copy(from); fps.vel.set(0, 0, 0); fps.vy = 0;
      fps.yaw = faceYaw(from, target);
      fps.pitch = Math.atan2(target.y - (from.y + 1.62), Math.hypot(target.x - from.x, target.z - from.z));
      fps.update(dt);
    }
    for (const [at, which] of s.open || []) {
      const key = idx + which;
      if (t - start >= at && !this.opened.has(key)) { this.opened.add(key); this.app.openChestInView(); }
    }
    // caption: the shot's, or the latest beat the build has reached
    let title = s.title, sub = s.sub;
    for (const [when, bt, bs] of s.beats || []) if (sim.sched.time >= when) { title = bt; sub = bs; }
    return { title, sub, simDt, fade: Math.min(1, (t - start) / 0.6, (start + s.dur - t) / 0.4 + 0.3), labels: !!s.labels };
  }

  enterShot(s) {
    const { setXray, setWalk } = this.app;
    this.path = null;
    setXray(!!s.xray);
    setWalk(!!(s.walk || s.look));
  }
}

// draw captions, status and labels on top of a rendered frame (used for the video)
export function drawOverlay(ctx, w, h, ov, extra) {
  ctx.save();
  const pad = Math.round(w * 0.035);
  // caption box, lower left
  const titleSize = Math.round(h * 0.042), subSize = Math.round(h * 0.026);
  ctx.font = `600 ${subSize}px "Avenir Next", "Segoe UI", system-ui, sans-serif`;
  const maxW = Math.min(w * 0.6, 760);
  const lines = wrap(ctx, ov.sub || '', maxW);
  const boxH = titleSize * 1.5 + lines.length * subSize * 1.4 + pad * 0.6;
  const boxW = Math.max(maxW * 0.5, Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width), measureTitle(ctx, ov.title, titleSize)))) + pad * 0.8;
  const x = pad, y = h - pad - boxH;
  ctx.globalAlpha = Math.max(0, Math.min(1, ov.fade ?? 1));
  ctx.fillStyle = 'rgba(28, 20, 12, 0.72)';
  roundRect(ctx, x, y, boxW, boxH, 14); ctx.fill();
  ctx.fillStyle = '#e9b949';
  ctx.font = `700 ${titleSize}px "Avenir Next", "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(ov.title || '', x + pad * 0.4, y + titleSize * 1.15 + pad * 0.1);
  ctx.fillStyle = '#fbf3e2';
  ctx.font = `500 ${subSize}px "Avenir Next", "Segoe UI", system-ui, sans-serif`;
  lines.forEach((l, n) => ctx.fillText(l, x + pad * 0.4, y + titleSize * 1.5 + pad * 0.15 + (n + 0.85) * subSize * 1.4));
  ctx.globalAlpha = 1;
  // status, top left
  if (extra.status) {
    ctx.font = `600 ${Math.round(h * 0.022)}px "Avenir Next", system-ui, sans-serif`;
    const sw = ctx.measureText(extra.status).width + 24;
    ctx.fillStyle = 'rgba(28, 20, 12, 0.6)'; roundRect(ctx, pad, pad, sw, h * 0.045, 10); ctx.fill();
    ctx.fillStyle = '#fbf3e2'; ctx.fillText(extra.status, pad + 12, pad + h * 0.031);
  }
  // what the walker is looking at
  if (extra.look) {
    const s1 = Math.round(h * 0.024), s2 = Math.round(h * 0.02);
    ctx.font = `600 ${s1}px "Avenir Next", system-ui, sans-serif`;
    const t1 = extra.look.name, t2 = extra.look.detail, t3 = extra.look.action || '';
    ctx.font = `500 ${s2}px "Avenir Next", system-ui, sans-serif`;
    const bw = Math.min(w * 0.5, Math.max(ctx.measureText(t2).width, 200) + 28);
    const bx = w / 2 - bw / 2, by = h / 2 + 22, bh = s1 * 1.6 + s2 * 1.4 * (t3 ? 2 : 1) + 8;
    ctx.fillStyle = 'rgba(28, 20, 12, 0.7)'; roundRect(ctx, bx, by, bw, bh, 10); ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9b949'; ctx.font = `600 ${s1}px "Avenir Next", system-ui, sans-serif`; ctx.fillText(t1, w / 2, by + s1 * 1.25);
    ctx.fillStyle = '#fbf3e2'; ctx.font = `500 ${s2}px "Avenir Next", system-ui, sans-serif`; ctx.fillText(t2, w / 2, by + s1 * 1.3 + s2 * 1.3, bw - 20);
    if (t3) { ctx.fillStyle = 'rgba(251,243,226,0.7)'; ctx.fillText(t3, w / 2, by + s1 * 1.3 + s2 * 2.7); }
    ctx.textAlign = 'left';
  }
  if (extra.crosshair) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2); ctx.fill(); }
  // X-ray labels
  for (const lb of extra.labels || []) {
    ctx.font = `600 ${Math.round(h * 0.02)}px "Avenir Next", system-ui, sans-serif`;
    const lw = ctx.measureText(lb.text).width + 16;
    ctx.fillStyle = 'rgba(20, 14, 8, 0.78)'; roundRect(ctx, lb.x - lw / 2, lb.y - 14, lw, 26, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(233, 185, 73, 0.6)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#fff4d8'; ctx.textAlign = 'center'; ctx.fillText(lb.text, lb.x, lb.y + 5); ctx.textAlign = 'left';
  }
  ctx.restore();
}
function measureTitle(ctx, t, size) { const f = ctx.font; ctx.font = `700 ${size}px "Avenir Next", system-ui, sans-serif`; const m = ctx.measureText(t || '').width; ctx.font = f; return m; }
function wrap(ctx, text, maxW) {
  const out = []; let line = '';
  for (const word of text.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
