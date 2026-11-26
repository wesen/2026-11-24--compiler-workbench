import {
  AnalysisManager,
  defineInvariant,
  defineTransformation,
  defineType,
  runDifferentialAsync,
  seededRandom,
  type Decided,
} from '../framework/contracts/index.js';
import { sha256Parts } from '../framework/core/sha256.js';
import { engine, runCudaBatch, type CudaInputs } from './cuda-remote.js';
import { emitCuda } from './cuda-source.js';
import { evaluate, OutsideSample, size, type BufferValue } from './evaluate.js';
import { TixIR } from './ir.js';
import { plain, value, type Fn, type Module } from './model.js';

const seed = 20;
const half = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24];
interface Case {
  descriptor: { fn: string; shapes: Record<string, number>; stream: string; seed: number };
  inputs: CudaInputs;
  f32: BufferValue;
  f64: BufferValue;
}

function samples(fn: Fn): Case[] {
  const symbols = [
    ...new Set(fn.params.flatMap(p => p.shape.map(plain).filter(n => n !== undefined))),
  ].sort();
  const sets = [1, 3, 4, 7, 0].map(n => symbols.map(() => n));
  sets.push(symbols.map((_, i) => [3, 5, 7][i % 3]));
  symbols.forEach((_, at) => sets.push(symbols.map((_, i) => (i === at ? 0 : 3))));
  const seen = new Set<string>();
  const cases: Case[] = [];
  const random = seededRandom(seed);
  for (const dims of sets) {
    const entries = symbols.map((s, i) => [s, dims[i]] as const);
    const env = new Map(entries);
    const shapes = fn.params.map(p => p.shape.map(a => value(a, env)));
    const key = JSON.stringify(shapes);
    if (seen.has(key)) continue;
    seen.add(key);
    if (shapes.some(s => s.some(d => !Number.isSafeInteger(d) || d < 0) || size(s) > 4096)) continue;
    for (const stream of ['signed', 'positive', 'half-ulp', 'zero']) {
      const inputs = Object.fromEntries(
        fn.params.map((p, i) => [
          p.name,
          {
            shape: shapes[i],
            data: Float32Array.from({ length: size(shapes[i]) }, (_, j) => {
              switch (stream) {
                case 'signed':
                  return 2 * random() - 1;
                case 'positive':
                  return 0.25 + 0.75 * random();
                case 'zero':
                  return j % 2 ? -0 : 0;
                default:
                  return half[j % half.length];
              }
            }),
          },
        ]),
      );
      try {
        const f32 = evaluate(fn, inputs, 'f32', true);
        const f64 = evaluate(fn, inputs, 'f64', true);
        cases.push({
          descriptor: { fn: fn.name, shapes: Object.fromEntries(entries), stream, seed },
          inputs,
          f32,
          f64,
        });
      } catch (error) {
        if (!(error instanceof OutsideSample)) throw error;
      }
    }
  }
  return cases;
}

function checkCase(c: Case, got: Float32Array) {
  let maxBudgetFraction = 0;
  for (let i = 0; i < got.length; ++i) {
    const f32 = c.f32.data[i],
      f64 = c.f64.data[i],
      actual = got[i];
    const budget = 2e-6 + 2e-5 * Math.abs(f64);
    const exact = !Number.isFinite(f32) || !Number.isFinite(f64) || (f32 === 0 && actual === 0);
    const ratio = Math.abs(f64 - actual) / budget;
    if (exact ? !Object.is(f32, actual) : !Number.isFinite(actual) || ratio > 1) {
      let offset = i;
      const coord = c.f32.shape.map(() => 0);
      for (let axis = coord.length - 1; axis >= 0; --axis) {
        coord[axis] = offset % c.f32.shape[axis];
        offset = Math.floor(offset / c.f32.shape[axis]);
      }
      const show = (n: number) => (Object.is(n, -0) ? '-0' : String(n));
      const expected = exact ? `f32 ${show(f32)}` : `f64 ${show(f64)} ± ${budget}`;
      const verdict: Decided = {
        v: 'disagree',
        reason: `at [${coord}]: expected ${expected}, got ${show(actual)}`,
      };
      return { verdict, maxBudgetFraction };
    }
    if (!exact) maxBudgetFraction = Math.max(maxBudgetFraction, ratio);
  }
  const verdict: Decided = { v: 'agree' };
  return { verdict, maxBudgetFraction };
}

export function selectFunction(module: Module, name: string): Fn {
  const f = module.functions.find(f => f.name === name);
  if (!f) throw Error('Unknown function ' + name);
  return f;
}
const text = defineType<string>({
  id: 'tensor.nonempty-text',
  version: '1',
  description: 'Nonempty text',
  validate(v) {
    if (typeof v !== 'string' || !v.length) throw Error('Expected nonempty text');
  },
});
const ports = { input: TixIR, fn: text, output: text };
const invariant = defineInvariant({
  id: 'tensor.cuda-meaning',
  version: '1',
  description: 'CUDA execution against immediate Tix meaning',
  inputs: ports,
  async check(ctx, inputs) {
    const profile = engine();
    const fn = selectFunction(inputs.input.value, inputs.fn);
    // The count configures the generator, which may return fewer cases after domain/work filtering.
    const evidence = await runDifferentialAsync<typeof ports, Case, never>(
      {
        id: 'tensor.cuda-meaning',
        version: '1',
        description: 'GPU batch against f64 and f32 references',
        inputs: ports,
        baseline: 'input',
        subject: 'output',
        count: 1,
        seed,
        cases: () => samples(fn),
        baselineKey: ({ input, fn }) =>
          JSON.stringify([input.revision, fn, process.versions.node, process.versions.v8]),
        subjectKey: source => sha256Parts([profile.key, source as string]),
        run() {
          throw Error('CUDA differential requires batch delegation');
        },
        compare() {
          throw Error('CUDA batch delegate compares results');
        },
        async decide({ output }, cases, todo) {
          const { report, cases: actual } = await runCudaBatch(
            fn,
            output,
            todo.map(i => cases[i].inputs),
            profile,
          );
          const checked = todo.map((i, j) => checkCase(cases[i], actual[j].data));
          ctx.record('CUDA batch', {
            host: report.host,
            build: report.hash,
            compiled: report.compiled,
            engine: report.stdout.trim(),
            count: todo.length,
            maxBudgetFraction: Math.max(...checked.map(c => c.maxBudgetFraction)),
          });
          return checked.map(x => x.verdict);
        },
        describeCase: c => c.descriptor,
      },
      inputs,
    );
    const first = evidence.counterexamples[0];
    return {
      ok: evidence.total > 0 && evidence.agree === evidence.total,
      reason: first
        ? `${first.reason}; case ${JSON.stringify(first.case)}`
        : evidence.total === 0
          ? `No comparable case for ${fn.name}`
          : `${evidence.agree}/${evidence.total} cases agree`,
      evidence,
    };
  },
});
export const lowerCuda = defineTransformation({
  id: 'tensor.lower-cuda',
  version: '1',
  description: 'Emit and check a Tix function as CUDA source',
  inputs: { input: TixIR, fn: text },
  outputs: { output: text },
  cache: 'never',
  ensures: [
    {
      invariant,
      bindings: {
        input: { from: 'inputs', port: 'input' },
        fn: { from: 'inputs', port: 'fn' },
        output: { from: 'outputs', port: 'output' },
      },
    },
  ],
  run: (_ctx, { input, fn }) => ({ outputs: { output: emitCuda(selectFunction(input.value, fn)) } }),
});
export async function verifyCuda(input: import('../framework/core/types.js').Artifact<Module>, fn: string) {
  const manager = new AnalysisManager();
  const relation = 'tolerance' as const;
  try {
    await manager.execute(lowerCuda, { input, fn });
    return { accepted: true, relation };
  } catch (error) {
    return { accepted: false, relation, reason: error instanceof Error ? error.message : String(error) };
  }
}
