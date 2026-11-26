import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { parse } from './parser.js';
import { adapter } from './ir.js';
import type { Module } from './model.js';
import { evaluate } from './evaluate.js';
import type { Inputs, Precision, Tensor } from './evaluate.js';
import { applyChecked } from './optimize.js';
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
): Tensor {
  const f = program.current.value.functions.find(f => f.name === fn);
  if (!f) throw Error('unknown Tix function ' + fn);
  return evaluate(f, inputs, options?.precision ?? 'f32');
}
export function optimizeTix(program: TixProgram, passes: string[]) {
  const steps: { pass: string; accepted: boolean }[] = [];
  for (const name of passes) {
    if (name !== 'inline' && name !== 'split-sum') throw Error('unknown Tix pass ' + name);
    const result =
      name === 'inline'
        ? applyChecked(program, inlinePass, 'exact')
        : applyChecked(program, splitPass, 'tolerance');
    program = result.program;
    steps.push({ pass: name, accepted: result.accepted });
  }
  return { program, steps };
}
