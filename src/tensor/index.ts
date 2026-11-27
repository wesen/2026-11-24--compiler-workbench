import type { DifferentialEvidence } from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { meaningGate } from './contract.js';
import { evaluate, type Inputs, type Precision, type BufferValue } from './evaluate.js';
import { adapter } from './ir.js';
import { selectFunction, plain, type Fn, type Module } from './model.js';
import { checkCudaLowering } from './cuda-contract.js';
import { runCudaBatch, type CudaInputs, type CudaResult } from './cuda-runtime.js';
import { emitCuda } from './cuda-source.js';
import { fusionGate, planFusion, unfusedPlan, type FusionPlan } from './fusion.js';
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
  /**
   * Shape-symbol values of the launch (IRWB-030-H). With them, the fuse gate keeps the program on stage 2's
   * lowering when block mode would leave a warp's lanes idle; `runTixCuda` supplies them from its inputs.
   */
  shapes?: Record<string, number>;
}

/** The shape values a call launches with, from its inputs, for the fuse gate. */
function launchShapes(fn: Fn, inputs: CudaInputs): Record<string, number> {
  const dims: Record<string, number> = {};
  for (const p of fn.params) {
    const input = inputs[p.name];
    if (!input || input.shape.length !== p.shape.length) continue; // encodeCudaCases rejects this input
    p.shape.forEach((d, i) => {
      const key = plain(d);
      if (key !== undefined) dims[key] = input.shape[i];
    });
  }
  return dims;
}

function lower(program: TixProgram, fn: string, options?: LoweringOptions) {
  const f = selectFunction(program.current.value, fn);
  if (options?.fuse === false) return { f, plan: unfusedPlan(f), gate: undefined };
  const plan: FusionPlan = planFusion(f);
  // IRWB-030-H: the profitability gate. Without the launch's shapes the fused plan is used, which is what the
  // contract checks; with them, a program whose block-mode rows are shorter than a warp keeps stage 2's lowering.
  const gate = options?.shapes ? fusionGate(plan, f, new Map(Object.entries(options.shapes))) : undefined;
  return { f, plan: gate && !gate.fuse ? unfusedPlan(f) : plan, gate };
}

export function cudaSource(program: TixProgram, fn: string, options?: LoweringOptions): string {
  const { f, plan } = lower(program, fn, options);
  return emitCuda(f, plan);
}

export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: CudaInputs,
  options?: LoweringOptions & { host?: string; benchmark?: boolean },
): Promise<CudaResult> {
  const f = selectFunction(program.current.value, fn);
  const { plan } = lower(program, fn, { ...options, shapes: options?.shapes ?? launchShapes(f, inputs) });
  const source = emitCuda(f, plan);
  const [result] = await runCudaBatch(source, f, [inputs], {
    host: options?.host,
    benchmark: options?.benchmark,
  });
  return result;
}

/** What `runTixCuda` would lower `fn` to for a given launch: the plan, the gate's decision and the source. */
export function loweredTix(
  program: TixProgram,
  fn: string,
  options?: LoweringOptions,
): { source: string; plan: FusionPlan; gate: ReturnType<typeof fusionGate> | undefined } {
  const { f, plan, gate } = lower(program, fn, options);
  return { source: emitCuda(f, plan), plan, gate };
}

export function checkLowering(
  program: TixProgram,
  fn: string,
  options?: LoweringOptions,
): Promise<{ accepted: boolean; relation: 'exact' | 'tolerance'; reason?: string }> {
  return checkCudaLowering(program.current, fn, undefined, { fuse: options?.fuse !== false });
}
