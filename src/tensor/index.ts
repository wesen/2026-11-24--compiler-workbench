import { createIRArtifact, validateIRArtifact } from '../framework/ir/index.js';
import { checkSource } from './check.js';
import { evaluate } from './evaluate.js';
import type { Inputs, Precision, Tensor } from './evaluate.js';
import { tensorAdapter } from './ir.js';
import type { TixProgram } from './model.js';
import { optimizeWith } from './optimize.js';
import type { Step } from './optimize.js';
import { inline, splitSum } from './passes.js';

export type { TixProgram } from './model.js';

export function compileTix(source: string): TixProgram {
  return createIRArtifact(tensorAdapter, 'tix', checkSource(source));
}

export function runTix(
  program: TixProgram,
  fn: string,
  inputs: Inputs,
  options?: { precision?: Precision },
): Tensor {
  const artifact = validateIRArtifact(tensorAdapter, program);
  const entry = artifact.value.functions.find(f => f.name === fn);
  if (!entry) throw new Error(`unknown Tix function '${fn}'`);
  return evaluate(entry, inputs, options?.precision ?? 'f32');
}

const passTable = new Map<string, Step>([
  ['inline', { pass: 'inline', body: inline, relation: 'exact' }],
  ['split-sum', { pass: 'split-sum', body: splitSum, relation: 'tolerance' }],
]);

export function optimizeTix(
  program: TixProgram,
  passes: string[],
): {
  program: TixProgram;
  steps: { pass: string; accepted: boolean }[];
} {
  const plan = passes.map(name => {
    const step = passTable.get(name);
    if (!step) throw new Error(`unknown Tix pass '${name}'`);
    return step;
  });
  const result = optimizeWith(validateIRArtifact(tensorAdapter, program), plan);
  return { program: result.program, steps: result.steps.map(({ pass, accepted }) => ({ pass, accepted })) };
}
