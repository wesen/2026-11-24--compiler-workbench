// agent.js: the agent panel. One tool, eval(code): the code runs as the body of an async
// function with the workbench in scope (wb, p, project, ui, src, book, log, yaml), and its result
// comes back as YAML. Threads, modes (Auto, Ask, Read-only), model and thinking settings,
// a snapshot before every step so any step can be reverted, and a banner when Claude is off.
(function (G) {
'use strict';
const UI = G.UI = G.UI || {};
const esc = UI.esc;
const wb = () => UI.wb;
const MAX_RESULT = 9000;

const A = UI.agent = {
  threads: [], cur: 0, mode: 'auto', tier: 'default', think: 'auto', busy: false, sample: undefined, off: null, ctrl: null,
};
try { const t = JSON.parse(UI.store.get('wb.agent.threads') || '[]'); if (Array.isArray(t) && t.length) A.threads = t; } catch { /* fresh */ }
if (!A.threads.length) A.threads = [{ id: 1, title: 'New thread', msgs: [] }];
A.mode = UI.store.get('wb.agent.mode') || 'auto';
A.tier = UI.store.get('wb.agent.tier') || 'default';
A.think = UI.store.get('wb.agent.think') || 'auto';
const save = () => { try { UI.store.set('wb.agent.threads', JSON.stringify(A.threads.map(t => ({ ...t, msgs: t.msgs.map(m => ({ ...m, steps: (m.steps || []).map(s => ({ ...s, snapshot: undefined })) })) })).slice(-12))); } catch { /* too big or unavailable */ } };
const thread = () => A.threads[Math.min(A.cur, A.threads.length - 1)];

// ---------- Claude, through the page's sample capability ----------
(async () => {
  try { A.downloads = G.claude && G.claude.use ? await G.claude.use('downloads') : null; } catch { A.downloads = null; }
  UI.refresh && UI.refresh(['agent']);
})();
(async () => {
  try {
    if (!G.claude || !G.claude.use) { A.sample = null; A.off = 'unavailable'; return; }
    A.sample = await G.claude.use('sample');
    if (!A.sample) A.off = 'unavailable';
  } catch { A.sample = null; A.off = 'unavailable'; }
  UI.refresh && UI.refresh(['agent']);
})();
const OFF = {
  unavailable: 'Claude is not available in this view. The agent works where this page runs on claude.ai with the sample capability; the rest of the workbench works everywhere.',
  not_granted: 'The agent needs your permission to ask Claude. It asks on your first message; it was declined, so the agent is off for now.',
  sampling_disabled: 'Asking Claude is turned off for this page or this account.',
  rate_limited: 'Claude is rate limited right now. Wait a little and send again.',
};
const NOTES = {
  cancelled: 'Stopped.', rate_limited: 'Rate limited: wait a little, then send again.', prompt_too_large: 'The conversation is too long for one request. Start a new thread.',
  refused: 'Claude declined this request.', truncated: 'The answer was cut off at its length limit.',
};

// ---------- the tool ----------
const TOOL_DESC = `Run JavaScript in the compiler workbench. The code is the body of an async function: use await, and return a value to see it as YAML (cut at ${MAX_RESULT} characters). log(x) prints along the way.
In scope: wb (the workbench root), p (the current program handle, or null), project (the open project, or null), projects (= wb.projects), ui (the live UI: add tiles with ui.live.tile(id)), src (= wb.source: the workbench's own source files), book (= wb.book), log, yaml.
Change programs only through the API: p.apply(pass), p.pipeline('O2'), p.undo(); change a project through its files: project.files.write(path, text). Handles are read-only proxies; an unknown member or an assignment throws an error with a fix line. Keep each call small and focused; return only what you need.`;
function snapshot() { return { ...wb()._snapshot(), live: UI.dsl.liveSnapshot() }; }
async function runEval(code, step) {
  const t0 = performance.now();
  const logs = [];
  const W = wb();
  const scope = {
    wb: W, p: W.current, project: W.projects.current, projects: W.projects, ui: UI.dsl.liveUi, src: W.source, book: W.book,
    log: x => { logs.push(typeof x === 'string' ? x : G.WB.toYaml(x)); }, yaml: G.WB.toYaml,
  };
  W._setReadOnly(A.mode === 'read');
  let result, error = null;
  try {
    const fn = new Function(...Object.keys(scope), '"use strict";\nreturn (async () => {\n' + code + '\n})();\n//# sourceURL=agent-eval.js');
    result = await UI.batch(() => Promise.race([fn(...Object.values(scope)), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 25 s')), 25000))]));
    const mounted = UI.dsl.adopt(result);   // a returned tile goes on screen, as a live tile
    if (mounted) result = { mounted, note: 'mounted as live tiles; ui.live.close(id) removes one' };
  } catch (e) { error = e; }
  finally { W._setReadOnly(false); }
  step.ms = Math.round(performance.now() - t0);
  let text = logs.length ? logs.map(l => 'log: ' + l).join('\n') + '\n' : '';
  if (error) text += 'error: ' + (error.message || String(error));
  else text += result === undefined ? (logs.length ? '' : 'undefined (return a value to see it)') : G.WB.toYaml(result);
  if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + `\n… cut at ${MAX_RESULT} characters: return less, or slice the result`;
  step.result = text; step.state = error ? 'err' : 'ok';
  return text;
}
function makeTool(msg) {
  return {
    name: 'eval', description: TOOL_DESC,
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The body of an async function. Return a value to see it.' } }, required: ['code'] },
    execute: async (input) => {
      const code = String(input && input.code || '');
      const step = { code, state: 'run', ms: 0, result: '' };
      msg.steps.push(step);
      if (A.mode === 'ask') {
        step.state = 'ask'; paint();
        const ok = await new Promise(res => { step._decide = res; });
        delete step._decide;
        if (!ok) { step.state = 'skipped'; step.result = 'skipped by the user'; paint(); return 'The user skipped this step. Do not retry it; ask what they want instead, or continue without it.'; }
        step.state = 'run';
      }
      step.snapshot = snapshot();
      paint();
      const out = await runEval(code, step);
      paint();
      return out;
    },
  };
}

// ---------- instructions ----------
function instructions() {
  const W = wb();
  return `You are the agent inside a compiler workbench that runs in this web page. The workbench takes programs in a small typed language (a typed subset of JavaScript), lifts them into a store of entities with readable ids, transforms them with passes through a pass manager, checks every transformation against the original meaning, and compiles to RV32 machine code that runs on an emulator in the page. You have one tool, eval, which runs JavaScript with the workbench's API in scope.

Work is organised in projects. A project is a set of plain files:
- project.json: title, about, group, sources (the order the typed files compile in), inputs (ranges for generated cases), pipeline, scripts (per-script options such as { fresh: true }), ui ({ order, off }), chapter, try.
- *.typed: the source. All typed files compile together as one program; ids and lines refer to the concatenation, and p.where(id) or p.locate(line) gives file:line.
- scripts/*.js: workbench scripts, the body of a function with wb, p, project, args, param, log, yaml in scope. Queries and experiments live here. project.run(name, args, { fresh: true }) runs one on a fresh copy at r0.
- ui/*.js: UI scripts, the body of a function with ui, wb, p, project, param in scope, returning tiles. They build the project's own tiles with the UI DSL below.
- notes.md: notes shown under the source.

What you can do:
- Run the API: open projects, apply passes and pipelines, query handles, run checks, compile, run images, explain results with ids.
- Write new passes, analyses and fragments with wb.pass(name), wb.analysis(name), wb.fragment(name), and run them.
- Change the open project: project.files.list(), project.files.read(path), project.files.write(path, text) (a .typed or project.json write rebuilds the program at r0; a ui/*.js write remounts that script's tiles), project.files.remove(path). Create one with wb.projects.create(id, { title, about, group, source }) or wb.projects.create(id, { files: { 'project.json': …, 'main.typed': …, 'ui/x.js': … } }), then wb.projects.open(id) so the person sees it. Built-in projects keep your edits as an overlay; project.reset() brings the original back.
- Build UI. Prefer a UI script in the project (project.files.write('ui/name.js', …)) for anything the person will keep; it reruns when the program changes. For a quick answer, use the live UI: ui.live.tile('id', { title, place: { splitRight: 'ir' } }).append(ui.table(ui.query(({ p }) => …))). ui.live.tiles() lists what is on screen; ui.live.close(id) removes a live tile. ui.plan('name').explain() shows a UI script's tiles and cells without mounting it, and the errors its cells raise.
- In the UI DSL, cells are values that rerun when what they read changes: ui.query(({ p, project }) => …) (read-only), ui.from('script', args, { fresh }) (a workbench script's result), ui.state(v), ui.derive({ a, b }, fn), cell.map(fn), ui.param.int/float/bool/choice/set (controls, shared with the Pipeline view), ui.selection(). Components: text, stat, badge, code, json, table, list, tree, diff, chart, slider, toggle, select, multiselect, input, button, row, col, section, tabs, when; ui.task(async (ctx, { signal, progress, partial }) => …) for long work; ui.annotate('ir' | 'source' | 'rv32' | 'cfg') adds badges to the built-in views; ui.fragment(name) adds members to components; ui.component(name) defines new ones. Change the program only in a button handler or a task, never in a query.
- Answer questions about how the workbench itself is implemented by reading its source: src.files(), src.outline(path), src.read(path, from, to), src.grep(pattern), src.find(name). The source you read is exactly the code running in this page. Quote file paths and line numbers.
- Read the book: book.contents(), book.read(id, section), book.search(text), book.open(id).

How to work:
- Measure, do not guess: when you state a number (bytes, instruction counts, edits, agreement), get it from a call first.
- Keep calls small. Return only what you need, for example p.fn('f').stmts().table('id', 'text') rather than whole handles.
- Ids look like fn:blend, bb:blend.3, s:blend.7, v:blend.12, op:blend#5, insn:blend+0x1c@r4, img:blend@r4, fact:liveness(blend)@r2, edit:r3.0. Write them in backticks in your answer; they become links.
- Links: a project as [Enums and match](project:match-enum), a project file as [ui/status.js](file:ui/status.js), a book chapter as [Bounds checks](chapter:bounds), a source line of the workbench as [passes.js](src:app/engine/passes.js#L120). Use the exact ids listed at the end of these instructions (the id, never the title, after project: and chapter:); a link with an unknown id does not open anything.
- Errors carry a code and a fix line: read them and adjust instead of retrying the same call.
- The person sees your tool calls and their results in the panel, and can revert any step, project files included. In Read-only mode, calls that change programs or project files are refused; say what you would do instead.
- Answer in short paragraphs or a short list. No em dashes.

The API reference follows. wb.help(topic) prints one section again if you need it.

${G.WB_REFERENCE || ''}

Projects available now, as id: title (link with the id):
${W.projects.list().map(x => `- ${x.id}: ${x.title}`).join('\n')}

Book chapters, as id: title:
${(G.WB_BOOK || []).map(c => `- ${c.id}: ${c.title}`).join('\n')}`;
}
function contextBlock() {
  const W = wb(), p = W.current, S = UI.S;
  const lines = ['[context]'];
  if (p) {
    const pr = W.projects.current;
    lines.push(`current program: ${p.id} at ${p.rev}, status ${p.status}${pr ? `, from project ${pr.id}` : ''}`);
    if (pr) {
      lines.push(`project files: ${pr.files.list().map(f => f.path + (f.edited ? ' (edited)' : '')).join(', ')}`);
      const u = pr.uiScripts();
      if (u.length) lines.push(`UI scripts: ${u.map(x => x.name + (x.on ? '' : ' (off)') + (UI.dsl.errors.get(pr.id + '/' + x.name) ? ' (error: ' + UI.dsl.errors.get(pr.id + '/' + x.name).split('\n')[0] + ')' : '')).join(', ')}`);
    }
    if (p.status === 'ok') lines.push(`functions: ${p.fns().join(', ')}; selected function: ${S.fn}`);
    else if (p.error) lines.push(`front-end error: line ${p.error.line}:${p.error.col} ${p.error.message}`);
  } else lines.push('no program open');
  if (W.focused) lines.push(`selected entity: ${W.focused}`);
  const bt = UI.dock && UI.dock.where('book');
  if (bt && bt.active === 'book') lines.push(`the book is open at chapter ${S.chapter}`);
  const shown = UI.dock ? [...UI.dock.tiles.values()].map(t => t.active) : [];
  if (shown.length) lines.push(`views on screen: ${shown.join(', ')}`);
  lines.push(`agent mode: ${A.mode === 'read' ? 'Read-only' : A.mode === 'ask' ? 'Ask (each call needs approval)' : 'Auto'}`);
  return lines.join('\n');
}
function turns(t) {
  const out = [];
  t.msgs.forEach((m, i) => {
    if (m.role === 'user') {
      const last = i === t.msgs.length - 1 || (i === t.msgs.length - 2 && t.msgs[i + 1].role === 'agent' && t.msgs[i + 1].pending);
      let content = m.text;
      if (out.length === 0) content = instructions() + '\n\n---\n\n' + content;
      if (last) content += '\n\n' + contextBlock();
      out.push({ role: 'user', content });
    } else if (!m.pending) {
      const steps = (m.steps || []).map(s => `[eval] ${s.code.split('\n')[0].slice(0, 100)} → ${(s.result || '').replace(/\s+/g, ' ').slice(0, 160)}${s.state === 'reverted' ? ' (reverted by the user)' : ''}`).join('\n');
      out.push({ role: 'assistant', content: (steps ? steps + '\n\n' : '') + (m.text || '(no answer)') });
    }
  });
  return out;
}

// ---------- sending ----------
async function send(text) {
  text = text.trim();
  if (!text || A.busy) return;
  const t = thread();
  if (!t.msgs.length) t.title = text.slice(0, 32);
  t.msgs.push({ role: 'user', text });
  const msg = { role: 'agent', text: '', steps: [], pending: true };
  t.msgs.push(msg);
  A.busy = true; A.ctrl = new AbortController(); paint();
  try {
    if (!A.sample) throw { code: A.off || 'unavailable', message: OFF.unavailable };
    const opts = { tools: [makeTool(msg)], signal: A.ctrl.signal, modelTier: A.tier, cache: false, onText: ({ text }) => { msg.text = text; paintSoon(); } };
    if (A.think !== 'auto') opts.effort = A.think;
    const r = await A.sample(turns(t), opts);
    msg.text = r.text || msg.text;
    if (r.truncated) msg.note = NOTES.truncated;
  } catch (e) {
    const code = e && e.code;
    if (code === 'not_granted' || code === 'sampling_disabled') { A.off = code; }
    msg.note = NOTES[code] || (code === 'unavailable' ? OFF.unavailable : `Error: ${(e && e.message) || e}`);
    if (e && e.text) msg.text = e.text;
    msg.error = code !== 'cancelled';
  } finally {
    msg.pending = false; A.busy = false; A.ctrl = null; save(); paint();
  }
}
function revert(step) {
  const t = thread();
  const all = t.msgs.flatMap(m => m.steps || []);
  const k = all.indexOf(step);
  if (k < 0 || !step.snapshot) return;
  const r = wb()._restore(step.snapshot);
  UI.dsl.liveRestore(step.snapshot.live || []);
  if (wb().projects.current) UI.dsl.runProject(wb().projects.current.id);
  for (const s of all.slice(k)) if (s.state === 'ok' || s.state === 'err') s.state = 'reverted';
  UI.toast(`Reverted to the state before this step: ${r.restored || 'no program'}`);
  save(); paint(); UI.refresh(['program', 'revision', 'files', 'projects']);
}

// ---------- the transcript: every message, every call with its code and full result ----------
function transcript(t) {
  const W = wb(), p = W.current, fence = '````';
  const out = [`# Agent transcript: ${t.title}`, '', `Compiler Workbench · exported ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
    `Program: ${p ? `${p.id} at ${p.rev}${W.projects.current ? ` (project ${W.projects.current.id})` : ''}` : 'none'} · mode ${A.mode === 'read' ? 'Read-only' : A.mode === 'ask' ? 'Ask' : 'Auto'} · model ${({ quick: 'Fast', default: 'Balanced', complex: 'Deep' })[A.tier]} · thinking ${A.think}`, ''];
  let n = 0;
  for (const m of t.msgs) {
    if (m.role === 'user') { out.push('## You', '', m.text, ''); continue; }
    out.push('## Agent', '');
    for (const s of m.steps || []) {
      n++;
      out.push(`### eval ${n} · ${s.state === 'err' ? 'error' : s.state}${s.ms ? ` · ${s.ms} ms` : ''}`, '', fence + 'js', s.code, fence, '');
      if (s.result) out.push(fence + 'yaml', s.result, fence, '');
    }
    if (m.text) out.push(m.text, '');
    if (m.note) out.push(`*${m.note}*`, '');
  }
  out.push('---', '', '## Context the agent was given with the last message', '', fence + 'text', contextBlock(), fence, '');
  return out.join('\n');
}
async function exportTranscript(how) {
  const t = thread();
  if (!t.msgs.length) { UI.toast('This thread is empty.'); return; }
  const text = transcript(t), name = `agent-transcript-${t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'thread'}.md`;
  if (how === 'download' && A.downloads) {
    try { await A.downloads.save({ filename: name, data: text }); UI.toast(`Saved ${name}`); }
    catch (e) { const c = e && e.code; if (c === 'declined') UI.toast('Not saved.'); else if (c === 'rate_limited') UI.toast('A save prompt is already open.', true); else { A.downloads = null; paint(); UI.toast('Saving files is not available here. Use Copy instead.', true); } }
    return;
  }
  try { await navigator.clipboard.writeText(text); UI.toast(`Copied the transcript (${text.length.toLocaleString('en-GB')} characters) as Markdown.`); }
  catch { UI.toast('The clipboard is not available here.', true); }
}

// ---------- rendering ----------
let el = null, soon = null;
const paintSoon = () => { if (!soon) soon = requestAnimationFrame(() => { soon = null; paint(); }); };
function paint() { if (el && el.isConnected) render(el); }
function stepHtml(s, k) {
  const first = s.code.split('\n').find(l => l.trim()) || '';
  return `<details class="tool ${s.state === 'run' ? 'run' : s.state === 'ask' ? 'ask' : s.state === 'err' ? 'err' : s.state === 'reverted' ? 'reverted' : ''}" ${s.state === 'ask' ? 'open' : ''} data-step="${k}">
    <summary><span class="dot"></span><span class="nm">eval</span><span class="first">${esc(first)}</span><span class="ms">${s.state === 'ask' ? 'waiting for you' : s.state === 'run' ? 'running' : s.state === 'skipped' ? 'skipped' : s.ms + ' ms'}</span></summary>
    <div class="tb"><pre class="src">${UI.highlight(s.code)}</pre>${s.result ? `<pre class="res${s.state === 'err' ? ' bad' : ''}">${esc(s.result)}</pre>` : ''}
    <div class="row">${s.state === 'ask' ? '<button class="btn sm primary" data-approve>Run it</button><button class="btn sm" data-skip>Skip</button>' : ''}${(s.state === 'ok' || s.state === 'err') && s.snapshot ? '<button class="btn sm" data-revert>Revert to before this step</button>' : ''}<button class="btn sm" data-toconsole>Copy to console</button></div></div></details>`;
}
function suggestions() {
  const W = wb(), pr = W.projects.current;
  const x = pr ? pr.meta : null;
  return [...(x && x.try ? x.try : []), 'Add a tile to this project that charts statements per function across the revisions.', 'How does the pass manager decide which facts go stale? Show me the code.', 'Create a project with a loop where bounds-check elimination removes two checks, with a UI script that marks them.'];
}
function render(root) {
  el = root;
  const t = thread();
  const steps = t.msgs.flatMap(m => m.steps || []);
  const off = A.sample === null || A.off ? (OFF[A.off] || OFF.unavailable) : null;
  root.innerHTML = `<div class="agent-panel">
    <div class="threads">${A.threads.map((x, i) => `<div class="th${i === A.cur ? ' on' : ''}"><button data-th="${i}">${esc(x.title)}</button>${A.threads.length > 1 ? `<button class="x" data-thx="${i}" title="Close thread">×</button>` : ''}</div>`).join('')}<button class="new" data-thnew title="New thread">+ New</button></div>
    <div class="agent-set"><span class="ctl-l">Mode</span><div class="seg sm">${[['auto', 'Auto'], ['ask', 'Ask'], ['read', 'Read-only']].map(([k, l]) => `<button class="${A.mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>
      <span class="ctl-l">Model</span><div class="seg sm">${[['quick', 'Fast'], ['default', 'Balanced'], ['complex', 'Deep']].map(([k, l]) => `<button class="${A.tier === k ? 'on' : ''}" data-tier="${k}">${l}</button>`).join('')}</div>
      <span class="ctl-l">Thinking</span><div class="seg sm">${[['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']].map(([k, l]) => `<button class="${A.think === k ? 'on' : ''}" data-think="${k}">${l}</button>`).join('')}</div></div>
    ${off ? `<div class="agent-off"><b>The agent is off</b>${esc(off)}</div>` : ''}
    <div class="agent-log">${t.msgs.length ? t.msgs.map(m => m.role === 'user' ? `<div class="msg user"><span class="who">You</span><div class="body">${esc(m.text)}</div></div>` :
      `<div class="msg agent${m.error ? ' error' : ''}"><span class="who">Agent</span>${(m.steps || []).map(s => stepHtml(s, steps.indexOf(s))).join('')}${m.text ? `<div class="doc-inline md">${UI.md(m.text, { ids: true })}</div>` : ''}${m.pending && !m.text ? '<span class="thinking">Thinking</span>' : ''}${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}</div>`).join('') :
      `<div class="agent-empty"><p>Ask about the current program, the passes, the checks, or how the workbench itself is built. The agent has one tool: eval, which runs JavaScript against the same API the console uses, including the workbench's own source. It can also change the project's files and add tiles of its own.</p><div class="sugg">${suggestions().map(s => `<button data-sugg="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`}</div>
    <div class="composer"><textarea data-msg placeholder="Ask the agent · Enter sends, Shift+Enter for a new line" ${A.busy ? 'disabled' : ''}>${esc(A.draft || '')}</textarea><div class="row"><span class="meta">${A.busy ? 'working' : `${steps.length} steps in this thread`}</span>${t.msgs.length ? `${A.downloads ? '<button class="btn sm" data-export="download" title="Save the whole thread, with every call and result, as a Markdown file">Download transcript</button>' : ''}<button class="btn sm" data-export="copy" title="Copy the whole thread, with every call and result, as Markdown">Copy transcript</button>` : ''}${A.busy ? '<button class="btn sm" data-stop>Stop</button>' : '<button class="btn sm primary" data-send>Send</button>'}</div></div></div>`;
  const log = root.querySelector('.agent-log'); log.scrollTop = t.msgs.length ? log.scrollHeight : 0;
  const ta = root.querySelector('[data-msg]');
  ta.oninput = () => { A.draft = ta.value; };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = ta.value; A.draft = ''; send(v); } };
  root.onclick = e => {
    const q = s => e.target.closest(s);
    if (q('[data-send]')) { const v = ta.value; A.draft = ''; send(v); return; }
    if (q('[data-stop]')) { if (A.ctrl) A.ctrl.abort(); return; }
    if (q('[data-sugg]')) { send(q('[data-sugg]').dataset.sugg); return; }
    if (q('[data-export]')) { exportTranscript(q('[data-export]').dataset.export); return; }
    if (q('[data-th]')) { A.cur = +q('[data-th]').dataset.th; paint(); return; }
    if (q('[data-thx]')) { if (A.busy) return; A.threads.splice(+q('[data-thx]').dataset.thx, 1); A.cur = Math.max(0, A.cur - 1); save(); paint(); return; }
    if (q('[data-thnew]')) { if (A.busy) return; A.threads.push({ id: Date.now(), title: 'New thread', msgs: [] }); A.cur = A.threads.length - 1; save(); paint(); return; }
    const m = q('[data-mode]'); if (m) { A.mode = m.dataset.mode; UI.store.set('wb.agent.mode', A.mode); paint(); return; }
    const tr = q('[data-tier]'); if (tr) { A.tier = tr.dataset.tier; UI.store.set('wb.agent.tier', A.tier); paint(); return; }
    const th = q('[data-think]'); if (th) { A.think = th.dataset.think; UI.store.set('wb.agent.think', A.think); paint(); return; }
    const stepEl = q('[data-step]');
    if (stepEl) {
      const s = steps[+stepEl.dataset.step];
      if (q('[data-approve]') && s._decide) s._decide(true);
      if (q('[data-skip]') && s._decide) s._decide(false);
      if (q('[data-revert]')) revert(s);
      if (q('[data-toconsole]')) { UI.S.replDraft = s.code; UI.open('console'); }
    }
  };
}
UI.views.agent = { title: 'Agent', on: ['agent'], count: () => A.busy ? '…' : '', render };
UI.agentSend = send;
})(globalThis);
