import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/index.js';
import { evaluate, type Inputs, type Precision, type Tensor } from './evaluate.js';
import { tensorAdapter } from './ir.js';
import type { TensorModule } from './model.js';
import { parseTix } from './parser.js';

export interface TixProgram {
  readonly origin: Artifact<TensorModule>;
  readonly current: Artifact<TensorModule>;
}
export function compileTix(source: string): TixProgram {
  const origin = createIRArtifact(tensorAdapter, 'tix', parseTix(source));
  return Object.freeze({ origin, current: origin });
}
export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Inputs,
  options?: { precision?: Precision },
): Tensor {
  const entry = program.current.value.functions.find(f => f.name === fn);
  if (!entry) throw new Error(`unknown Tix function ${fn}`);
  return evaluate(entry, inputs, options?.precision ?? 'f32');
}
