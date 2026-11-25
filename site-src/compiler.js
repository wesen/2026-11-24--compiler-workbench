// compiler.js: two views on the compiler itself (new in this build, not in Compiler Workbench).
//   Compiler    the passes, analyses and pipelines with their declarations (ids, versions, needs, writes,
//               preserves) and each one's source, read-only for built-ins; user passes come from project scripts,
//               where they are edited, and a button writes a new one from a template.
//   Strategies  the open project's compilation strategies (strategies/<name>.json, saved in the browser-local
//               overlay) and the pipelines as plans: a quick builder for "choose the best of these by a metric",
//               a JSON editor, and Run, which shows the decision (the winner, every alternative with its metrics or
//               the reason it was rejected), the revisions it published and the execution trace.
import { UI, esc } from './ui.js';
import { PIPELINES } from './wb.js';

const V = (UI.views = UI.views || {});
const S = () => UI.S;
const short = h => (h ? String(h).slice(0, 10) : '');
const errText = e => String((e && e.message) || e).split('\n');
const showErr = e => {
  const [msg, ...rest] = errText(e);
  return `<div class="fail padded"><b>${esc(msg)}</b>${rest.length ? `<br><span class="dim">${esc(rest.join(' ').trim())}</span>` : ''}</div>`;
};
const codeBlock = (text, from = 1, hl = 0) =>
  `<div class="irtext csrc">${text
    .split('\n')
    .map((l, i) => `<div class="${from + i === hl ? 'hl' : ''}"><span class="cm">${String(from + i).padStart(4)}  </span>${UI.highlight(l, 'js') || ' '}</div>`)
    .join('')}</div>`;

// ---------- Compiler ----------
const C = () => (S().compiler ??= { tab: 'passes', sel: null });
const declRows = (rows) => `<table class="rt kvt">${rows.filter(Boolean).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>`;
const chips = (xs, cls = '') => (xs && xs.length ? xs.map(x => `<span class="chip ${cls}">${esc(x)}</span>`).join(' ') : '<span class="dim">none</span>');

function passDetail(wb, c, x) {
  const p = wb.current;
  const def = x.kind === 'builtin' ? wb.source.definition(x.name) : null;
  const usedIn = Object.entries(c.pipelines).filter(([, v]) => v.includes(x.name)).map(([k]) => k);
  const here = x.project && wb.projects.current && wb.projects.current.id === x.project;
  return `<div class="cv-head"><h3>${esc(x.name)} <span class="chip ${x.kind}">${x.kind === 'user' ? 'user pass' : 'built-in'}</span></h3><p>${esc(x.about || '')}</p></div>
    ${declRows([
      ['id', `<span class="mono">${esc(x.id)}@${esc(x.version)}</span>`],
      ['needs', Object.keys(x.needs).length ? Object.entries(x.needs).map(([a, d]) => `<span class="mono">${esc(a)}</span> ← <span class="chip">${esc(d)}</span>`).join(' ') : '<span class="dim">nothing</span>'],
      ['writes', chips(x.writes, 'w')],
      ['entities', chips(x.entities)],
      ['relations', chips(x.relations)],
      ['preserves', chips(x.preserves, 'p')],
      ['gate', '<span class="dim">the meaning contract against r0 (typed.meaning-kept): a rejected output changes nothing</span>'],
      ['in pipelines', usedIn.length ? chips(usedIn) : '<span class="dim">none</span>'],
      x.definedIn ? ['defined in', `<span class="mono">${esc(x.definedIn)}</span>${x.project ? ` of project <b>${esc(x.project)}</b>` : ''}`] : null,
    ])}
    <div class="row cv-acts">${p && p.status === 'ok' ? `<button class="btn sm primary" data-capply="${esc(x.name)}" ${UI.busy ? 'disabled' : ''}>Apply to ${esc(p.id)} at ${esc(p.rev)}</button><button class="btn sm" data-cdry="${esc(x.name)}" ${UI.busy ? 'disabled' : ''}>Dry run</button>` : ''}${def ? `<button class="btn sm" data-link="src:${esc(def.path)}#L${def.line}">Open in Code</button>` : ''}${x.definedIn && here ? `<button class="btn sm" data-cedit="${esc(x.definedIn)}">Edit ${esc(x.definedIn)}</button>` : ''}${x.definedIn && x.project && !here ? `<button class="btn sm" data-link="project:${esc(x.project)}">Open project ${esc(x.project)}</button>` : ''}</div>
    <div data-cout>${C().out && C().out.name === x.name ? C().out.html : ''}</div>
    <h4>Source <span class="dim">${def ? `${esc(def.path)} lines ${def.from}–${def.to} · read-only` : x.kind === 'user' ? 'the body given to .run() · edit it in the script, then run the script again' : ''}</span></h4>
    ${def ? codeBlock(def.text, def.from, def.line) : x.body ? codeBlock(x.body) : '<p class="dim">not in this build\'s sources</p>'}`;
}
function analysisDetail(wb, c, a) {
  const def = a.kind === 'builtin' ? wb.source.definition(a.id) : null;
  const all = [...c.passes, ...c.userPasses];
  const needs = all.filter(x => Object.values(x.needs).some(d => d.startsWith(a.id + '@'))).map(x => x.name);
  const keeps = all.filter(x => x.preserves.some(d => d.startsWith(a.id + '@'))).map(x => x.name);
  return `<div class="cv-head"><h3>${esc(a.name)} <span class="chip ${a.kind}">${a.kind === 'user' ? 'user analysis' : 'analysis'}</span></h3><p>${esc(a.about || '')}</p></div>
    ${declRows([
      ['id', `<span class="mono">${esc(a.id)}@${esc(a.version)}</span>`],
      ['needed by', chips(needs)],
      ['preserved by', chips(keeps, 'p')],
    ])}
    <div class="row cv-acts">${def ? `<button class="btn sm" data-link="src:${esc(def.path)}#L${def.line}">Open in Code</button>` : ''}<button class="btn sm" data-link="view:facts">Facts view</button></div>
    <h4>Source <span class="dim">${def ? `${esc(def.path)} lines ${def.from}–${def.to} · read-only` : ''}</span></h4>
    ${def ? codeBlock(def.text, def.from, def.line) : '<p class="dim">defined in a project script with wb.analysis()</p>'}`;
}
const PASS_TEMPLATE = name => `// A user pass, ${name}: x + x, for a pure x, becomes x * 2 (an example: change the body, then Run this script).
// Running the script (re)defines the pass; apply it from the Compiler view, or name it in a strategy candidate
// in the Strategies view. A user pass is a framework pass like the built-ins: it declares what it writes, its
// transaction refuses anything else, and the meaning contract against r0 gates its output.
wb.pass('${name}')
  .about('x + x, for a pure x, becomes x * 2')
  .writes('values')
  .preserves('cfg', 'dominators', 'loops', 'liveness', 'reaching')
  .run((fn, tx) => {
    tx.rewrite(v => {
      if (v.op === 'add' && v.args[0].isPure && v.args[0].same(v.args[1]))
        return tx.make('mul', v.args[0].id, tx.const(2), { because: [v.args[1].id], note: 'x + x = x * 2' });
    });
  });
return wb.compiler().userPasses.find(x => x.name === '${name}');
`;

V.compiler = {
  title: 'Compiler',
  on: ['passes', 'program', 'revision', 'files', 'projects'],
  count: () => {
    const n = UI.wb ? UI.wb.compiler().userPasses.length : 0;
    return n ? `+${n}` : '';
  },
  render(el, { wb }) {
    const c = wb.compiler(),
      st = C();
    const lists = {
      passes: [...c.passes, ...c.userPasses],
      analyses: c.analyses,
    };
    const sel = st.sel && (lists[st.tab] || []).find(x => x.name === st.sel);
    let body;
    if (sel && st.tab === 'passes') body = passDetail(wb, c, sel);
    else if (sel && st.tab === 'analyses') body = analysisDetail(wb, c, sel);
    else if (st.tab === 'passes')
      body = `<table class="rt cv-list"><tr><th>pass</th><th>id</th><th>writes</th><th>needs</th><th>preserves</th></tr>${lists.passes
        .map(x => `<tr data-csel="${esc(x.name)}" class="${x.kind === 'user' ? 'user' : ''}"><td><b>${esc(x.name)}</b>${x.kind === 'user' ? ' <span class="chip user">user</span>' : ''}<br><small class="dim">${esc(x.about || '')}</small></td><td class="mono">${esc(x.id)}@${esc(x.version)}</td><td>${esc(x.writes.join(', '))}</td><td>${esc(Object.values(x.needs).map(d => d.replace(/^typed\./, '').replace(/@.*/, '')).join(', ') || '—')}</td><td class="dim">${x.preserves.length}</td></tr>`)
        .join('')}</table>
        <div class="cv-new"><b>Write a pass</b><p>A user pass lives in a project script: the script calls <span class="mono">wb.pass(name)…run(fn)</span>, and running it defines the pass for this page. Built-in passes are read-only; a user pass cannot take a built-in name.</p><div class="row"><input data-cnewname placeholder="my-pass" value="${esc(st.newName || '')}"><button class="btn sm primary" data-cnew ${wb.projects.current ? '' : 'disabled'}>New pass script in ${esc(wb.projects.current ? wb.projects.current.id : 'a project')}</button></div>${st.newErr ? `<p class="bad">${esc(st.newErr)}</p>` : ''}</div>`;
    else if (st.tab === 'analyses')
      body = `<table class="rt cv-list"><tr><th>analysis</th><th>id</th><th>about</th></tr>${lists.analyses.map(a => `<tr data-csel="${esc(a.name)}"><td><b>${esc(a.name)}</b>${a.kind === 'user' ? ' <span class="chip user">user</span>' : ''}</td><td class="mono">${esc(a.id)}@${esc(a.version)}</td><td class="dim">${esc(a.about || '')}</td></tr>`).join('')}</table>`;
    else
      body = `<table class="rt cv-list"><tr><th>pipeline</th><th>passes</th></tr>${Object.entries(c.pipelines)
        .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${v.length ? v.map(n => `<button class="linkish" data-cgo="${esc(n)}">${esc(n)}</button>`).join(' → ') : '<span class="dim">nothing: the lifted code as it is</span>'}</td></tr>`)
        .join('')}</table><p class="dim padded">Every pipeline is also a strategy plan (a sequence of passes): the Strategies view runs them, and chooses among them by a metric. Metrics: ${esc(c.metrics.measures.join(', '))} (${esc(c.metrics.id)}).</p>`;
    el.innerHTML = `<div class="tabbody col"><div class="toolbar">${sel ? '<button class="btn sm" data-cback>← all</button>' : ''}<div class="seg sm">${[
      ['passes', `Passes ${lists.passes.length}`],
      ['analyses', `Analyses ${lists.analyses.length}`],
      ['pipelines', `Pipelines ${Object.keys(c.pipelines).length}`],
    ]
      .map(([k, l]) => `<button class="${st.tab === k ? 'on' : ''}" data-ctab="${k}">${l}</button>`)
      .join('')}</div><span class="sp"></span><span class="dim">${esc(c.contract)}</span></div><div class="scroll"><div class="doc cv">${body}</div></div></div>`;
    el.onclick = UI.guarded(async e => {
      const q = s => e.target.closest(s);
      if (q('[data-ctab]')) {
        st.tab = q('[data-ctab]').dataset.ctab;
        st.sel = null;
        return V.compiler.render(el, { wb });
      }
      if (q('[data-cback]')) {
        st.sel = null;
        return V.compiler.render(el, { wb });
      }
      if (q('[data-cgo]')) {
        st.tab = 'passes';
        st.sel = q('[data-cgo]').dataset.cgo;
        return V.compiler.render(el, { wb });
      }
      if (q('[data-csel]')) {
        st.sel = q('[data-csel]').dataset.csel;
        st.out = null;
        return V.compiler.render(el, { wb });
      }
      if (q('[data-cedit]')) return UI.openFile(q('[data-cedit]').dataset.cedit);
      if (q('[data-cnew]')) {
        const name = (el.querySelector('[data-cnewname]').value || '').trim();
        st.newName = name;
        st.newErr = null;
        const pr = wb.projects.current;
        if (!/^[a-z][a-z0-9-]*$/.test(name)) st.newErr = 'A pass name is lower-case words joined by -, e.g. my-pass';
        else if (c.passes.some(x => x.name === name)) st.newErr = `"${name}" is a built-in pass; built-in passes are read-only`;
        else if (pr.files.list().some(f => f.path === `scripts/${name}.js`)) st.newErr = `scripts/${name}.js exists already`;
        if (st.newErr) return V.compiler.render(el, { wb });
        pr.files.write(`scripts/${name}.js`, PASS_TEMPLATE(name));
        UI.openFile(`scripts/${name}.js`);
        UI.toast(`Wrote scripts/${name}.js: run it to define the pass`);
        return;
      }
      const ap = q('[data-capply]'),
        dr = q('[data-cdry]');
      if ((ap || dr) && !UI.busy) {
        const name = (ap || dr).dataset[ap ? 'capply' : 'cdry'];
        const p = wb.current;
        UI.busy = { pass: name };
        UI.refresh(['busy']);
        const out = el.querySelector('[data-cout]');
        if (out) out.innerHTML = `<p class="dim">${ap ? 'applying' : 'dry run of'} ${esc(name)}…</p>`;
        try {
          if (ap) {
            const r = await p.apply(name);
            st.out = { name, html: `<p class="good">${r.changed ? `${esc(r.rev)} · ${r.edits} edits · ${esc(r.check || '')}` : 'no change'}</p>` };
          } else {
            const r = await p.dryRun(name);
            st.out = { name, html: `<p>${r.changed ? `would make ${r.edits} edits` : 'would change nothing'}${r.check ? ` · ${esc(r.check)}` : ''}</p>` };
          }
        } catch (err) {
          st.out = { name, html: showErr(err) };
        } finally {
          UI.busy = null;
        }
        UI.refresh(['revision', 'passes']);
      }
    });
  },
};

// ---------- Strategies ----------
const ST = () => {
  const s = (S().strat ??= {});
  for (const [k, v] of Object.entries(STRAT_DEFAULTS())) if (!(k in s)) s[k] = v;
  return s;
};
const STRAT_DEFAULTS = () => ({
    sel: null,
    draft: {},
    name: 'best',
    cands: { O0: true, O1: true, O2: true, loops: true },
    custom: [],
    metric: 'instructions',
    direction: 'min',
    constraints: [],
    fromR0: true,
    result: null,
    busy: null,
    showTrace: false,
  });
let progressHooked = false;

function decisionHtml(d) {
  const metrics = ['instructions', 'bytes', 'statements', 'blocks'];
  return `<div class="cv-decision"><p>choose the <b>${d.objective.direction === 'max' ? 'largest' : 'smallest'} ${esc(d.objective.metric)}</b>${d.constraints && d.constraints.length ? ` where ${esc(d.constraints.map(c => `${c.metric} ${c.op} ${c.value}`).join(', '))}` : ''}: <b class="good">${esc(d.winner || 'no winner')}</b>${d.tieBreak ? ` <span class="dim">· ties: ${esc(d.tieBreak)}</span>` : ''}</p>
    <table class="rt"><tr><th>candidate</th><th>status</th>${metrics.map(m => `<th class="${m === d.objective.metric ? 'obj' : ''}">${m}</th>`).join('')}<th>reason</th></tr>${d.alternatives
      .map(a => `<tr class="${a.selected ? 'win' : a.status === 'rejected' ? 'rej' : ''}"><td><b>${esc(a.name)}</b>${a.selected ? ' <span class="chip good">winner</span>' : ''}</td><td class="${a.status === 'feasible' ? '' : 'bad'}">${esc(a.status)}</td>${metrics.map(m => `<td class="num${m === d.objective.metric ? ' obj' : ''}">${a.metrics && a.metrics[m] !== undefined ? a.metrics[m].toLocaleString('en-GB') : '—'}</td>`).join('')}<td class="dim">${esc(a.status === 'feasible' ? (a.violations && a.violations.length ? a.violations.join('; ') : '') : a.reason || '')}</td></tr>`)
      .join('')}</table></div>`;
}
function resultHtml(r, st) {
  if (r.error && !r.status) return showErr(r.error);
  const depth = path => (String(path).match(/\//g) || []).length;
  return `<div class="cv-result"><h4>Run of ${esc(r.plan)} <span class="dim">on ${esc(r.program)} from ${esc(r.from)} · ${r.ms} ms</span></h4>
    <p>status <b class="${r.status === 'succeeded' ? 'good' : 'bad'}">${esc(r.status)}</b> · head now <b>${esc(r.rev)}</b>${r.error ? ` · <span class="bad">${esc(r.error.code)}: ${esc(r.error.message)}</span>` : ''}</p>
    ${(r.decisions || []).map(decisionHtml).join('') || '<p class="dim">no choice in this plan</p>'}
    <h4>Published revisions <span class="dim">the winning chain, one revision per pass that changed something</span></h4>
    ${r.published && r.published.length ? `<ol class="cv-pub">${r.published.map((x, i) => `<li><span class="mono">r${r.fromN + i + 1}</span> ${esc(x)}</li>`).join('')}</ol><button class="btn sm" data-link="view:timeline">Timeline</button> <button class="btn sm" data-link="view:ir">IR</button>` : '<p class="dim">nothing changed</p>'}
    <details ${st.showTrace ? 'open' : ''} data-strace><summary><b>Execution trace</b> <span class="dim">${r.execution ? `${esc(r.execution.id)} · ${r.execution.nodes} nodes` : ''}</span></summary>
    <table class="rt cv-trace"><tr><th>node</th><th>kind</th><th>branch</th><th>status</th><th>ms</th><th>output</th><th>evidence</th></tr>${(r.trace || [])
      .map(t => `<tr class="${t.status === 'rejected' || t.status === 'failed' ? 'rej' : ''}"><td style="padding-left:${6 + depth(t.path) * 12}px" class="mono">${esc(t.nodeId)}</td><td>${esc(t.kind)}</td><td>${esc(t.branch || '')}</td><td class="${t.status === 'succeeded' ? '' : 'bad'}">${esc(t.status)}${t.error ? ` <span class="dim" title="${esc(t.error.message)}">${esc(t.error.code)}</span>` : ''}</td><td class="num">${t.ms ?? ''}</td><td class="mono dim">${esc(short(t.output))}</td><td class="dim">${esc((t.evidence || []).join(', '))}</td></tr>`)
      .join('')}</table></details></div>`;
}

V.strategies = {
  title: 'Strategies',
  on: ['files', 'projects', 'program', 'passes', 'strategies'],
  count: () => {
    const st = S() && S().strat;
    return st && st.busy ? '…' : '';
  },
  render(el, { wb }) {
    const st = ST(),
      pr = wb.projects.current,
      p = wb.current;
    if (!pr || !p) {
      el.innerHTML = '<div class="tabbody col"><div class="scroll"><div class="doc"><p class="empty">Open a project.</p></div></div></div>';
      return;
    }
    if (!progressHooked) {
      progressHooked = true;
      wb.on('strategyProgress', d => {
        const s = ST();
        if (!s.busy) return;
        s.busy.node = d.node;
        s.busy.steps = (s.busy.steps || 0) + 1;
        const n = document.querySelector('[data-sprog]');
        if (n) n.textContent = `running ${d.node} · ${s.busy.steps} nodes started`;
      });
    }
    const list = wb.strategy.list();
    const mine = list.filter(x => x.kind === 'project'),
      pipes = list.filter(x => x.kind === 'pipeline');
    if (st.sel && !list.some(x => x.name === st.sel && x.kind === st.selKind)) st.sel = null;
    const cur = st.sel ? list.find(x => x.name === st.sel && x.kind === st.selKind) : null;
    const key = cur ? `${cur.kind}:${cur.name}` : 'new';
    let text = st.draft[key];
    if (text === undefined) {
      if (cur && cur.kind === 'project') text = pr.files.read(cur.path);
      else if (cur) text = JSON.stringify(JSON.parse(wb.strategy.toJson(cur.name)), null, 2);
      else text = '';
    }
    let parsed = null,
      parseErr = null,
      explain = '';
    if (text.trim()) {
      try {
        parsed = wb.strategy.fromJson(text);
        explain = wb.strategy.explain(parsed);
      } catch (e) {
        parseErr = errText(e)[0];
      }
    }
    const users = wb.compiler().userPasses.map(x => x.name);
    const metricSel = (attr, v) => `<select ${attr}>${wb.strategy.metrics.map(m => `<option ${m === v ? 'selected' : ''}>${m}</option>`).join('')}</select>`;
    const busy = st.busy;
    el.innerHTML = `<div class="tabbody col"><div class="toolbar"><span class="lbl">strategy</span><div class="seg sm">${mine.map(x => `<button class="${cur === x ? 'on' : ''}${x.error ? ' bad' : ''}" data-ssel="project:${esc(x.name)}" title="${esc(x.path)}">${esc(x.name)}</button>`).join('')}<button class="${!cur ? 'on' : ''}" data-ssel="new">+ new</button></div><span class="lbl">pipelines</span><div class="seg sm">${pipes.map(x => `<button class="${cur === x ? 'on' : ''}" data-ssel="pipeline:${esc(x.name)}">${esc(x.name)}</button>`).join('')}</div><span class="sp"></span>
      <label class="dim"><input type="checkbox" data-sfrom ${st.fromR0 ? 'checked' : ''}> from r0</label><button class="btn sm primary" data-srun ${parsed && !busy && !UI.busy ? '' : 'disabled'}>Run on ${esc(p.id)}</button></div>
      <div class="scroll"><div class="doc cv">
      ${busy ? `<p class="cv-busy" data-sprog>running ${esc(busy.node || busy.plan)}…</p>` : ''}
      ${st.result ? resultHtml(st.result, st) : ''}
      <details class="cv-builder" ${!cur || st.builderOpen ? 'open' : ''} data-sbuild><summary><b>Quick builder</b> <span class="dim">choose the best of several candidates by a metric</span></summary>
        <div class="cv-form">
          <label>name <input data-sname value="${esc(st.name)}" size="14"></label>
          <div><span class="lbl">candidates</span> ${Object.keys(PIPELINES).map(n => `<label class="cv-cand"><input type="checkbox" data-scand="${esc(n)}" ${st.cands[n] ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div>
          ${st.custom.map((c, i) => `<div class="cv-row"><input data-scname="${i}" value="${esc(c.name)}" size="8" placeholder="name"> <input data-scpasses="${i}" value="${esc(c.passes)}" size="40" placeholder="passes, e.g. add-self cfg fold dce"> <button class="btn sm" data-scdel="${i}">×</button></div>`).join('')}
          <div class="row"><button class="btn sm" data-scadd>+ candidate from passes</button>${users.length ? `<span class="dim">user passes:</span> ${users.map(u => `<button class="chip user linkish" data-suser="${esc(u)}" title="add to the last candidate">${esc(u)}</button>`).join(' ')}` : '<span class="dim">no user passes yet: write one in the Compiler view</span>'}</div>
          <div><span class="lbl">objective</span> <select data-sdir><option value="min" ${st.direction === 'min' ? 'selected' : ''}>smallest</option><option value="max" ${st.direction === 'max' ? 'selected' : ''}>largest</option></select> ${metricSel('data-smetric', st.metric)}</div>
          ${st.constraints.map((c, i) => `<div class="cv-row"><span class="lbl">where</span> ${metricSel(`data-sk="${i}"`, c.metric)} <select data-sop="${i}">${['<=', '<', '>=', '>', '=='].map(o => `<option ${o === c.op ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select> <input data-sval="${i}" type="number" value="${esc(c.value)}" size="6"> <button class="btn sm" data-skdel="${i}">×</button></div>`).join('')}
          <div class="row"><button class="btn sm" data-skadd>+ constraint</button><span class="sp"></span><button class="btn sm primary" data-sbuildgo>Build plan</button></div>
          ${st.buildErr ? showErr(st.buildErr) : ''}
        </div></details>
      <h4>${cur ? (cur.kind === 'project' ? `${esc(cur.path)} <span class="dim">in ${esc(pr.id)}, saved in this browser</span>` : `${esc(cur.name)} <span class="dim">a pipeline as a plan · read-only: save a copy to change it</span>`) : 'New strategy <span class="dim">build one above, or write the plan JSON</span>'}</h4>
      <textarea class="cv-json mono" data-sjson spellcheck="false" ${cur && cur.kind === 'pipeline' ? 'readonly' : ''} placeholder="the plan JSON">${esc(text)}</textarea>
      <div class="row"><span class="${parseErr ? 'bad' : 'dim'}">${parseErr ? esc(parseErr) : parsed ? `valid plan ${esc(parsed.id)}` : 'empty'}</span><span class="sp"></span>
        <label>save as strategies/<input data-ssavename value="${esc(st.saveName || (cur && cur.kind === 'project' ? cur.name : parsed ? parsed.id.replace(/^typed\.(strategy|pipeline)\./, '') : 'mine'))}" size="12">.json</label>
        <button class="btn sm" data-ssave ${parsed ? '' : 'disabled'}>Save</button>${cur && cur.kind === 'project' ? '<button class="btn sm" data-sdel>Delete</button>' : ''}</div>
      ${explain ? `<pre class="cv-explain">${esc(explain)}</pre>` : ''}
      </div></div></div>`;

    const ta = el.querySelector('[data-sjson]');
    ta.oninput = () => {
      st.draft[key] = ta.value;
    };
    ta.onchange = () => V.strategies.render(el, { wb });
    const det = el.querySelector('[data-strace]');
    if (det) det.ontoggle = () => (st.showTrace = det.open);
    const bd = el.querySelector('[data-sbuild]');
    if (bd) bd.ontoggle = () => (st.builderOpen = bd.open);
    const readForm = () => {
      st.name = el.querySelector('[data-sname]').value.trim() || 'best';
      st.metric = el.querySelector('[data-smetric]').value;
      st.direction = el.querySelector('[data-sdir]').value;
      for (const b of el.querySelectorAll('[data-scand]')) st.cands[b.dataset.scand] = b.checked;
      st.custom.forEach((c, i) => {
        c.name = el.querySelector(`[data-scname="${i}"]`).value.trim();
        c.passes = el.querySelector(`[data-scpasses="${i}"]`).value;
      });
      st.constraints.forEach((c, i) => {
        c.metric = el.querySelector(`[data-sk="${i}"]`).value;
        c.op = el.querySelector(`[data-sop="${i}"]`).value;
        c.value = +el.querySelector(`[data-sval="${i}"]`).value;
      });
      st.fromR0 = el.querySelector('[data-sfrom]').checked;
      const sn = el.querySelector('[data-ssavename]');
      if (sn) st.saveName = sn.value.trim();
    };
    el.onclick = UI.guarded(async e => {
      const q = s => e.target.closest(s);
      if (q('[data-ssel]')) {
        readForm();
        const v = q('[data-ssel]').dataset.ssel;
        if (v === 'new') st.sel = null;
        else {
          const [k, ...n] = v.split(':');
          st.selKind = k;
          st.sel = n.join(':');
        }
        st.saveName = '';
        return V.strategies.render(el, { wb });
      }
      if (q('[data-sfrom]')) {
        st.fromR0 = q('[data-sfrom]').checked;
        return;
      }
      if (q('[data-scadd]')) {
        readForm();
        st.custom.push({ name: `c${st.custom.length + 1}`, passes: '' });
        return V.strategies.render(el, { wb });
      }
      if (q('[data-scdel]')) {
        readForm();
        st.custom.splice(+q('[data-scdel]').dataset.scdel, 1);
        return V.strategies.render(el, { wb });
      }
      if (q('[data-suser]')) {
        readForm();
        if (!st.custom.length) st.custom.push({ name: 'mine', passes: '' });
        const last = st.custom[st.custom.length - 1];
        last.passes = (last.passes.trim() + ' ' + q('[data-suser]').dataset.suser).trim();
        return V.strategies.render(el, { wb });
      }
      if (q('[data-skadd]')) {
        readForm();
        st.constraints.push({ metric: 'bytes', op: '<=', value: 1000 });
        return V.strategies.render(el, { wb });
      }
      if (q('[data-skdel]')) {
        readForm();
        st.constraints.splice(+q('[data-skdel]').dataset.skdel, 1);
        return V.strategies.render(el, { wb });
      }
      if (q('[data-sbuildgo]')) {
        readForm();
        st.buildErr = null;
        try {
          const cands = {};
          for (const n of Object.keys(PIPELINES)) if (st.cands[n]) cands[n] = n;
          for (const c of st.custom) {
            const passes = c.passes.split(/[\s,→>]+/).filter(Boolean);
            if (c.name && passes.length) cands[c.name] = passes;
          }
          const plan = wb.strategy.choose(st.name, cands, { metric: st.metric, direction: st.direction }, st.constraints);
          st.sel = null;
          st.draft.new = JSON.stringify(JSON.parse(wb.strategy.toJson(plan)), null, 2);
          st.saveName = st.name;
        } catch (err) {
          st.buildErr = err;
        }
        return V.strategies.render(el, { wb });
      }
      if (q('[data-ssave]')) {
        readForm();
        const name = st.saveName;
        const r = wb.strategy.save(name, ta.value);
        delete st.draft[key];
        delete st.draft[`project:${name}`];
        st.sel = name;
        st.selKind = 'project';
        UI.toast(`Saved ${r.saved} in ${r.project} (this browser)`);
        UI.refresh(['strategies', 'files']);
        return;
      }
      if (q('[data-sdel]') && cur) {
        pr.files.remove(cur.path);
        delete st.draft[key];
        st.sel = null;
        UI.refresh(['strategies', 'files']);
        return;
      }
      if (q('[data-srun]') && parsed && !st.busy && !UI.busy) {
        readForm();
        const prog = wb.current;
        if (st.fromR0 && prog.rev !== 'r0') prog.checkout(0);
        const from = prog.rev;
        st.busy = { plan: parsed.id, node: null, steps: 0 };
        UI.busy = { pass: `strategy ${parsed.id.replace(/^typed\.\w+\./, '')}` };
        st.result = null;
        V.strategies.render(el, { wb });
        UI.refresh(['busy']);
        await new Promise(r => requestAnimationFrame(() => r()));
        const t0 = performance.now();
        try {
          const r = await wb.strategy.run(prog, parsed);
          st.result = { ...r, plan: parsed.id, program: prog.id, from, fromN: +from.slice(1), ms: Math.round(performance.now() - t0) };
        } catch (err) {
          st.result = { error: err };
        } finally {
          st.busy = null;
          UI.busy = null;
        }
        UI.refresh(['strategies', 'revision']);
      }
    });
  },
};
