// md.js: a small Markdown renderer for the book, the reference and the agent's answers, and a
// tokenizer that colours JavaScript and the typed language with the design system's tk- classes.
// Links: project:<id> opens a project (lab:<id> too), file:<path> opens a file of the open project, view:<name> opens a view, chapter:<id> opens a chapter,
// src:<path>#L<n> opens the workbench's own source, focus:<id> selects an entity.
(function (G) {
'use strict';
const UI = G.UI = G.UI || {};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
UI.esc = esc;

// ---------- shared by every UI file: storage, toasts, error guards ----------
UI.store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
UI.toast = function toast(text, bad = false) {
  const box = document.getElementById('toasts'); if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = text.length > 240 ? text.slice(0, 240) + '…' : text;
  box.appendChild(t); setTimeout(() => t.remove(), bad ? 6000 : 2600);
};
UI.guarded = (fn) => (...a) => { try { return fn(...a); } catch (e) { UI.toast(e.message.split('\n')[0], true); console.error(e); } };

const KW = new Set('const let var function return if else for while do break continue new class extends async await of in typeof instanceof try catch finally throw switch case default true false null undefined this yield import export from record enum match type distinct i32 bool string buffer'.split(' '));
UI.highlight = function highlight(code, lang = 'js') {
  if (lang === 'text' || lang === 'yaml' || lang === 'plain') return esc(code);
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([^\sA-Za-z_$\d'"`\/]+|\/)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const [t, c, s, n, w] = m;
    if (c) out += `<span class="tk-c">${esc(c)}</span>`;
    else if (s) out += `<span class="tk-s">${esc(s)}</span>`;
    else if (n) out += `<span class="tk-n">${esc(n)}</span>`;
    else if (w) out += KW.has(w) ? `<span class="tk-k">${w}</span>` : (w === 'wb' || w === 'p' || w === 'tx') ? `<span class="tk-e">${w}</span>` : esc(w);
    else out += `<span class="tk-p">${esc(t)}</span>`;
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
};

function inline(s, opts) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(((?:lab|project|file|view|chapter|src|focus):[^)]+|[^)\s]+)\)/g, (_, text, href) => {
    href = href.trim();
    const lab = /^(lab|project|file|view|chapter|src|focus):/.test(href);
    if (lab) return `<a href="#" class="lablink" data-link="${esc(href)}">${text}</a>`;
    if (/^https?:\/\//.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
    return text;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const c = codes[+i];
    if (opts && opts.ids && /^(s|v|bb|fn|op|insn|img|fact|edit|loop|local):[\w.#@+\-()/]+$/.test(c)) return `<code><a href="#" class="nidlink" data-link="focus:${esc(c)}">${esc(c)}</a></code>`;
    return `<code>${esc(c)}</code>`;
  });
  return s;
}
UI.inline = inline;

UI.md = function md(text, opts = {}) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0, para = [], list = null, figs = 0;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '), opts)}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.kind}>${list.items.map(x => `<li>${inline(x, opts)}</li>`).join('')}</${list.kind}>`); list = null; } };
  while (i < lines.length) {
    const l = lines[i];
    const fence = /^```(\w*)\s*(.*)$/.exec(l);
    if (fence) {
      flushPara(); flushList();
      const lang = fence[1] || 'text', body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      if (lang === 'svg') {
        let cap = '';
        if (i < lines.length && /^Figure[ :.]/.test(lines[i])) { cap = lines[i].replace(/^Figure[ :.]\s*/, ''); i++; }
        figs++;
        out.push(`<figure class="fig">${body.join('\n').replace('<svg', '<svg class="figsvg"')}${cap ? `<figcaption><b>Figure ${opts.chapterN ? opts.chapterN + '.' : ''}${figs}.</b> ${inline(cap, opts)}</figcaption>` : ''}</figure>`);
      } else {
        const code = body.join('\n');
        const runnable = opts.runnable && lang === 'js' && !/^\s*\/\/ (no run|output)/.test(code);
        out.push(`<div class="codewrap"><pre class="src">${UI.highlight(code, lang === 'typed' || lang === 'ts' ? 'js' : lang)}</pre>${runnable ? `<div class="coderow"><button class="btn sm" data-run="${esc(code)}">Run in console</button></div>` : ''}</div>`);
      }
      continue;
    }
    if (/^#{1,4} /.test(l)) {
      flushPara(); flushList();
      const n = /^#+/.exec(l)[0].length, t = l.slice(n + 1);
      const id = t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${n} id="h-${id}">${inline(t, opts)}</h${n}>`);
      i++; continue;
    }
    if (/^> /.test(l)) {
      flushPara(); flushList();
      const body = [];
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^> ?/, ''));
      const kind = /^\*\*Try it/.test(body[0]) ? 'try' : /^\*\*Exercise/.test(body[0]) ? 'exercise' : /^\*\*(Caveat|Careful)/.test(body[0]) ? 'caveat' : '';
      out.push(`<div class="callout ${kind}">${UI.md(body.join('\n'), opts)}</div>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l)) {
      flushPara(); flushList();
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.trim().slice(1, -1).split('|').map(c => c.trim());
      const head = cells(rows[0]), body = rows.slice(/^\|[\s:|-]+\|$/.test(rows[1] || '') ? 2 : 1);
      out.push(`<div class="tablewrap-x"><table class="doc-t rt"><thead><tr>${head.map(h => `<th>${inline(h, opts)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${cells(r).map(c => `<td>${inline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.) (.*)$/.exec(l);
    if (li) {
      flushPara();
      const kind = /\d/.test(li[2]) ? 'ol' : 'ul';
      if (!list || list.kind !== kind) { flushList(); list = { kind, items: [] }; }
      list.items.push(li[3]);
      i++;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^(\s*)([-*]|\d+\.) /.test(lines[i])) list.items[list.items.length - 1] += ' ' + lines[i++].trim();
      continue;
    }
    if (/^\s*$/.test(l)) { flushPara(); flushList(); i++; continue; }
    if (/^---+\s*$/.test(l)) { flushPara(); flushList(); out.push('<hr>'); i++; continue; }
    flushList();
    para.push(l.trim());
    i++;
  }
  flushPara(); flushList();
  return out.join('\n');
};
})(globalThis);
