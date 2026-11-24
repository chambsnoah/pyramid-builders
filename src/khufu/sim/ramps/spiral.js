// A ramp spiralling round the pyramid (one of the theories in issue #1). Four ledges, one
// starting on the ground at each corner, wind up round the faces at a steady grade, built on
// the stepped backing stones just outside the face, so they rise together and each face
// carries four of them at different heights. A sled turns round the arris at every corner,
// which limits how closely sleds can follow one another. There are no straight ramps: from
// the first course the gangs climb the spirals, and the climb grows longer with every lap.
import { COURSES, TAN, halfWidthAt } from '../../data.js';
import { FACES } from './straightZigzag.js';
import { squareSpiral, spiralPrefix } from './spiralPath.js';

export function createSpiral(p) {
  const Z = p.spiral;
  const r = (y) => halfWidthAt(y) + Z.width / 2; // the middle of the ledge, outside the face
  const paths = FACES.map((_, f) => squareSpiral({ face: f, r, grade: Z.grade }));
  const ledge = (route, y) => spiralPrefix(paths[route], y);

  function layout(ci) {
    const y = COURSES[ci].y0;
    const routes = FACES.map((_, f) => {
      const L = ledge(f, y), [ex, ez, ef] = L.end, [n, t] = FACES[ef], hw = halfWidthAt(y);
      // the head: where the ledge's end meets the edge of the course
      const u = Math.max(-hw, Math.min(hw, ex * t[0] + ez * t[1]));
      const head = [n[0] * hw + t[0] * u, n[1] * hw + t[1] * u];
      const seg = { res: `spiral${f}`, kind: 'spiral', length: L.length, rise: y, grade: Z.grade, lanes: Z.lanes, headway: L.turns ? Math.max(Z.headway, Z.turnTime) : Z.headway, turns: L.turns, turnTime: Z.turnTime };
      return { id: f, face: f, foot: [paths[f][0][0], paths[f][0][2]], head, segs: [seg] };
    });
    return { routes, switchCi: 0 };
  }

  // each ledge needs a retaining fill under it about as deep as the face rises across its width
  function fill(ci) {
    const y = COURSES[ci].y0;
    let len = 0;
    for (let f = 0; f < 4; f++) len += ledge(f, y).length;
    const v = len * Z.width * (Z.width * TAN / 2);
    return { total: v, parts: { spiral: v } };
  }

  return { id: 'spiral', name: 'Four ramps spiralling round the faces', short: 'Spiral', switchCi: 0, switchY: 0, layout, fill, ledge, ledgeInside: false };
}
