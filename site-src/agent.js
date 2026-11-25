// agent.js: the agent panel (a port of Compiler Workbench's agent.js). One tool, eval(code): the code runs as the
// body of an async function with the workbench in scope (wb, p, project, ui, src, book, log, yaml), and its result
// comes back as YAML. Threads, modes (Auto, Ask, Read-only), model and thinking settings, a snapshot before every
// step so any step can be reverted.
//
// OFF BY DEFAULT. This build ships no model connection, no API key and makes no network request. The prototype
// asked Claude through its host page's `claude.use('sample')` capability; here the panel works only when the page
// defines, before app.js loads,
//
//   window.WB_AGENT = { sample: async (messages, { tools, signal, onText, modelTier, effort }) => ({ text }) }
//
// where `messages` is [{ role: 'user' | 'assistant', content }] and each tool is { name, description,
// inputSchema, execute(input) } that `sample` must call when the model asks for it. Whatever `sample` does (and
// whatever it sends where) is up to the page that defines it.
import { UI, esc } from './ui.js';
import { toYaml } from './wb.js';

const wb = () => UI.wb;
const MAX_RESULT = 9000;

const A = (UI.agent = { threads: [], cur: 0, mode: 'auto', tier: 'default', think: 'auto', busy: false, sample: null, off: null, ctrl: null });
try {
  const t = JSON.parse(UI.store.get('wb.agent.threads') || '[]');
  if (Array.isArray(t) && t.length) A.threads = t;
} catch {
  /* fresh */
}
if (!A.threads.length) A.threads = [{ id: 1, title: 'New thread', msgs: [] }];
A.mode = UI.store.get('wb.agent.mode') || 'auto';
A.tier = UI.store.get('wb.agent.tier') || 'default';
A.think = UI.store.get('wb.agent.think') || 'auto';
const save = () => {
  try {
    UI.store.set('wb.agent.threads', JSON.stringify(A.threads.map(t => ({ ...t, msgs: t.msgs.map(m => ({ ...m, steps: (m.steps || []).map(s => ({ ...s, snapshot: undefined })) })) })).slice(-12)));
  } catch {
    /* too big or unavailable */
  }
};
const thread = () => A.threads[Math.min(A.cur, A.threads.length - 1)];

// ---------- the model connection: only what the page configures explicitly ----------
UI.agentConfigure = function agentConfigure(cfg) {
  A.sample = cfg && typeof cfg.sample === 'function' ? cfg.sample : null;
  A.off = A.sample ? null : 'unconfigured';
  if (UI.refresh) UI.refresh(['agent']);
};
UI.agentConfigure(globalThis.WB_AGENT);
const OFF = {
  unconfigured:
    'This build has no model connection: it makes no network requests and carries no API key. The panel, its threads and the eval tool are here; to use them, the page must define window.WB_AGENT = { sample(messages, options) } before app.js loads (see site-src/agent.js). The rest of the workbench works without it.',
  not_granted: 'The model connection refused this request.',
  rate_limited: 'The model connection is rate limited right now. Wait a little and send again.',
};
const NOTES = {
  cancelled: 'Stopped.',
  rate_limited: 'Rate limited: wait a little, then send again.',
  prompt_too_large: 'The conversation is too long for one request. Start a new thread.',
  refused: 'The model declined this request.',
  truncated: 'The answer was cut off at its length limit.',
};

// ---------- the tool ----------
const TOOL_DESC = `Run JavaScript in the compiler workbench. The code is the body of an async function: use await, and return a value to see it as YAML (cut at ${MAX_RESULT} characters). log(x) prints along the way.
In scope: wb (the workbench root), p (the current program handle, or null), project (the open project, or null), ui (the live UI: add tiles with ui.live.tile(id)), src (= wb.source: the workbench's own source files), book (= wb.book), log, yaml.
Change programs only through the API: p.apply(pass), p.pipeline('O2'), p.undo(); change a project through its files: project.files.write(path, text). Handles are read-only proxies; an unknown member or an assignment throws an error with a fix line. Keep each call small and focused; return only what you need.`;
function snapshot() {
  return { ...wb()._snapshot(), live: UI.dsl.liveSnapshot() };
}
async function runEval(code, step) {
  const r = await UI.evalCode(code, { readOnly: A.mode === 'read', label: 'agent eval' });
  step.ms = r.ms;
  let text = r.logs.length ? r.logs.map(l => 'log: ' + l).join('\n') + '\n' : '';
  if (r.error) text += 'error: ' + (r.error.message || String(r.error));
  else text += r.result === undefined ? (r.logs.length ? '' : 'undefined (return a value to see it)') : toYaml(r.result);
  if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + `\n… cut at ${MAX_RESULT} characters: return less, or slice the result`;
  step.result = text;
  step.state = r.error ? 'err' : 'ok';
  return text;
}
function makeTool(msg) {
  return {
    name: 'eval',
    description: TOOL_DESC,
    inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The body of an async function. Return a value to see it.' } }, required: ['code'] },
    execute: async input => {
      const code = String((input && input.code) || '');
      const step = { code, state: 'run', ms: 0, result: '' };
      msg.steps.push(step);
      if (A.mode === 'ask') {
        step.state = 'ask';
        paint();
        const ok = await new Promise(res => {
          step._decide = res;
        });
        delete step._decide;
        if (!ok) {
          step.state = 'skipped';
          step.result = 'skipped by the user';
          paint();
          return 'The user skipped this step. Do not retry it; ask what they want instead, or continue without it.';
        }
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

Work is organised in projects. A project is a set of plain files: project.json, *.typed sources, scripts/*.js (workbench scripts), ui/*.js (UI scripts that build tiles), notes.md.

The pass manager is asynchronous in this build; in eval, calls such as p.apply(pass) and p.pipeline('O2') still return their results directly (the code is replayed after each new pass), and await works as well.

How to work:
- Measure, do not guess: when you state a number, get it from a call first.
- Keep calls small. Return only what you need.
- Ids look like fn:blend, bb:blend.3, s:blend.7, v:blend.12, op:blend#5, insn:blend+0x1c, img:blend@r4. Write them in backticks in your answer; they become links.
- Links: a project as [Enums and match](project:match-enum), a project file as [ui/status.js](file:ui/status.js), a book chapter as [Bounds checks](chapter:bounds).
- Errors carry a code and a fix line: read them and adjust instead of retrying the same call.
- In Read-only mode, calls that change programs or project files are refused; say what you would do instead.

The API reference follows. wb.help(topic) prints one section again.

${UI.content.reference || ''}

Projects available now, as id: title:
${W.projects
  .list()
  .map(x => `- ${x.id}: ${x.title}`)
  .join('\n')}

Book chapters, as id: title:
${UI.content.book.map(c => `- ${c.id}: ${c.title}`).join('\n')}`;
}
function contextBlock() {
  const W = wb(),
    p = W.current,
    S = UI.S;
  const lines = ['[context]'];
  if (p) {
    const pr = W.projects.current;
    lines.push(`current program: ${p.id} at ${p.rev}, status ${p.status}${pr ? `, from project ${pr.id}` : ''}`);
    if (pr) {
      lines.push(`project files: ${pr.files
        .list()
        .map(f => f.path + (f.edited ? ' (edited)' : ''))
        .join(', ')}`);
      const u = pr.uiScripts();
      if (u.length) lines.push(`UI scripts: ${u.map(x => x.name + (x.on ? '' : ' (off)') + (UI.dsl.errors.get(pr.id + '/' + x.name) ? ' (error: ' + UI.dsl.errors.get(pr.id + '/' + x.name).split('\n')[0] + ')' : '')).join(', ')}`);
    }
    if (p.status === 'ok') lines.push(`functions: ${p.fns().join(', ')}; selected function: ${S.fn}`);
    else if (p.error) lines.push(`front-end error: line ${p.error.line}:${p.error.col} ${p.error.message}`);
  } else lines.push('no program open');
  if (W.focused) lines.push(`selected entity: ${W.focused}`);
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
  if (!A.sample) {
    UI.toast('The agent is off: this build has no model connection.', true);
    return;
  }
  const t = thread();
  if (!t.msgs.length) t.title = text.slice(0, 32);
  t.msgs.push({ role: 'user', text });
  const msg = { role: 'agent', text: '', steps: [], pending: true };
  t.msgs.push(msg);
  A.busy = true;
  A.ctrl = new AbortController();
  UI.refresh(['agent']); // the panel and its tab's badge
  try {
    const opts = {
      tools: [makeTool(msg)],
      signal: A.ctrl.signal,
      modelTier: A.tier,
      cache: false,
      onText: ({ text }) => {
        msg.text = text;
        paintSoon();
      },
    };
    if (A.think !== 'auto') opts.effort = A.think;
    const r = await A.sample(turns(t), opts);
    msg.text = (r && r.text) || msg.text;
    if (r && r.truncated) msg.note = NOTES.truncated;
  } catch (e) {
    const code = e && e.code;
    if (code === 'not_granted') A.off = code;
    msg.note = NOTES[code] || `Error: ${(e && e.message) || e}`;
    if (e && e.text) msg.text = e.text;
    msg.error = code !== 'cancelled';
  } finally {
    msg.pending = false;
    A.busy = false;
    A.ctrl = null;
    save();
    UI.refresh(['agent']);
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
  save();
  paint();
  UI.refresh(['program', 'revision', 'files', 'projects']);
}

// ---------- the transcript: every message, every call with its code and full result ----------
function transcript(t) {
  const W = wb(),
    p = W.current,
    fence = '````';
  const out = [`# Agent transcript: ${t.title}`, '', `Compiler Workbench · exported ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`, `Program: ${p ? `${p.id} at ${p.rev}${W.projects.current ? ` (project ${W.projects.current.id})` : ''}` : 'none'} · mode ${A.mode === 'read' ? 'Read-only' : A.mode === 'ask' ? 'Ask' : 'Auto'} · model ${{ quick: 'Fast', default: 'Balanced', complex: 'Deep' }[A.tier]} · thinking ${A.think}`, ''];
  let n = 0;
  for (const m of t.msgs) {
    if (m.role === 'user') {
      out.push('## You', '', m.text, '');
      continue;
    }
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
async function exportTranscript() {
  const t = thread();
  if (!t.msgs.length) {
    UI.toast('This thread is empty.');
    return;
  }
  const text = transcript(t);
  try {
    await navigator.clipboard.writeText(text);
    UI.toast(`Copied the transcript (${text.length.toLocaleString('en-GB')} characters) as Markdown.`);
  } catch {
    UI.toast('The clipboard is not available here.', true);
  }
}

// ---------- rendering ----------
let el = null,
  soon = null;
const paintSoon = () => {
  if (!soon)
    soon = requestAnimationFrame(() => {
      soon = null;
      paint();
    });
};
function paint() {
  if (el && el.isConnected) render(el);
}
function stepHtml(s, k) {
  const first = s.code.split('\n').find(l => l.trim()) || '';
  return `<details class="tool ${s.state === 'run' ? 'run' : s.state === 'ask' ? 'ask' : s.state === 'err' ? 'err' : s.state === 'reverted' ? 'reverted' : ''}" ${s.state === 'ask' ? 'open' : ''} data-step="${k}">
    <summary><span class="dot"></span><span class="nm">eval</span><span class="first">${esc(first)}</span><span class="ms">${s.state === 'ask' ? 'waiting for you' : s.state === 'run' ? 'running' : s.state === 'skipped' ? 'skipped' : s.ms + ' ms'}</span></summary>
    <div class="tb"><pre class="src">${UI.highlight(s.code)}</pre>${s.result ? `<pre class="res${s.state === 'err' ? ' bad' : ''}">${esc(s.result)}</pre>` : ''}
    <div class="row">${s.state === 'ask' ? '<button class="btn sm primary" data-approve>Run it</button><button class="btn sm" data-skip>Skip</button>' : ''}${(s.state === 'ok' || s.state === 'err') && s.snapshot ? '<button class="btn sm" data-revert>Revert to before this step</button>' : ''}<button class="btn sm" data-toconsole>Copy to console</button></div></div></details>`;
}
function suggestions() {
  const pr = wb().projects.current;
  const x = pr ? pr.meta : null;
  return [...(x && x.try ? x.try : []), 'Add a tile to this project that charts statements per function across the revisions.', 'How do scripts call the asynchronous pass manager synchronously? Show me the code.'];
}
function render(root) {
  el = root;
  const t = thread();
  const steps = t.msgs.flatMap(m => m.steps || []);
  const off = A.off ? OFF[A.off] || OFF.unconfigured : null;
  root.innerHTML = `<div class="agent-panel">
    <div class="threads">${A.threads.map((x, i) => `<div class="th${i === A.cur ? ' on' : ''}"><button data-th="${i}">${esc(x.title)}</button>${A.threads.length > 1 ? `<button class="x" data-thx="${i}" title="Close thread">×</button>` : ''}</div>`).join('')}<button class="new" data-thnew title="New thread">+ New</button></div>
    <div class="agent-set"><span class="ctl-l">Mode</span><div class="seg sm">${[
      ['auto', 'Auto'],
      ['ask', 'Ask'],
      ['read', 'Read-only'],
    ]
      .map(([k, l]) => `<button class="${A.mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`)
      .join('')}</div>
      <span class="ctl-l">Model</span><div class="seg sm">${[
        ['quick', 'Fast'],
        ['default', 'Balanced'],
        ['complex', 'Deep'],
      ]
        .map(([k, l]) => `<button class="${A.tier === k ? 'on' : ''}" data-tier="${k}">${l}</button>`)
        .join('')}</div>
      <span class="ctl-l">Thinking</span><div class="seg sm">${[
        ['auto', 'Auto'],
        ['low', 'Low'],
        ['medium', 'Med'],
        ['high', 'High'],
      ]
        .map(([k, l]) => `<button class="${A.think === k ? 'on' : ''}" data-think="${k}">${l}</button>`)
        .join('')}</div></div>
    ${off ? `<div class="agent-off"><b>The agent is off</b>${esc(off)}</div>` : ''}
    <div class="agent-log">${
      t.msgs.length
        ? t.msgs
            .map(m =>
              m.role === 'user'
                ? `<div class="msg user"><span class="who">You</span><div class="body">${esc(m.text)}</div></div>`
                : `<div class="msg agent${m.error ? ' error' : ''}"><span class="who">Agent</span>${(m.steps || []).map(s => stepHtml(s, steps.indexOf(s))).join('')}${m.text ? `<div class="doc-inline md">${UI.md(m.text, { ids: true })}</div>` : ''}${m.pending && !m.text ? '<span class="thinking">Thinking</span>' : ''}${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}</div>`,
            )
            .join('')
        : `<div class="agent-empty"><p>Ask about the current program, the passes, the checks, or how the workbench itself is built. The agent has one tool: eval, which runs JavaScript against the same API the console uses.</p><div class="sugg">${suggestions()
            .map(s => `<button data-sugg="${esc(s)}" ${A.sample ? '' : 'disabled'}>${esc(s)}</button>`)
            .join('')}</div></div>`
    }</div>
    <div class="composer"><textarea data-msg placeholder="${A.sample ? 'Ask the agent · Enter sends, Shift+Enter for a new line' : 'The agent is off in this build'}" ${A.busy || !A.sample ? 'disabled' : ''}>${esc(A.draft || '')}</textarea><div class="row"><span class="meta">${A.busy ? 'working' : `${steps.length} steps in this thread`}</span>${t.msgs.length ? '<button class="btn sm" data-export title="Copy the whole thread, with every call and result, as Markdown">Copy transcript</button>' : ''}${A.busy ? '<button class="btn sm" data-stop>Stop</button>' : `<button class="btn sm primary" data-send ${A.sample ? '' : 'disabled'}>Send</button>`}</div></div></div>`;
  const log = root.querySelector('.agent-log');
  log.scrollTop = t.msgs.length ? log.scrollHeight : 0;
  const ta = root.querySelector('[data-msg]');
  ta.oninput = () => {
    A.draft = ta.value;
  };
  ta.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const v = ta.value;
      A.draft = '';
      send(v);
    }
  };
  root.onclick = e => {
    const q = s => e.target.closest(s);
    if (q('[data-send]')) {
      const v = ta.value;
      A.draft = '';
      send(v);
      return;
    }
    if (q('[data-stop]')) {
      if (A.ctrl) A.ctrl.abort();
      return;
    }
    if (q('[data-sugg]')) {
      send(q('[data-sugg]').dataset.sugg);
      return;
    }
    if (q('[data-export]')) {
      exportTranscript();
      return;
    }
    if (q('[data-th]')) {
      A.cur = +q('[data-th]').dataset.th;
      paint();
      return;
    }
    if (q('[data-thx]')) {
      if (A.busy) return;
      A.threads.splice(+q('[data-thx]').dataset.thx, 1);
      A.cur = Math.max(0, A.cur - 1);
      save();
      paint();
      return;
    }
    if (q('[data-thnew]')) {
      if (A.busy) return;
      A.threads.push({ id: Date.now(), title: 'New thread', msgs: [] });
      A.cur = A.threads.length - 1;
      save();
      paint();
      return;
    }
    const m = q('[data-mode]');
    if (m) {
      A.mode = m.dataset.mode;
      UI.store.set('wb.agent.mode', A.mode);
      paint();
      return;
    }
    const tr = q('[data-tier]');
    if (tr) {
      A.tier = tr.dataset.tier;
      UI.store.set('wb.agent.tier', A.tier);
      paint();
      return;
    }
    const th = q('[data-think]');
    if (th) {
      A.think = th.dataset.think;
      UI.store.set('wb.agent.think', A.think);
      paint();
      return;
    }
    const stepEl = q('[data-step]');
    if (stepEl) {
      const s = steps[+stepEl.dataset.step];
      if (q('[data-approve]') && s._decide) s._decide(true);
      if (q('[data-skip]') && s._decide) s._decide(false);
      if (q('[data-revert]')) revert(s);
      if (q('[data-toconsole]')) {
        UI.S.replDraft = s.code;
        UI.open('console');
      }
    }
  };
}
UI.views = UI.views || {};
UI.views.agent = { title: 'Agent', on: ['agent'], count: () => (A.busy ? '…' : A.sample ? '' : 'off'), render };
UI.agentSend = send;
