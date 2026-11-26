#!/usr/bin/env node
// IRWB-019 stage-1 differential cross-check: random valid programs in Tix's fixed core, a reference evaluation of
// each program's syntax tree under the brief's f32 meaning, and every implementation run on the same inputs.
//   node crosscheck.mjs gen <programs.json> [--programs 60] [--cases 3] [--seed 7]
//   node crosscheck.mjs run <programs.json> <results.json> <worktree>...   (one child process per worktree)
//   node crosscheck.mjs worker <worktree> <programs.json>                   (internal; prints JSON)
// Written from the brief alone. Programs avoid domain errors by construction: log and sqrt take e*e + c, exp takes
// tanh(e) * k, and division is by e*e + 1 or by a shape value, so every intermediate is finite.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const f = Math.fround;
const [mode, ...rest] = process.argv.slice(2);
const opt = (name, d) => (rest.includes(name) ? Number(rest[rest.indexOf(name) + 1]) : d);

// ---------- generation ----------
const EXT = ['N', 'C'];
const INPUTS = [{ name: 'x', dims: ['N', 'C'] }, { name: 'u', dims: ['N'] }, { name: 'v', dims: ['C'] }];
const LITS = [0.5, 2, 1.25, 3, 0.1, 0.001, 7, 0.3333333333];
function generate(rnd) {
  const pick = a => a[Math.floor(rnd() * a.length)];
  let fresh = 0;
  const tensors = INPUTS.map(t => ({ ...t }));
  const stmts = [];
  const nStmts = 2 + Math.floor(rnd() * 3);
  const refTo = (t, idxs) => {
    // fill each dim of t with an index of that extent
    const names = t.dims.map(d => { const c = idxs.filter(x => x.ext === d); return c.length ? pick(c).name : null; });
    return names.every(Boolean) ? { k: 'ref', t: t.name, idx: names } : null;
  };
  const uses = (e, n) => e.k === 'ref' ? e.idx.includes(n) : e.k === 'red' ? uses(e.body, n) :
    e.k === 'bin' ? uses(e.a, n) || uses(e.b, n) : e.k === 'neg' ? uses(e.a, n) : e.k === 'call' ? e.args.some(a => uses(a, n)) : false;
  const forceUse = (e, ix) => {
    const t = pick(tensors.filter(t => t.dims.includes(ix.ext) && t.dims.length === 1)) ?? INPUTS.find(t => t.dims[0] === ix.ext);
    return { k: 'bin', op: pick(['+', '*', '-']), a: e, b: { k: 'ref', t: t.name, idx: [ix.name] } };
  };
  const gen = (depth, idxs, redOk) => {
    const r = rnd();
    if (depth <= 0 || r < 0.2) {
      const q = rnd();
      if (q < 0.12) return { k: 'num', v: pick(LITS) };
      if (q < 0.18) return { k: 'shape', name: pick(EXT) };
      for (let tries = 0; tries < 8; tries++) { const e = refTo(pick(tensors), idxs); if (e) return e; }
      return { k: 'num', v: pick(LITS) };
    }
    if (r < 0.6) {
      const op = pick(['+', '-', '*', '/', '/s']);
      const a = gen(depth - 1, idxs, redOk);
      if (op === '/') { const d = gen(depth - 2, idxs, false); return { k: 'bin', op: '/', a, b: { k: 'bin', op: '+', a: { k: 'bin', op: '*', a: d, b: d }, b: { k: 'num', v: 1 } } }; }
      if (op === '/s') return { k: 'bin', op: '/', a, b: { k: 'shape', name: pick(EXT) } };
      return { k: 'bin', op, a, b: gen(depth - 1, idxs, redOk) };
    }
    if (r < 0.7) return { k: 'neg', a: gen(depth - 1, idxs, redOk) };
    if (r < 0.82) {
      const fn = pick(['exp', 'log', 'sqrt', 'tanh', 'max', 'min']);
      const a = gen(depth - 1, idxs, redOk);
      if (fn === 'exp') return { k: 'call', f: 'exp', args: [{ k: 'bin', op: '*', a: { k: 'call', f: 'tanh', args: [a] }, b: { k: 'num', v: 2 } }] };
      if (fn === 'log' || fn === 'sqrt') return { k: 'call', f: fn, args: [{ k: 'bin', op: '+', a: { k: 'bin', op: '*', a, b: a }, b: { k: 'num', v: 0.5 } }] };
      if (fn === 'tanh') return { k: 'call', f: 'tanh', args: [a] };
      // max(N, C) would be ambiguous with a two-index reduction; keep a bare shape name out of call arguments
      const noBare = e => (e.k === 'shape' ? { k: 'bin', op: '*', a: e, b: { k: 'num', v: 1 } } : e);
      return { k: 'call', f: fn, args: [noBare(a), noBare(gen(depth - 1, idxs, redOk))] };
    }
    if (!redOk) return gen(depth - 1, idxs, redOk);
    const n = rnd() < 0.75 ? 1 : 2;
    const ri = Array.from({ length: n }, () => ({ name: `r${fresh++}`, ext: pick(EXT) }));
    let body = gen(depth - 1, [...idxs, ...ri], rnd() < 0.3);
    for (const x of ri) if (!uses(body, x.name)) body = forceUse(body, x);
    return { k: 'red', op: rnd() < 0.7 ? 'sum' : 'max', idx: ri.map(x => x.name), ext: ri.map(x => x.ext), body };
  };
  for (let s = 0; s < nStmts; s++) {
    const rank = 1 + Math.floor(rnd() * 2);
    const dims = rank === 2 ? ['N', 'C'] : [pick(EXT)];
    const lhs = dims.map(d => ({ name: `i${fresh++}`, ext: d }));
    let body = gen(3, lhs, true);
    for (const x of lhs) if (!uses(body, x.name)) body = forceUse(body, x);
    const name = `t${s}`;
    stmts.push({ name, idx: lhs.map(x => x.name), ext: dims, body });
    tensors.push({ name, dims });
  }
  return stmts;
}

// ---------- printing (minimal parentheses by precedence; reductions always parenthesized) ----------
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };
const atom = e => ['num', 'shape', 'ref', 'call'].includes(e.k);
const num = v => (Number.isInteger(v) ? String(v) : String(v));
function show(e) {
  switch (e.k) {
    case 'num': return num(e.v);
    case 'shape': return e.name;
    case 'ref': return `${e.t}[${e.idx.join(', ')}]`;
    case 'call': return `${e.f}(${e.args.map(show).join(', ')})`;
    case 'neg': return `-${atom(e.a) ? show(e.a) : `(${show(e.a)})`}`;
    case 'red': return `(${e.op}(${e.idx.join(', ')}) ${show(e.body)})`;
    case 'bin': {
      const p = PREC[e.op];
      const L = e.a.k === 'bin' && PREC[e.a.op] < p ? `(${show(e.a)})` : show(e.a);
      const R = e.b.k === 'bin' && PREC[e.b.op] <= p ? `(${show(e.b)})` : show(e.b);
      return `${L} ${e.op} ${R}`;
    }
  }
}
const source = stmts => {
  const last = stmts.at(-1);
  return `fn g(x: f32[N, C], u: f32[N], v: f32[C]): f32[${last.ext.join(', ')}] {\n` +
    stmts.map(s => `  ${s.name}[${s.idx.join(', ')}] = ${show(s.body)};\n`).join('') + `  return ${last.name};\n}\n`;
};

// ---------- reference evaluation under the brief's meaning ----------
function evaluate(stmts, sizes, inputs, r) {
  const T = {};
  for (const t of INPUTS) T[t.name] = { dims: t.dims.map(d => sizes[d]), data: inputs[t.name] };
  const get = (t, ix) => { const a = T[t]; let o = 0; ix.forEach((x, d) => { o = o * a.dims[d] + x; }); return a.data[o]; };
  const ev = (e, env) => {
    switch (e.k) {
      case 'num': return r(e.v);
      case 'shape': return r(sizes[e.name]);
      case 'ref': return get(e.t, e.idx.map(n => env[n]));
      case 'neg': return r(-ev(e.a, env));
      case 'call': { const a = e.args.map(x => ev(x, env)); return r(e.f === 'max' ? Math.max(a[0], a[1]) : e.f === 'min' ? Math.min(a[0], a[1]) : Math[e.f](a[0])); }
      case 'bin': { const a = ev(e.a, env), b = ev(e.b, env); return r(e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : a / b); }
      case 'red': {
        let acc = e.op === 'sum' ? 0 : -Infinity;
        const ext = e.ext.map(d => sizes[d]), ix = new Array(ext.length).fill(0), total = ext.reduce((a, b) => a * b, 1);
        for (let n = 0; n < total; n++) {
          const sub = { ...env }; e.idx.forEach((name, d) => { sub[name] = ix[d]; });
          const b = ev(e.body, sub);
          acc = e.op === 'sum' ? r(acc + b) : r(Math.max(acc, b));
          for (let d = ext.length - 1; d >= 0 && ++ix[d] === ext[d]; d--) ix[d] = 0;
        }
        return acc;
      }
    }
  };
  for (const s of stmts) {
    const ext = s.ext.map(d => sizes[d]), total = ext.reduce((a, b) => a * b, 1), data = new Float64Array(total), ix = new Array(ext.length).fill(0);
    for (let n = 0; n < total; n++) {
      const env = {}; s.idx.forEach((name, d) => { env[name] = ix[d]; });
      data[n] = ev(s.body, env);
      for (let d = ext.length - 1; d >= 0 && ++ix[d] === ext[d]; d--) ix[d] = 0;
    }
    T[s.name] = { dims: ext, data };
  }
  return T[stmts.at(-1).name];
}
const bitsOf = a => Array.from(new Uint32Array(Float32Array.from(a).buffer));

if (mode === 'gen') {
  let seed = opt('--seed', 7);
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const programs = [];
  for (let p = 0; p < opt('--programs', 60); p++) {
    const stmts = generate(rnd), cases = [];
    for (let c = 0; c < opt('--cases', 3); c++) {
      const sizes = { N: 1 + Math.floor(rnd() * 6), C: 1 + Math.floor(rnd() * 7) };
      const inputs = {};
      for (const t of INPUTS) inputs[t.name] = Array.from({ length: t.dims.reduce((a, d) => a * sizes[d], 1) }, () => f(rnd() * 4 - 2));
      const r32 = evaluate(stmts, sizes, inputs, f), r64 = evaluate(stmts, sizes, inputs, x => x);
      cases.push({ sizes, inputs, shape: r32.dims, f32bits: bitsOf(r32.data), f64: Array.from(r64.data) });
    }
    programs.push({ source: source(stmts), cases });
  }
  fs.writeFileSync(rest[0], JSON.stringify(programs));
  console.log(`wrote ${programs.length} programs to ${rest[0]}`);
} else if (mode === 'worker') {
  const [wt, file] = rest;
  const api = await import(pathToFileURL(path.join(wt, 'dist/tensor/index.js')).href);
  const programs = JSON.parse(fs.readFileSync(file, 'utf8'));
  const input = (c, name) => ({ shape: INPUTS.find(t => t.name === name).dims.map(d => c.sizes[d]), data: Float32Array.from(c.inputs[name]) });
  const run = (prog, c, precision) => {
    const o = api.runTix(prog, 'g', { x: input(c, 'x'), u: input(c, 'u'), v: input(c, 'v') }, precision ? { precision } : undefined);
    return { shape: Array.from(o.shape), data: Array.from(o.data) };
  };
  const out = [];
  for (const p of programs) {
    const res = { compile: null, f32: [], f64: [], inline: null, split: null };
    let prog;
    try { prog = api.compileTix(p.source); res.compile = 'ok'; } catch (e) { res.compile = String(e?.message ?? e).slice(0, 160); out.push(res); continue; }
    for (const c of p.cases) {
      try { const o = run(prog, c); res.f32.push(JSON.stringify(o.shape) === JSON.stringify(c.shape) && JSON.stringify(bitsOf(o.data)) === JSON.stringify(c.f32bits) ? 'same' : 'differs'); } catch (e) { res.f32.push('error: ' + String(e?.message).slice(0, 120)); }
      try { const o = run(prog, c, 'f64'); res.f64.push(o.data.every((x, i) => Math.abs(x - c.f64[i]) <= 1e-9 * Math.max(1, Math.abs(c.f64[i]))) ? 'close' : 'far'); } catch (e) { res.f64.push('error: ' + String(e?.message).slice(0, 120)); }
    }
    for (const pass of ['inline', 'split-sum']) {
      const t0 = Date.now();
      try {
        const r = api.optimizeTix(prog, [pass]);
        const accepted = r.steps.length > 0 && r.steps.every(s => s.accepted === true);
        let preserved = null;
        if (accepted) preserved = p.cases.every(c => {
          if (pass === 'inline') { const o = run(r.program, c); return JSON.stringify(bitsOf(o.data)) === JSON.stringify(c.f32bits); }
          const o = run(r.program, c, 'f64'); return o.data.every((x, i) => Math.abs(x - c.f64[i]) <= 1e-9 * Math.max(1, Math.abs(c.f64[i])));
        });
        res[pass === 'inline' ? 'inline' : 'split'] = { accepted, preserved, ms: Date.now() - t0 };
      } catch (e) { res[pass === 'inline' ? 'inline' : 'split'] = { error: String(e?.message ?? e).slice(0, 160), ms: Date.now() - t0 }; }
    }
    out.push(res);
  }
  process.stdout.write(JSON.stringify(out));
} else if (mode === 'run') {
  const [file, outFile, ...wts] = rest;
  const programs = JSON.parse(fs.readFileSync(file, 'utf8'));
  const all = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  for (const wt of wts) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, 'worker', wt, path.resolve(file)], { encoding: 'utf8', timeout: 900000, maxBuffer: 1 << 28 });
    let res; try { res = JSON.parse(r.stdout); } catch { all[path.basename(wt)] = { error: (r.stderr || r.error?.message || 'no output').slice(-400) }; fs.writeFileSync(outFile, JSON.stringify(all, null, 1)); console.log(`${path.basename(wt)}: worker failed: ${(r.stderr || r.error?.message || '').slice(-200)}`); continue; }
    const count = (xs, v) => xs.filter(x => x === v).length;
    const s = {
      programs: programs.length,
      compiled: res.filter(x => x.compile === 'ok').length,
      compileErrors: res.filter(x => x.compile !== 'ok').map(x => x.compile).slice(0, 5),
      f32Same: res.reduce((a, x) => a + count(x.f32, 'same'), 0), f32Cases: res.reduce((a, x) => a + x.f32.length, 0),
      f64Close: res.reduce((a, x) => a + count(x.f64, 'close'), 0),
      runErrors: res.flatMap(x => [...x.f32, ...x.f64].filter(y => y.startsWith('error'))).slice(0, 5),
      inlineAccepted: res.filter(x => x.inline?.accepted).length, inlinePreserved: res.filter(x => x.inline?.preserved).length,
      inlineErrors: res.filter(x => x.inline?.error).map(x => x.inline.error).slice(0, 3),
      splitAccepted: res.filter(x => x.split?.accepted).length, splitPreserved: res.filter(x => x.split?.preserved).length,
      splitErrors: res.filter(x => x.split?.error).map(x => x.split.error).slice(0, 3),
      optimizeMs: res.reduce((a, x) => a + (x.inline?.ms ?? 0) + (x.split?.ms ?? 0), 0),
      differing: res.map((x, i) => x.f32.includes('differs') ? i : -1).filter(i => i >= 0).slice(0, 10),
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
    };
    all[path.basename(wt)] = s;
    fs.writeFileSync(outFile, JSON.stringify(all, null, 1));
    console.log(`${path.basename(wt).padEnd(22)} compiled ${s.compiled}/${s.programs}  f32 ${s.f32Same}/${s.f32Cases}  f64 ${s.f64Close}/${s.f32Cases}  inline ${s.inlineAccepted} acc ${s.inlinePreserved} kept  split ${s.splitAccepted} acc ${s.splitPreserved} kept  ${s.seconds}s`);
  }
}
