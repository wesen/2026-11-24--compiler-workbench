import {
  assert,
  type Artifact,
  type Checkpoint,
  type Decision,
  type Diagnostic,
  type EntityRef,
  type IRKind,
  type Metric,
  type Pass,
  type PassContext,
  type PassPolicy,
  type PassPolicyContext,
  type PassInvocationIdentity,
  type Registry,
  type Task,
} from './types.js';
import { canonical, fingerprint, immutable } from './data.js';
import type {
  CacheChange,
  CacheExplanation,
  DatabaseSnapshot,
  Dependency,
  DerivationRecord,
  InvocationRecord,
  PassDescriptor,
  RunRecord,
} from './records.js';
import { Queries } from './query.js';

type AnyPass = Pass<any, any>;
type AnyKind = IRKind<any>;
type AnyPolicy = PassPolicy<any>;
interface PendingDerivation {
  source: EntityRef;
  from: string[];
  to: string[];
  relation: string;
}
interface CacheEntry {
  key: string;
  task: Task;
  passVersion: string;
  schemaVersion: string;
  kind: string;
  artifact: Artifact;
  dependencies: Dependency[];
  decisions: Decision[];
  diagnostics: Diagnostic[];
  metrics: Metric[];
  checkpoints: Checkpoint[];
  derivations: PendingDerivation[];
  originInvocation: string;
  trace: 'summary' | 'full';
  used: number;
}

export interface CompilerOptions {
  maxCacheEntries?: number;
}
export interface RunOptions {
  trace?: 'summary' | 'full';
  cache?: boolean;
}

export class CompileError extends Error {
  constructor(
    message: string,
    readonly invocationId: string,
    readonly taskId: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CompileError';
  }
}

export function ref(artifact: Artifact): EntityRef {
  return { artifact: artifact.id, revision: artifact.revision };
}
export function artifactKey(artifact: Artifact | EntityRef): string {
  return ('id' in artifact ? artifact.id : artifact.artifact) + '@' + artifact.revision;
}

/** In-memory orchestrator and compilation database. It knows no CAD, game, or physics concepts. */
export class Compiler implements Registry {
  private readonly kinds = new Map<string, AnyKind>();
  private readonly passes = new Map<string, AnyPass>();
  private readonly passHistory = new Map<string, PassDescriptor>();
  private readonly policies = new Map<string, AnyPolicy>();
  private readonly policyHistory = new Set<string>();
  private inputs: Record<string, unknown> = {};
  private readonly cache = new Map<string, CacheEntry>();
  private readonly lostEntries = new Map<string, string>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly runRecords: RunRecord[] = [];
  private readonly invocationRecords: InvocationRecord[] = [];
  private readonly derivationRecords: DerivationRecord[] = [];
  private tick = 0;
  private invocationCounter = 0;
  private active = 0;
  readonly maxCacheEntries: number;

  constructor(options: CompilerOptions = {}) {
    this.maxCacheEntries = options.maxCacheEntries ?? 2048;
    assert(
      Number.isInteger(this.maxCacheEntries) && this.maxCacheEntries >= 0,
      'Cache capacity must be a nonnegative integer',
    );
  }

  registerKind<T>(kind: IRKind<T>): void {
    assert(this.active === 0, 'Cannot change registry during a run');
    assert(kind.id.length && kind.version.length, 'Kind id and schema version are required');
    assert(!this.kinds.has(kind.id), `IR kind ${kind.id} is already registered`);
    this.kinds.set(kind.id, Object.freeze({ ...kind }));
  }

  register<P, T>(pass: Pass<P, T>): void {
    assert(
      !this.passes.has(pass.id),
      `Pass ${pass.id} is already registered; use replacePass with a new version`,
    );
    this.install(pass);
  }

  replacePass<P, T>(pass: Pass<P, T>): void {
    const old = this.passes.get(pass.id);
    assert(old, `Cannot replace unregistered pass ${pass.id}`);
    assert(old.version !== pass.version, 'Replacing algorithm code requires a new pass version');
    this.install(pass);
  }

  private install(pass: AnyPass): void {
    assert(this.active === 0, 'Cannot change registry during a run');
    assert(pass.id.length && pass.version.length, 'Pass id and version are required');
    assert(this.kinds.has(pass.kind), `Unknown output IR kind ${pass.kind}`);
    assert(
      !this.passHistory.has(`${pass.id}@${pass.version}`),
      'A previously used pass version cannot be redefined',
    );
    this.passes.set(pass.id, Object.freeze({ ...pass }));
    this.passHistory.set(`${pass.id}@${pass.version}`, {
      id: pass.id,
      version: pass.version,
      kind: pass.kind,
      description: pass.description,
      role: pass.role ?? 'transform',
      cache: pass.cache !== false,
    });
  }

  /** Install or replace a semantic acceptance policy without redefining algorithm code.
   * Registry changes are forbidden during runs; each policy version has one meaning.
   */
  setPassPolicy<S>(passId: string, policy: PassPolicy<S>): this {
    assert(this.active === 0, 'Cannot change pass policies during a run');
    assert(this.passes.has(passId), `Cannot attach a policy to unregistered pass ${passId}`);
    assert(
      typeof policy.id === 'string' &&
        policy.id.length > 0 &&
        typeof policy.version === 'string' &&
        policy.version.length > 0,
      'Policy id and version are required',
    );
    assert(policy.cache === undefined || typeof policy.cache === 'boolean', 'Policy cache must be boolean');
    for (const name of ['before', 'reuse', 'after', 'committed', 'failed'] as const) {
      assert(
        policy[name] === undefined || typeof policy[name] === 'function',
        `Policy ${name} must be a function`,
      );
    }
    const key = canonical([passId, policy.id, policy.version]);
    assert(!this.policyHistory.has(key), 'A previously used policy version cannot be redefined');
    this.policies.set(passId, Object.freeze({ ...policy }));
    this.policyHistory.add(key);
    return this;
  }

  removePassPolicy(passId: string): boolean {
    assert(this.active === 0, 'Cannot change pass policies during a run');
    return this.policies.delete(passId);
  }

  setInput(key: string, value: unknown): this {
    assert(key.length > 0, 'Input key must be nonempty');
    this.inputs = { ...this.inputs, [key]: immutable(value) };
    return this;
  }
  setInputs(inputs: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(inputs)) this.setInput(key, value);
    return this;
  }
  getInputs(): Record<string, unknown> {
    return immutable(this.inputs);
  }

  beginRun(label: string, options: RunOptions = {}): CompilationRun {
    const record: RunRecord = {
      id: `run-${this.runRecords.length + 1}`,
      label,
      startedAt: Date.now(),
      status: 'running',
      inputs: immutable(this.inputs),
      roots: [],
      trace: options.trace ?? 'full',
    };
    this.runRecords.push(record);
    this.active++;
    return new CompilationRun(
      this,
      record,
      new Map(this.passes),
      new Map(this.kinds),
      options.cache !== false,
      new Map(this.policies),
    );
  }

  async run<T>(
    label: string,
    action: (run: CompilationRun) => Promise<T>,
    options: RunOptions = {},
  ): Promise<{ value: T; run: CompilationRun }> {
    const run = this.beginRun(label, options);
    try {
      const value = await action(run);
      await run.finishAsync();
      return { value, run };
    } catch (error) {
      run.markFailed(error);
      await run.finishAsync();
      throw error;
    }
  }

  /** Explicit eviction is distinct from semantic invalidation and retained in explanations. */
  evict(taskId?: string): number {
    assert(this.active === 0, 'Cannot evict while a run is active');
    let n = 0;
    for (const [key, entry] of this.cache)
      if (!taskId || entry.task.id === taskId) {
        this.cache.delete(key);
        this.lostEntries.set(entry.task.id, 'Entry was explicitly evicted');
        n++;
      }
    return n;
  }

  get query(): Queries {
    return new Queries(this.snapshot());
  }
  /** Current registration manifest without materializing retained execution history. */
  passDescriptors(): PassDescriptor[] {
    return immutable(
      [...this.passes.values()].map(pass => ({
        id: pass.id,
        version: pass.version,
        kind: pass.kind,
        description: pass.description,
        role: pass.role ?? 'transform',
        cache: pass.cache !== false,
      })),
    );
  }
  /** Stored artifacts are already immutable. Exact revision lookup avoids a database-wide snapshot. */
  artifact<T = unknown>(reference: EntityRef): Artifact<T> | undefined {
    return this.artifacts.get(artifactKey(reference)) as Artifact<T> | undefined;
  }
  snapshot(): DatabaseSnapshot {
    const structures: DatabaseSnapshot['structures'] = {};
    for (const [key, artifact] of this.artifacts) {
      const kind = this.kinds.get(artifact.kind)!;
      if (kind.structure) structures[key] = kind.structure(artifact.value);
    }
    return immutable({
      formatVersion: 1,
      runs: this.runRecords,
      passes: [...this.passHistory.values()],
      kinds: [...this.kinds.values()].map(k => ({
        id: k.id,
        version: k.version,
        description: k.description,
      })),
      artifacts: [...this.artifacts.values()],
      invocations: this.invocationRecords,
      derivations: this.derivationRecords,
      structures,
    });
  }

  /** Internal runtime boundary: only CompilationRun calls these methods. */
  _finish(): void {
    this.active--;
  }
  _newInvocation(): string {
    return `inv-${++this.invocationCounter}`;
  }
  _record(record: InvocationRecord): void {
    this.invocationRecords.push(record);
  }
  _artifact(artifact: Artifact): void {
    this.artifacts.set(artifactKey(artifact), artifact);
  }
  _derive(record: DerivationRecord): void {
    this.derivationRecords.push(immutable(record));
  }
  _candidates(taskId: string): CacheEntry[] {
    return [...this.cache.values()].filter(e => e.task.id === taskId).sort((a, b) => b.used - a.used);
  }
  _lost(taskId: string): string | undefined {
    return this.lostEntries.get(taskId);
  }
  _touch(entry: CacheEntry): void {
    entry.used = ++this.tick;
  }
  _store(entry: CacheEntry): void {
    if (this.maxCacheEntries === 0) {
      this.lostEntries.set(entry.task.id, 'Cache capacity is zero');
      return;
    }
    this._touch(entry);
    this.cache.set(entry.key, entry);
    this.lostEntries.delete(entry.task.id);
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = [...this.cache.values()].reduce((a, b) => (a.used < b.used ? a : b));
      this.cache.delete(oldest.key);
      this.lostEntries.set(oldest.task.id, 'Entry was evicted by the LRU capacity limit');
    }
  }
}

export class CompilationRun {
  private readonly completed = new Map<string, Artifact>();
  private readonly pending = new Map<string, Promise<Artifact>>();
  private readonly failures = new Map<string, unknown>();
  private readonly taskRequests = new Map<string, string>();
  private readonly waitEdges = new Map<string, Set<string>>();
  private readonly allInvocations: InvocationRecord[] = [];
  private closed = false;
  private closing = false;
  private failed = false;

  constructor(
    private readonly compiler: Compiler,
    private readonly state: RunRecord,
    private readonly passes: Map<string, AnyPass>,
    private readonly kinds: Map<string, AnyKind>,
    private readonly cacheEnabled: boolean,
    private readonly policies: Map<string, AnyPolicy> = new Map(),
  ) {}

  get record(): RunRecord {
    return immutable(this.state);
  }
  get id(): string {
    return this.state.id;
  }
  get query(): Queries {
    return new Queries(this.compiler.snapshot(), this.id);
  }
  why(artifact: Artifact | string) {
    return this.query.why(artifact);
  }
  dependencies(artifact: Artifact | string) {
    return this.query.dependencies(artifact);
  }
  history(artifact: Artifact | string) {
    return this.compiler.query.history(artifact);
  }
  explainCache(artifact: Artifact | string) {
    return this.query.explainCache(artifact);
  }
  alternatives(artifact: Artifact | string) {
    return this.query.alternatives(artifact);
  }
  compare(previous: CompilationRun) {
    return this.compiler.query.compare(previous.id, this.id);
  }

  /** Inspect one invocation without copying every historical artifact and strategy trace. */
  invocation(taskId: string): InvocationRecord | undefined {
    const record = this.allInvocations.findLast(i => i.taskId === taskId);
    return record ? immutable(record) : undefined;
  }
  /** Resolve an exact reference, or this run's successful logical task, without a full snapshot. */
  artifact<T = unknown>(target: EntityRef | string): Artifact<T> | undefined {
    if (typeof target !== 'string') return this.compiler.artifact<T>(target);
    return this.completed.get(target) as Artifact<T> | undefined;
  }

  /** Attach immutable evidence owned by an execution layer, including failed execution traces.
   * Names are single-assignment so a finished plan cannot be silently rewritten in history.
   */
  recordExtension(namespace: string, value: unknown): void {
    assert(!this.closed && !this.closing, 'Cannot attach evidence to a closed compilation run');
    assert(/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(namespace), 'Extension namespace must be a nonempty identifier');
    assert(
      !Object.hasOwn(this.state.extensions ?? {}, namespace),
      `Run extension ${namespace} is already recorded`,
    );
    const captured = immutable(value);
    this.state.extensions = { ...this.state.extensions, [namespace]: captured };
  }

  async require<T>(task: Task): Promise<Artifact<T>> {
    try {
      assert(!this.closing, 'This compilation run is closing');
      const artifact = await this.resolve(task);
      if (!this.state.roots.some(r => artifactKey(r) === artifactKey(artifact)))
        this.state.roots.push(ref(artifact));
      return artifact as Artifact<T>;
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  finish(): void {
    if (this.closed) return;
    assert(this.pending.size === 0, 'Await all task requests before finishing the run');
    this.state.endedAt = Date.now();
    this.state.status = this.failed ? 'failed' : 'succeeded';
    this.closed = true;
    this.compiler._finish();
  }

  /** Drain independently scheduled roots after a rejection before releasing the run's registry snapshot. */
  async finishAsync(): Promise<void> {
    this.closing = true;
    while (this.pending.size) await Promise.allSettled([...this.pending.values()]);
    this.finish();
  }

  markFailed(error: unknown): void {
    this.failed = true;
    this.state.error = error instanceof Error ? error.message : String(error);
  }

  private reaches(from: string, to: string, seen = new Set<string>()): boolean {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return [...(this.waitEdges.get(from) ?? [])].some(next => this.reaches(next, to, seen));
  }

  private async resolve(request: Task, parent?: string): Promise<Artifact> {
    assert(!this.closed, 'This compilation run has finished');
    const task = immutable(request);
    assert(typeof task.id === 'string' && task.id.length > 0, 'Task logical id is required');
    const signature = canonical({ pass: task.pass, params: task.params });
    const existing = this.taskRequests.get(task.id);
    assert(
      !existing || existing === signature,
      `Conflicting definitions for logical task ${task.id} in one run`,
    );
    this.taskRequests.set(task.id, signature);
    if (parent) {
      assert(!this.reaches(task.id, parent), `Dependency cycle: ${parent} -> ${task.id}`);
      const edges = this.waitEdges.get(parent) ?? new Set<string>();
      edges.add(task.id);
      this.waitEdges.set(parent, edges);
    }
    try {
      const completed = this.completed.get(task.id);
      if (completed) return completed;
      if (this.failures.has(task.id)) throw this.failures.get(task.id);
      const waiting = this.pending.get(task.id);
      if (waiting) return await waiting;
      // Scheduling through a microtask installs the pending record before recursive requires execute.
      const execution = Promise.resolve().then(() => this.execute(task));
      this.pending.set(task.id, execution);
      try {
        const result = await execution;
        this.completed.set(task.id, result);
        return result;
      } catch (error) {
        this.failures.set(task.id, error);
        throw error;
      } finally {
        this.pending.delete(task.id);
      }
    } finally {
      if (parent) this.waitEdges.get(parent)?.delete(task.id);
    }
  }

  private async execute(task: Task): Promise<Artifact> {
    const start = performance.now();
    const pass = this.passes.get(task.pass);
    const policy = this.policies.get(task.pass);
    const record: InvocationRecord = {
      id: this.compiler._newInvocation(),
      runId: this.id,
      taskId: task.id,
      passId: task.pass,
      passVersion: pass?.version ?? 'unregistered',
      role: pass?.role ?? 'transform',
      params: task.params,
      status: 'failed',
      startedAt: Date.now(),
      durationMs: 0,
      ...(policy ? { policy: { id: policy.id, version: policy.version } } : {}),
      dependencies: [],
      requests: [],
      cache: { status: 'miss', reason: 'No previous cache entry', changes: [], checkedEntries: 0 },
      decisions: [],
      metrics: [],
      diagnostics: [],
      checkpoints: [],
    };
    this.allInvocations.push(record);
    this.compiler._record(record);
    const identity: PassInvocationIdentity = Object.freeze({
      runId: this.id,
      invocationId: record.id,
      task,
      passVersion: record.passVersion,
    });
    // Only algorithm observations are replayable. Policy observations describe this invocation.
    const passDependencies: Dependency[] = [];
    const passDecisions: Decision[] = [];
    const passDiagnostics: Diagnostic[] = [];
    const passMetrics: Metric[] = [];
    const passCheckpoints: Checkpoint[] = [];
    const passDerivations: PendingDerivation[] = [];
    const policyDerivations: PendingDerivation[] = [];
    let policyState: unknown;
    let cacheEligible = true;
    const recordRequest = (child: Task) => {
      if (!record.requests.includes(child.id)) record.requests.push(child.id);
    };
    const dependencyKey = (d: Dependency) => (d.type === 'input' ? `i:${d.key}` : `t:${d.task.id}`);
    const addDependency = (dependency: Dependency, isPolicy = true) => {
      const key = dependencyKey(dependency);
      if (!record.dependencies.some(d => dependencyKey(d) === key)) record.dependencies.push(dependency);
      if (!isPolicy && !passDependencies.some(d => dependencyKey(d) === key))
        passDependencies.push(dependency);
    };
    // Each hook gets a separate lifetime. A retained pass context cannot mutate a later hook.
    const withContext = async <T>(
      isPolicy: boolean,
      action: (ctx: PassPolicyContext) => T | Promise<T>,
    ): Promise<T> => {
      let open = true;
      const outstanding = new Set<Promise<Artifact>>();
      const checkContext = () =>
        assert(
          open,
          `${isPolicy ? 'Policy' : 'Pass'} context cannot be used after the ${isPolicy ? 'hook' : 'pass'} returns`,
        );
      const ctx: PassPolicyContext = {
        ...identity,
        read: <V>(key: string): V => {
          checkContext();
          if (!Object.hasOwn(this.state.inputs, key)) {
            cacheEligible = false;
            throw new Error(`Input ${key} is not defined`);
          }
          const value = this.state.inputs[key];
          addDependency({ type: 'input', key, value, fingerprint: fingerprint(value) }, isPolicy);
          return value as V;
        },
        require: <V>(child: Task): Promise<Artifact<V>> => {
          checkContext();
          const captured = immutable(child);
          recordRequest(captured);
          const request = this.resolve(captured, task.id).then(
            artifact => {
              checkContext();
              addDependency(
                { type: 'task', task: captured, artifact: ref(artifact), fingerprint: artifact.revision },
                isPolicy,
              );
              return artifact;
            },
            error => {
              cacheEligible = false;
              throw error;
            },
          );
          outstanding.add(request);
          void request.then(
            () => outstanding.delete(request),
            () => outstanding.delete(request),
          );
          return request as Promise<Artifact<V>>;
        },
        decision: d => {
          checkContext();
          const value = immutable(d);
          record.decisions.push(value);
          if (!isPolicy) passDecisions.push(value);
        },
        diagnostic: d => {
          checkContext();
          const value = immutable(d);
          record.diagnostics.push(value);
          if (!isPolicy) passDiagnostics.push(value);
        },
        metric: (name, value, unit) => {
          checkContext();
          assert(Number.isFinite(value), `Metric ${name} is nonfinite`);
          const item = unit ? { name, value, unit } : { name, value };
          record.metrics.push(item);
          if (!isPolicy) passMetrics.push(item);
        },
        checkpoint: (label, data) => {
          checkContext();
          if (this.state.trace === 'full') {
            const value = immutable({ label, data });
            record.checkpoints.push(value);
            if (!isPolicy) passCheckpoints.push(value);
          }
        },
        derive: (source, mapping = {}) => {
          checkContext();
          assert(
            record.dependencies.some(
              d => d.type === 'task' && artifactKey(d.artifact) === artifactKey(source),
            ),
            'Provenance must refer to an artifact required by this pass',
          );
          (isPolicy ? policyDerivations : passDerivations).push(
            immutable({
              source: ref(source),
              from: mapping.from ?? [],
              to: mapping.to ?? [],
              relation: mapping.relation ?? 'derived-from',
            }),
          );
        },
      };
      try {
        const value = await action(ctx);
        if (outstanding.size) {
          await Promise.allSettled([...outstanding]);
          throw new Error(
            `${isPolicy ? 'Policy hook' : 'Pass'} returned before its required tasks completed; await every ctx.require call`,
          );
        }
        return value;
      } finally {
        if (outstanding.size) await Promise.allSettled([...outstanding]);
        open = false;
      }
    };
    const assertNoError = () =>
      assert(
        !record.diagnostics.some(d => d.severity === 'error'),
        'Pass or policy reported an error diagnostic',
      );
    const synchronous = (value: unknown, label: string) => {
      if (value && typeof (value as { then?: unknown }).then === 'function') {
        void Promise.resolve(value).catch(() => {});
        throw new Error(`Policy ${label} must be synchronous`);
      }
    };
    const accept = async (artifact: Artifact, cached: boolean) => {
      if (policy?.after)
        await withContext(true, ctx => policy.after!(ctx, task.params, artifact, policyState, { cached }));
      assertNoError();
      if (policy?.committed)
        synchronous(
          policy.committed(identity, task.params, artifact, policyState, { cached }),
          'committed hook',
        );
    };
    try {
      assert(pass, `Pass ${task.pass} is not registered`);
      const kind: AnyKind = this.kinds.get(pass.kind)!;
      if (policy?.before) policyState = await withContext(true, ctx => policy.before!(ctx, task.params));
      assertNoError();
      if (this.cacheEnabled && pass.cache !== false && policy?.cache !== false) {
        const candidates = this.compiler._candidates(task.id);
        let firstChanges: CacheChange[] = [];
        for (const candidate of candidates) {
          record.cache.checkedEntries++;
          const changes: CacheChange[] = [];
          if (candidate.task.pass !== task.pass)
            changes.push({
              dependency: 'pass',
              reason: 'Pass identity changed',
              before: candidate.task.pass,
              after: task.pass,
            });
          if (candidate.passVersion !== pass.version)
            changes.push({
              dependency: 'version',
              reason: 'Algorithm version changed',
              before: candidate.passVersion,
              after: pass.version,
            });
          if (candidate.kind !== pass.kind || candidate.schemaVersion !== kind.version)
            changes.push({
              dependency: 'schema',
              reason: 'Output IR schema changed',
              before: `${candidate.kind}@${candidate.schemaVersion}`,
              after: `${pass.kind}@${kind.version}`,
            });
          if (canonical(candidate.task.params) !== canonical(task.params))
            changes.push({
              dependency: 'params',
              reason: 'Explicit task parameters changed',
              before: candidate.task.params,
              after: task.params,
            });
          if (this.state.trace === 'full' && candidate.trace !== 'full')
            changes.push({
              dependency: 'trace',
              reason: 'Full trace was not retained by the cached invocation',
            });
          // Never resolve a stale parameterization: its logical child IDs may legitimately have new definitions.
          if (changes.length === 0) {
            for (const dependency of candidate.dependencies.filter(d => d.type === 'input')) {
              const exists = Object.hasOwn(this.state.inputs, dependency.key);
              const current = exists ? this.state.inputs[dependency.key] : null;
              if (!exists || fingerprint(current) !== dependency.fingerprint)
                changes.push({
                  dependency: dependency.key,
                  reason: exists ? 'Read input changed' : 'Read input was removed',
                  before: dependency.value,
                  after: current,
                });
            }
            if (changes.length === 0) {
              for (const dependency of candidate.dependencies.filter(d => d.type === 'task')) {
                recordRequest(dependency.task);
                let current: Artifact;
                try {
                  current = await this.resolve(dependency.task, task.id);
                } catch (error) {
                  changes.push({
                    dependency: dependency.task.id,
                    reason: 'Previously required task no longer succeeds',
                    before: dependency.artifact,
                    after: error instanceof Error ? error.message : String(error),
                  });
                  break;
                }
                if (current.revision !== dependency.fingerprint) {
                  changes.push({
                    dependency: dependency.task.id,
                    reason: 'Required artifact revision changed',
                    before: dependency.artifact,
                    after: ref(current),
                  });
                  break;
                }
              }
            }
          }
          if (changes.length === 0 && policy?.reuse) {
            const reuse = await withContext(true, ctx =>
              policy.reuse!(ctx, task.params, candidate.artifact, policyState, {
                originInvocation: candidate.originInvocation,
                key: candidate.key,
              }),
            );
            assert(
              reuse && typeof reuse.allow === 'boolean' && typeof reuse.reason === 'string',
              'Policy reuse must return an allow decision and a reason',
            );
            if (!reuse.allow)
              changes.push({
                dependency: 'policy',
                reason: reuse.reason,
                before: candidate.originInvocation,
              });
          }
          if (changes.length === 0) {
            for (const dependency of candidate.dependencies) addDependency(dependency);
            record.decisions.push(...candidate.decisions);
            record.diagnostics.push(...candidate.diagnostics);
            record.metrics.push(...candidate.metrics);
            if (this.state.trace === 'full') record.checkpoints.push(...candidate.checkpoints);
            record.cache = {
              status: 'hit',
              reason:
                'Algorithm, parameters, schema, and every recorded dependency match; current acceptance policy is checked separately',
              changes: [],
              key: candidate.key,
              originInvocation: candidate.originInvocation,
              checkedEntries: record.cache.checkedEntries,
            };
            await accept(candidate.artifact, true);
            this.compiler._touch(candidate);
            record.status = 'cached';
            record.output = ref(candidate.artifact);
            this.compiler._artifact(candidate.artifact);
            this.recordDerivations(
              [...candidate.derivations, ...policyDerivations],
              candidate.artifact,
              record,
            );
            return candidate.artifact;
          }
          if (firstChanges.length === 0) firstChanges = changes;
        }
        record.cache.changes = firstChanges;
        record.cache.reason = firstChanges.length
          ? firstChanges.map(c => `${c.dependency}: ${c.reason}`).join('; ')
          : (this.compiler._lost(task.id) ?? 'No previous cache entry');
      } else
        record.cache = {
          status: 'disabled',
          reason:
            pass.cache === false
              ? 'Pass declared noncacheable'
              : policy?.cache === false
                ? 'Acceptance policy requires algorithm execution'
                : 'Caching disabled for this run',
          changes: [],
          checkedEntries: 0,
        };

      const result = await withContext(false, ctx => pass.run(ctx, task.params));
      // Canonicalize before validation so caller-owned objects and executable values cannot enter storage.
      const value = immutable(result);
      kind.validate(value);
      assertNoError();
      const contentHash = fingerprint(value);
      const artifact: Artifact = immutable({
        id: task.id,
        kind: pass.kind,
        schemaVersion: kind.version,
        contentHash,
        revision: fingerprint({ kind: pass.kind, schemaVersion: kind.version, value }),
        value,
      });
      await accept(artifact, false);
      record.status = 'executed';
      record.output = ref(artifact);
      this.compiler._artifact(artifact);
      this.recordDerivations([...passDerivations, ...policyDerivations], artifact, record);
      if (!cacheEligible)
        record.cache = {
          status: 'disabled',
          reason:
            'A missing input or failed requirement was caught by this pass; fallback results are not cacheable',
          changes: record.cache.changes,
          checkedEntries: record.cache.checkedEntries,
        };
      if (this.cacheEnabled && pass.cache !== false && policy?.cache !== false && cacheEligible) {
        const key = fingerprint({
          task,
          passVersion: pass.version,
          schemaVersion: kind.version,
          dependencies: passDependencies,
        });
        record.cache.key = key;
        this.compiler._store({
          key,
          task,
          passVersion: pass.version,
          schemaVersion: kind.version,
          kind: pass.kind,
          artifact,
          dependencies: immutable(passDependencies),
          decisions: immutable(passDecisions),
          diagnostics: immutable(passDiagnostics),
          metrics: immutable(passMetrics),
          checkpoints: immutable(passCheckpoints),
          derivations: immutable(passDerivations),
          originInvocation: record.id,
          trace: this.state.trace,
          used: 0,
        });
      }
      return artifact;
    } catch (error) {
      this.failed = true;
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      record.diagnostics.push({ severity: 'error', code: 'PASS_FAILED', message: record.error });
      if (policy?.failed)
        try {
          await policy.failed(identity, task.params, policyState, error);
        } catch (failureError) {
          record.diagnostics.push({
            severity: 'warning',
            code: 'POLICY_FAILURE_HANDLER_FAILED',
            message: failureError instanceof Error ? failureError.message : String(failureError),
          });
        }
      throw new CompileError(`${task.id}: ${record.error}`, record.id, task.id, { cause: error });
    } finally {
      record.durationMs = performance.now() - start;
    }
  }

  private recordDerivations(
    mappings: PendingDerivation[],
    output: Artifact,
    invocation: InvocationRecord,
  ): void {
    for (const mapping of mappings) {
      const from = mapping.from.length ? mapping.from : [undefined];
      const to = mapping.to.length ? mapping.to : [undefined];
      // Equal-length arrays are explicit pairings; otherwise they denote many-to-many correspondence.
      const pairs =
        from.length === to.length ? from.map((f, i) => [f, to[i]]) : from.flatMap(f => to.map(t => [f, t]));
      for (const [sourceEntity, targetEntity] of pairs) {
        this.compiler._derive({
          source: { ...mapping.source, ...(sourceEntity === undefined ? {} : { entity: sourceEntity }) },
          target: { ...ref(output), ...(targetEntity === undefined ? {} : { entity: targetEntity }) },
          relation: mapping.relation,
          invocationId: invocation.id,
          runId: this.id,
        });
      }
    }
  }
}
