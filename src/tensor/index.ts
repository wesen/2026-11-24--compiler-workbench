import type { DifferentialEvidence } from '../framework/contracts/index.js';
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { applyTransformationSync, passAlgorithm, type PassLike } from '../framework/passes/index.js';
import {
  AlgorithmRegistry,
  algorithm,
  executeSync,
  identityAlgorithm,
  passSequence,
  plan,
  StrategyExecutionError,
} from '../framework/strategy/index.js';
import { evaluate, type Inputs, type Precision, type BufferValue } from './evaluate.js';
import { adapter } from './ir.js';
import { selectFunction, type Module } from './model.js';
import { checkCudaLowering, cudaLowering } from './cuda-contract.js';
import { runCudaBatch, type CudaInputs, type CudaResult } from './cuda-runtime.js';
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
/**
 * Apply the named passes in order. The list is a strategy plan: a sequence with one `attempt` per pass, whose
 * fallback keeps the program when the pass's meaning gate rejects the candidate. The plan runs under the
 * synchronous driver (`executeSync`), and each step's outcome is read from the plan's execution records.
 */
export function optimizeTix(program: TixProgram, passes: string[]) {
  const { origin } = program;
  const registry = new AlgorithmRegistry().register(identityAlgorithm);
  const nodes = passes.map((pass, i) => {
    const definition = pass === 'inline' ? inlinePass : pass === 'split-sum' ? splitPass : undefined;
    if (!definition) throw Error('Unknown pass ' + pass);
    if (!registry.has(definition)) registry.register(tixAlgorithm(definition, { origin }));
    return { id: `${i}`, algorithm: algorithm(definition.id, definition.version), tolerate: true };
  });
  const execution = executeSync(
    plan('tix.optimize', passSequence('passes', nodes)),
    registry,
    program.current,
  );
  if (execution.status !== 'succeeded') throw new StrategyExecutionError(execution);
  const steps = passes.map((pass, i) => {
    const record = execution.records.find(r => r.nodeId === `${i}`)!;
    if (record.status === 'succeeded') {
      const { changed } = record.evidence.find(e => e.label === 'pass')!.data as { changed: boolean };
      return { pass, accepted: true, changed };
    }
    const evidence = record.error!.evidence as DifferentialEvidence | undefined;
    return {
      pass,
      accepted: false,
      changed: false,
      reason: evidence?.counterexamples[0]?.reason ?? record.error!.message,
    };
  });
  return { program: { origin, current: execution.value as Artifact<Module> }, steps };
}

/** A Tix pass as a strategy algorithm: the pass runner, with the origin its meaning gate compares against. */
export function tixAlgorithm(pass: PassLike<Module>, { origin }: { origin: Artifact<Module> }) {
  return passAlgorithm(pass, { contractInputs: () => ({ origin }) });
}

export interface LoweringOptions {
  /** Fuse statements into fewer kernels (stage 3, the default); `false` is stage 2's one kernel per statement. */
  fuse?: boolean;
}
/**
 * IRWB-061: the CUDA unit of a function, as a pending application of `tensor.lower-cuda` (cuda-contract.ts): the
 * same transformation `checkLowering` applies, with its GPU check recorded as owed instead of run. The result
 * carries the unit (source and manifest), the composed correspondence and the pending obligation.
 */
export function lowerTixCuda(program: TixProgram, fn: string, options?: LoweringOptions) {
  return applyTransformationSync(cudaLowering, program.current, {
    params: { fn, fuse: options?.fuse !== false },
    pending: { reason: 'the unit only; tensor.cuda-meaning runs on the GPU in checkLowering' },
  });
}

export function cudaSource(program: TixProgram, fn: string, options?: LoweringOptions): string {
  return lowerTixCuda(program, fn, options).artifact.value.source;
}

export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: CudaInputs,
  options?: LoweringOptions & { host?: string; benchmark?: boolean },
): Promise<CudaResult> {
  const { source, kernels } = lowerTixCuda(program, fn, options).artifact.value;
  // the unit's own manifest names the gate choices the program reports (no lookup by the source's hash)
  const [result] = await runCudaBatch(source, selectFunction(program.current.value, fn), [inputs], {
    host: options?.host,
    benchmark: options?.benchmark,
    kernels,
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
