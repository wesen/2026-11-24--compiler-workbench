#!/usr/bin/env node
// IRWB-051-C script 04: the spike's measurements.
//   node 04-revisions-and-timings.mjs [revisions|timings|all]      (after npm run build)
// revisions: for every Tix program, `inline` under applyNativePassSync, the synchronous and the asynchronous driver;
//            for every Typed corpus project, the O2 pipeline (today's applyPass), and for each input the pipeline gave
//            `strength` (changed or not is unknown to the pipeline's log, so: r0, and the revision before each
//            `strength` revision) the pass under applyPass, the asynchronous and the synchronous driver.
// timings:   milliseconds per application, the variants interleaved in one process. Other agents load this machine,
//            so each figure is CPU time of this process (user + system), median and min..max of the batch means,
//            followed by the smallest wall-clock batch mean.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const mode = process.argv[2] ?? 'all';

const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { strength, optimizationContract } = await imp('dist/typed/passes.js');
const { meaningKept } = await imp('dist/typed/evaluate.js');
const C = await imp('dist/framework/contracts/index.js');
const P = await imp('dist/framework/passes/index.js');
const T = await imp('dist/tensor/index.js');
const { inlinePass } = await imp('dist/tensor/passes.js');
const { meaningGate } = await imp('dist/tensor/contract.js');

const tdir = resolve(root, 'corpus/tensor');
const tix = name => T.compileTix(readFileSync(resolve(tdir, name, 'main.tix'), 'utf8'));
const typedMeaning = params => ({
  id: 'typed.meaning-kept',
  check({ candidate, inputs }) {
    const evidence = C.runDifferential(C.differentialSpec(meaningKept(params)), { origin: inputs.origin, candidate });
    return { ok: evidence.status === 'agree', reason: evidence.counterexamples[0]?.reason, evidence };
  },
});
const meaningParams = p => ({ inputs: p.inputs, count: 40, seed: 7, ...(p.options.entries ? { roots: p.options.entries } : {}) });
const runners = (p, input, audit = true) => {
  const params = meaningParams(p), contract = optimizationContract(params), inputs = { origin: p.origin };
  return {
    applyPass: () => P.applyPass(strength, input, { manager: new C.AnalysisManager(), contract, contractInputs: inputs, auditPreservation: audit }),
    async: () => P.applyTransformation(strength, input, { manager: new C.AnalysisManager(), ensures: [contract], inputs, auditPreservation: audit }),
    sync: () => P.applyTransformationSync(strength, input, { manager: new C.AnalysisManager(), ensures: [typedMeaning(params)], inputs, auditPreservation: audit }),
  };
};
const key = r => `${r.changed ? 'changed' : 'same'} ${r.artifact.revision} edits ${r.edits} preserved ${r.preserved.map(x => x.how[0]).join('')}`;

if (mode !== 'timings') {
  let programs = 0, changed = 0, differences = 0;
  for (const name of readdirSync(tdir)) {
    const p = tix(name);
    const a = P.applyNativePassSync(inlinePass, p.current, meaningGate(p.origin, 'exact'));
    const b = P.applyTransformationSync(inlinePass, p.current, { inputs: { origin: p.origin } });
    const c = await P.applyTransformation(inlinePass, p.current, { inputs: { origin: p.origin } });
    const d = T.optimizeTix(p, ['inline']).program.current.revision;
    programs++;
    if (a.changed) changed++;
    if (new Set([a, b, c].map(r => r.artifact.revision).concat(d)).size !== 1 || a.changed !== b.changed || a.changed !== c.changed) {
      differences++;
      console.log('DIFFERENT tix', name);
    }
  }
  console.log(`tix inline: ${programs} programs, ${changed} changed, ${differences} differences between applyNativePassSync, sync driver, async driver, optimizeTix`);

  let inputs = 0, applied = 0, diffs = 0;
  const where = [];
  for (const id of projectIds()) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') continue;
    await p.pipeline('O2');
    const points = [[0, null]];
    p.revisions.forEach((r, i) => r.pass === 'strength' && points.push([i - 1, r.artifact.revision]));
    for (const [i, pipelineRevision] of points) {
      const run = runners(p, p.revisions[i].artifact);
      const a = await run.applyPass(), b = await run.async(), c = run.sync();
      inputs++;
      if (a.changed) {
        applied++;
        where.push(`${id}@r${i}`);
      }
      if (key(a) !== key(b) || key(a) !== key(c) || (pipelineRevision && pipelineRevision !== c.artifact.revision)) {
        diffs++;
        console.log('DIFFERENT typed', id, `r${i}`, key(a), '|', key(b), '|', key(c), '|', pipelineRevision);
      }
    }
  }
  console.log(`typed strength: ${inputs} inputs (r0 of each project and each input O2 gave strength), ${applied} changed, ${diffs} differences between applyPass, async driver, sync driver (revision, edits, preservation outcomes)`);
  console.log('  changed at:', where.join(', '));
}

if (mode !== 'revisions') {
  const sorted = xs => [...xs].sort((a, b) => a - b);
  const stat = xs => {
    const s = sorted(xs.map(x => x.cpu));
    return `cpu ${s[s.length >> 1].toFixed(3)} ms (${s[0].toFixed(3)}..${s.at(-1).toFixed(3)})   wall min ${sorted(xs.map(x => x.wall))[0].toFixed(3)} ms`;
  };
  const cpuMs = () => {
    const u = process.cpuUsage();
    return (u.user + u.system) / 1000;
  };
  async function bench(title, variants, n, rounds = 9) {
    const means = Object.fromEntries(Object.keys(variants).map(k => [k, []]));
    for (let r = 0; r < rounds + 1; r++)
      for (const [k, f] of Object.entries(variants)) {
        const t0 = performance.now(),
          c0 = cpuMs();
        for (let i = 0; i < n; i++) await f();
        if (r) means[k].push({ wall: (performance.now() - t0) / n, cpu: (cpuMs() - c0) / n }); // round 0 warms up
      }
    console.log(title);
    for (const [k, v] of Object.entries(means)) console.log('  ' + k.padEnd(46), stat(v));
  }
  const p = tix('attention');
  const yes = () => ({ ok: true }), trivial = [{ id: 'yes', check: yes }];
  // `inlinePass` carries its own gate; for the runner's own cost, the same transformation without it
  const bare = P.transformation({ ...inlinePass, obligations: {} });
  // `await` of a synchronous call costs nothing measurable here; it keeps one loop for all variants
  await bench('Tix inline on attention, trivial gate (the runner alone)', {
    'applyNativePassSync (today)': () => P.applyNativePassSync(inlinePass, p.current, yes),
    'sync driver': () => P.applyTransformationSync(bare, p.current, { ensures: trivial }),
    'async driver': () => P.applyTransformation(bare, p.current, { ensures: trivial }),
  }, 100);
  await bench('Tix inline on attention, with the meaning gate', {
    'applyNativePassSync (today)': () => P.applyNativePassSync(inlinePass, p.current, meaningGate(p.origin, 'exact')),
    'sync driver': () => P.applyTransformationSync(inlinePass, p.current, { inputs: { origin: p.origin } }),
    'async driver': () => P.applyTransformation(inlinePass, p.current, { inputs: { origin: p.origin } }),
  }, 20);
  for (const id of ['strength', 'sha-chacha']) {
    const q = Program.fromProject(projectSource(id, projectFiles(id)));
    const run = runners(q, q.artifact());
    await bench(`Typed strength on ${id} r0, new manager each time, meaning check, preservation audited`, {
      'applyPass (today)': run.applyPass,
      'async driver (contract)': run.async,
      'sync driver (meaning check as a function)': run.sync,
    }, id === 'strength' ? 20 : 2, 5);
    // the runner alone: the facts already cached, no gate
    const warm = new C.AnalysisManager();
    await warm.analyse(strength.needs.ranges, q.artifact());
    for (const d of strength.preserves) await warm.analyse(d, q.artifact());
    await bench(`Typed strength on ${id} r0, facts cached, no gate (the runner, cache hits, three transfers)`, {
      'applyPass (today)': () => P.applyPass(strength, q.artifact(), { manager: warm }),
      'async driver': () => P.applyTransformation(strength, q.artifact(), { manager: warm }),
      'sync driver': () => P.applyTransformationSync(strength, q.artifact(), { manager: warm }),
    }, id === 'strength' ? 20 : 3, 5);
  }
}
