// First-person walking: pointer-lock look, WASD movement, and collision against the
// same column solids that describe the masonry, excavations, ramp and terrain.
import * as THREE from 'three';
import { HALF, columnSolids } from './plan.js';
import { terrainHeight, SITE } from './world.js';
import { rampHeightAt } from './pyramid.js';

const EYE = 1.62, HEAD = 1.78, STEP = 0.5, RADIUS = 0.26;

export class FirstPerson {
  constructor(camera, dom, sim) {
    this.camera = camera; this.dom = dom; this.sim = sim;
    this.enabled = false;
    this.pos = new THREE.Vector3(0, 0, -HALF - 8);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.yaw = Math.PI; this.pitch = 0;
    this.keys = {};
    this.bob = 0;
    this.torch = new THREE.PointLight(0xffb36a, 0, 18, 1.0);
    this.torch.castShadow = false;
    camera.add(this.torch);
    this.torch.position.set(0.15, 0.25, 0.45);
    this.indoor = 0;
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    dom.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
    // drag-to-look fallback when the pointer is not locked
    let drag = null;
    dom.addEventListener('pointerdown', (e) => { if (this.enabled && document.pointerLockElement !== dom) drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => { drag = null; });
    window.addEventListener('pointermove', (e) => {
      if (!drag || !this.enabled) return;
      this.yaw -= (e.clientX - drag.x) * 0.004; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    });
  }

  solids(x, z) {
    let s = null;
    if (Math.abs(x) < HALF && Math.abs(z) < HALF) s = columnSolids(x, z).map((a) => a.slice());
    else {
      let g = terrainHeight(x, z);
      if (x > SITE.quayX - 2.7 && x < SITE.quayX + 0.3 && z > SITE.basin.z0 - 2 && z < SITE.basin.z1 + 2) g = Math.max(g, 0.15);
      if (g < -0.25) return null; // water: not walkable
      s = [[-99, g]];
    }
    const r = rampHeightAt(x < 0 ? this.sim.rampHW : this.sim.rampH, x, z);
    if (r > -Infinity) s.push([0, r]);
    for (const e of this.sim.extraSolids) {
      if (Math.abs(x - e.x) < (e.hx ?? e.r) && Math.abs(z - e.z) < (e.hz ?? e.r)) s.push([e.y0, e.y1]);
    }
    s.sort((a, b) => a[0] - b[0]);
    const m = [];
    for (const a of s) { const l = m[m.length - 1]; if (l && a[0] <= l[1] + 1e-4) l[1] = Math.max(l[1], a[1]); else m.push(a); }
    return m;
  }

  // floor height for a body whose feet are at `feet`, or null if blocked
  floorAt(x, z, feet) {
    const s = this.solids(x, z);
    if (!s) return null;
    for (let i = s.length - 1; i >= 0; i--) {
      const floor = s[i][1], ceil = i + 1 < s.length ? s[i + 1][0] : Infinity;
      if (floor <= feet + STEP && ceil >= Math.max(floor, feet) + HEAD) return floor;
      if (floor <= feet + STEP && ceil < Math.max(floor, feet) + HEAD) return null;
    }
    return null;
  }
  passable(x, z, feet) {
    if (this.floorAt(x, z, feet) === null) return false;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (this.floorAt(x + Math.cos(ang) * RADIUS, z + Math.sin(ang) * RADIUS, feet) === null) return false;
    }
    return true;
  }

  enter(start, yaw) {
    this.enabled = true;
    if (start) this.pos.copy(start);
    if (yaw !== undefined) this.yaw = yaw;
    this.pitch = 0;
    const f = this.floorAt(this.pos.x, this.pos.z, this.pos.y + 0.3);
    if (f !== null) this.pos.y = f;
    this.camera.near = 0.05; this.camera.updateProjectionMatrix();
  }
  exit() {
    this.enabled = false; this.torch.intensity = 0;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this.camera.near = 0.3; this.camera.updateProjectionMatrix();
  }
  teleport(p, yaw) { this.pos.copy(p); this.yaw = yaw; this.vel.set(0, 0, 0); this.vy = 0; }

  update(dt) {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const str = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const run = k.ShiftLeft || k.ShiftRight;
    const speed = run ? 5.2 : 2.6;
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * str, 0, -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * str);
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(speed);
    this.vel.lerp(dir, Math.min(1, dt * 10));
    // move each axis separately so walls can be slid along
    const nx = this.pos.x + this.vel.x * dt;
    if (this.passable(nx, this.pos.z, this.pos.y)) this.pos.x = nx; else this.vel.x = 0;
    const nz = this.pos.z + this.vel.z * dt;
    if (this.passable(this.pos.x, nz, this.pos.y)) this.pos.z = nz; else this.vel.z = 0;
    const floor = this.floorAt(this.pos.x, this.pos.z, this.pos.y);
    if (floor !== null) {
      if (floor > this.pos.y) { this.pos.y = Math.min(floor, this.pos.y + dt * 6 + (floor - this.pos.y) * Math.min(1, dt * 18)); this.vy = 0; }
      else if (floor < this.pos.y - 0.001) {
        // follow descending stairs smoothly, fall from real ledges
        if (this.pos.y - floor < 0.45 && this.vy === 0) this.pos.y = Math.max(floor, this.pos.y - dt * 4.5);
        else { this.vy -= 18 * dt; this.pos.y = Math.max(floor, this.pos.y + this.vy * dt); if (this.pos.y === floor) this.vy = 0; }
      }
    }
    const moving = this.vel.length();
    this.bob += moving * dt * 2.2;
    const bobY = Math.sin(this.bob * 2) * 0.025 * Math.min(1, moving / 2);
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // torch when under cover
    const s = this.solids(this.pos.x, this.pos.z);
    const covered = !!s && s.some((a) => a[0] > this.pos.y + 1);
    this.indoor = THREE.MathUtils.lerp(this.indoor, covered ? 1 : 0, Math.min(1, dt * 3));
    this.torch.intensity = this.indoor * 2.4 * (0.92 + 0.08 * Math.sin(performance.now() * 0.013) * Math.sin(performance.now() * 0.007));
  }
}
