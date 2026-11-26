import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { lowerSource } from './check.js';
import { evaluate, type Inputs, type Precision, type Tensor } from './evaluate.js';
import { indexedAdapter } from './ir.js';
import { checkMeaning, type MeaningRelation } from './meaning.js';
import type { TensorIR } from './model.js';
import { inlinePass, splitSumPass } from './passes.js';

export interface TixProgram {
  readonly artifact: Artifact<TensorIR>;
  readonly origin: Artifact<TensorIR>;
}

export function compileTix(source: string): TixProgram {
  const artifact = createIRArtifact(indexedAdapter, 'tix', lowerSource(source));
  return Object.freeze({ artifact, origin: artifact });
}

export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Inputs,
  options?: { precision?: Precision },
): Tensor {
  const entry = program.artifact.value.functions.find(f => f.name === fn);
  if (!entry) throw new Error(`unknown Tix function '${fn}'`);
  return evaluate(entry, inputs, options?.precision ?? 'f32');
}

const registry = new Map([
  ['inline', { pass: inlinePass, relation: 'exact' as MeaningRelation }],
  ['split-sum', { pass: splitSumPass, relation: 'tolerant' as MeaningRelation }],
]);

export function optimizeTix(
  program: TixProgram,
  passes: string[],
): { program: TixProgram; steps: { pass: string; accepted: boolean }[] } {
  const { origin } = program;
  let { artifact } = program;
  const steps = passes.map(name => {
    const spec = registry.get(name);
    if (!spec) throw new Error(`unknown Tix pass '${name}'`);
    try {
      artifact = applyNativePassSync(spec.pass, artifact, {
        gate: (before, after) => checkMeaning(spec.relation, origin, before, after),
      }).artifact;
      return { pass: name, accepted: true };
    } catch (e) {
      if (!(e instanceof PassError) || e.code !== 'contractRejected') throw e;
      return { pass: name, accepted: false };
    }
  });
  return { program: artifact === program.artifact ? program : Object.freeze({ artifact, origin }), steps };
}
