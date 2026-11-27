import {
  AnalysisManager,
  defineInvariant,
  defineTransformation,
  type DifferentialEvidence,
} from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { applyNativePassSync, passAlgorithm, PassError } from '../framework/passes/index.js';
import { meaningGate } from './contract.js';
import { evaluate, type Inputs, type Precision, type BufferValue } from './evaluate.js';
import { adapter, TixIR } from './ir.js';
import { selectFunction, type Module } from './model.js';
import { checkCudaLowering } from './cuda-contract.js';
import { runCudaBatch, type CudaInputs, type CudaResult } from './cuda-runtime.js';
import { emitSchedule } from './cuda-source.js';
import { lowerSchedule } from './strategy.js';
import { parse } from './parser.js';
import { inlinePass, splitPass, type TixPass } from './passes.js';

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
        meaningGate(origin, definition.relation),
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

export function tixAlgorithm(pass: TixPass, { origin }: { origin: Artifact<Module> }) {
  const invariant = defineInvariant({
    id: 'tix.meaning-gate.' + pass.relation,
    version: '1',
    description: 'Check the Tix meaning gate',
    inputs: { before: TixIR, origin: TixIR, after: TixIR },
    check: (_ctx, { before, origin, after }) => {
      const result = meaningGate(origin, pass.relation)(before, after);
      return result.ok
        ? { ok: true, evidence: JSON.parse(JSON.stringify(result.evidence ?? null)) }
        : { ok: false, reason: result.reason };
    },
  });
  const contract = defineTransformation({
    id: 'tix.gated.' + pass.relation,
    version: '1',
    description: 'A Tix pass checked against its origin',
    inputs: { input: TixIR, origin: TixIR },
    outputs: { output: TixIR },
    ensures: [
      {
        invariant,
        bindings: {
          before: { from: 'inputs', port: 'input' },
          origin: { from: 'inputs', port: 'origin' },
          after: { from: 'outputs', port: 'output' },
        },
      },
    ],
  });
  return passAlgorithm(pass, { manager: new AnalysisManager(), contract, contractInputs: () => ({ origin }) });
}

export interface LoweringOptions {
  /** Fuse statements into fewer kernels (stage 3, the default); `false` is stage 2's one kernel per statement. */
  fuse?: boolean;
}
// IRWB-033-D: Tix -> schedule IR (fusion plan, then the checked scheduling passes) -> CUDA source.
function lower(program: TixProgram, fn: string, options?: LoweringOptions) {
  const f = selectFunction(program.current.value, fn);
  return { f, source: emitSchedule(lowerSchedule(f, options?.fuse !== false).value) };
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
