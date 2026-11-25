// Unit tests for the seeded random numbers (src/khufu/sim/rng.js), kept in the model state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, rand, jitter } from '../../src/khufu/sim/rng.js';

const seq = (r, n) => Array.from({ length: n }, () => rand(r));

test('the same seed gives the same numbers, another seed others', () => {
  assert.deepEqual(seq(makeRng(1), 20), seq(makeRng(1), 20));
  assert.notDeepEqual(seq(makeRng(1), 20), seq(makeRng(2), 20));
});

test('a copied state (as in a snapshot) continues the same sequence', () => {
  const r = makeRng(5); seq(r, 13);
  const copy = { ...r };
  assert.deepEqual(seq(copy, 30), seq(r, 30));
});

test('numbers are uniform in [0, 1) and jitter stays within its spread', () => {
  const r = makeRng(3), xs = seq(r, 20000);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
  for (let i = 0; i < 1000; i++) { const j = jitter(r, 0.2); assert.ok(j >= 0.8 && j <= 1.2); }
});
