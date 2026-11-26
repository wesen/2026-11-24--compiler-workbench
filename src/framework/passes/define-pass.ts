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
 */
import type { Artifact } from '../core/types.js';
import { canonical, immutable } from '../core/data.js';
import { synchronous } from '../ir/common.js';
import { validateArtifact } from '../contracts/definitions.js';
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
  TransformationDefinition,
} from '../contracts/types.js';
import type { AnalysisManager } from '../contracts/analysis-manager.js';

export class PassError extends Error {
  constructor(
    readonly code: 'undeclaredWrite' | 'preserveViolated' | 'contractRejected' | 'badResult' | 'passFailed',
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
  /** Extra contract inputs beyond `input` (e.g. `origin`: r0), supplied by the caller per application. */
  run(ctx: PassRunContext<S, N, P>): void | NativeResult<S> | Promise<void | NativeResult<S>>;
}

export type Pass<S, N extends Needs = Needs, P = unknown> = Readonly<PassSpec<S, N, P>> & {
  readonly category: 'pass';
};

export function definePass<S, N extends Needs = {}, P = unknown>(spec: PassSpec<S, N, P>): Pass<S, N, P> {
  if (!spec.id || !spec.version) throw new Error('A pass needs an id and a version');
  if (typeof spec.run !== 'function') throw new Error(`Pass ${spec.id} needs run`);
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
    entities: c.entries.map(e => ({ from: e.from, to: e.to })),
    evidence: {
      formatVersion: c.formatVersion,
      relations: c.entries.map(e => e.relation),
      sourceEntities: c.sourceEntities,
      targetEntities: c.targetEntities,
    },
  };
}

function prepareNative<S>(
  view: IRView<S>,
  adapter: IRAdapter<S>,
  id: string,
  produced: NativeResult<S>,
  store?: IRStore,
) {
  const after = createIRArtifact(adapter, id, produced.native);
  const afterView = openIR(after, adapter, store);
  const changes = diff(view, afterView);
  const correspondence = makeCorrespondence(
    { artifact: view.artifact.id, revision: view.artifact.revision },
    { artifact: after.id, revision: after.revision },
    view.graph().entities.map(e => e.id),
    afterView.graph().entities.map(e => e.id),
    produced.correspondence ?? [],
  );
  return {
    after,
    changes,
    correspondence,
    edits: produced.edits ?? changes.entities.length,
    report: produced.report,
  };
}

function assertWrites(pass: { id: string; writes: PassSpec<any, any>['writes'] }, changes: ChangeSet) {
  const undeclared = undeclaredWrites(pass.writes, changes);
  if (undeclared.length)
    throw new PassError('undeclaredWrite', `Pass ${pass.id} changed kinds it did not declare in writes`, {
      undeclared: undeclared.slice(0, 20),
    });
}

export interface NativePassSpec<S>
  extends Pick<PassSpec<S, {}>, 'id' | 'version' | 'description' | 'ir' | 'adapter' | 'writes'> {
  readonly needs?: never;
  readonly preserves?: never;
  readonly contract?: never;
  run(ctx: { readonly before: Artifact<S>; readonly view: IRView<S> }): NativeResult<S> | undefined;
}

/** Apply a native-only rewrite without a rebuild adapter or an asynchronous semantic lifecycle. */
export function applyNativePassSync<S>(
  pass: NativePassSpec<S>,
  before: Artifact<S>,
  gate: (before: Artifact<S>, candidate: Artifact<S>) => CheckResult,
): PassResult<S> {
  if ('needs' in pass || 'preserves' in pass || 'contract' in pass)
    throw new PassError(
      'badResult',
      'A synchronous native pass cannot declare needs, preservation or a transformation contract',
    );
  if (typeof gate !== 'function')
    throw new PassError('badResult', 'A synchronous native pass needs a check gate');
  const view = openIR(before, pass.adapter);
  before = view.artifact;
  validateArtifact(pass.ir, before);
  const identity = { pass: { id: pass.id, version: pass.version }, before, preserved: [] };
  const noChange = { ...identity, changed: false, artifact: before, edits: 0 };
  const produced = synchronous(pass.run({ before, view }), 'Native pass body');
  if (produced === undefined) return noChange;
  if (!produced || typeof produced !== 'object' || !Object.hasOwn(produced, 'native'))
    throw new PassError('badResult', `Expected a native result from ${pass.id}`);
  const { after, changes, correspondence, edits, report } = prepareNative(
    view,
    pass.adapter,
    before.id,
    produced,
  );
  if (after.revision === before.revision) return noChange;
  assertWrites(pass, changes);
  validateArtifact(pass.ir, after);
  const check = synchronous(gate(before, after), 'Native pass check gate');
  if (
    !check ||
    typeof check !== 'object' ||
    typeof check.ok !== 'boolean' ||
    (check.reason !== undefined && typeof check.reason !== 'string')
  )
    throw new PassError('badResult', `Expected a CheckResult from ${pass.id}'s check gate`);
  const contract = immutable(check);
  if (!contract.ok)
    throw new PassError(
      'contractRejected',
      `Pass ${pass.id} output rejected: ${contract.reason ?? 'check failed'}`,
      contract.evidence,
    );
  return { ...identity, changed: true, artifact: after, changes, correspondence, edits, report, contract };
}

export async function applyPass<S, N extends Needs, P>(
  pass: Pass<S, N, P>,
  before: Artifact<S>,
  options: ApplyOptions<P>,
): Promise<PassResult<S>> {
  const { manager } = options;
  const view = openIR(before, pass.adapter, options.store);
  const facts: Record<string, unknown> = {},
    records: Record<string, AnalysisRecord<unknown>> = {};
  for (const [name, def] of Object.entries(pass.needs ?? {})) {
    const record = await manager.analyse(def, before);
    records[name] = record;
    facts[name] = record.value;
  }
  const edit = view.beginEdit();
  let produced: void | NativeResult<S>;
  try {
    produced = await pass.run({
      before,
      view,
      facts: facts as FactValues<N>,
      records: records as PassRunContext<S, N, P>['records'],
      params: options.params as P,
      edit,
    });
  } catch (e) {
    if (edit.state === 'open') edit.rollback('pass threw');
    throw e;
  }
  let after: Artifact<S>, changes: ChangeSet, correspondence: EntityCorrespondence, edits: number;
  let report: unknown;
  if (produced && typeof produced === 'object' && 'native' in produced) {
    if (edit.state === 'open') edit.rollback('native result');
    ({ after, changes, correspondence, edits, report } = prepareNative(
      view,
      pass.adapter,
      options.outputId ?? before.id,
      produced,
      options.store,
    ));
  } else {
    if (edit.state !== 'open') throw new PassError('badResult', `Pass ${pass.id} closed its edit itself`);
    if (edit.operationCount === 0) {
      // IRWB-004: an edit with no operations is the identity (the projection and rebuild are inverses), so preparing
      // it would rebuild, re-create and re-diff the unchanged program only to find nothing changed
      edit.rollback('no operations');
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

  assertWrites(pass, changes);

  let contract: unknown;
  const gate = options.contract ?? pass.contract;
  if (gate) {
    try {
      const prepared = await manager.verifyTransformation(
        { input: before, ...(options.contractInputs ?? {}) } as never,
        { output: after } as never,
        gate,
        gate.correspondence.length
          ? gate.correspondence.map(req => semanticCorrespondence(correspondence, req.id, req.relation))
          : [semanticCorrespondence(correspondence)],
      );
      contract = prepared;
    } catch (e) {
      throw new PassError('contractRejected', `Pass ${pass.id} output rejected: ${(e as Error).message}`, {
        cause: String(e),
      });
    }
  }

  const preserved: PreservationOutcome[] = [];
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
