import type { Artifact, EntityRef } from '../core/types.js';
export interface VersionRef {
  readonly id: string;
  readonly version: string;
}
export interface DefinitionBase extends VersionRef {
  readonly description: string;
}
export interface ValueType<T = unknown> extends DefinitionBase {
  readonly category: 'type';
  validate(value: unknown): asserts value is T;
}
export interface IRType<T = unknown> extends DefinitionBase {
  readonly category: 'ir';
  validate(value: unknown): asserts value is T;
}
export type PortType = ValueType<any> | IRType<any>;
export type Ports = Readonly<Record<string, PortType>>;
export type PortValue<T extends PortType> =
  T extends IRType<infer V> ? Artifact<V> : T extends ValueType<infer V> ? V : never;
export type PortValues<P extends Ports> = {
  readonly [K in keyof P]: PortValue<P[K]>;
};
export interface CheckResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly evidence?: unknown;
}
export interface ResourceStamp {
  readonly resource: string;
  readonly revision: string;
}
export interface ResourceValue extends ResourceStamp {
  readonly value: unknown;
}
export interface ResourceWrite {
  readonly resource: string;
  readonly value: unknown;
}
/** Synchronous snapshot reads and atomic synchronous commit; returned Promises are rejected.
 * The adapter must check all expected revisions and apply all writes, or apply none. */
export interface ResourcePort {
  read(resource: string): ResourceValue | undefined;
  commit(writes: readonly ResourceWrite[], expected: readonly ResourceStamp[]): void;
}
export interface EffectDefinition<T = unknown> extends DefinitionBase {
  readonly category: 'effect';
  readonly resource: string;
  readonly access: 'read' | 'write';
  readonly type: ValueType<T>;
}
export interface Correspondence {
  readonly id: string;
  readonly from: EntityRef;
  readonly to: EntityRef;
  readonly relation: string;
  readonly entities?: readonly {
    readonly from: readonly string[];
    readonly to: readonly string[];
  }[];
  readonly evidence: unknown;
}
export interface AnalysisDefinition<S = unknown, R = unknown> extends DefinitionBase {
  readonly category: 'analysis';
  readonly input: IRType<S>;
  readonly output: ValueType<R>;
  readonly effects: readonly EffectDefinition[];
  run(ctx: ContractContext, subject: Artifact<S>, params: unknown): R | Promise<R>;
  readonly transfer?: {
    readonly id: string;
    readonly version: string;
    verify(
      ctx: ContractContext,
      input: {
        from: Artifact<S>;
        to: Artifact<S>;
        record: AnalysisRecord<R>;
        correspondence: Correspondence;
      },
    ): CheckResult | Promise<CheckResult>;
  };
}
export interface PropertyDefinition<S = unknown> extends DefinitionBase {
  readonly category: 'property';
  readonly subject: IRType<S>;
  readonly check: AnalysisDefinition<S, CheckResult>;
  readonly proofVerifier?: AnalysisDefinition<S, CheckResult>;
}
export interface InvariantDefinition<P extends Ports = Ports> extends DefinitionBase {
  readonly category: 'invariant';
  readonly inputs: P;
  readonly effects: readonly EffectDefinition[];
  check(ctx: ContractContext, inputs: PortValues<P>): CheckResult | Promise<CheckResult>;
}
export interface ObjectiveDefinition<S = unknown> extends DefinitionBase {
  readonly category: 'objective';
  readonly analysis: AnalysisDefinition<S, number>;
  readonly direction: 'min' | 'max';
}
export interface PortSelector {
  readonly from: 'inputs' | 'outputs';
  readonly port: string;
}
export type Condition =
  | {
      readonly property: PropertyDefinition<any>;
      readonly subject: PortSelector;
    }
  | {
      readonly invariant: InvariantDefinition<any>;
      readonly bindings: Readonly<Record<string, PortSelector>>;
    };
export interface Preservation {
  readonly property: PropertyDefinition<any>;
  readonly from: string;
  readonly to: string;
  readonly mode: 'check' | 'transfer';
  readonly correspondence?: string;
}
export interface CorrespondenceRequirement {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation?: string;
}
export type CachePolicy = 'pure' | 'tracked' | 'never';
export interface TransformationDefinition<I extends Ports = Ports, O extends Ports = Ports>
  extends DefinitionBase {
  readonly category: 'transformation';
  readonly inputs: I;
  readonly outputs: O;
  readonly requires: readonly Condition[];
  readonly preserves: readonly Preservation[];
  readonly ensures: readonly Condition[];
  readonly establishes: readonly Condition[];
  readonly effects: readonly EffectDefinition[];
  readonly cache: CachePolicy;
  readonly correspondence: readonly CorrespondenceRequirement[];
  run?(
    ctx: ContractContext,
    inputs: PortValues<I>,
  ): TransformationBodyResult<O> | Promise<TransformationBodyResult<O>>;
}
export interface TransformationBodyResult<O extends Ports = Ports> {
  readonly outputs: PortValues<O>;
  readonly correspondence?: readonly Correspondence[];
}
export type AnyDefinition =
  | ValueType
  | IRType
  | AnalysisDefinition<any, any>
  | PropertyDefinition<any>
  | InvariantDefinition<any>
  | ObjectiveDefinition<any>
  | EffectDefinition
  | TransformationDefinition<any, any>;
export interface DefinitionDescriptor extends DefinitionBase {
  readonly category: AnyDefinition['category'];
  readonly schema: unknown;
}
export type Assurance = 'declared' | 'checked' | 'transferred' | 'proof';
export interface AnalysisDependency {
  readonly type: 'analysis';
  readonly key: string;
  readonly recordId: string;
}
export interface PropertyDependency {
  readonly type: 'property';
  readonly key: string;
  readonly factId: string;
}
export interface ResourceDependency {
  readonly type: 'resource';
  readonly resource: string;
  readonly revision: string;
  readonly view?: 'base' | 'staged';
}
export type Dependency = AnalysisDependency | PropertyDependency | ResourceDependency;
export interface AnalysisRecord<T = unknown> {
  readonly id: string;
  readonly key: string;
  readonly analysis: VersionRef;
  readonly subject: EntityRef;
  readonly subjectKind: string;
  readonly subjectSchemaVersion: string;
  readonly params: unknown;
  readonly value: T;
  readonly invalidationEpoch: number;
  readonly cacheable: boolean;
  readonly dependencies: readonly Dependency[];
  readonly assurance: 'checked' | 'transferred';
  readonly valid: boolean;
  readonly invalidation?: string;
  readonly generation: number;
  readonly transfer?: {
    readonly rule: VersionRef;
    readonly sourceRecord: string;
    readonly correspondence: Correspondence;
    readonly evidence: unknown;
  };
}
export interface PropertyFact {
  readonly id: string;
  readonly key: string;
  readonly property: VersionRef;
  readonly checker: VersionRef;
  readonly subject: EntityRef;
  readonly subjectKind: string;
  readonly subjectSchemaVersion: string;
  readonly ok: boolean;
  readonly invalidationEpoch: number;
  readonly assurance: Assurance;
  readonly valid: boolean;
  readonly reason: string;
  readonly evidence: unknown;
  readonly dependencies: readonly Dependency[];
  readonly analysisRecord?: string;
  readonly invalidation?: string;
}
export interface ContractEvent {
  readonly sequence: number;
  readonly type: string;
  readonly subject?: EntityRef;
  readonly definition?: VersionRef;
  readonly data: unknown;
}
export interface CheckEvidence {
  readonly phase: 'requires' | 'ensures' | 'establishes' | 'preserves' | 'correspondence' | 'query';
  readonly definition: VersionRef;
  readonly ok: boolean;
  readonly assurance: Assurance;
  readonly reason: string;
  readonly evidence: unknown;
  readonly subject?: EntityRef;
  readonly factId?: string;
}
export interface EffectAccess {
  readonly effect: VersionRef;
  readonly resource: string;
  readonly access: 'read' | 'write';
  readonly revision: string;
  readonly staged: boolean;
}
export interface ContractExecution {
  readonly id: string;
  readonly transformation: VersionRef;
  readonly descriptor: DefinitionDescriptor;
  readonly status: 'prepared' | 'accepted' | 'rejected' | 'failed' | 'rolled-back';
  readonly cached: boolean;
  readonly cacheReason: string;
  readonly inputs: unknown;
  readonly outputs?: unknown;
  readonly dependencies: readonly Dependency[];
  readonly bodyDependencies: readonly Dependency[];
  readonly bodyCacheable: boolean;
  readonly checks: readonly CheckEvidence[];
  readonly analyses: readonly string[];
  readonly facts: readonly string[];
  readonly effects: readonly EffectAccess[];
  readonly correspondence: readonly Correspondence[];
  readonly events: readonly ContractEvent[];
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly invocationId?: string;
  readonly runId?: string;
}
export interface ContractSnapshot {
  readonly formatVersion: 1;
  readonly definitions: readonly DefinitionDescriptor[];
  readonly analyses: readonly AnalysisRecord[];
  readonly facts: readonly PropertyFact[];
  readonly executions: readonly ContractExecution[];
  readonly events: readonly ContractEvent[];
}
export interface ContractContext {
  analysis<S, R>(analysis: AnalysisDefinition<S, R>, subject: Artifact<S>, params?: unknown): Promise<R>;
  check<S>(property: PropertyDefinition<S>, subject: Artifact<S>): Promise<PropertyFact>;
  checkInvariant<P extends Ports>(
    invariant: InvariantDefinition<P>,
    inputs: PortValues<P>,
  ): Promise<CheckEvidence>;
  require<S>(property: PropertyDefinition<S>, subject: Artifact<S>): Promise<PropertyFact>;
  properties(subject: Artifact): PropertyFact[];
  explainProperty<S>(property: PropertyDefinition<S>, subject: Artifact<S>): unknown;
  readResource<T>(effect: EffectDefinition<T>): T;
  writeResource<T>(effect: EffectDefinition<T>, value: T): void;
  record(label: string, data: unknown): void;
}
export interface ExecutionOptions {
  readonly id?: string;
  readonly invocationId?: string;
  readonly runId?: string;
  readonly cached?: boolean;
  readonly deferCommit?: boolean;
}
export interface PreparedTransformation<O extends Ports = Ports> {
  readonly outputs: PortValues<O>;
  readonly execution: ContractExecution;
  commit(): ContractExecution;
  rollback(reason?: string): void;
  fail(error: unknown): void;
}
export interface TransformationTransaction<I extends Ports = Ports, O extends Ports = Ports> {
  readonly inputs: PortValues<I>;
  readonly context: ContractContext;
  readonly execution: ContractExecution;
  settle(): Promise<void>;
  importBodyDependencies(dependencies: readonly Dependency[]): void;
  verify(
    outputs: PortValues<O>,
    correspondence?: readonly Correspondence[],
    options?: {
      cached?: boolean;
    },
  ): Promise<PreparedTransformation<O>>;
  rollback(reason?: string): void;
  fail(error: unknown): void;
}
