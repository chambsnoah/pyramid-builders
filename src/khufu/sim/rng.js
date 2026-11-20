// Seeded random numbers (the same generator as ../../core.js), with the state kept in a
// plain object inside the simulation state, so a snapshot carries it and a restored run
// draws the same numbers.
export function makeRng(seed) {
  // spread small seeds (1, 2, 3 …) over the state space
  let s = (seed >>> 0) ^ 0x9e3779b9;
  s = Math.imul(s ^ (s >>> 16), 0x85ebca6b); s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35); s ^= s >>> 16;
  return { s: s | 0 };
}
export function rand(r) {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = Math.imul(r.s ^ (r.s >>> 15), 1 | r.s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
// a factor around 1, uniform in [1 - spread, 1 + spread]
export const jitter = (r, spread) => 1 + spread * (2 * rand(r) - 1);
