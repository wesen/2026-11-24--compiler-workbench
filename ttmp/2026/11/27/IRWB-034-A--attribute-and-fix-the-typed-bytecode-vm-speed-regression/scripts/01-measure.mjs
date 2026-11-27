// From the worktree root, run after npm run build.
// node <this file> vm [pass-to-omit...] | corpus [project...]
import assert from 'node:assert/strict';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
import { projectFiles, projectIds } from '../../../../../../tools/corpus.mjs';
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import { lowerToImage, runImage } from '../../../../../../dist/typed/backend/index.js';
import { benchCase, casesFrom } from '../../../../../../dist/typed/evaluate.js';
import { storeOf } from '../../../../../../dist/typed/ir.js';
import { PIPELINES } from '../../../../../../dist/typed/passes.js';
import { ingestProject, projectSource, runPipeline } from '../../../../../../dist/typed/project.js';

await installVendor();
const [mode, ...args] = process.argv.slice(2);
const backend = { coalesce: true };

function load(id) {
  const { meta } = projectSource(id, projectFiles(id));
  const origin = ingestProject(projectSource(id, projectFiles(id)));
  const store = storeOf(origin.value);
  return { meta, origin, store };
}

async function pipeline(origin, meta, names, manager) {
  const result = await runPipeline(origin, names, { manager, inputs: meta.inputs, roots: meta.entries });
  return result;
}

function fixtureResult(artifact, cases, options) {
  const { image } = lowerToImage(artifact, options);
  return cases.map(c => {
    const run = runImage(image, c.fn, c.args, c.memory);
    assert.equal(run.trap, false);
    let stack = 0;
    const ops = {};
    for (const i of image.value.insns) {
      const n = run.counts[i.offset / 4];
      if (n) ops[i.op] = (ops[i.op] ?? 0) + n;
      if (/\(sp\)/.test(i.text)) stack += n;
    }
    assert.equal(Object.values(ops).reduce((a, b) => a + b, 0), run.steps);
    return { steps: run.steps, stack, ops };
  });
}

if (mode === 'vm') {
  const { meta, origin, store } = load('bytecode-vm');
  const input = meta.inputs.runVm;
  const cases = input.entry.oneOf.map(entry =>
    benchCase(store, 'runVm', { code: input.code, entry, n: 12, seed: 8 }),
  );
  const manager = new AnalysisManager();
  const speed = await pipeline(origin, meta, PIPELINES.speed.filter(name => !args.includes(name)), manager);
  const o2 = await pipeline(origin, meta, 'O2', manager);
  for (const options of [{}, backend]) {
    const measure = a => fixtureResult(a, cases, options);
    const rows = [{ pass: 'r0', runs: measure(origin) }];
    for (const s of speed.steps) {
      assert.ok(!s.rejected, s.rejected);
      if (!s.changed) continue;
      rows.push({ pass: s.pass, rev: s.rev, runs: measure(s.result.artifact), kinds: s.report.kinds });
    }
    rows.push({ pass: 'O2 head', runs: measure(o2.artifact) });
    console.log(JSON.stringify({ options, omit: args, rows }));
  }
} else if (mode === 'corpus') {
  for (const id of args.length ? args : projectIds()) {
    try {
      const { meta, origin, store } = load(id);
      const cases = (meta.entries ?? origin.value.fnOrder).flatMap(fn =>
        casesFrom(store, fn, { inputs: meta.inputs[fn], count: 100, seed: 7 }),
      );
      const manager = new AnalysisManager();
      const configs = { default: {}, coalesce: backend, extras: { chains: true, coalesce: true, homes: true } };
      const results = {};
      for (const name of ['O2', 'speed']) {
        const run = await pipeline(origin, meta, name, manager);
        results[name] = { rejected: run.steps.filter(s => s.rejected).map(s => s.pass) };
        for (const [config, options] of Object.entries(configs)) {
          const { image } = lowerToImage(run.artifact, options);
          let steps = 0;
          let uncounted = 0;
          for (const c of cases) {
            const r = runImage(image, c.fn, c.args, c.memory, { counts: false });
            if (Number.isFinite(r.steps)) steps += r.steps;
            else uncounted++;
          }
          results[name][config] = { steps, uncounted };
        }
      }
      console.log(JSON.stringify({ id, cases: cases.length, ...results }));
    } catch (e) {
      console.log(JSON.stringify({ id, error: String(e) }));
    }
  }
} else throw new Error('Use vm or corpus');
