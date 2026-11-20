// First-person walking inside Khufu's pyramid, adapted from ../fps.js: pointer-lock or
// drag to look, WASD to move, collision against the column solids of collision.js.
// Differences for this monument:
// - The passages are 1.05 × 1.2 m and steep, so the walker crouches by itself to fit any
//   space at least CRAWL high, and slows down while bent over.
// - Junctions where one passage leaves through the roof of another (descending →
//   ascending, the foot of the Grand Gallery) need a scramble: Space climbs up to CLIMB
//   onto a ledge ahead. Ledges up to AUTO_CLIMB (the great step) are climbed by walking on.
// - Of several floors within reach, the one nearest the feet is taken, so walking past a
//   junction keeps to the passage you are in.
import * as THREE from 'three';

const STAND = 1.75, EYE_DROP = 0.13, CRAWL = 0.8, STEP = 0.45, CLIMB = 1.9, AUTO_CLIMB = 1.0, RADIUS = 0.24;

export class Walker {
  constructor(camera, dom, collision) {
    this.camera = camera; this.dom = dom; this.col = collision;
    this.enabled = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0; this.yaw = Math.PI; this.pitch = 0;
    this.height = STAND; this.bob = 0; this.indoor = 0;
    this.keys = {};
    this.climb = null;
    this.torch = new THREE.PointLight(0xffb36a, 0, 26, 1.1);
    camera.add(this.torch);
    this.torch.position.set(0.18, 0.2, 0.3);
    window.addEventListener('keydown', (e) => {
      // keys pressed in a form control (the course slider's arrows) are not movement
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      this.keys[e.code] = true;
      if (e.code === 'Space' && this.enabled) { e.preventDefault(); this.tryClimb(CLIMB); }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    dom.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== dom) return;
      this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
    let drag = null;
    dom.addEventListener('pointerdown', (e) => { if (this.enabled && document.pointerLockElement !== dom) drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => { drag = null; });
    window.addEventListener('pointermove', (e) => {
      if (!drag || !this.enabled) return;
      this.look((e.clientX - drag.x) * 0.004, (e.clientY - drag.y) * 0.004);
      drag = { x: e.clientX, y: e.clientY };
    });
  }
  look(dx, dy) { this.yaw -= dx; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy)); }

  // The floor to stand on at (x, z) for a body whose feet are at `feet`, or null if blocked.
  support(x, z, feet, step = STEP) {
    const s = this.col.column(x, z);
    let best = null;
    for (let i = 0; i < s.length; i++) {
      const f = s[i].y1, c = i + 1 < s.length ? s[i + 1].y0 : Infinity;
      if (!s[i].walk && f > feet + 0.03) continue; // can't climb the casing
      if (c - f < CRAWL || f > feet + step) continue;
      // there must be room for a crouched body at the height it moves in, unless it is
      // dropping into an opening that starts at its feet
      const ok = c - Math.max(f, feet) >= CRAWL || (f < feet && c >= feet - 0.05);
      if (!ok) continue;
      if (!best || Math.abs(f - feet) < Math.abs(best.f - feet)) best = { f, c };
    }
    return best;
  }
  passable(x, z, feet, step = STEP) {
    if (!this.support(x, z, feet, step)) return false;
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      if (!this.support(x + Math.cos(t) * RADIUS, z + Math.sin(t) * RADIUS, feet, step)) return false;
    }
    return true;
  }
  // headroom over the body: the lowest ceiling over its footprint
  headroom(x, z, feet) {
    let h = Infinity;
    for (let a = -1; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2, r = a < 0 ? 0 : RADIUS;
      const s = this.support(x + Math.cos(t) * r, z + Math.sin(t) * r, feet);
      if (s) h = Math.min(h, s.c - feet);
    }
    return h;
  }

  // scramble up onto a ledge ahead, if there is one within `reach`
  tryClimb(reach) {
    if (this.climb) return false;
    const dir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const feet = this.pos.y;
    for (const d of [0, 0.25, 0.45, 0.65, 0.85]) {
      const x = this.pos.x + dir.x * d, z = this.pos.z + dir.z * d;
      const s = this.col.column(x, z);
      for (let i = 0; i < s.length; i++) {
        const f = s[i].y1, c = i + 1 < s.length ? s[i + 1].y0 : Infinity;
        if (!s[i].walk || f <= feet + STEP * 0.5 || f > feet + reach || c - f < CRAWL) continue;
        if (!this.passable(x, z, f)) continue;
        this.climb = { from: this.pos.clone(), to: new THREE.Vector3(x, f, z), t: 0, dur: 0.25 + (f - feet) * 0.3 };
        return true;
      }
    }
    return false;
  }

  enter(p, yaw) {
    this.enabled = true;
    this.teleport(p, yaw);
    this.camera.near = 0.03; this.camera.far = 9000; this.camera.updateProjectionMatrix();
  }
  exit() {
    this.enabled = false; this.torch.intensity = 0; this.climb = null;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }
  teleport(p, yaw) {
    this.pos.copy(p); this.vel.set(0, 0, 0); this.vy = 0; this.climb = null;
    if (yaw !== undefined) this.yaw = yaw;
    this.pitch = 0;
    const s = this.support(p.x, p.z, p.y + 0.3);
    if (s) this.pos.y = s.f;
    else { // not a standing place: snap to the nearest floor with room above it
      const col = this.col.column(p.x, p.z);
      let best = null;
      col.forEach((a, i) => {
        const c = i + 1 < col.length ? col[i + 1].y0 : Infinity;
        if (a.walk && c - a.y1 >= CRAWL && (best === null || Math.abs(a.y1 - p.y) < Math.abs(best - p.y))) best = a.y1;
      });
      if (best !== null) this.pos.y = best;
    }
    this.height = Math.min(STAND, Math.max(CRAWL, this.headroom(this.pos.x, this.pos.z, this.pos.y)));
  }

  update(dt) {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.05);
    if (this.climb) {
      const c = this.climb;
      c.t += dt / c.dur;
      const k = Math.min(1, c.t), e = k * k * (3 - 2 * k);
      this.pos.lerpVectors(c.from, c.to, e);
      this.pos.y = c.from.y + (c.to.y - c.from.y) * Math.min(1, e * 1.6);
      if (k >= 1) { this.pos.copy(c.to); this.climb = null; this.vel.set(0, 0, 0); }
    } else this.move(dt);
    // crouch to fit the space overhead
    const room = this.headroom(this.pos.x, this.pos.z, this.pos.y);
    const want = Math.min(STAND, Math.max(CRAWL, room - 0.06));
    this.height += (want - this.height) * Math.min(1, dt * (want < this.height ? 18 : 5));
    if (this.height > room - 0.04) this.height = Math.max(CRAWL - 0.06, room - 0.04);
    const moving = Math.hypot(this.vel.x, this.vel.z);
    this.bob += moving * dt * 2.2;
    const bobY = Math.sin(this.bob * 2) * 0.022 * Math.min(1, moving / 2);
    this.camera.position.set(this.pos.x, this.pos.y + this.height - EYE_DROP + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // torch when under cover
    const s = this.col.column(this.pos.x, this.pos.z);
    const covered = s.some((a) => a.y0 > this.pos.y + 0.5 && a.y0 < this.pos.y + 40);
    this.indoor = THREE.MathUtils.lerp(this.indoor, covered ? 1 : 0, Math.min(1, dt * 3));
    const now = performance.now();
    this.torch.intensity = this.indoor * 9 * (0.93 + 0.07 * Math.sin(now * 0.013) * Math.sin(now * 0.007));
  }

  move(dt) {
    const k = this.keys;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const str = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const run = k.ShiftLeft || k.ShiftRight;
    const bent = this.height < 1.45;
    const speed = (bent ? 1.4 : 2.6) * (run ? 2.2 : 1);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * str, 0, -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * str);
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(speed);
    this.vel.lerp(dir, Math.min(1, dt * 10));
    let blocked = false;
    const nx = this.pos.x + this.vel.x * dt;
    if (this.passable(nx, this.pos.z, this.pos.y)) this.pos.x = nx; else { blocked = blocked || Math.abs(this.vel.x) > 0.3; this.vel.x = 0; }
    const nz = this.pos.z + this.vel.z * dt;
    if (this.passable(this.pos.x, nz, this.pos.y)) this.pos.z = nz; else { blocked = blocked || Math.abs(this.vel.z) > 0.3; this.vel.z = 0; }
    if (blocked && fwd > 0 && this.tryClimb(AUTO_CLIMB)) return;
    const s = this.support(this.pos.x, this.pos.z, this.pos.y);
    if (!s) return;
    const floor = s.f;
    if (floor > this.pos.y) { this.pos.y = Math.min(floor, this.pos.y + dt * 6 + (floor - this.pos.y) * Math.min(1, dt * 18)); this.vy = 0; }
    else if (floor < this.pos.y - 0.001) {
      // follow sloping floors down smoothly, fall from real ledges
      if (this.pos.y - floor < 0.45 && this.vy === 0) this.pos.y = Math.max(floor, this.pos.y - dt * 5);
      else { this.vy -= 18 * dt; this.pos.y = Math.max(floor, this.pos.y + this.vy * dt); if (this.pos.y === floor) this.vy = 0; }
    }
  }
}
