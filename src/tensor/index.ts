import { createIRArtifact } from '../framework/ir/index.js';
import type { Artifact } from '../framework/core/types.js';
import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import { parse } from './parse.js';
import { adapter } from './ir.js';
import { validate, type Module } from './model.js';
import { evaluate, type Inputs, type Precision, type Tensor } from './evaluate.js';
import { passes as registry } from './passes.js';
import { verify } from './contract.js';
export interface TixProgram {
  readonly origin: Artifact<Module>;
  readonly current: Artifact<Module>;
}
export function compileTix(source: string): TixProgram {
  const m = parse(source);
  validate(m);
  const origin = createIRArtifact(adapter, 'tix', m);
  return Object.freeze({ origin, current: origin });
}
export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Inputs,
  options?: { precision?: Precision },
): Tensor {
  const f = program.current.value.find(f => f.name === fn);
  if (!f) throw Error('undefined function ' + fn);
  return evaluate(f, inputs, options?.precision ?? 'f32');
}
export function optimizeTix(
  program: TixProgram,
  passes: string[],
): { program: TixProgram; steps: { pass: string; accepted: boolean }[] } {
  const steps = [];
  let current = program.current;
  for (const pass of passes) {
    const kernel = registry.get(pass);
    if (!kernel) throw Error('unknown pass ' + pass);
    try {
      current = applyNativePassSync(kernel, current, candidate =>
        verify(pass === 'inline' ? 'exact' : 'tolerance', program.origin, current, candidate),
      ).artifact;
      steps.push({ pass, accepted: true });
    } catch (e) {
      if (!(e instanceof PassError && e.code === 'contractRejected')) throw e;
      steps.push({ pass, accepted: false });
    }
  }
  return { program: Object.freeze({ origin: program.origin, current }), steps };
}
