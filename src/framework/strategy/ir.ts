import type { Json } from '../core/types.js';

/** Strategy IR is data. Executable functions live only in an external, versioned registry. */
export interface AlgorithmRef {
  readonly id: string;
  readonly version: string;
}
export type AlgorithmKind = 'transform' | 'analysis' | 'predicate' | 'selector' | 'invariant' | 'metrics';
export type ReferenceSource = 'input' | 'current' | 'binding' | 'item' | 'index' | 'iteration';
export interface Reference {
  readonly $ref: ReferenceSource;
  readonly name?: string;
  readonly path?: readonly (string | number)[];
}
/** Use literal() when literal input records themselves contain reserved $ref / $literal keys. */
export interface Literal {
  readonly $literal: Json;
}
export type Template =
  | Json
  | Reference
  | Literal
  | readonly Template[]
  | { readonly [key: string]: Template };
export interface NodeBase {
  readonly id: string;
  readonly bind?: string;
  readonly label?: string;
}
export interface CallOptions {
  readonly args?: Template;
  readonly input?: Template;
}
export interface ApplyNode extends NodeBase, CallOptions {
  readonly kind: 'apply';
  readonly algorithm: AlgorithmRef;
}
export interface SequenceNode extends NodeBase {
  readonly kind: 'sequence';
  readonly steps: readonly StrategyNode[];
}
export interface ParallelNode extends NodeBase {
  readonly kind: 'parallel';
  readonly steps: readonly StrategyNode[];
  readonly concurrency?: number;
}
export interface Branch {
  readonly name: string;
  readonly strategy: StrategyNode;
}
export interface ForkNode extends NodeBase {
  readonly kind: 'fork';
  readonly branches: readonly Branch[];
  readonly concurrency?: number;
}
export interface Objective {
  readonly metric: string;
  readonly direction: 'min' | 'max';
}
export interface Constraint {
  readonly metric: string;
  readonly op: '<=' | '>=' | '<' | '>' | '==';
  readonly value: number;
}
export interface ChooseNode extends NodeBase {
  readonly kind: 'chooseBest';
  readonly candidates: StrategyNode;
  readonly objective: Objective;
  readonly constraints: readonly Constraint[];
  readonly metrics?: AlgorithmRef;
  readonly args?: Template;
  /** Bind selection evidence independently of the winning value. */ readonly decisionAs?: string;
}
export interface ConditionalNode extends NodeBase, CallOptions {
  readonly kind: 'conditional';
  readonly predicate: AlgorithmRef;
  readonly then: StrategyNode;
  readonly else: StrategyNode;
}
export interface RepeatNode extends NodeBase {
  readonly kind: 'repeatUntilStable';
  readonly body: StrategyNode;
  readonly maxIterations: number;
  readonly identity?: AlgorithmRef;
}
export interface ForEachNode extends NodeBase, CallOptions {
  readonly kind: 'forEach';
  readonly body: StrategyNode;
  readonly selector?: AlgorithmRef;
  readonly items?: Template;
  readonly concurrency?: number;
  readonly maxItems: number;
}
export interface RequireNode extends NodeBase, CallOptions {
  readonly kind: 'require';
  readonly analysis: AlgorithmRef;
  readonly as: string;
}
export interface VerifyNode extends NodeBase, CallOptions {
  readonly kind: 'verify';
  readonly invariant: AlgorithmRef;
  readonly code?: string;
}
export interface CheckpointNode extends NodeBase {
  readonly kind: 'checkpoint';
  readonly name: string;
  readonly data?: Template;
}
export interface AttemptNode extends NodeBase {
  readonly kind: 'attempt';
  readonly body: StrategyNode;
  readonly fallback: StrategyNode;
  readonly codes?: readonly string[];
}
export interface ScopeNode extends NodeBase {
  readonly kind: 'scope';
  readonly name: string;
  readonly body: StrategyNode;
}
export type StrategyNode =
  | ApplyNode
  | SequenceNode
  | ParallelNode
  | ForkNode
  | ChooseNode
  | ConditionalNode
  | RepeatNode
  | ForEachNode
  | RequireNode
  | VerifyNode
  | CheckpointNode
  | AttemptNode
  | ScopeNode;
export interface StrategyPlan {
  readonly formatVersion: 1;
  readonly id: string;
  readonly root: StrategyNode;
  readonly description?: string;
  /** Transitive host dependencies that remain pinned even when direct call nodes are edited. */ readonly requirements?: readonly AlgorithmRef[];
}
export type NodeKind = StrategyNode['kind'];
export interface Verification {
  readonly ok: boolean;
  readonly reason?: string;
  readonly evidence?: unknown;
}
export interface Rejection {
  readonly code: string;
  readonly message: string;
  readonly evidence?: unknown;
}
export interface Candidate {
  readonly name: string;
  readonly status: 'succeeded' | 'rejected';
  readonly value?: unknown;
  readonly rejection?: Rejection;
}
export interface CandidateSet {
  readonly kind: 'strategy.candidates';
  readonly candidates: readonly Candidate[];
}
export interface CandidateEvaluation {
  readonly name: string;
  readonly status: 'feasible' | 'infeasible' | 'rejected';
  readonly metrics?: Readonly<Record<string, number>>;
  readonly violations?: readonly string[];
  readonly reason: string;
  readonly rejection?: Rejection;
  readonly selected: boolean;
}
export interface SelectionDecision {
  readonly nodeId: string;
  readonly objective: Objective;
  readonly constraints: readonly Constraint[];
  readonly tieBreak: string;
  readonly winner: string | null;
  readonly alternatives: readonly CandidateEvaluation[];
}

export interface ExecutionLink {
  readonly taskId: string;
  readonly invocationId?: string;
  readonly cache?: unknown;
  readonly artifact?: unknown;
}
export interface Evidence {
  readonly label: string;
  readonly data: unknown;
}
export type ExecutionStatus = 'running' | 'succeeded' | 'rejected' | 'failed' | 'cancelled' | 'skipped';
export interface NodeExecution {
  readonly id: string;
  readonly nodeId: string;
  readonly kind: NodeKind;
  readonly parentId?: string;
  readonly path: string;
  readonly status: ExecutionStatus;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly links: readonly ExecutionLink[];
  readonly evidence: readonly Evidence[];
  readonly children: readonly string[];
  readonly iteration?: number;
  readonly index?: number;
  readonly branch?: string;
  readonly error?: { readonly code: string; readonly message: string; readonly evidence?: unknown };
}
export interface TraceEvent {
  readonly sequence: number;
  readonly type: 'start' | 'finish' | 'evidence' | 'link' | 'skip';
  readonly executionId: string;
  readonly nodeId: string;
  readonly data?: unknown;
}
export interface StrategyExecution {
  readonly formatVersion: 1;
  readonly id: string;
  readonly plan: StrategyPlan;
  readonly planRevision: string;
  readonly registry: readonly {
    readonly id: string;
    readonly version: string;
    readonly kind: AlgorithmKind;
    readonly description: string;
  }[];
  readonly status: Exclude<ExecutionStatus, 'running' | 'skipped'>;
  readonly input: unknown;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string; readonly evidence?: unknown };
  readonly records: readonly NodeExecution[];
  readonly events: readonly TraceEvent[];
  readonly startedAt: number;
  readonly endedAt: number;
}
export interface AlgorithmContext {
  readonly signal: AbortSignal;
  readonly executionId: string;
  readonly nodeId: string;
  readonly path: string;
  link(link: ExecutionLink): void;
  record(label: string, data: unknown): void;
  reject(code: string, message: string, evidence?: unknown): never;
}
export interface StrategyAlgorithm {
  readonly id: string;
  readonly version: string;
  readonly kind: AlgorithmKind;
  readonly description: string;
  run(context: AlgorithmContext, input: unknown, args: unknown): unknown | Promise<unknown>;
}
export interface ExecuteOptions {
  readonly id?: string;
  readonly signal?: AbortSignal;
  /** Maximum node visits, including skipped nodes; also bounds trace record allocation. */
  readonly maxSteps?: number;
  readonly maxDepth?: number;
  readonly maxConcurrency?: number;
  readonly onEvent?: (event: TraceEvent) => void;
}
export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly nodeId?: string;
}
export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}
export interface NodeVisit {
  readonly node: StrategyNode;
  readonly parent?: StrategyNode;
  readonly path: string;
  readonly depth: number;
  readonly slot?: string;
}
export interface PlanChange {
  readonly type: 'added' | 'removed' | 'changed' | 'moved';
  readonly nodeId: string;
  readonly before?: unknown;
  readonly after?: unknown;
}
