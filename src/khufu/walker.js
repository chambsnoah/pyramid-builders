// First-person walking inside Khufu's pyramid, adapted from ../fps.js: pointer-lock or
// drag to look, WASD to move, collision against the column solids of collision.js.
// Differences for this monument:
// - The passages are 1.05 × 1.2 m and steep, so the walker crouches by itself to fit any
//   space at least CRAWL high, and slows down while bent over.
// - Junctions where one passage leaves through the roof of another (descending →
//   ascending, the foot of the Grand Gallery) need a scramble: Space climbs up to CLIMB
//   onto a ledge ahead (or, failing that, any ledge within reach around the body).
//   Ledges up to AUTO_CLIMB (the great step) are climbed by walking on; higher ones up to
//   CLIMB after pushing against them for PUSH_CLIMB seconds. `canClimb` says whether Space
//   would do anything here, for an on-screen prompt.
// - Narrow doorways (0.85 m) are hard to line up with: walking into a wall next to an
//   opening slides the body sideways into it (up to NUDGE: enough to reach the entrance
//   from either edge of the access stair).
// - Of several floors within reach, the one nearest the feet is taken, so walking past a
//   junction keeps to the passage you are in.
import * as THREE from 'three';

// MIN_CLIMB: a ledge must rise more than the floor of a 26° passage does within the 0.85 m
// that findClimb looks ahead (at most 0.42 m, 0.45 m beside the Grand Gallery's benches),
// or every sloping passage would look climbable; and less than the 0.52 m step in the
// Queen's Chamber passage, or that step can't be climbed at all
const MIN_CLIMB = 0.48;
const STAND = 1.75, EYE_DROP = 0.13, CRAWL = 0.8, STEP = 0.45, CLIMB = 2.2, AUTO_CLIMB = 1.0, PUSH_CLIMB = 0.3, NUDGE = 0.6, RADIUS = 0.24;

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
    this.push = 0; // seconds spent walking into something
    this.canClimb = false; this.climbCheck = 0;
    this.torch = new THREE.PointLight(0xffb36a, 0, 26, 1.1);
    camera.add(this.torch);
    this.torch.position.set(0.18, 0.2, 0.3);
    window.addEventListener('keydown', (e) => {
      // keys pressed in a form control (the course slider's arrows) are not movement
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      this.keys[e.code] = true;
      if (e.code === 'Space' && this.enabled) { e.preventDefault(); this.tryClimb(CLIMB, 4); }
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
      // the casing is too steep and smooth to stand on: it only counts within a few cm of
      // the feet (where it meets the landing at the entrance sill), so the body can't climb
      // it, nor hang over the edge of the access stair or a part-built course
      if (!s[i].walk && Math.abs(f - feet) > 0.03) continue;
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

  // a ledge to scramble onto within `reach`: straight ahead first, then up to `around`
  // eighths of a turn either side (4 = any direction: the ascending passage opens overhead
  // and behind someone climbing out of the descending one). Returns where to stand, or null.
  findClimb(reach, around = 0) {
    const feet = this.pos.y;
    const headings = [0, 1, -1, 2, -2, 3, -3, 4].filter((k) => Math.abs(k) <= around).map((k) => this.yaw + (k * Math.PI) / 4);
    for (const yaw of headings) {
      const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      for (const d of [0, 0.25, 0.45, 0.65, 0.85]) {
        const x = this.pos.x + dx * d, z = this.pos.z + dz * d;
        const s = this.col.column(x, z);
        for (let i = 0; i < s.length; i++) {
          const f = s[i].y1, c = i + 1 < s.length ? s[i + 1].y0 : Infinity;
          if (!s[i].walk || f <= feet + MIN_CLIMB || f > feet + reach || c - f < CRAWL) continue;
          if (this.passable(x, z, f)) return new THREE.Vector3(x, f, z);
        }
      }
    }
    return null;
  }
  // scramble up onto a ledge, if there is one within `reach`
  tryClimb(reach, around = 0) {
    if (this.driven) return false;
    if (this.climb) return false;
    const to = this.findClimb(reach, around);
    if (!to) return false;
    this.climb = { from: this.pos.clone(), to, t: 0, dur: 0.25 + (to.y - this.pos.y) * 0.3 };
    this.push = 0; this.canClimb = false;
    return true;
  }

  // Driven from outside (the guided tour): the feet, heading and pitch are set each frame and
  // the walker only crouches, bobs, lights the torch and places the camera; no keys, gravity
  // or climbing. drive(null) hands it back to the keys.
  // (speed, m/s, only sets the pace of the head bob; ahead: where the feet will be shortly,
  // so the body starts to crouch before a low ceiling instead of ducking at it)
  drive(p, yaw, pitch, speed = 0, ahead = null) {
    if (!p) { this.driven = false; this.ahead = null; return; }
    this.driven = true; this.ahead = ahead;
    this.pos.copy(p); this.vel.set(-Math.sin(yaw) * speed, 0, -Math.cos(yaw) * speed); this.vy = 0; this.climb = null;
    this.yaw = yaw; this.pitch = pitch;
  }
  enter(p, yaw) {
    this.enabled = true;
    this.teleport(p, yaw);
    this.camera.near = 0.03; this.camera.far = 9000; this.camera.updateProjectionMatrix();
  }
  exit() {
    this.enabled = false; this.driven = false; this.torch.intensity = 0; this.climb = null;
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
    } else if (!this.driven) this.move(dt);
    this.climbCheck -= dt;
    if (this.driven) this.canClimb = false;
    else if (this.climbCheck <= 0) { this.climbCheck = 0.15; this.canClimb = !this.climb && !!this.findClimb(CLIMB, 4); }
    // crouch to fit the space overhead
    const room = this.headroom(this.pos.x, this.pos.z, this.pos.y);
    let soon = room;
    if (this.driven && this.ahead) soon = Math.min(room, this.headroom(this.ahead.x, this.ahead.z, this.ahead.y) + Math.max(0, this.ahead.y - this.pos.y));
    const want = Math.min(STAND, Math.max(CRAWL, soon - 0.06));
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

  // walking into a wall beside an opening: slide sideways toward the nearest spot (within
  // NUDGE) from which the body can carry on. Two ways to slide: square to the wanted
  // direction, and straight along the wall that stopped it (bx / bz: the x / z step was
  // refused). Walking at an angle into a face, sliding square to the heading also moves
  // into the face, so only the slide along the wall gets to a doorway in it.
  nudge(want, step, bx = false, bz = false) {
    const ahead = 0.1, feet = this.pos.y;
    const ways = [[-want.z, want.x, want.x, want.z]]; // slide x, z; then check ahead along x, z
    if (bz && !bx) ways.push([1, 0, 0, Math.sign(want.z)]);
    if (bx && !bz) ways.push([0, 1, Math.sign(want.x), 0]);
    for (let o = 0.05; o <= NUDGE + 1e-6; o += 0.05) {
      for (const [px, pz, ax, az] of ways) {
        for (const sgn of [1, -1]) {
          const x = this.pos.x + px * o * sgn, z = this.pos.z + pz * o * sgn;
          if (!this.passable(x, z, feet) || !this.passable(x + ax * ahead, z + az * ahead, feet)) continue;
          // every point on the way there must be clear too
          const k = Math.min(1, step / o), mx = this.pos.x + px * o * sgn * k, mz = this.pos.z + pz * o * sgn * k;
          if (!this.passable(mx, mz, feet)) continue;
          this.pos.x = mx; this.pos.z = mz;
          return true;
        }
      }
    }
    return false;
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
    let blocked = false, bx = false, bz = false;
    const want = dir.lengthSq() > 0 ? dir.clone().normalize() : null;
    const nx = this.pos.x + this.vel.x * dt;
    // blocked: a step the player is asking for was refused. Judged on the wanted direction,
    // not the velocity, which restarts from 0 after every refusal and never builds up to a
    // threshold when crouched (so the body was never nudged into the antechamber passage)
    if (this.passable(nx, this.pos.z, this.pos.y)) this.pos.x = nx; else { bx = want !== null && Math.abs(want.x) > 0.3; blocked ||= bx; this.vel.x = 0; }
    const nz = this.pos.z + this.vel.z * dt;
    if (this.passable(this.pos.x, nz, this.pos.y)) this.pos.z = nz; else { bz = want !== null && Math.abs(want.z) > 0.3; blocked ||= bz; this.vel.z = 0; }
    if (blocked && want) this.nudge(want, speed * dt, bx, bz);
    this.push = blocked && fwd > 0 ? this.push + dt : 0;
    if (blocked && fwd > 0 && (this.tryClimb(AUTO_CLIMB) || (this.push > PUSH_CLIMB && this.tryClimb(CLIMB, 1)))) return;
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
