// dock.js: the dock (a port of Compiler Workbench's dock.js). A layout is a tree of splits (rows and columns, with
// sizes) whose leaves are tiles of tabs. Drag a tab by its label onto another tile's tab strip to move it there,
// onto a tile to add it, or onto a tile's edge to split that tile; drag a gutter to resize. Tabs close with ×,
// + adds a view, ⤢ maximizes a tile, and the Layout menu offers presets. The layout is kept in this browser. On a
// narrow screen every view is a tab of one tile.
import { UI, esc } from './ui.js';

const store = UI.store;
const ALL = ['projects', 'files', 'editor', 'scripts', 'source', 'ir', 'cfg', 'lineage', 'facts', 'pipeline', 'strategies', 'timeline', 'checks', 'rv32', 'run', 'candela', 'console', 'agent', 'book', 'compiler', 'reference', 'code'];
const KEY = 'wb3.layout.v3'; // v2: the Compiler and Strategies views; v3: the Candela view

const T = (tabs, size = 1) => ({ type: 'tile', tabs, active: tabs[0], size });
const R = (children, size = 1) => ({ type: 'split', dir: 'row', children, size });
const C = (children, size = 1) => ({ type: 'split', dir: 'col', children, size });
const LAYOUTS = {
  workbench: {
    title: 'Workbench',
    about: 'project files left, code over runs, agent and book right',
    make: () =>
      R([
        T(['files', 'projects', 'scripts'], 18),
        C([T(['source', 'editor', 'ir', 'cfg', 'lineage', 'facts'], 55), T(['pipeline', 'strategies', 'timeline', 'checks', 'rv32', 'run', 'candela', 'console'], 45)], 52),
        T(['book', 'agent', 'compiler', 'reference', 'code'], 30),
      ]),
  },
  reading: {
    title: 'Reading',
    about: 'the book wide, the agent and the code beside it',
    make: () => R([T(['book', 'reference', 'projects', 'compiler', 'code'], 58), C([T(['agent'], 58), T(['source', 'ir', 'cfg', 'rv32', 'strategies', 'candela', 'console'], 42)], 42)]),
  },
  compiler: {
    title: 'Compiler',
    about: 'source, IR, graph and machine code side by side',
    make: () =>
      R([
        C([T(['source', 'files', 'projects', 'editor'], 50), T(['ir', 'lineage', 'facts'], 50)], 34),
        C([T(['cfg', 'timeline'], 55), T(['pipeline', 'strategies', 'checks', 'console', 'scripts'], 45)], 33),
        C([T(['rv32', 'run', 'candela'], 60), T(['compiler', 'agent', 'book', 'reference', 'code'], 40)], 33),
      ]),
  },
  agent: {
    title: 'Agent',
    about: 'the agent wide, with what it changes beside it',
    make: () =>
      R([
        T(['agent'], 40),
        C([T(['source', 'editor', 'ir', 'cfg', 'rv32'], 58), T(['console', 'scripts', 'pipeline', 'strategies', 'timeline', 'checks', 'run', 'candela', 'lineage', 'facts'], 42)], 40),
        T(['files', 'projects', 'compiler', 'book', 'reference', 'code'], 20),
      ]),
  },
  candela: {
    title: 'Candela',
    about: 'scenes rendered wide, the program and its runs beside them',
    make: () =>
      R([
        T(['candela', 'rv32', 'run'], 55),
        C([T(['projects', 'source', 'ir', 'cfg', 'files'], 55), T(['pipeline', 'checks', 'console', 'book', 'agent', 'compiler', 'strategies', 'reference', 'code', 'editor', 'scripts', 'timeline', 'lineage', 'facts'], 45)], 45),
      ]),
  },
};
const D = (UI.dock = { root: null, tiles: new Map(), maxed: null, narrow: false, layouts: LAYOUTS, drag: null, custom: [] });
// built-in views, and views UI scripts make (u-<script>-<tile>): kept in a saved layout even before their script runs
const known = v => ALL.includes(v) || !!(UI.views && UI.views[v] && UI.views[v].custom) || /^u-[\w-]+$/.test(v);
D.known = known;
let nextId = 1;

// ---------- the tree ----------
function normalize(node, seen = new Set()) {
  if (!node) return null;
  if (node.type === 'tile') {
    node.tabs = (node.tabs || []).filter(v => known(v) && !seen.has(v));
    node.tabs.forEach(v => seen.add(v));
    if (!node.tabs.length) return null;
    if (!node.tabs.includes(node.active)) node.active = node.tabs[0];
    if (!node.id) node.id = 't' + nextId++;
    node.size = +node.size > 0 ? +node.size : 1;
    return node;
  }
  const kids = [];
  for (const c of node.children || []) {
    const n = normalize(c, seen);
    if (!n) continue;
    if (n.type === 'split' && n.dir === node.dir) {
      // a row inside a row is one row
      const sum = n.children.reduce((s, k) => s + k.size, 0);
      for (const k of n.children) {
        k.size = (n.size * k.size) / sum;
        kids.push(k);
      }
    } else kids.push(n);
  }
  if (!kids.length) return null;
  if (kids.length === 1) {
    kids[0].size = node.size || 1;
    return kids[0];
  }
  node.children = kids;
  node.size = +node.size > 0 ? +node.size : 1;
  return node;
}
function parentOf(node, target, parent = null) {
  if (node === target) return parent;
  if (node.type === 'split')
    for (const c of node.children) {
      const p = parentOf(c, target, node);
      if (p !== undefined) return p;
    }
  return undefined;
}
function leaves(node, out = []) {
  if (!node) return out;
  if (node.type === 'tile') out.push(node);
  else node.children.forEach(c => leaves(c, out));
  return out;
}
const save = () => {
  if (!D.narrow) store.set(KEY, JSON.stringify(D.root, (k, v) => (k === 'el' ? undefined : v)));
};
function load() {
  try {
    const t = JSON.parse(store.get(KEY) || 'null');
    const n = t && normalize(t);
    if (n) {
      for (const l of leaves(n)) nextId = Math.max(nextId, (+String(l.id).slice(1) || 0) + 1);
      return n;
    }
  } catch {
    /* a broken saved layout falls back to the default */
  }
  return normalize(LAYOUTS.workbench.make());
}

// ---------- rendering ----------
function tileEl(t) {
  const el = document.createElement('section');
  el.className = 'tile' + (D.maxed === t.id ? ' maxed' : '');
  el.dataset.tile = t.id;
  el.innerHTML = `<div class="dstrip"><div class="dtabs"></div><span class="sp"></span><button class="tabact plus" data-act="add" title="Add a view to this tile">+</button><button class="tabact" data-act="max" title="${D.maxed === t.id ? 'Restore the layout' : 'Maximize this tile'}">${D.maxed === t.id ? '⤡' : '⤢'}</button></div><div class="tilebody"></div>`;
  t.el = el;
  D.tiles.set(t.id, t);
  return el;
}
function nodeEl(node) {
  if (node.type === 'tile') return tileEl(node);
  const el = document.createElement('div');
  el.className = 'dsplit ' + node.dir;
  node.children.forEach((c, i) => {
    if (i) el.appendChild(gutter(node, i - 1));
    const k = nodeEl(c);
    k.style.flex = `${c.size} 1 0`;
    el.appendChild(k);
  });
  node.el = el;
  return el;
}
D.build = function build() {
  const dock = document.getElementById('dock');
  D.narrow = window.innerWidth < 760;
  dock.innerHTML = '';
  D.tiles.clear();
  if (D.narrow) {
    const saved = store.get('wb.narrow.active');
    // the project's own tiles come first, right after the list of projects, so they are easy to find
    const one = {
      type: 'tile',
      id: 'one',
      tabs: ['projects', ...D.custom.filter(v => UI.views[v]), 'source', 'files', 'scripts', 'editor', 'ir', 'cfg', 'pipeline', 'strategies', 'timeline', 'checks', 'rv32', 'run', 'candela', 'console', 'lineage', 'facts', 'agent', 'book', 'compiler', 'reference', 'code'],
      size: 1,
    };
    one.active = one.tabs.includes(saved) ? saved : 'projects';
    D.narrowRoot = one;
    dock.appendChild(tileEl(one));
  } else {
    if (!D.root) D.root = load();
    const maxed = D.maxed && leaves(D.root).find(t => t.id === D.maxed);
    if (D.maxed && !maxed) D.maxed = null;
    dock.appendChild(maxed ? tileEl(maxed) : nodeEl(D.root));
  }
  for (const t of D.tiles.values()) {
    renderStrip(t);
    renderTile(t);
  }
};
function renderStrip(t) {
  const strip = t.el.querySelector('.dtabs');
  const single = !D.narrow && leaves(D.root).length === 1 && t.tabs.length === 1;
  strip.innerHTML = t.tabs
    .map(v => {
      const view = UI.views[v] || { title: v.replace(/^u-/, '') };
      let count = null;
      try {
        count = view.count ? view.count() : null;
      } catch {
        count = null;
      }
      return `<div class="dtab${v === t.active ? ' on' : ''}" data-view="${v}"><button class="lbl" title="${D.narrow ? '' : 'Drag to move this view, or onto an edge to split'}">${esc(view.title)}${count !== null && count !== undefined && count !== '' ? ` <span class="count${view.countBad && view.countBad() ? ' bad' : ''}">${esc(count)}</span>` : ''}</button>${D.narrow || single ? '' : `<button class="x" data-close="${v}" title="Close ${esc(view.title)}">×</button>`}</div>`;
    })
    .join('');
  const on = strip.querySelector('.dtab.on');
  if (on && (on.offsetLeft < strip.scrollLeft || on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth)) strip.scrollLeft = on.offsetLeft - 8;
}
function renderTile(t) {
  const body = t.el.querySelector('.tilebody'),
    view = UI.views[t.active];
  if (!view) {
    body.innerHTML = `<p class="empty padded">${/^u-/.test(t.active) ? 'This tile comes from a UI script that is not running: open its project, or turn the script on in the Scripts view.' : 'No view ' + esc(t.active)}</p>`;
    return;
  }
  try {
    view.render(body, { wb: UI.wb, p: UI.wb.current, S: UI.S, UI });
  } catch (e) {
    body.innerHTML = `<div class="fail padded"><b>This view failed.</b> ${esc(e.message)}</div>`;
    console.error(e);
  }
}
D.refresh = function refresh(which) {
  for (const t of D.tiles.values()) {
    renderStrip(t);
    const v = UI.views[t.active];
    if (!which || (v && v.on && v.on.some(e => which.includes(e))) || which.includes(t.active)) renderTile(t);
  }
};
D.where = view => [...D.tiles.values()].find(t => t.tabs.includes(view)) || null;
D.open = function open(view) {
  if (!known(view) || !UI.views[view]) return false;
  let t = D.where(view);
  if (!t && !D.narrow) {
    if (D.maxed) D.maxed = null;
    const all = leaves(D.root);
    t = D.where(view) || all.find(x => x.tabs.includes(view));
    if (!t) {
      // add it to the largest tile
      const area = x => {
        const r = x.el ? x.el.getBoundingClientRect() : { width: 0, height: 0 };
        return r.width * r.height;
      };
      t = all.slice().sort((a, b) => area(b) - area(a))[0];
      t.tabs.push(view);
    }
    t.active = view;
    save();
    D.build();
    return true;
  }
  if (!t && D.narrow) {
    store.set('wb.narrow.active', view);
    D.build();
    t = D.where(view);
    if (t) return true;
  }
  if (!t) return false;
  t.active = view;
  if (D.narrow) store.set('wb.narrow.active', view);
  else save();
  renderStrip(t);
  renderTile(t);
  return true;
};
// where a UI script's tile goes: next to a view, or as a tab with it. A tile the person has already moved (it is
// in the saved layout) stays where they put it.
let buildQueued = false;
const buildSoon = () => {
  if (!buildQueued) {
    buildQueued = true;
    queueMicrotask(() => {
      buildQueued = false;
      D.build();
    });
  }
};
D.placeView = function placeView(vid, place = {}, size = 0.4) {
  if (!D.custom.includes(vid)) D.custom.push(vid);
  if (D.narrow) {
    buildSoon();
    return;
  }
  if (D.where(vid) || leaves(D.root).some(t => t.tabs.includes(vid))) {
    const t = leaves(D.root).find(x => x.tabs.includes(vid));
    if (t && t.el) {
      renderStrip(t);
      if (t.active === vid) renderTile(t);
    }
    return;
  }
  const all = leaves(D.root);
  const [how, target] = Object.entries(place).find(([k]) => k !== 'size') || ['tabWith', 'pipeline'];
  let t = all.find(x => x.tabs.includes(target));
  if (!t) {
    const area = x => {
      const r = x.el ? x.el.getBoundingClientRect() : { width: 0, height: 0 };
      return r.width * r.height;
    };
    t = all.slice().sort((a, b) => area(b) - area(a))[0];
  }
  if (how === 'tabWith' || how === 'replace' || !t) {
    t.tabs.push(vid);
    t.active = vid;
  } else {
    const fresh = { type: 'tile', tabs: [vid], active: vid, size: 1 };
    const dir = how === 'splitLeft' || how === 'splitRight' ? 'row' : 'col',
      before = how === 'splitLeft' || how === 'splitAbove';
    const f = Math.max(0.15, Math.min(0.85, +size || 0.4));
    const parent = parentOf(D.root, t);
    if (parent && parent.dir === dir) {
      const k = parent.children.indexOf(t);
      fresh.size = t.size * f;
      t.size *= 1 - f;
      parent.children.splice(before ? k : k + 1, 0, fresh);
    } else {
      const split = { type: 'split', dir, size: t.size, children: before ? [fresh, t] : [t, fresh] };
      fresh.size = f;
      t.size = 1 - f;
      if (parent) parent.children[parent.children.indexOf(t)] = split;
      else D.root = split;
    }
  }
  D.root = normalize(D.root);
  save();
  buildSoon();
};
D.removeView = function removeView(vid) {
  D.custom = D.custom.filter(v => v !== vid);
  if (D.narrow) {
    buildSoon();
    return;
  }
  if (!leaves(D.root).some(t => t.tabs.includes(vid))) return;
  for (const t of leaves(D.root)) t.tabs = t.tabs.filter(v => v !== vid);
  D.root = normalize(D.root) || normalize(LAYOUTS.workbench.make());
  save();
  buildSoon();
};
D.refreshStrips = function refreshStrips() {
  for (const t of D.tiles.values()) renderStrip(t);
};
D.applyLayout = function applyLayout(name) {
  const L = LAYOUTS[name];
  if (!L) return;
  D.maxed = null;
  D.root = normalize(L.make());
  const extra = D.custom.filter(v => UI.views[v]);
  if (extra.length) {
    const t = leaves(D.root).sort((a, b) => b.size - a.size)[0];
    t.tabs.push(...extra);
  }
  save();
  D.build();
};

// ---------- gutters ----------
function gutter(split, i) {
  const g = document.createElement('div');
  const row = split.dir === 'row';
  g.className = 'gutter ' + split.dir;
  g.tabIndex = 0;
  g.title = 'Drag to resize';
  g.addEventListener('pointerdown', e => {
    e.preventDefault();
    const a = split.children[i],
      b = split.children[i + 1];
    const ra = a.el.getBoundingClientRect(),
      rb = b.el.getBoundingClientRect();
    const pa = row ? ra.width : ra.height,
      pb = row ? rb.width : rb.height,
      total = pa + pb,
      sizes = a.size + b.size;
    const start = row ? e.clientX : e.clientY;
    document.body.classList.add(row ? 'resizing-x' : 'resizing-y');
    const move = ev => {
      const na = Math.max(120, Math.min(total - 120, pa + (row ? ev.clientX : ev.clientY) - start));
      a.size = (sizes * na) / total;
      b.size = sizes - a.size;
      a.el.style.flex = `${a.size} 1 0`;
      b.el.style.flex = `${b.size} 1 0`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-x', 'resizing-y');
      save();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  g.addEventListener('keydown', e => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const a = split.children[i],
      b = split.children[i + 1],
      d = (a.size + b.size) * 0.04 * step;
    if (a.size + d > 0.05 && b.size - d > 0.05) {
      a.size += d;
      b.size -= d;
      a.el.style.flex = `${a.size} 1 0`;
      b.el.style.flex = `${b.size} 1 0`;
      save();
    }
  });
  return g;
}

// ---------- dragging tabs ----------
const SIDES = { left: 'Split: new tile on the left', right: 'Split: new tile on the right', top: 'Split: new tile above', bottom: 'Split: new tile below' };
function target(x, y) {
  const d = D.drag;
  const el = document.elementFromPoint(x, y);
  const tEl = el && el.closest('.tile[data-tile]');
  if (!tEl) return null;
  const t = D.tiles.get(tEl.dataset.tile);
  if (!t) return null;
  const strip = el.closest('.dstrip');
  if (strip) {
    const tabs = [...strip.querySelectorAll('.dtab')];
    let index = tabs.length;
    for (let k = 0; k < tabs.length; k++) {
      const r = tabs[k].getBoundingClientRect();
      if (x < r.left + r.width / 2) {
        index = k;
        break;
      }
    }
    const sr = strip.getBoundingClientRect();
    const at = index < tabs.length ? tabs[index].getBoundingClientRect().left : tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : sr.left + 4;
    return { kind: 'tab', tile: t, index, rect: { left: at - 1, top: sr.top + 4, width: 2, height: sr.height - 8 }, marker: true };
  }
  const r = tEl.getBoundingClientRect();
  const fx = (x - r.left) / r.width,
    fy = (y - r.top) / r.height;
  const edges = [
    ['left', fx],
    ['right', 1 - fx],
    ['top', fy],
    ['bottom', 1 - fy],
  ].sort((a, b) => a[1] - b[1]);
  const lone = t === d.from && t.tabs.length === 1;
  if (edges[0][1] < 0.25 && !lone) {
    const side = edges[0][0];
    const rect =
      side === 'left'
        ? { left: r.left, top: r.top, width: r.width / 2, height: r.height }
        : side === 'right'
          ? { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height }
          : side === 'top'
            ? { left: r.left, top: r.top, width: r.width, height: r.height / 2 }
            : { left: r.left, top: r.top + r.height / 2, width: r.width, height: r.height / 2 };
    return { kind: 'split', side, tile: t, rect, label: SIDES[side] };
  }
  if (t === d.from) return null;
  return { kind: 'center', tile: t, rect: { left: r.left, top: r.top, width: r.width, height: r.height }, label: 'Move into this tile' };
}
function showHint(tg) {
  let h = document.querySelector('.drop-hint');
  if (!tg) {
    if (h) h.style.display = 'none';
    return;
  }
  if (!h) {
    h = document.createElement('div');
    h.className = 'drop-hint';
    document.body.appendChild(h);
  }
  h.style.display = '';
  h.classList.toggle('marker', !!tg.marker);
  Object.assign(h.style, { left: tg.rect.left + 'px', top: tg.rect.top + 'px', width: tg.rect.width + 'px', height: tg.rect.height + 'px' });
  h.innerHTML = tg.label ? `<span>${esc(tg.label)}</span>` : '';
}
function drop(tg) {
  const d = D.drag,
    view = d.view,
    from = d.from;
  if (!tg) return;
  const fromIndex = from.tabs.indexOf(view);
  if (tg.kind === 'tab') {
    let index = tg.index;
    if (tg.tile === from && fromIndex < index) index--;
    from.tabs.splice(fromIndex, 1);
    tg.tile.tabs.splice(index, 0, view);
    tg.tile.active = view;
  } else if (tg.kind === 'center') {
    from.tabs.splice(fromIndex, 1);
    tg.tile.tabs.push(view);
    tg.tile.active = view;
  } else if (tg.kind === 'split') {
    from.tabs.splice(fromIndex, 1);
    if (from.active === view) from.active = from.tabs[0];
    const fresh = { type: 'tile', tabs: [view], active: view, size: 1 };
    const t = tg.tile,
      dir = tg.side === 'left' || tg.side === 'right' ? 'row' : 'col',
      before = tg.side === 'left' || tg.side === 'top';
    const parent = parentOf(D.root, t);
    if (parent && parent.dir === dir) {
      const k = parent.children.indexOf(t);
      t.size /= 2;
      fresh.size = t.size;
      parent.children.splice(before ? k : k + 1, 0, fresh);
    } else {
      const split = { type: 'split', dir, size: t.size, children: before ? [fresh, t] : [t, fresh] };
      t.size = 1;
      fresh.size = 1;
      if (parent) parent.children[parent.children.indexOf(t)] = split;
      else D.root = split;
    }
  }
  if (from.active === view && from.tabs.length) from.active = from.tabs[0];
  D.maxed = null;
  D.root = normalize(D.root);
  save();
  D.build();
}
document.addEventListener('pointerdown', e => {
  const lbl = e.target.closest('.dtab .lbl');
  if (!lbl || D.narrow || e.button !== 0) return;
  const tile = D.tiles.get(lbl.closest('.tile').dataset.tile);
  D.drag = { view: lbl.closest('.dtab').dataset.view, from: tile, x0: e.clientX, y0: e.clientY, started: false, tg: null };
  const move = ev => {
    const d = D.drag;
    if (!d) return;
    if (!d.started) {
      if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 6) return;
      d.started = true;
      document.body.classList.add('dragging-view');
      const gh = document.createElement('div');
      gh.className = 'drag-ghost';
      gh.innerHTML = `${esc((UI.views[d.view] || { title: d.view }).title)} <small>onto a tab strip, a tile, or an edge</small>`;
      document.body.appendChild(gh);
      d.ghost = gh;
    }
    d.ghost.style.left = ev.clientX + 12 + 'px';
    d.ghost.style.top = ev.clientY + 12 + 'px';
    d.tg = target(ev.clientX, ev.clientY);
    showHint(d.tg);
  };
  const end = ev => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    const d = D.drag;
    D.drag = null;
    if (!d) return;
    document.body.classList.remove('dragging-view');
    if (d.ghost) d.ghost.remove();
    showHint(null);
    if (d.started) {
      D.suppressClick = true;
      setTimeout(() => {
        D.suppressClick = false;
      }, 0);
      if (ev.type === 'pointerup') {
        D.drag = d;
        drop(d.tg);
        D.drag = null;
      }
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && D.drag) {
    const d = D.drag;
    D.drag = null;
    document.body.classList.remove('dragging-view');
    if (d.ghost) d.ghost.remove();
    showHint(null);
    D.suppressClick = true;
    setTimeout(() => {
      D.suppressClick = false;
    }, 0);
  }
});

// ---------- tab strip buttons: activate, close, add, maximize ----------
document.addEventListener(
  'click',
  e => {
    if (D.suppressClick) {
      e.stopPropagation();
      return;
    }
    const close = e.target.closest('[data-close]');
    if (close) {
      const t = D.tiles.get(close.closest('.tile').dataset.tile),
        v = close.dataset.close;
      t.tabs = t.tabs.filter(x => x !== v);
      D.root = normalize(D.root);
      save();
      D.build();
      UI.toast(`Closed ${(UI.views[v] || { title: v }).title}. + in any tile adds it back.`);
      return;
    }
    const act = e.target.closest('.tabact[data-act]');
    if (act && act.closest('.dstrip')) {
      const t = D.tiles.get(act.closest('.tile').dataset.tile);
      if (act.dataset.act === 'max') {
        D.maxed = D.maxed === t.id ? null : t.id;
        D.build();
        return;
      }
      if (act.dataset.act === 'add') {
        addMenu(act, t);
        e.stopPropagation();
        return;
      }
    }
    const pick = e.target.closest('[data-addview]');
    if (pick) {
      const m = pick.closest('.menu'),
        t = D.tiles.get(m.dataset.tile),
        v = pick.dataset.addview;
      m.remove();
      const other = D.where(v);
      if (other === t) {
        D.open(v);
        return;
      }
      if (other) other.tabs = other.tabs.filter(x => x !== v);
      t.tabs.push(v);
      t.active = v;
      D.root = normalize(D.root);
      save();
      D.build();
      return;
    }
    const tab = e.target.closest('.dtab');
    if (tab && !e.target.closest('[data-close]')) {
      UI.open(tab.dataset.view);
      return;
    }
    if (!e.target.closest('.menu.addview')) document.querySelectorAll('.menu.addview').forEach(m => m.remove());
  },
  true,
);
function addMenu(btn, t) {
  document.querySelectorAll('.menu.addview').forEach(m => m.remove());
  const m = document.createElement('div');
  m.className = 'menu floating addview';
  m.dataset.tile = t.id;
  const shown = new Set([...D.tiles.values()].flatMap(x => x.tabs));
  const every = [...ALL, ...D.custom.filter(v => UI.views[v])];
  const hidden = every.filter(v => !shown.has(v)),
    elsewhere = every.filter(v => shown.has(v) && !t.tabs.includes(v));
  m.innerHTML = `<div class="mh">Add a view to this tile</div>${hidden.map(v => `<button data-addview="${v}"><span class="t">${esc(UI.views[v].title)}</span><small>closed</small></button>`).join('') || '<p class="note">Every view is open somewhere.</p>'}${elsewhere.length ? `<hr><div class="mh">Move here from another tile</div>${elsewhere.map(v => `<button data-addview="${v}"><span class="t">${esc(UI.views[v].title)}</span></button>`).join('')}` : ''}`;
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = r.bottom + 4 + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
}
D.layoutMenu = function layoutMenu(btn) {
  const old = document.querySelector('.menu.layoutpick');
  if (old) {
    old.remove();
    return;
  }
  const m = document.createElement('div');
  m.className = 'menu floating layouts layoutpick';
  m.innerHTML = `<div class="mh">Layouts <small>drag tabs to make your own; it is kept in this browser</small></div>${Object.entries(LAYOUTS)
    .map(([k, L]) => `<button data-layout="${k}"><span class="t">${esc(L.title)}</span><small>${esc(L.about)}</small></button>`)
    .join('')}<hr><button data-layout="workbench"><span class="t">Reset</span><small>back to the default layout</small></button>`;
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = r.bottom + 6 + 'px';
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-layout]');
    if (b) {
      m.remove();
      D.applyLayout(b.dataset.layout);
    }
  });
  setTimeout(() =>
    document.addEventListener('click', function off(ev) {
      if (!ev.target.closest('.layoutpick') && ev.target !== btn) {
        m.remove();
        document.removeEventListener('click', off);
      }
    }),
  );
};
