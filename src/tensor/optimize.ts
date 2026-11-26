import { applyPassSync, PassError } from '../framework/passes/index.js';
import type { CheckResult } from '../framework/contracts/index.js';
import type { TixProgram } from './model.js';
import { checkMeaning } from './meaning.js';
import type { Relation } from './meaning.js';
import type { TensorPass } from './passes.js';

const origins = new WeakMap<TixProgram, TixProgram>();

export interface Step {
  readonly pass: string;
  readonly body: TensorPass;
  readonly relation: Relation;
}

/** Internal entry for both public passes and tests of the same publication gate. */
export function optimizeWith(program: TixProgram, passes: readonly Step[]) {
  const origin = origins.get(program) ?? program;
  const steps: { pass: string; accepted: boolean; check?: CheckResult }[] = [];
  for (const { pass, body, relation } of passes) {
    try {
      const result = applyPassSync(body, program, {
        check: ({ input, output }) => checkMeaning(origin, input, output, relation),
      });
      program = result.artifact;
      if (program !== origin) origins.set(program, origin);
      steps.push({
        pass,
        accepted: true,
        ...(result.changed ? { check: result.contract as CheckResult } : {}),
      });
    } catch (e) {
      if (!(e instanceof PassError) || e.code !== 'contractRejected') throw e;
      steps.push({ pass, accepted: false, check: { ok: false, reason: e.message, evidence: e.evidence } });
    }
  }
  return { program, steps };
}
