/**
 * The tensor domain's public API (IRWB-020): compile a Tix program, run it, optimize it with checked passes.
 */
import { createIRArtifact } from '../framework/ir/adapters.js';
import { checkTix } from './check.js';
import { runF32, runF64 } from './evaluate.js';
import { tixAdapter } from './ir.js';
import { applyChecked, PASSES, type Step, type TixProgram } from './passes.js';

export type { TixProgram, Step } from './passes.js';
export type TixTensor = { shape: number[]; data: Float32Array | Float64Array };

/** Parse and check a Tix program. Throws an Error whose message starts with `line:col:` on invalid source. */
export function compileTix(source: string): TixProgram {
  const origin = createIRArtifact(tixAdapter, 'tix', checkTix(source));
  return Object.freeze({ origin, current: origin });
}

/** Run a function on row-major inputs: in f32 (the program's meaning, the default) or in f64 (the reference). */
export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Record<string, { shape: number[]; data: Float32Array | Float64Array }>,
  options?: { precision?: 'f32' | 'f64' },
): TixTensor {
  const ir = program.current.value;
  return options?.precision === 'f64' ? runF64(ir, fn, inputs) : runF32(ir, fn, inputs);
}

/**
 * Run the named passes in order. Each is checked by the meaning contract under the relation the pass claims
 * (`inline`: exact; `split-sum`: tolerance); a rejected pass leaves the program as it was and the next one runs.
 */
export function optimizeTix(program: TixProgram, passes: string[]): { program: TixProgram; steps: Step[] } {
  const steps: Step[] = [];
  for (const name of passes) {
    const entry = Object.hasOwn(PASSES, name) ? PASSES[name] : undefined;
    if (!entry) throw new Error(`unknown pass '${name}'; passes: ${Object.keys(PASSES).join(', ')}`);
    const r = applyChecked(program, entry);
    program = r.program;
    steps.push(r.step);
  }
  return { program, steps };
}
