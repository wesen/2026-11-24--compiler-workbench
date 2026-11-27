import type { DifferentialEvidence } from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { meaningGate } from './contract.js';
import { evaluate, type Inputs, type Precision, type BufferValue } from './evaluate.js';
import { adapter } from './ir.js';
import { selectFunction, type Module } from './model.js';
import { checkCudaLowering } from './cuda-contract.js';
import { runCudaBatch, type CudaInputs, type CudaResult } from './cuda-runtime.js';
import { emitCuda } from './cuda-source.js';
import { planCudaFusion, unfusedPlan } from './fusion.js';
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
  return evaluate(selectFunction(program.current.value, fn), inputs, options?.precision ?? 'f32');
}
export function optimizeTix(program: TixProgram, passes: string[]) {
  const { origin } = program;
  let { current } = program;
  const steps = passes.map(pass => {
    const definition = pass === 'inline' ? inlinePass : pass === 'split-sum' ? splitPass : undefined;
    if (!definition) throw Error('Unknown pass ' + pass);
    try {
      const result = applyNativePassSync(
        definition,
        current,
        meaningGate(origin, pass === 'inline' ? 'exact' : 'tolerance'),
      );
      current = result.artifact;
      return { pass, accepted: true, changed: result.changed };
    } catch (error) {
      if (error instanceof PassError && error.code === 'contractRejected') {
        const evidence = error.evidence as DifferentialEvidence | undefined;
        return {
          pass,
          accepted: false,
          changed: false,
          reason: evidence?.counterexamples[0]?.reason ?? error.message,
        };
      }
      throw error;
    }
  });
  return { program: { origin, current }, steps };
}

export interface LoweringOptions {
  /** Select profitable CUDA fusion by default. `false` emits stage 2's one kernel per statement. */
  fuse?: boolean;
}
function lower(program: TixProgram, fn: string, options?: LoweringOptions) {
  const f = selectFunction(program.current.value, fn);
  return { f, source: emitCuda(f, options?.fuse === false ? unfusedPlan(f) : planCudaFusion(f)) };
}

export function cudaSource(program: TixProgram, fn: string, options?: LoweringOptions): string {
  return lower(program, fn, options).source;
}

export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: CudaInputs,
  options?: LoweringOptions & { host?: string; benchmark?: boolean },
): Promise<CudaResult> {
  const { f, source } = lower(program, fn, options);
  const [result] = await runCudaBatch(source, f, [inputs], {
    host: options?.host,
    benchmark: options?.benchmark,
  });
  return result;
}

export function checkLowering(
  program: TixProgram,
  fn: string,
  options?: LoweringOptions,
): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }> {
  return checkCudaLowering(program.current, fn, undefined, { fuse: options?.fuse !== false });
}
