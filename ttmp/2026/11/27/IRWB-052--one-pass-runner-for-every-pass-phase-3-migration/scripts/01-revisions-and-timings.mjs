#!/usr/bin/env node
// IRWB-052 script 01: the migration's measurements (IRWB-051-C's script 04, extended to a build of the base).
//   node 01-revisions-and-timings.mjs [revisions|timings|all]      (after npm run build)
// revisions: for every Tix program, `inline` under both drivers, the applyNativePassSync wrapper and optimizeTix
//            (a plan under the synchronous driver); for every Typed corpus project, the O2 pipeline, and for r0 and
//            each input the pipeline gave `strength`, the pass with the project's optimization CONTRACT under the
//            asynchronous driver, the synchronous driver and the applyPass wrapper.
// timings:   milliseconds per application, before and after, in one process with the variants interleaved.
//            "before" is a build of the base commit (v7-p2, 26bea81), made with
//              mkdir .base-build && git archive 26bea81 src tsconfig.json | tar -x -C .base-build
//              npx tsc -p .base-build/tsconfig.json
//            Other agents load this machine, so each figure is CPU time of this process (user + system): the median
//            and min..max of the batch means, followed by the smallest wall-clock batch mean.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const mode = process.argv[2] ?? 'all';

const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
async function load(dist) {
  // the front end is installed into dist's typed domain; a second build needs it in its own module instances
  if (dist !== 'dist') {
    const { setVendor } = await imp(dist + '/typed/vendor.js');
    setVendor({
      typedTape: globalThis.typedTape,
      typedWasm: globalThis.typedWasm,
      typedRv32Interp: globalThis.typedRv32Interp,
    });
  }
  return {
    ...(await imp(dist + '/typed/project.js')),
    ...(await imp(dist + '/typed/program.js')),
    passes: await imp(dist + '/typed/passes.js'),
    C: await imp(dist + '/framework/contracts/index.js'),
    P: await imp(dist + '/framework/passes/index.js'),
    T: await imp(dist + '/tensor/index.js'),
    ...(await imp(dist + '/tensor/passes.js')),
    ...(await imp(dist + '/tensor/contract.js')),
  };
}
const now = await load('dist');
const { C, P, T, inlinePass, meaningGate, Program, projectSource } = now;
const { strength, optimizationContract } = now.passes;

const tdir = resolve(root, 'corpus/tensor');
const source = name => readFileSync(resolve(tdir, name, 'main.tix'), 'utf8');
const meaningParams = p => ({
  inputs: p.inputs,
  count: 40,
  seed: 7,
  ...(p.options.entries ? { roots: p.options.entries } : {}),
});
const key = r =>
  `${r.changed ? 'changed' : 'same'} ${r.artifact.revision} edits ${r.edits} preserved ${r.preserved.map(x => x.how[0]).join('')}`;

if (mode !== 'timings') {
  let programs = 0,
    changed = 0,
    differences = 0;
  for (const name of readdirSync(tdir)) {
    const p = T.compileTix(source(name));
    const a = P.applyNativePassSync(inlinePass, p.current, meaningGate(p.origin, 'exact'));
    const b = P.applyTransformationSync(inlinePass, p.current, { inputs: { origin: p.origin } });
    const c = await P.applyTransformation(inlinePass, p.current, { inputs: { origin: p.origin } });
    const d = T.optimizeTix(p, ['inline']).program.current.revision;
    programs++;
    if (a.changed) changed++;
    if (
      new Set([a, b, c].map(r => r.artifact.revision).concat(d)).size !== 1 ||
      a.changed !== b.changed ||
      a.changed !== c.changed
    ) {
      differences++;
      console.log('DIFFERENT tix', name);
    }
  }
  console.log(
    `tix inline: ${programs} programs, ${changed} changed, ${differences} differences between the applyNativePassSync wrapper, sync driver, async driver, optimizeTix (a plan)`,
  );

  let inputs = 0,
    applied = 0,
    diffs = 0,
    executions = 0;
  const where = [];
  for (const id of projectIds()) {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    if (p.status !== 'ok') continue;
    await p.pipeline('O2');
    const points = [[0, null]];
    p.revisions.forEach((r, i) => r.pass === 'strength' && points.push([i - 1, r.artifact.revision]));
    const contract = optimizationContract(meaningParams(p));
    for (const [i, pipelineRevision] of points) {
      const input = p.revisions[i].artifact;
      const managers = [0, 1, 2].map(() => new C.AnalysisManager());
      const options = m => ({ manager: m, inputs: { origin: p.origin }, auditPreservation: true });
      const a = await P.applyPass(strength, input, {
        manager: managers[0],
        contract,
        contractInputs: { origin: p.origin },
        auditPreservation: true,
      });
      const b = await P.applyTransformation(strength, input, { ...options(managers[1]), ensures: [contract] });
      const c = P.applyTransformationSync(strength, input, { ...options(managers[2]), ensures: [contract] });
      inputs++;
      if (a.changed) {
        applied++;
        where.push(`${id}@r${i}`);
      }
      // the contract executions each manager recorded: status, and the checks' phases and verdicts
      const recorded = m =>
        JSON.stringify(
          m.snapshot().executions.map(x => [x.status, x.checks.map(k => [k.phase, k.definition.id, k.ok])]),
        );
      executions += managers[2].snapshot().executions.length;
      if (
        key(a) !== key(b) ||
        key(a) !== key(c) ||
        recorded(managers[1]) !== recorded(managers[2]) ||
        (pipelineRevision && pipelineRevision !== c.artifact.revision)
      ) {
        diffs++;
        console.log('DIFFERENT typed', id, `r${i}`, key(a), '|', key(b), '|', key(c), '|', pipelineRevision);
      }
    }
  }
  console.log(
    `typed strength: ${inputs} inputs (r0 of each project and each input O2 gave strength), ${applied} changed, ${diffs} differences between the applyPass wrapper, async driver, sync driver (revision, edits, preservation outcomes, recorded contract executions)`,
  );
  console.log(`  contract executions recorded under the synchronous driver: ${executions}`);
  console.log('  changed at:', where.join(', '));
}

if (mode !== 'revisions') {
  if (!existsSync(resolve(root, '.base-build/dist'))) throw new Error('build the base first (see the header)');
  const base = await load('.base-build/dist');
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
    for (const [k, v] of Object.entries(means)) console.log('  ' + k.padEnd(52), stat(v));
  }
  const yes = () => ({ ok: true });
  const pb = base.T.compileTix(source('attention')),
    pn = T.compileTix(source('attention'));
  const bare = P.transformation({ ...inlinePass, obligations: {} });
  await bench(
    'Tix inline on attention, trivial gate (the runner alone)',
    {
      'before: applyNativePassSync': () => base.P.applyNativePassSync(base.inlinePass, pb.current, yes),
      'after: sync driver': () =>
        P.applyTransformationSync(bare, pn.current, { ensures: [{ id: 'yes', check: yes }] }),
      'after: async driver': () =>
        P.applyTransformation(bare, pn.current, { ensures: [{ id: 'yes', check: yes }] }),
      'after: applyNativePassSync (wrapper)': () => P.applyNativePassSync(inlinePass, pn.current, yes),
    },
    100,
  );
  await bench(
    'Tix inline on attention, with the meaning gate',
    {
      'before: applyNativePassSync': () =>
        base.P.applyNativePassSync(base.inlinePass, pb.current, base.meaningGate(pb.origin, 'exact')),
      'after: sync driver': () => P.applyTransformationSync(inlinePass, pn.current, { inputs: { origin: pn.origin } }),
      'after: async driver': () => P.applyTransformation(inlinePass, pn.current, { inputs: { origin: pn.origin } }),
      'before: optimizeTix([inline]) (a loop)': () => base.T.optimizeTix(pb, ['inline']),
      'after: optimizeTix([inline]) (a plan, sync driver)': () => T.optimizeTix(pn, ['inline']),
    },
    20,
  );
  for (const id of ['strength', 'sha-chacha']) {
    const qb = base.Program.fromProject(base.projectSource(id, projectFiles(id))),
      qn = Program.fromProject(projectSource(id, projectFiles(id)));
    const cb = base.passes.optimizationContract(meaningParams(qb)),
      cn = optimizationContract(meaningParams(qn));
    const fresh = () => ({
      manager: new C.AnalysisManager(),
      ensures: [cn],
      inputs: { origin: qn.origin },
      auditPreservation: true,
    });
    await bench(
      `Typed strength on ${id} r0, new manager each time, the optimization contract, preservation audited`,
      {
        'before: applyPass': () =>
          base.P.applyPass(base.passes.strength, qb.artifact(), {
            manager: new base.C.AnalysisManager(),
            contract: cb,
            contractInputs: { origin: qb.origin },
            auditPreservation: true,
          }),
        'after: async driver': () => P.applyTransformation(strength, qn.artifact(), fresh()),
        'after: sync driver': () => P.applyTransformationSync(strength, qn.artifact(), fresh()),
      },
      id === 'strength' ? 20 : 2,
      7,
    );
    // the runner alone: the facts already cached, no gate
    const wb = new base.C.AnalysisManager(),
      wn = new C.AnalysisManager();
    for (const [m, s, q] of [
      [wb, base.passes.strength, qb],
      [wn, strength, qn],
    ]) {
      await m.analyse(s.needs.ranges, q.artifact());
      for (const d of s.obligations?.preserves ?? s.preserves) await m.analyse(d, q.artifact());
    }
    await bench(
      `Typed strength on ${id} r0, facts cached, no gate (the runner, cache hits, three transfers)`,
      {
        'before: applyPass': () => base.P.applyPass(base.passes.strength, qb.artifact(), { manager: wb }),
        'after: async driver': () => P.applyTransformation(strength, qn.artifact(), { manager: wn }),
        'after: sync driver': () => P.applyTransformationSync(strength, qn.artifact(), { manager: wn }),
      },
      id === 'strength' ? 20 : 3,
      7,
    );
  }
}
