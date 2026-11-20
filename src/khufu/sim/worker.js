// The event model in a Web Worker, so the 2.5 s full run and every seek stay off the page's
// main thread. Protocol (all messages are plain objects):
//
//   page → worker  { type: 'init', overrides }          run the whole build once
//                  { type: 'seek', id, t }               position the model at time t (s)
//   worker → page  { type: 'progress', month, t }        while the build runs
//                  { type: 'ready', summary, ms }        see runSummary() in view.js
//                  { type: 'state', id, t, ms, view, layout? }
//                      view: viewState() at t; layout: courseLayout() of the course being
//                      laid, sent only when that course changes since the previous reply
//                  { type: 'error', message }
//
// The page keeps at most one seek in flight and only ever asks for the latest time it
// wants, so dragging the timeline never queues up stale seeks (see timeline.js).
import { runFull } from './index.js';
import { viewState, courseLayout, runSummary, seeker } from './view.js';

let run = null, at = null, sentCourse = -2;

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const t0 = performance.now();
      run = runFull(m.overrides || {}, { onMonth: (s, k) => { if (k % 3 === 0) self.postMessage({ type: 'progress', month: k, t: s.t }); } });
      at = seeker(run);
      const summary = runSummary(run);
      self.postMessage({ type: 'ready', summary, ms: performance.now() - t0 }, [summary.blocksByDay.buffer]);
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
      const tr = msg.layout ? [msg.layout.cells.buffer, msg.layout.type.buffer, msg.layout.off.buffer, msg.layout.heavy.buffer] : [];
      self.postMessage(msg, tr);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};
