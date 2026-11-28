/**
 * IRWB-051-C (a spike for IRWB-039 phase 3): a transformation type, and one runner for it with two drivers.
 *
 * A transformation is a pass that declares, besides `needs` and `writes`:
 *   - `relation`: how its output relates to its input, `'exact'` or `'tolerance'` (within a bound the domain's
 *     `ensures` check defines). The gate reads it from the declaration; no caller chooses it by the pass's name;
 *   - `eligible`: whether it applies to this revision with these parameters and facts (today's `legal`);
 *   - `prepare`: the candidate (today's `run`);
 *   - `obligations`: `requires` (checks on the input), `ensures` (checks on the candidate: a function, or a v6
 *     transformation contract) and `preserves` (analyses whose results it claims survive).
 *
 * `runTransformation` is the runner, written once as a generator of steps (contracts/steps.ts). It delegates to
 * the analysis manager's own steps for `needs` and `preserves`, so both drivers use the manager's cache and
 * records. `applyTransformation` drives it asynchronously and `applyTransformationSync` synchronously; the
 * synchronous driver stops only when a step actually answers with a promise (an asynchronous analysis, `prepare`
 * or obligation; a v6 contract always does).
 *
 * The lifecycle: needs, requires, eligible, prepare, unchanged?, writes, ensures, preserves, publish. Candidate
 * construction, the write check, F33's publication boundary and the cleanup after a rejection are `applyPass`'s
 * own helpers.
 */
import type { Artifact } from '../core/types.js';
import { canonical } from '../core/data.js';
import { openIR } from '../ir/index.js';
import type { ChangeSet, EntityCorrespondence, IREdit, IRStore, IRView } from '../ir/index.js';
import type { AnalysisManager } from '../contracts/analysis-manager.js';
import { wait, driveAsync, driveSync, type Steps } from '../contracts/steps.js';
import type {
  AnalysisDefinition,
  AnalysisRecord,
  CheckResult,
  PreparedTransformation,
  TransformationDefinition,
} from '../contracts/types.js';
import {
  discardEvidence,
  enforceWrites,
  PassError,
  prepareNative,
  publishAccepted,
  semanticCorrespondence,
  type FactValues,
  type NativeResult,
  type Needs,
  type Pass,
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
export interface EnsuresContext<S, P> {
  readonly before: Artifact<S>;
  readonly candidate: Artifact<S>;
  readonly relation: Relation;
  readonly params: P;
  readonly inputs: ApplicationInputs;
}
export interface EnsuresCheck<S, P> {
  readonly id: string;
  check(ctx: EnsuresContext<S, P>): CheckResult | Promise<CheckResult>;
}
/** A check on the candidate, or a v6 contract verified by the analysis manager (asynchronous driver only). */
export type Ensures<S, P> = EnsuresCheck<S, P> | TransformationDefinition<any, any>;

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

/**
 * A transformation, which is also a `Pass`: `run`, `legal` and `preserves` are a view of `prepare`, `eligible`
 * and `obligations.preserves` for `applyPass` and `applyNativePassSync`, so a ported pass keeps working with every
 * existing caller. (The view's `legal` gives `eligible` no facts; the migration deletes the view.)
 */
export type Transformation<S, N extends Needs = Needs, P = unknown> = Pass<S, N, P> &
  Readonly<TransformationSpec<S, N, P>> & { readonly obligations: Required<Obligations<S, N, P>> };

export function transformation<S, N extends Needs = {}, P = unknown>(
  spec: TransformationSpec<S, N, P>,
): Transformation<S, N, P> {
  if (!spec.id || !spec.version) throw new Error('A transformation needs an id and a version');
  if (typeof spec.prepare !== 'function') throw new Error(`Transformation ${spec.id} needs prepare`);
  if (spec.relation !== 'exact' && spec.relation !== 'tolerance')
    throw new Error(`Transformation ${spec.id} must declare its relation: 'exact' or 'tolerance'`);
  if (!spec.writes || !Array.isArray(spec.writes.entities) || !Array.isArray(spec.writes.relations))
    throw new Error(`Transformation ${spec.id} must declare writes { entities, relations }`);
  const obligations = {
    requires: spec.obligations?.requires ?? [],
    ensures: spec.obligations?.ensures ?? [],
    preserves: spec.obligations?.preserves ?? [],
  };
  const eligible = spec.eligible;
  return Object.freeze({
    ...spec,
    needs: spec.needs ?? ({} as N),
    obligations,
    category: 'pass' as const,
    run: spec.prepare,
    preserves: obligations.preserves,
    ...(eligible
      ? {
          legal: (ctx: Omit<EligibleContext<S, N, P>, 'facts'>) =>
            eligible({ ...ctx, facts: {} as FactValues<N> }),
        }
      : {}),
  });
}

export const isTransformation = <S, N extends Needs, P>(
  pass: Pass<S, N, P>,
): pass is Transformation<S, N, P> =>
  typeof (pass as Partial<Transformation<S, N, P>>).prepare === 'function' &&
  typeof (pass as Partial<Transformation<S, N, P>>).relation === 'string';

export interface TransformationOptions<S, P> {
  /** Needed when the transformation declares `needs` or `preserves`, or an `ensures` is a contract. */
  readonly manager?: AnalysisManager;
  readonly store?: IRStore;
  readonly params?: P;
  readonly inputs?: ApplicationInputs;
  /** Obligations of this application, after the transformation's own (e.g. a project's optimization contract). */
  readonly ensures?: readonly Ensures<S, P>[];
  readonly outputId?: string;
  /** As `ApplyOptions.auditPreservation`: check every claim, computing the fact on the input when it is absent. */
  readonly auditPreservation?: boolean;
}

export interface ObligationEvidence {
  readonly phase: 'requires' | 'ensures';
  readonly id: string;
  readonly evidence: unknown;
}
export interface TransformationResult<S> extends PassResult<S> {
  readonly relation: Relation;
  readonly obligations: readonly ObligationEvidence[];
}

const isContract = (e: Ensures<any, any>): e is TransformationDefinition<any, any> =>
  (e as { category?: string }).category === 'transformation';

/** The runner. Drive it with `applyTransformation` or `applyTransformationSync`. */
export function* runTransformation<S, N extends Needs, P>(
  t: Transformation<S, N, P>,
  before: Artifact<S>,
  options: TransformationOptions<S, P> = {},
): Steps<TransformationResult<S>> {
  const params = options.params as P,
    inputs = options.inputs ?? {};
  const needs = Object.entries(t.needs ?? {}),
    ensures = [...t.obligations.ensures, ...(options.ensures ?? [])],
    preserves = t.obligations.preserves;
  const contracts = ensures.filter(isContract);
  if (contracts.length > 1)
    throw new PassError('badResult', `Pass ${t.id}: one application takes at most one contract`);
  if (!options.manager && (needs.length || preserves.length || contracts.length))
    throw new PassError('badResult', `Pass ${t.id} needs an analysis manager`);
  const manager = options.manager as AnalysisManager;
  const view = openIR(before, t.adapter, options.store);
  // the generation a head advance is checked against: what the caller's store held when the input was opened
  const generation = options.store?.generation(before.id);
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

  // prepare: a native result, or operations on the edit (opened on its first read: IRWB-019 F13)
  let edit: IREdit<S> | undefined;
  let produced: void | NativeResult<S>;
  let ran = false;
  try {
    produced = yield* wait(
      t.prepare({
        ...context,
        records: records as PassRunContext<S, N, P>['records'],
        get edit(): IREdit<S> {
          return (edit ??= view.beginEdit());
        },
      }),
    );
    ran = true;
  } finally {
    if (!ran && edit?.state === 'open') edit.rollback('pass threw');
  }
  let after: Artifact<S>, changes: ChangeSet, correspondence: EntityCorrespondence, edits: number;
  let report: unknown;
  if (produced && typeof produced === 'object' && 'native' in produced) {
    if (edit?.state === 'open') edit.rollback('native result');
    ({ after, changes, correspondence, edits } = prepareNative(
      t,
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
  if (after.revision === before.revision && !changes.entities.length && !changes.relations.length)
    return unchanged();

  enforceWrites(t, changes);

  // ensures, preserves, then the one publication point. Any exit before it leaves nothing about the candidate.
  let contract: PreparedTransformation | undefined;
  let verdict: CheckResult | undefined;
  const preserved: PreservationOutcome[] = [];
  let settled = false,
    claimsChecked = false;
  const discard = (reason: string) => {
    discardEvidence(contract, reason);
    if (claimsChecked)
      for (const def of preserves)
        try {
          manager.invalidate(def, after, `Pass ${t.id} was not accepted`);
        } catch {
          // cleanup must not mask the rejection
        }
  };
  try {
    for (const e of ensures) {
      if (isContract(e)) {
        try {
          // F33: deferred, so the evidence is committed at the publication boundary below and not before it
          contract = yield* wait(
            manager.verifyTransformation(
              { input: before, ...inputs } as never,
              { output: after } as never,
              e,
              e.correspondence.length
                ? e.correspondence.map(req => semanticCorrespondence(correspondence, req.id, req.relation))
                : [semanticCorrespondence(correspondence)],
              { deferCommit: true },
            ),
          );
        } catch (error) {
          throw new PassError(
            'contractRejected',
            `Pass ${t.id} output rejected: ${(error as Error).message}`,
            {
              cause: String(error),
            },
          );
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
    publishAccepted(t, options.store, before, after, contract, generation);
    settled = true;
  } catch (error) {
    settled = true;
    discard(`Pass ${t.id} rejected: ${(error as Error).message}`);
    throw error;
  } finally {
    // not settled here only when a synchronous driver abandoned the run at an asynchronous step
    if (!settled) discard(`Pass ${t.id} was abandoned at an asynchronous step`);
  }
  return {
    ...base,
    changed: true,
    artifact: after,
    changes,
    correspondence,
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
): Promise<TransformationResult<S>> {
  return driveAsync(runTransformation(t, before, options));
}

/** The synchronous driver: the same runner; it throws when a step answers with a promise. */
export function applyTransformationSync<S, N extends Needs, P>(
  t: Transformation<S, N, P>,
  before: Artifact<S>,
  options?: TransformationOptions<S, P>,
): TransformationResult<S> {
  return driveSync(runTransformation(t, before, options), `Pass ${t.id}`);
}
