import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { meaningGate } from './contract.js';
import { emitCuda } from './cuda-emit.js';
import { createCudaLowering, selectFn } from './cuda-pass.js';
import { cudaTarget, runCudaBatch, type CudaInputs, type CudaResult } from './cuda-run.js';
import { evaluate, type Inputs, type Precision, type BufferValue } from './evaluate.js';
import { adapter } from './ir.js';
import type { Module } from './model.js';
import { parse } from './parser.js';
import { inlinePass, splitPass } from './passes.js';

export interface TixProgram {
  readonly origin: Artifact<Module>;
  readonly current: Artifact<Module>;
}
export function compileTix(source: string): TixProgram {
  const origin = createIRArtifact(adapter, 'tix', parse(source));
  return { origin, current: origin };
}
export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Inputs,
  options?: { precision?: Precision },
): BufferValue {
  const f = program.current.value.functions.find(f => f.name === fn);
  if (!f) throw Error('Unknown function ' + fn);
  return evaluate(f, inputs, options?.precision ?? 'f32');
}
export function optimizeTix(program: TixProgram, passes: string[]) {
  const { origin } = program;
  let { current } = program;
  const steps = passes.map(pass => {
    const definition = pass === 'inline' ? inlinePass : pass === 'split-sum' ? splitPass : undefined;
    if (!definition) throw Error('Unknown pass ' + pass);
    try {
      current = applyNativePassSync(
        definition,
        current,
        meaningGate(origin, pass === 'inline' ? 'exact' : 'tolerance'),
      ).artifact;
      return { pass, accepted: true };
    } catch (error) {
      if (error instanceof PassError && error.code === 'contractRejected') return { pass, accepted: false };
      throw error;
    }
  });
  return { program: { origin, current }, steps };
}

export function cudaSource(program: TixProgram, fn: string): string {
  return emitCuda(selectFn(program.current.value, fn));
}

export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: CudaInputs,
  options?: { host?: string },
): Promise<CudaResult> {
  const selected = selectFn(program.current.value, fn);
  const { results } = await runCudaBatch(emitCuda(selected), selected, [inputs], cudaTarget(options?.host));
  return results[0];
}

const lowerCuda = createCudaLowering();
export async function checkLowering(
  program: TixProgram,
  fn: string,
): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }> {
  const { accepted, relation, reason } = await lowerCuda(program, fn, cudaTarget());
  return reason === undefined ? { accepted, relation } : { accepted, relation, reason };
}
