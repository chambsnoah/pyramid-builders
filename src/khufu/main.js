// Khufu's pyramid (issue #1). Phase 1: the monument at full size, drawn as surfaces, with a
// walkable interior. Phase 3: the 20-year event model runs in a worker, and a timeline in
// years with milestones and a statistics panel drives the renderer course by course.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { HALF, HEIGHT, PAVEMENT, COURSES, COURSE_COUNT, ELEMENTS, SPOTS, groundHeight, floorY, ceilY } from './data.js';
import { buildTextures, TX } from './textures.js';
import { Monument } from './monument.js';
import { Rooms } from './rooms.js';
import { Collision } from './collision.js';
import { Walker } from './walker.js';
import { WorkingCourse } from './working.js';
import { Bubble } from './bubble.js';
import { SLED, FIG } from './sim/gangs.js';
import { SpecialWorks } from './works.js';
import { TUNNEL } from './sim/works.js';
import { SimClient, Timeline, clockText } from './timeline.js';
import { THEORY_IDS } from './sim/ramps/index.js';
import { StatsPanel } from './statsPanel.js';
import { KhufuTour } from './tour.js';
import { DAY, YEAR } from './sim/params.js';

buildTextures();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.82;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
document.body.prepend(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' });
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 12000);
camera.position.set(310, 150, -380);
scene.add(camera);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 42, 0);
// drags settle a little sooner than three.js's default; the mouse wheel is handled below
// (wheelZoom), toward the point under the mouse
orbit.enableDamping = true; orbit.dampingFactor = 0.14;
orbit.maxPolarAngle = 1.52; orbit.minDistance = 3; orbit.maxDistance = 5000;

// ---- sky, light and the plateau ---------------------------------------------------
{
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: new THREE.Vector3(0.55, 0.62, 0.35).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sunDir; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.2, 1.0);
        vec3 horizon = vec3(0.93, 0.84, 0.70), zenith = vec3(0.32, 0.55, 0.85);
        vec3 c = mix(horizon, zenith, pow(max(h,0.0), 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0,0.85,0.6) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  sky.onBeforeRender = (r, s, cam) => sky.position.copy(cam.position);
  scene.add(sky);
}
scene.fog = new THREE.Fog(0xe8d8bc, 900, 9000);
const hemi = new THREE.HemisphereLight(0xdce6f5, 0xd9b27a, 1.05); // sand-coloured bounce keeps the shaded north face warm
const HEMI = hemi.intensity;
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b8, 3.0);
sun.position.set(0.55, 0.62, 0.35).multiplyScalar(700);
sun.target.position.set(0, 30, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200, near: 300, far: 1300 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.12;
scene.add(sun, sun.target);

const ground = (() => {
  // a grid over 12 km with a hole for the pyramid and its pavement
  const E = HALF + PAVEMENT;
  const axis = [];
  for (let v = -6000; v <= 6000; v += Math.abs(v) < 500 ? 25 : Math.abs(v) < 1500 ? 100 : 300) axis.push(v);
  axis.push(-E, E);
  const ax = [...new Set(axis)].sort((a, b) => a - b), n = ax.length;
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const x = ax[b], z = ax[a], o = a * n + b;
    pos.set([x, groundHeight(x, z), z], o * 3); uv.set([x / 9, z / 9], o * 2);
  }
  const idx = [];
  for (let a = 0; a < n - 1; a++) for (let b = 0; b < n - 1; b++) {
    if (Math.abs((ax[b] + ax[b + 1]) / 2) < E && Math.abs((ax[a] + ax[a + 1]) / 2) < E) continue;
    const i0 = a * n + b, i1 = i0 + 1, i2 = i0 + n, i3 = i2 + 1;
    idx.push(i0, i2, i1, i1, i2, i3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TX.sand, roughness: 1 }));
  m.receiveShadow = true; m.name = 'ground';
  scene.add(m);
  // limestone pavement round the base
  const pv = [], pu = [];
  const ring = [[-E, -E], [E, -E], [E, E], [-E, E]], inner = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    for (const [x, z] of [ring[i], inner[i], inner[j], ring[i], inner[j], ring[j]]) { pv.push(x, 0, z); pu.push(x / 3.2, z / 3.2); }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pv, 3));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2));
  pg.computeVertexNormals();
  const pave = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: TX.pave.map, normalMap: TX.pave.normalMap, roughness: 0.8, side: THREE.DoubleSide }));
  pave.receiveShadow = true; pave.name = 'pavement';
  scene.add(pave);
  return [m, pave];
})();

// ---- the monument ----------------------------------------------------------------
const monument = new Monument(scene);
const rooms = new Rooms(scene);
const collision = new Collision(rooms.solidBoxes);
const walker = new Walker(camera, renderer.domElement, collision);
const working = new WorkingCourse(scene);
const bubble = new Bubble(scene);
const works = new SpecialWorks(scene);

// room labels for X-ray
const overlay = new THREE.Group(); overlay.visible = false; scene.add(overlay);
for (const el of ELEMENTS) {
  if (!el.label) continue;
  const d = document.createElement('div'); d.className = 'label'; d.textContent = el.name;
  const o = new CSS2DObject(d); o.position.set(...el.label); overlay.add(o);
}
{
  const d = document.createElement('div'); d.className = 'label'; d.textContent = 'Entrance';
  const o = new CSS2DObject(d); o.position.set(SPOTS[1].pos[0], SPOTS[1].pos[1] + 3, SPOTS[1].pos[2] - 2); overlay.add(o);
}

// ---- HUD -------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let xray = false;
function setXray(on) {
  xray = on;
  monument.setXray(on); rooms.setXray(on); working.setXray(on); overlay.visible = on;
  for (const g of ground) { g.material.transparent = on; g.material.opacity = on ? 0.35 : 1; g.material.depthWrite = !on; g.material.needsUpdate = true; }
  orbit.maxPolarAngle = on ? 2.6 : 1.52;
  $('xray').classList.toggle('on', on);
}
$('xray').onclick = () => setXray(!xray);

function lockPointer() {
  try { const p = renderer.domElement.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* optional */ }
}
const spotVec = (s) => new THREE.Vector3(...s.pos);
function setWalk(on, spot) {
  if (on) {
    if (follow >= 0) setFollow(false);
    const s = spot || SPOTS[0];
    if (!walker.enabled) walker.enter(spotVec(s), s.yaw); else walker.teleport(spotVec(s), s.yaw);
    orbit.enabled = false;
    if (!params.has('nolock')) lockPointer();
  } else if (walker.enabled) {
    const p = walker.pos.clone(), inside = walker.indoor > 0.5;
    walker.exit(); orbit.enabled = true;
    camera.near = 0.5; camera.far = 12000; camera.updateProjectionMatrix();
    const out = new THREE.Vector3(Math.sin(walker.yaw), 0, Math.cos(walker.yaw));
    camera.position.copy(p).addScaledVector(out, inside ? 60 : 25).add(new THREE.Vector3(0, inside ? 35 : 12, 0));
    orbit.target.copy(p);
    if (inside && !xray) setXray(true);
  }
  $('walk').classList.toggle('on', on);
  $('zoomIn').disabled = $('zoomOut').disabled = on; // the walker has the camera
  $('hint').style.display = on ? 'block' : 'none';
  $('cross').style.display = on ? 'block' : 'none';
  if (!on) $('climb').style.display = 'none';
}
$('walk').onclick = () => setWalk(!walker.enabled);

// follow a gang: the camera keeps its offset from the sled of the working gang nearest the
// middle of the view
let follow = -1;
const followAt = new THREE.Vector3(), followNow = new THREE.Vector3();
// (only from the orbit view: walking cancels it, so leaving the walk never jumps the camera)
function setFollow(on) {
  follow = on && !walker.enabled ? bubble.nearestGang(orbit.target) : -1;
  if (follow >= 0) bubble.sledAt(follow, followAt);
  $('follow').classList.toggle('on', follow >= 0);
}
$('follow').onclick = () => setFollow(follow < 0);

// Zoom buttons: the camera moves along its line to what it looks at, by ZOOM a press, eased
// over ZOOM_MS in the frame loop (presses during a move add to where it is going).
// Double-click: the view glides over to centre on the point clicked, closing in on it if it
// is far. Only the target and the distance change, never the angle of view, so Follow keeps
// working; while walking the walker has the camera.
const ZOOM = 0.6, ZOOM_MS = 250, FLY_MS = 450;
let zoomTo = null; // { from, to, t0, ms, a?, b? }: distances from orbit.target; a → b: the target moving
function zoom(k) {
  if (walker.enabled) return;
  const now = camera.position.distanceTo(orbit.target);
  const to = THREE.MathUtils.clamp((zoomTo ? zoomTo.to : now) * k, orbit.minDistance, orbit.maxDistance);
  // (pressed during a double-click glide, the glide still ends on the point clicked: stopping
  // it would leave the pivot partway, on nothing in particular)
  zoomTo = { from: now, to, t0: performance.now(), ms: ZOOM_MS, a: zoomTo?.b ? orbit.target.clone() : null, b: zoomTo?.b || null };
}
function centreOn(p) {
  if (walker.enabled) return;
  const now = camera.position.distanceTo(orbit.target);
  zoomTo = { from: now, to: THREE.MathUtils.clamp(Math.min(now, 160), orbit.minDistance, orbit.maxDistance), t0: performance.now(), ms: FLY_MS, a: orbit.target.clone(), b: p.clone() };
}
function zoomStep() {
  if (!zoomTo || walker.enabled) { zoomTo = null; return; }
  const z = zoomTo, a = Math.min(1, (performance.now() - z.t0) / z.ms), e = a * a * (3 - 2 * a);
  const off = camera.position.clone().sub(orbit.target);
  if (off.lengthSq() < 1e-12) { zoomTo = null; return; }
  if (z.b) orbit.target.lerpVectors(z.a, z.b, e);
  off.setLength(z.from + (z.to - z.from) * e);
  camera.position.copy(orbit.target).add(off);
  if (a >= 1) zoomTo = null;
}
// Mouse wheel: zoom about the point under the mouse. The camera and the pivot both move
// toward (or away from) that point by the same factor, so the point stays under the mouse,
// the angle of view is kept, and repeated zooms bring the pivot onto what is looked at.
// The point is found on the pyramid as built (its four faces and its flat top, a solid
// worked out directly, so a trackpad's stream of wheel events costs nothing) or else on the
// ground. three.js's own zoomToCursor guesses it on a plane through the pivot instead, which
// can leave the pivot buried in the masonry.
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
const WHEEL = 0.0018; // zoom factor per pixel of wheel travel: exp(WHEEL × deltaY)
function pickSolid(o, d) {
  // the pyramid up to its built height: x ± (HALF/HEIGHT)·y ≤ HALF (and z), 0 ≤ y ≤ top
  const top = monument.topY(), s = HALF / HEIGHT;
  let t0 = 0, t1 = Infinity;
  const planes = [[1, s, 0, HALF], [-1, s, 0, HALF], [0, s, 1, HALF], [0, s, -1, HALF], [0, 1, 0, top], [0, -1, 0, 0]];
  for (const [a, b, c, k] of planes) {
    const num = k - (a * o.x + b * o.y + c * o.z), den = a * d.x + b * d.y + c * d.z;
    if (Math.abs(den) < 1e-12) { if (num < 0) { t0 = Infinity; break; } continue; }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  if (top > 0 && t0 < t1 && t0 > 0) return o.clone().addScaledVector(d, t0);
  if (d.y < -1e-6 && o.y > 0) return o.clone().addScaledVector(d, -o.y / d.y); // the plateau
  return null;
}
window.addEventListener('wheel', (e) => {
  if (e.target !== renderer.domElement || walker.enabled || tour.active) return;
  e.preventDefault(); e.stopPropagation(); // (OrbitControls keeps pinch zoom on touch screens)
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const dist = camera.position.distanceTo(orbit.target);
  const k = THREE.MathUtils.clamp(Math.exp(WHEEL * THREE.MathUtils.clamp(dy, -200, 200)), orbit.minDistance / dist, orbit.maxDistance / dist);
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  let H = pickSolid(ray.ray.origin, ray.ray.direction);
  // the ramps (a few hundred triangles) when they are nearer than the pyramid or the ground
  const rh = bubble.rampMesh && bubble.rampMesh.visible ? ray.intersectObject(bubble.rampMesh, false)[0] : null;
  if (rh && (!H || rh.distance < H.distanceTo(ray.ray.origin))) H = rh.point;
  if (!H) H = orbit.target.clone();
  zoomTo = null;
  camera.position.sub(H).multiplyScalar(k).add(H);
  orbit.target.sub(H).multiplyScalar(k).add(H);
}, { passive: false, capture: true });
// what the mouse is over: the masonry, the ramps or the ground (on a double-click)
renderer.domElement.addEventListener('dblclick', (e) => {
  if (walker.enabled || tour.active) return;
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const targets = [monument.group, ...ground, ...(bubble.rampMesh ? [bubble.rampMesh] : [])];
  const hit = ray.intersectObjects(targets, true).find((h) => h.object.visible);
  if (hit) { if (follow >= 0) setFollow(false); centreOn(hit.point); }
});
$('zoomIn').onclick = () => zoom(ZOOM);
$('zoomOut').onclick = () => zoom(1 / ZOOM);
renderer.domElement.addEventListener('click', () => { if (walker.enabled && document.pointerLockElement !== renderer.domElement && !params.has('nolock')) lockPointer(); });
SPOTS.forEach((s, i) => {
  const b = document.createElement('button');
  b.innerHTML = `${s.name}<span>${i + 1}</span>`;
  b.onclick = () => setWalk(true, s);
  $('rooms').appendChild(b);
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  // during the tour the keys only end it (Esc or T)
  if (tour.active) { if (e.code === 'Escape' || e.code === 'KeyT') { endTour(); e.preventDefault(); } return; }
  if (e.code === 'KeyT' && timeline.ready) { startTour(); return; }
  if (!walker.enabled && timeline.ready) {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { timeline.stepDays((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 25 : 1)); e.preventDefault(); }
    if (e.code === 'KeyP' || (e.code === 'Space' && e.target.tagName !== 'BUTTON')) { timeline.setPlaying(!timeline.playing); e.preventDefault(); }
  }
  if (e.code === 'KeyX') setXray(!xray);
  if (e.code === 'KeyF') setWalk(!walker.enabled);
  if (e.code === 'KeyG' && !walker.enabled) setFollow(follow < 0);
  // (with Ctrl or Cmd these are the browser's own page zoom)
  const plain = !e.ctrlKey && !e.metaKey;
  if (plain && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) { zoom(ZOOM); e.preventDefault(); }
  if (plain && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) { zoom(1 / ZOOM); e.preventDefault(); }
  const d = /^Digit(\d)$/.exec(e.code);
  if (d && SPOTS[+d[1] - 1]) setWalk(true, SPOTS[+d[1] - 1]);
});

// build height: finished courses as surfaces (and the capstone once it is set)
const slider = $('courses');
slider.max = COURSE_COUNT; slider.value = COURSE_COUNT;
let shownCourses = null; // what setCourses last applied ("built:capstone"), so repeats are skipped
// the rooms are cut at the top of the finished courses (revealTop), each room in the course
// being laid at the height its lining has reached there, and the tunnel at its face
let revealTop = null, tunnelNow = null;
function applyReveal() { rooms.setReveal(revealTop, working.rooms, tunnelNow); }
function setCourses(n, capstone = true) {
  const top = monument.setBuiltCourses(n, capstone);
  const shown = `${monument.built}:${monument.capstone}`;
  if (shown === shownCourses) return; // the timeline calls this every frame while playing
  shownCourses = shown;
  collision.topY = top;
  revealTop = !monument.complete ? top + 0.001 : null;
  applyReveal();
  // new masonry may have risen through the walker (standing on a lower cap): lift it to the
  // nearest floor with room above, or leave walking if there is none
  if (walker.enabled && !walker.passable(walker.pos.x, walker.pos.z, walker.pos.y)) {
    const pitch = walker.pitch;
    walker.teleport(walker.pos.clone(), walker.yaw);
    walker.pitch = pitch;
    if (!walker.passable(walker.pos.x, walker.pos.z, walker.pos.y)) setWalk(false);
  }
  $('courseLabel').textContent = monument.complete ? `all ${COURSE_COUNT}` : `${monument.built} · ${top.toFixed(1)} m`;
  if (!slider.matches(':active')) slider.value = monument.built;
}
// Before the model has run the slider cuts the static monument; after, it jumps the timeline
// to the moment that course was finished.
slider.addEventListener('input', () => {
  const n = +slider.value;
  if (!timeline.ready) { setCourses(n); return; }
  const S = client.summary;
  timeline.seek(n >= COURSE_COUNT ? S.endT : S.courseDone[n - 1]);
});
setCourses(+(params.get('courses') || COURSE_COUNT));
slider.value = monument.built;

// ---- the event model, the timeline and the statistics ------------------------------
let view = null;
const stats = new StatsPanel($('simstats'));
const timeline = new Timeline($('timeline'), { onSeek: (t) => client.seek(t) });
const client = new SimClient({
  onProgress: (m) => timeline.setProgress(`Running the 20-year build in a worker… year ${Math.floor(m.t / YEAR) + 1}`),
  onReady: (summary, timing) => {
    console.info(`[khufu] model ran in the worker in ${(timing.ms / 1000).toFixed(2)} s: ${summary.blocks} blocks, ${(summary.endT / YEAR).toFixed(2)} years, hash ${summary.hash}`);
    window.__khufu.summary = summary; window.__khufu.runMs = timing.ms;
    stats.setRun(summary);
    bubble.reset();
    works.setSchedule(summary.works);
    const restarted = timeline.ready; // the worker was restarted after a crash: stay where we were
    timeline.setRun(summary);
    let t = summary.endT; // by default, the finished monument (as before the model has run)
    if (restarted) t = timeline.t;
    else if (params.has('day')) t = (+params.get('day') - 1) * DAY;
    else if (params.has('year')) t = (+params.get('year') - 1) * YEAR;
    else if (params.has('courses')) { const n = +params.get('courses'); t = n >= COURSE_COUNT ? summary.endT : summary.courseDone[Math.max(0, n - 1)]; }
    timeline.seek(t);
    if (params.has('play') && !restarted) timeline.setPlaying(true);
    $('tour').disabled = false;
    if (params.has('tour') && !restarted) startTour();
  },
  onState: (m, timing) => {
    if ('layout' in m) working.setLayout(m.layout);
    view = m.view;
    setCourses(Math.min(view.built, COURSE_COUNT), view.done);
    working.update(view.course);
    bubble.setCourse(working.layout, view.course); // (gangs walk on the stones as drawn)
    monument.setHoles(working.layout?.y0, view.course && working.layout?.ci === view.course.ci ? working.layout.trench : null); // (an internal ramp's trench)
    applyReveal();
    if (m.gangs) bubble.apply(m.gangs);
    bubble.setVisible(!view.done);
    stats.update(view, m.t, timing);
  },
  onRestart: (n) => { endTour(); $('tour').disabled = true; timeline.setEnabled(false); timeline.setPlaying(false); timeline.setProgress(`The event model stopped; running it again (attempt ${n + 1})…`); },
  onError: (msg) => { console.error('[khufu] worker:', msg); timeline.setProgress('The event model failed to run (see the console)'); },
});
// ?ramp=spiral or ?ramp=internal runs another ramp theory (src/khufu/sim/ramps/)
const RAMP = params.get('ramp');
client.init(RAMP && THEORY_IDS.includes(RAMP) ? { ramp: { id: RAMP } } : {});

// ---- guided tour (src/khufu/tour.js) -------------------------------------------------
const tour = new KhufuTour({
  timeline, client, bubble, camera, orbit, theoryId: RAMP && THEORY_IDS.includes(RAMP) ? RAMP : 'straight-zigzag',
  setXray, isXray: () => xray, walker,
  // the walk inside: the walker driven by the tour (no pointer lock, no walking hints), and
  // back to the orbit view outside, as leaving a walk does
  enterWalk: (p, yaw) => { walker.enter(p, yaw); orbit.enabled = false; },
  leaveWalk: () => { walker.drive(null); setWalk(false); },
  onCaption: (title, sub) => {
    $('tourCaption').style.display = title ? 'block' : 'none';
    if (title) { $('tourTitle').textContent = title; $('tourSub').textContent = sub; }
  },
  onEnd: () => endTour(),
});
function startTour(opts) {
  if (walker.enabled) setWalk(false);
  if (follow >= 0) setFollow(false);
  zoomTo = null;
  if (!tour.start(opts)) return;
  orbit.enabled = false;
  document.body.classList.add('touring');
  $('tour').classList.add('on'); $('tour').textContent = 'End tour';
}
function endTour() {
  tour.stop();
  orbit.enabled = true;
  document.body.classList.remove('touring');
  $('tour').classList.remove('on'); $('tour').textContent = 'Tour';
}
$('tour').onclick = () => (tour.active ? endTour() : startTour());
$('tourEnd').onclick = () => endTour();
$('tour').disabled = true; // until the model has run

// which room the walker is in
function whereIs(p) {
  for (const el of ELEMENTS) for (const v of el.voids) {
    if (p.x >= v.x0 && p.x <= v.x1 && p.z >= v.z0 && p.z <= v.z1 && p.y >= floorY(v, p.z) - 0.6 && p.y <= ceilY(v, p.z)) return el;
  }
  return null;
}

// ---- frame loop and measurements --------------------------------------------------
const clock = new THREE.Clock();
const perf = { frames: 0, t: 0, fps: 0, ms: 0, worst: 0, tris: 0, calls: 0 };
// triangles held by the static meshes (what the GPU has to hold, not what one frame draws)
function sceneTriangles() {
  let t = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry, n = g.index ? g.index.count : g.attributes.position?.count ?? 0;
    t += n / 3;
  });
  return Math.round(t);
}
// Cost of one frame with the GPU forced to finish (a 1-pixel read after each render).
// Unlike requestAnimationFrame timing this still works when the page is in a background tab.
function syncBench(n = 60) {
  const gl = renderer.getContext(), px = new Uint8Array(4);
  const one = () => { renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  one();
  const ts = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); one(); ts.push(performance.now() - t); }
  ts.sort((a, b) => a - b);
  const mean = ts.reduce((a, b) => a + b, 0) / n;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    meanMs: +mean.toFixed(2), medianMs: +ts[n >> 1].toFixed(2), p95Ms: +ts[Math.floor(n * 0.95)].toFixed(2),
    tris: renderer.info.render.triangles, calls: renderer.info.render.calls, sceneTris: sceneTriangles(),
    canvas: [renderer.domElement.width, renderer.domElement.height], gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?',
  };
}
window.__khufu = {
  THREE, scene, camera, renderer, orbit, monument, rooms, collision, walker, working, bubble, works, perf,
  get timeline() { return timeline; }, get client() { return client; }, get state() { return view; },
  // time seeks through the worker: [{ day, worker ms, round trip ms, … }] for each day in turn
  benchSeek: async (days) => {
    const out = [];
    for (const d of days) {
      const t = Math.max(0, Math.min(client.summary.endT, d * DAY));
      timeline.t = t; timeline.render();
      const a = performance.now();
      const r = await client.seekAndWait(t);
      await new Promise((res) => { requestAnimationFrame(res); setTimeout(res, 100); }); // next frame (rAF stops in a hidden tab)
      out.push({ day: d, workerMs: +r.ms.toFixed(2), roundTripMs: +r.roundTrip.toFixed(1), toFrameMs: +(performance.now() - a).toFixed(1), built: r.view.built, blocks: r.view.blocksSet });
    }
    return out;
  },
  // Whole frames as the frame loop does them, with the GPU forced to finish: place the gangs
  // at a time `simDt` later each frame (re-uploading every instance), render, read a pixel.
  benchFrames: (n = 60, simDt = 1) => {
    const gl = renderer.getContext(), px = new Uint8Array(4), ts = [], up = [];
    const t0 = timeline.t;
    for (let i = 0; i <= n; i++) {
      const a = performance.now();
      bubble.update(t0 + i * simDt, camera, 1 / 60);
      const b = performance.now();
      renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (i) { ts.push(performance.now() - a); up.push(b - a); }
    }
    bubble.update(timeline.t, camera, 0);
    const st = (v) => { const s = [...v].sort((x, y) => x - y); return { mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2), median: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) }; };
    const f = st(ts);
    return { frameMs: f, fps: +(1000 / f.mean).toFixed(1), placeMs: st(up), tris: renderer.info.render.triangles, calls: renderer.info.render.calls, bubble: { ...bubble.info }, canvas: [renderer.domElement.width, renderer.domElement.height] };
  },
  // Plays the timeline through the worker (real replies, real latency) in steps of `step` s
  // of wall time at `speed` × working time, and reports the largest move of any sled or
  // person of the gangs in detail between two steps, in metres per second of working time.
  checkMotion: async ({ speed = 1, seconds = 20, step = 0.05 } = {}) => {
    const was = timeline.playing; timeline.setPlaying(false);
    const prev = new Map();
    let worst = { v: 0 }, jumps = 0, steps = 0, replies = 0;
    const before = client.id;
    for (let k = 0; k < seconds / step; k++) {
      timeline.seek(Math.min(timeline.end, timeline.t + step * speed));
      await new Promise((r) => setTimeout(r, step * 1000));
      const t = timeline.t;
      bubble.update(t, camera, step);
      steps++;
      for (const g of bubble.inside) {
        const o = bubble.bufs[g], p = prev.get(g);
        // (also at the same time: at the end of the timeline time stands still, and a trip
        // that arrives a step late must still put everyone where they were)
        if (p && p.t <= t && p.o.length === o.length) {
          const dt = t - p.t;
          for (let i = 0; i < o.length; i = i ? i + FIG : SLED) {
            const d = Math.hypot(o[i] - p.o[i], o[i + 1] - p.o[i + 1], o[i + 2] - p.o[i + 2]);
            const v = d / Math.max(dt, step * speed);
            if (v > worst.v) worst = { v: +v.toFixed(2), d: +d.toFixed(3), g, i, t: +(t / DAY).toFixed(4), act: bubble.acts[g] };
            if (d > Math.max(0.5, 3 * dt)) jumps++;
          }
        }
        prev.set(g, { t, o: Float32Array.from(o) });
      }
    }
    replies = client.id - before;
    timeline.setPlaying(was);
    return { speed, steps, replies, worst, jumps, gangsInDetail: bubble.inside.size, inDetail: [...bubble.inside], workers: bubble.info.workers, t: timeline.t };
  },
  setXray, setWalk, setCourses, sceneTriangles, syncBench, SPOTS, ELEMENTS, COURSES, SLED, FIG,
  get tour() { return tour; }, startTour, endTour,
  hold: false, // true: the frame loop stops drawing (a test drives the frames)
  view: (x, y, z, tx, ty, tz) => { camera.position.set(x, y, z); orbit.target.set(tx, ty, tz); orbit.update(); },
  // run `seconds` of frames and report the frame rate (requestAnimationFrame timing)
  measure: (seconds = 3) => new Promise((res) => {
    const ts = []; const t0 = performance.now();
    const step = (t) => { ts.push(t); if (t - t0 < seconds * 1000) requestAnimationFrame(step); else {
      const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      res({ fps: +(1000 / mean).toFixed(1), meanMs: +mean.toFixed(2), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(2), frames: d.length, tris: perf.tris, calls: perf.calls, sceneTris: sceneTriangles() });
    } };
    requestAnimationFrame(step);
  }),
};

let hudT = 0;
function frame() {
  // a test (tests/e2e) that drives frames itself sets __khufu.hold, so this loop stands aside
  if (window.__khufu.hold) { clock.getDelta(); requestAnimationFrame(frame); return; }
  const dt = Math.min(clock.getDelta(), 0.1);
  if (tour.active) tour.update(dt); else timeline.tick(dt);
  if (timeline.ready && bubble.visible && !(tour.active && tour.drewBubble)) bubble.update(timeline.t, camera, dt);
  // the tunnel's cut and its drawn face, diggers and plugs from the same time sample
  if (timeline.ready) { const tn = works.update(timeline.t, walker.enabled, camera); if (tn) { tunnelNow = tn; applyReveal(); } }
  // a followed levy gang that goes home hands the camera to the working gang nearest the view
  if (follow >= 0 && !walker.enabled && bubble.trips[follow]?.away) { follow = bubble.nearestGang(orbit.target); if (follow >= 0) bubble.sledAt(follow, followAt); else $('follow').classList.remove('on'); }
  if (follow >= 0 && !walker.enabled && bubble.sledAt(follow, followNow)) {
    const d = followNow.clone().sub(followAt);
    camera.position.add(d); orbit.target.add(d); followAt.copy(followNow);
  }
  zoomStep();
  if (walker.enabled) walker.update(dt); else if (!tour.active) {
    orbit.update();
    // zooming toward the mouse can carry the pivot below the plateau; keep it on the ground
    if (orbit.target.y < 0 && !xray) { camera.position.y -= orbit.target.y; orbit.target.y = 0; }
  }
  const climbShown = walker.enabled && walker.canClimb;
  if (climbShown !== frame.climbShown) { frame.climbShown = climbShown; $('climb').style.display = climbShown ? 'block' : 'none'; }
  // far detail level: from far away the finished pyramid is a textured hull and the rooms are
  // skipped (a part-built pyramid keeps its section, cap and rooms)
  const far = !walker.enabled && monument.complete && camera.position.distanceTo(orbit.target.clone().setY(50)) > 1500 && camera.position.length() > 1500;
  monument.setFar(far && !xray);
  rooms.group.visible = !(far && !xray);
  // inside, the open sky stops lighting things: only the torch remains
  hemi.intensity = THREE.MathUtils.lerp(HEMI, 0.04, walker.enabled ? walker.indoor : 0);
  rooms.setBrightness(xray || !monument.complete ? 1 : THREE.MathUtils.lerp(0.12, 1, walker.enabled ? walker.indoor : 0));
  renderer.render(scene, camera);
  labelRenderer.domElement.style.display = overlay.visible && !walker.enabled ? '' : 'none';
  if (overlay.visible && !walker.enabled) labelRenderer.render(scene, camera);
  perf.tris = renderer.info.render.triangles; perf.calls = renderer.info.render.calls;
  perf.frames++; perf.t += dt; perf.worst = Math.max(perf.worst, dt);
  hudT -= dt;
  if (hudT <= 0 && perf.t > 0.05) {
    hudT = 0.5;
    perf.fps = perf.frames / Math.max(1e-6, perf.t); perf.ms = (perf.t / perf.frames) * 1000;
    const bi = bubble.info;
    $('stats').textContent = `${perf.fps.toFixed(0)} fps · ${perf.ms.toFixed(1)} ms · ${perf.tris.toLocaleString()} tris · ${perf.calls} draws${monument.far ? ' · far hull' : ''}${bi.near ? ` · ${bi.near} gangs, ${bi.workers} workers in detail` : ''}`;
    perf.frames = 0; perf.t = 0; perf.worst = 0;
    if (walker.enabled) {
      const el = whereIs(walker.pos);
      $('where').textContent = el ? el.name : walker.indoor > 0.5 ? 'In the masonry' : walker.pos.y > 0.5 ? 'On the access stair' : 'Outside, on the plateau';
      $('note').textContent = el ? el.note : walker.indoor > 0.5 ? '' : 'The stair up to the entrance is added for access; the casing itself is smooth';
    } else {
      if (view && !view.done) {
        const c = view.course;
        $('where').textContent = c && c.ci === COURSE_COUNT ? 'Setting the capstone' : `Laying course ${view.cur + 1} of ${COURSE_COUNT}, ${view.topY.toFixed(1)} m up`;
        const st = works.info.stage;
        const extra = st >= 0 ? ` · tunnellers cutting the ${TUNNEL[st].name}` : '';
        $('note').textContent = `${clockText(timeline.t)} of the build${extra}`;
      } else {
        $('where').textContent = `The finished monument, c. 2560 BC`;
        $('note').textContent = `${COURSE_COUNT} courses and a pyramidion, ${HEIGHT} m high on a ${(HALF * 2).toFixed(1)} m base`;
      }
    }
  }
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
});
if (params.get('xray')) setXray(true);
if (params.get('walk')) { const s = SPOTS.find((q) => q.key === params.get('walk')); setWalk(true, s); }
requestAnimationFrame(frame);
