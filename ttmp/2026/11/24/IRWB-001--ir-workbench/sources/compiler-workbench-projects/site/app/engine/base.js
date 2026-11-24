// base.js: the shared namespace, errors, did-you-mean, YAML for the agent, small helpers.
// Every engine file is a classic script that adds to globalThis.WB, so the same files load in
// a browser <script>, in Node's vm, and are readable one by one through wb.source.
(function (G) {
'use strict';
const WB = G.WB = G.WB || {};

// ---------- errors ----------
// A refusal: the question was malformed. Code, message, and a fix line.
class WorkbenchError extends Error {
  constructor(code, message, extra = {}) {
    super('[' + code + '] ' + message + (extra.fix ? '\n  fix: ' + extra.fix : ''));
    this.name = 'WorkbenchError';
    this.code = code;
    Object.assign(this, extra);
  }
}
WB.WorkbenchError = WorkbenchError;
WB.fail = (code, message, extra) => { throw new WorkbenchError(code, message, extra); };

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
WB.didYouMean = (name, options) => {
  let best = null, score = Infinity;
  for (const o of options) {
    const s = editDistance(String(name).toLowerCase(), String(o).toLowerCase());
    if (s < score) { score = s; best = o; }
  }
  return best && score <= Math.max(2, Math.floor(String(name).length / 3)) ? best : null;
};

// ---------- proxies: read-only handles with diagnostics ----------
// guard(kind, target, members) returns a proxy that answers known members, throws
// unknownMember with a suggestion for anything else, and refuses assignment.
const QUIET = new Set(['then', 'toJSON', 'constructor', 'inspect', 'nodeType', '$$typeof', 'asymmetricMatch',
  'valueOf', 'toString', 'length', '__proto__', 'prototype']);
WB.guard = function guard(kind, target, extraNames = []) {
  return new Proxy(target, {
    get(t, k) {
      if (typeof k === 'symbol' || k in t || QUIET.has(k)) return t[k];
      const names = [...new Set([...Object.keys(t), ...allKeys(t), ...extraNames])].filter(n => !n.startsWith('_'));
      const fromFragment = WB.fragments && WB.fragments.provider(kind, k);
      const near = WB.didYouMean(k, names);
      WB.fail('unknownMember', `${kind} has no member "${String(k)}".` + (near ? ` Did you mean "${near}"?` : ''),
        { fix: fromFragment ? `fragment "${fromFragment}" provides it: wb.use(wb.fragments.get('${fromFragment}'))` : `${kind} members: ${names.slice(0, 24).join(', ')}` });
    },
    set(t, k) {
      if (typeof k === 'string' && k.startsWith('_')) { t[k] = arguments[2]; return true; }
      WB.fail('immutable', `${kind} is read-only; assigning .${String(k)} has no effect.`,
        { fix: 'change programs only through passes (tx) or a live session: p.apply(pass), p.edit(source)' });
    },
    deleteProperty(t, k) { WB.fail('immutable', `${kind} is read-only; delete .${String(k)} has no effect.`); },
  });
};
function allKeys(o) {
  const out = [];
  for (let p = Object.getPrototypeOf(o); p && p !== Object.prototype; p = Object.getPrototypeOf(p))
    for (const k of Object.getOwnPropertyNames(p)) if (k !== 'constructor') out.push(k);
  return out;
}

// ---------- YAML, the format results reach the agent in ----------
const PLAIN = /^[A-Za-z0-9 _.,:/()+\-·×→%#@'=<>!?*[\]{}|&^~$]*$/;
function yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e5) / 1e5) : String(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
  const s = String(v);
  if (s === '') return '""';
  if (s.includes('\n')) return null;
  if (s.length < 120 && PLAIN.test(s) && !/^[\s\-?:[{]|:\s|\s$/.test(s) && !/^(true|false|null|\d)/.test(s)) return s;
  return JSON.stringify(s);
}
WB.yaml = function yaml(value, depth = 0, seen = new Set()) {
  const pad = '  '.repeat(depth);
  const sc = yamlScalar(value);
  if (typeof value !== 'object' || value === null) {
    if (sc !== null) return sc;
    return '|\n' + String(value).split('\n').map(l => pad + '  ' + l).join('\n');
  }
  if (seen.has(value)) return '[circular]';
  if (value._describe) value = value._describe();
  if (depth > 5) return Array.isArray(value) ? `[array ${value.length}]` : '{…}';
  seen = new Set(seen); seen.add(value);
  if (value instanceof Map) value = Object.fromEntries(value);
  if (value instanceof Set) value = [...value];
  if (ArrayBuffer.isView(value)) value = Array.from(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every(x => typeof x === 'number')) {
      const shown = value.slice(0, 64).map(yamlScalar).join(', ');
      return '[' + shown + (value.length > 64 ? `, … ${value.length - 64} items` : '') + ']';
    }
    const items = value.slice(0, 60).map(x => {
      const inner = WB.yaml(x, depth + 1, seen);
      if (typeof x === 'object' && x !== null && !Array.isArray(x) && !(x instanceof Map) && inner.includes('\n'))
        return pad + '- ' + inner.replace(/^\s+/, '');
      return pad + '- ' + inner;
    });
    if (value.length > 60) items.push(pad + `# … ${value.length - 60} more`);
    return '\n' + items.join('\n');
  }
  const keys = Object.keys(value).filter(k => !k.startsWith('_'));
  if (!keys.length) return '{}';
  const lines = keys.slice(0, 80).map(k => {
    const v = value[k];
    const inner = WB.yaml(v, depth + 1, seen);
    if (inner.startsWith('\n')) return pad + k + ':' + inner;
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && inner !== '{}' && !inner.startsWith('[') && inner !== '[circular]')
      return pad + k + ':\n' + inner;
    return pad + k + ': ' + inner;
  });
  if (keys.length > 80) lines.push(pad + `# … ${keys.length - 80} more keys`);
  return (depth ? '' : '') + lines.join('\n');
};
WB.toYaml = v => { const s = WB.yaml(v); return s.startsWith('\n') ? s.slice(1) : s; };

// ---------- helpers ----------
WB.i32 = n => n | 0;
WB.hash = function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0'); };
WB.rng = function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
WB.fmt = n => typeof n === 'number' ? n.toLocaleString('en-GB') : String(n);
WB.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
})(globalThis);
