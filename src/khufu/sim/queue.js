// The event queue: a binary min-heap ordered by (time, sequence number). The sequence
// number is a counter given to every event as it is scheduled, so two events at the same
// time always come out in the order they were scheduled: a stable, deterministic order.
// Each event is a type and two integers. Plain typed arrays, so the queue is part of the
// simulation state and snapshots copy it.
export function makeQueue(cap = 1024) {
  return { n: 0, seq: 0, t: new Float64Array(cap), q: new Float64Array(cap), ty: new Uint8Array(cap), a: new Int32Array(cap), b: new Int32Array(cap) };
}

function grow(Q) {
  const cap = Q.t.length * 2;
  for (const k of ['t', 'q', 'ty', 'a', 'b']) { const o = Q[k], n = new o.constructor(cap); n.set(o); Q[k] = n; }
}

export function push(Q, time, type, a = 0, b = 0) {
  if (Q.n === Q.t.length) grow(Q);
  const seq = Q.seq++;
  const T = Q.t, S = Q.q, TY = Q.ty, A = Q.a, B = Q.b;
  let i = Q.n++;
  while (i > 0) { // sift the hole up
    const p = (i - 1) >> 1;
    if (T[p] < time || (T[p] === time && S[p] < seq)) break;
    T[i] = T[p]; S[i] = S[p]; TY[i] = TY[p]; A[i] = A[p]; B[i] = B[p];
    i = p;
  }
  T[i] = time; S[i] = seq; TY[i] = type; A[i] = a; B[i] = b;
}

// remove the earliest event into Q.out = { t, type, a, b }; false if empty
export function pop(Q, out) {
  if (Q.n === 0) return false;
  const T = Q.t, S = Q.q, TY = Q.ty, A = Q.a, B = Q.b;
  out.t = T[0]; out.type = TY[0]; out.a = A[0]; out.b = B[0];
  const n = --Q.n;
  if (n === 0) return true;
  const t = T[n], s = S[n], ty = TY[n], a = A[n], b = B[n];
  let i = 0;
  for (;;) { // sift the hole down
    let c = 2 * i + 1;
    if (c >= n) break;
    if (c + 1 < n && (T[c + 1] < T[c] || (T[c + 1] === T[c] && S[c + 1] < S[c]))) c++;
    if (t < T[c] || (t === T[c] && s < S[c])) break;
    T[i] = T[c]; S[i] = S[c]; TY[i] = TY[c]; A[i] = A[c]; B[i] = B[c];
    i = c;
  }
  T[i] = t; S[i] = s; TY[i] = ty; A[i] = a; B[i] = b;
  return true;
}
export const peekTime = (Q) => (Q.n ? Q.t[0] : Infinity);

// compact copy (only the live entries) and its inverse, for snapshots
export function packQueue(Q) {
  return { n: Q.n, seq: Q.seq, t: Q.t.slice(0, Q.n), q: Q.q.slice(0, Q.n), ty: Q.ty.slice(0, Q.n), a: Q.a.slice(0, Q.n), b: Q.b.slice(0, Q.n) };
}
export function unpackQueue(P) {
  const Q = makeQueue(Math.max(1024, P.n * 2));
  Q.n = P.n; Q.seq = P.seq;
  for (const k of ['t', 'q', 'ty', 'a', 'b']) Q[k].set(P[k]);
  return Q;
}
