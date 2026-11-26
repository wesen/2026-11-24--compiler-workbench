// Run from the repository root with Node 24 and --experimental-transform-types.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.js') && context.parentURL &&
        (context.parentURL.includes('/src/') || context.parentURL.endsWith('/tools/node-vendor.mjs'))) {
      const url = new URL(specifier, context.parentURL);
      url.pathname = url.pathname.replace('/dist/typed/', '/src/typed/').replace(/\.js$/, '.ts');
      if (existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});

const root = new URL('../../../../../../', import.meta.url);
const { installVendor } = await import(new URL('tools/node-vendor.mjs', root));
await installVendor({ reference: true });
const { Program } = await import(new URL('src/typed/program.ts', root));
const { projectSource } = await import(new URL('src/typed/project.ts', root));
const { storeOf } = await import(new URL('src/typed/ir.ts', root));
const { benchCase } = await import(new URL('src/typed/evaluate.ts', root));
const B = await import(new URL('src/typed/backend/index.ts', root));

const source = `function probe(pattern: buffer, input: buffer): i32 {
  const data = new Int32Array(9);
  let n = 0;
  let top = 0;
  while (n < pattern.length) {
    const c = pattern.charCodeAt(n);
    n = n + 1;
    if (c === 45) { continue; }
    data[top] = c;
    top = top + 1;
    if (top === data.length) { break; }
  }
  for (let i = 0; i < input.length; i = i + 1) {
    if (inRange(input.charCodeAt(i), data[0], data[top - 1])) { return 1; }
  }
  return 0;
}
function inRange(code: i32, low: i32, high: i32): bool {
  return code >= low && code <= high;
}`;
const inputs = {
  probe: { pattern: { string: 'a-c' }, input: { buffer: [1, 2], cell: [97, 100] } },
  inRange: { code: [97, 100], low: 97, high: 99 },
};
const ps = projectSource('probe', {
  'main.typed': source,
  'project.json': JSON.stringify({ ingest: { tape: true }, pipeline: 'speed', inputs }),
});
const defaultProbe = Program.fromProject(ps);
assert.match(defaultProbe.error?.message ?? '', /unknown tape opcode 252/);
console.log('default array ingestion', defaultProbe.status, defaultProbe.error?.message);
const p = new Program(ps.name, ps.source, { inputs: ps.meta.inputs, ingest: { tape: true } });
if (p.status !== 'ok') throw new Error(JSON.stringify(p.error));
const hit = p.exec('probe', ['a-c', 'b'], { limit: 2e4 });
const miss = p.exec('probe', ['a-c', 'd'], { limit: 2e4 });
assert.equal(hit.result, 1);
assert.equal(miss.result, 0);
console.log('evaluator hit and miss', [hit.result, hit.steps], [miss.result, miss.steps]);

const r = globalThis.typedRv32.compile(ps.source, [], undefined);
const ref = B.imageFromCode(ps.name, r.image, r.entries);
const refCheck = p.check({
  count: 12,
  against: (fn, k) => B.runImage(ref, fn, k.args, k.memory, { limit: 2e5 }),
});
const pipeline = await p.pipeline('speed', { count: 12 });
const k = benchCase(storeOf(p.head.value), 'probe', {pattern: {string: 'a-c'}, input: {string: 'b'}});
const actual = B.runImage(B.lowerToImage(p.head).image, 'probe', k.args, k.memory, { limit: 2e5 });
assert.ok(refCheck.fns.every(row => row.agree === 12 && row.inconclusive === 0 && row.bothTrap === 0));
assert.ok(pipeline.steps.some(step => step.changed));
assert.ok(pipeline.steps.every(step => !step.rejected));
assert.equal(actual.result, 1);
console.log('reference', refCheck, 'pipeline rejections', pipeline.steps.filter(step => step.rejected),
  'workbench image', [actual.result, actual.steps]);

const invalid = new Program('escape', 'function f(): i32 { const a = new Int32Array(2); return g(a); } function g(v: i32): i32 { return v; }', { ingest: { tape: true } });
assert.match(invalid.error?.message ?? '', /an array is not a value/);
console.log('array as argument', invalid.status, invalid.error?.message);
const q = new Program('spec', 'function code(s: buffer): i32 { return s.charCodeAt(0); }');
const stringChoice = q.cases('code', {
  count: 4,
  inputs: { s: { oneOf: ['a', 'b'] } },
}).map(k => [k.args, k.items]);
assert.ok(stringChoice.every(([args, items]) => args[0] === 0 && items.length === 0));
console.log('string choice probe', stringChoice);
const { createWb } = await import(new URL('src/workbench/index.ts', root));
const wb = createWb({projects: [{
  id: 'probe',
  files: {
    'main.typed': source,
    'project.json': JSON.stringify(ps.meta),
    'scripts/try.js': "p.pipeline('speed'); return [p.exec('probe', ['a-c', 'b']).result, p.compile({rev: 'r0'}).run('probe', ['a-c', 'b']).steps];",
  },
}]});
const open = wb.projects.open('probe');
const explored = await open.run('try');
assert.equal(open.program.status, 'ok');
assert.equal(explored[0], 1);
assert.ok(explored[1] > 0);
console.log('workbench project', open.program.status, 'script', explored);

const design = readFileSync(new URL('../design-doc/01-thompson-regex-matcher-corpus-design.md', import.meta.url), 'utf8');
const fence = "```";
const metadata = JSON.parse(design.split(fence + 'json')[1].split(fence)[0]);
const shape = /^(?:[a-d](?:\*)?|\[[a-d]-[a-d]\](?:\*)?){0,4}$/;
const patterns = metadata.inputs.regexMatch.pattern.strings;
for (const pattern of patterns) {
  assert.match(pattern, shape);
  for (const range of pattern.matchAll(/\[([a-d])-([a-d])\]/g)) assert.ok(range[1] <= range[2]);
  new RegExp('^(?:' + pattern + ')$');
}
assert.ok(/^(?:[a-c]*[b-d]*a*d)$/.test('abccabbd'));
assert.ok(/^(?:[a-d]*[a-d]*[a-d]*[a-d]*)$/.test('aaaaaaaa'));
console.log('oracle accepts the benchmark and maximal-active-set fixtures');
