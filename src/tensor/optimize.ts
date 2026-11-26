import { applyNativePassSync, PassError } from '../framework/passes/index.js';
import type { Pass } from '../framework/passes/index.js';
import type { Module } from './model.js';
import type { TixProgram } from './index.js';
import { checkMeaning, type Relation } from './contract.js';

export function applyChecked(program: TixProgram, pass: Pass<Module>, relation: Relation) {
  try {
    const result = applyNativePassSync(pass, program.current, {
      check: (before, after) => checkMeaning(program.origin, before, after, relation),
    });
    return {
      program: { origin: program.origin, current: result.artifact },
      accepted: true,
      evidence: result.contract,
    };
  } catch (error) {
    if (!(error instanceof PassError) || error.code !== 'contractRejected') throw error;
    return { program, accepted: false, evidence: error.evidence };
  }
}
