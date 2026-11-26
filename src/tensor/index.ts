import type { Artifact } from '../framework/core/types.js';
import type { IRGraph } from '../framework/ir/index.js';
import { applySampledPassSync, PassError } from '../framework/passes/index.js';
import { compile } from './check.js';
import { evaluate, type Inputs, type Tensor, type Precision } from './evaluate.js';
import { Index } from './ir.js';
import { inline, splitSum } from './passes.js';
export interface TixProgram {
  readonly origin: Artifact<IRGraph>;
  readonly current: Artifact<IRGraph>;
}
export function compileTix(source: string): TixProgram {
  const origin = compile(source);
  return Object.freeze({ origin, current: origin });
}
export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Inputs,
  options?: { precision?: Precision },
): Tensor {
  return evaluate(new Index(program.current.value), 'fn:' + fn, inputs, options?.precision ?? 'f32');
}
export function optimizeTix(
  program: TixProgram,
  passes: string[],
): { program: TixProgram; steps: { pass: string; accepted: boolean }[] } {
  const origin = program.origin,
    steps = [];
  let current = program.current;
  for (const name of passes) {
    const pass = name === 'inline' ? inline : name === 'split-sum' ? splitSum : undefined;
    if (!pass) throw Error(`unknown pass ${name}`);
    try {
      current = applySampledPassSync(pass, current, { contractInputs: { origin } }).artifact;
      steps.push({ pass: name, accepted: true });
    } catch (e) {
      if (!(e instanceof PassError) || e.code !== 'contractRejected') throw e;
      steps.push({ pass: name, accepted: false });
    }
  }
  return { program: Object.freeze({ origin, current }), steps };
}
