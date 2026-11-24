// Ramp theories as plug-ins. Nobody knows how Khufu's stones went up, so the planner takes
// a ramp theory as a setting. Every theory implements the same interface:
//
//   createTheory(params) -> {
//     id, name,
//     layout(ci) -> {            // the ramps in use while course ci is being laid
//       routes: [{                // one per ramp system; sectors are served by the nearest head
//         id, face,               // route index and face (0 S, 1 E, 2 N, 3 W)
//         foot: [x, z],           // where the road meets the ramp
//         head: [x, z],           // where the ramp meets the bed of course ci
//         segs: [{                // stretches of ramp from foot to head, in order
//           res,                  // lane resource key, shared between courses ('straight0')
//           kind, length, rise, grade, lanes,
//           headway,              // seconds between sleds entering one lane
//           turns, turnTime,      // switchbacks on the way and seconds per turn
//         }],
//       }],
//     },
//     fill(ci) -> { total, parts: { … } },   // m³ of ramp standing while course ci is laid
//   }
//
// Optional, for drawing (sim/gangs.js, bubble.js) and the timeline:
//   short                       a short name for tables
//   switchCi, switchY, switchLabel   where the straight ramps stop (a milestone)
//   ledge(route, y) -> { pts, turns, length, end }   a theory whose ramp is a fixed path
//                               (not a straight wedge) gives it here, from its foot (or the
//                               top of the straight ramp) up to height y; the model's segment
//                               is the same path, so gangs climb exactly what is drawn
//   ledgeInside                 the path runs inside the masonry (drawn as a floor only)
//
// The straight-zigzag theory draws its zigzag itself (gangs.js zigPrefix).
import { createStraightZigzag } from './straightZigzag.js';
import { createSpiral } from './spiral.js';
import { createInternal } from './internal.js';

export const THEORIES = { 'straight-zigzag': createStraightZigzag, spiral: createSpiral, internal: createInternal };
export const THEORY_IDS = Object.keys(THEORIES);
export function createTheory(p) {
  const make = THEORIES[p.id];
  if (!make) throw new Error(`unknown ramp theory ${p.id}`);
  return make(p);
}
