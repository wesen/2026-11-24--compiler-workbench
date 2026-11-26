import type { Artifact } from '../core/types.js';
import { immutable } from '../core/data.js';
import { validateArtifact } from '../contracts/definitions.js';
import {
  differentialSpec,
  runDifferential,
  type DifferentialEvidence,
  type DifferentialInvariant,
} from '../contracts/differential.js';
import type { Ports, TransformationDefinition } from '../contracts/types.js';
import { openIR } from '../ir/view.js';
import { synchronous, syncFunction } from '../ir/common.js';
import { PassError, undeclaredWrites, type Pass, type Needs, type PassResult } from './define-pass.js';

/** Synchronous edit-only subset. No manager facts, effects, cached bodies or persistent store head. */
export function applySampledPassSync<S, P>(
  pass: Pass<S, Needs, P>,
  before: Artifact<S>,
  options: {
    contract?: TransformationDefinition<Ports, Ports>;
    contractInputs?: Readonly<Record<string, Artifact>>;
    params?: P;
  },
): PassResult<S> {
  const gate = options.contract ?? pass.contract;
  const unsupported = (why: string): never => {
    throw new PassError('badResult', `Unsupported synchronous pass: ${why}`);
  };
  if (
    !gate ||
    gate.run ||
    gate.cache !== 'pure' ||
    gate.effects.length ||
    gate.requires.length ||
    !gate.ensures.length ||
    gate.establishes.length ||
    gate.preserves.length ||
    gate.correspondence.length ||
    Object.keys(pass.needs ?? {}).length ||
    pass.preserves?.length
  )
    return unsupported('requires pure sampled postconditions only');
  if (
    Object.keys(gate.outputs).length !== 1 ||
    gate.outputs.output?.category !== 'ir' ||
    gate.inputs.input?.category !== 'ir'
  )
    return unsupported('expected input and output IR ports');
  before = immutable(before);
  const inputs = immutable({ ...options.contractInputs, input: before }) as Record<string, Artifact>;
  if (
    Object.hasOwn(options.contractInputs ?? {}, 'input') ||
    Object.keys(inputs).length !== Object.keys(gate.inputs).length
  )
    return unsupported('incorrect named inputs');
  validateArtifact(pass.ir, before);
  for (const [k, t] of Object.entries(gate.inputs)) {
    if (t.category !== 'ir' || !Object.hasOwn(inputs, k)) return unsupported(`port ${k}`);
    validateArtifact(t, inputs[k]);
  }
  const checks = gate.ensures.map(c => {
    if (!('invariant' in c) || c.invariant.effects.length) return unsupported('non-differential guarantee');
    const spec = differentialSpec(c.invariant as DifferentialInvariant<Ports>);
    if (spec.decide) return unsupported('asynchronous case delegation');
    for (const callback of Object.values(spec))
      if (typeof callback === 'function') syncFunction(callback, 'Sampled invariant callback');
    // Outcome is unconstrained in DifferentialSpec. A plain function returning a promise
    // must not let a comparator mistake two unresolved observations for equal values.
    return {
      spec: {
        ...spec,
        run: (...args: Parameters<typeof spec.run>) => synchronous(spec.run(...args), 'Sample outcome'),
      },
      bindings: c.bindings,
    };
  });
  syncFunction(pass.run, 'Sampled pass body');
  const view = openIR(before, pass.adapter),
    edit = view.beginEdit();
  try {
    const ret = synchronous(
      pass.run({ before, view, edit, params: options.params as P, facts: {}, records: {} }),
      'Sampled pass body',
    );
    if (ret !== undefined || edit.state !== 'open')
      return unsupported('expected an open edit, no native result');
    const prepared = edit.operationCount ? edit.prepare() : undefined;
    const after = prepared?.artifact ?? before;
    validateArtifact(gate.outputs.output, after);
    if (prepared) {
      const writes = undeclaredWrites(pass.writes, prepared.changes);
      if (writes.length) throw new PassError('undeclaredWrite', `${pass.id}: ${writes.join(', ')}`);
    }
    const evidence: DifferentialEvidence[] = [];
    for (const { spec, bindings } of checks) {
      const bound = Object.fromEntries(
        Object.entries(bindings).map(([k, s]) => [k, s.from === 'outputs' ? after : inputs[s.port]]),
      );
      const result = runDifferential(spec, bound);
      evidence.push(result);
      if (result.status !== 'agree')
        throw new PassError('contractRejected', `${pass.id}: ${result.status}`, immutable(result));
    }
    return {
      pass: { id: pass.id, version: pass.version },
      before,
      artifact: after,
      changed: after.revision !== before.revision,
      edits: prepared?.changes.operations.filter(o => o.kind !== 'correspond').length ?? 0,
      preserved: [],
      contract: immutable(evidence),
      ...(prepared && { changes: prepared.changes, correspondence: prepared.correspondence }),
    };
  } finally {
    if (edit.state === 'open' || edit.state === 'prepared') edit.rollback('private synchronous draft');
  }
}
