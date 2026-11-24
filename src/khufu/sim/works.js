// The special works (Phase 5) that are not laid course by course: the tunnel cut down into
// the bedrock to the subterranean chamber (left unfinished), and the granite plugs of the
// ascending passage. Plus the order in which every room is built, as times read from the
// finished run, for the milestones and for scripts/khufu-works.mjs.
//
// The rooms in the masonry (Queen's Chamber, Grand Gallery and its corbels, antechamber,
// King's Chamber and its beams, relieving chambers, shafts) are built by the event model
// itself: their linings and roof beams are cells and heavy items of the courses they pass
// through (planner.js), set by setting crews and heavy gangs. What is here comes on top of
// the model, as a schedule computed from its run, so the model and its hash are unchanged:
//  - Tunnelling. One crew at the face cuts the descending passage down from where it meets
//    the bedrock, then the horizontal passage, the chamber and the blind passage south of it.
//    The work stops, unfinished as it is at Giza, when the plan moves up into the masonry: the
//    day the course where the ascending passage begins is opened. The cutting rate is set so
//    the cut reaches exactly the state in data.js by then (each stretch at its own relative
//    rate: the wide chamber goes slower per metre than a passage); khufu:works checks that the
//    rate this implies is a plausible one.
//  - Plugs. Three granite plugs, too wide for the lower end of the ascending passage, are
//    lowered into the foot of the Grand Gallery while its lower walls stand open to the sky,
//    and rest there on the floor of its central channel. They are slid down into the
//    ascending passage at the end of the build. (At Giza that happened after the burial,
//    which is after the time the timeline covers; here it is the last thing before the end.)
// No three.js, no DOM: this runs in the worker, in the page and in Node.
import { COURSES, ELEMENTS, LEVELS, floorY, ceilY, courseAt } from '../data.js';
import { DAY } from './params.js';

const D = Math.PI / 180;
const el = (id) => ELEMENTS.find((e) => e.id === id);
const DESC = el('descending').voids[0];
const [HPASS, CHAMBER, BLIND] = el('subterranean').voids;
const ASC = el('ascending').voids[0];
const ASC_TAN = ASC.floor[1], GAL_TAN = Math.tan(26.27 * D);
const GAL_FOOT = LEVELS.galleryFoot; // { z, y }: where the ascending passage meets the gallery

// ---- tunnelling ------------------------------------------------------------------------
// The face advances south (z grows) through four stretches. Each has a relative pace (metres
// of z per unit of effort): a passage 1.05 × 1.2 m goes about 4× as fast as the 14 m wide
// chamber, which was cut as a broad heading from its roof down.
const Z_ROCK = (() => { // where the descending passage's roof enters the bedrock (y = 0)
  const [a, b] = DESC.ceil[0];
  return -a / b;
})();
export const TUNNEL = [
  { id: 'descending', name: 'descending passage', v: DESC, z0: Z_ROCK, z1: LEVELS.descendingBottom.z, pace: 1 },
  { id: 'subterranean', name: 'horizontal passage', v: HPASS, z0: HPASS.z0 + 0.05, z1: HPASS.z1, pace: 1.1 },
  // (neighbouring voids overlap a little: each stretch starts where the one before ended)
  { id: 'subterranean', name: 'subterranean chamber', v: CHAMBER, z0: HPASS.z1, z1: CHAMBER.z1, pace: 0.25 },
  { id: 'subterranean', name: 'blind passage', v: BLIND, z0: CHAMBER.z1, z1: BLIND.z1, pace: 1.1 },
];
// passage length along the floor per metre of z (the descending passage slopes)
const along = (st) => Math.hypot(1, st.v.floor[1]);

// ---- plugs -----------------------------------------------------------------------------
// Three plugs of red granite, 1.05 × 1.2 m in section, about 1.6 m long (Petrie found the
// lowest three still in place; their lengths are rounded here).
export const PLUGS = [{ len: 1.57 }, { len: 1.57 }, { len: 1.68 }];
const PLUG_W = 1.04, PLUG_H = 1.18, PLUG_GAP = 0.04;
export const PLUG_SIZE = [PLUG_W, PLUG_H];
const STORE_AT = 2.0; // metres up the gallery floor from its foot to the lowest plug's lower end
// arc position d along the plug slide line: d > 0 up the gallery floor from its foot,
// d < 0 down the ascending passage. Returns [z, y of the floor, slope tangent]
function slideAt(d) {
  const tn = d >= 0 ? GAL_TAN : ASC_TAN, c = 1 / Math.hypot(1, tn);
  return [GAL_FOOT.z + d * c, GAL_FOOT.y + d * c * tn, tn];
}
// where the lowest plug ends up: its lower end at the bottom of the ascending passage
const ASC_LOW = -(GAL_FOOT.z - LEVELS.ascendingStartZ) * Math.hypot(1, ASC_TAN);
const PLUG_X = (ASC.x0 + ASC.x1) / 2;
const SLIDE_V = 0.4; // m/s, a controlled slide on a wetted bed, checked by ropes
const SLIDE_GAP = 120; // s between one plug and the next

// The whole schedule, from the run's summary (courseOpen, courseDone, elemDone, endT, elem).
export function worksSchedule(sum) {
  const E = (id) => sum.elemDone[sum.elem.indexOf(id) + 1];
  const courseOf = (y) => courseAt(y).n - 1;
  // tunnelling: from the first day until the course where the ascending passage begins opens
  const ascCourse = courseOf(LEVELS.ascendingStartY);
  const stop = sum.courseOpen[ascCourse];
  const effort = TUNNEL.map((st) => (st.z1 - st.z0) / st.pace);
  const total = effort.reduce((a, b) => a + b, 0);
  let t = 0;
  const stages = TUNNEL.map((st, i) => {
    const dur = (stop * effort[i]) / total, s = { ...st, v: undefined, t0: t, t1: t + dur, mPerDay: ((st.z1 - st.z0) * along(st)) / (dur / DAY) };
    t += dur;
    return s;
  });
  stages[stages.length - 1].t1 = stop;

  // plugs: lowered in once the gallery's lower walls stand around their place, one at a time
  const top = STORE_AT + PLUGS.reduce((a, p) => a + p.len + PLUG_GAP, 0);
  const [, yWalls] = slideAt(top), wallsCourse = courseOf(yWalls + 2.29);
  const storeT = sum.courseDone[wallsCourse];
  const [, yRoof] = slideAt(STORE_AT);
  const roofCourse = courseOf(yRoof + 8.6); // the gallery roof first closes over the plugs
  const lower = PLUGS.map((_, k) => [storeT + k * 1800, storeT + k * 1800 + 1500]); // half an hour each
  // the slide: plug by plug, the lowest first, ending an hour before the end of the build
  const dist = STORE_AT - ASC_LOW; // every plug moves the same distance
  const slideDur = dist / SLIDE_V;
  const slide0 = sum.endT - 3600 - (PLUGS.length - 1) * SLIDE_GAP - slideDur;
  const slide = PLUGS.map((_, k) => [slide0 + k * SLIDE_GAP, slide0 + k * SLIDE_GAP + slideDur]);

  // relieving chambers: each is roofed when the course over its top is finished
  const relieving = el('relieving').voids.map((v, i) => {
    const yTop = Math.max(ceilY(v, v.z0), ceilY(v, v.z1), ceilY(v, (v.z0 + v.z1) / 2));
    const c = COURSES.findIndex((co) => co.y0 >= yTop - 1e-6);
    return { i, yTop, course: c, t: sum.courseDone[c] };
  });

  // the order of the special works, earliest first
  const order = [
    { id: 'tunnel-start', label: 'Tunnelling begins: descending passage into the bedrock', t: 0 },
    { id: 'descending-rock', label: 'Descending passage cut to the bottom', t: stages[0].t1 },
    { id: 'subterranean-stop', label: 'Subterranean chamber left unfinished', t: stop },
    { id: 'ascending-start', label: 'Ascending passage begun', t: sum.courseOpen[ascCourse] },
    { id: 'descending', label: 'Descending passage complete', t: E('descending') },
    { id: 'ascending', label: 'Ascending passage complete', t: E('ascending') },
    { id: 'queen', label: "Queen's Chamber roofed", t: E('queen') },
    { id: 'plugs-stored', label: 'Granite plugs lowered into the Grand Gallery', t: lower[lower.length - 1][1] },
    { id: 'gallery-roof-over-plugs', label: 'Gallery roofed over the plugs', t: sum.courseDone[roofCourse] },
    { id: 'antechamber', label: 'Antechamber complete', t: E('antechamber') },
    { id: 'king', label: "King's Chamber roofed", t: E('king') },
    { id: 'gallery', label: 'Grand Gallery complete', t: E('gallery') },
    ...relieving.map((r) => ({ id: `relieving-${r.i + 1}`, label: `Relieving chamber ${r.i + 1} roofed`, t: r.t })),
    { id: 'queen-shafts', label: "Queen's Chamber shafts complete", t: E('queen-shafts') },
    { id: 'king-shafts', label: "King's Chamber shafts complete", t: E('king-shafts') },
    { id: 'plugged', label: 'Ascending passage plugged', t: slide[slide.length - 1][1] },
    { id: 'pyramidion', label: 'Capstone set', t: E('pyramidion') },
  ].sort((a, b) => a.t - b.t);
  return { stages, stop, ascCourse, plugs: { lower, slide, storeT, wallsCourse, roofCourse, ASC_LOW }, relieving, order };
}

// Where the tunnelling stands at time t: the face of the descending passage (desc) and of
// the subterranean works (sub), as z (−Infinity: not begun, Infinity: no clipping), the
// stage being cut (−1 when none) and the rock face to draw: { x0, x1, y0, y1, z } or null.
export function tunnelAt(W, t) {
  const st = W.stages;
  const out = { desc: -Infinity, sub: -Infinity, stage: -1, face: null };
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (t < s.t0) break;
    const k = Math.min(1, (t - s.t0) / Math.max(1e-9, s.t1 - s.t0));
    const z = s.z0 + (s.z1 - s.z0) * k;
    if (s.id === 'descending') out.desc = k >= 1 ? Infinity : z;
    else out.sub = z;
    if (k < 1) out.stage = i;
  }
  if (out.desc === Infinity && t >= W.stop) out.sub = Infinity;
  if (out.stage >= 0) {
    const s = TUNNEL[out.stage], z = s.id === 'descending' ? out.desc : out.sub, v = s.v;
    out.face = { x0: v.x0, x1: v.x1, y0: floorY(v, z), y1: ceilY(v, z), z };
  }
  return out;
}

// The tunnellers at time t: up to MAX_DIGGERS figures, each [x, y, z, yaw, pose] with pose
// 0 kneeling at the face (cutting), 1 walking with a basket of spoil, 2 hidden. Diggers work
// at the face; spoil carriers walk between it and the mouth of the cut, on the passage floor.
export const MAX_DIGGERS = 7;
const CARRY_PERIOD = 360; // s for a carrier to go down to the face and back
// the chamber is cut to its floor east of here (west of it stand the uncut terraces, the
// `solids` of the subterranean chamber in data.js)
const CUT_X0 = Math.max(...el('subterranean').solids.map((s) => s.x1));
export function diggersAt(W, t, out) {
  const tn = tunnelAt(W, t);
  for (let i = 0; i < MAX_DIGGERS; i++) out[i * 5 + 4] = 2;
  if (!tn.face) return 0;
  const f = tn.face, wide = f.x1 - f.x0 > 2 && f.z > CHAMBER.z0 + 1;
  // diggers (figures 0–2): one at a passage face; across the chamber heading, three, where
  // it is cut down to the floor (the east part: west of CUT_X0 the rock was never cut below
  // the roof terraces). The first stays on the passage axis, so it never jumps.
  // (across the chamber the first works its way over from the passage axis to the blind
  // passage, which leaves the chamber farther west, east of the rock ledge in front of it)
  for (let i = 0; i < (wide ? 3 : 1); i++) {
    const x = i === 0 ? cutX(f.z) : [6.0, 4.4][i - 1];
    const o = i * 5, z = f.z - 0.7;
    out[o] = x; out[o + 1] = floorAt(z); out[o + 2] = z; out[o + 3] = 0; out[o + 4] = 0;
  }
  // spoil carriers (figures 3–6) along the cut from its mouth (at the bedrock surface) to the face
  const pts = cutLine(tn);
  const L = pts.cum[pts.cum.length - 1], nc = MAX_DIGGERS - 3;
  for (let j = 0; j < nc; j++) {
    const ph = (t / CARRY_PERIOD + j / nc) % 1, down = ph < 0.5;
    const s = Math.max(0, L - 1.6) * (down ? ph * 2 : 2 - ph * 2); // 0 at the mouth
    const p = pts.at(s), o = (3 + j) * 5;
    out[o] = p[0] + (j % 2 ? 0.1 : -0.1); out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = down ? 0 : Math.PI; out[o + 4] = 1;
  }
  return MAX_DIGGERS;
}
// the floor of the cut at z (the descending passage, then the level works below it)
function floorAt(z) { return z <= LEVELS.descendingBottom.z ? Math.max(floorY(DESC, z), LEVELS.descendingBottom.y) : HPASS.floor[0]; }
// x of the way through the cut at z: the passage axis, then across the chamber floor it
// works over toward the blind passage (east of the rock ledge in front of it), reaching it
// at the corner where the way turns into that passage. The face end of the way and the
// corner move together, so the way only ever lengthens a little at a time.
const X_AXIS = (DESC.x0 + DESC.x1) / 2, X_BLIND = BLIND.x1 - 0.12;
const Z_ACROSS0 = CHAMBER.z0 + 1, Z_ACROSS1 = CHAMBER.z1 - 0.5;
function cutX(z) { return X_AXIS + (X_BLIND - X_AXIS) * Math.min(1, Math.max(0, (z - Z_ACROSS0) / (Z_ACROSS1 - Z_ACROSS0))); }
// polyline along the floor of the cut from its mouth to the face, with arc lengths
function cutLine(tn) {
  const x = (DESC.x0 + DESC.x1) / 2, p = [[x, floorAt(Z_ROCK), Z_ROCK]];
  const zEnd = tn.desc < Infinity ? tn.desc : tn.sub;
  const zb = LEVELS.descendingBottom.z;
  if (zEnd > zb) {
    p.push([x, floorAt(zb), zb]);
    // across the chamber floor to the blind passage, east of the rock ledge in front of it
    if (zEnd > CHAMBER.z0 + 1) p.push([x, floorAt(CHAMBER.z0 + 1), CHAMBER.z0 + 1]);
    if (zEnd > CHAMBER.z1 - 0.5) p.push([cutX(CHAMBER.z1 - 0.5), floorAt(CHAMBER.z1 - 0.5), CHAMBER.z1 - 0.5]);
  }
  p.push([cutX(zEnd), floorAt(zEnd), zEnd]);
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]));
  return {
    cum,
    at(s) {
      let i = 1;
      while (i < p.length - 1 && cum[i] < s) i++;
      const k = Math.min(1, Math.max(0, (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1])));
      return [0, 1, 2].map((a) => p[i - 1][a] + (p[i][a] - p[i - 1][a]) * k);
    },
  };
}

// The plugs at time t: for each, [x, y, z, pitch, shown] (centre of the block; pitch is the
// rise of its long axis, southward up the slope). Hidden before it is lowered in.
export function plugsAt(W, t, out) {
  const P = W.plugs;
  let d = STORE_AT;
  for (let k = 0; k < PLUGS.length; k++) {
    const len = PLUGS[k].len, o = k * 5;
    const [l0, l1] = P.lower[k], [s0, s1] = P.slide[k];
    // lower end of plug k: in store at d, at the end ASC_LOW + (d − STORE_AT)
    const dEnd = P.ASC_LOW + (d - STORE_AT);
    const e = t <= s0 ? 0 : t >= s1 ? 1 : (t - s0) / (s1 - s0); // constant speed (it is checked by ropes)
    const dl = d + (dEnd - d) * e;
    const [z, y, tn] = slideAt(dl + len / 2);
    const pitch = Math.atan(tn), c = Math.cos(pitch), sn = Math.sin(pitch);
    // centre: half the height above the sloping floor, normal to it
    let yc = y + (PLUG_H / 2) * c, zc = z - (PLUG_H / 2) * sn;
    // being lowered in: from the bed of the course being laid when it starts, down to its place
    if (t < l1) {
      const drop = COURSES[P.wallsCourse + 1].y0 + PLUG_H - yc, k2 = Math.max(0, (t - l0) / (l1 - l0));
      yc += drop * (1 - k2 * k2 * (3 - 2 * k2));
    }
    out[o] = PLUG_X; out[o + 1] = yc; out[o + 2] = zc; out[o + 3] = pitch; out[o + 4] = t >= l0 ? 1 : 0;
    d += len + PLUG_GAP;
  }
  return out;
}
