// candela.js: the Candela view (new in this build). It renders the Candela gallery's scenes with the Typed Candela
// program on an engine the page can run, row by row, yielding to the page between spans:
//   emulator   the reference compiler's RV32 image (policy kernel or stock) on the RV32 interpreter
//   evaluator  this compiler's evaluator on the lifted program at r0, or at the open Candela project's revision
// The program, its scene table and the reference compiler load only when this view opens (scripts with integrity
// hashes; see tools/build-site.mjs). Pass p renders at Candela's frame index 0, then p + 1, and colour is summed per
// pixel as the gallery does. Every finished render is kept, so two engines' frames can be compared bit for bit.
import { UI, esc } from './ui.js';
import {
  setVendor,
  parseSceneTable,
  candelaSource,
  candelaProject,
  candelaHost,
  referenceEngine,
  evaluatorEngine,
  imageEngine,
  candelaArtifact,
  liftCandela,
  renderProgressive,
  frameImage,
  compareFrames,
  partsRef,
  partsOf,
  partHash,
  partText,
} from './wb.js';

// ---------- the engine worker (IRWB-004 F4) ----------
// Engines run in a Web Worker (candela/engine-worker.js) unless UI.S.cdl.where is 'page', so a render never holds the
// page. The worker gets the Candela data once; a project revision travels as function parts, and only the parts the
// worker does not have yet (src/typed/parts.ts), so after the first render of a revision the next one sends a few.
let worker = null;
const sentParts = new Set();
function engineWorker() {
  if (worker) return worker;
  const lazy = UI.content.lazy.candela.worker;
  if (!lazy || typeof Worker === 'undefined') return null;
  const w = new Worker(lazy.src);
  const waiting = new Map();
  let next = 1;
  w.onmessage = e => {
    const m = e.data,
      job = waiting.get(m.id);
    if (!job) return;
    if (m.ok || m.error) {
      waiting.delete(m.id);
      if (m.error) job.reject(new Error(m.error));
      else job.resolve(m);
    } else job.onEvent?.(m);
  };
  w.onerror = e => {
    for (const job of waiting.values()) job.reject(new Error(`the engine worker failed: ${e.message || 'error'}`));
    waiting.clear();
    worker = null;
  };
  const call = (msg, onEvent, transfer) => {
    const id = next++;
    const p = new Promise((resolve, reject) => waiting.set(id, { resolve, reject, onEvent }));
    w.postMessage({ ...msg, id }, transfer || []);
    return { id, done: p };
  };
  worker = { w, call, stop: id => w.postMessage({ type: 'stop', id }) };
  call({ type: 'init', data: UI.candela.data });
  return worker;
}
// The parts of `art` the worker lacks, made a few at a time so the page keeps responding
async function partsFor(art) {
  const out = [];
  let last = performance.now();
  for (const p of partsOf(art.value).values()) {
    const h = partHash(p);
    if (sentParts.has(h)) continue;
    out.push([h, partText(p)]);
    if (performance.now() - last > 30) {
      await new Promise(r => setTimeout(r, 0));
      last = performance.now();
    }
  }
  return out;
}
async function workerRender(eng, scene, st, onEvent) {
  const wk = engineWorker();
  const msg = { type: 'render', engine: eng.key, label: eng.label, scene: scene.id, stride: st.stride, passes: st.passes };
  if (eng.art) {
    msg.program = partsRef(eng.art.revision, eng.art.value, true);
    msg.parts = await partsFor(eng.art);
  }
  const job = wk.call(msg, onEvent);
  st.job.workerId = job.id;
  const m = await job.done;
  for (const [h] of msg.parts || []) sentParts.add(h);
  return m.frame;
}

const V = (UI.views = UI.views || {});
const S = () =>
  (UI.S.cdl ??= {
    scene: 'B-01',
    engine: 'kernel',
    stride: 4,
    view: 'colour',
    passes: 1,
    job: null,
    live: null,
    history: [],
    error: null,
    loadError: null,
  });

// ---------- loading on demand ----------
let loading = null;
UI.loadCandela = function loadCandela() {
  if (UI.candela) return Promise.resolve(UI.candela);
  if (loading) return loading;
  const { candela: lazy } = UI.content.lazy;
  const add = a =>
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = a.src;
      s.integrity = a.integrity;
      s.async = false; // the compiler's pass groups run after its core
      s.onload = resolve;
      s.onerror = () => reject(new Error(`${a.src} did not load (or its integrity hash did not match)`));
      document.head.appendChild(s);
    });
  const t0 = performance.now();
  loading = Promise.all([...lazy.compiler.map(add), add(lazy.data)]).then(() => {
    setVendor({ typedRv32: globalThis.typedRv32 });
    const data = globalThis.candelaData;
    UI.candela = {
      data,
      scenes: parseSceneTable(data.scenes),
      source: candelaSource(data),
      r0: null,
      loadMs: performance.now() - t0,
    };
    UI.wb._projects.addBuiltin(candelaProject(data));
    return UI.candela;
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
};

// ---------- engines ----------
const projectOpen = () => {
  const p = UI.wb.current;
  return p && p.project === 'candela' && p.status === 'ok' ? p : null;
};
function engines() {
  const p = projectOpen();
  return [
    { key: 'kernel', label: 'emulator · reference (kernel)' },
    { key: 'stock', label: 'emulator · reference (stock)' },
    { key: 'r0', label: 'evaluator · r0 (lifted)' },
    {
      key: 'head',
      label: p ? `evaluator · ${p.rev} (project)` : 'evaluator · project (open it below)',
      off: !p,
    },
    { key: 'own', label: p ? `our RV32 image · ${p.rev} (project)` : 'our RV32 image · r0' },
  ];
}
function makeEngine(key) {
  const c = UI.candela;
  if (key === 'kernel' || key === 'stock') return referenceEngine(c.source, key);
  if (key === 'r0') {
    const t0 = performance.now();
    const fresh = !c.r0;
    c.r0 ??= liftCandela(c.source);
    const e = evaluatorEngine(c.r0, 'evaluator · r0 (lifted)');
    return { ...e, setupMs: fresh ? performance.now() - t0 : 0 };
  }
  if (key === 'head') {
    const p = projectOpen();
    if (!p) throw new Error('open the Candela project first (below)');
    return evaluatorEngine(p._p.head, `evaluator · ${p.rev} of the Candela project`);
  }
  if (key === 'own') {
    const p = projectOpen();
    if (p) return imageEngine(p._p.head, `our RV32 image · ${p.rev} of the Candela project`);
    // r0 lifted, hashed into an artifact once, then lowered by this compiler's backend
    const t0 = performance.now();
    c.r0 ??= liftCandela(c.source);
    const art = candelaArtifact(c.r0);
    const hashed = performance.now() - t0;
    const e = imageEngine(art, 'our RV32 image · r0');
    return { ...e, setupMs: e.setupMs + hashed };
  }
  throw new Error(`unknown engine ${key}`);
}

// ---------- drawing ----------
let el = null,
  drawSoon = null;
function draw() {
  drawSoon = null;
  if (!el || !el.isConnected) return;
  const st = S(),
    f = st.live;
  const cv = el.querySelector('canvas');
  if (!cv || !f) return;
  cv.hidden = false;
  if (cv.width !== f.width || cv.height !== f.height) {
    cv.width = f.width;
    cv.height = f.height;
  }
  // IRWB-004: a canvas kept in memory (willReadFrequently): putImageData then never waits on the GPU process, which
  // held the page for 0.6-3 s per update while a render was drawn progressively (CanvasRenderingContext2D::FinalizeFrame)
  cv.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(frameImage(f, st.view), f.width, f.height), 0, 0);
}
const scheduleDraw = () => {
  if (!drawSoon) drawSoon = setTimeout(draw, 80);
};
const fmt = n => Math.round(n).toLocaleString('en-GB');
const secs = ms => `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
function statsHtml() {
  const st = S(),
    j = st.job,
    f = st.live;
  if (j && j.phase === 'loading')
    return '<p class="cv-busy">loading the Candela program and the reference compiler…</p>';
  if (j && j.phase === 'engine') return `<p class="cv-busy">preparing ${esc(j.label)}…</p>`;
  if (!f) return '<p class="dim">Pick a scene and an engine, then Render.</p>';
  const h = j ? j.entry : st.history[0];
  const unit = h ? h.unit : 'steps';
  const rows = [
    ['scene', `${esc(f.scene)} · ${f.width}×${f.height} (stride ${f.stride})`],
    ['engine', esc(h ? h.label : '')],
  ];
  if (h && h.setupMs) rows.push(['setup', `${secs(h.setupMs)} (compiling or lifting, once)`]);
  rows.push(['sky table', f.skyMs ? `${secs(f.skyMs)} · ${fmt(f.skySteps)} ${unit}` : j ? 'building…' : '']);
  if (f.pixelsDone) rows.push([unit, `${fmt(f.steps)} · ${fmt(f.steps / f.pixelsDone)} per pixel`]);
  rows.push([
    'time',
    `${secs(f.ms)}${f.pixelsDone && f.ms > f.skyMs ? ` · ${fmt((f.pixelsDone * 1000) / (f.ms - f.skyMs))} pixels/s` : ''}`,
  ]);
  const passes = h ? h.passes : 1;
  if (j && j.progress)
    rows.push([
      'progress',
      `pass ${j.progress.pass + 1} of ${passes} · row ${j.progress.row} of ${j.progress.rows}`,
    ]);
  else rows.push(['passes', `${f.passesDone} of ${passes}${f.stopped ? ' · stopped' : ''}`]);
  const cmp = h && h.compare && h.compare.length ? h.compare : null;
  return `<table class="rt kvt">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}${
    cmp
      ? cmp
          .map(
            c =>
              `<tr><th>bits</th><td class="${c.different || c.accDifferent ? 'bad' : 'good'}">${c.different || c.accDifferent ? `${fmt(c.different)} of ${fmt(c.floats)} floats differ` : `identical: all ${fmt(c.floats)} floats`} from ${esc(c.label)}</td></tr>`,
          )
          .join('')
      : ''
  }</table>`;
}
function paintStats() {
  const s = el && el.querySelector('[data-cdlstats]');
  if (s) s.innerHTML = statsHtml();
}

// ---------- rendering ----------
async function render() {
  const st = S();
  if (st.job) return;
  st.error = null;
  st.job = { phase: 'loading', signal: { aborted: false } };
  paint();
  let c;
  try {
    c = await UI.loadCandela();
  } catch (e) {
    st.job = null;
    st.loadError = e.message;
    paint();
    return;
  }
  const scene = c.scenes.find(s => s.id === st.scene) || c.scenes[0];
  const label = engines().find(e => e.key === st.engine).label;
  st.job.phase = 'engine';
  st.job.label = label;
  paint();
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const where = st.where === 'page' || !engineWorker() ? 'page' : 'worker';
  let eng;
  try {
    if (where === 'page') eng = makeEngine(st.engine);
    else {
      // the worker makes the engine; a project revision goes with the render as parts
      const p = projectOpen();
      if (st.engine === 'head' && !p) throw new Error('open the Candela project first (below)');
      eng = {
        key: st.engine,
        label: st.engine === 'head' ? `evaluator · ${p.rev} of the Candela project` : st.engine === 'own' && p ? `our RV32 image · ${p.rev} of the Candela project` : label,
        unit: st.engine === 'r0' || st.engine === 'head' ? 'statements' : 'instructions',
        setupMs: 0,
        art: (st.engine === 'head' || st.engine === 'own') && p ? p._p.head : null,
      };
    }
  } catch (e) {
    st.job = null;
    st.error = e.message;
    paint();
    return;
  }
  const entry = {
    key: st.engine,
    where,
    label: eng.label + (where === 'worker' ? '' : ' (in the page)'),
    unit: eng.unit,
    setupMs: eng.setupMs,
    scene: scene.id,
    stride: st.stride,
    passes: st.passes,
    frame: null,
    compare: [],
  };
  st.job.phase = 'render';
  st.job.entry = entry;
  st.live = null;
  paint();
  try {
    const onProgress = p => {
      st.job.progress = p;
      st.live = p.frame;
      scheduleDraw();
      paintStats();
    };
    const frame =
      where === 'worker'
        ? await workerRender(eng, scene, st, m => {
            if (m.engine) {
              entry.setupMs = m.engine.setupMs;
              entry.unit = m.engine.unit;
            } else if (m.progress) onProgress({ ...m.progress, frame: m.frame });
          })
        : await renderProgressive(candelaHost(eng), scene, {
            stride: st.stride,
            passes: st.passes,
            signal: st.job.signal,
            onProgress,
          });
    entry.frame = frame;
    // frames of the same scene and stride from other engines (or the same engine elsewhere): compare their bits
    for (const h of st.history)
      if (
        h.frame &&
        (h.key !== entry.key || h.where !== entry.where) &&
        h.scene === entry.scene &&
        h.stride === entry.stride &&
        !h.frame.stopped &&
        !frame.stopped
      ) {
        const r = compareFrames(frame, h.frame);
        if (r) entry.compare.push({ label: h.label, ...r });
      }
    st.history.unshift(entry);
    st.history.length = Math.min(st.history.length, 8);
  } catch (e) {
    st.error = `${scene.id} on ${eng.label}: ${e.message}`;
  } finally {
    st.job = null;
    draw();
    paint();
  }
}

// ---------- the view ----------
function paint() {
  if (el && el.isConnected) V.candela.render(el, { wb: UI.wb });
}
// what a render will cost, under the controls (updated in place while the passes field is edited)
function infoHtml(scene, st) {
  if (!scene) return '';
  const w = Math.ceil(scene.width / st.stride),
    h = Math.ceil(scene.height / st.stride);
  const calls = (st.stride === 1 ? h : w * h) * st.passes;
  return `${w}×${h} pixels · ${fmt(calls)} engine calls${st.stride > 1 ? ' (one per pixel at stride > 1, as renderScene does)' : ' (one per row)'} · then the sky table`;
}
// Replacing the view's HTML removes a focused field, whose blur can fire a change that repaints again: a repaint
// asked for during one runs after it.
let rendering = false;
V.candela = {
  title: 'Candela',
  on: ['program', 'revision', 'projects'],
  count: () => (S().job ? '…' : ''),
  render(root, { wb }) {
    if (rendering) {
      setTimeout(paint, 0);
      return;
    }
    rendering = true;
    try {
      this.paintInto(root);
    } finally {
      rendering = false;
    }
  },
  paintInto(root) {
    el = root;
    const st = S();
    if (!UI.candela && !loading && !st.loadError)
      UI.loadCandela()
        .then(paint)
        .catch(e => {
          st.loadError = e.message;
          paint();
        });
    const c = UI.candela;
    const busy = !!st.job;
    const sceneOpts = c
      ? c.scenes
          .map(
            s =>
              `<option value="${esc(s.id)}" ${s.id === st.scene ? 'selected' : ''}>${esc(s.id)} ${esc(s.title)}${s.spectral ? ' (spectral)' : ''}</option>`,
          )
          .join('')
      : `<option>${esc(st.scene)}</option>`;
    const engOpts = engines()
      .map(
        e =>
          `<option value="${e.key}" ${e.key === st.engine ? 'selected' : ''} ${e.off ? 'disabled' : ''}>${esc(e.label)}</option>`,
      )
      .join('');
    const seg = (name, values, cur) =>
      `<div class="seg sm">${values.map(v => `<button class="${String(v) === String(cur) ? 'on' : ''}" data-c${name}="${v}" ${busy && name !== 'view' ? 'disabled' : ''}>${v}</button>`).join('')}</div>`;
    const scene = c && c.scenes.find(s => s.id === st.scene);
    const p = projectOpen();
    root.innerHTML = `<div class="tabbody col"><div class="toolbar wrap cdl-ctl">
        <span class="lbl">scene</span><select data-cscene ${busy || !c ? 'disabled' : ''}>${sceneOpts}</select>
        <span class="lbl">engine</span><select data-cengine ${busy ? 'disabled' : ''}>${engOpts}</select>
      </div><div class="toolbar wrap cdl-ctl">
        <span class="lbl">stride</span>${seg('stride', [1, 2, 4, 8], st.stride)}
        <span class="lbl">view</span>${seg('view', ['colour', 'albedo', 'normal', 'depth'], st.view)}
        <span class="lbl">passes</span><input data-cpasses type="number" min="1" max="64" value="${st.passes}" ${busy ? 'disabled' : ''}>
        <span class="sp"></span>${busy ? '<button class="btn sm" data-cstop>Stop</button>' : `<button class="btn sm primary" data-crender ${c ? '' : 'disabled'}>Render</button>`}
      </div>
      <div class="scroll"><div class="doc cv cdl">
        ${st.loadError ? `<div class="fail padded"><b>The Candela program did not load.</b> ${esc(st.loadError)}</div>` : ''}
        ${!c && !st.loadError ? '<p class="cv-busy">loading the Candela program and the reference compiler…</p>' : ''}
        <p class="dim" data-cinfo>${infoHtml(scene, st)}</p>
        <div class="cdl-canvas"><canvas width="${st.live ? st.live.width : 1}" height="${st.live ? st.live.height : 1}" ${st.live ? '' : 'hidden'}></canvas></div>
        ${st.error ? `<div class="fail padded">${esc(st.error)}</div>` : ''}
        <div data-cdlstats>${statsHtml()}</div>
        ${
          st.history.length > 1
            ? `<h4>Earlier renders</h4><table class="rt"><tr><th>scene</th><th>engine</th><th class="num">stride</th><th class="num">passes</th><th class="num">time</th></tr>${st.history
                .slice(1)
                .map(
                  x =>
                    `<tr><td class="nw">${esc(x.scene)}</td><td>${esc(x.label)}</td><td class="num">${x.stride}</td><td class="num">${x.frame ? x.frame.passesDone : ''}</td><td class="num">${x.frame ? secs(x.frame.ms) : ''}</td></tr>`,
                )
                .join('')}</table>`
            : ''
        }
        <h4>The Candela project</h4>
        ${
          p
            ? `<p>Open at <b>${esc(p.rev)}</b>: "evaluator · ${esc(p.rev)} (project)" renders this revision. Passes over Candela's 332 functions take 18 to 60 s each here; the header's Step and Run ask before they start.</p>`
            : `<p>Open the gallery program as a project to see its IR, run passes on it, and render the revision you made. Lifting takes about a second; fingerprinting r0 (hashing its 12,358 statements) about 10 more, during which the page does not respond.</p><button class="btn sm" data-copen ${c && !busy ? '' : 'disabled'}>Open Candela as a project</button>`
        }
      </div></div></div>`;
    draw();
    const q = s => root.querySelector(s);
    const ss = q('[data-cscene]');
    if (ss)
      ss.onchange = () => {
        st.scene = ss.value;
        paint();
      };
    q('[data-cengine]').onchange = e => {
      st.engine = e.target.value;
      paint();
    };
    // the passes field: state and the cost line follow it as it is typed, without rebuilding the view under it
    const pi = q('[data-cpasses]');
    pi.oninput = () => {
      st.passes = Math.max(1, Math.min(64, Math.floor(+pi.value) || 1));
      q('[data-cinfo]').innerHTML = infoHtml(scene, st);
    };
    pi.onchange = () => {
      pi.value = st.passes;
    };
    root.onclick = UI.guarded(async e => {
      const t = s => e.target.closest(s);
      if (t('[data-cstride]')) {
        st.stride = +t('[data-cstride]').dataset.cstride;
        return paint();
      }
      if (t('[data-cview]')) {
        st.view = t('[data-cview]').dataset.cview;
        return paint();
      }
      if (t('[data-crender]')) return render();
      if (t('[data-cstop]') && st.job) {
        st.job.signal.aborted = true;
        if (st.job.workerId && worker) worker.stop(st.job.workerId);
        return;
      }
      if (t('[data-copen]')) {
        const b = t('[data-copen]');
        b.disabled = true;
        b.textContent = 'opening… (about 10 s)';
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        UI.loadProject('candela');
      }
    });
  },
};
