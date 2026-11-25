// Unit tests for the event queue (src/khufu/sim/queue.js): a min-heap on (time, sequence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeQueue, push, pop, peekTime, packQueue, unpackQueue } from '../../src/khufu/sim/queue.js';

const drain = (Q) => { const out = [], e = {}; while (pop(Q, e)) out.push({ ...e }); return out; };

test('pops events in time order, growing past its capacity', () => {
  const Q = makeQueue(4);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const times = Array.from({ length: 500 }, () => Math.floor(rnd() * 1000) / 10);
  times.forEach((t, i) => push(Q, t, i % 7, i, -i));
  assert.equal(Q.n, 500);
  const out = drain(Q);
  assert.deepEqual(out.map((e) => e.t), [...times].sort((a, b) => a - b));
  assert.equal(Q.n, 0);
  assert.equal(pop(Q, {}), false);
});

test('events at the same time come out in the order they were scheduled', () => {
  const Q = makeQueue();
  for (let i = 0; i < 50; i++) push(Q, i % 3 === 0 ? 5 : 2, 1, i);
  const out = drain(Q);
  const at2 = out.filter((e) => e.t === 2).map((e) => e.a), at5 = out.filter((e) => e.t === 5).map((e) => e.a);
  assert.deepEqual(at2, [...at2].sort((a, b) => a - b));
  assert.deepEqual(at5, [...at5].sort((a, b) => a - b));
  assert.ok(out.findIndex((e) => e.t === 5) > out.findLastIndex((e) => e.t === 2));
});

test('carries the type and both integers with each event', () => {
  const Q = makeQueue();
  push(Q, 3, 9, 123, -456); push(Q, 1, 4, 7, 8);
  assert.equal(peekTime(Q), 1);
  assert.deepEqual(drain(Q), [{ t: 1, type: 4, a: 7, b: 8 }, { t: 3, type: 9, a: 123, b: -456 }]);
  assert.equal(peekTime(Q), Infinity);
});

test('a packed and unpacked queue gives the same events, and keeps the sequence counter', () => {
  const Q = makeQueue();
  for (let i = 0; i < 40; i++) push(Q, (i * 37) % 11, i % 5, i, i * 2);
  const e = {}; for (let i = 0; i < 10; i++) pop(Q, e);
  const R = unpackQueue(packQueue(Q));
  assert.equal(R.seq, Q.seq);
  push(Q, 4, 0, 999); push(R, 4, 0, 999); // the new event sorts after the old ones at t = 4 in both
  assert.deepEqual(drain(R), drain(Q));
});
