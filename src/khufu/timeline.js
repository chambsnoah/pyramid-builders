// The timeline in years (Phase 3): play, pause, speed, day and month steps, drag to any day,
// milestone markers, and the historical clock. It owns the Web Worker that runs the event
// model (sim/worker.js) and asks it for the state at the time shown.
//
// Seeking: at most one seek is in flight; while it runs, newer requests overwrite each other
// and only the latest is sent when the reply arrives. So dragging or playing at any speed
// never builds up a backlog, and the page always converges on the time on the slider.
import { DAY, MONTH, YEAR, YEAR_DAYS, MONTH_DAYS } from './sim/params.js';

// Historical clock. The model counts working time only (300 days of 10 hours a year; the
// flood calendar is Phase 6), so the twelve 25-day months are laid over the three Egyptian
// seasons of four months each, and the working day starts at dawn.
const SEASONS = ['Akhet', 'Peret', 'Shemu']; // inundation, growing, harvest
const SEASON_NOTE = ['inundation', 'growing season', 'harvest'];
const ROMAN = ['I', 'II', 'III', 'IV'];
const DAWN = 6;
export function clock(t) {
  const day = Math.floor(t / DAY), year = Math.floor(day / YEAR_DAYS), doy = day - year * YEAR_DAYS;
  const month = Math.floor(doy / MONTH_DAYS), dom = doy - month * MONTH_DAYS;
  const sec = Math.max(0, t - day * DAY), hh = DAWN + Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
  const season = Math.floor(month / 4);
  return {
    day, year: year + 1, month: month + 1, season: SEASONS[season], seasonNote: SEASON_NOTE[season], seasonMonth: ROMAN[month % 4], dom: dom + 1,
    time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
  };
}
export const clockText = (t) => { const c = clock(t); return `Year ${c.year} · ${c.season} ${c.seasonMonth}, day ${c.dom} · ${c.time}`; };
export function spanText(dt) {
  const d = Math.round(Math.abs(dt) / DAY), y = Math.floor(d / YEAR_DAYS), r = d - y * YEAR_DAYS;
  return y ? `${y} y ${r} d` : `${r} d`;
}

// Playback speeds, in seconds of working time per real second.
export const SPEEDS = [
  { k: 1, label: '1×' }, { k: 60, label: '1 min/s' }, { k: 3600, label: '1 h/s' }, { k: DAY, label: '1 day/s' },
  { k: 10 * DAY, label: '10 days/s' }, { k: MONTH, label: '1 month/s' }, { k: 3 * MONTH, label: '3 months/s' }, { k: YEAR, label: '1 year/s' },
];

// The worker and its one-in-flight seek queue. If the worker dies (out of memory, a script
// error) it is started again and the build re-run, up to MAX_RESTARTS times; restart() does
// the same on demand.
const MAX_RESTARTS = 2;
export class SimClient {
  constructor({ onProgress, onReady, onState, onError, onRestart }) {
    this.cb = { onProgress, onReady, onState, onError, onRestart };
    this.id = 0; this.want = null; this.sentAt = 0; this.restarts = 0;
    this.waiters = [];
    this.last = { ms: 0, roundTrip: 0 };
    this.overrides = {};
    this.spawn();
  }
  spawn() {
    this.worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.receive(e.data);
    this.worker.onerror = (e) => this.fail(e.message || 'worker failed');
    this.busy = false; this.ready = false;
  }
  init(overrides = {}) { this.overrides = overrides; this.t0 = performance.now(); this.worker.postMessage({ type: 'init', overrides }); }
  // throw the worker away and run the build again; the latest wanted time is kept and sent
  // once the new worker is ready
  restart() {
    if (this.busy && this.want === null) this.want = this.sentT;
    this.worker.terminate();
    this.spawn();
    this.cb.onRestart?.(this.restarts);
    this.init(this.overrides);
  }
  fail(message) {
    if (this.restarts < MAX_RESTARTS) { this.restarts++; console.warn('[khufu] worker failed, restarting:', message); this.restart(); return; }
    this.busy = false;
    this.cb.onError?.(message);
  }
  seek(t) { this.want = t; this.pump(); }
  pump() {
    if (!this.ready || this.busy || this.want === null) return;
    this.busy = true;
    this.sentT = this.want; this.want = null; this.sentAt = performance.now();
    this.worker.postMessage({ type: 'seek', id: ++this.id, t: this.sentT });
  }
  // resolves with the reply for time t (for measurements)
  seekAndWait(t) { return new Promise((res) => { this.waiters.push({ t, res, at: performance.now() }); this.seek(t); }); }
  receive(m) {
    if (m.type === 'progress') this.cb.onProgress?.(m);
    else if (m.type === 'ready') { this.ready = true; this.summary = m.summary; this.cb.onReady?.(m.summary, { ms: m.ms, wall: performance.now() - this.t0 }); this.pump(); }
    else if (m.type === 'state') {
      this.busy = false;
      this.last = { ms: m.ms, roundTrip: performance.now() - this.sentAt };
      this.cb.onState?.(m, this.last);
      this.waiters = this.waiters.filter((w) => {
        if (w.t !== m.t) return true;
        w.res({ ...this.last, sinceAsked: performance.now() - w.at, view: m.view });
        return false;
      });
      this.pump();
    } else if (m.type === 'error') this.fail(m.message);
  }
}

// The bar at the top of the page.
export class Timeline {
  constructor(root, { onSeek }) {
    this.root = root; this.onSeek = onSeek;
    this.t = 0; this.end = 1; this.playing = false; this.speedIdx = 5; this.dragging = false; this.ready = false;
    const q = (s) => root.querySelector(s);
    this.el = {
      play: q('#play'), speed: q('#speed'), scrub: q('#scrub'), marks: q('#marks'), years: q('#years'),
      clock: q('#clock'), sub: q('#clockSub'), next: q('#milestone'),
    };
    const E = this.el;
    E.play.onclick = () => this.setPlaying(!this.playing);
    E.speed.onclick = (e) => this.setSpeed(e.shiftKey ? this.speedIdx - 1 : (this.speedIdx + 1) % SPEEDS.length);
    E.speed.oncontextmenu = (e) => { e.preventDefault(); this.setSpeed(this.speedIdx - 1); };
    q('#toStart').onclick = () => this.seek(0);
    q('#toEnd').onclick = () => this.seek(this.end);
    q('#prevDay').onclick = () => this.stepDays(-1);
    q('#nextDay').onclick = () => this.stepDays(1);
    q('#prevMonth').onclick = () => this.stepDays(-MONTH_DAYS);
    q('#nextMonth').onclick = () => this.stepDays(MONTH_DAYS);
    E.scrub.addEventListener('input', () => { this.dragging = true; this.seek(Number(E.scrub.value) * DAY, true); });
    E.scrub.addEventListener('change', () => { this.dragging = false; this.seek(Number(E.scrub.value) * DAY); });
    this.setSpeed(this.speedIdx);
    this.setEnabled(false);
  }

  setEnabled(on) {
    for (const b of this.root.querySelectorAll('button, input')) b.disabled = !on;
    this.root.classList.toggle('loading', !on);
  }

  setProgress(text) { this.el.clock.textContent = text; }

  // the finished run: length of the build and its milestones
  setRun(summary) {
    this.summary = summary;
    this.end = summary.endT;
    this.ready = true;
    const E = this.el;
    E.scrub.max = String(Math.ceil(this.end / DAY)); E.scrub.step = '1';
    // year ticks, labelled every five years
    E.years.innerHTML = '';
    for (let y = 1; y * YEAR < this.end; y++) {
      const d = document.createElement('i');
      d.style.left = `${(y * YEAR / this.end) * 100}%`;
      if (y % 5 === 0) { d.className = 'big'; d.dataset.y = y; }
      E.years.appendChild(d);
    }
    E.marks.innerHTML = '';
    for (const m of summary.milestones) {
      const b = document.createElement('button');
      b.className = `mark ${m.kind}`;
      b.style.left = `${(m.t / this.end) * 100}%`;
      b.title = `${m.label} · ${clockText(m.t)}`;
      b.setAttribute('aria-label', b.title);
      b.onclick = () => this.seek(m.t);
      E.marks.appendChild(b);
    }
    this.setEnabled(true);
  }

  setSpeed(i) {
    this.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i));
    this.el.speed.textContent = SPEEDS[this.speedIdx].label;
  }
  setPlaying(on) {
    if (on && this.t >= this.end) this.t = 0; // play from the start once at the end
    this.playing = on;
    this.el.play.textContent = on ? '❚❚' : '▶';
    this.el.play.classList.toggle('on', on);
  }
  // day steps land on the start of a day
  stepDays(n) {
    const d = Math.floor(this.t / DAY + 1e-9);
    this.seek(Math.max(0, Math.min(this.end, (d + n) * DAY)));
  }
  seek(t, fromScrub = false) {
    this.t = Math.max(0, Math.min(this.end, t));
    if (!fromScrub) this.dragging = false;
    this.onSeek(this.t);
    this.render();
  }

  tick(dt) {
    if (!this.ready || !this.playing) return;
    let t = this.t + dt * SPEEDS[this.speedIdx].k;
    if (t >= this.end) { t = this.end; this.setPlaying(false); }
    this.t = t;
    this.onSeek(t);
    this.render();
  }

  render() {
    const E = this.el, t = this.t, c = clock(t);
    if (!this.dragging) E.scrub.value = String(Math.floor(t / DAY));
    E.clock.textContent = `Year ${c.year} · ${c.season} ${c.seasonMonth}, day ${c.dom} · ${c.time}`;
    E.clock.title = `${c.season} (${c.seasonNote}), month ${c.seasonMonth} of the season. Working days only: 12 months of 25 days, 10-hour days from dawn.`;
    E.sub.textContent = `working day ${(c.day + 1).toLocaleString('en-US')} of ${Math.ceil(this.end / DAY).toLocaleString('en-US')}`;
    // the milestone just passed, or the next one
    const ms = this.summary?.milestones || [];
    const next = ms.find((m) => m.t > t + 1);
    const prev = [...ms].reverse().find((m) => m.t <= t + 1);
    let txt = '';
    if (prev && t - prev.t < 20 * DAY) txt = `✓ ${prev.label}`;
    else if (next) txt = `Next: ${next.label} in ${spanText(next.t - t)}`;
    else if (prev) txt = `✓ ${prev.label}`;
    E.next.textContent = txt;
    for (const [i, b] of [...E.marks.children].entries()) b.classList.toggle('past', ms[i] && ms[i].t <= t + 1);
  }
}
