// Khufu's pyramid at Giza: its dimensions, a height for every course, and the interior
// as built elements. Everything else (monument meshes, room linings, walking collision)
// is derived from this file, so later phases can build it course by course and room by room.
//
// Coordinates: metres, origin at the centre of the base on the bedrock (y = 0),
// x east, y up, z south (so the north face, with the entrance, is at z = -HALF).
//
// Main sources:
// - W. M. F. Petrie, "The Pyramids and Temples of Gizeh" (1883), ch. 7 (interior) and
//   sec. 146 (courses), text at ronaldbirdsall.com/gizeh/petrie/.
// - Maragioglio & Rinaldi and Lehner's "The Complete Pyramids" for room sizes not in Petrie.
// Where a figure is a reconstruction or a rounded value it says so.

// ---- the monument -------------------------------------------------------------
export const BASE = 230.33; // mean side, m (Petrie: 9068.8 in)
export const HALF = BASE / 2;
export const HEIGHT = 146.6; // original height to the apex (280 royal cubits)
export const TAN = HEIGHT / HALF; // rise per metre run, seked 5½ palms
export const SLOPE = Math.atan(TAN); // ≈ 51.84°

export const halfWidthAt = (y) => HALF * (1 - y / HEIGHT);
// height of the finished casing above a point of the base (0 outside the footprint)
export const surfaceHeight = (x, z) => Math.max(0, TAN * (HALF - Math.max(Math.abs(x), Math.abs(z))));

// ---- courses ------------------------------------------------------------------
// No course-by-course table is printed in Petrie's text, but sec. 146 gives the levels of
// the courses that are much thicker than the one below and start a new "diminishing
// series", plus the 25th and 50th courses. Those levels (inches above the pavement) are
// pinned exactly here; between them each series thins smoothly, its first course
// thickest. The present summit (top of course 203) is the commonly cited ~138.5 m. The
// courses above it are lost: 12 courses of ~0.56 m and a 1.4 m pyramidion are a
// reconstruction that reaches the original apex.
const IN = 0.0254;
export const PYRAMIDION_H = 1.4;
const ANCHORS = [
  // [course number, level of its bed in metres, starts a thick series]
  [1, 0, true],
  [25, 885.0 * IN, false],
  [35, 1155.8 * IN, true],
  [44, 1453.6 * IN, true],
  [50, 1697.6 * IN, false],
  [67, 2122.9 * IN, true],
  [74, 2310.4 * IN, true],
  [90, 2719.6 * IN, true],
  [98, 2946.4 * IN, true],
  [116, 3465.6 * IN, true],
  [144, 4142.3 * IN, true],
  [164, 4620.8 * IN, true],
  [180, 4959.2 * IN, true],
  [204, 138.5, false], // bed of the first lost course = today's summit platform
  [216, HEIGHT - PYRAMIDION_H, false], // bed of the pyramidion
];
export const SURVIVING_COURSES = 203;

function buildCourses() {
  const out = [];
  for (let s = 0; s + 1 < ANCHORS.length; s++) {
    const [c0, y0, thick] = ANCHORS[s], [c1, y1] = ANCHORS[s + 1];
    const n = c1 - c0;
    // weights: a gentle linear thinning through the series, with a heavy first course
    const w = [];
    for (let i = 0; i < n; i++) w.push((1.1 - 0.2 * (n > 1 ? i / (n - 1) : 0)) * (i === 0 && thick ? 1.5 : 1));
    const sum = w.reduce((a, b) => a + b, 0);
    let y = y0;
    for (let i = 0; i < n; i++) {
      const h = i === n - 1 ? y1 - y : ((y1 - y0) * w[i]) / sum;
      out.push({ n: c0 + i, y0: y, y1: y + h, h, thick: i === 0 && thick, surveyed: c0 + i <= SURVIVING_COURSES, kind: 'course' });
      y += h;
    }
  }
  const last = out[out.length - 1].y1;
  out.push({ n: out.length + 1, y0: last, y1: HEIGHT, h: HEIGHT - last, thick: false, surveyed: false, kind: 'pyramidion' });
  return out;
}
export const COURSES = buildCourses();
export const COURSE_COUNT = COURSES.length - 1; // masonry courses, not counting the pyramidion
export const courseAt = (y) => COURSES.find((c) => y >= c.y0 && y < c.y1) || null;

// ---- the site -----------------------------------------------------------------
// The plateau is levelled flat around the pyramid; gentle rises begin a few hundred metres out.
export const PAVEMENT = 10.5; // width of the limestone pavement round the base
export function groundHeight(x, z) {
  const r = Math.max(Math.abs(x), Math.abs(z));
  const t = Math.min(1, Math.max(0, (r - 420) / 900));
  const k = t * t * (3 - 2 * t);
  const n = Math.sin(x * 0.0061 + Math.sin(z * 0.0043) * 2) * Math.cos(z * 0.0052 + Math.sin(x * 0.0037)) + 0.5 * Math.sin(x * 0.013 + z * 0.009);
  return k * (6 + n * 7) - (x > 900 ? Math.min(14, (x - 900) * 0.02) : 0); // falls away east toward the valley
}

// ---- interior -----------------------------------------------------------------
// A volume is a convex prism over the rectangle [x0,x1] × [z0,z1]. Its floor is the plane
// y = a + b·z and its ceiling the lowest of one or more planes y = a + b·z (two planes make a
// gable). All passages here run north–south, so planes never vary with x.
// Voids are open space cut out of the masonry or bedrock; solids sit inside voids
// (benches, unfinished rock, the granite leaf). Neighbouring voids overlap by OVERLAP so
// their shared doorways open up when linings are built.
const OVERLAP = 0.05;
const D = Math.PI / 180;
const box = (x0, x1, z0, z1, y0, y1, extra) => ({ x0, x1, z0, z1, floor: [y0, 0], ceil: [[y1, 0]], ...extra });
// prism whose floor passes through (zA, yA) at `deg` (positive rises southward), with a
// perpendicular height hPerp (vertical height hPerp / cos)
function slope(x0, x1, z0, z1, zA, yA, deg, hPerp, extra) {
  const b = Math.tan(deg * D), a = yA - b * zA;
  return { x0, x1, z0, z1, floor: [a, b], ceil: [[a + hPerp / Math.cos(deg * D), b]], ...extra };
}
// walls of height `wall` above y0, then a roof rising `rise` to a ridge along the east–west centre line
function gable(x0, x1, z0, z1, y0, wall, rise) {
  const zc = (z0 + z1) / 2, k = rise / ((z1 - z0) / 2), apex = y0 + wall + rise;
  return { x0, x1, z0, z1, floor: [y0, 0], ceil: [[apex - k * zc, k], [apex + k * zc, -k]] };
}
export const floorY = (v, z) => v.floor[0] + v.floor[1] * z;
export const ceilY = (v, z) => Math.min(...v.ceil.map(([a, b]) => a + b * z));

// Passage system: one north–south axis 7.29 m east of the centre (Petrie: 287 in).
export const AXIS_X = 7.29;
const PW = 1.05, PH = 1.2; // passage width and perpendicular height (41.5 × 47.3 in)
const px0 = AXIS_X - PW / 2, px1 = AXIS_X + PW / 2;

// Entrance: sill on the north face 16.97 m up (Petrie: 668 in).
export const ENTRANCE_Y = 16.97;
export const ENTRANCE_Z = -HALF + ENTRANCE_Y / TAN;
const DESC_DEG = 26.52, DESC_LEN = 105.3; // 26°31′23″; length from the sill to the bottom
const DESC_BOTTOM = { z: ENTRANCE_Z + DESC_LEN * Math.cos(DESC_DEG * D), y: ENTRANCE_Y - DESC_LEN * Math.sin(DESC_DEG * D) };
const descending = slope(px0, px1, ENTRANCE_Z - 0.8, DESC_BOTTOM.z + OVERLAP, ENTRANCE_Z, ENTRANCE_Y, -DESC_DEG, PH);

// Horizontal passage and the unfinished subterranean chamber, about 30 m under the base.
const SUB_FLOOR = DESC_BOTTOM.y;
const HP_LEN = 8.84, HP_W = 0.85, HP_H = 0.91;
const SUB = { x0: -6.18, x1: 7.9, z0: DESC_BOTTOM.z + HP_LEN, z1: DESC_BOTTOM.z + HP_LEN + 8.36, y0: SUB_FLOOR, y1: SUB_FLOOR + 3.5 };

// Queen's Chamber on the pyramid's east–west axis, with a gabled roof.
const QC = { x0: AXIS_X + PW / 2 + 0.035 - 5.75, x1: AXIS_X + PW / 2 + 0.035, z0: -5.23 / 2, z1: 5.23 / 2, y0: 21.18, wall: 4.69, apex: 6.23 };
const QC_PASSAGE_Y = 21.7, QC_PASSAGE_LEN = 38.15, QC_STEP_AT = 5.5; // floor drops 0.52 m 5.5 m short of the chamber

// Grand Gallery: starts where the ascending passage meets the Queen's Chamber passage.
const GALLERY_Z0 = QC.z0 - QC_PASSAGE_LEN;
const GAL_DEG = 26.27, GAL_LEN = 46.68, GAL_W = 2.06, GAL_WALL = 2.29, GAL_H = 8.6, CORBELS = 7, CORBEL_STEP = 0.0762;
const GAL_TOP = { z: GALLERY_Z0 + GAL_LEN * Math.cos(GAL_DEG * D), y: QC_PASSAGE_Y + GAL_LEN * Math.sin(GAL_DEG * D) };
export const KC_FLOOR = 43.03;
const STEP_DEPTH = 1.52;
const gx0 = AXIS_X - GAL_W / 2, gx1 = AXIS_X + GAL_W / 2;
const BENCH_W = (GAL_W - PW) / 2, BENCH_H = 0.61;

// Ascending passage: from the roof of the descending passage up to the gallery foot.
const ASC_DEG = 26.04;
const ascFloor = (z) => QC_PASSAGE_Y + Math.tan(ASC_DEG * D) * (z - GALLERY_Z0);
const descRoof = (z) => ceilY(descending, z);
// where the ascending floor meets the descending roof (both linear in z)
const ASC_Z0 = (() => { let lo = ENTRANCE_Z, hi = GALLERY_Z0; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (ascFloor(m) < descRoof(m)) lo = m; else hi = m; } return (lo + hi) / 2; })();
// The ascending passage leaves through the roof of the descending one: the opening is where
// its full height cuts the descending roof, from the floor junction (ASC_Z0) north to where
// its ceiling meets that roof (ASC_OPEN_Z, about 1.4 m). North of ASC_Z0 its floor lies
// inside the descending passage, so only the hole in the roof shows.
const ascCeil = (z) => ascFloor(z) + PH / Math.cos(ASC_DEG * D);
const ASC_OPEN_Z = (() => { let lo = ENTRANCE_Z, hi = ASC_Z0; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (ascCeil(m) < descRoof(m)) lo = m; else hi = m; } return (lo + hi) / 2; })();

// Upper end: great step, low passage, antechamber, low passage, King's Chamber.
const Z_STEP = GAL_TOP.z + STEP_DEPTH; // south wall of the gallery
const Z_ANTE0 = Z_STEP + 1.32, Z_ANTE1 = Z_ANTE0 + 2.96;
const KC = { x0: AXIS_X + PW / 2 + 0.035 - 10.47, x1: AXIS_X + PW / 2 + 0.035, z0: Z_ANTE1 + 2.55, z1: Z_ANTE1 + 2.55 + 5.23, y0: KC_FLOOR, y1: KC_FLOOR + 5.84 };

function galleryVolumes() {
  const vols = [];
  const base = slope(gx0, gx1, GALLERY_Z0 - OVERLAP, GAL_TOP.z, GALLERY_Z0, QC_PASSAGE_Y, GAL_DEG, 1);
  const [a, b] = base.floor;
  // lower walls: vertical, 2.29 m, stopping at the great step
  vols.push({ x0: gx0, x1: gx1, z0: GALLERY_Z0 - OVERLAP, z1: GAL_TOP.z, floor: [a, b], ceil: [[a + GAL_WALL, b]], joint: { mode: 'slope', h: GAL_WALL / 2 } });
  // seven corbelled courses, each oversailing the one below by 3 in on each side
  for (let k = 1; k <= CORBELS; k++) {
    const inset = k * CORBEL_STEP;
    const h0 = GAL_WALL + (k - 1) * ((GAL_H - GAL_WALL) / CORBELS), h1 = h0 + (GAL_H - GAL_WALL) / CORBELS;
    vols.push({ x0: gx0 + inset, x1: gx1 - inset, z0: GALLERY_Z0 - OVERLAP, z1: Z_STEP, floor: [a + h0 - OVERLAP, b], ceil: [[a + h1, b]], joint: { mode: 'slope', h: h1 - h0 + OVERLAP } });
  }
  // the space over the great step: level floor, ceiling following the lower walls' top
  vols.push({ x0: gx0, x1: gx1, z0: GAL_TOP.z - OVERLAP, z1: Z_STEP, floor: [KC_FLOOR, 0], ceil: [[a + GAL_WALL, b]], joint: { mode: 'level', y0: KC_FLOOR, h: GAL_WALL / 2 } });
  return vols;
}

function shaft(x, zWall, yStart, dir, deg, len) {
  // dir -1 runs north, +1 south; a 2 m level start then the incline; 20 × 20 cm
  const S = 0.2, x0 = x - S / 2, x1 = x + S / 2;
  const zA = zWall + dir * 2.0;
  const level = box(x0, x1, Math.min(zWall - dir * OVERLAP, zA), Math.max(zWall - dir * OVERLAP, zA), yStart, yStart + S);
  const zEnd = zA + dir * len * Math.cos(deg * D);
  const incl = slope(x0, x1, Math.min(zA - dir * OVERLAP, zEnd), Math.max(zA - dir * OVERLAP, zEnd), zA, yStart, dir * deg, S);
  return [level, incl];
}

const RELIEVING = [50.65, 53.7, 56.75, 59.8, 62.85]; // floors of the five relieving chambers (approximate)

export const ELEMENTS = [
  {
    id: 'descending', name: 'Descending passage', material: 'limestone', joint: { w: 1.6, h: 0.6, mode: 'slope' },
    note: 'Cut into the bedrock and continued up through the courses to the entrance',
    voids: [descending],
    label: [AXIS_X, 6, -78],
  },
  {
    id: 'subterranean', name: 'Subterranean chamber', material: 'rock', joint: null,
    note: 'Cut into the bedrock and never finished: the west half is still uncut rock',
    voids: [
      box(AXIS_X - HP_W / 2, AXIS_X + HP_W / 2, DESC_BOTTOM.z - OVERLAP, SUB.z0 + OVERLAP, SUB_FLOOR, SUB_FLOOR + HP_H),
      box(SUB.x0, SUB.x1, SUB.z0, SUB.z1, SUB.y0, SUB.y1),
      box(2.6, 3.35, SUB.z1 - OVERLAP, SUB.z1 + 16.4, SUB_FLOOR, SUB_FLOOR + 0.75), // blind passage south
    ],
    solids: [
      // unfinished rock left standing in the west half, in rough terraces
      { ...box(SUB.x0, -1.4, SUB.z0, SUB.z1, SUB.y0, SUB.y1 - 0.85), skip: ['bottom', 'x0', 'z0', 'z1'] },
      { ...box(-1.4, 1.9, SUB.z0, SUB.z0 + 4.4, SUB.y0, SUB.y0 + 1.45), skip: ['bottom', 'z0'] },
      { ...box(-1.4, 1.2, SUB.z0 + 4.4, SUB.z1, SUB.y0, SUB.y0 + 2.1), skip: ['bottom', 'z1'] },
      { ...box(1.2, 3.1, SUB.z1 - 1.6, SUB.z1, SUB.y0, SUB.y0 + 0.7), skip: ['bottom', 'z1'] },
    ],
    label: [0.8, SUB.y1 + 1, (SUB.z0 + SUB.z1) / 2],
  },
  {
    id: 'ascending', name: 'Ascending passage', material: 'limestone', joint: { w: 1.6, h: 0.6, mode: 'slope' },
    note: 'Left open through the courses as they rose; three granite plugs stored in the Grand Gallery are slid down it at the end (not drawn while walking)',
    voids: [slope(px0, px1, ASC_OPEN_Z - OVERLAP, GALLERY_Z0 + OVERLAP, GALLERY_Z0, QC_PASSAGE_Y, ASC_DEG, PH)],
    label: [AXIS_X, 14, -58],
  },
  {
    id: 'queen', name: "Queen's Chamber", material: 'limestone', joint: { w: 1.4, h: 0.85, mode: 'level', y0: QC.y0 },
    note: 'Gabled limestone roof; the corbelled niche is in the east wall',
    voids: [
      box(px0, px1, GALLERY_Z0 - OVERLAP, QC.z0 - QC_STEP_AT + OVERLAP, QC_PASSAGE_Y, QC_PASSAGE_Y + 1.17),
      box(px0, px1, QC.z0 - QC_STEP_AT, QC.z0 + OVERLAP, QC.y0, QC.y0 + 1.73),
      box(QC.x0, QC.x1, QC.z0, QC.z1, QC.y0, QC.y0 + QC.wall),
      // gabled roof: two planes meeting over the east–west axis
      gable(QC.x0, QC.x1, QC.z0, QC.z1, QC.y0 + QC.wall - OVERLAP, OVERLAP, QC.apex - QC.wall),
      // corbelled niche in the east wall, 0.6 m south of its centre
      ...[[0, 1.83, 1.57], [1.78, 2.55, 1.33], [2.5, 3.25, 1.09], [3.2, 3.95, 0.85], [3.9, 4.67, 0.61]].map(([y0, y1, w]) =>
        box(QC.x1 - OVERLAP, QC.x1 + 1.04, 0.6 - w / 2, 0.6 + w / 2, QC.y0 + y0, QC.y0 + y1)),
      ...shaft((QC.x0 + QC.x1) / 2, QC.z0, QC.y0 + 1.6, -1, 37.5, 58),
      ...shaft((QC.x0 + QC.x1) / 2, QC.z1, QC.y0 + 1.6, 1, 39.6, 60),
    ],
    label: [(QC.x0 + QC.x1) / 2, QC.y0 + 8, 0],
  },
  {
    id: 'gallery', name: 'Grand Gallery', material: 'limestone', joint: { w: 1.8, mode: 'slope' },
    note: '46.7 m long and 8.6 m high; seven corbelled courses each oversail the one below',
    voids: galleryVolumes(),
    solids: [
      // side ramps ("benches") along both walls, ending at the great step
      { ...slope(gx0, gx0 + BENCH_W, GALLERY_Z0, GAL_TOP.z, GALLERY_Z0, QC_PASSAGE_Y, GAL_DEG, BENCH_H * Math.cos(GAL_DEG * D)), skip: ['bottom', 'x0', 'z1'] },
      { ...slope(gx1 - BENCH_W, gx1, GALLERY_Z0, GAL_TOP.z, GALLERY_Z0, QC_PASSAGE_Y, GAL_DEG, BENCH_H * Math.cos(GAL_DEG * D)), skip: ['bottom', 'x1', 'z1'] },
    ],
    label: [AXIS_X, 40, -20],
  },
  {
    id: 'antechamber', name: 'Antechamber', material: 'granite', joint: { w: 1.1, h: 0.9, mode: 'level', y0: KC_FLOOR },
    note: 'Slots for three granite portcullis slabs; the granite leaf still hangs across it',
    voids: [
      box(px0, px1, Z_STEP - OVERLAP, Z_ANTE0 + OVERLAP, KC_FLOOR, KC_FLOOR + 1.11),
      box(AXIS_X - 0.83, AXIS_X + 0.83, Z_ANTE0, Z_ANTE1, KC_FLOOR, KC_FLOOR + 3.78),
      box(px0, px1, Z_ANTE1 - OVERLAP, KC.z0 + OVERLAP, KC_FLOOR, KC_FLOOR + 1.11),
    ],
    solids: [{ ...box(AXIS_X - 0.83, AXIS_X + 0.83, Z_ANTE0 + 0.28, Z_ANTE0 + 0.68, KC_FLOOR + 1.11, KC_FLOOR + 2.4), skip: ['x0', 'x1'] }],
    label: [AXIS_X, KC_FLOOR + 6, (Z_ANTE0 + Z_ANTE1) / 2],
  },
  {
    id: 'king', name: "King's Chamber", material: 'granite', joint: { w: 1.163, h: 47.04 * IN, mode: 'level', y0: KC.y1 - 5 * 47.04 * IN },
    note: 'Lined and roofed with Aswan granite: five courses of walls and nine roof beams',
    voids: [
      box(KC.x0, KC.x1, KC.z0, KC.z1, KC.y0, KC.y1),
      ...shaft((KC.x0 + KC.x1) / 2, KC.z0, KC.y0 + 0.9, -1, 32.6, 80),
      ...shaft((KC.x0 + KC.x1) / 2, KC.z1, KC.y0 + 0.9, 1, 45, 60),
    ],
    sarcophagus: { x: KC.x0 + 1.05, z: (KC.z0 + KC.z1) / 2, y: KC.y0, len: 2.28, wid: 0.98, ht: 1.05, wall: 0.15, floor: 0.18 },
    label: [(KC.x0 + KC.x1) / 2, KC.y1 + 1.5, (KC.z0 + KC.z1) / 2],
  },
  {
    id: 'relieving', name: 'Relieving chambers', material: 'granite', joint: { w: 1.163, h: 0.5, mode: 'level', y0: 50 },
    note: 'Five low chambers stacked over the King\'s Chamber; the top one has a gabled limestone roof',
    voids: RELIEVING.map((y, i) => (i < 4 ? box(KC.x0 - 0.3, KC.x1 + 0.3, KC.z0, KC.z1, y, y + 0.95) : gable(KC.x0 - 0.3, KC.x1 + 0.3, KC.z0 - 0.4, KC.z1 + 0.4, y, 1.0, 2.6))),
    walkable: false,
    label: [(KC.x0 + KC.x1) / 2, 68, (KC.z0 + KC.z1) / 2],
  },
];

// Steps up the north face to the entrance. The casing was smooth, so the model adds a
// stair for access: not historical.
export const STAIR = { x0: AXIS_X - 1.05, x1: AXIS_X + 1.05, landing: 1.6, deg: 35, rise: 0.25 };
STAIR.zTop = ENTRANCE_Z - STAIR.landing;
STAIR.zFoot = STAIR.zTop - ENTRANCE_Y / Math.tan(STAIR.deg * D);
const STAIR_TAN = Math.tan(STAIR.deg * D), STAIR_RAIL = 1.0; // invisible rail height above the steps
export const STAIR_SOLIDS = [
  // collision: a smooth ramp under the steps and the landing in front of the entrance
  { x0: STAIR.x0, x1: STAIR.x1, z0: STAIR.zFoot, z1: STAIR.zTop, floor: [-1, 0], ceil: [[-STAIR_TAN * STAIR.zFoot, STAIR_TAN]] },
  box(STAIR.x0, STAIR.x1, STAIR.zTop, ENTRANCE_Z + 0.05, -1, ENTRANCE_Y - 0.01),
  // invisible rails along both sides, so walking up at an angle slides along the edge
  // instead of stepping off it (the lower flight stands over the open ground)
  ...[[STAIR.x0 - 0.2, STAIR.x0], [STAIR.x1, STAIR.x1 + 0.2]].map(([x0, x1]) =>
    ({ x0, x1, z0: STAIR.zFoot, z1: STAIR.zTop, floor: [-1, 0], ceil: [[-STAIR_TAN * STAIR.zFoot + STAIR_RAIL, STAIR_TAN]] })),
];

// Places to jump to when walking: position of the feet and the heading (yaw 0 = north, π = south).
export const SPOTS = [
  { key: 'outside', name: 'North side', pos: [AXIS_X, 0, STAIR.zFoot - 9], yaw: Math.PI }, // facing straight up the stair
  { key: 'entrance', name: 'Entrance', pos: [AXIS_X, ENTRANCE_Y, ENTRANCE_Z - 0.9], yaw: Math.PI },
  { key: 'subterranean', name: 'Subterranean chamber', pos: [5.6, SUB_FLOOR, SUB.z0 + 1.5], yaw: Math.PI / 2 + 0.5 },
  { key: 'queen', name: "Queen's Chamber", pos: [6.6, QC.y0, QC.z0 + 0.8], yaw: Math.PI * 0.75 },
  { key: 'gallery', name: 'Grand Gallery', pos: [AXIS_X, QC_PASSAGE_Y + Math.tan(GAL_DEG * D) * 4.5 + 0.01, GALLERY_Z0 + 4.5], yaw: Math.PI },
  { key: 'king', name: "King's Chamber", pos: [6.7, KC.y0, KC.z0 + 1.2], yaw: Math.PI / 2 + 0.35 },
];

// Key levels for the record (and for checks in the browser console).
export const LEVELS = {
  entranceSill: ENTRANCE_Y, entranceZ: ENTRANCE_Z,
  descendingBottom: DESC_BOTTOM, ascendingStartZ: ASC_Z0, ascendingStartY: ascFloor(ASC_Z0), ascendingOpeningZ: ASC_OPEN_Z,
  galleryFoot: { z: GALLERY_Z0, y: QC_PASSAGE_Y }, galleryTop: GAL_TOP, greatStepSouth: Z_STEP,
  queensChamber: QC, kingsChamber: KC, subterranean: SUB,
};
