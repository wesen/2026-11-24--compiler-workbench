import { createIRArtifact } from '../framework/ir/index.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { checkModule } from './check.js';
import { evaluate } from './evaluate.js';
import type { Precision, TensorInput, TensorInputs } from './evaluate.js';
import { tensorAdapter } from './ir.js';
import { meaningGates } from './meaning.js';
import type { TixProgram } from './model.js';
import { parse } from './parse.js';
import { inline, splitSum } from './passes.js';

export type { TixProgram } from './model.js';

export function compileTix(source: string): TixProgram {
  const artifact = createIRArtifact(tensorAdapter, 'tix', checkModule(parse(source)));
  return Object.freeze({ origin: artifact, artifact });
}

export function runTix(
  program: TixProgram,
  fn: string,
  inputs: TensorInputs,
  options?: { precision?: Precision },
): TensorInput {
  const entry = program.artifact.value.functions.find(f => f.name === fn);
  if (!entry) throw new Error(`unknown Tix function '${fn}'`);
  return evaluate(entry, inputs, options?.precision ?? 'f32');
}

export function optimizeTix(
  program: TixProgram,
  passes: string[],
): { program: TixProgram; steps: { pass: string; accepted: boolean }[] } {
  const gates = meaningGates(program.origin);
  let artifact = program.artifact;
  const steps = [];
  for (const pass of passes) {
    const definition = pass === 'inline' ? inline : pass === 'split-sum' ? splitSum : undefined;
    if (!definition) throw new Error(`unknown Tix pass '${pass}'`);
    try {
      artifact = applyNativePassSync(
        definition,
        artifact,
        gates(pass === 'inline' ? 'exact' : 'tolerance'),
      ).artifact;
      steps.push({ pass, accepted: true });
    } catch (error) {
      if (!(error instanceof PassError && error.code === 'contractRejected')) throw error;
      steps.push({ pass, accepted: false });
    }
  }
  return { program: Object.freeze({ origin: program.origin, artifact }), steps };
}
