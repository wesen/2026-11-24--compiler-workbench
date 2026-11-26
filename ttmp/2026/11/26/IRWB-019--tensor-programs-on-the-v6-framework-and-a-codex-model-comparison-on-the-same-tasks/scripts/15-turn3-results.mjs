#!/usr/bin/env node
// Write each stage-1 implementer's own evaluation results as text, for the report turn (prompts/t1/turn3.md).
// Usage: node 15-turn3-results.mjs <acceptance.json> <variant.json> <crosscheck.json> <crosscheck.mjs> <programs.json> <out-dir>
//   Writes <out-dir>/<ITEM>.md. For an item whose contract rejected a pass on some cross-check programs, it reruns
//   the cross-check worker on that worktree to list the programs and includes up to two of their sources.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [accFile, varFile, xcFile, xcScript, progFile, outDir] = process.argv.slice(2);
const T = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const key = read(path.join(T, 'various/results/t1-config-key.json'));
const acc = read(accFile), vr = read(varFile), xc = read(xcFile), programs = read(progFile);
fs.mkdirSync(outDir, { recursive: true });
for (const [item, a] of Object.entries(acc)) {
  const c = key[item];
  if (!c || (c.policy ?? 'v1') !== 'v1') continue;
  const wt = c.worktree ?? read(path.join(T, 'various/kit', c.round, 'heads.json'))[item].worktree;
  const x = xc[path.basename(wt)];
  const L = [];
  L.push(`- **Hidden acceptance suite** (25 tests of the fixed core and API, written from the brief before any implementation existed; revision \`${a.rev}\`): ${a.passed}/25 passed.`);
  for (const f of a.firstFailures) L.push(`  - failed: ${f}`);
  if (a.failed && vr[item]) L.push(`- **A variant of that suite** that renames one index in the mlp program (\`y[i, x] = (sum(f) g[i, f] * w2[f, x]) + b2[x]\` becomes \`y[i, e] = …\`, because \`x\` is also mlp's input tensor and the brief does not say whether index and tensor names may coincide): ${vr[item].passed}/25 passed. Both scores are reported.`);
  L.push(`- **Differential cross-check:** 60 random programs in the fixed core, 3 inputs each, compared with an independent reference evaluation. f32 results bit-identical in ${x.f32Same}/${x.f32Cases} cases; \`precision: 'f64'\` results within 1e-9 (relative to max(1, |r|)) in ${x.f64Close}/${x.f32Cases}.`);
  L.push(`- **\`optimizeTix(p, ['inline'])\`** on the same 60 programs: accepted on ${x.inlineAccepted}, and every accepted result is bit-identical to the original.`);
  L.push(`- **\`optimizeTix(p, ['split-sum'])\`:** accepted on ${x.splitAccepted}/60, and every accepted result computes the same function (f64 run within 1e-9).`);
  if (x.splitAccepted < x.programs || x.inlineAccepted < x.programs) {
    const r = spawnSync(process.execPath, [xcScript, 'worker', wt, path.resolve(progFile)], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const res = JSON.parse(r.stdout);
    for (const [pass, k] of [['split-sum', 'split'], ['inline', 'inline']]) {
      const rej = res.map((y, i) => (y[k] && !y[k].accepted ? i : -1)).filter(i => i >= 0);
      if (!rej.length) continue;
      let worst = 0;
      for (const i of rej) for (const cs of programs[i].cases) {
        const f32 = new Float32Array(new Uint32Array(cs.f32bits).buffer);
        cs.f64.forEach((r, j) => { worst = Math.max(worst, Math.abs(f32[j] - r) / Math.max(1, Math.abs(r))); });
      }
      L.push(`- **\`${pass}\` was rejected on ${rej.length} program(s):** ${rej.join(', ')}. Every program is valid and the pass is correct on each, and plain f32 evaluation of these programs stays within ${worst.toExponential(1)} of f64 (relative to max(1, |r|)) on the evaluation's inputs. So each rejection is a false rejection unless your contract found a real violation. ${rej.length > 2 ? 'The first two:' : 'Source:'}`);
      for (const i of rej.slice(0, 2)) L.push('', '```', programs[i].source.trim(), '```');
    }
  }
  fs.writeFileSync(path.join(outDir, `${item}.md`), L.join('\n') + '\n');
  console.log(item, `${a.passed}/25`, x.splitAccepted, x.inlineAccepted);
}
