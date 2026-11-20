// The statistics panel (Phase 3): numbers read straight from the event model at the time on
// the timeline (viewState() in sim/view.js), plus blocks per day from the run's history.
import { DAY, MONTH_DAYS } from './sim/params.js';
import { clock } from './timeline.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');
const pct = (a, b) => (b ? (100 * a) / b : 0);
const bar = (a, b) => `<span class="bar"><i style="width:${Math.min(100, pct(a, b)).toFixed(1)}%"></i></span>`;

export class StatsPanel {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <h2><button id="statsToggle" aria-expanded="true" title="Show or hide the statistics">Building site <span>▾</span></button></h2>
      <div id="statsBody">
        <div class="big" id="sBlocks">–</div>
        <div id="sBlocksBar"></div>
        <div class="dim" id="sCourse"></div>
        <h3>Blocks per working day</h3>
        <div class="row"><span id="sToday">–</span><span class="dim" id="sMean"></span></div>
        <div class="spark"><canvas id="sSpark" width="276" height="54" aria-label="Blocks set per working day, monthly mean, over the whole build"></canvas><div id="sTip"></div></div>
        <h3>Workforce</h3>
        <div class="row"><span id="sWork">–</span></div>
        <table class="gangs"><thead><tr><th></th><th>out</th><th>back</th><th>waiting</th></tr></thead><tbody id="sGangs"></tbody></table>
        <h3>Stocks</h3>
        <div id="sStocks"></div>
        <h3>Longest queues now</h3>
        <table class="queues"><thead><tr><th></th><th title="waiting now">wait</th><th title="servers in use / capacity">use</th><th title="longest queue so far">max</th></tr></thead><tbody id="sQueues"></tbody></table>
        <div class="foot" id="sSeek"></div>
      </div>`;
    const q = (id) => root.querySelector(`#${id}`);
    this.el = { blocks: q('sBlocks'), blocksBar: q('sBlocksBar'), course: q('sCourse'), today: q('sToday'), mean: q('sMean'), spark: q('sSpark'), tip: q('sTip'),
      work: q('sWork'), gangs: q('sGangs'), stocks: q('sStocks'), queues: q('sQueues'), seek: q('sSeek'), body: q('statsBody'), toggle: q('statsToggle') };
    this.el.toggle.onclick = () => this.setOpen(this.el.body.hidden);
    if (matchMedia('(max-width: 640px)').matches) this.setOpen(false);
    this.view = null;
    this.onMove = (e) => this.hover(e);
    this.onLeave = () => { this.el.tip.style.display = 'none'; };
    this.el.spark.addEventListener('mousemove', this.onMove);
    this.el.spark.addEventListener('mouseleave', this.onLeave);
  }

  destroy() {
    this.el.spark.removeEventListener('mousemove', this.onMove);
    this.el.spark.removeEventListener('mouseleave', this.onLeave);
    this.el.toggle.onclick = null;
    this.root.innerHTML = '';
  }

  setOpen(on) {
    this.el.body.hidden = !on;
    this.el.toggle.setAttribute('aria-expanded', String(on));
    this.el.toggle.querySelector('span').textContent = on ? '▾' : '▸';
  }

  setRun(summary) {
    this.summary = summary;
    // monthly mean of blocks per working day, for the sparkline
    const by = summary.blocksByDay, n = Math.ceil(by.length / MONTH_DAYS);
    this.monthly = new Float32Array(n);
    for (let m = 0; m < n; m++) {
      let s = 0, k = 0;
      for (let d = m * MONTH_DAYS; d < Math.min(by.length, (m + 1) * MONTH_DAYS); d++, k++) s += by[d];
      this.monthly[m] = k ? s / k : 0;
    }
    this.peak = Math.max(...this.monthly);
  }

  drawSpark(t) {
    const cv = this.el.spark, g = cv.getContext('2d'), W = cv.width, H = cv.height, M = this.monthly;
    if (!M) return;
    const css = getComputedStyle(this.root), gold = css.getPropertyValue('--gold').trim() || '#e9b949';
    const top = 6, bot = H - 2, y = (v) => bot - (v / this.peak) * (bot - top), x = (m) => (m / (M.length - 1)) * (W - 1);
    g.clearRect(0, 0, W, H);
    // recessive baseline and peak guide
    g.strokeStyle = 'rgba(251,243,226,0.14)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, bot + 0.5); g.lineTo(W, bot + 0.5); g.moveTo(0, top + 0.5); g.lineTo(W, top + 0.5); g.stroke();
    g.beginPath(); g.moveTo(x(0), bot);
    for (let m = 0; m < M.length; m++) g.lineTo(x(m), y(M[m]));
    g.lineTo(x(M.length - 1), bot); g.closePath();
    g.fillStyle = 'rgba(233,185,73,0.18)'; g.fill();
    g.beginPath();
    for (let m = 0; m < M.length; m++) (m ? g.lineTo : g.moveTo).call(g, x(m), y(M[m]));
    g.strokeStyle = gold; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    // now
    const cx = (t / this.summary.endT) * (W - 1);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.round(cx) + 0.5, 0); g.lineTo(Math.round(cx) + 0.5, H); g.stroke();
    g.fillStyle = 'rgba(251,243,226,0.6)'; g.font = '10px ui-monospace, Menlo, monospace'; g.textBaseline = 'top';
    g.fillText(`${fmt(this.peak)}/day`, 2, 0);
  }

  hover(e) {
    if (!this.monthly) return;
    const r = this.el.spark.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const m = Math.round(f * (this.monthly.length - 1)), c = clock(m * MONTH_DAYS * DAY);
    const tip = this.el.tip;
    tip.textContent = `Year ${c.year}, month ${c.month}: ${fmt(this.monthly[m])} blocks/day`;
    tip.style.display = 'block';
    tip.style.left = `${Math.min(r.width - 150, Math.max(0, e.clientX - r.left - 75))}px`;
  }

  update(view, t, timing) {
    this.view = view;
    const E = this.el, S = this.summary;
    if (!S || !view) return;
    E.blocks.textContent = `${fmt(view.blocksSet)} of ${fmt(S.blocks)} blocks`;
    E.blocksBar.innerHTML = bar(view.blocksSet, S.blocks);
    if (view.done) E.course.textContent = `All ${S.courses - 1} courses set, the capstone on top`;
    else if (view.course) {
      const c = view.course, last = c.ci === S.courses - 1;
      E.course.textContent = `${last ? 'Capstone' : `Course ${c.ci + 1} of ${S.courses - 1}`} · ${fmt(c.total - c.left)} of ${fmt(c.total)} set · ${view.topY.toFixed(1)} m built`;
    }
    const d = Math.min(view.day, S.blocksByDay.length - 1);
    E.today.textContent = `${fmt(S.blocksByDay[d] || 0)} this day`;
    let s = 0, k = 0;
    for (let i = Math.max(0, d - MONTH_DAYS); i < d; i++, k++) s += S.blocksByDay[i];
    E.mean.textContent = k ? `${fmt(s / k)} mean of the last ${k} days` : '';
    this.drawSpark(t);

    const G = view.gangs;
    E.work.textContent = `about ${fmt(view.workforce)} people on site`;
    const row = (name, a, title) => `<tr title="${title}"><th>${name}</th><td>${a[1]}</td><td>${a[2]}</td><td>${a[0]}</td></tr>`;
    E.gangs.innerHTML = row('Quarry sleds', G.giza, 'Sled gangs on the Giza quarry run') + row('Casing sleds', G.tura, 'Sled gangs on the harbour run (Tura casing)') + row('Heavy gangs', G.heavy, 'Big gangs for granite and roof beams');

    const Q = view.quarry, H = view.harbour;
    E.stocks.innerHTML = `
      <div class="stock"><span>Quarry yard</span>${bar(Q.stock, Q.cap)}<b>${fmt(Q.stock)}</b></div>
      <div class="dim sub">${Q.facesCutting} of ${Q.faces} faces cutting${Q.facesFull ? ` · ${Q.facesFull} stopped, yard full` : ''}${Q.facesDone ? ` · ${Q.facesDone} finished` : ''}</div>
      <div class="stock"><span>Casing on the quay</span>${bar(H.tura, H.cap)}<b>${fmt(H.tura)}</b></div>
      <div class="dim sub">${H.boatsLoaded} of ${H.boats} boats loaded on the river · granite on the quay: ${fmt(H.granite)}</div>`;

    E.queues.innerHTML = view.queues.slice(0, 5).map((r) =>
      `<tr class="${r.waiting ? 'hot' : ''}"><th title="${r.name}">${r.name}</th><td>${r.waiting}</td><td>${r.inUse}/${r.cap}</td><td>${r.maxQ}</td></tr>`).join('') +
      `<tr class="dim"><th>All ${view.landings} sector landings</th><td>${view.landingWaiting}</td><td></td><td></td></tr>`;
    if (timing) E.seek.textContent = `seek ${timing.ms.toFixed(1)} ms in the worker · ${timing.roundTrip.toFixed(0)} ms round trip · ${fmt(view.events)} events so far`;
  }
}
