import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../../../..', import.meta.url));
const load = path => import(pathToFileURL(resolve(root, path)).href);
const { installVendor } = await load('tools/node-vendor.mjs');
const { projectFiles } = await load('tools/corpus.mjs');
const { candelaInputs, candelaSource, MAX_SOURCE } = await load('tools/candela.mjs');
const { Compiler } = await load('dist/labs/runtime.js');
const { task } = await load('dist/framework/core/types.js');
const { AnalysisManager, createArtifact } = await load('dist/framework/contracts/index.js');
const { Program } = await load('dist/typed/program.js');
const { projectSource } = await load('dist/typed/project.js');
const { ingest } = await load('dist/typed/lift.js');
const { BlocksIR, storeOf } = await load('dist/typed/ir.js');
const { ANALYSES, cfgOf, dominatorsOf, loopsOf } = await load('dist/typed/analyses.js');
const { assembleParts, closureKey, closureOf, hasFrameArrays, partsOf, partHash } =
  await load('dist/typed/parts.js');
const { meaningKept } = await load('dist/typed/evaluate.js');
await installVendor();

const analyses = {
  cfg: (_st, fn) => cfgOf(fn),
  dominators: (_st, fn) => dominatorsOf(fn),
  loops: loopsOf,
};
const names = Object.keys(analyses);
const tallies = ['total', 'agree', 'disagree', 'inconclusive'];
const summarize = ({ ok, evidence }) => ({
  ok,
  ...Object.fromEntries(tallies.map(key => [key, evidence[key]])),
});

function swappable(value) {
  return Object.values(value.values).filter(
    x =>
      x.op === 'add' &&
      !x.type &&
      x.args.length === 2 &&
      x.args.every(id => ['get', 'const'].includes(value.values[id].op)) &&
      new Set(
        x.args.map(id => {
          const v = value.values[id];
          return JSON.stringify([v.op, v.imm]);
        }),
      ).size === 2,
  );
}

function editStream(origin, count, fn) {
  const edits = swappable(origin.value).filter(x => !fn || x.fn === fn);
  assert(edits.length >= count, `${origin.id}: only ${edits.length} editable sites`);
  let before = origin;
  const candidates = [];
  for (const x of edits.slice(0, count)) {
    const old = before.value;
    const candidate = createArtifact(BlocksIR, origin.id, {
      ...old,
      rev: old.rev + 1,
      values: { ...old.values, [x.id]: { ...x, args: x.args.toReversed() } },
    });
    // Check function isolation without prewarming the measured part and closure caches.
    assert.deepEqual(
      Object.keys(old.values).filter(id => old.values[id] !== candidate.value.values[id]),
      [x.id],
    );
    candidates.push({ candidate, fn: x.fn });
    before = candidate;
  }
  return candidates;
}

function wholeProgram(origin, options) {
  const manager = new AnalysisManager();
  const check = meaningKept(options);
  return async candidate => {
    const facts = names.map(name => manager.analyseSync(ANALYSES[name], candidate).value);
    const verdict = summarize(await manager.checkInvariant(check, { origin, candidate }));
    return { facts, verdict };
  };
}

function perFunction(origin, options) {
  const compiler = new Compiler();
  const manager = new AnalysisManager();
  const functions = origin.value.fnOrder;
  const checks = new Map(functions.map(fn => [fn, meaningKept({ ...options, roots: [fn] })]));
  let candidate, parts, executed;
  compiler.registerKind({
    id: 'e1.result',
    version: '1',
    description: 'Typed analysis facts or sampled verdict totals',
    validate: () => {},
  });
  const stores = new Map();
  compiler.register({
    id: 'e1.analysis',
    description: 'Compute one analysis of a function part',
    version: '1',
    kind: 'e1.result',
    run(ctx, { name, fn }) {
      executed.analysis++;
      const hash = ctx.read(`part/${fn}`);
      let st = stores.get(hash);
      if (!st) {
        const p = parts.get(fn);
        st = storeOf(
          assembleParts({ program: origin.value.program, rev: 0, fnOrder: [fn], hashes: [hash] }, () => [
            p.fn,
            p.blocks,
            p.stmts,
            p.values,
            p.ops,
          ]),
        );
        stores.set(hash, st);
      }
      return analyses[name](st, st.fns.get(fn));
    },
  });
  compiler.register({
    id: 'e1.meaning',
    description: 'Check the sampled meaning of one call closure',
    version: '1',
    kind: 'e1.result',
    async run(ctx, { fn }) {
      executed.meaning++;
      ctx.read(`closure/${fn}`);
      return summarize(await manager.checkInvariant(checks.get(fn), { origin, candidate }));
    },
  });
  const factTasks = names.map(name =>
    functions.map(fn => task(`analysis/${name}/${fn}`, 'e1.analysis', { name, fn })),
  );
  const checkTasks = functions.map(fn => task(`meaning/${fn}`, 'e1.meaning', { fn }));
  return async artifact => {
    candidate = artifact;
    executed = { analysis: 0, meaning: 0 };
    parts = partsOf(candidate.value);
    for (const fn of functions) {
      compiler.setInput(`part/${fn}`, partHash(parts.get(fn)));
      compiler.setInput(`closure/${fn}`, closureKey(candidate.value, fn));
    }
    const {
      value: { facts, verdicts },
    } = await compiler.run('E1 edit', async run => {
      const values = tasks => Promise.all(tasks.map(async t => (await run.require(t)).value));
      const rows = await Promise.all(factTasks.map(values));
      return {
        facts: rows.map(row => Object.fromEntries(functions.map((fn, i) => [fn, row[i]]))),
        verdicts: await values(checkTasks),
      };
    });
    const totals = Object.fromEntries(
      tallies.map(key => [key, verdicts.reduce((n, row) => n + row[key], 0)]),
    );
    return {
      facts,
      verdict: { ok: totals.disagree === 0 && totals.agree > 0, ...totals },
      executed,
    };
  };
}

async function measure(check, candidate) {
  const start = performance.now();
  const result = await check(candidate);
  return { result, ms: performance.now() - start };
}

function controlledChess(origin) {
  const value = origin.value;
  const closures = new Map(value.fnOrder.map(fn => [fn, closureOf(value, fn)]));
  const sites = swappable(value);
  const byClosureSize = [...value.fnOrder].sort((a, b) => closures.get(a).length - closures.get(b).length);
  const fn = byClosureSize
    .filter(name => sites.filter(x => x.fn === value.fns[name].id).length >= 2)
    .filter(name => [...closures].every(([root, deps]) => root === name || !deps.includes(name)))[0];
  assert(fn, 'chess needs two swappable adds in a function without callers');

  const selected = new Set(closures.get(fn));
  if (hasFrameArrays(value)) {
    const frameFn = byClosureSize.find(name => value.fns[name].arrayBytes);
    for (const name of closures.get(frameFn)) selected.add(name);
  }
  function subset() {
    const fnOrder = value.fnOrder.filter(name => selected.has(name));
    const filter = table =>
      Object.fromEntries(Object.entries(table).filter(([, row]) => selected.has(row.fn.slice(3))));
    const native = {
      ...value,
      fnOrder,
      fns: Object.fromEntries(fnOrder.map(name => [name, value.fns[name]])),
      blocks: filter(value.blocks),
      stmts: filter(value.stmts),
      values: filter(value.values),
      ops: filter(value.ops),
    };
    assert.equal(hasFrameArrays(native), hasFrameArrays(value));
    return createArtifact(BlocksIR, origin.id, native);
  }
  const small = subset();
  const midpoint = (small.value.fnOrder.length + value.fnOrder.length) / 2;
  for (const name of byClosureSize) {
    if (selected.size >= midpoint) break;
    for (const dep of closures.get(name)) selected.add(dep);
  }
  const middle = subset();
  assert(
    middle.value.fnOrder.length > small.value.fnOrder.length &&
      middle.value.fnOrder.length < value.fnOrder.length,
    `expected three distinct chess sizes, got ${small.value.fnOrder.length}/${middle.value.fnOrder.length}/${value.fnOrder.length}`,
  );
  return [small, middle, origin].map(artifact => ({ artifact, fn: value.fns[fn].id }));
}

const projects = process.argv.slice(2);
for (const project of projects.length ? projects : ['call-chain', 'bytecode-vm', 'chess-search', 'candela']) {
  const start = performance.now();
  const controlled = project === 'chess-controlled';
  const id = controlled ? 'chess-search' : project;
  let origin, inputs;
  if (id === 'candela') {
    const st = ingest(id, candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
    origin = createArtifact(BlocksIR, id, st.toNative());
    inputs = candelaInputs(st);
  } else {
    const program = Program.fromProject(projectSource(id, projectFiles(id)));
    origin = program.artifact();
    inputs = program.inputs;
  }
  const variants = controlled ? controlledChess(origin) : [{ artifact: origin }];
  const setupMs = +(performance.now() - start).toFixed(2);
  for (const { artifact, fn } of variants) {
    await benchmark(project, artifact, inputs, setupMs, fn);
  }
}

async function benchmark(id, origin, inputs, setupMs, fixedFn) {
  const { fnOrder, stmts, values } = origin.value;
  console.log(
    JSON.stringify({
      id,
      functions: fnOrder.length,
      statements: Object.keys(stmts).length,
      values: Object.keys(values).length,
      setupMs,
    }),
  );
  for (const seed of [7, 1103, 1907]) {
    // Separate lineages preserve object sharing within each arm, and avoid sharing cache state between arms or seeds.
    const independent = () => createArtifact(BlocksIR, origin.id, JSON.parse(JSON.stringify(origin.value)));
    const currentOrigin = independent();
    const runtimeOrigin = independent();
    const current = wholeProgram(currentOrigin, { inputs, seed });
    const runtime = perFunction(runtimeOrigin, { inputs, seed });
    const stream = editStream(currentOrigin, 2, fixedFn);
    const runtimeStream = editStream(runtimeOrigin, 2, fixedFn);
    const cold = await current(currentOrigin);
    assert.deepEqual((await runtime(runtimeOrigin)).verdict, cold.verdict);
    for (const [index, { candidate, fn }] of stream.entries()) {
      const copy = runtimeStream[index].candidate;
      const runtimeFirst = (index + [7, 1103, 1907].indexOf(seed)) % 2 === 0;
      let a, b;
      if (runtimeFirst) {
        b = await measure(runtime, copy);
        a = await measure(current, candidate);
      } else {
        a = await measure(current, candidate);
        b = await measure(runtime, copy);
      }
      assert.deepEqual(b.result.facts, a.result.facts);
      assert.deepEqual(b.result.verdict, a.result.verdict);
      assert(a.result.verdict.ok);
      assert.equal(b.result.executed.analysis, names.length);
      if (fixedFn) assert.equal(b.result.executed.meaning, 1);
      console.log(
        JSON.stringify({
          seed,
          edit: index + 1,
          fn,
          runtimeFirst,
          todayMs: +a.ms.toFixed(2),
          runtimeMs: +b.ms.toFixed(2),
          executed: b.result.executed,
          cases: a.result.verdict.total,
          inconclusive: a.result.verdict.inconclusive,
        }),
      );
    }
  }
}
