import type { Artifact } from '../framework/core/index.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { checkSource } from './check.js';
import { evaluate } from './evaluate.js';
import { tensorArtifact } from './ir.js';
import { meaningCheck } from './meaning.js';
import type { TensorIR } from './model.js';
import { parse } from './parse.js';
import { inlinePass, splitSumPass } from './passes.js';

export interface TixProgram {
  readonly artifact: Artifact<TensorIR>;
  readonly origin: Artifact<TensorIR>;
}

export function compileTix(source: string): TixProgram {
  const artifact = tensorArtifact(checkSource(parse(source)));
  return Object.freeze({ artifact, origin: artifact });
}

export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Record<string, { shape: number[]; data: Float32Array | Float64Array }>,
  options?: { precision?: 'f32' | 'f64' },
): { shape: number[]; data: Float32Array | Float64Array } {
  const entry = program.artifact.value.functions.find(entry => entry.name === fn);
  if (!entry) throw new Error(`Unknown Tix function "${fn}"`);
  return evaluate(entry, inputs, options?.precision ?? 'f32');
}

export function optimizeTix(
  program: TixProgram,
  passes: string[],
): { program: TixProgram; steps: { pass: string; accepted: boolean }[] } {
  let artifact = program.artifact;
  const steps = passes.map(pass => {
    const kernel = pass === 'inline' ? inlinePass : pass === 'split-sum' ? splitSumPass : undefined;
    if (!kernel) throw new Error(`Unknown Tix pass "${pass}"`);
    const check = meaningCheck(program.origin, pass === 'inline' ? 'exact' : 'tolerance');
    try {
      artifact = applyNativePassSync(kernel, artifact, { check }).artifact;
      return { pass, accepted: true };
    } catch (error) {
      if (!(error instanceof PassError) || error.code !== 'contractRejected') throw error;
      return { pass, accepted: false };
    }
  });
  return { program: Object.freeze({ artifact, origin: program.origin }), steps };
}
