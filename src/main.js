import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildTextures, buildMaterials, buildGeometries, MAT, GEO } from './assets.js';
import { buildWorld, buildStoreDisplay } from './world.js';
import { Pyramid } from './pyramid.js';
import { Crowd } from './workers.js';
import { Sim } from './sim.js';
import { FirstPerson } from './fps.js';
import * as PLAN from './plan.js';
import * as NAV from './nav.js';
import { B, N, HALF, LAYERS, cx, cz, edgeX, edgeZ, rockCells, blocks, getRock, getBlock, STAIR_PIECES } from './plan.js';
import { v3 } from './core.js';
import { Tour, TOUR_LENGTH, SHOTS, drawOverlay } from './tour.js';

buildTextures(); buildMaterials(); buildGeometries();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 2000);
camera.position.set(-14.7, 32, -41.1);
scene.add(camera);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(10.6, -2.4, 4.1);
orbit.enableDamping = true; orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = 1.5; orbit.minDistance = 4; orbit.maxDistance = 260;
// The app reopens at the last orbit view you left it at (kept in this browser only).
const VIEW_KEY = 'pyramid-builders-view';
try {
  const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
  if (v && v.p && v.t) { camera.position.fromArray(v.p); orbit.target.fromArray(v.t); }
} catch (e) { /* storage unavailable: use the built-in view */ }
let viewSave = 0;
orbit.addEventListener('change', () => {
  // wait for the damped motion to settle before saving
  clearTimeout(viewSave);
  viewSave = setTimeout(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ p: camera.position.toArray(), t: orbit.target.toArray() })); } catch (e) { /* ignore */ }
  }, 500);
});

const world = buildWorld(scene);
const storeDisplay = buildStoreDisplay(scene);
const pyramid = new Pyramid(scene);
const crowd = new Crowd(scene, 190);
const sim = new Sim({ scene, pyramid, crowd });
sim.extraSolids = [{ x: cx(6) + 0.2, z: cz(11), hx: 0.5, hz: 1.08, y0: 2 * B, y1: 2 * B + 1.13, sarc: true }];
const fps = new FirstPerson(camera, renderer.domElement, sim);
window.__sim = sim; window.__fps = fps; window.__plan = PLAN; window.__nav = NAV; window.__THREE = THREE;
window.__cam = (x, y, z, tx, ty, tz) => { camera.position.set(x, y, z); orbit.target.set(tx, ty, tz); orbit.update(); };
window.__setXray = (on) => setXray(on); window.__setFps = (on, p, yaw) => setFps(on, p, yaw);

// ---- x-ray overlays: outlines and labels of the interior spaces ------------------
const overlay = new THREE.Group(); overlay.visible = false; scene.add(overlay);
const lineMat = new THREE.LineBasicMaterial({ color: 0xffc85a, transparent: true, opacity: 0.85, depthTest: false });
const lineMatDim = new THREE.LineBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.75, depthTest: false });
function boxLines(x0, x1, y0, y1, z0, z1, mat) {
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
  const l = new THREE.LineSegments(g, mat); l.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); l.renderOrder = 10;
  overlay.add(l);
}
boxLines(edgeX(8), edgeX(9), 0, 2 * B, edgeZ(0), edgeZ(3), lineMat);
boxLines(edgeX(7), edgeX(10), 0, 2 * B, edgeZ(3), edgeZ(6), lineMat);
boxLines(edgeX(6), edgeX(11), 2 * B, 4 * B, edgeZ(10), edgeZ(13), lineMat);
boxLines(edgeX(6), edgeX(11), -3 * B, -B, edgeZ(7), edgeZ(12), lineMatDim);
{ // sloped passages drawn as parallelogram outlines
  const pts = [];
  const quad = (a, b, h) => { const A = a, Bp = b, C = b.clone().setY(b.y + h), D = a.clone().setY(a.y + h); pts.push(A, Bp, Bp, C, C, D, D, A); };
  quad(v3(cx(8), 0, edgeZ(6)), v3(cx(8), 2 * B, edgeZ(10)), 2.3);
  quad(v3(edgeX(7), 0, cz(4)), v3(edgeX(3), -3 * B, cz(4)), 2.4);
  quad(v3(cx(2), -3 * B, edgeZ(4)), v3(cx(2), -3 * B, cz(9)), 2.5);
  quad(v3(cx(2), -3 * B, cz(9)), v3(edgeX(6), -3 * B, cz(9)), 2.5);
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.LineSegments(g, lineMatDim); l.renderOrder = 10; overlay.add(l);
}
const labels = {};
const labelList = [];
function label(key, text, pos) {
  labelList.push({ text: text.replace(/<small>.*<\/small>/, ''), pos });
  const el = document.createElement('div'); el.className = 'label'; el.innerHTML = text;
  const o = new CSS2DObject(el); o.position.copy(pos); overlay.add(o); labels[key] = el;
}
label('entrance', 'Entrance', v3(cx(8), 2.9, edgeZ(0)));
label('ante', 'Antechamber', v3(cx(8), 2.7, cz(4)));
label('upper', 'Granite burial chamber<small></small>', v3(cx(8), 5.4, cz(11)));
label('stairUp', 'Ascending stair', v3(cx(8) + 1.6, 3.6, edgeZ(8) + 0.6));
label('desc', 'Rock-cut stair<small></small>', v3(cx(4), -0.4, cz(4)));
label('lower', 'Subterranean chamber<small></small>', v3(cx(8), -0.9, cz(9)));

// ---- HUD ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const SPEEDS = [1, 4, 16, 32, 64, 128, 256, 512, 1024];
const params = new URLSearchParams(location.search);
let speedIdx = Math.max(0, SPEEDS.indexOf(Number(params.get('speed') || 16)));
let paused = false;
let xray = false;
function setSpeed(i) { speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i)); $('speed').textContent = `${SPEEDS[speedIdx]}×`; }
setSpeed(speedIdx);
$('speed').onclick = (e) => setSpeed(e.shiftKey ? speedIdx - 1 : (speedIdx + 1) % SPEEDS.length);
$('speed').oncontextmenu = (e) => { e.preventDefault(); setSpeed(speedIdx - 1); };
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? '▶' : '❚❚'; $('pause').classList.toggle('on', paused); };
$('reset').onclick = () => { const q = new URLSearchParams(); q.set('speed', SPEEDS[speedIdx]); location.search = q.toString(); };
function setXray(on) {
  xray = on; pyramid.setXray(on); overlay.visible = on;
  world.terrain.material.transparent = on; world.terrain.material.opacity = on ? 0.38 : 1; world.terrain.material.depthWrite = !on; world.terrain.material.needsUpdate = true;
  pyramid.sand.material.transparent = on; pyramid.sand.material.opacity = on ? 0.3 : 1; pyramid.sand.material.needsUpdate = true;
  orbit.maxPolarAngle = on ? 2.4 : 1.5;
  $('xray').classList.toggle('on', on);
}
$('xray').onclick = () => setXray(!xray);
function setFps(on, start, yaw) {
  if (on) {
    if (!fps.enabled) fps.enter(start || v3(cx(8), 0, -HALF - 9), yaw ?? Math.PI);
    else if (start) fps.teleport(start, yaw);
    orbit.enabled = false;
    lockPointer();
  } else {
    fps.exit(); orbit.enabled = true;
    camera.position.set(fps.pos.x + 18, fps.pos.y + 14, fps.pos.z - 14);
    orbit.target.set(fps.pos.x, Math.max(1, fps.pos.y + 1), fps.pos.z);
  }
  $('fps').classList.toggle('on', on);
  $('hint').style.display = on ? 'block' : 'none';
  $('cross').style.display = on ? 'block' : 'none';
}
$('fps').onclick = () => setFps(!fps.enabled);
function lockPointer() {
  // pointer lock is optional (embedded previews may refuse it); drag-to-look still works
  try { const p = renderer.domElement.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
}
renderer.domElement.addEventListener('click', () => { if (fps.enabled && document.pointerLockElement !== renderer.domElement) lockPointer(); });
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyX') setXray(!xray);
  if (e.code === 'KeyF') setFps(!fps.enabled);
  if (e.code === 'KeyE' && fps.enabled) useLookTarget();
  if (e.code === 'KeyP') $('pause').click();
  if (e.code === 'Equal' || e.code === 'NumpadAdd') setSpeed(speedIdx + 1);
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') setSpeed(speedIdx - 1);
});

const ROOMS = [
  { key: 'entrance', name: 'Entrance', pos: () => v3(cx(8), 0, -HALF - 3), yaw: Math.PI, ok: () => true },
  { key: 'ante', name: 'Antechamber', pos: () => v3(cx(8), 0, cz(3)), yaw: Math.PI, ok: () => true },
  { key: 'upper', name: 'Granite chamber', pos: () => v3(cx(8), 2 * B, cz(10) + 0.1), yaw: Math.PI, ok: () => STAIR_PIECES.every(([L, i, k]) => getBlock(L, i, k).placed) },
  { key: 'desc', name: 'Rock-cut stair', pos: () => v3(edgeX(7) + 0.4, 0, cz(4)), yaw: Math.PI / 2, ok: () => getRock(6, 4, 1).state === 'dug' },
  { key: 'lower', name: 'Subterranean chamber', pos: () => v3(cx(7), -3 * B, cz(9)), yaw: -Math.PI / 2, ok: () => getRock(7, 9, 3)?.state === 'dug' },
];
for (const r of ROOMS) {
  const b = document.createElement('button');
  b.innerHTML = `${r.name}<span></span>`;
  b.onclick = () => setFps(true, r.pos(), r.yaw);
  r.btn = b; $('rooms').appendChild(b);
}

const WARES = [
  ['limestone', 'Quarry stone', '#cdb68c', () => sim.quarry.pile.filter((p) => p.item && !p.item.claimed).length],
  ['tura', 'Tura casing', '#f1ead9', () => sim.harbour.yardCount('tura')],
  ['granite', 'Granite', '#a7645a', () => sim.harbour.yardCount('granite')],
  ['mortar', 'Gypsum mortar', '#e8dcc4', () => sim.stocks.get('mortar') + sim.stocks.get('landingMortar')],
  ['water', 'Water', '#6fb3c8', () => Math.round(sim.stocks.get('water'))],
  ['food', 'Bread & beer', '#c58b45', () => Math.round(sim.stocks.get('food'))],
  ['tools', 'Copper tools', '#c27a45', () => sim.stocks.get('tools')],
  ['timber', 'Cedar timber', '#8a5a32', () => sim.stocks.get('timber')],
];
$('wares').innerHTML = WARES.map(([k, n, c]) => `<span class="chip" id="w_${k}" title="${n}"><span class="dot" style="background:${c}"></span>${n} <b>0</b></span>`).join('');

function zoneProgress(zone) {
  const cells = rockCells.filter((c) => c.zone === zone);
  return cells.filter((c) => c.state === 'dug').length / cells.length;
}
function viewText() {
  const f = (v) => v.toArray().map((n) => n.toFixed(1)).join(', ');
  if (fps.enabled) return `you ${f(fps.pos)} · facing ${Math.round(((fps.yaw * 180 / Math.PI) % 360 + 360) % 360)}°`;
  return `cam ${f(camera.position)} → ${f(orbit.target)}`;
}
$('coords').addEventListener('click', () => {
  const el = $('coords'), text = viewText();
  const done = () => { el.textContent = 'copied'; setTimeout(() => { el.textContent = viewText(); }, 900); };
  try { navigator.clipboard.writeText(text).then(done, () => {}); } catch (e) { /* the text stays selectable */ }
});

function updateHud() {
  if ($('coords').textContent !== 'copied') $('coords').textContent = viewText();
  const p = sim.progress();
  const phaseText = {
    levelling: 'Levelling the bedrock',
    building: `Course ${sim.layer + 1} of ${LAYERS} · ${Math.round(p.blocks * 100)}% of ${sim.totalBlocks} blocks set`,
    dismantling: 'Dismantling the construction ramp',
    furnishing: 'Furnishing the burial chambers',
    complete: 'Complete — walk inside to explore',
  }[sim.phase];
  const days = Math.floor(sim.sched.time / 300);
  $('phase').textContent = `${phaseText}`;
  if (sim.phase === 'complete' && !sim.completedAt) sim.completedAt = sim.sched.time;
  syncTimeline();
  const ev = sim.events[sim.events.length - 1];
  const wait = sim.waitingFor && sim.phase === 'building' && !sim.rampReady === false ? ` · waiting for ${sim.waitingFor}` : '';
  $('event').textContent = (ev ? ev.msg : '') + wait + ` · day ${days + 1}`;
  for (const [k, , , f] of WARES) {
    const el = $(`w_${k}`); const v = f();
    el.querySelector('b').textContent = v;
    el.classList.toggle('low', sim.waitingFor === k || (k === 'mortar' && sim.waitingFor === 'mortar') || (k === 'tools' && v <= 0) || (k === 'food' && v <= 0));
  }
  const granite = blocks.filter((b) => b.material === 'granite');
  labels.upper.querySelector('small').textContent = `${granite.filter((b) => b.placed).length}/${granite.length} granite`;
  labels.desc.querySelector('small').textContent = `${Math.round(zoneProgress('stair') * 100)}% cut`;
  labels.lower.querySelector('small').textContent = `${Math.round(zoneProgress('chamber') * 100)}% cut`;
  for (const r of ROOMS) {
    r.btn.disabled = !r.ok();
    const s = r.btn.querySelector('span');
    s.textContent = r.key === 'upper' ? `${granite.filter((b) => b.placed).length}/${granite.length}` : r.key === 'lower' ? `${Math.round(zoneProgress('chamber') * 100)}%` : r.key === 'desc' ? `${Math.round(zoneProgress('stair') * 100)}%` : '';
  }
  const inside = fps.enabled && Math.abs(fps.pos.x) < HALF + 1 && Math.abs(fps.pos.z) < HALF + 1;
  $('map').classList.toggle('show', xray || inside);
  $('mapLevel').textContent = fps.enabled ? (fps.pos.y < -0.5 ? 'below ground' : fps.pos.y > 1.5 ? 'upper level' : 'ground level') : '';
  drawMap();
}

// plan view of the interior
const mapCtx = $('mapCanvas').getContext('2d');
function drawMap() {
  const g = mapCtx, S = 440, m = 16, cs = (S - 2 * m) / N;
  const X = (x) => m + ((x + HALF) / (2 * HALF)) * (S - 2 * m), Z = (z) => m + ((z + HALF) / (2 * HALF)) * (S - 2 * m);
  g.clearRect(0, 0, S, S);
  for (let L = 0; L < LAYERS; L += 2) { g.strokeStyle = `rgba(233,185,73,${0.12 + L * 0.03})`; g.lineWidth = 2; g.strokeRect(m + L * cs, m + L * cs, (N - 2 * L) * cs, (N - 2 * L) * cs); }
  const rect = (i0, i1, k0, k1, fill, stroke) => { g.fillStyle = fill; g.fillRect(m + i0 * cs, m + k0 * cs, (i1 - i0 + 1) * cs, (k1 - k0 + 1) * cs); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.strokeRect(m + i0 * cs, m + k0 * cs, (i1 - i0 + 1) * cs, (k1 - k0 + 1) * cs); } };
  // underground cells
  const t = performance.now() / 300;
  for (const c of rockCells) {
    if (c.d !== 2 && !(c.zone === 'stair' && c.d === 1)) continue;
    const col = c.state === 'dug' ? 'rgba(143,211,255,0.55)' : c.state === 'digging' ? `rgba(255,170,80,${0.5 + 0.3 * Math.sin(t)})` : 'rgba(143,211,255,0.12)';
    rect(c.i, c.i, c.k, c.k, col);
  }
  // rooms in the masonry
  const gold = 'rgba(233,185,73,0.55)';
  rect(8, 8, 0, 2, gold); rect(7, 9, 3, 5, gold); rect(8, 8, 6, 9, 'rgba(233,185,73,0.4)'); rect(6, 10, 10, 12, gold, 'rgba(167,100,90,0.9)');
  g.fillStyle = 'rgba(167,100,90,0.95)'; g.fillRect(X(cx(6) + 0.2 - 0.5), Z(cz(11) - 1.07), 1 / (2 * HALF) * (S - 2 * m), 2.14 / (2 * HALF) * (S - 2 * m));
  g.font = '600 15px system-ui'; g.fillStyle = '#fff4d8'; g.textAlign = 'center';
  g.fillText('N', S / 2, 13);
  // you are here
  let px, pz, yaw;
  if (fps.enabled) { px = fps.pos.x; pz = fps.pos.z; yaw = fps.yaw; } else { px = orbit.target.x; pz = orbit.target.z; yaw = Math.atan2(camera.position.x - orbit.target.x, camera.position.z - orbit.target.z); }
  if (Math.abs(px) < HALF + 2 && Math.abs(pz) < HALF + 2) {
    g.save(); g.translate(X(px), Z(pz)); g.rotate(-yaw);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 34, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

// ---- rendering of ropes, levers and small props --------------------------------------
const jarM = new THREE.Matrix4();
function syncProps() {
  storeDisplay.update(sim.stocks);
  // ropes: each file of haulers shares one rope running back to the sled hitch
  const bySled = new Map();
  for (const b of sim.ropeBindings) {
    if (b.point) { crowd.segment('rope', b.w.handL.clone().lerp(b.w.handR, 0.5), b.point()); continue; }
    if (!bySled.has(b.sled)) bySled.set(b.sled, []);
    bySled.get(b.sled).push(b.w);
  }
  for (const [sled, ws] of bySled) {
    const hitch = sled.hitch();
    const files = [[], []];
    ws.forEach((w, j) => files[j % 2].push(w));
    for (const f of files) {
      let prev = hitch;
      for (const w of f) { const h = w.handL.clone().lerp(w.handR, 0.5); crowd.segment('rope', prev, h); prev = h; }
    }
  }
  for (const b of sim.leverBindings) {
    const h = b.w.handL.clone().lerp(b.w.handR, 0.5);
    const e = b.end();
    const top = h.clone().add(h.clone().sub(e).normalize().multiplyScalar(0.35));
    crowd.segment('pole', e, top);
  }
  // mortar jars waiting at the landing
  const n = Math.min(8, Math.max(0, Math.floor(sim.stocks.get('landingMortar'))));
  const { xTop } = sim.ramp();
  for (let j = 0; j < n; j++) { jarM.makeTranslation((j % 2 && !sim.westRetired ? -1 : 1) * (xTop + 3.2 + (Math.floor(j / 2) % 2) * 0.42), sim.rampH, (Math.floor(j / 4) - 0.5) * 0.36); sim.landingJars.setMatrixAt(j, jarM); }
  sim.landingJars.count = sim.phase === 'building' ? n : 0; sim.landingJars.instanceMatrix.needsUpdate = true;
}

// ---- looking at things in first person ---------------------------------------
// Whatever the crosshair rests on within reach is named under it; chests open with E.
const BLOCK_INFO = {
  core: { name: 'Limestone core block', detail: 'Cut in the quarry just south of the site and hauled up on a sled' },
  granite: { name: 'Granite lining', detail: 'Shipped about 800 km down the Nile from Aswan' },
  casing: { name: 'Tura limestone casing', detail: 'Fine white stone from across the river, dressed to the slope at the yard' },
  corner: { name: 'Tura limestone corner stone', detail: 'Dressed with two slopes where the faces meet' },
  cap: { name: 'Gilded capstone', detail: 'The last stone, set from the east ramp' },
};
const raycaster = new THREE.Raycaster(); raycaster.far = 4;
let lookTarget = null, lookFrame = 0;
function describe(hit) {
  for (let o = hit.object; o; o = o.parent) if (o.userData.inspect) return { info: o.userData.inspect, obj: o };
  for (const [kind, im] of Object.entries(pyramid.kinds)) if (hit.object === im) return { info: BLOCK_INFO[kind] };
  if (hit.object === pyramid.rockMesh || [...pyramid.descStairs.values()].includes(hit.object)) return { info: { name: 'Bedrock', detail: 'Cut by hand with copper chisels and stone pounders' } };
  if (hit.object === pyramid.decks) return { info: { name: 'Cedar beams', detail: 'Timber centering laid to carry the roof stones over this space' } };
  if ([...pyramid.stairMeshes.values()].includes(hit.object)) return { info: { name: 'Stair block', detail: 'Steps cut into the stone before it was set' } };
  return null;
}
function updateLook() {
  if (!fps.enabled) { lookTarget = null; $('inspect').style.display = 'none'; return; }
  if (lookFrame++ % 3) return;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const targets = [...sim.goodsGroup.children, ...Object.values(pyramid.kinds), pyramid.rockMesh, pyramid.decks, ...pyramid.stairMeshes.values(), ...pyramid.descStairs.values()];
  if (sim.sarcophagusMesh) targets.push(sim.sarcophagusMesh);
  const hit = raycaster.intersectObjects(targets, true)[0];
  const d = hit && describe(hit);
  lookTarget = d || null;
  $('inspect').style.display = d ? 'block' : 'none';
  if (!d) return;
  $('inspectName').textContent = d.info.name;
  $('inspectDetail').textContent = d.info.detail;
  const lid = d.obj && d.obj.userData.lid;
  $('inspectAction').textContent = lid ? (d.obj.userData.opened ? 'E to close' : 'E to open') : '';
}
function useLookTarget() {
  const o = lookTarget && lookTarget.obj;
  if (o && o.userData.lid) { o.userData.opened = !o.userData.opened; lookFrame = 0; updateLook(); }
}
function animateLids(dt) {
  for (const g of sim.goodsGroup.children) {
    const lid = g.userData.lid; if (!lid) continue;
    const goal = g.userData.opened ? -1.9 : 0;
    lid.rotation.x += (goal - lid.rotation.x) * Math.min(1, dt * 6);
  }
}

// ---- loop -------------------------------------------------------------------
const clock = new THREE.Clock();
let hudT = 0, simDtAcc = 0;
// ---- timeline: drag to jump forward or back -----------------------------------
// Forward jumps fast-forward the running simulation. Going back restarts it and
// fast-forwards from the beginning to the chosen moment.
const DAY = 300; // simulated seconds per "day" on the HUD
const TICK = 1 / 30; // the one simulation step size, for play and for jumps
let tickDebt = 0;
const scrub = $('scrub');
let dragging = false, seek = null;
const endTime = () => sim.completedAt || Math.max(33000, sim.sched.time + 600);
function dayLabel(t) { return `day ${Math.floor(t / DAY) + 1}`; }
function syncTimeline() {
  scrub.max = Math.round(endTime());
  if (!dragging && !seek) scrub.value = Math.round(sim.sched.time);
  if (!dragging) $('scrubLabel').textContent = dayLabel(sim.sched.time);
}
function seekTo(target) {
  if (target < sim.sched.time - 1) {
    const q = new URLSearchParams();
    q.set('speed', SPEEDS[speedIdx]); q.set('ff', Math.round(target));
    if (xray) q.set('xray', '1');
    location.search = q.toString();
    return;
  }
  seek = { from: sim.sched.time, target };
}
scrub.addEventListener('input', () => { dragging = true; $('scrubLabel').textContent = dayLabel(Number(scrub.value)); });
scrub.addEventListener('change', () => { dragging = false; seekTo(Number(scrub.value)); });
$('toStart').onclick = () => $('reset').click();
$('toEnd').onclick = () => { seek = { from: sim.sched.time, target: Infinity }; };
// day steps land on the start of a day
$('nextDay').onclick = () => seekTo((Math.floor(sim.sched.time / DAY) + 1) * DAY);
$('prevDay').onclick = () => seekTo(Math.max(0, (Math.floor(sim.sched.time / DAY) - 1) * DAY));
function runSeek() {
  const t0 = performance.now();
  const done = () => sim.phase === 'complete' || sim.sched.time >= seek.target || sim.sched.time > 80000;
  while (!done() && performance.now() - t0 < 160) sim.tick(TICK);
  const goal = seek.target === Infinity ? endTime() : seek.target;
  const frac = Math.min(1, (sim.sched.time - seek.from) / Math.max(1, goal - seek.from));
  $('seeking').style.display = 'block';
  $('seekText').textContent = seek.target === Infinity ? `Skipping to the finished tomb · ${dayLabel(sim.sched.time)}` : `Fast-forwarding to ${dayLabel(goal)} · now ${dayLabel(sim.sched.time)}`;
  $('seekBar').style.width = `${Math.round(frac * 100)}%`;
  if (done()) { seek = null; $('seeking').style.display = 'none'; }
}
const ff = Number(params.get('ff') || 0);
if (ff > 0) seek = { from: 0, target: ff };
if (params.get('xray')) setXray(true);

// draw one frame of everything that moves (shared by normal play, the live tour and recording)
function drawWorld(simDt, real) {
  crowd.update(simDt);
  sim.harbour.animateDocked(simDt);
  crowd.render(Math.max(simDt, real * 0.5));
  syncProps(); // ropes and levers attach to the hands placed by render()
  crowd.flush();
  world.update(sim.sched.time);
  updateLook();
  animateLids(real);
  renderer.render(scene, camera);
}

// X-ray room labels: drawn only while X-ray is on, and the whole layer hidden otherwise so none are left behind
function drawLabels() {
  labelRenderer.domElement.style.display = overlay.visible ? '' : 'none';
  if (overlay.visible) labelRenderer.render(scene, camera);
}

function frame() {
  const real = Math.min(clock.getDelta(), 0.1);
  if (recording) { requestAnimationFrame(frame); return; } // the recorder drives frames itself
  let simDt = 0;
  if (tour) {
    tour.t += real * window.__tour.speed;
    const ov = tour.apply(tour.t, real);
    showCaption(ov);
    drawWorld(ov.simDt, real);
    drawLabels();
    hudT -= real; if (hudT <= 0) { hudT = 0.25; updateHud(); }
    if (tour.t > TOUR_LENGTH) endTour();
    requestAnimationFrame(frame);
    return;
  }
  if (seek) runSeek();
  else if (!paused) {
    // fixed-size ticks, so a replay from the start reproduces exactly what was watched
    tickDebt += real * SPEEDS[speedIdx];
    const t0 = performance.now();
    while (tickDebt >= TICK) {
      sim.tick(TICK); tickDebt -= TICK; simDt += TICK;
      if (performance.now() - t0 > 22) { tickDebt = Math.min(tickDebt, TICK); break; } // too slow: run behind rather than freeze
    }
  }
  if (fps.enabled) fps.update(real); else orbit.update();
  hudT -= real;
  if (hudT <= 0) { hudT = 0.25; updateHud(); }
  drawWorld(simDt, real);
  drawLabels();
  requestAnimationFrame(frame);
}

// ---- guided tour -----------------------------------------------------------------
let tour = null, recording = false;
const tourApp = {
  sim, camera, fps,
  setXray: (on) => { if (on !== xray) setXray(on); },
  setWalk: (on) => {
    if (on && !fps.enabled) { fps.enabled = true; camera.near = 0.05; camera.updateProjectionMatrix(); orbit.enabled = false; }
    if (!on && fps.enabled) { fps.exit(); orbit.enabled = true; }
    $('cross').style.display = on ? 'block' : 'none';
  },
  // open the nearest chest ahead of the camera (does not depend on the crosshair landing on it this frame)
  openChestInView: () => {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    let best = null, bestD = 5;
    for (const g of sim.goodsGroup.children) {
      if (!g.userData.lid) continue;
      const to = g.position.clone().sub(camera.position); const d = to.length();
      if (d < bestD && to.normalize().dot(dir) > 0.7) { best = g; bestD = d; }
    }
    if (best) best.userData.opened = true;
    lookFrame = 0; updateLook();
  },
};
// for tests (tests/e2e): the tour's progress, and `speed` to play it faster than real time
window.__tour = { speed: 1, get active() { return !!tour; }, get t() { return tour ? tour.t : null; }, get shot() { return tour ? tour.shot : null; }, length: TOUR_LENGTH, shots: SHOTS.length };
function startTour() {
  tour = new Tour(tourApp); tour.t = 0;
  document.body.classList.add('touring');
}
function endTour() {
  tour = null;
  document.body.classList.remove('touring');
  $('tourCaption').style.display = 'none';
  tourApp.setWalk(false);
  orbit.target.set(0, 3, 0);
}
function showCaption(ov) {
  const el = $('tourCaption');
  el.style.display = 'block';
  el.style.opacity = Math.max(0, Math.min(1, ov.fade));
  $('tourTitle').textContent = ov.title; $('tourSub').textContent = ov.sub;
}
$('tour').onclick = () => { const q = new URLSearchParams(); q.set('tour', '1'); location.search = q.toString(); };
$('tourEnd').onclick = () => endTour();
if (params.get('tour')) startTour();

// Render the tour frame by frame to the dev server (used to make the video).
window.__record = async ({ fpsOut = 30, width = 1280, height = 720, from = 0, to = TOUR_LENGTH, quality = 0.9 } = {}) => {
  recording = true;
  const state = window.__recState = { done: 0, total: Math.ceil((to - from) * fpsOut), error: null, finished: false };
  try {
    tour = new Tour(tourApp);
    renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    const out = document.createElement('canvas'); out.width = width; out.height = height;
    const ctx = out.getContext('2d');
    for (let i = 0; i < state.total; i++) {
      const t = from + i / fpsOut;
      const ov = tour.apply(t, 1 / fpsOut);
      drawWorld(ov.simDt, 1 / fpsOut);
      ctx.drawImage(renderer.domElement, 0, 0, width, height);
      const extra = { status: statusLine() };
      if (fps.enabled) { extra.crosshair = true; if (lookTarget) extra.look = { name: lookTarget.info.name, detail: lookTarget.info.detail, action: lookTarget.obj && lookTarget.obj.userData.lid ? (lookTarget.obj.userData.opened ? 'Lid open (E closes it)' : 'E to open') : '' }; }
      if (ov.labels) extra.labels = labelList.map((l) => { const p = l.pos.clone().project(camera); return { text: l.text, x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height, z: p.z }; }).filter((l) => l.z < 1);
      drawOverlay(ctx, width, height, ov, extra);
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', quality));
      await fetch(`/__frame?i=${i}`, { method: 'POST', body: blob });
      state.done = i + 1;
    }
  } catch (e) { state.error = String(e && e.stack || e); }
  state.finished = true;
  return state;
};
// Render the whole build from the start at a fixed speed, with the camera circling the site
// once (used for the README GIF). No tour, no captions: only a small status pill.
window.__recordRun = async ({ speed = 512, fpsOut = 15, width = 960, height = 540, hold = 2, quality = 0.88, radius = 56, camH = 30, center = [6, 0, 6], lookY = 3, a0 = -2.2 } = {}) => {
  recording = true;
  const perFrame = Math.round(speed / fpsOut / TICK); // simulation ticks between output frames
  const est = Math.ceil(35100 / (perFrame * TICK)) + hold * fpsOut;
  const state = window.__recState = { done: 0, total: est, error: null, finished: false };
  try {
    renderer.setPixelRatio(1); renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    const out = document.createElement('canvas'); out.width = width; out.height = height;
    const ctx = out.getContext('2d');
    let i = 0, after = 0;
    while (after < hold * fpsOut) {
      for (let k = 0; k < perFrame && sim.phase !== 'complete'; k++) sim.tick(TICK);
      if (sim.phase === 'complete') after++;
      const a = a0 + (i / est) * Math.PI * 2; // one full turn over the clip
      camera.position.set(center[0] + Math.cos(a) * radius, camH, center[2] + Math.sin(a) * radius);
      camera.lookAt(center[0], lookY, center[2]);
      drawWorld(perFrame * TICK, 1 / fpsOut);
      ctx.drawImage(renderer.domElement, 0, 0, width, height);
      drawOverlay(ctx, width, height, { title: '', sub: '', fade: 0 }, { status: `${speed}× · ${statusLine()}` });
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', quality));
      await fetch(`/__frame?i=${i}`, { method: 'POST', body: blob });
      state.done = ++i;
    }
    state.total = i;
  } catch (e) { state.error = String(e && e.stack || e); }
  state.finished = true;
  return state;
};
// render the current state once and save it as recording/<name>.jpg (for checking views without the pane)
window.__snap = async (name = 'snap', real = 1 / 30) => {
  drawWorld(0, real);
  const blob = await new Promise((r) => renderer.domElement.toBlob(r, 'image/jpeg', 0.85));
  await fetch(`/__frame?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
  return name;
};
function statusLine() {
  if (sim.phase === 'complete') return 'Finished';
  const day = Math.floor(sim.sched.time / 300) + 1;
  if (sim.phase === 'levelling') return `Day ${day} · levelling the site`;
  if (sim.phase === 'building') return `Day ${day} · course ${sim.layer + 1} of ${LAYERS} · ${sim.placedCount} of ${sim.totalBlocks} stones set`;
  return `Day ${day} · ${sim.phase === 'dismantling' ? 'removing the ramps' : 'furnishing the tomb'}`;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
});
updateHud();
requestAnimationFrame(frame);
