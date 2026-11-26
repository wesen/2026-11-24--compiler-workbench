import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { evaluate, type Inputs, type Precision, type Tensor } from './evaluate.js';
import { adapter } from './ir.js';
import type { Program } from './model.js';
import { parse } from './parse.js';

export interface TixProgram {
  readonly origin: Artifact<Program>;
  readonly current: Artifact<Program>;
}
export function compileTix(source: string): TixProgram {
  const origin = createIRArtifact(adapter, 'tix', parse(source));
  return Object.freeze({ origin, current: origin });
}
export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Inputs,
  options?: { precision?: Precision },
): Tensor {
  const f = program.current.value.functions.find(f => f.name === fn);
  if (!f) throw new Error(`Unknown function ${fn}`);
  return evaluate(f, inputs, options?.precision ?? 'f32');
}
