/**
 * IRWB-001 E3: passes with declared needs, writes and preservation, applied through v6's machinery.
 *
 * A pass is versioned code that turns one artifact revision into the next. It declares:
 *   - `needs`: analyses whose results it reads (v6 analyses, e.g. dataflow facts), computed for the exact input;
 *   - `writes`: the entity and relation kinds it may change; any other change is `undeclaredWrite`;
 *   - `preserves`: analyses whose results it claims survive. Each claim is checked: first by the analysis's own
 *     transfer verifier (E4: unchanged reads), otherwise by recomputing on the output and comparing. A claim that
 *     neither confirms is `preserveViolated`, and the pass is not published;
 *   - `contract`: an optional v6 transformation contract the output must satisfy before it is accepted.
 *
 * A pass edits either through a v6 `IREdit` on the logical projection (generic, pattern-friendly), or by returning
 * a new native value with explicit correspondence entries (efficient for domain code). Either way the framework
 * derives the v6 change set by diffing the two projections, validates the native value through the adapter, builds
 * the correspondence, enforces `writes`, runs the contract, and checks the preservation claims. Nothing is
 * published unless all of that succeeds.
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
  /** How many edits the pass made, for reporting (Compiler Workbench shows edits per pass). */
  readonly edits?: number;
  /** Domain report (e.g. the edit records of a Compiler Workbench revision), passed through to the result. */
  readonly report?: unknown;
}

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
  /** Extra contract inputs beyond `input` (e.g. `origin`: r0), supplied by the caller per application. */
  run(ctx: PassRunContext<S, N, P>): void | NativeResult<S> | Promise<void | NativeResult<S>>;
}

export type Pass<S, N extends Needs = Needs, P = unknown> = Readonly<PassSpec<S, N, P>> & {
  readonly category: 'pass';
};

export function definePass<S, N extends Needs = {}, P = unknown>(spec: PassSpec<S, N, P>): Pass<S, N, P> {
  if (!spec.id || !spec.version) throw new Error('A pass needs an id and a version');
  if (typeof spec.run !== 'function') throw new Error(`Pass ${spec.id} needs run`);
  if (spec.legal !== undefined && typeof spec.legal !== 'function')
    throw new Error(`Pass ${spec.id}: legal must be a function`);
  if (!spec.writes || !Array.isArray(spec.writes.entities) || !Array.isArray(spec.writes.relations))
    throw new Error(`Pass ${spec.id} must declare writes { entities, relations }`);
  return Object.freeze({
    ...spec,
    needs: spec.needs ?? ({} as N),
    preserves: spec.preserves ?? [],
    category: 'pass' as const,
  });
}

export interface ApplyOptions<P> {
  readonly manager: AnalysisManager;
  readonly store?: IRStore;
  readonly params?: P;
  /** Additional contract inputs, e.g. `{ origin: r0 }` for a check against the original program. */
  readonly contractInputs?: Readonly<Record<string, unknown>>;
  /** Artifact id of the output (default: the input's). */
  readonly outputId?: string;
  /** A contract for this application, overriding the pass's own (e.g. one carrying a project's case inputs). */
  readonly contract?: TransformationDefinition<Ports, Ports>;
  /**
   * Check every preservation claim, computing the fact on the input first when the manager does not hold it.
   * By default a claim is checked only when the fact exists (there is otherwise nothing to keep); auditing
   * makes every application a test of the pass's declarations.
   */
  readonly auditPreservation?: boolean;
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
  readonly edits: number;
  readonly preserved: readonly PreservationOutcome[];
  readonly contract?: unknown;
  readonly report?: unknown;
}

function checkLegal<S, P>(
  pass: Pick<PassSpec<S, any, P>, 'id' | 'legal'>,
  before: Artifact<S>,
  view: IRView<S>,
  params: P,
) {
  if (!pass.legal) return;
  const verdict = pass.legal({ before, view, params });
  if (verdict?.ok !== true)
    throw new PassError(
      'illegal',
      `Pass ${pass.id}: ${verdict?.reason ?? 'not applicable'}`,
      verdict?.evidence,
    );
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
 * matches records to a contract's `correspondence` requirements by `id` and `relation`, so applyPass builds one
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

function prepareNative<S, N extends Needs, P>(
  pass: Pick<Pass<S, N, P>, 'adapter'>,
  view: IRView<S>,
  produced: NativeResult<S>,
  id: string,
) {
  const before = view.artifact;
  const after = createIRArtifact(pass.adapter, id, produced.native);
  // F33: the candidate is opened on a private store, so preparing it publishes nothing the caller can observe;
  // `applyPass` publishes it, and the evidence about it, once every check has accepted it.
  const afterView = openIR(after, pass.adapter);
  const changes = diff(view, afterView);
  const correspondence = makeCorrespondence(
    { artifact: before.id, revision: before.revision },
    { artifact: after.id, revision: after.revision },
    // the projections' entity ids, in order (what `view.entities()` names, without a reference per entity)
    view.graph().entities.map(e => e.id),
    afterView.graph().entities.map(e => e.id),
    produced.correspondence ?? [],
  );
  const edits = produced.edits ?? changes.entities.length;
  return { after, changes, correspondence, edits };
}

function enforceWrites(pass: Pick<PassSpec<unknown, Needs>, 'writes' | 'id'>, changes: ChangeSet) {
  const undeclared = undeclaredWrites(pass.writes, changes);
  if (undeclared.length)
    throw new PassError('undeclaredWrite', `Pass ${pass.id} changed kinds it did not declare in writes`, {
      undeclared: undeclared.slice(0, 20),
    });
}

/** Discard a deferred transformation's evidence unless it has already been committed. */
function discardEvidence(prepared: PreparedTransformation | undefined, reason: string) {
  if (!prepared || prepared.execution.status === 'accepted') return;
  prepared.rollback(reason);
}

/**
 * F33: the one publication point of an accepted application. The revision becomes the store's head and the
 * contract's prepared execution and facts are committed inside that same atomic publication, so the head never
 * outlives the evidence that justified it; without a store the evidence is the whole publication. A store refusal
 * (a stale head, a colliding lineage) propagates as its own `IRError` after the evidence is rolled back.
 */
function publishAccepted<S>(
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

/** Run a synchronous native kernel; the caller supplies its synchronous semantic gate. */
export function applyNativePassSync<S, P>(
  pass: Pass<S, {}, P>,
  before: Artifact<S>,
  gate: (before: Artifact<S>, candidate: Artifact<S>) => CheckResult,
  params?: P,
): PassResult<S> {
  if (Object.keys(pass.needs ?? {}).length || pass.preserves?.length || pass.contract)
    throw new PassError('badResult', 'This pass requires the asynchronous analysis manager');
  const view = openIR(before, pass.adapter);
  checkLegal(pass, before, view, params as P);
  const produced = pass.run({
    before,
    view,
    params: params as P,
    facts: {},
    records: {},
    get edit(): IREdit<S> {
      throw new PassError('badResult', 'A native pass must return its native result');
    },
  });
  if (!produced || !('native' in produced)) {
    if (produced instanceof Promise) void produced.catch(() => {});
    throw new PassError('badResult', 'Expected a synchronous native result');
  }
  const base = { pass: { id: pass.id, version: pass.version }, before, preserved: [] };
  const { after, changes, correspondence, edits } = prepareNative(pass, view, produced, before.id);
  if (after.revision === before.revision) return { ...base, changed: false, artifact: before, edits: 0 };
  enforceWrites(pass, changes);
  const contract = gate(before, after);
  if (contract?.ok !== true)
    throw new PassError('contractRejected', contract?.reason ?? 'Candidate rejected', contract?.evidence);
  return {
    ...base,
    changed: true,
    artifact: after,
    edits,
    changes,
    correspondence,
    contract,
    report: produced.report,
  };
}

export async function applyPass<S, N extends Needs, P>(
  pass: Pass<S, N, P>,
  before: Artifact<S>,
  options: ApplyOptions<P>,
): Promise<PassResult<S>> {
  const { manager } = options;
  const view = openIR(before, pass.adapter, options.store);
  // the generation a head advance is checked against: what the caller's store held when the input was opened
  const generation = options.store?.generation(before.id);
  checkLegal(pass, before, view, options.params as P);
  const facts: Record<string, unknown> = {},
    records: Record<string, AnalysisRecord<unknown>> = {};
  for (const [name, def] of Object.entries(pass.needs ?? {})) {
    const record = await manager.analyse(def, before);
    records[name] = record;
    facts[name] = record.value;
  }
  // The edit opens on the first read of ctx.edit, so a pass that returns a native result works with an adapter that
  // cannot rebuild (beginEdit throws ir.capability for one) (IRWB-019 F13).
  let edit: IREdit<S> | undefined;
  let produced: void | NativeResult<S>;
  try {
    produced = await pass.run({
      before,
      view,
      facts: facts as FactValues<N>,
      records: records as PassRunContext<S, N, P>['records'],
      params: options.params as P,
      get edit(): IREdit<S> {
        return (edit ??= view.beginEdit());
      },
    });
  } catch (e) {
    if (edit?.state === 'open') edit.rollback('pass threw');
    throw e;
  }
  let after: Artifact<S>, changes: ChangeSet, correspondence: EntityCorrespondence, edits: number;
  let report: unknown;
  if (produced && typeof produced === 'object' && 'native' in produced) {
    if (edit?.state === 'open') edit.rollback('native result');
    ({ after, changes, correspondence, edits } = prepareNative(
      pass,
      view,
      produced,
      options.outputId ?? before.id,
    ));
    report = produced.report;
  } else {
    if (edit && edit.state !== 'open')
      throw new PassError('badResult', `Pass ${pass.id} closed its edit itself`);
    if (!edit || edit.operationCount === 0) {
      // IRWB-004: an edit with no operations is the identity (the projection and rebuild are inverses), so preparing
      // it would rebuild, re-create and re-diff the unchanged program only to find nothing changed
      edit?.rollback('no operations');
      return {
        pass: { id: pass.id, version: pass.version },
        changed: false,
        before,
        artifact: before,
        edits: 0,
        preserved: [],
      };
    }
    const prepared = edit.prepare();
    after = prepared.artifact;
    changes = prepared.changes;
    correspondence = prepared.correspondence;
    edits = changes.operations.filter(o => o.kind !== 'correspond').length;
    edit.rollback('applyPass publishes revisions itself');
  }
  if (after.revision === before.revision && !changes.entities.length && !changes.relations.length)
    return {
      pass: { id: pass.id, version: pass.version },
      changed: false,
      before,
      artifact: before,
      edits: 0,
      preserved: [],
    };

  enforceWrites(pass, changes);

  let contract: PreparedTransformation | undefined;
  const gate = options.contract ?? pass.contract;
  if (gate) {
    try {
      // F33: deferred, so the evidence is committed at the publication boundary below and not before it
      contract = await manager.verifyTransformation(
        { input: before, ...(options.contractInputs ?? {}) } as never,
        { output: after } as never,
        gate,
        gate.correspondence.length
          ? gate.correspondence.map(req => semanticCorrespondence(correspondence, req.id, req.relation))
          : [semanticCorrespondence(correspondence)],
        { deferCommit: true },
      );
    } catch (e) {
      throw new PassError('contractRejected', `Pass ${pass.id} output rejected: ${(e as Error).message}`, {
        cause: String(e),
      });
    }
  }

  const preserved: PreservationOutcome[] = [];
  try {
    for (const def of pass.preserves ?? []) {
      if (!manager.hasAnalysis(def, before)) {
        if (!options.auditPreservation) continue; // nothing to keep
        await manager.analyse(def, before);
      }
      try {
        const record = await manager.preserve(def, before, after, semanticCorrespondence(correspondence));
        preserved.push({ analysis: def.id, how: 'transferred', evidence: record.transfer?.evidence });
      } catch {
        const old = await manager.analyse(def, before),
          fresh = await manager.analyse(def, after);
        if (canonical(old.value) !== canonical(fresh.value))
          throw new PassError(
            'preserveViolated',
            `Pass ${pass.id} claims to preserve ${def.id}, but it changed`,
            {
              analysis: def.id,
            },
          );
        preserved.push({ analysis: def.id, how: 'confirmed-by-recompute', evidence: { equalValue: true } });
      }
    }
    publishAccepted(pass, options.store, before, after, contract, generation);
  } catch (e) {
    // every rejection before, or at, publication leaves the manager holding nothing about the candidate: the
    // contract's evidence is rolled back, and the preservation checks' analyses of the candidate are invalidated
    // (IRWB-039 lane 0, after IRWB-045-B)
    discardEvidence(contract, `Pass ${pass.id} rejected: ${(e as Error).message}`);
    for (const def of pass.preserves ?? [])
      try {
        manager.invalidate(def, after, `Pass ${pass.id} was not accepted`);
      } catch {
        // cleanup must not mask the rejection
      }
    throw e;
  }
  return {
    pass: { id: pass.id, version: pass.version },
    changed: true,
    before,
    artifact: after,
    changes,
    correspondence,
    edits,
    preserved,
    contract,
    report,
  };
}

/** Phase 3 spike. Native kernels may return void for identity. */
export interface Transformation<S, N extends Needs, P = unknown> {
  id: string;
  version: string;
  adapter: IRAdapter<S>;
  writes: PassSpec<S, N, P>['writes'];
  relation: 'exact' | 'tolerance';
  needs: N;
  eligible?: PassSpec<S, N, P>['legal'];
  prepare: PassSpec<S, N, P>['run'];
  obligations: {
    requires?: (before: Artifact<S>, params: P) => CheckResult;
    ensures: (before: Artifact<S>, after: Artifact<S>, relation: 'exact' | 'tolerance') => CheckResult;
    preserves: readonly AnalysisDefinition<any, any>[];
  };
}

type Effect = { sync(): unknown; async(): unknown };
function* request<T>(sync: () => T, async: () => T | Promise<T>): Generator<Effect, T, unknown> {
  return (yield { sync, async }) as T;
}

function* application<S, N extends Needs, P>(
  tx: Transformation<S, N, P>,
  before: Artifact<S>,
  options: ApplyOptions<P>,
): Generator<Effect, PassResult<S>, unknown> {
  const { manager, store } = options;
  const view = openIR(before, tx.adapter, store);
  const generation = store?.generation(before.id);
  const params = options.params as P;
  checkLegal({ id: tx.id, legal: tx.eligible }, before, view, params);
  const required = tx.obligations.requires?.(before, params);
  if (required && !required.ok)
    throw new PassError('contractRejected', required.reason ?? 'Input rejected', required.evidence);
  const analyse = (def: AnalysisDefinition<any, any>, artifact: Artifact<S>) =>
    request(
      () => manager.analyseSync(def, artifact),
      () => manager.analyse(def, artifact),
    );
  const facts: Record<string, unknown> = {},
    records: Record<string, AnalysisRecord> = {};
  for (const [name, def] of Object.entries(tx.needs)) {
    const record = yield* analyse(def, before);
    facts[name] = record.value;
    records[name] = record;
  }
  const ctx: PassRunContext<S, N, P> = {
    before,
    view,
    params,
    facts: facts as FactValues<N>,
    records: records as PassRunContext<S, N, P>['records'],
    get edit(): IREdit<S> {
      throw new PassError('badResult', 'Native preparation must return its result');
    },
  };
  const produced = yield* request(
    () => {
      const value = tx.prepare(ctx);
      if (value instanceof Promise) {
        void value.catch(() => {});
        throw new Error('Synchronous preparation needs an immediate result');
      }
      return value;
    },
    () => tx.prepare(ctx),
  );
  const base = { pass: { id: tx.id, version: tx.version }, before };
  const unchanged = { ...base, changed: false, artifact: before, edits: 0, preserved: [] };
  if (!produced) return unchanged;
  const { after, changes, correspondence, edits } = prepareNative(
    tx,
    view,
    produced,
    options.outputId ?? before.id,
  );
  if (before.revision === after.revision && !changes.entities.length && !changes.relations.length)
    return unchanged;
  enforceWrites(tx, changes);
  const verdict = tx.obligations.ensures(before, after, tx.relation);
  if (!verdict.ok)
    throw new PassError('contractRejected', verdict.reason ?? 'Candidate rejected', verdict.evidence);
  let deferred: PreparedTransformation | undefined;
  const contract = options.contract;
  if (contract) {
    deferred = yield* request(
      () => {
        throw new Error('Deferred manager contract needs the asynchronous driver');
      },
      () =>
        manager.verifyTransformation(
          { input: before, ...options.contractInputs } as never,
          { output: after } as never,
          contract,
          contract.correspondence.length
            ? contract.correspondence.map(r => semanticCorrespondence(correspondence, r.id, r.relation))
            : [semanticCorrespondence(correspondence)],
          { deferCommit: true },
        ),
    );
  }
  const preserved: PreservationOutcome[] = [];
  const checked = [];
  try {
    for (const def of tx.obligations.preserves) {
      if (!options.auditPreservation && !manager.hasAnalysis(def, before)) continue;
      const old = yield* analyse(def, before);
      const existed = manager.hasAnalysis(def, after);
      const fresh = yield* analyse(def, after);
      if (!existed) checked.push(def);
      if (canonical(old.value) !== canonical(fresh.value))
        throw new PassError('preserveViolated', tx.id + ' changed ' + def.id);
      preserved.push({ analysis: def.id, how: 'confirmed-by-recompute', evidence: { equalValue: true } });
    }
    publishAccepted(tx, store, before, after, deferred, generation);
  } catch (e) {
    discardEvidence(deferred, String(e));
    for (const def of checked) manager.invalidate(def, after, String(e));
    throw e;
  }
  return {
    ...base,
    changed: true,
    artifact: after,
    edits,
    changes,
    correspondence,
    preserved,
    contract: deferred ?? verdict,
    report: produced.report,
  };
}

export function runTransformationSync<S, N extends Needs, P>(
  tx: Transformation<S, N, P>,
  before: Artifact<S>,
  options: ApplyOptions<P>,
): PassResult<S> {
  const run = application(tx, before, options);
  let step = run.next();
  while (!step.done) {
    let answer;
    try {
      answer = step.value.sync();
    } catch (e) {
      step = run.throw(e);
      continue;
    }
    step = run.next(answer);
  }
  return step.value;
}

export async function runTransformation<S, N extends Needs, P>(
  tx: Transformation<S, N, P>,
  before: Artifact<S>,
  options: ApplyOptions<P>,
): Promise<PassResult<S>> {
  const run = application(tx, before, options);
  let step = run.next();
  while (!step.done) {
    let answer;
    try {
      answer = await step.value.async();
    } catch (e) {
      step = run.throw(e);
      continue;
    }
    step = run.next(answer);
  }
  return step.value;
}
