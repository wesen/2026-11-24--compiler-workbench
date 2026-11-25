// ui.js: the namespace every UI module adds to (views, the dock, the DSL, the agent), and the small helpers they
// share: HTML escaping, browser storage, toasts and error guards. A port of the top of Compiler Workbench's md.js.
export const UI = {};

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
UI.esc = esc;

UI.store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

UI.toast = function toast(text, bad = false) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = text.length > 240 ? text.slice(0, 240) + '…' : text;
  box.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 2600);
};

const report = e => {
  if (e && e.name === 'Suspend') return; // a replay in progress, not an error
  UI.toast(String((e && e.message) || e).split('\n')[0], true);
  console.error(e);
};
/** Wrap a handler: an error becomes a toast; an async handler's rejection too. */
UI.guarded =
  fn =>
  (...a) => {
    try {
      const r = fn(...a);
      if (r && typeof r.then === 'function') r.catch(report);
      return r;
    } catch (e) {
      report(e);
    }
  };
