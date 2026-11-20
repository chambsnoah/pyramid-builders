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
// Phase 2 implements one theory; the others named in issue #1 (spiral, internal) come in
// Phase 6.
import { createStraightZigzag } from './straightZigzag.js';

export const THEORIES = { 'straight-zigzag': createStraightZigzag };
export function createTheory(p) {
  const make = THEORIES[p.id];
  if (!make) throw new Error(`unknown ramp theory ${p.id}`);
  return make(p);
}
