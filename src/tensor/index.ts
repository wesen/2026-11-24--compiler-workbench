import { createIRArtifact } from '../framework/ir/index.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { checkSource } from './check.js';
import { evaluate } from './evaluate.js';
import type { Inputs, Precision, Tensor } from './evaluate.js';
import { tensorAdapter } from './ir.js';
import { generateCases, meaningCheck } from './meaning.js';
import type { TensorArtifact } from './model.js';
import { parseTix } from './parse.js';
import { tensorPasses } from './passes.js';

export interface TixProgram {
  readonly origin: TensorArtifact;
  readonly artifact: TensorArtifact;
}

export function compileTix(source: string): TixProgram {
  const artifact = createIRArtifact(tensorAdapter, 'tix', checkSource(parseTix(source)));
  return Object.freeze({ origin: artifact, artifact });
}

export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Inputs,
  options?: { precision?: Precision },
): Tensor {
  const entry = program.artifact.value.functions.find(candidate => candidate.name === fn);
  if (!entry) throw new Error(`Unknown Tix function '${fn}'`);
  return evaluate(entry, inputs, options?.precision ?? 'f32');
}

export function optimizeTix(
  program: TixProgram,
  passes: string[],
): { program: TixProgram; steps: { pass: string; accepted: boolean }[] } {
  const { origin } = program;
  let { artifact } = program;
  const cases = generateCases(origin);
  const steps = passes.map(name => {
    const pass = tensorPasses.get(name);
    if (!pass) throw new Error(`Unknown Tix pass '${name}'`);
    try {
      artifact = applyNativePassSync(pass, artifact, {
        check: meaningCheck(origin, cases, name === 'inline' ? 'exact' : 'tolerance'),
      }).artifact;
      return { pass: name, accepted: true };
    } catch (error) {
      if (!(error instanceof PassError) || error.code !== 'contractRejected') throw error;
      return { pass: name, accepted: false };
    }
  });
  return { program: artifact === program.artifact ? program : Object.freeze({ origin, artifact }), steps };
}
