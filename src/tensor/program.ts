import type { Artifact } from '../framework/core/types.js';
import { createIRArtifact } from '../framework/ir/adapters.js';
import { evaluate, plan, type Precision, type Tensor } from './evaluate.js';
import { errorAt, tensorAdapter, type TensorModule } from './ir.js';
import { parse } from './parse.js';

export type TixProgram = Artifact<TensorModule>;

// Keep the origin independent of the IR payload, including across successive optimizeTix calls.
const origins = new WeakMap<TixProgram, TixProgram>();
export const originOf = (program: TixProgram) => origins.get(program) ?? program;
export function retainOrigin(program: TixProgram, origin: TixProgram) {
  if (program !== origin) origins.set(program, origin);
}

export function compileTix(source: string): TixProgram {
  return createIRArtifact(tensorAdapter, 'tix', parse(source));
}

export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Record<string, Tensor>,
  options?: { precision?: Precision },
): Tensor {
  const entry = program.value.functions.find(f => f.name === fn);
  if (!entry) throw new Error(`Unknown Tix function '${fn}'`);
  if (Object.keys(inputs).length !== entry.params.length) throw errorAt(entry.at, 'incorrect input count');
  const ordered = entry.params.map(p => {
    if (!Object.hasOwn(inputs, p.name)) throw errorAt(p.at, `missing input '${p.name}'`);
    return inputs[p.name];
  });
  const shapes = ordered.map(t => t.shape);
  const origin = originOf(program);
  if (origin !== program) plan(origin.value.functions.find(f => f.name === fn)!, shapes);
  return evaluate(
    entry,
    plan(entry, shapes),
    ordered.map(t => t.data),
    options?.precision ?? 'f32',
  );
}
