/** The shared protocol. All persisted values must be finite, acyclic JSON data. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Task<P = unknown> {
  readonly id: string;
  readonly pass: string;
  readonly params: P;
}

export interface Artifact<T = unknown> {
  readonly id: string;
  readonly revision: string;
  readonly contentHash: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly value: T;
}

export interface EntityRef { readonly artifact: string; readonly revision: string; readonly entity?: string }
export interface IREdge { readonly from: string; readonly to: string; readonly relation: string }

export interface IRKind<T = unknown> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  validate(value: unknown): asserts value is T;
  describe?(value: T): { label: string; stats?: Record<string, number | string> };
  structure?(value: T): IREdge[];
}

export interface Diagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  entities?: string[];
  data?: unknown;
}
export interface Decision {
  code: string;
  message: string;
  evidence?: unknown;
  alternatives?: Array<{ name: string; accepted: boolean; reason: string; metrics?: Record<string, number> }>;
}
export interface Derivation {
  source: EntityRef;
  target: EntityRef;
  relation: string;
}
export interface Metric { name: string; value: number; unit?: string }
export interface Checkpoint { label: string; data: unknown }

export interface PassContext extends PassInvocationIdentity {
  /** Reads only this run's immutable input snapshot and records the dependency. */
  read<T>(key: string): T;
  /** Resolves a task and records both its request and the exact artifact revision. */
  require<T>(task: Task): Promise<Artifact<T>>;
  decision(decision: Decision): void;
  diagnostic(diagnostic: Diagnostic): void;
  metric(name: string, value: number, unit?: string): void;
  checkpoint(label: string, data: unknown): void;
  /** Explicit entity correspondence; omitted entity lists mean whole artifacts. */
  derive(source: Artifact, mapping?: { from?: string[]; to?: string[]; relation?: string }): void;
}

export interface Pass<P = unknown, T = unknown> {
  readonly id: string;
  readonly version: string;
  readonly kind: string;
  readonly description: string;
  readonly role?: 'transform' | 'analysis' | 'strategy';
  readonly cache?: boolean;
  run(context: PassContext, params: P): T | Promise<T>;
}

/** Identity of one invocation, including an invocation that reuses an algorithm result. */
export interface PassInvocationIdentity {
  readonly runId: string;
  readonly invocationId: string;
  readonly task: Task;
  readonly passVersion: string;
}

/** Policy reads are tracked for inspection, independently of the algorithm's cache key.
 * A policy always runs again, so cached algorithm output cannot bypass a current check.
 */
export interface PassPolicyContext extends PassContext, PassInvocationIdentity {}
export interface PassPolicyResult { readonly cached: boolean }
export interface PassPolicyCacheCandidate { readonly originInvocation: string; readonly key: string }
export interface PassPolicyReuse { readonly allow: boolean; readonly reason: string }

/** An optional, domain-independent acceptance boundary around an existing pass.
 * `after` verifies a provisional artifact. `committed` atomically accepts any staged
 * policy state immediately before publication; it must be synchronous and must not
 * start work. `failed` discards staged state and retains failure evidence. These hooks
 * run on both cache hits and new executions, and never become cached pass decisions.
 */
export interface PassPolicy<S = unknown> {
  readonly id: string;
  readonly version: string;
  /** False forces the algorithm to execute; useful for policies governing write effects. */
  readonly cache?: boolean;
  before?(context: PassPolicyContext, params: unknown): S | Promise<S>;
  /** Revalidate computation dependencies owned by an extension, such as resource reads.
   * False is a cache miss: execute the algorithm again, then check its fresh output.
   */
  reuse?(context: PassPolicyContext, params: unknown, artifact: Artifact, state: S | undefined, candidate: PassPolicyCacheCandidate): PassPolicyReuse | Promise<PassPolicyReuse>;
  after?(context: PassPolicyContext, params: unknown, artifact: Artifact, state: S | undefined, result: PassPolicyResult): void | Promise<void>;
  committed?(context: PassInvocationIdentity, params: unknown, artifact: Artifact, state: S | undefined, result: PassPolicyResult): void;
  failed?(context: PassInvocationIdentity, params: unknown, state: S | undefined, error: unknown): void | Promise<void>;
}

/** Domain registration accepts this narrow port, never compiler implementation details. */
export interface Registry {
  registerKind<T>(kind: IRKind<T>): void;
  register<P, T>(pass: Pass<P, T>): void;
}

export function task<P>(id: string, pass: string, params: P): Task<P> { return { id, pass, params }; }

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function finite(value: unknown, name: string): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value), `${name} must be finite`);
}

export function positive(value: unknown, name: string): asserts value is number {
  finite(value, name);
  assert(value > 0, `${name} must be positive`);
}
