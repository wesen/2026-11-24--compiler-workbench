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
import { canonical } from '../core/data.js';
import { createIRArtifact, openIR } from '../ir/index.js';
import { diff } from '../ir/diff.js';
import { makeCorrespondence } from '../ir/correspondence.js';
import {
  differentialSpec,
  runDifferential,
  type DifferentialEvidence,
  type DifferentialInvariant,
} from '../contracts/differential.js';
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

/** The result of a pass that changed nothing. */
function unchanged<S>(pass: Pass<S, any, any>, before: Artifact<S>): PassResult<S> {
  return {
    pass: { id: pass.id, version: pass.version },
    changed: false,
    before,
    artifact: before,
    edits: 0,
    preserved: [],
  };
}

const isNative = <S>(x: unknown): x is NativeResult<S> => !!x && typeof x === 'object' && 'native' in x;

/**
 * IRWB-020-N F2: what follows a native result, shared by `applyPass` and `applyPassSync`: the output artifact
 * (validated by the adapter), the change set against the input's projection, and the total correspondence.
 */
function nativeOutcome<S>(
  pass: Pass<S, any, any>,
  before: Artifact<S>,
  view: IRView<S>,
  produced: NativeResult<S>,
  outputId: string | undefined,
  store: IRStore | undefined,
) {
  const after = createIRArtifact(pass.adapter, outputId ?? before.id, produced.native);
  const afterView = openIR(after, pass.adapter, store);
  const changes = diff(view, afterView);
  const correspondence = makeCorrespondence(
    { artifact: before.id, revision: before.revision },
    { artifact: after.id, revision: after.revision },
    // the projections' entity ids, in order (what `view.entities()` names, without a reference per entity)
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
  // IRWB-020-N F1: the edit is opened on first use, so a pass that returns a native value runs on an adapter that
  // is not rewritable (opening an edit requires `rebuild`)
  let edit: IREdit<S> | undefined;
  let produced: void | NativeResult<S>;
  try {
    produced = await pass.run({
      before,
      view,
      facts: facts as FactValues<N>,
      records: records as PassRunContext<S, N, P>['records'],
      params: options.params as P,
      get edit() {
        return (edit ??= view.beginEdit());
      },
    });
  } catch (e) {
    if (edit?.state === 'open') edit.rollback('pass threw');
    throw e;
  }
  let after: Artifact<S>, changes: ChangeSet, correspondence: EntityCorrespondence, edits: number;
  let report: unknown;
  if (isNative<S>(produced)) {
    if (edit?.state === 'open') edit.rollback('native result');
    ({ after, changes, correspondence, edits, report } = nativeOutcome(
      pass,
      before,
      view,
      produced,
      options.outputId,
      options.store,
    ));
  } else {
    if (!edit) return unchanged(pass, before); // neither a native value nor an edit: nothing changed
    if (edit.state !== 'open') throw new PassError('badResult', `Pass ${pass.id} closed its edit itself`);
    if (edit.operationCount === 0) {
      // IRWB-004: an edit with no operations is the identity (the projection and rebuild are inverses), so preparing
      // it would rebuild, re-create and re-diff the unchanged program only to find nothing changed
      edit.rollback('no operations');
      return unchanged(pass, before);
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

  const undeclared = undeclaredWrites(pass.writes, changes);
  if (undeclared.length)
    throw new PassError('undeclaredWrite', `Pass ${pass.id} changed kinds it did not declare in writes`, {
      undeclared: undeclared.slice(0, 20),
    });

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

export interface SyncApplyOptions<P> {
  readonly params?: P;
  /** Additional contract inputs, e.g. `{ origin: r0 }`. */
  readonly contractInputs?: Readonly<Record<string, unknown>>;
  readonly outputId?: string;
  /** A contract for this application, overriding the pass's own. */
  readonly contract?: TransformationDefinition<Ports, Ports>;
}

/** One checked guarantee of a synchronous application: the invariant and its sampled evidence. */
export interface SyncContractCheck {
  readonly invariant: string;
  readonly evidence: DifferentialEvidence;
}

/**
 * IRWB-020-N F2: a synchronous checked pass application, for a host whose API cannot await (`applyPass` is async
 * because the analysis manager is). Its domain: the pass returns a native result (or nothing) synchronously, has
 * no `needs` and no `preserves`; every clause of the contract is an `ensures` over a sampled differential
 * invariant, which is decided here by `runDifferential` exactly as the invariant's check decides it. Nothing is
 * recorded in an analysis manager: the evidence is returned in `contract` (an array of `SyncContractCheck`). A
 * rejection throws the same `PassError('contractRejected')` as `applyPass`. There is no `store`: publishing a
 * native result's revision through a store is the async path's business.
 */
export function applyPassSync<S, N extends Needs, P>(
  pass: Pass<S, N, P>,
  before: Artifact<S>,
  options: SyncApplyOptions<P> = {},
): PassResult<S> {
  if (Object.keys(pass.needs ?? {}).length || pass.preserves?.length)
    throw new PassError('badResult', `Pass ${pass.id} declares needs or preserves; apply it with applyPass`);
  const gate = options.contract ?? pass.contract;
  const checks: {
    invariant: DifferentialInvariant<Ports>;
    bindings: Readonly<Record<string, { from: string; port: string }>>;
  }[] = [];
  if (gate) {
    const other =
      gate.requires.length + gate.preserves.length + gate.establishes.length + gate.effects.length;
    if (other || gate.correspondence.length)
      throw new PassError(
        'badResult',
        `Contract ${gate.id} has clauses applyPassSync cannot check; use applyPass`,
      );
    for (const c of gate.ensures) {
      if (!('invariant' in c) || (c.invariant as { method?: string }).method !== 'sampled')
        throw new PassError(
          'badResult',
          `Contract ${gate.id}: applyPassSync checks only differential invariants`,
        );
      checks.push({ invariant: c.invariant as DifferentialInvariant<Ports>, bindings: c.bindings });
    }
  }
  const view = openIR(before, pass.adapter);
  const produced = pass.run({
    before,
    view,
    facts: {} as FactValues<N>,
    records: {} as PassRunContext<S, N, P>['records'],
    params: options.params as P,
    get edit(): IREdit<S> {
      throw new PassError('badResult', `Pass ${pass.id}: applyPassSync passes return a native result`);
    },
  });
  if (produced && typeof (produced as { then?: unknown }).then === 'function')
    throw new PassError('badResult', `Pass ${pass.id} is asynchronous; apply it with applyPass`);
  if (!isNative<S>(produced)) return unchanged(pass, before);
  const { after, changes, correspondence, edits, report } = nativeOutcome(
    pass,
    before,
    view,
    produced,
    options.outputId,
    undefined,
  );
  if (after.revision === before.revision && !changes.entities.length && !changes.relations.length)
    return unchanged(pass, before);
  const undeclared = undeclaredWrites(pass.writes, changes);
  if (undeclared.length)
    throw new PassError('undeclaredWrite', `Pass ${pass.id} changed kinds it did not declare in writes`, {
      undeclared: undeclared.slice(0, 20),
    });
  const ports: Record<string, Record<string, unknown>> = {
    inputs: { input: before, ...(options.contractInputs ?? {}) },
    outputs: { output: after },
  };
  const contract: SyncContractCheck[] = [];
  for (const { invariant, bindings } of checks) {
    const bound = Object.fromEntries(
      Object.entries(bindings).map(([name, sel]) => {
        const value = ports[sel.from]?.[sel.port];
        if (value === undefined)
          throw new PassError('badResult', `Contract port ${sel.from}.${sel.port} is not supplied`);
        return [name, value];
      }),
    );
    const evidence = runDifferential(differentialSpec(invariant), bound as never);
    contract.push({ invariant: invariant.id, evidence });
    if (evidence.status !== 'agree')
      throw new PassError(
        'contractRejected',
        `Pass ${pass.id} output rejected: ${invariant.id}: ${evidence.disagree}/${evidence.total} sampled cases disagree` +
          (evidence.counterexamples.length ? ` (${evidence.counterexamples[0].reason})` : ''),
        { checks: contract },
      );
  }
  return {
    pass: { id: pass.id, version: pass.version },
    changed: true,
    before,
    artifact: after,
    changes,
    correspondence,
    edits,
    preserved: [],
    contract,
    report,
  };
}
