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
 */
import type { Artifact } from '../core/types.js';
import { canonical } from '../core/data.js';
import { openIR } from '../ir/index.js';
import type { ChangeSet, EntityCorrespondence, IREdit, IRStore, IRView } from '../ir/index.js';
import type { AnalysisManager } from '../contracts/analysis-manager.js';
import { wait, driveAsync, driveSync, type Steps } from '../core/steps.js';
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
/** A check on the candidate, or a v6 contract verified by the analysis manager and recorded there. */
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

export type Transformation<S, N extends Needs = Needs, P = unknown> = Readonly<
  TransformationSpec<S, N, P>
> & {
  readonly needs: N;
  readonly obligations: Required<Obligations<S, N, P>>;
  readonly category: 'pass';
};
/** A pass is a transformation; the name is kept for the code that says "pass". */
export type Pass<S, N extends Needs = Needs, P = unknown> = Transformation<S, N, P>;

export function transformation<S, N extends Needs = {}, P = unknown>(
  spec: TransformationSpec<S, N, P>,
): Transformation<S, N, P> {
  if (!spec.id || !spec.version) throw new Error('A pass needs an id and a version');
  if (typeof spec.prepare !== 'function') throw new Error(`Pass ${spec.id} needs prepare`);
  if (spec.eligible !== undefined && typeof spec.eligible !== 'function')
    throw new Error(`Pass ${spec.id}: eligible must be a function`);
  if (spec.relation !== 'exact' && spec.relation !== 'tolerance')
    throw new Error(`Pass ${spec.id} must declare its relation: 'exact' or 'tolerance'`);
  if (!spec.writes || !Array.isArray(spec.writes.entities) || !Array.isArray(spec.writes.relations))
    throw new Error(`Pass ${spec.id} must declare writes { entities, relations }`);
  return Object.freeze({
    ...spec,
    needs: spec.needs ?? ({} as N),
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

export interface TransformationOptions<S, P> {
  /** Needed when the transformation declares `needs` or `preserves`, or an `ensures` is a contract. */
  readonly manager?: AnalysisManager;
  readonly store?: IRStore;
  readonly params?: P;
  readonly inputs?: ApplicationInputs;
  /**
   * Obligations of this application, after the transformation's own (e.g. a project's optimization contract). One
   * application verifies at most one contract: F33 commits one prepared execution at the publication point.
   */
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
          contract = yield* manager.verifyTransformationSteps(
            { input: before, ...inputs } as never,
            { output: after } as never,
            e,
            e.correspondence.length
              ? e.correspondence.map(req => semanticCorrespondence(correspondence, req.id, req.relation))
              : [semanticCorrespondence(correspondence)],
            { deferCommit: true },
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
