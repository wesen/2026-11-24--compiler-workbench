/**
 * IRWB-020-N: the tensor domain's public API (fixed by the brief).
 *
 *   compileTix(source)                -> TixProgram (throws Error with line:col on invalid source)
 *   runTix(program, fn, inputs, opts) -> { shape, data } (row-major; f32 by default, f64 on request)
 *   optimizeTix(program, passes)      -> { program, steps }, each pass checked by its contract
 */
import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/adapters.js';
import { applyPassSync, PassError } from '../framework/passes/define-pass.js';
import { checkProgram } from './check.js';
import { evaluate, F32, F64 } from './evaluate.js';
import { tixAdapter, TixIRError, type TixModule } from './ir.js';
import { PASSES } from './passes.js';

export type TixProgram = Artifact<TixModule>;
export type TixInputs = Record<string, { shape: number[]; data: Float32Array | Float64Array }>;

export function compileTix(source: string): TixProgram {
  return createIRArtifact(tixAdapter, 'tix', checkProgram(source));
}

export function runTix(
  program: TixProgram,
  fn: string,
  inputs: TixInputs,
  options: { precision?: 'f32' | 'f64' } = {},
): { shape: number[]; data: Float32Array | Float64Array } {
  const f64 = options.precision === 'f64';
  const r = evaluate(program.value, fn, inputs, f64 ? F64 : F32);
  return { shape: r.shape, data: f64 ? r.data : Float32Array.from(r.data) };
}

/**
 * Run the named passes in order, each checked by its own contract against `program` as the origin. A rejected
 * pass (its contract, its declared writes, or an invalid output) leaves the program unchanged and is reported as
 * `accepted: false`; an unknown pass name throws.
 */
export function optimizeTix(
  program: TixProgram,
  passes: string[],
): { program: TixProgram; steps: { pass: string; accepted: boolean }[] } {
  let current = program;
  const steps: { pass: string; accepted: boolean }[] = [];
  for (const name of passes) {
    const pass = Object.hasOwn(PASSES, name) ? PASSES[name] : undefined;
    if (!pass) throw new Error(`unknown pass ${name} (known: ${Object.keys(PASSES).join(', ')})`);
    try {
      current = applyPassSync(pass, current, { contractInputs: { origin: program } }).artifact;
      steps.push({ pass: name, accepted: true });
    } catch (e) {
      if (!(e instanceof PassError || e instanceof TixIRError)) throw e;
      steps.push({ pass: name, accepted: false });
    }
  }
  return { program: current, steps };
}

export { TixError } from './syntax.js';
export { TixIR, tixAdapter, TixIRError, type TixModule } from './ir.js';
export { exactContract, toleranceContract, TAU, tensorCases, maxScaledError } from './contract.js';
export { PASSES, inline, splitSum, inlineWrong, splitSumWrong } from './passes.js';
