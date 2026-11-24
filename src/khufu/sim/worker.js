// The event model in a Web Worker, so the 2.5 s full run and every seek stay off the page's
// main thread. Protocol (all messages are plain objects):
//
//   page → worker  { type: 'init', overrides }          run the whole build once
//                  { type: 'seek', id, t }               position the model at time t (s)
//                  { type: 'compare', id, overrides }    run the build once with ramp theory `id`
//                      and post theoryStats() (sim/compare.js); used by spare workers that
//                      fill the page's comparison of the ramp theories
//   worker → page  { type: 'progress', month, t }        while the build runs
//                  { type: 'ready', summary, ms }        see runSummary() in view.js
//                  { type: 'state', id, t, ms, view, layout?, gangs }
//                      view: viewState() at t; layout: courseLayout() of the course being
//                      laid, sent only when that course changes since the previous reply;
//                      gangs: { n, ramps?, trips } from gangTracker() (gangs.js): the trips
//                      of the gangs whose trip changed since the previous reply, and the
//                      ramps as drawn when they changed
//                  { type: 'compared', stats, ms }
//                  { type: 'error', message }
//
// The page keeps at most one seek in flight and only ever asks for the latest time it
// wants, so dragging the timeline never queues up stale seeks (see timeline.js).
import { runFull } from './index.js';
import { viewState, courseLayout, runSummary, seeker } from './view.js';
import { gangTracker } from './gangs.js';
import { compareTheories } from './compare.js';

let run = null, at = null, sentCourse = -2;
const tracker = gangTracker();

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const t0 = performance.now();
      run = runFull(m.overrides || {}, { onMonth: (s, k) => { if (k % 3 === 0) self.postMessage({ type: 'progress', month: k, t: s.t }); } });
      at = seeker(run);
      tracker.reset(); sentCourse = -2;
      const summary = runSummary(run);
      self.postMessage({ type: 'ready', summary, ms: performance.now() - t0 }, [summary.blocksByDay.buffer]);
    } else if (m.type === 'compare') {
      const t0 = performance.now();
      const [stats] = compareTheories(m.overrides || {}, [m.id]);
      delete stats.perYear;
      self.postMessage({ type: 'compared', stats, ms: performance.now() - t0 });
    } else if (m.type === 'seek') {
      if (!run) return;
      const t0 = performance.now();
      const s = at.seekTo(m.t);
      const ms = performance.now() - t0;
      const view = viewState(s);
      const msg = { type: 'state', id: m.id, t: m.t, ms, view };
      const ci = view.course ? view.course.ci : -1;
      if (ci !== sentCourse) {
        sentCourse = ci;
        if (ci >= 0) msg.layout = courseLayout(s, ci);
        else msg.layout = null;
      }
      const g0 = performance.now(), g = tracker.update(s);
      msg.gangs = { n: g.gangs, ramps: g.ramps, trips: g.trips };
      msg.gangMs = performance.now() - g0; // building the gang trips alone
      const tr = new Set(msg.layout ? [msg.layout.cells.buffer, msg.layout.type.buffer, msg.layout.elem.buffer, msg.layout.off.buffer, msg.layout.heavy.buffer] : []);
      for (const trip of g.trips) { tr.add(trip.knots.buffer); for (const p of trip.paths) if (typeof p !== 'number') tr.add(p.buffer); }
      self.postMessage(msg, [...tr]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};
