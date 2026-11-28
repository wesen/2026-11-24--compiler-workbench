/**
 * IRWB-051-C, IRWB-052 (IRWB-039 phase 3): the transformation type, and the one pass runner with its two drivers.
 *
 * A transformation is versioned code that turns one artifact revision into the next. It declares:
 *   - `needs`: analyses whose results it reads, computed for the exact input through the analysis manager;
 *   - `writes`: the entity and relation kinds it may change; any other change is `undeclaredWrite`;
 *   - `relation`: how its output relates to its input, `'exact'` or `'tolerance'` (within a bound the domain's
 *     `ensures` check defines). The gate reads it from the declaration; no caller chooses it by the pass's name;
 *   - `eligible`: whether it applies to this revision with these parameters and facts;
 *   - `prepare`: the candidate: a native value with correspondence entries, or operations on `ctx.edit`;
 *   - `obligations`: `requires` (checks on the input), `ensures` (checks on the candidate: a function, or a v6
 *     transformation contract) and `preserves` (analyses whose results it claims survive).
 *
 * `runTransformation` is the runner, written once as a generator of steps (core/steps.ts). It delegates to
 * the analysis manager's own steps for `needs`, `preserves` and a contract, so both drivers use the manager's
 * cache and records. `applyTransformation` drives it asynchronously and `applyTransformationSync` synchronously;
 * the synchronous driver stops only when a step actually answers with a promise (an asynchronous analysis,
 * `prepare` or obligation).
 *
 * The lifecycle: needs, requires, eligible, prepare, unchanged?, writes, ensures, preserves, publish. Nothing is
 * published unless all of it succeeds (F33; the helpers are in define-pass.ts).
 *
 * `definePass`, `applyPass` and `applyNativePassSync` are the earlier spellings, kept as a constructor and two
 * wrappers of this runner (see each).
 *
 * IRWB-061 (K1: ports in, ports out; a same-IR pass is the special case). A transformation may map one IR to
 * another: `transformation({ from, to, ... })` is its cross form (`CrossTransformation`), run by the same runner
 * and drivers. Where the two forms differ:
 *   - the candidate is `{ output, outputId }`, wrapped with the output IR's adapter; there is no edit and no diff,
 *     so `prepare` supplies the correspondence (entries or a derivation), completed over both entity lists;
 *   - `writes` and `preserves` are not declared: a change set and a preserved analysis are notions of one IR;
 *   - a contract among `ensures` sees the application through `bind`, which names its ports;
 *   - publication opens the output's lineage, or advances it from its head.
 * An application with `options.pending` runs no `ensures`, records each as pending and publishes nothing: the
 * output exists and its check is still owed (K1's `pending` outcome).
 */
import type { Artifact } from '../core/types.js';
import { canonical } from '../core/data.js';
import { openIR } from '../ir/index.js';
import type { Derivation } from '../ir/derivation.js';
import type { ChangeSet, EntityCorrespondence, IRAdapter, IREdit, IRStore, IRView } from '../ir/index.js';
import type { AnalysisManager } from '../contracts/analysis-manager.js';
import { wait, driveAsync, driveSync, type Steps } from '../core/steps.js';
import type {
  AnalysisDefinition,
  AnalysisRecord,
  CheckResult,
  IRType,
  PreparedTransformation,
  TransformationDefinition,
} from '../contracts/types.js';
import {
  discardEvidence,
  enforceWrites,
  PassError,
  prepareCross,
  prepareNative,
  publishAccepted,
  semanticCorrespondence,
  type CrossResult,
  type FactValues,
  type NativeResult,
  type Needs,
  type PassResult,
  type PassRunContext,
  type PassSpec,
  type PreservationOutcome,
} from './define-pass.js';

/** How the output relates to the input: bit for bit, or within a bound that the domain's `ensures` check defines. */
export type Relation = 'exact' | 'tolerance';

/** Values an application supplies beside the input (e.g. `origin`: r0); obligations and contracts read them. */
export type ApplicationInputs = Readonly<Record<string, unknown>>;

export interface EligibleContext<S, N extends Needs, P> {
  readonly before: Artifact<S>;
  readonly view: IRView<S>;
  readonly facts: FactValues<N>;
  readonly params: P;
}
export interface Requires<S, N extends Needs, P> {
  readonly id: string;
  check(
    ctx: EligibleContext<S, N, P> & { readonly inputs: ApplicationInputs },
  ): CheckResult | Promise<CheckResult>;
}
/** `Out` is the candidate's IR; it differs from `S` only for a cross-IR transformation. */
export interface EnsuresContext<S, P, Out = S> {
  readonly before: Artifact<S>;
  readonly candidate: Artifact<Out>;
  readonly relation: Relation;
  readonly params: P;
  readonly inputs: ApplicationInputs;
}
export interface EnsuresCheck<S, P, Out = S> {
  readonly id: string;
  check(ctx: EnsuresContext<S, P, Out>): CheckResult | Promise<CheckResult>;
}
/** A check on the candidate, or a v6 contract verified by the analysis manager and recorded there. */
export type Ensures<S, P, Out = S> = EnsuresCheck<S, P, Out> | TransformationDefinition<any, any>;

export interface Obligations<S, N extends Needs, P> {
  readonly requires?: readonly Requires<S, N, P>[];
  readonly ensures?: readonly Ensures<S, P>[];
  readonly preserves?: readonly AnalysisDefinition<any, any>[];
}

export interface TransformationSpec<S, N extends Needs, P = unknown> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly ir: PassSpec<S, N, P>['ir'];
  readonly adapter: PassSpec<S, N, P>['adapter'];
  readonly needs?: N;
  readonly writes: PassSpec<S, N, P>['writes'];
  readonly relation: Relation;
  eligible?(ctx: EligibleContext<S, N, P>): CheckResult;
  prepare(ctx: PassRunContext<S, N, P>): void | NativeResult<S> | Promise<void | NativeResult<S>>;
  readonly obligations?: Obligations<S, N, P>;
}

export type Transformation<S, N extends Needs = Needs, P = unknown> = Readonly<
  TransformationSpec<S, N, P>
> & {
  readonly needs: N;
  readonly obligations: Required<Obligations<S, N, P>>;
  readonly category: 'pass';
};
/** A pass is a transformation; the name is kept for the code that says "pass". */
export type Pass<S, N extends Needs = Needs, P = unknown> = Transformation<S, N, P>;

/** One side of a cross-IR transformation: the IR kind, and the adapter that presents its values as entities. */
export interface IRSide<T> {
  readonly ir: IRType<T>;
  readonly adapter: IRAdapter<T>;
}
/** The port values a contract among `ensures` is verified on, by port name. */
export interface ContractPorts {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<Record<string, unknown>>;
}
/**
 * IRWB-061: a transformation from one IR to another (a lowering). Beside the fields it shares with a same-IR
 * transformation it declares `from` and `to`, and optionally `bind`: the ports of a contract among its `ensures`
 * (default `{ input: before, ...inputs }` and `{ output: candidate }`, as for a same-IR pass).
 */
export interface CrossSpec<In, Out, N extends Needs, P = unknown> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly from: IRSide<In>;
  readonly to: IRSide<Out>;
  readonly needs?: N;
  readonly relation: Relation;
  eligible?(ctx: EligibleContext<In, N, P>): CheckResult;
  prepare(ctx: Omit<PassRunContext<In, N, P>, 'edit'>): CrossResult<Out> | Promise<CrossResult<Out>>;
  bind?(ctx: EnsuresContext<In, P, Out>): ContractPorts;
  readonly obligations?: {
    readonly requires?: readonly Requires<In, N, P>[];
    readonly ensures?: readonly Ensures<In, P, Out>[];
  };
}
export type CrossTransformation<In, Out, N extends Needs = Needs, P = unknown> = Readonly<
  CrossSpec<In, Out, N, P>
> & {
  readonly needs: N;
  readonly obligations: {
    readonly requires: readonly Requires<In, N, P>[];
    readonly ensures: readonly Ensures<In, P, Out>[];
  };
  readonly category: 'cross';
};
export const isCross = (t: { readonly category?: string }): t is CrossTransformation<any, any, any, any> =>
  t.category === 'cross';

export function transformation<In, Out, N extends Needs = {}, P = unknown>(
  spec: CrossSpec<In, Out, N, P>,
): CrossTransformation<In, Out, N, P>;
export function transformation<S, N extends Needs = {}, P = unknown>(
  spec: TransformationSpec<S, N, P>,
): Transformation<S, N, P>;
export function transformation(
  spec: TransformationSpec<any, any, any> | CrossSpec<any, any, any, any>,
): Transformation<any, any, any> | CrossTransformation<any, any, any, any> {
  if (!spec.id || !spec.version) throw new Error('A pass needs an id and a version');
  if (typeof spec.prepare !== 'function') throw new Error(`Pass ${spec.id} needs prepare`);
  if (spec.eligible !== undefined && typeof spec.eligible !== 'function')
    throw new Error(`Pass ${spec.id}: eligible must be a function`);
  if (spec.relation !== 'exact' && spec.relation !== 'tolerance')
    throw new Error(`Pass ${spec.id} must declare its relation: 'exact' or 'tolerance'`);
  if ('from' in spec || 'to' in spec) {
    const cross = spec as CrossSpec<any, any, any, any>;
    if (!cross.from?.adapter || !cross.to?.adapter)
      throw new Error(`Pass ${spec.id} must declare from and to, each { ir, adapter }`);
    for (const k of ['ir', 'adapter', 'writes'])
      if (k in spec) throw new Error(`Pass ${spec.id}: a cross-IR transformation does not declare ${k}`);
    if ((spec.obligations as { preserves?: unknown } | undefined)?.preserves)
      throw new Error(`Pass ${spec.id}: a cross-IR transformation cannot preserve an analysis`);
    return Object.freeze({
      ...cross,
      needs: cross.needs ?? {},
      obligations: {
        requires: cross.obligations?.requires ?? [],
        ensures: cross.obligations?.ensures ?? [],
      },
      category: 'cross' as const,
    });
  }
  spec = spec as TransformationSpec<any, any, any>;
  if (!spec.writes || !Array.isArray(spec.writes.entities) || !Array.isArray(spec.writes.relations))
    throw new Error(`Pass ${spec.id} must declare writes { entities, relations }`);
  return Object.freeze({
    ...spec,
    needs: spec.needs ?? {},
    obligations: {
      requires: spec.obligations?.requires ?? [],
      ensures: spec.obligations?.ensures ?? [],
      preserves: spec.obligations?.preserves ?? [],
    },
    category: 'pass' as const,
  });
}

/**
 * A pass written in the earlier spelling (`PassSpec`), or a transformation with fields of that spelling laid over
 * it (`{ ...pass, run }`, `{ ...pass, preserves }`, as tests and probes build variants). Each earlier field, when
 * present, replaces its counterpart: `run` is `prepare`, `legal` is `eligible`, `preserves` is
 * `obligations.preserves`, and `contract` is the one `ensures` obligation. An undeclared relation is `'exact'`.
 */
export type PassLike<S, N extends Needs = Needs, P = unknown> =
  | Transformation<S, N, P>
  | (Partial<TransformationSpec<S, N, P>> & PassSpec<S, N, P>);

const EARLIER = ['run', 'legal', 'preserves', 'contract'] as const;
export function asTransformation<S, N extends Needs, P>(pass: PassLike<S, N, P>): Transformation<S, N, P> {
  if (!EARLIER.some(k => k in pass) && isTransformation(pass as Transformation<S, N, P>))
    return pass as Transformation<S, N, P>;
  const { run, legal, preserves, contract, ...rest } = pass as Partial<TransformationSpec<S, N, P>> &
    PassSpec<S, N, P>;
  if (legal !== undefined && typeof legal !== 'function')
    throw new Error(`Pass ${rest.id}: legal must be a function`);
  if (run === undefined && rest.prepare === undefined) throw new Error(`Pass ${rest.id} needs run`);
  return transformation<S, N, P>({
    ...rest,
    relation: rest.relation ?? 'exact',
    prepare: run ?? rest.prepare!,
    eligible: legal ?? rest.eligible,
    obligations: {
      requires: rest.obligations?.requires,
      ensures: contract ? [contract] : rest.obligations?.ensures,
      preserves: preserves ?? rest.obligations?.preserves,
    },
  });
}

/**
 * The constructor for the earlier spelling. Kept because the schedule passes (src/tensor/schedule.ts) and about
 * 13 test sites are written in it; what it returns is a transformation like any other.
 */
export function definePass<S, N extends Needs = {}, P = unknown>(
  spec: PassSpec<S, N, P>,
): Transformation<S, N, P> {
  return asTransformation<S, N, P>(spec);
}

export const isTransformation = <S, N extends Needs, P>(pass: unknown): pass is Transformation<S, N, P> =>
  typeof (pass as Partial<Transformation<S, N, P>> | undefined)?.prepare === 'function' &&
  typeof (pass as Partial<Transformation<S, N, P>>).relation === 'string' &&
  Array.isArray((pass as Partial<Transformation<S, N, P>>).obligations?.ensures);

export interface TransformationOptions<S, P, Out = S> {
  /** Needed when the transformation declares `needs` or `preserves`, or an `ensures` is a contract. */
  readonly manager?: AnalysisManager;
  readonly store?: IRStore;
  readonly params?: P;
  readonly inputs?: ApplicationInputs;
  /**
   * Obligations of this application, after the transformation's own (e.g. a project's optimization contract). One
   * application verifies at most one contract: F33 commits one prepared execution at the publication point.
   */
  readonly ensures?: readonly Ensures<S, P, Out>[];
  readonly outputId?: string;
  /**
   * IRWB-061: produce the candidate and leave its checks owed. No `ensures` obligation and no preservation claim
   * runs; each `ensures` is recorded in the result as pending with this reason, and nothing is published (F33: a
   * candidate is visible only after every obligation has passed), so a store may not be given.
   */
  readonly pending?: { readonly reason: string };
  /** As `ApplyOptions.auditPreservation`: check every claim, computing the fact on the input when it is absent. */
  readonly auditPreservation?: boolean;
}

export interface ObligationEvidence {
  readonly phase: 'requires' | 'ensures';
  readonly id: string;
  readonly evidence: unknown;
  /** Present when the obligation was not run (`TransformationOptions.pending`). */
  readonly status?: 'pending';
}
export interface TransformationResult<S, Out = S> extends PassResult<S, Out> {
  readonly relation: Relation;
  readonly obligations: readonly ObligationEvidence[];
  /** The reason the application's `ensures` were left pending, when they were. */
  readonly pending?: string;
}

const isContract = (e: Ensures<any, any>): e is TransformationDefinition<any, any> =>
  (e as { category?: string }).category === 'transformation';

/** The runner. Drive it with `applyTransformation` or `applyTransformationSync`. */
export function runTransformation<S, N extends Needs, P>(
  t: Transformation<S, N, P>,
  before: Artifact<S>,
  options?: TransformationOptions<S, P>,
): Steps<TransformationResult<S>>;
export function runTransformation<In, Out, N extends Needs, P>(
  t: CrossTransformation<In, Out, N, P>,
  before: Artifact<In>,
  options?: TransformationOptions<In, P, Out>,
): Steps<TransformationResult<In, Out>>;
export function* runTransformation<S, N extends Needs, P>(
  t: Transformation<S, N, P> | CrossTransformation<S, any, N, P>,
  before: Artifact<S>,
  options: TransformationOptions<S, P, any> = {},
): Steps<TransformationResult<S, any>> {
  const params = options.params as P,
    inputs = options.inputs ?? {};
  const cross = isCross(t) ? t : undefined,
    same = isCross(t) ? undefined : t;
  const pending = options.pending;
  const needs = Object.entries(t.needs ?? {}),
    ensures: readonly Ensures<S, P, any>[] = [...t.obligations.ensures, ...(options.ensures ?? [])],
    preserves = same?.obligations.preserves ?? [];
  const contracts = ensures.filter(isContract);
  if (contracts.length > 1)
    throw new PassError('badResult', `Pass ${t.id}: one application takes at most one contract`);
  if (pending && options.store)
    throw new PassError(
      'badResult',
      `Pass ${t.id}: a pending application publishes nothing; give it no store`,
    );
  if (!options.manager && (needs.length || (!pending && (preserves.length || contracts.length))))
    throw new PassError('badResult', `Pass ${t.id} needs an analysis manager`);
  const manager = options.manager as AnalysisManager;
  const view = openIR(before, cross ? cross.from.adapter : same!.adapter, options.store);
  // the generation a head advance is checked against: what the caller's store held when the input was opened
  let generation = options.store?.generation(before.id);
  const base = { pass: { id: t.id, version: t.version }, before, relation: t.relation };
  const evidence: ObligationEvidence[] = [];
  const unchanged = (): TransformationResult<S> => ({
    ...base,
    changed: false,
    artifact: before,
    edits: 0,
    preserved: [],
    obligations: evidence,
  });

  // needs: the manager's cache and records, under either driver
  const facts: Record<string, unknown> = {},
    records: Record<string, AnalysisRecord<unknown>> = {};
  for (const [name, def] of needs) {
    const record = yield* manager.analyseSteps(def, before);
    records[name] = record;
    facts[name] = record.value;
  }

  // requires, then eligible: a refusal is `illegal`, and nothing was prepared
  const refuse = (verdict: CheckResult | undefined, what = '') => {
    if (verdict?.ok !== true)
      throw new PassError(
        'illegal',
        `Pass ${t.id}: ${what}${verdict?.reason ?? 'not applicable'}`,
        verdict?.evidence,
      );
  };
  const context = { before, view, facts: facts as FactValues<N>, params };
  for (const r of t.obligations.requires) {
    const verdict = yield* wait(r.check({ ...context, inputs }));
    refuse(verdict, `requires ${r.id}: `);
    evidence.push({ phase: 'requires', id: r.id, evidence: verdict.evidence });
  }
  if (t.eligible) refuse(t.eligible(context));

  // prepare: a native result, or operations on the edit (opened on its first read: IRWB-019 F13); across IRs,
  // the output's value (no edit: an edit is an operation on one IR)
  let edit: IREdit<S> | undefined;
  let produced: void | NativeResult<S> = undefined;
  let after: Artifact<any>, changes: ChangeSet | undefined, correspondence: EntityCorrespondence;
  let edits: number, report: unknown, derivation: Derivation | undefined;
  // the head the accepted revision replaces (see `publishAccepted`)
  let head: Artifact | undefined;
  const recordsOf = records as PassRunContext<S, N, P>['records'];
  if (cross) {
    const out = yield* wait(cross.prepare({ ...context, records: recordsOf }));
    ({ after, correspondence, edits, derivation } = prepareCross(
      cross,
      view,
      out,
      options.outputId ?? out?.outputId,
    ));
    report = out.report;
    const store = options.store;
    if (store?.revisions(after.id).length) {
      head = store.head(after.id);
      generation = store.generation(after.id);
    }
  } else {
    let ran = false;
    try {
      produced = yield* wait(
        same!.prepare({
          ...context,
          records: recordsOf,
          get edit(): IREdit<S> {
            return (edit ??= view.beginEdit());
          },
        }),
      );
      ran = true;
    } finally {
      if (!ran && edit?.state === 'open') edit.rollback('pass threw');
    }
  }
  if (cross) {
    // the candidate is complete: no change set, nothing to compare for "unchanged", no declared writes
  } else if (produced && typeof produced === 'object' && 'native' in produced) {
    if (edit?.state === 'open') edit.rollback('native result');
    ({ after, changes, correspondence, edits, derivation } = prepareNative(
      same!,
      view,
      produced,
      options.outputId ?? before.id,
    ));
    report = produced.report;
  } else {
    if (edit && edit.state !== 'open')
      throw new PassError('badResult', `Pass ${t.id} closed its edit itself`);
    if (!edit || edit.operationCount === 0) {
      edit?.rollback('no operations');
      return unchanged();
    }
    const prepared = edit.prepare();
    after = prepared.artifact;
    changes = prepared.changes;
    correspondence = prepared.correspondence;
    edits = changes.operations.filter(o => o.kind !== 'correspond').length;
    edit.rollback('the runner publishes revisions itself');
  }
  if (same && changes) {
    if (after!.revision === before.revision && !changes.entities.length && !changes.relations.length)
      return unchanged();
    enforceWrites(same, changes);
    if (after!.id === before.id) head = before;
  }
  after = after!;
  correspondence = correspondence!;
  edits = edits!;

  // pending: the candidate, with every `ensures` recorded as owed; nothing is checked, committed or published
  if (pending) {
    for (const e of ensures)
      evidence.push({ phase: 'ensures', id: e.id, evidence: { pending: pending.reason }, status: 'pending' });
    return {
      ...base,
      changed: true,
      artifact: after,
      ...(changes ? { changes } : {}),
      correspondence,
      ...(derivation ? { derivation } : {}),
      edits,
      preserved: [],
      report,
      obligations: evidence,
      pending: pending.reason,
    };
  }

  // a contract's ports: the transformation's own binding, or `input` / `output` beside the application's inputs
  const ports = (): ContractPorts =>
    cross?.bind?.({ before, candidate: after, relation: t.relation, params, inputs }) ?? {
      inputs: { input: before, ...inputs },
      outputs: { output: after },
    };
  // across IRs a port type may declare fewer entities than its adapter lists: the record is restricted to them
  const declared = (type: unknown, artifact: unknown): readonly string[] | undefined =>
    (type as IRType<unknown> | undefined)?.entities?.((artifact as Artifact).value);

  // ensures, preserves, then the one publication point. Any exit before it leaves nothing about the candidate:
  // the contract's evidence is rolled back and the preservation checks' analyses of the candidate are invalidated
  // (IRWB-039 lane 0, after IRWB-045-B). That cleanup is in `finally`, because a synchronous driver abandons the
  // run at an asynchronous step with `return()`, which runs no `catch` (IRWB-052; the `catch` only keeps the reason).
  let contract: PreparedTransformation | undefined;
  let verdict: CheckResult | undefined;
  const preserved: PreservationOutcome[] = [];
  let published = false,
    claimsChecked = false,
    reason = `Pass ${t.id} was abandoned at an asynchronous step`;
  try {
    for (const e of ensures) {
      if (isContract(e)) {
        try {
          // F33: deferred, so the evidence is committed at the publication boundary below and not before it
          const bound = ports();
          contract = yield* manager.verifyTransformationSteps(
            bound.inputs as never,
            bound.outputs as never,
            e,
            e.correspondence.length
              ? e.correspondence.map(req =>
                  semanticCorrespondence(
                    correspondence,
                    req.id,
                    req.relation,
                    cross && {
                      source: declared(e.inputs[req.from], bound.inputs[req.from]),
                      target: declared(e.outputs[req.to], bound.outputs[req.to]),
                    },
                  ),
                )
              : [semanticCorrespondence(correspondence)],
            { deferCommit: true },
          );
        } catch (error) {
          const rejected = new PassError(
            'contractRejected',
            `Pass ${t.id} output rejected: ${(error as Error).message}`,
            {
              cause: String(error),
            },
          );
          // the manager's own error (a ContractError with its code), for a caller that tells its kinds apart
          rejected.cause = error;
          throw rejected;
        }
        evidence.push({ phase: 'ensures', id: e.id, evidence: contract.execution.checks });
      } else {
        verdict = yield* wait(e.check({ before, candidate: after, relation: t.relation, params, inputs }));
        if (verdict?.ok !== true)
          throw new PassError('contractRejected', verdict?.reason ?? 'Candidate rejected', verdict?.evidence);
        evidence.push({ phase: 'ensures', id: e.id, evidence: verdict.evidence });
      }
    }
    claimsChecked = true;
    for (const def of preserves) {
      if (!manager.hasAnalysis(def, before)) {
        if (!options.auditPreservation) continue; // nothing to keep
        yield* manager.analyseSteps(def, before);
      }
      let transferred: AnalysisRecord<unknown> | undefined;
      try {
        transferred = yield* manager.preserveSteps(
          def,
          before,
          after,
          semanticCorrespondence(correspondence),
        );
      } catch {
        // the transfer rule refused: the claim can still hold, so recompute and compare
      }
      if (transferred) {
        preserved.push({ analysis: def.id, how: 'transferred', evidence: transferred.transfer?.evidence });
        continue;
      }
      const old = yield* manager.analyseSteps(def, before),
        fresh = yield* manager.analyseSteps(def, after);
      if (canonical(old.value) !== canonical(fresh.value))
        throw new PassError('preserveViolated', `Pass ${t.id} claims to preserve ${def.id}, but it changed`, {
          analysis: def.id,
        });
      preserved.push({ analysis: def.id, how: 'confirmed-by-recompute', evidence: { equalValue: true } });
    }
    publishAccepted(t, options.store, head, after, contract, generation);
    published = true;
  } catch (error) {
    reason = `Pass ${t.id} rejected: ${(error as Error).message}`;
    throw error;
  } finally {
    if (!published) {
      discardEvidence(contract, reason);
      if (claimsChecked)
        for (const def of preserves)
          try {
            manager.invalidate(def, after, `Pass ${t.id} was not accepted`);
          } catch {
            // cleanup must not mask the rejection
          }
    }
  }
  return {
    ...base,
    changed: true,
    artifact: after,
    ...(changes ? { changes } : {}),
    correspondence,
    ...(derivation ? { derivation } : {}),
    edits,
    preserved,
    contract: contract ?? verdict,
    report,
    obligations: evidence,
  };
}

/** The asynchronous driver: every analysis, `prepare` and obligation may answer with a promise. */
export function applyTransformation<S, N extends Needs, P>(
  t: Transformation<S, N, P>,
  before: Artifact<S>,
  options?: TransformationOptions<S, P>,
): Promise<TransformationResult<S>>;
export function applyTransformation<In, Out, N extends Needs, P>(
  t: CrossTransformation<In, Out, N, P>,
  before: Artifact<In>,
  options?: TransformationOptions<In, P, Out>,
): Promise<TransformationResult<In, Out>>;
export function applyTransformation(
  t: Transformation<any, any, any> | CrossTransformation<any, any, any, any>,
  before: Artifact<any>,
  options?: TransformationOptions<any, any, any>,
): Promise<TransformationResult<any, any>> {
  return driveAsync(runTransformation(t as Transformation<any, any, any>, before, options));
}

/** The synchronous driver: the same runner; it throws when a step answers with a promise. */
export function applyTransformationSync<S, N extends Needs, P>(
  t: Transformation<S, N, P>,
  before: Artifact<S>,
  options?: TransformationOptions<S, P>,
): TransformationResult<S>;
export function applyTransformationSync<In, Out, N extends Needs, P>(
  t: CrossTransformation<In, Out, N, P>,
  before: Artifact<In>,
  options?: TransformationOptions<In, P, Out>,
): TransformationResult<In, Out>;
export function applyTransformationSync(
  t: Transformation<any, any, any> | CrossTransformation<any, any, any, any>,
  before: Artifact<any>,
  options?: TransformationOptions<any, any, any>,
): TransformationResult<any, any> {
  return driveSync(runTransformation(t as Transformation<any, any, any>, before, options), `Pass ${t.id}`);
}

/**
 * The transformation with `gate` as its one `ensures` obligation, in place of its own. The earlier entry points
 * (`applyPass`'s `contract`, `applyNativePassSync`'s gate, the bridge's `contract`) each name the gate of an
 * application this way; `TransformationOptions.ensures` adds obligations instead.
 */
export function gatedBy<S, N extends Needs, P>(
  t: Transformation<S, N, P>,
  gate: Ensures<S, P> | undefined,
): Transformation<S, N, P> {
  return gate ? { ...t, obligations: { ...t.obligations, ensures: [gate] } } : t;
}

/** `applyPass`'s options: `TransformationOptions` with the gate and the inputs under their earlier names. */
export interface ApplyOptions<P> extends Omit<TransformationOptions<any, P>, 'inputs' | 'ensures'> {
  readonly manager: AnalysisManager;
  /** The application's inputs beside `input`, e.g. `{ origin: r0 }` for a check against the original program. */
  readonly contractInputs?: ApplicationInputs;
  /** The gate of this application, in place of the pass's own (e.g. a contract with a project's case inputs). */
  readonly contract?: TransformationDefinition<any, any>;
}
/**
 * `applyTransformation` under its earlier name and options, for a pass in either spelling. Kept as a wrapper
 * because tests and tools call it at 39 sites; the framework's and the domains' own code calls
 * `applyTransformation`.
 */
export function applyPass<S, N extends Needs, P>(
  pass: PassLike<S, N, P>,
  before: Artifact<S>,
  { contract, contractInputs, ...options }: ApplyOptions<P>,
): Promise<TransformationResult<S>> {
  return applyTransformation(gatedBy(asTransformation(pass), contract), before, {
    ...options,
    inputs: contractInputs,
  });
}

/**
 * `applyTransformationSync` with the caller's gate as the one `ensures` obligation, in place of the pass's own.
 * Kept as a wrapper because the schedule passes' caller (src/tensor/schedule.ts) hands its gate over this way.
 * The runner is the same one, so a pass with needs, preservation claims or an edit runs here too when the caller
 * could give it a manager; this signature has no place for one, and such a pass is refused for that reason.
 */
export function applyNativePassSync<S, P>(
  pass: PassLike<S, {}, P>,
  before: Artifact<S>,
  gate: (before: Artifact<S>, candidate: Artifact<S>) => CheckResult,
  params?: P,
): TransformationResult<S> {
  const check = (c: EnsuresContext<S, P>) => gate(c.before, c.candidate);
  return applyTransformationSync(gatedBy(asTransformation(pass), { id: 'gate', check }), before, { params });
}
