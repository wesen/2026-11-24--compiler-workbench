import type { DifferentialEvidence } from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { meaningGate } from './contract.js';
import { evaluate, type Inputs, type Precision, type BufferValue } from './evaluate.js';
import { adapter } from './ir.js';
import { plain, selectFunction, type Fn, type Module } from './model.js';
import { checkCudaLowering } from './cuda-contract.js';
import { runCudaBatch, type CudaInputs, type CudaResult } from './cuda-runtime.js';
import { emitCuda } from './cuda-source.js';
import { gatedPlan, planFusion, unfusedPlan } from './fusion.js';
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
  /** Fuse statements into fewer kernels (stage 3, the default); `false` is stage 2's one kernel per statement. */
  fuse?: boolean;
}
// The shape values a launch provides (IRWB-030-F): every shape symbol is bound by some parameter's plain axis,
// as the parser requires, so the plain axes of the inputs determine every extent.
function shapeValues(f: Fn, inputs: CudaInputs): Map<string, number> {
  const dims = new Map<string, number>();
  for (const p of f.params) {
    const tensor = inputs[p.name];
    if (!tensor) continue;
    p.shape.forEach((a, i) => {
      const key = plain(a);
      if (key !== undefined) dims.set(key, tensor.shape[i]);
    });
  }
  return dims;
}
function lower(program: TixProgram, fn: string, options?: LoweringOptions, dims?: Map<string, number>) {
  const f = selectFunction(program.current.value, fn);
  // `cudaSource` has no shape values and emits the fully fused plan; a caller with the launch shapes (runTixCuda)
  // also applies the cost gate, which can only remove fusions, never add one (IRWB-030-F).
  const plan =
    options?.fuse === false ? unfusedPlan(f) : dims ? gatedPlan(f, dims) : planFusion(f);
  return { f, source: emitCuda(f, plan), plan };
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
  const dims = shapeValues(selectFunction(program.current.value, fn), inputs);
  const { f, source } = lower(program, fn, options, dims);
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
