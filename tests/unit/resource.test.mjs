// Unit tests for FIFO resources (src/khufu/sim/resource.js): loading bays, ramp lanes, berths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeResource, acquire, acquireAll, resourceStats } from '../../src/khufu/sim/resource.js';

test('one server: users are served first come, first served', () => {
  const R = makeResource('lane', 1);
  assert.equal(acquire(R, 0, 10), 0);   // free: served at once
  assert.equal(acquire(R, 2, 10), 10);  // waits for the first
  assert.equal(acquire(R, 3, 5), 20);   // and the second
  assert.equal(acquire(R, 30, 1), 30);  // idle again
  const s = resourceStats(R);
  assert.equal(s.served, 4);
  assert.equal(s.maxWait, 17);
  assert.equal(s.meanWait, (0 + 8 + 17 + 0) / 4);
  assert.equal(s.busy, 26);
  assert.equal(s.maxQueue, 2); // at t = 3 two users were waiting
});

test('several servers: each user takes the server that frees first', () => {
  const R = makeResource('bays', 3);
  assert.deepEqual([0, 0, 0].map(() => acquire(R, 0, 10)), [0, 0, 0]);
  assert.equal(acquire(R, 1, 10), 10);
  assert.equal(acquire(R, 1, 10), 10);
  const k = R.k;
  assert.ok(k >= 0 && k < 3);
  assert.equal(acquire(R, 1, 10), 10);
  assert.equal(acquire(R, 1, 10), 20); // all three busy until 20 now
});

test('acquireAll waits for every server and then holds them all', () => {
  const R = makeResource('ramp', 2);
  acquire(R, 0, 5); acquire(R, 0, 8);
  assert.equal(acquireAll(R, 1, 10), 8);     // a heavy stone waits for the whole width
  assert.equal(acquire(R, 2, 1), 18);        // nobody else gets in meanwhile
  assert.equal(resourceStats(R).busy, 5 + 8 + 20 + 1);
});
