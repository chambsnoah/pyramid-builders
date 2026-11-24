// Houdin's internal ramp (one of the theories in issue #1). The lower courses go up four
// straight ramps against the faces, as in the straight-zigzag theory. Above switchY those are
// given up, and every sled climbs a single ramp built inside the masonry as it rises: it
// enters through a passage at the foot of the west face, then winds round inside the
// pyramid, `inset` m in from the face, at about 7 %. At each corner a notch left open to the
// sky gives room to turn the sled with levers. One lane all the way, so the whole top of the
// pyramid is fed through it.
import { COURSES, HALF, halfWidthAt } from '../../data.js';
import { FACES, straightRamp } from './straightZigzag.js';
import { squareSpiral, spiralPrefix } from './spiralPath.js';

export function createInternal(p) {
  const S = p.straight, I = p.internal;
  let switchCi = 0;
  for (let i = 0; i < COURSES.length; i++) if (Math.abs(COURSES[i].y0 - p.switchY) < Math.abs(COURSES[switchCi].y0 - p.switchY)) switchCi = i;
  const switchY = COURSES[switchCi].y0;
  // inside the face; near the apex it cannot turn tighter than 4 m from the axis
  const r = (y) => Math.max(4, halfWidthAt(y) - I.inset);
  // the passage in runs east from outside the west face to the ramp's south-west corner, so the
  // road to it from the quarry passes clear of the straight ramps
  const r0 = r(0), entry = [-(HALF + 3), r0];
  const path = squareSpiral({ face: 0, r, grade: I.grade, entry });
  const ledge = (route, y) => spiralPrefix(path, y);

  function layout(ci) {
    const y = COURSES[ci].y0;
    if (ci < switchCi) {
      const st = straightRamp(S, y);
      const routes = FACES.map(([n], f) => ({
        id: f, face: f, foot: [n[0] * st.foot, n[1] * st.foot], head: [n[0] * st.head, n[1] * st.head],
        segs: [{ res: `straight${f}`, kind: 'straight', length: st.length, rise: y, grade: S.grade, lanes: S.lanes, headway: S.headway, turns: 0, turnTime: 0 }],
      }));
      return { routes, switchCi };
    }
    const L = ledge(0, y);
    const seg = { res: 'internal0', kind: 'internal', length: L.length, rise: y, grade: I.grade, lanes: I.lanes, headway: L.turns ? Math.max(I.headway, I.turnTime) : I.headway, turns: L.turns, turnTime: I.turnTime };
    return { routes: [{ id: 0, face: 0, foot: entry, head: [L.end[0], L.end[1]], segs: [seg] }], switchCi };
  }

  // the straight ramps as built up to switchY, plus the internal ramp's gallery: a void the
  // width of the ramp and `clearance` high, filled in once the top is reached
  function fill(ci) {
    const y = COURSES[ci].y0;
    const straightV = 4 * straightRamp(S, Math.min(y, switchY)).fill;
    const internalV = y > switchY ? ledge(0, y).length * I.width * I.clearance : 0;
    return { total: straightV + internalV, parts: { straight: straightV, internal: internalV } };
  }

  return {
    id: 'internal', name: "Straight ramps, then Houdin's internal ramp", short: 'Internal', switchCi, switchY, switchLabel: 'Straight ramps given up: the internal ramp begins',
    layout, fill, ledge, ledgeInside: true,
  };
}
