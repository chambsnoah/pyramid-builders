// The event model of the whole building site: every gang, boat and block as timed events
// across the twenty years. Nothing is evaluated between events, so the full build is a few
// million events rather than billions of ticks. No three.js, no DOM: it runs in Node or a
// worker.
//
// Time is working time in seconds: a working day is DAY (10 h) and a year YEAR_DAYS
// (300) days. Nights, rest days and the flood calendar are Phase 6.
//
// All mutable state lives in one plain object, `S` (numbers, typed arrays, arrays and plain
// objects), so a snapshot is a copy of it and restoring one continues exactly the same
// build. Everything derived only from the course index (course plans, ramp layouts, roads)
// is rebuilt on demand and kept outside S.
//
// Flow of an ordinary block:
//   quarry face cuts it ─▶ yard stock ─▶ a sled gang waiting at the quarry takes it,
//   reserving a cell in a sector of the course being laid (or the next one) ─▶ loading bay
//   ─▶ road to the foot of the ramp serving that sector ─▶ ramp lanes (FIFO with headway;
//   zigzags also turn at each switchback) ─▶ across the course to the sector landing ─▶
//   landing berth (unload) ─▶ sector stock ─▶ a setting crew sets it farthest-first ─▶
//   gang walks back.
// Casing blocks do the same from the harbour, after boats from Tura unload them.
// Heavy items (granite lining, roof beams, the capstone) go with heavy gangs that take the
// whole width of each ramp they climb.
import { COURSES } from '../data.js';
import { makeRng, jitter } from './rng.js';
import { makeQueue, push, pop, packQueue, unpackQueue } from './queue.js';
import { makeResource, acquire, acquireAll, resourceStats } from './resource.js';
import { roadNetwork } from './roads.js';
import { createTheory } from './ramps/index.js';
import { calibrateCell, summarize, buildPlan, dressOf, ELEM } from './planner.js';
import { DAY, YEAR, withDefaults } from './params.js';

export const LAST = COURSES.length - 1; // the pyramidion
export const MASONRY = LAST; // courses 0 … LAST-1

// event types
const CUT = 1, AT_FOOT = 2, UNLOADED = 3, AT_SOURCE = 4, SET_DONE = 5, BOAT_DEPART = 6, BOAT_ARRIVE = 7, BOAT_UNLOADED = 8,
  HEAVY_AT_FOOT = 9, HEAVY_SET = 10, HEAVY_HOME = 11, CONVOY = 12, CONVOY_UNLOADED = 13;

// gang kinds and tasks
export const GIZA = 0, TURA = 1, HEAVY = 2;
export const TASK = { WAITING: 0, OUT: 1, RETURNING: 2 };
// per-gang timeline of the current trip (seconds), read by the detail bubble (sim/gangs.js)
// to place each gang along its route. ARR1 / ENT1: arrival at the top of the first ramp
// segment and entry onto the second (the zigzag), so the wait between them is known; with a
// single segment both equal TOP. These two are written only for drawing: no event or random
// draw depends on them, so they leave the build (and its hash) unchanged.
export const T = { START: 0, DEPART: 1, FOOT: 2, CLIMB: 3, TOP: 4, LAND: 5, UNLOAD: 6, DONE: 7, HOME: 8, WAIT: 9, ARR1: 10, ENT1: 11 };
export const NT = 12;

const SEC_BITS = 1024; // event arg a = course × SEC_BITS + sector

export function createModel(overrides = {}) {
  const P = withDefaults(overrides);
  const side = calibrateCell(P.targetBlocks);
  const summary = summarize(side, P.density);
  const theory = createTheory(P.ramp);
  const ctx = {
    P, side, theory, summary,
    gizaTotal: summary.totals.giza, turaTotal: summary.totals.tura, graniteTotal: summary.totals.granite,
    elemTotal: summary.elemTotal,
    plans: new Map(),
    hq: roadNetwork([P.harbour.at], [P.quarry.at]).dist[0][0], // harbour ↔ quarry
  };

  let S = null;
  const hist = { blocksByDay: new Uint32Array(40 * 300) }; // blocks set per working day (append-only history)
  const out = { t: 0, type: 0, a: 0, b: 0 };
  const jit = () => jitter(S.rng, P.jitter);

  // ---- derived, per course ----------------------------------------------------------
  function plan(ci) {
    let p = ctx.plans.get(ci);
    if (p) return p;
    const layout = theory.layout(ci);
    p = buildPlan(ci, side, P.density, P.sectorM, layout);
    p.layout = layout;
    const feet = layout.routes.map((r) => r.foot);
    const net = roadNetwork([P.quarry.at, P.harbour.at], feet);
    p.road = { q: net.dist[0], h: net.dist[1], qPath: net.path[0], hPath: net.path[1] };
    p.rampLen = layout.routes.map((r) => r.segs.reduce((a, s) => a + s.length, 0));
    ctx.plans.set(ci, p);
    return p;
  }
  const lane = (seg) => (S.lanes[seg.res] ||= makeResource(`ramp lane ${seg.res}`, seg.lanes));

  // ---- state ------------------------------------------------------------------------
  function init() {
    const G = P.haul.gangs + P.tura.gangs + P.heavy.gangs;
    S = {
      t: 0, ev: 0, rng: makeRng(P.seed), Q: makeQueue(), done: false,
      cur: 0, look: Math.min(1, LAST), rt: {},
      blocksSet: 0,
      quarry: { stock: 0, cut: 0, cutting: 0, idle: new Uint8Array(P.quarry.faces), capIdle: [], wait: [], bays: makeResource('quarry loading bays', P.quarry.bays), waitMax: 0, waitSum: 0, waitN: 0 },
      harbour: { tura: 0, shipped: 0, delivered: 0, granite: 0, graniteShipped: 0, graniteDelivered: 0, starveSince: -1, starved: 0, wait: [],
        berths: makeResource('harbour berths', P.harbour.berths), bays: makeResource('harbour loading bays', P.harbour.bays), boatLoad: new Int32Array(P.tura.boats), waitMax: 0, waitSum: 0, waitN: 0 },
      gang: { kind: new Uint8Array(G), task: new Uint8Array(G), course: new Int32Array(G).fill(-1), sector: new Int32Array(G).fill(-1), route: new Int8Array(G).fill(-1), trips: new Int32Array(G), t: new Float64Array(G * NT) },
      heavyIdle: [],
      lanes: {},
      landing: { served: 0, waitSum: 0, waitMax: 0, maxQ: 0, maxQCourse: -1, maxQT: 0 },
      courseOpen: new Float64Array(LAST + 1).fill(-1), courseDone: new Float64Array(LAST + 1).fill(-1),
      elemSet: new Int32Array(ELEM.length + 1), elemDone: new Float64Array(ELEM.length + 1).fill(-1),
    };
    let g = 0;
    for (let i = 0; i < P.haul.gangs; i++, g++) { S.gang.kind[g] = GIZA; S.quarry.wait.push(g); }
    for (let i = 0; i < P.tura.gangs; i++, g++) { S.gang.kind[g] = TURA; S.harbour.wait.push(g); }
    for (let i = 0; i < P.heavy.gangs; i++, g++) { S.gang.kind[g] = HEAVY; S.heavyIdle.push(g); }
    ensureRt(0); ensureRt(S.look);
    for (let f = 0; f < P.quarry.faces; f++) nextCut(f);
    for (let b = 0; b < P.tura.boats; b++) push(S.Q, (b * P.tura.tripDays * DAY) / P.tura.boats, BOAT_DEPART, b);
    push(S.Q, P.granite.convoyDay * DAY, CONVOY);
    openCourse(0);
  }

  // runtime of a course that is open for hauling (the current one and the next)
  function ensureRt(ci) {
    if (S.rt[ci]) return S.rt[ci];
    const p = plan(ci), n = p.sectors.length, I = () => new Int32Array(n);
    const rt = {
      ci, open: false, nSec: n,
      gTot: Int32Array.from(p.sectors, (s) => s.giza.length), tTot: Int32Array.from(p.sectors, (s) => s.tura.length),
      gRes: I(), tRes: I(), gStock: I(), tStock: I(), gClaim: I(), tClaim: I(), gSet: I(), tSet: I(), busy: I(),
      land: p.sectors.map((s) => makeResource(`landing c${ci}s${s.id}`, P.landing.berths)),
      heavyState: new Uint8Array(p.heavy.length), heavyLeft: p.heavy.length,
      setLeft: p.sectors.reduce((a, s) => a + s.giza.length + s.tura.length, 0),
    };
    rt.gFree = rt.gTot.reduce((a, b) => a + b, 0); rt.tFree = rt.tTot.reduce((a, b) => a + b, 0);
    S.rt[ci] = rt;
    return rt;
  }

  function openCourse(ci) {
    const rt = ensureRt(ci);
    rt.open = true; S.courseOpen[ci] = S.t;
    for (let s = 0; s < rt.nSec; s++) trySet(ci, s);
    serveQuarry(); serveHarbour(); dispatchHeavy();
    if (rt.setLeft === 0 && rt.heavyLeft === 0) finishCourse(ci);
  }

  function finishCourse(ci) {
    const rt = S.rt[ci];
    S.courseDone[ci] = S.t;
    for (const R of rt.land) { // fold the landing queues into one statistic
      const L = S.landing;
      L.served += R.served; L.waitSum += R.waitSum; if (R.waitMax > L.waitMax) L.waitMax = R.waitMax;
      if (R.maxQ > L.maxQ) { L.maxQ = R.maxQ; L.maxQCourse = ci; L.maxQT = R.maxQT; }
    }
    delete S.rt[ci]; ctx.plans.delete(ci);
    if (ci === LAST) { S.done = true; return; }
    S.cur = ci + 1; S.look = Math.min(ci + 2, LAST);
    ensureRt(S.look);
    openCourse(S.cur);
  }

  function credit(tag) {
    if (!tag) return;
    if (++S.elemSet[tag] === ctx.elemTotal[tag]) S.elemDone[tag] = S.t;
  }
  function blockSet() {
    S.blocksSet++;
    const d = Math.floor(S.t / DAY);
    if (d < hist.blocksByDay.length) hist.blocksByDay[d]++;
  }

  // ---- quarry -------------------------------------------------------------------------
  function nextCut(f) {
    const q = S.quarry;
    if (q.cut + q.cutting >= ctx.gizaTotal) { q.idle[f] = 2; return; }
    if (q.stock + q.cutting >= P.quarry.yardCap) { q.idle[f] = 1; q.capIdle.push(f); return; }
    q.idle[f] = 0; q.cutting++;
    const p = plan(Math.min(S.cur, MASONRY - 1));
    const vol = p.cell * p.cell * p.h;
    push(S.Q, S.t + P.quarry.cutHours * 3600 * (vol / P.quarry.refVolume) * jit(), CUT, f);
  }
  function restartFaces() {
    const q = S.quarry;
    while (q.capIdle.length && q.stock + q.cutting < P.quarry.yardCap) nextCut(q.capIdle.shift());
  }

  // ---- dispatch -----------------------------------------------------------------------
  // the sector with the most unreserved blocks of this kind, in the current course or else
  // the next one; returns course × SEC_BITS + sector, or -1
  function pickTarget(kind) {
    for (const ci of [S.cur, S.look]) {
      const rt = S.rt[ci];
      if (!rt || (kind === GIZA ? rt.gFree : rt.tFree) === 0) continue;
      const tot = kind === GIZA ? rt.gTot : rt.tTot, res = kind === GIZA ? rt.gRes : rt.tRes;
      let best = -1, bv = 0;
      for (let s = 0; s < rt.nSec; s++) { const v = tot[s] - res[s]; if (v > bv) { bv = v; best = s; } }
      if (best >= 0) return ci * SEC_BITS + best;
      if (ci === S.look) break;
    }
    return -1;
  }

  function serveQuarry() {
    const q = S.quarry;
    while (q.wait.length && q.stock > 0) {
      const tg = pickTarget(GIZA);
      if (tg < 0) break;
      dispatch(q.wait.shift(), tg, q);
    }
  }
  function serveHarbour() {
    const h = S.harbour;
    while (h.wait.length && h.tura > 0) {
      const tg = pickTarget(TURA);
      if (tg < 0) break;
      dispatch(h.wait.shift(), tg, h);
    }
  }

  function dispatch(g, tg, src) {
    const G = S.gang, kind = G.kind[g], c = Math.floor(tg / SEC_BITS), s = tg % SEC_BITS;
    const rt = S.rt[c], p = plan(c), sec = p.sectors[s];
    const tb = g * NT, w = S.t - G.t[tb + T.WAIT];
    src.waitSum += w; src.waitN++; if (w > src.waitMax) src.waitMax = w;
    let road;
    if (kind === GIZA) { S.quarry.stock--; rt.gRes[s]++; rt.gFree--; restartFaces(); road = p.road.q[sec.route]; } else { S.harbour.tura--; rt.tRes[s]++; rt.tFree--; road = p.road.h[sec.route]; }
    const load = P.quarry.loadMin * 60 * jit();
    const entry = acquire(src.bays, S.t, load);
    G.task[g] = TASK.OUT; G.course[g] = c; G.sector[g] = s; G.route[g] = sec.route; G.trips[g]++;
    G.t[tb + T.START] = entry; G.t[tb + T.DEPART] = entry + load;
    G.t[tb + T.FOOT] = entry + load + road / (P.haul.vLoaded * jit());
    push(S.Q, G.t[tb + T.FOOT], AT_FOOT, g);
  }

  // ---- events -------------------------------------------------------------------------
  function atFoot(g) {
    const G = S.gang, c = G.course[g], s = G.sector[g], tb = g * NT;
    const p = plan(c), sec = p.sectors[s], route = p.layout.routes[sec.route], rt = S.rt[c];
    let t = S.t;
    const jv = jit();
    for (let i = 0; i < route.segs.length; i++) {
      const seg = route.segs[i];
      const entry = acquire(lane(seg), t, seg.headway);
      if (i === 0) G.t[tb + T.CLIMB] = entry;
      if (i === 1) G.t[tb + T.ENT1] = entry;
      t = entry + seg.length / ((P.haul.vLoaded / (1 + P.haul.climbK * seg.grade)) * jv) + seg.turns * seg.turnTime;
      if (i === 0) G.t[tb + T.ARR1] = G.t[tb + T.ENT1] = t;
    }
    G.t[tb + T.TOP] = t;
    t += sec.top / (P.haul.vLoaded * jv);
    G.t[tb + T.LAND] = t;
    const unload = P.haul.unloadMin * 60 * jit();
    const entry = acquire(rt.land[s], t, unload);
    G.t[tb + T.UNLOAD] = entry; G.t[tb + T.DONE] = entry + unload;
    push(S.Q, entry + unload, UNLOADED, g);
  }

  function unloaded(g) {
    const G = S.gang, c = G.course[g], s = G.sector[g], tb = g * NT;
    const rt = S.rt[c], p = plan(c), sec = p.sectors[s];
    if (G.kind[g] === GIZA) rt.gStock[s]++; else rt.tStock[s]++;
    trySet(c, s);
    const back = sec.top + p.rampLen[sec.route] + (G.kind[g] === GIZA ? p.road.q : p.road.h)[sec.route];
    G.task[g] = TASK.RETURNING;
    G.t[tb + T.HOME] = S.t + back / (P.haul.vEmpty * jit());
    push(S.Q, G.t[tb + T.HOME], AT_SOURCE, g);
  }

  function atSource(g) {
    const G = S.gang;
    G.task[g] = TASK.WAITING; G.course[g] = -1; G.sector[g] = -1;
    G.t[g * NT + T.WAIT] = S.t;
    if (G.kind[g] === GIZA) { S.quarry.wait.push(g); serveQuarry(); } else { S.harbour.wait.push(g); serveHarbour(); }
  }

  function trySet(c, s) {
    const rt = S.rt[c];
    if (!rt.open) return;
    const p = plan(c), sec = p.sectors[s];
    while (rt.busy[s] < P.set.crewsPerSector) {
      const gOK = rt.gStock[s] > 0, tOK = rt.tStock[s] > 0;
      if (!gOK && !tOK) break;
      // farthest-first across both kinds of stone in stock
      const kind = gOK && tOK ? (sec.gizaD[rt.gClaim[s]] >= sec.turaD[rt.tClaim[s]] ? 0 : 1) : gOK ? 0 : 1;
      let i, cell, d;
      if (kind === 0) { i = rt.gClaim[s]++; rt.gStock[s]--; cell = sec.giza[i]; d = sec.gizaD[i]; } else { i = rt.tClaim[s]++; rt.tStock[s]--; cell = sec.tura[i]; d = sec.turaD[i]; }
      rt.busy[s]++;
      const dur = (P.set.baseMin * 60 * (p.h / 0.75) * dressOf(p.elem[cell]) + d / P.set.leverSpeed) * jit();
      push(S.Q, S.t + dur, SET_DONE, c * SEC_BITS + s, (kind << 24) | i);
    }
  }

  function setDone(a, b) {
    const c = Math.floor(a / SEC_BITS), s = a % SEC_BITS, kind = b >>> 24, i = b & 0xffffff;
    const rt = S.rt[c], p = plan(c), sec = p.sectors[s];
    rt.busy[s]--; rt.setLeft--;
    if (kind === 0) rt.gSet[s]++; else rt.tSet[s]++;
    credit(p.elem[kind === 0 ? sec.giza[i] : sec.tura[i]]);
    blockSet();
    trySet(c, s);
    if (rt.setLeft === 0 && rt.heavyLeft === 0) finishCourse(c);
  }

  // ---- heavy gangs ----------------------------------------------------------------------
  function dispatchHeavy() {
    const rt = S.rt[S.cur];
    if (!rt || !rt.open) return;
    const p = plan(S.cur), h = S.harbour;
    while (S.heavyIdle.length) {
      let j = -1, starved = false;
      for (let k = 0; k < p.heavy.length; k++) {
        if (rt.heavyState[k]) continue;
        if (p.heavy[k].granite && h.granite <= 0) { starved = true; continue; }
        j = k; break;
      }
      if (j < 0) { if (starved && h.starveSince < 0) h.starveSince = S.t; return; }
      const g = S.heavyIdle.shift(), it = p.heavy[j], G = S.gang, tb = g * NT;
      rt.heavyState[j] = 1;
      let walk = 0, road;
      if (it.granite) { h.granite--; road = p.road.h[it.route]; } else { walk = ctx.hq; road = p.road.q[it.route]; }
      const load = Math.max(P.heavy.loadHoursMin, P.heavy.loadHoursPerTonne * it.mass) * 3600 * jit();
      G.task[g] = TASK.OUT; G.course[g] = S.cur; G.sector[g] = j; G.route[g] = it.route; G.trips[g]++;
      G.t[tb + T.START] = S.t + walk / P.haul.vEmpty;
      G.t[tb + T.DEPART] = G.t[tb + T.START] + load;
      G.t[tb + T.FOOT] = G.t[tb + T.DEPART] + road / (P.haul.vLoaded * P.heavy.speedFactor * jit());
      push(S.Q, G.t[tb + T.FOOT], HEAVY_AT_FOOT, g);
    }
  }

  function heavyAtFoot(g) {
    const G = S.gang, c = G.course[g], j = G.sector[g], tb = g * NT;
    const p = plan(c), it = p.heavy[j], route = p.layout.routes[it.route];
    let t = S.t;
    const jv = jit();
    for (let i = 0; i < route.segs.length; i++) {
      const seg = route.segs[i];
      const climb = seg.length / ((P.haul.vLoaded * P.heavy.speedFactor / (1 + P.haul.climbK * seg.grade)) * jv) + seg.turns * seg.turnTime * 2;
      const entry = acquireAll(lane(seg), t, climb); // the whole ramp width, for the whole climb
      if (i === 0) G.t[tb + T.CLIMB] = entry;
      if (i === 1) G.t[tb + T.ENT1] = entry;
      t = entry + climb;
      if (i === 0) G.t[tb + T.ARR1] = G.t[tb + T.ENT1] = t;
    }
    G.t[tb + T.TOP] = t;
    t += it.top / (P.haul.vLoaded * P.heavy.speedFactor * jv);
    G.t[tb + T.LAND] = G.t[tb + T.UNLOAD] = t;
    const set = Math.max(P.heavy.setHoursMin, P.heavy.setHoursPerTonne * it.mass) * 3600 * jit();
    G.t[tb + T.DONE] = t + set;
    push(S.Q, t + set, HEAVY_SET, g);
  }

  function heavySet(g) {
    const G = S.gang, c = G.course[g], j = G.sector[g], tb = g * NT;
    const rt = S.rt[c], p = plan(c), it = p.heavy[j];
    rt.heavyState[j] = 2; rt.heavyLeft--;
    credit(it.elem); blockSet();
    G.task[g] = TASK.RETURNING;
    G.t[tb + T.HOME] = S.t + (it.top + p.rampLen[it.route] + p.road.h[it.route]) / (P.haul.vEmpty * jit());
    push(S.Q, G.t[tb + T.HOME], HEAVY_HOME, g);
    if (rt.setLeft === 0 && rt.heavyLeft === 0) finishCourse(c);
  }

  // ---- boats and barges -----------------------------------------------------------------
  function boatDepart(b) { // loaded at Tura
    const h = S.harbour, left = ctx.turaTotal - h.shipped;
    if (left <= 0) return; // all the casing is shipped: the boat is released
    if (h.tura >= P.tura.stockCap) { push(S.Q, S.t + DAY, BOAT_DEPART, b); return; }
    const n = Math.min(P.tura.boatLoad, left);
    h.shipped += n; h.boatLoad[b] = n;
    push(S.Q, S.t + (P.tura.tripDays * DAY * jit()) / 2, BOAT_ARRIVE, b);
  }
  function boatArrive(b) {
    const hold = S.harbour.boatLoad[b] * P.tura.unloadMinPerBlock * 60;
    push(S.Q, acquire(S.harbour.berths, S.t, hold) + hold, BOAT_UNLOADED, b);
  }
  function boatUnloaded(b) {
    const h = S.harbour, n = h.boatLoad[b];
    h.tura += n; h.delivered += n; h.boatLoad[b] = 0;
    serveHarbour();
    push(S.Q, S.t + (P.tura.tripDays * DAY * jit()) / 2, BOAT_DEPART, b);
  }
  function convoy() {
    const h = S.harbour, n = Math.min(P.granite.perConvoy, ctx.graniteTotal - h.graniteShipped);
    if (n <= 0) return;
    h.graniteShipped += n;
    push(S.Q, S.t + P.granite.unloadDays * DAY, CONVOY_UNLOADED, n);
    if (h.graniteShipped < ctx.graniteTotal) push(S.Q, S.t + YEAR, CONVOY);
  }
  function convoyUnloaded(n) {
    const h = S.harbour;
    h.granite += n; h.graniteDelivered += n;
    if (h.starveSince >= 0) { h.starved += S.t - h.starveSince; h.starveSince = -1; }
    dispatchHeavy();
  }

  function handle(e) {
    switch (e.type) {
      case CUT: { const q = S.quarry; q.cutting--; q.stock++; q.cut++; nextCut(e.a); serveQuarry(); break; }
      case AT_FOOT: atFoot(e.a); break;
      case UNLOADED: unloaded(e.a); break;
      case AT_SOURCE: atSource(e.a); break;
      case SET_DONE: setDone(e.a, e.b); break;
      case BOAT_DEPART: boatDepart(e.a); break;
      case BOAT_ARRIVE: boatArrive(e.a); break;
      case BOAT_UNLOADED: boatUnloaded(e.a); break;
      case HEAVY_AT_FOOT: heavyAtFoot(e.a); break;
      case HEAVY_SET: heavySet(e.a); break;
      case HEAVY_HOME: S.heavyIdle.push(e.a); S.gang.task[e.a] = TASK.WAITING; S.gang.course[e.a] = -1; dispatchHeavy(); break;
      case CONVOY: convoy(); break;
      case CONVOY_UNLOADED: convoyUnloaded(e.a); break;
      default: throw new Error(`unknown event ${e.type}`);
    }
  }

  // ---- running ------------------------------------------------------------------------
  // process every event up to and including time `until`; the clock then reads `until`
  function runUntil(until) {
    const Q = S.Q;
    while (!S.done && Q.n && Q.t[0] <= until) {
      pop(Q, out);
      S.t = out.t; S.ev++;
      handle(out);
    }
    if (!S.done) {
      if (!Q.n) throw new Error(`event queue ran dry at t=${S.t} on course ${S.cur}: the model is stuck`);
      S.t = until;
    }
    return S.done;
  }

  // ---- snapshots and checks -----------------------------------------------------------
  function snapshot() {
    const { Q, ...rest } = S;
    return structuredClone({ ...rest, Q: packQueue(Q) });
  }
  function restore(snap) {
    const s = structuredClone(snap);
    s.Q = unpackQueue(s.Q);
    S = s;
    ctx.plans.clear();
  }

  // FNV-1a over the bytes of everything that records how the build went
  function hash() {
    const nums = [S.t, S.ev, S.blocksSet, S.rng.s, S.cur, S.quarry.cut, S.quarry.stock, S.harbour.delivered, S.harbour.graniteDelivered, S.harbour.starved,
      S.landing.served, S.landing.waitSum, S.landing.maxQ, S.quarry.waitSum, S.harbour.waitSum];
    const res = [S.quarry.bays, S.harbour.berths, S.harbour.bays, ...Object.keys(S.lanes).sort().map((k) => S.lanes[k])];
    for (const R of res) nums.push(R.served, R.waitSum, R.maxQ, R.busy);
    const arrays = [new Float64Array(nums), S.courseOpen, S.courseDone, S.elemDone, new Float64Array(S.elemSet), new Float64Array(S.gang.trips)];
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    for (const a of arrays) {
      const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      for (let i = 0; i < u8.length; i++) { h1 = Math.imul(h1 ^ u8[i], 0x01000193); h2 = Math.imul(h2 ^ u8[i], 0x01000197); }
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  // people on site right now (gangs and crews, ramp builders, and support as a share)
  function workforce() {
    const rt = S.rt[S.cur], sectors = rt ? rt.nSec : 0;
    const direct = P.quarry.faces * P.quarry.crew + (P.haul.gangs + P.tura.gangs) * P.haul.crew + P.heavy.gangs * P.heavy.crew +
      sectors * P.set.crewsPerSector * P.set.crew + P.tura.boats * P.tura.boatCrew + P.workforce.rampCrew;
    return Math.round(direct * (1 + P.workforce.supportFactor));
  }

  function resources() {
    const L = S.landing;
    const landing = { name: 'sector landings (all courses)', cap: P.landing.berths, served: L.served, meanWait: L.served ? L.waitSum / L.served : 0, maxWait: L.waitMax, maxQueue: L.maxQ, maxQueueAt: L.maxQT, course: L.maxQCourse };
    const q = S.quarry, h = S.harbour;
    return [
      resourceStats(q.bays), resourceStats(h.berths), resourceStats(h.bays),
      ...Object.keys(S.lanes).sort().map((k) => resourceStats(S.lanes[k])), landing,
      { name: 'gangs waiting at the quarry (stone or work)', served: q.waitN, meanWait: q.waitN ? q.waitSum / q.waitN : 0, maxWait: q.waitMax },
      { name: 'gangs waiting at the harbour (casing or work)', served: h.waitN, meanWait: h.waitN ? h.waitSum / h.waitN : 0, maxWait: h.waitMax },
    ];
  }

  init();
  return {
    P, ctx, hist, LAST,
    get state() { return S; },
    get done() { return S.done; },
    get t() { return S.t; },
    runUntil, snapshot, restore, hash, workforce, resources, plan,
    builtCourses: () => (S.done ? LAST + 1 : S.cur), // courses complete (index of the one being laid)
  };
}
