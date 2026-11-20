// A resource with a capacity and a first-come-first-served queue, for anything whose
// service time is known when a user arrives (loading bays, ramp lanes, landing berths,
// harbour berths). It keeps, per server, the time it next comes free. A user arriving at t
// is served at max(t, earliest free time) by the server that frees first, so the wait is
// worked out at once, with no event of its own. That is exact FIFO as long as users are
// handed to it in order of arrival, which the event loop does.
// Plain data (a state object plus functions) so it lives inside snapshots.
// `pend` is a min-heap of the service start times of users still waiting, so the queue
// length seen by an arrival is exact and only future entries are kept.
export function makeResource(name, cap) {
  return { name, cap, nf: new Float64Array(cap), pend: [], served: 0, waitSum: 0, waitMax: 0, busy: 0, maxQ: 0, maxQT: 0 };
}

function heapPush(h, v) {
  let i = h.length;
  h.push(v);
  while (i > 0) { const p = (i - 1) >> 1; if (h[p] <= v) break; h[i] = h[p]; i = p; }
  h[i] = v;
}
function heapPop(h) {
  const last = h.pop();
  if (!h.length) return;
  let i = 0;
  const n = h.length;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= n) break;
    if (c + 1 < n && h[c + 1] < h[c]) c++;
    if (last <= h[c]) break;
    h[i] = h[c]; i = c;
  }
  h[i] = last;
}

function note(R, t, entry, hold) {
  // users still waiting (served later than t) give the queue length seen on arrival
  const P = R.pend;
  while (P.length && P[0] <= t) heapPop(P);
  if (entry > t) heapPush(P, entry);
  if (P.length > R.maxQ) { R.maxQ = P.length; R.maxQT = t; }
  const w = entry - t;
  R.served++; R.waitSum += w; if (w > R.waitMax) R.waitMax = w; R.busy += hold;
}

// one server for `hold` seconds; returns the time service starts
export function acquire(R, t, hold) {
  const nf = R.nf;
  let k = 0;
  for (let i = 1; i < nf.length; i++) if (nf[i] < nf[k]) k = i;
  const entry = nf[k] > t ? nf[k] : t;
  nf[k] = entry + hold;
  note(R, t, entry, hold);
  return entry;
}

// every server at once (a heavy stone taking the whole width of a ramp)
export function acquireAll(R, t, hold) {
  const nf = R.nf;
  let m = t;
  for (let i = 0; i < nf.length; i++) if (nf[i] > m) m = nf[i];
  for (let i = 0; i < nf.length; i++) nf[i] = m + hold;
  note(R, t, m, hold * nf.length);
  return m;
}

export const resourceStats = (R) => ({ name: R.name, cap: R.cap, served: R.served, meanWait: R.served ? R.waitSum / R.served : 0, maxWait: R.waitMax, maxQueue: R.maxQ, maxQueueAt: R.maxQT, busy: R.busy });
