import { canonical, immutable } from '../core/data.js';
import type { Artifact } from '../core/types.js';
import type { EditOptions, IREdit, IRView, RevisionRef, TransformationResult, VersionRef } from './types.js';
import { describePattern, orderedCandidates, PatternBudgetError, searchPattern } from './patterns.js';
import type { PatternDescriptor, PatternInput, PatternMatch, PatternPredicateRegistry } from './patterns.js';
import { compareText, syncFunction, synchronous } from './common.js';
import { readIR } from './readers.js';
import type { IRReader } from './readers.js';
export type RewriteGuardResult = boolean | {
    readonly accept: boolean;
    readonly reason?: string;
};
/** A rule can describe edits; only its scheduler owns preparation and publication. */
export type RewriteEdit<T = unknown> = Pick<IREdit<T>, 'base' | 'state' | 'insert' | 'replace' | 'remove' | 'update' | 'connect' | 'disconnect' | 'redirectReferences' | 'correspond' | 'preview'>;
export interface RewriteDefinition<T = unknown> {
    readonly id: string;
    readonly version?: string;
    readonly description?: string;
    readonly match: PatternInput;
    readonly guard?: (match: PatternMatch, view: IRReader<T>) => RewriteGuardResult;
    readonly replace: (match: PatternMatch, edit: RewriteEdit<T>, view: IRReader<T>) => void | Promise<void>;
    readonly preserves?: readonly VersionRef[];
}
export interface RewriteDescriptor extends VersionRef {
    readonly description: string;
    readonly match: PatternDescriptor;
    readonly guarded: boolean;
    readonly preserves: readonly VersionRef[];
}
export interface RewriteRule<T = unknown> extends VersionRef {
    readonly description: string;
    readonly match: PatternDescriptor;
    readonly guard?: (match: PatternMatch, view: IRReader<T>) => RewriteGuardResult;
    readonly replace: (match: PatternMatch, edit: RewriteEdit<T>, view: IRReader<T>) => void | Promise<void>;
    readonly preserves: readonly VersionRef[];
    readonly descriptor: RewriteDescriptor;
}
function nonempty(value: unknown, label: string): asserts value is string {
    if (typeof value !== 'string' || !value.length || value.length > 1000)
        throw new Error(label + ' must be a nonempty string of at most 1000 characters');
}
export function rewrite<T = unknown>(definition: RewriteDefinition<T>): RewriteRule<T> {
    const id = definition.id, version = definition.version ?? '1', description = definition.description ?? id;
    nonempty(id, 'Rewrite ID');
    nonempty(version, 'Rewrite version');
    nonempty(description, 'Rewrite description');
    if (typeof definition.replace !== 'function')
        throw new Error('Rewrite rule requires a replacement callback');
    if (['GeneratorFunction', 'AsyncGeneratorFunction'].includes(definition.replace.constructor.name))
        throw new Error('Rewrite replacement must execute directly, not return a generator');
    if (definition.guard !== undefined && typeof definition.guard !== 'function')
        throw new Error('Rewrite guard must be a function');
    if (definition.guard)
        syncFunction(definition.guard, 'Rewrite guard');
    const match = describePattern(definition.match), preserves = immutable((definition.preserves ?? []).map(ref => {
        nonempty(ref.id, 'Preserved property ID');
        nonempty(ref.version, 'Preserved property version');
        return {
            id: ref.id, version: ref.version
        };
    }));
    if (new Set(preserves.map(ref => canonical([ref.id, ref.version]))).size !== preserves.length)
        throw new Error('Duplicate preservation declaration');
    const descriptor = immutable({
        id, version, description, match, guarded: !!definition.guard, preserves
    });
    return Object.freeze({
        id, version, description, match, preserves, descriptor, replace: definition.replace, ...(definition.guard ? { guard: definition.guard } : {})
    });
}
/** Local rule identity is pinned independently of its scheduling strategy. */
export class RewriteRegistry {
    private rules = new Map<string, RewriteRule<any>>();
    register<T>(rule: RewriteRule<T>): this {
        const copy = rewrite(rule), key = canonical([copy.id, copy.version]);
        if (this.rules.has(key))
            throw new Error('Rewrite version is already registered: ' + key);
        this.rules.set(key, copy);
        return this;
    }
    get<T = unknown>(ref: VersionRef): RewriteRule<T> {
        const rule = this.rules.get(canonical([ref.id, ref.version]));
        if (!rule)
            throw new Error('Unregistered rewrite ' + ref.id + '@' + ref.version);
        return rule;
    }
    descriptors(): readonly RewriteDescriptor[] {
        return immutable([...this.rules.values()].map(rule => rule.descriptor).sort((a, b) => compareText(a.id + '@' + a.version, b.id + '@' + b.version)));
    }
    snapshot(): RewriteRegistry {
        const copy = new RewriteRegistry();
        copy.rules = new Map(this.rules);
        return copy;
    }
}
export type RewriteMode = 'once' | 'all' | 'top-down' | 'bottom-up' | 'innermost' | 'outermost' | 'saturate';
export type RewriteStatus = 'applied' | 'converged' | 'no-match' | 'rejected' | 'budget' | 'cycle' | 'cancelled' | 'failed';
export type RewriteStepStatus = 'applied' | 'guard-rejected' | 'unchanged' | 'rejected' | 'budget-rejected' | 'cycle-rejected' | 'cancelled' | 'failed';
export interface RewriteBudget {
    readonly maxApplications?: number;
    readonly maxAttempts?: number;
    readonly maxMatchSteps?: number;
    readonly maxMatches?: number;
}
export interface RewriteOptions<T = unknown> {
    readonly budget?: number | RewriteBudget;
    readonly registry?: PatternPredicateRegistry;
    /** Relationship names defining schedule order. Omit to use containment. */
    readonly relations?: readonly string[];
    readonly verify?: EditOptions<T>['verify'];
    /** Only explicitly classified failures are expected rejection, never arbitrary algorithm bugs. */
    readonly classifyRejection?: (error: unknown) => boolean;
    readonly signal?: AbortSignal;
}
export interface RewriteStep<T = unknown> {
    readonly index: number;
    readonly rule: VersionRef;
    readonly status: RewriteStepStatus;
    readonly before: RevisionRef;
    readonly after?: RevisionRef;
    readonly match: PatternMatch;
    readonly reason?: string;
    /** Provisional results in rejected steps are evidence; only status=applied publishes them. */
    readonly result?: TransformationResult<T>;
    readonly preservation: {
        readonly declared: readonly VersionRef[];
        readonly verification: 'unverified' | 'host-accepted';
    };
}
export interface RewriteResult<T = unknown> {
    readonly formatVersion: 1;
    readonly mode: RewriteMode;
    readonly input: RevisionRef;
    readonly artifact: Artifact<T>;
    readonly view: IRView<T>;
    readonly status: RewriteStatus;
    readonly reason: string;
    readonly applications: number;
    readonly attempts: number;
    readonly matchSteps: number;
    readonly steps: readonly RewriteStep<T>[];
}
export interface RewriteScheduleDescriptor {
    readonly formatVersion: 1;
    readonly mode: RewriteMode;
    readonly rules: readonly VersionRef[];
    readonly budget: Required<RewriteBudget>;
    readonly relations?: readonly string[];
}
export interface RewriteSchedule<T = unknown> {
    readonly descriptor: RewriteScheduleDescriptor;
    run(view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
}
export class RewriteRejected extends Error {
    readonly code = 'IR_REWRITE_REJECTED';
    constructor(message: string) {
        super(message);
        this.name = 'RewriteRejected';
    }
}
export class RewriteExecutionError extends Error {
    readonly code = 'IR_REWRITE_FAILED';
    constructor(message: string, readonly result: RewriteResult<any>, cause: unknown) {
        super(message, { cause });
        this.name = 'RewriteExecutionError';
    }
}
class Stop extends Error {
    constructor(readonly status: 'budget' | 'cycle' | 'cancelled', message: string) {
        super(message);
    }
}
function checkedBudget(budget: RewriteOptions['budget']): Required<RewriteBudget> {
    const supplied = typeof budget === 'number' ? { maxApplications: budget } : budget ?? {};
    const result = {
        maxApplications: supplied.maxApplications ?? 100, maxAttempts: supplied.maxAttempts ?? 1000, maxMatchSteps: supplied.maxMatchSteps ?? 1000000, maxMatches: supplied.maxMatches ?? 10000
    };
    for (const [key, value] of Object.entries(result)) {
        if (!Number.isSafeInteger(value) || value < 0 || (key === 'maxMatches' && value === 0))
            throw new Error('Rewrite budget ' + key + ' must be ' + (key === 'maxMatches' ? 'positive' : 'nonnegative') + ' safe integer');
    }
    return immutable(result);
}
function revision(artifact: Artifact): RevisionRef {
    return {
        artifact: artifact.id, revision: artifact.revision
    };
}
function bindingIdentity(found: PatternMatch): string {
    return canonical({
        root: found.root.entity, bindings: Object.fromEntries(Object.entries(found.bindings).map(([key, ref]) => [key, ref.entity]))
    });
}
function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
function isView(value: unknown): value is IRView<any> {
    return !!value && typeof value === 'object' && typeof (value as IRView).beginEdit === 'function' && typeof (value as IRView).resolve === 'function';
}
function editScope<T>(edit: IREdit<T>): {
    edit: RewriteEdit<T>;
    close(): void;
} {
    let active = true;
    const check = () => {
        if (!active)
            throw new Error('Rewrite edit capability expired when its replacement callback completed');
    };
    const scope: RewriteEdit<T> = Object.freeze({
        base: edit.base, get state() {
            return edit.state;
        },
        insert(entity) {
            check();
            return edit.insert(entity);
        }, replace(target, entity) {
            check();
            edit.replace(target, entity);
        },
        remove(target) {
            check();
            edit.remove(target);
        }, update(target, attributes) {
            check();
            edit.update(target, attributes);
        },
        connect(from, relation, to) {
            check();
            return edit.connect(from, relation, to);
        },
        disconnect: ((...args: unknown[]) => {
            check();
            (edit.disconnect as (...values: unknown[]) => void)(...args);
        }) as IREdit<T>['disconnect'],
        redirectReferences(from, to, options) {
            check();
            edit.redirectReferences(from, to, options);
        },
        correspond(from, to, relation) {
            check();
            edit.correspond(from, to, relation);
        }, preview() {
            return edit.preview();
        }
    });
    return {
        edit: scope, close() {
            active = false;
        }
    };
}
/** Every committed step is a separate transaction; later rejection preserves earlier accepted steps. */
export async function executeRewrites<T>(view: IRView<T>, rulesInput: readonly RewriteRule<T>[], mode: RewriteMode, options: RewriteOptions<T> = {}): Promise<RewriteResult<T>> {
    if (!view.capabilities.includes('Rewritable'))
        throw new Error('Rewrite schedules require a Rewritable adapter');
    if (!['once', 'all', 'top-down', 'bottom-up', 'innermost', 'outermost', 'saturate'].includes(mode))
        throw new Error('Unknown rewrite schedule');
    if (!rulesInput.length)
        throw new Error('A rewrite schedule requires at least one rule');
    if (mode !== 'saturate' && rulesInput.length !== 1)
        throw new Error('Only saturation accepts multiple rules');
    const rules = rulesInput.map(rule => rewrite(rule)), budget = checkedBudget(options.budget), registry = options.registry?.snapshot();
    const verify = options.verify, classifyRejection = options.classifyRejection, signal = options.signal;
    const relations = options.relations === undefined ? undefined : immutable(options.relations);
    if (relations !== undefined && (!Array.isArray(relations) || relations.some(kind => !Object.hasOwn(view.descriptor.relationKinds, kind))))
        throw new Error('Rewrite schedule uses an undeclared relation kind');
    if (classifyRejection)
        syncFunction(classifyRejection, 'Rewrite rejection classifier');
    const input = revision(view.artifact), steps: RewriteStep<T>[] = [], seenContent = new Set([view.artifact.contentHash]);
    let current = view, applications = 0, attempts = 0, matchSteps = 0;
    function result(status: RewriteStatus, reason: string): RewriteResult<T> {
        return Object.freeze({
            formatVersion: 1, mode, input: immutable(input), artifact: current.artifact, view: current, status, reason, applications, attempts, matchSteps, steps: immutable(steps)
        });
    }
    function checkAbort(): void {
        if (signal?.aborted)
            throw new Stop('cancelled', 'Rewrite schedule was cancelled');
    }
    function query(rule: RewriteRule<T>, roots?: readonly string[], order: 'pre' | 'post' | 'breadth' = 'pre'): readonly PatternMatch[] {
        checkAbort();
        const remaining = budget.maxMatchSteps - matchSteps;
        if (remaining <= 0)
            throw new Stop('budget', 'The shared pattern matching step budget was exhausted');
        try {
            const searched = searchPattern(current, rule.match, {
                ...(roots ? { roots } : {}), order, registry, ...(relations === undefined ? {} : { relations }), maxSteps: remaining, maxMatches: budget.maxMatches
            });
            matchSteps += searched.steps;
            return searched.matches;
        }
        catch (error) {
            if (error instanceof PatternBudgetError) {
                matchSteps += error.steps;
                throw new Stop('budget', error.message);
            }
            throw error;
        }
    }
    function push(rule: RewriteRule<T>, found: PatternMatch, status: RewriteStepStatus, before: RevisionRef, reason?: string, transformed?: TransformationResult<T>, accepted = false): void {
        steps.push(immutable({
            index: steps.length, rule: {
                id: rule.id, version: rule.version
            }, status, before, match: found,
            ...(reason === undefined ? {} : { reason }), ...(transformed ? {
                after: revision(transformed.artifact), result: transformed
            } : {}),
            preservation: {
                declared: rule.preserves, verification: accepted && !!verify ? 'host-accepted' : 'unverified'
            }
        }));
    }
    async function tryMatch(rule: RewriteRule<T>, found: PatternMatch, detectCycle: boolean): Promise<boolean> {
        checkAbort();
        if (attempts >= budget.maxAttempts)
            throw new Stop('budget', 'Rewrite attempt budget exhausted; convergence has not been established');
        if (found.artifact.artifact !== current.artifact.id || found.artifact.revision !== current.artifact.revision)
            throw new Error('A stale pattern match cannot be applied to a different revision');
        attempts++;
        const before = revision(current.artifact);
        let edit: IREdit<T> | undefined, provisional: TransformationResult<T> | undefined;
        try {
            if (rule.guard) {
                const guard = synchronous(rule.guard(found, readIR(current)), 'Rewrite guard');
                if (typeof guard !== 'boolean' && (!guard || typeof guard !== 'object' || typeof guard.accept !== 'boolean' || (guard.reason !== undefined && typeof guard.reason !== 'string')))
                    throw new Error('Rewrite guard must return a boolean or {accept,reason}');
                if (!(typeof guard === 'boolean' ? guard : guard.accept)) {
                    push(rule, found, 'guard-rejected', before, typeof guard === 'boolean' ? 'Rule guard rejected this match' : guard.reason ?? 'Rule guard rejected this match');
                    return false;
                }
            }
            const gate: EditOptions<T>['verify'] = signal ? async (transformed, original) => {
                checkAbort();
                const acceptance = verify ? await verify(transformed, original) : {
                    commit() {
                    }, rollback() {
                    }
                };
                if (!acceptance || typeof acceptance.commit !== 'function' || typeof acceptance.rollback !== 'function')
                    throw new Error('Semantic verification must return commit and rollback callbacks');
                syncFunction(acceptance.rollback, 'Semantic acceptance rollback');
                try {
                    syncFunction(acceptance.commit, 'Semantic acceptance commit');
                    checkAbort();
                }
                catch (error) {
                    synchronous(acceptance.rollback(message(error)), 'Semantic acceptance rollback');
                    throw error;
                }
                return {
                    commit() {
                        checkAbort();
                        return acceptance.commit();
                    }, rollback(reason) {
                        return acceptance.rollback(reason);
                    }
                };
            } : verify;
            edit = current.beginEdit({
                label: rule.id + '@' + rule.version, ...(gate ? { verify: gate } : {})
            });
            const scope = editScope(edit);
            try {
                const pending = rule.replace(found, scope.edit, readIR(current));
                if (pending && typeof pending.then === 'function')
                    await pending;
            }
            finally {
                scope.close();
            }
            checkAbort();
            provisional = edit.prepare();
            if (provisional.artifact.contentHash === current.artifact.contentHash || !provisional.changes.changed) {
                edit.rollback('The replacement made no representation change');
                push(rule, found, 'unchanged', before, 'Matched replacement made no representation change', provisional);
                return false;
            }
            if (applications >= budget.maxApplications) {
                edit.rollback('Application budget exhausted');
                push(rule, found, 'budget-rejected', before, 'A changing candidate exists but the application budget is exhausted', provisional);
                throw new Stop('budget', 'Rewrite application budget exhausted; a further changing candidate was not committed');
            }
            if (detectCycle && seenContent.has(provisional.artifact.contentHash)) {
                edit.rollback('Repeated representation content');
                push(rule, found, 'cycle-rejected', before, 'Candidate returns to previously accepted content; it was not committed', provisional);
                throw new Stop('cycle', 'A directed rewrite cycle was detected; the last unique accepted revision is retained');
            }
            const committed = await edit.commit();
            current = current.at(committed.artifact);
            applications++;
            seenContent.add(committed.artifact.contentHash);
            push(rule, found, 'applied', before, 'Replacement validated and committed' + (verify ? ' through the host semantic gate' : ''), committed, true);
            return true;
        }
        catch (error) {
            if (edit && edit.state !== 'committed' && edit.state !== 'rolled-back' && edit.state !== 'failed') {
                try {
                    edit.rollback(message(error));
                }
                catch { /* Preserve the original validation/host error. */
                }
            }
            if (error instanceof Stop) {
                if (error.status === 'cancelled')
                    push(rule, found, 'cancelled', before, error.message, provisional);
                throw error;
            }
            let rejected = error instanceof RewriteRejected;
            if (!rejected && classifyRejection) {
                const classified = synchronous(classifyRejection(error), 'Rewrite rejection classifier');
                if (typeof classified !== 'boolean')
                    throw new Error('Rewrite rejection classifier must return a synchronous boolean', { cause: error });
                rejected = classified;
            }
            push(rule, found, rejected ? 'rejected' : 'failed', before, message(error), provisional);
            if (!rejected)
                throw error;
            return false;
        }
    }
    function settled(normalized: boolean): RewriteResult<T> {
        if (applications)
            return result(normalized ? 'converged' : 'applied', normalized ? 'No eligible changing rewrite remains under the supplied rules and guards' : 'The finite rewrite sweep completed');
        if (steps.some(step => step.status === 'guard-rejected' || step.status === 'rejected'))
            return result('rejected', 'All changing opportunities were rejected by guards or explicitly classified semantic rejection');
        if (steps.some(step => step.status === 'unchanged'))
            return result('converged', 'Matching rules produced no representation change');
        return result('no-match', 'No candidate satisfied the supplied pattern');
    }
    try {
        checkAbort();
        if (mode === 'once') {
            for (const found of query(rules[0]))
                if (await tryMatch(rules[0], found, false))
                    return result('applied', 'One replacement was committed');
            return settled(false);
        }
        if (mode === 'all') {
            const frontier = query(rules[0]);
            for (const original of frontier) {
                checkAbort();
                if (!current.entities().some(ref => ref.entity === original.root.entity))
                    continue;
                const fresh = current.artifact.revision === original.artifact.revision ? original
                    : query(rules[0], [original.root.entity]).find(found => bindingIdentity(found) === bindingIdentity(original));
                if (fresh)
                    await tryMatch(rules[0], fresh, false);
            }
            return settled(false);
        }
        if (mode === 'top-down' || mode === 'bottom-up') {
            const order = mode === 'top-down' ? 'pre' : 'post';
            const frontier = orderedCandidates(current, order, relations).map(ref => ref.entity);
            for (const root of frontier) {
                checkAbort();
                if (!current.entities().some(ref => ref.entity === root))
                    continue;
                for (const found of query(rules[0], [root], order))
                    if (await tryMatch(rules[0], found, false))
                        break;
            }
            return settled(false);
        }
        // Innermost/outermost normalize using post/pre containment order; saturation adds rule priority.
        while (true) {
            let changed = false;
            for (const rule of rules) {
                for (const found of query(rule, undefined, mode === 'innermost' ? 'post' : 'pre')) {
                    if (await tryMatch(rule, found, true)) {
                        changed = true;
                        break;
                    }
                }
                if (changed)
                    break;
            }
            if (!changed)
                return settled(true);
        }
    }
    catch (error) {
        if (error instanceof Stop)
            return result(error.status, error.message);
        const failed = result('failed', message(error));
        throw new RewriteExecutionError('Rewrite schedule failed: ' + message(error), failed, error);
    }
}
function schedule<T>(mode: RewriteMode, rulesInput: readonly RewriteRule<T>[], options: RewriteOptions<T> = {}): RewriteSchedule<T> {
    const rules = rulesInput.map(rule => rewrite(rule)), budget = checkedBudget(options.budget), registry = options.registry?.snapshot();
    const relations = options.relations === undefined ? undefined : immutable(options.relations);
    const captured = Object.freeze({
        ...options, budget, ...(registry ? { registry } : {}), ...(relations === undefined ? {} : { relations })
    });
    const descriptor = immutable({
        formatVersion: 1 as const, mode, rules: rules.map(({ id, version }) => ({
            id, version
        })), budget, ...(relations === undefined ? {} : { relations })
    });
    return Object.freeze({
        descriptor, run(view: IRView<T>, overrides: RewriteOptions<T> = {}) {
            return executeRewrites(view, rules, mode, {
                ...captured, ...overrides
            });
        }
    });
}
function single<T>(mode: RewriteMode, a: IRView<T> | RewriteRule<T>, b?: IRView<T> | RewriteRule<T> | RewriteOptions<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>> | RewriteSchedule<T> {
    if (isView(a)) {
        if (!b || isView(b))
            throw new Error('Rewrite schedule requires a rule');
        return executeRewrites(a, [b as RewriteRule<T>], mode, options);
    }
    if (isView(b))
        return executeRewrites(b, [a], mode, options);
    return schedule(mode, [a], b as RewriteOptions<T> | undefined);
}
export function applyOnce<T>(rule: RewriteRule<T>, options?: RewriteOptions<T>): RewriteSchedule<T>;
export function applyOnce<T>(view: IRView<T>, rule: RewriteRule<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function applyOnce<T>(rule: RewriteRule<T>, view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function applyOnce<T>(a: IRView<T> | RewriteRule<T>, b?: IRView<T> | RewriteRule<T> | RewriteOptions<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>> | RewriteSchedule<T> {
    return single('once', a, b, options);
}
export function applyAll<T>(rule: RewriteRule<T>, options?: RewriteOptions<T>): RewriteSchedule<T>;
export function applyAll<T>(view: IRView<T>, rule: RewriteRule<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function applyAll<T>(rule: RewriteRule<T>, view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function applyAll<T>(a: IRView<T> | RewriteRule<T>, b?: IRView<T> | RewriteRule<T> | RewriteOptions<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>> | RewriteSchedule<T> {
    return single('all', a, b, options);
}
export function topDown<T>(rule: RewriteRule<T>, options?: RewriteOptions<T>): RewriteSchedule<T>;
export function topDown<T>(view: IRView<T>, rule: RewriteRule<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function topDown<T>(rule: RewriteRule<T>, view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function topDown<T>(a: IRView<T> | RewriteRule<T>, b?: IRView<T> | RewriteRule<T> | RewriteOptions<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>> | RewriteSchedule<T> {
    return single('top-down', a, b, options);
}
export function bottomUp<T>(rule: RewriteRule<T>, options?: RewriteOptions<T>): RewriteSchedule<T>;
export function bottomUp<T>(view: IRView<T>, rule: RewriteRule<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function bottomUp<T>(rule: RewriteRule<T>, view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function bottomUp<T>(a: IRView<T> | RewriteRule<T>, b?: IRView<T> | RewriteRule<T> | RewriteOptions<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>> | RewriteSchedule<T> {
    return single('bottom-up', a, b, options);
}
export function innermost<T>(rule: RewriteRule<T>, options?: RewriteOptions<T>): RewriteSchedule<T>;
export function innermost<T>(view: IRView<T>, rule: RewriteRule<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function innermost<T>(rule: RewriteRule<T>, view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function innermost<T>(a: IRView<T> | RewriteRule<T>, b?: IRView<T> | RewriteRule<T> | RewriteOptions<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>> | RewriteSchedule<T> {
    return single('innermost', a, b, options);
}
export function outermost<T>(rule: RewriteRule<T>, options?: RewriteOptions<T>): RewriteSchedule<T>;
export function outermost<T>(view: IRView<T>, rule: RewriteRule<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function outermost<T>(rule: RewriteRule<T>, view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function outermost<T>(a: IRView<T> | RewriteRule<T>, b?: IRView<T> | RewriteRule<T> | RewriteOptions<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>> | RewriteSchedule<T> {
    return single('outermost', a, b, options);
}
export function saturate<T>(rules: readonly RewriteRule<T>[], options?: RewriteOptions<T>): RewriteSchedule<T>;
export function saturate<T>(view: IRView<T>, rules: readonly RewriteRule<T>[], options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function saturate<T>(rules: readonly RewriteRule<T>[], view: IRView<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>>;
export function saturate<T>(a: IRView<T> | readonly RewriteRule<T>[], b?: IRView<T> | readonly RewriteRule<T>[] | RewriteOptions<T>, options?: RewriteOptions<T>): Promise<RewriteResult<T>> | RewriteSchedule<T> {
    if (isView(a)) {
        if (!Array.isArray(b))
            throw new Error('Saturation requires a rule array');
        return executeRewrites(a, b, 'saturate', options);
    }
    if (isView(b))
        return executeRewrites(b, a, 'saturate', options);
    return schedule('saturate', a, b as RewriteOptions<T> | undefined);
}
