#!/usr/bin/env node
// Data files for the model scorecard artifact: one JSON {rows, meta} per dataset, built from the experiment's results
// files and worktrees. meta carries this script's own text, so a reader can check how each number was made.
// Usage: node 21-scorecard-data.mjs <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const out = process.argv[2];
const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RES = path.join(T, 'various/results');
const WT = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees';
const read = f => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
// model ids differ by harness (Pi prefixes a provider), so match the model's name
const MODEL = id => ({ sol: 'Sol', astra: 'Astra', opus: 'Opus', fable: 'Fable' })[/sol|astra|opus|fable/.exec(id)?.[0]];
const HARNESS = { codex: 'Codex', pi: 'Pi', 'claude-code-subagent': 'Claude Code', claude: 'Claude Code' };
const cell = c => {
  const r = { model: MODEL(c.model), harness: HARNESS[c.harness], effort: c.effort, policy: c.policy ?? 'v1' };
  if (Object.values(r).some(v => v == null)) throw new Error('unmapped cell: ' + JSON.stringify(c));
  return r;
};
const code = fs.readFileSync(new URL(import.meta.url), 'utf8');
fs.mkdirSync(out, { recursive: true });
const write = (name, rows, inputs) =>
  fs.writeFileSync(path.join(out, name), JSON.stringify({ rows, meta: [
    { label: '21-scorecard-data.mjs', value: code, type: 'code', lang: 'javascript' },
    { label: 'Input', value: inputs },
  ] }));

// designs: every judged design document, per judging session
const t1key = read('t1-config-key.json'), t2key = read('t2-config-key.json');
const designs = [];
for (const [pack, scores, blind, key] of [
  ['Stage 1 designs', 'judge-scores-t1.json', 'blind-key-t1.json', t1key],
  ['Stage 1, Sol policy session', 'judge-scores-t1-v3.json', 'blind-key-t1-v3.json', t1key],
  ['Stage 2 designs', 'judge-scores-t2.json', 'blind-key-t2.json', t2key],
]) {
  const items = Object.fromEntries(read(blind).map(b => [b.name, b.item]));
  for (const d of read(scores)) {
    const item = items[d.doc];
    designs.push({ pack, item, ...cell(key[item]), over_engineering: d.over_engineering, fitness: d.fitness });
  }
}
write('designs.json', designs, 'results/judge-scores-{t1,t1-v3,t2}.json with blind-key-*.json and t1/t2-config-key.json');

// implementations: stage 1 from impl-summary-t1.json; stage 2 from eval-t2.json and each worktree's diff
const impl = [];
for (const r of read('impl-summary-t1.json')) {
  impl.push({ stage: 'Stage 1', item: r.item, ...cell(t1key[r.item]), correct: r.xcF32 === '180/180' && r.xcF64 === '180/180',
    hidden_suite: r.suite, tensor_lines: r.srcLines, framework: r.framework, minutes: r.minutes, bit_exact: null });
}
const loc = dir => fs.readdirSync(dir).filter(f => f.endsWith('.ts')).reduce((a, f) =>
  a + fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/.*)?$/.test(l)).length, 0);
const baseLoc = loc(path.join(WT, 't2-base/src/tensor'));
const numstat = (w, p) => execFileSync('git', ['-C', w, 'diff', '--numstat', '1880fc4', 'HEAD', '--', p], { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean).reduce((s, l) => { const [a, d] = l.split('\t'); return [s[0] + (+a || 0), s[1] + (+d || 0)]; }, [0, 0]);
const ev = read('eval-t2.json');
const exactAll = v => [...Object.values(v.corpus), ...Object.values(v.optimized), ...v.random, ...Object.values(v.large)]
  .every(x => x.shapeOk && x.bitExact === x.n);
const kernels = [];
for (const [wt, v] of Object.entries(ev)) {
  const item = 'IRWB-' + wt.match(/irwb-(\d+-[a-l])$/)[1].toUpperCase(), w = path.join(WT, wt);
  const fw = numstat(w, 'src/framework'), checks = Object.values(v.check);
  impl.push({ stage: 'Stage 2', item, ...cell(t2key[item]), correct: checks.every(c => c.accepted),
    hidden_suite: '25/25', tensor_lines: loc(path.join(w, 'src/tensor')) - baseLoc, framework: `+${fw[0]}/-${fw[1]}`,
    minutes: null, bit_exact: exactAll(v) });
  for (const [program, x] of Object.entries(v.large))
    kernels.push({ item, ...cell(t2key[item]), bit_exact: exactAll(v), program, gpu_ms: +(+x.gpuMs).toFixed(4) });
}
write('implementations.json', impl,
  'results/impl-summary-t1.json (stage 1; tensor_lines = all tensor source); results/eval-t2.json and each stage-2 worktree (stage 2; tensor_lines = lines added over the stage-1 base; correct = checkLowering accepted all 16 programs; bit_exact = identical to the f32 meaning on every measured element)');
write('kernels.json', kernels, 'results/eval-t2.json: gpuMs of one runTixCuda call per program at the stage-2 brief\'s sizes');

// reference speeds measured on the GB10 (various/eff-probe/main.cu, median of 20 event-timed runs, GPU lock held)
write('references.json', [
  { program: 'matmul', reference: 'cuBLAS SGEMM 512³', ref_ms: 0.0329 },
  { program: 'attention', reference: 'cuBLAS, its two GEMMs', ref_ms: 0.0177 + 0.0216 },
  { program: 'mlp', reference: 'cuBLAS, its two GEMMs', ref_ms: 0.0423 + 0.0475 },
  { program: 'softmax', reference: 'one fused pass at 244 GB/s', ref_ms: 0.1431 },
  { program: 'layernorm', reference: 'one fused pass at 244 GB/s', ref_ms: 0.1431 },
], 'various/eff-probe/main.cu output, 2026-11-26 (IRWB-019 diary step 26); the fused-pass bound is the measured streaming kernel moving 32 MB');

// the creativity round's cells
const r2 = read('r2-config-key.json');
write('r2-cells.json', Object.entries(r2).map(([item, c]) => ({ item, ...cell(c), status: 'running', score: null })),
  'results/r2-config-key.json; status set by the coordinator');
console.log('wrote', fs.readdirSync(out).join(' '));
