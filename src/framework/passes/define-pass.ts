/**
 * IRWB-001 E3, IRWB-052: what the pass runner is made of. The runner itself, the transformation type and the
 * constructors are in transformation.ts.
 *
 * Here: `PassError`, the context a pass body receives, the result of an application, and the helpers the runner
 * calls in order: `prepareNative` (the candidate, its change set and its correspondence from a native result),
 * `enforceWrites` (any change outside the declared kinds is `undeclaredWrite`), `publishAccepted` (F33's one
 * publication point) and `discardEvidence` (the rollback of a deferred contract execution).
 *
 * F33: publication is one step. The candidate is prepared on a store the caller cannot see, the contract runs with
 * `deferCommit`, and only after the preservation claims pass does `publishAccepted` make the revision the store's
 * head and commit the contract's evidence in the same atomic publication. Every rejection before that publishes
 * nothing and rolls the deferred evidence back.
 */
import type { Artifact } from '../core/types.js';
import { canonical } from '../core/data.js';
import { createIRArtifact, openIR } from '../ir/index.js';
import { diff } from '../ir/diff.js';
import { makeCorrespondence } from '../ir/correspondence.js';
import {
  correspondenceFromDerivation,
  validateDerivation,
  type Derivation,
  type DerivationCoverage,
} from '../ir/derivation.js';
import type {
  ChangeSet,
  CorrespondenceEntry,
  EntityCorrespondence,
  IRAdapter,
  IREdit,
  IRStore,
  IRView,
} from '../ir/index.js';
import type {
  AnalysisDefinition,
  AnalysisRecord,
  CheckResult,
  Correspondence,
  IRType,
  Ports,
  PreparedTransformation,
  TransformationDefinition,
} from '../contracts/types.js';
import type { AnalysisManager } from '../contracts/analysis-manager.js';

export class PassError extends Error {
  constructor(
    readonly code:
      | 'undeclaredWrite'
      | 'preserveViolated'
      | 'contractRejected'
      | 'badResult'
      | 'passFailed'
      | 'illegal',
    message: string,
    readonly evidence?: unknown,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'PassError';
  }
}

export type Needs = Readonly<Record<string, AnalysisDefinition<any, any>>>;
export type FactValues<N extends Needs> = {
  readonly [K in keyof N]: N[K] extends AnalysisDefinition<any, infer R> ? R : never;
};

export interface PassRunContext<S, N extends Needs, P> {
  readonly before: Artifact<S>;
  readonly view: IRView<S>;
  readonly facts: FactValues<N>;
  readonly records: { readonly [K in keyof N]: AnalysisRecord<unknown> };
  readonly params: P;
  /** A v6 edit on the logical projection; used when `run` returns nothing. */
  readonly edit: IREdit<S>;
}

/** A native result: the new value, and how its entities relate to the input's (merge, split, replace…). */
export interface NativeResult<S> {
  readonly native: S;
  readonly correspondence?: readonly CorrespondenceEntry[];
  /**
   * IRWB-056-B: the producer's derivation. When present, the correspondence is computed from its steps instead of
   * from `correspondence`, and `coverage` says what the steps must account for (F35's vocabulary). A result gives
   * one or the other, never both: the correspondence has exactly one source.
   */
  readonly derivation?: Derivation;
  readonly coverage?: DerivationCoverage;
  /** How many edits the pass made, for reporting (Compiler Workbench shows edits per pass). */
  readonly edits?: number;
  /** Domain report (e.g. the edit records of a Compiler Workbench revision), passed through to the result. */
  readonly report?: unknown;
}

/**
 * The earlier spelling of a transformation, which `definePass` still accepts: `run` for `prepare`, `legal` for
 * `eligible`, and `preserves` and `contract` beside the body instead of under `obligations`.
 */
export interface PassSpec<S, N extends Needs, P = unknown> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly ir: IRType<S>;
  readonly adapter: IRAdapter<S>;
  readonly needs?: N;
  /** Entity kinds (glob `prefix*`) and relation kinds the pass may change. */
  readonly writes: { readonly entities: readonly string[]; readonly relations: readonly string[] };
  readonly preserves?: readonly AnalysisDefinition<any, any>[];
  readonly contract?: TransformationDefinition<Ports, Ports>;
  /**
   * IRWB-033-D: whether the pass may be applied to this revision with these parameters, decided from the IR before
   * `run`. A refusal is `PassError('illegal', reason)` and nothing runs, so a caller can tell a step that does not
   * apply from a pass that failed or a candidate that a contract rejected.
   */
  legal?(ctx: { readonly before: Artifact<S>; readonly view: IRView<S>; readonly params: P }): CheckResult;
  run(ctx: PassRunContext<S, N, P>): void | NativeResult<S> | Promise<void | NativeResult<S>>;
}

export interface PreservationOutcome {
  readonly analysis: string;
  readonly how: 'transferred' | 'confirmed-by-recompute';
  readonly evidence: unknown;
}

export interface PassResult<S> {
  readonly pass: { readonly id: string; readonly version: string };
  readonly changed: boolean;
  readonly before: Artifact<S>;
  readonly artifact: Artifact<S>;
  readonly changes?: ChangeSet;
  readonly correspondence?: EntityCorrespondence;
  /** IRWB-056-B: the producer's record of why, next to the edits and the correspondence. */
  readonly derivation?: Derivation;
  readonly edits: number;
  readonly preserved: readonly PreservationOutcome[];
  readonly contract?: unknown;
  readonly report?: unknown;
}

const glob = (patterns: readonly string[], kind: string) =>
  patterns.some(p => (p.endsWith('*') ? kind.startsWith(p.slice(0, -1)) : p === kind));

/** The changes a pass made outside what it declared it writes. */
export function undeclaredWrites(
  writes: PassSpec<any, any>['writes'],
  changes: ChangeSet,
): readonly string[] {
  const out = new Set<string>();
  for (const c of changes.entities)
    for (const e of [c.before, c.after])
      if (e && !glob(writes.entities, e.kind)) out.add(`${c.kind} entity ${c.entity} (${e.kind})`);
  for (const c of changes.relations)
    for (const r of [c.before, c.after])
      if (r && !glob(writes.relations, r.kind)) out.add(`${c.kind} relation ${c.relation} (${r.kind})`);
  return [...out].sort();
}

/**
 * v6's semantic correspondence record for an entity correspondence between two revisions. The analysis manager
 * matches records to a contract's `correspondence` requirements by `id` and `relation`, so the runner builds one
 * record per requirement (default: `entities` / `generic-ir-edit`, as v6's own labs name it).
 */
export function semanticCorrespondence(
  c: EntityCorrespondence,
  id = 'entities',
  relation = 'generic-ir-edit',
): Correspondence {
  return {
    id,
    from: { artifact: c.from.artifact, revision: c.from.revision },
    to: { artifact: c.to.artifact, revision: c.to.revision },
    relation,
    sourceEntities: c.sourceEntities,
    targetEntities: c.targetEntities,
    entities: c.entries.map(e => ({ from: e.from, to: e.to })),
    evidence: {
      formatVersion: c.formatVersion,
      relations: c.entries.map(e => e.relation),
      sourceEntities: c.sourceEntities,
      targetEntities: c.targetEntities,
    },
  };
}

export function prepareNative<S>(
  pass: { readonly adapter: IRAdapter<S> },
  view: IRView<S>,
  produced: NativeResult<S>,
  id: string,
) {
  const before = view.artifact;
  const after = createIRArtifact(pass.adapter, id, produced.native);
  // F33: the candidate is opened on a private store, so preparing it publishes nothing the caller can observe;
  // the runner publishes it, and the evidence about it, once every check has accepted it.
  const afterView = openIR(after, pass.adapter);
  const changes = diff(view, afterView);
  const from = { artifact: before.id, revision: before.revision },
    to = { artifact: after.id, revision: after.revision };
  // the projections' entity ids, in order (what `view.entities()` names, without a reference per entity)
  const source = view.graph().entities.map(e => e.id),
    target = afterView.graph().entities.map(e => e.id);
  // IRWB-056-B: one source for the correspondence. A derivation is checked for its sites and mapped under its
  // declared coverage; without one, the entries the pass supplies are completed as before.
  if (produced.derivation && produced.correspondence)
    throw new PassError('badResult', 'A result gives a derivation or correspondence entries, not both');
  const correspondence = produced.derivation
    ? correspondenceFromDerivation(
        validateDerivation(produced.derivation, source, target),
        from,
        to,
        source,
        target,
        { coverage: produced.coverage },
      )
    : makeCorrespondence(from, to, source, target, produced.correspondence ?? []);
  const edits = produced.edits ?? changes.entities.length;
  return {
    after,
    changes,
    correspondence,
    edits,
    ...(produced.derivation ? { derivation: produced.derivation } : {}),
  };
}

export function enforceWrites(pass: Pick<PassSpec<unknown, Needs>, 'writes' | 'id'>, changes: ChangeSet) {
  const undeclared = undeclaredWrites(pass.writes, changes);
  if (undeclared.length)
    throw new PassError('undeclaredWrite', `Pass ${pass.id} changed kinds it did not declare in writes`, {
      undeclared: undeclared.slice(0, 20),
    });
}

/** Discard a deferred transformation's evidence unless it has already been committed. */
export function discardEvidence(prepared: PreparedTransformation | undefined, reason: string) {
  if (!prepared || prepared.execution.status === 'accepted') return;
  prepared.rollback(reason);
}

/**
 * F33: the one publication point of an accepted application. The revision becomes the store's head and the
 * contract's prepared execution and facts are committed inside that same atomic publication, so the head never
 * outlives the evidence that justified it; without a store the evidence is the whole publication. A store refusal
 * (a stale head, a colliding lineage) propagates as its own `IRError` after the evidence is rolled back.
 */
export function publishAccepted<S>(
  pass: { readonly id: string },
  store: IRStore | undefined,
  before: Artifact<S>,
  after: Artifact<S>,
  prepared: PreparedTransformation | undefined,
  generation: number | undefined,
): void {
  const acceptance = prepared && {
    commit: () => void prepared.commit(),
    rollback: (reason?: string) => prepared.rollback(reason),
  };
  if (!store) {
    prepared?.commit();
    return;
  }
  try {
    store.publish(after, {
      ...(after.id === before.id ? { base: before, generation } : {}),
      ...(acceptance ? { acceptance } : {}),
    });
  } catch (e) {
    discardEvidence(prepared, `Pass ${pass.id} was not published: ${(e as Error).message}`);
    throw e;
  }
}
