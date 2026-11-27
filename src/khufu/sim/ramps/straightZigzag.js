// Straight ramps for the lower courses, then zigzags up the faces.
// - Up to switchY a straight ramp stands against the middle of each face, running out
//   perpendicular to it at a gentle grade, lengthened at its foot as it is raised. These
//   carry the bulk: about two-thirds of the stone and the King's Chamber granite.
// - Above switchY the straight ramps stop growing. Sleds still climb them, then turn onto a
//   narrow ramp switching back and forth up the face, built on the stepped backing stones.
//   Each switchback turns the sled on a landing, which limits how often sleds can follow.
// - Above topY only one face's zigzag goes on to the apex (see topOf); the other three stop.
import { COURSES, HALF, TAN, halfWidthAt } from '../../data.js';

// face 0 S (+z), 1 E (+x), 2 N (−z), 3 W (−x): outward normal and the direction along the face
export const FACES = [[[0, 1], [1, 0]], [[1, 0], [0, -1]], [[0, -1], [-1, 0]], [[-1, 0], [0, 1]]];

// straight ramp against a face reaching up to height y: horizontal run, slope length, head
// and foot distance from the centre, and its fill (a wedge of top width w with 1:2 side
// slopes, so its section at height h is (w + h)·h, integrated along the run)
export function straightRamp(S, y) {
  const run = y / S.grade;
  return { run, length: Math.hypot(run, y), head: halfWidthAt(y), foot: Math.max(halfWidthAt(y) + run, HALF + 3), fill: run * (S.width * y / 2 + y * y / 3) };
}

// the course whose bed is nearest height y
export function courseNear(y) {
  let ci = 0;
  for (let i = 0; i < COURSES.length; i++) if (Math.abs(COURSES[i].y0 - y) < Math.abs(COURSES[ci].y0 - y)) ci = i;
  return ci;
}

// The top, for a theory with a ramp on every face: from course ci (the bed nearest p.topY)
// up, a course is small enough for one ramp to serve all of it, and four ramps would crowd
// round the shrinking faces (each zigzag ledge is 7 m wide, built down to the face below,
// on a face only a few metres across near the apex). So only route `route` goes on; the
// others stop at y and are not raised again. Without p.topY every route goes to the apex.
export function topOf(p) {
  if (!Number.isFinite(p.topY)) return null;
  const ci = courseNear(p.topY);
  return { ci, y: COURSES[ci].y0, route: p.topRoute ?? 0, label: 'One ramp left for the top: the others stop' };
}
// the routes in use for course ci, given every route a theory would have without a top
export const atTop = (top, ci, routes) => (top && ci >= top.ci ? routes.filter((r) => r.id === top.route) : routes);

export function createStraightZigzag(p) {
  const S = p.straight, Z = p.zigzag;
  // the course whose bed is nearest switchY: from it upward the zigzags are used
  const switchCi = courseNear(p.switchY);
  const switchY = COURSES[switchCi].y0;
  const top = topOf(p);

  const straight = (y) => straightRamp(S, y);
  // zigzag from switchY up to y: flights no longer than most of the face width at the top
  const zigzag = (y) => {
    const rise = Math.max(0, y - switchY), run = rise / Z.grade;
    const flight = Math.max(4, 2 * halfWidthAt(y) * Z.flightFrac);
    const turns = run > 0 ? Math.max(0, Math.ceil(run / flight) - 1) : 0;
    return { rise, run, length: Math.hypot(run, rise), flight, turns };
  };

  function layout(ci) {
    const y = COURSES[ci].y0;
    const up = ci < switchCi;
    const st = straight(up ? y : switchY);
    const routes = FACES.map(([n, t], f) => {
      const foot = [n[0] * st.foot, n[1] * st.foot];
      const segs = [{ res: `straight${f}`, kind: 'straight', length: st.length, rise: up ? y : switchY, grade: S.grade, lanes: S.lanes, headway: S.headway, turns: 0, turnTime: 0 }];
      let head;
      if (up) head = [n[0] * st.head, n[1] * st.head];
      else {
        const z = zigzag(y);
        segs.push({ res: `zigzag${f}`, kind: 'zigzag', length: z.length, rise: z.rise, grade: Z.grade, lanes: Z.lanes, headway: z.turns ? Math.max(Z.headway, Z.turnTime) : Z.headway, turns: z.turns, turnTime: Z.turnTime });
        // the last flight ends at one end or the other of the face, alternating with the turns
        const side = z.turns % 2 ? -1 : 1, off = Math.min(z.flight / 2, halfWidthAt(y) * 0.8) * side, r = halfWidthAt(y);
        head = [n[0] * r + t[0] * off, n[1] * r + t[1] * off];
      }
      return { id: f, face: f, foot, head, segs };
    });
    return { routes: atTop(top, ci, routes), switchCi };
  }

  // fill standing while course ci is laid. Straight ramp: a wedge of top width w with 1:2 side
  // slopes, so its section at height h is (w + h)·h, integrated along the run. Zigzag: each
  // metre of ramp needs a retaining fill about as deep as the face rises across its width.
  // Above the top only one zigzag is still raised; the other three stand as they stopped.
  function fill(ci) {
    const y = COURSES[ci].y0;
    const Y = Math.min(y, switchY), st = straight(Y);
    const straightV = 4 * st.run * (S.width * Y / 2 + Y * Y / 3);
    const len = (yy) => (yy > switchY ? zigzag(yy).length : 0);
    const zigLen = top && y > top.y ? len(y) + 3 * len(top.y) : 4 * len(y);
    const zigzagV = zigLen * Z.width * (Z.width * TAN / 2);
    return { total: straightV + zigzagV, parts: { straight: straightV, zigzag: zigzagV } };
  }

  return { id: 'straight-zigzag', name: 'Straight ramps, then zigzags up the faces', short: 'Straight + zigzag', switchCi, switchY, switchLabel: 'Straight ramps topped out: zigzags begin', top, layout, fill };
}
