// Khufu's pyramid, Phase 1 of the plan in issue #1: the finished monument at full size,
// drawn as surfaces, with a walkable interior. No simulation yet.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { HALF, HEIGHT, PAVEMENT, COURSES, COURSE_COUNT, ELEMENTS, SPOTS, groundHeight, floorY, ceilY } from './data.js';
import { buildTextures, TX } from './textures.js';
import { Monument } from './monument.js';
import { Rooms } from './rooms.js';
import { Collision } from './collision.js';
import { Walker } from './walker.js';

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
orbit.enableDamping = true; orbit.dampingFactor = 0.08;
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
  monument.setXray(on); rooms.setXray(on); overlay.visible = on;
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
  $('hint').style.display = on ? 'block' : 'none';
  $('cross').style.display = on ? 'block' : 'none';
}
$('walk').onclick = () => setWalk(!walker.enabled);
renderer.domElement.addEventListener('click', () => { if (walker.enabled && document.pointerLockElement !== renderer.domElement && !params.has('nolock')) lockPointer(); });
SPOTS.forEach((s, i) => {
  const b = document.createElement('button');
  b.innerHTML = `${s.name}<span>${i + 1}</span>`;
  b.onclick = () => setWalk(true, s);
  $('rooms').appendChild(b);
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyX') setXray(!xray);
  if (e.code === 'KeyF') setWalk(!walker.enabled);
  const d = /^Digit(\d)$/.exec(e.code);
  if (d && SPOTS[+d[1] - 1]) setWalk(true, SPOTS[+d[1] - 1]);
});

// build height (a section through the rooms; later phases drive this from the timeline)
const slider = $('courses');
slider.max = COURSE_COUNT; slider.value = COURSE_COUNT;
function setCourses(n) {
  const top = monument.setBuiltCourses(n);
  collision.topY = top;
  rooms.setSection(monument.built < COURSE_COUNT ? top + 0.001 : null);
  // new masonry may have risen through the walker (standing on a lower cap): lift it to the
  // nearest floor with room above, or leave walking if there is none
  if (walker.enabled && !walker.passable(walker.pos.x, walker.pos.z, walker.pos.y)) {
    const pitch = walker.pitch;
    walker.teleport(walker.pos.clone(), walker.yaw);
    walker.pitch = pitch;
    if (!walker.passable(walker.pos.x, walker.pos.z, walker.pos.y)) setWalk(false);
  }
  $('courseLabel').textContent = monument.built === COURSE_COUNT ? `all ${COURSE_COUNT}` : `${monument.built} · ${top.toFixed(1)} m`;
}
slider.addEventListener('input', () => setCourses(+slider.value));
setCourses(+(params.get('courses') || COURSE_COUNT));
slider.value = monument.built;

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
  THREE, scene, camera, renderer, orbit, monument, rooms, collision, walker, perf, setXray, setWalk, setCourses, sceneTriangles, syncBench, SPOTS, ELEMENTS, COURSES,
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
  const dt = Math.min(clock.getDelta(), 0.1);
  if (walker.enabled) walker.update(dt); else orbit.update();
  // far detail level: from far away the finished pyramid is a textured hull and the rooms are
  // skipped (a part-built pyramid keeps its section, cap and rooms)
  const far = !walker.enabled && monument.built === COURSE_COUNT && camera.position.distanceTo(orbit.target.clone().setY(50)) > 1500 && camera.position.length() > 1500;
  monument.setFar(far && !xray);
  rooms.group.visible = !(far && !xray);
  // inside, the open sky stops lighting things: only the torch remains
  hemi.intensity = THREE.MathUtils.lerp(HEMI, 0.04, walker.enabled ? walker.indoor : 0);
  rooms.setBrightness(xray || monument.built < COURSE_COUNT ? 1 : THREE.MathUtils.lerp(0.12, 1, walker.enabled ? walker.indoor : 0));
  renderer.render(scene, camera);
  labelRenderer.domElement.style.display = overlay.visible && !walker.enabled ? '' : 'none';
  if (overlay.visible && !walker.enabled) labelRenderer.render(scene, camera);
  perf.tris = renderer.info.render.triangles; perf.calls = renderer.info.render.calls;
  perf.frames++; perf.t += dt; perf.worst = Math.max(perf.worst, dt);
  hudT -= dt;
  if (hudT <= 0 && perf.t > 0.05) {
    hudT = 0.5;
    perf.fps = perf.frames / Math.max(1e-6, perf.t); perf.ms = (perf.t / perf.frames) * 1000;
    $('stats').textContent = `${perf.fps.toFixed(0)} fps · ${perf.ms.toFixed(1)} ms · ${perf.tris.toLocaleString()} tris · ${perf.calls} draws${monument.far ? ' · far hull' : ''}`;
    perf.frames = 0; perf.t = 0; perf.worst = 0;
    if (walker.enabled) {
      const el = whereIs(walker.pos);
      $('where').textContent = el ? el.name : walker.indoor > 0.5 ? 'In the masonry' : walker.pos.y > 0.5 ? 'On the access stair' : 'Outside, on the plateau';
      $('note').textContent = el ? el.note : walker.indoor > 0.5 ? '' : 'The stair up to the entrance is added for access; the casing itself is smooth';
    } else {
      $('where').textContent = `The finished monument, c. 2560 BC`;
      $('note').textContent = `${COURSE_COUNT} courses and a pyramidion, ${HEIGHT} m high on a ${(HALF * 2).toFixed(1)} m base`;
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
