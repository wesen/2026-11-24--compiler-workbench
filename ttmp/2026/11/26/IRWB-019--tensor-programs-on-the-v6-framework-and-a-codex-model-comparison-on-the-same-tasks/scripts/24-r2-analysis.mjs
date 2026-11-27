#!/usr/bin/env node
// Round R2 judging analysis: four judge runs (Claude and Codex judges, two runs each), mapped through the blind key.
// Prints the overall scores per model and judge run, per-dimension means, error counts, the own-family effect and
// run-to-run differences; writes results/r2-scores.json (one row per judge run and document) for the scorecard.
// Usage: node 24-r2-analysis.mjs   (reads results/r2-judges/run{1,2}-{claude-opus,codex-sol}.md)
import fs from 'node:fs';
import path from 'node:path';

const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RES = path.join(T, 'various/results');
const read = f => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'));
const blind = Object.fromEntries(read('blind-key-r2.json').map(b => [b.name, b.item]));
const key = read('r2-config-key.json');
const MODEL = id => ({ sol: 'Sol', astra: 'Astra', opus: 'Opus', fable: 'Fable' })[/sol|astra|opus|fable/.exec(id)[0]];
const family = m => (m === 'Sol' || m === 'Astra' ? 'OpenAI' : 'Anthropic');
const runs = [
  ['Claude judge', 1, 'run1-claude-opus.md'], ['Claude judge', 2, 'run2-claude-opus.md'],
  ['Codex judge', 1, 'run1-codex-sol.md'], ['Codex judge', 2, 'run2-codex-sol.md'],
];
const DIMS = ['ingenuity', 'creativity', 'scientific_depth', 'evidence', 'correctness', 'grounding', 'padding', 'overall'];
const rows = [];
for (const [judge, run, file] of runs) {
  const text = fs.readFileSync(path.join(RES, 'r2-judges', file), 'utf8');
  const arr = JSON.parse(text.match(/\[\s*\{[\s\S]*\}\s*\]/)[0]);
  for (const d of arr) {
    const item = blind[d.doc], model = MODEL(key[item].model);
    rows.push({ judge, run, judge_family: judge === 'Claude judge' ? 'Anthropic' : 'OpenAI', doc: d.doc, item, model,
      own_family: family(model) === (judge === 'Claude judge' ? 'Anthropic' : 'OpenAI'),
      ...Object.fromEntries(DIMS.map(k => [k, d.scores[k]])), errors: (d.errors ?? []).length });
  }
}
const mean = xs => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
const models = ['Astra', 'Sol', 'Fable', 'Opus'];
console.log('overall per judge run:');
for (const m of models) console.log(' ', m.padEnd(6), runs.map(([j, r]) => rows.find(x => x.model === m && x.judge === j && x.run === r).overall).join('  '), ' mean', mean(rows.filter(x => x.model === m).map(x => x.overall)));
console.log('dimension means over all four judge runs:');
for (const m of models) console.log(' ', m.padEnd(6), DIMS.map(k => `${k.slice(0, 5)} ${mean(rows.filter(x => x.model === m).map(x => x[k]))}`).join('  '));
console.log('errors listed per judge run:');
for (const m of models) console.log(' ', m.padEnd(6), runs.map(([j, r]) => rows.find(x => x.model === m && x.judge === j && x.run === r).errors).join('  '));
for (const j of ['Claude judge', 'Codex judge']) {
  const own = rows.filter(x => x.judge === j && x.own_family).map(x => x.overall), other = rows.filter(x => x.judge === j && !x.own_family).map(x => x.overall);
  console.log(`${j}: own family ${mean(own)}, other family ${mean(other)}, difference ${mean(own) - mean(other)}`);
}
const diffs = [];
for (const j of ['Claude judge', 'Codex judge']) for (const m of models) diffs.push(Math.abs(rows.find(x => x.judge === j && x.run === 1 && x.model === m).overall - rows.find(x => x.judge === j && x.run === 2 && x.model === m).overall));
console.log('run-to-run |difference| in overall, per judge and model:', diffs.join(' '), 'max', Math.max(...diffs));
const code = fs.readFileSync(new URL(import.meta.url), 'utf8');
fs.writeFileSync(path.join(RES, 'r2-scores.json'), JSON.stringify({ rows, meta: [
  { label: '24-r2-analysis.mjs', value: code, type: 'code', lang: 'javascript' },
  { label: 'Input', value: 'results/r2-judges/run{1,2}-{claude-opus,codex-sol}.md, blind-key-r2.json, r2-config-key.json' },
] }));
console.log('wrote results/r2-scores.json,', rows.length, 'rows');
