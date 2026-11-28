import type {
  Artifact,
  Checkpoint,
  Decision,
  Derivation,
  Diagnostic,
  EntityRef,
  IREdge,
  Metric,
  Task,
} from '../framework/core/types.js';

export interface InputDependency {
  type: 'input';
  key: string;
  fingerprint: string;
  value: unknown;
}
export interface TaskDependency {
  type: 'task';
  task: Task;
  artifact: EntityRef;
  fingerprint: string;
}
export type Dependency = InputDependency | TaskDependency;
export interface CacheChange {
  dependency: string;
  reason: string;
  before?: unknown;
  after?: unknown;
}
export interface CacheExplanation {
  status: 'hit' | 'miss' | 'disabled';
  reason: string;
  changes: CacheChange[];
  key?: string;
  originInvocation?: string;
  checkedEntries: number;
}
export interface InvocationRecord {
  id: string;
  runId: string;
  taskId: string;
  passId: string;
  passVersion: string;
  /** Acceptance policy applied for this invocation, independently of algorithm caching. */
  policy?: { id: string; version: string };
  role: 'transform' | 'analysis' | 'strategy';
  params: unknown;
  status: 'executed' | 'cached' | 'failed';
  startedAt: number;
  durationMs: number;
  output?: EntityRef;
  dependencies: Dependency[];
  /** Requests include failed child calls; distinct from successful value dependencies. */
  requests: string[];
  cache: CacheExplanation;
  decisions: Decision[];
  metrics: Metric[];
  diagnostics: Diagnostic[];
  checkpoints: Checkpoint[];
  error?: string;
}
export interface RunRecord {
  id: string;
  label: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'succeeded' | 'failed';
  inputs: Record<string, unknown>;
  roots: EntityRef[];
  trace: 'summary' | 'full';
  error?: string;
  /** Portable execution-layer records. The core assigns no domain or strategy semantics. */
  extensions?: Record<string, unknown>;
}
export interface PassDescriptor {
  id: string;
  version: string;
  kind: string;
  description: string;
  role: string;
  cache: boolean;
}
export interface KindDescriptor {
  id: string;
  version: string;
  description: string;
}
export interface DerivationRecord extends Derivation {
  invocationId: string;
  runId: string;
}
export interface DatabaseSnapshot {
  formatVersion: 1;
  runs: RunRecord[];
  passes: PassDescriptor[];
  kinds: KindDescriptor[];
  artifacts: Artifact[];
  invocations: InvocationRecord[];
  derivations: DerivationRecord[];
  structures: Record<string, IREdge[]>;
}
