import { canonical } from '../framework/core/index.js';
import type { Artifact } from '../framework/core/index.js';
import {
  differential,
  differentialSpec,
  runDifferential,
  seededRandom,
  type CheckResult,
} from '../framework/contracts/index.js';
import {
  concreteShape,
  evaluate,
  EvaluationLimit,
  instantiate,
  ShapeError,
  tensorSize,
  type TensorInputs,
  type TensorResult,
} from './evaluate.js';
import { TensorProgramIR } from './ir.js';
import type { TensorIR, TixFunction } from './model.js';

export type Relation = 'exact' | 'tolerance';

const sizes = [0, 1, 2, 3, 4, 5, 7, 9];
const seed = 7;
const elementLimit = 4096;
const originLimits = { work: 100_000, elements: elementLimit };
const revisionLimits = { work: 200_000, elements: elementLimit };
const witness = [1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24, 2 ** -24, 0.25];

type Pattern = 'rounding witness' | 'zeros' | 'ones' | 'signed' | 'positive';
interface TensorCase {
  readonly fn: string;
  readonly inputs: TensorInputs;
  readonly pattern: Pattern;
  readonly origin: TensorResult;
}
type Case = TensorCase | { readonly fn: string; readonly missing: true };
type Observation = TensorResult | string;
type ProgramArtifact = Artifact<TensorIR>;

function caseInputs(
  fn: TixFunction,
  shapes: number[][],
  pattern: Pattern,
  random: () => number,
): TensorInputs {
  return Object.fromEntries(
    fn.params.map((param, inputIndex) => {
      const shape = shapes[inputIndex]!;
      const data = new Float32Array(tensorSize(shape));
      for (let i = 0; i < data.length; i++) {
        switch (pattern) {
          case 'rounding witness':
            data[i] = shape.length === 2 && shape[0] === 1 && shape[1] === 9 ? witness[i]! : 1;
            break;
          case 'zeros':
            data[i] = (i + inputIndex) % 2 ? -0 : 0;
            break;
          case 'ones':
            data[i] = 1;
            break;
          case 'signed':
            data[i] = (((i * 7 + inputIndex * 3) % 17) - 8) / 8;
            break;
          case 'positive':
            data[i] = 0.125 + random() * 0.875;
            break;
        }
      }
      return [param.name, { shape, data }];
    }),
  );
}

function sampleShapes(fn: TixFunction, random: () => number): number[][][] {
  const assignments = [
    ...sizes.map(size => fn.anchors.map(() => size)),
    ...sizes.map(() => fn.anchors.map(() => sizes[Math.floor(random() * sizes.length)]!)),
  ];
  const seen = new Set<string>();
  const shapes: number[][][] = [];
  for (const assignment of assignments) {
    const names = new Map(fn.anchors.map(({ name }, index) => [name, assignment[index]!]));
    try {
      const inputs = fn.params.map(param => concreteShape(param.shape, names, param.at));
      const { statementShapes } = instantiate(fn, inputs);
      if ([...inputs, ...statementShapes].some(shape => tensorSize(shape) > elementLimit)) continue;
      const key = canonical(inputs);
      if (seen.has(key)) continue;
      seen.add(key);
      shapes.push(inputs);
    } catch (error) {
      if (!(error instanceof ShapeError)) throw error;
    }
  }
  return shapes;
}

function baselineCases(fn: TixFunction, relation: Relation, random: () => number): Case[] {
  const cases: Case[] = [];
  for (const shapes of sampleShapes(fn, random)) {
    const patterns: Pattern[] = ['zeros', 'ones', 'signed', 'positive'];
    if (shapes.some(shape => shape.length === 2 && shape[0] === 1 && shape[1] === 9))
      patterns.unshift('rounding witness');
    for (const pattern of patterns) {
      const inputs = caseInputs(fn, shapes, pattern, random);
      let origin: TensorResult;
      try {
        origin = evaluate(fn, inputs, relation === 'exact' ? 'f32' : 'f64', originLimits);
      } catch (error) {
        if (error instanceof EvaluationLimit) continue;
        throw error;
      }
      if (relation === 'tolerance' && !origin.data.every(Number.isFinite)) continue;
      cases.push({ fn: fn.name, inputs, pattern, origin });
    }
  }
  return cases.length ? cases : [{ fn: fn.name, missing: true }];
}

function words(data: TensorResult['data']): Uint32Array {
  return new Uint32Array(data.buffer, data.byteOffset, data.length);
}

function compare(relation: Relation, before: Observation, after: Observation) {
  if (typeof before === 'string') return { ok: false, reason: before };
  if (typeof after === 'string') return { ok: false, reason: after };
  if (
    before.shape.length !== after.shape.length ||
    before.shape.some((extent, axis) => extent !== after.shape[axis])
  )
    return { ok: false, reason: 'returned tensor shapes differ' };
  if (relation === 'exact') {
    const baseline = words(before.data);
    const candidate = words(after.data);
    const mismatch = baseline.findIndex((word, index) => word !== candidate[index]);
    if (mismatch >= 0)
      return {
        ok: false,
        reason: `element ${mismatch}: expected f32 word 0x${baseline[mismatch]!.toString(16)}, got 0x${candidate[mismatch]!.toString(16)}`,
      };
  } else {
    const mismatch = before.data.findIndex((ref, index) => {
      const candidate = after.data[index]!;
      return !Number.isFinite(candidate) || Math.abs(candidate - ref) > 2e-6 + 2e-5 * Math.abs(ref);
    });
    if (mismatch >= 0)
      return {
        ok: false,
        reason: `element ${mismatch}: f32 value ${after.data[mismatch]} exceeds tolerance from f64 value ${before.data[mismatch]}`,
      };
  }
  return { ok: true };
}

function signature(value: TensorIR): string {
  return canonical(
    value.functions.map(fn => ({
      name: fn.name,
      params: fn.params.map(({ name, shape }) => ({ name, shape })),
      result: fn.result,
    })),
  );
}

const ports = { origin: TensorProgramIR, input: TensorProgramIR, candidate: TensorProgramIR };
function invariant(relation: Relation) {
  return differential<typeof ports, Case, Observation>({
    id: `tensor.meaning-${relation}`,
    version: '1',
    description: `Compare returned tensor shapes and values under the ${relation} relation`,
    inputs: ports,
    baseline: relation === 'exact' ? 'input' : 'origin',
    subject: 'candidate',
    count: sizes.length * 2,
    seed,
    cases({ origin, input, candidate }) {
      return origin.value.functions.flatMap((fn, index) => {
        if (
          relation === 'tolerance' &&
          canonical(input.value.functions[index]) === canonical(candidate.value.functions[index])
        )
          return [];
        return baselineCases(fn, relation, seededRandom(seed));
      });
    },
    run(side, artifact, kase, { origin }) {
      if ('missing' in kase) return `no comparable cases for "${kase.fn}"`;
      if (side === 'baseline' && artifact.revision === origin.revision) return kase.origin;
      const fn = artifact.value.functions.find(fn => fn.name === kase.fn)!;
      try {
        return evaluate(fn, kase.inputs, 'f32', revisionLimits);
      } catch (error) {
        if (error instanceof EvaluationLimit || error instanceof ShapeError) return error.message;
        throw error;
      }
    },
    compare: (before, after) => compare(relation, before, after),
    describeCase(kase) {
      if ('missing' in kase) return { fn: kase.fn };
      return {
        fn: kase.fn,
        pattern: kase.pattern,
        shapes: Object.fromEntries(Object.entries(kase.inputs).map(([name, tensor]) => [name, tensor.shape])),
      };
    },
  });
}

const exact = invariant('exact');
const tolerance = invariant('tolerance');

export function meaningCheck(origin: ProgramArtifact, relation: Relation) {
  const spec = differentialSpec(relation === 'exact' ? exact : tolerance);
  return (input: ProgramArtifact, candidate: ProgramArtifact): CheckResult => {
    if (signature(origin.value) !== signature(candidate.value))
      return { ok: false, reason: 'function signatures changed' };
    const evidence = runDifferential(spec, { origin, input, candidate });
    const first = evidence.counterexamples[0];
    return {
      ok: evidence.status === 'agree',
      reason: first?.reason ?? `${evidence.agree}/${evidence.total} cases agree under ${relation}`,
      evidence,
    };
  };
}
