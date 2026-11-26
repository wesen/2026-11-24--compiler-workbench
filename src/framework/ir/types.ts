import type { Artifact, Diagnostic, EntityRef } from '../core/types.js';
export interface VersionRef {
  readonly id: string;
  readonly version: string;
}
export interface RevisionRef {
  readonly artifact: string;
  readonly revision: string;
}
export interface IRRef extends EntityRef {
  readonly entity: string;
}
export type EntityTarget = string | IRRef;
/** IRWB-001 E1 adds 'control': control-flow successor edges (a CFG), distinct from containment and dataflow. */
export type RelationCategory =
  | 'containment'
  | 'dependency'
  | 'binding'
  | 'adjacency'
  | 'provenance'
  | 'control';
export type Capability =
  | 'Traversable'
  | 'Queryable'
  | 'Rewritable'
  | 'Diffable'
  | 'Verifiable'
  | 'Serializable'
  | 'Visualizable'
  | 'Operations';
/** A logical projection. Native domain storage remains owned by the adapter. */
export interface IREntity {
  readonly id: string;
  readonly kind: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}
export interface IRRelation {
  readonly id: string;
  readonly kind: string;
  readonly category: RelationCategory;
  readonly from: string;
  readonly to: string;
  readonly order?: number;
  readonly attributes?: Readonly<Record<string, unknown>>;
}
export interface IRGraph {
  readonly entities: readonly IREntity[];
  readonly relations: readonly IRRelation[];
  readonly roots: readonly string[];
}
export interface EntityDescription {
  readonly label: string;
  readonly detail?: string;
  readonly stats?: Readonly<Record<string, number | string>>;
}
export interface Operation {
  readonly name: string;
  readonly operands: readonly string[];
}
export interface IRVisualization {
  readonly kind: string;
  readonly data: unknown;
}
export interface IRAdapter<T = unknown> extends VersionRef {
  readonly kind: string;
  readonly schemaVersion: string;
  readonly description: string;
  readonly relationKinds: Readonly<Record<string, RelationCategory>>;
  entities(value: T): Iterable<IREntity>;
  resolve(value: T, entity: string): IREntity | undefined;
  relations(value: T): Iterable<IRRelation>;
  describe(value: T, entity: string): EntityDescription;
  roots?(value: T): readonly string[];
  validate?(value: unknown): void;
  /** Translate a validated logical edit back into this representation's native storage. */
  rebuild?(base: T, graph: IRGraph): T;
  operation?(value: T, entity: string): Operation | undefined;
  serialize?(value: T): string;
  deserialize?(text: string): T;
  visualize?(value: T, selection: readonly string[]): IRVisualization;
}
export interface AdapterDescriptor extends VersionRef {
  readonly kind: string;
  readonly schemaVersion: string;
  readonly description: string;
  readonly relationKinds: Readonly<Record<string, RelationCategory>>;
  readonly capabilities: readonly Capability[];
}
export interface WalkOptions {
  readonly order?: 'pre' | 'post' | 'breadth';
  readonly roots?: readonly EntityTarget[];
  readonly relations?: readonly string[];
  readonly direction?: 'outgoing' | 'incoming' | 'both';
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}
export interface WalkVisit {
  readonly ref: IRRef;
  readonly entity: IREntity;
  readonly depth: number;
  readonly via?: IRRelation;
}
export interface DependencyOptions {
  readonly transitive?: boolean;
  readonly relations?: readonly string[];
  readonly maxNodes?: number;
}
export interface SubgraphOptions {
  readonly closure?: 'none' | 'dependencies' | 'connected';
  readonly relations?: readonly string[];
  readonly maxNodes?: number;
}
export interface IRSubgraph extends IRGraph {
  readonly artifact: RevisionRef;
  readonly selection: readonly IRRef[];
}
export interface EntityChange {
  readonly entity: string;
  readonly kind: 'inserted' | 'removed' | 'updated';
  readonly before?: IREntity;
  readonly after?: IREntity;
}
export interface RelationChange {
  readonly relation: string;
  readonly kind: 'inserted' | 'removed' | 'updated';
  readonly before?: IRRelation;
  readonly after?: IRRelation;
}
export interface EditOperation {
  readonly kind: string;
  readonly data: unknown;
}
export interface ChangeSet {
  readonly from: RevisionRef;
  readonly to: RevisionRef;
  readonly entities: readonly EntityChange[];
  readonly relations: readonly RelationChange[];
  readonly roots?: {
    readonly before: readonly string[];
    readonly after: readonly string[];
  };
  readonly operations: readonly EditOperation[];
  readonly changed: boolean;
}
/** IRWB-001 E2: why a change is valid, separate from what it was made from (from/to).
 * `because` names entities or facts (e.g. `s:peak.4`, `fact:ranges(peak)@r5`); `note` is human-readable. */
export interface Reason {
  readonly because?: readonly string[];
  readonly note?: string;
}
export interface CorrespondenceEntry extends Reason {
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly relation: string;
}
export interface EntityCorrespondence {
  readonly formatVersion: 1;
  readonly from: RevisionRef;
  readonly to: RevisionRef;
  readonly sourceEntities: readonly string[];
  readonly targetEntities: readonly string[];
  readonly entries: readonly CorrespondenceEntry[];
}
export interface TraceStep {
  readonly from: RevisionRef;
  readonly to: RevisionRef;
  readonly before: readonly IRRef[];
  readonly after: readonly IRRef[];
  readonly removed: readonly IRRef[];
  readonly entries: readonly CorrespondenceEntry[];
}
export interface EntityTrace {
  readonly start: IRRef;
  readonly steps: readonly TraceStep[];
  readonly current: readonly IRRef[];
}
export interface TransformationResult<T = unknown> {
  readonly artifact: Artifact<T>;
  readonly changes: ChangeSet;
  readonly correspondence: EntityCorrespondence;
  readonly diagnostics: readonly Diagnostic[];
}
/** A host can stage semantic facts/effects while inspecting the provisional IR result. */
export interface EditAcceptance {
  commit(): void;
  rollback(reason?: string): void;
}
export interface EditOptions<T = unknown> {
  readonly label?: string;
  readonly verify?: (
    result: TransformationResult<T>,
    before: Artifact<T>,
  ) => EditAcceptance | Promise<EditAcceptance>;
}
export interface RelationSpec {
  readonly id?: string;
  readonly kind: string;
  readonly order?: number;
  readonly attributes?: Readonly<Record<string, unknown>>;
}
export interface RedirectOptions extends Reason {
  readonly relations?: readonly string[];
  readonly direction?: 'incoming' | 'outgoing' | 'both';
}
export interface IREdit<T = unknown> {
  readonly base: Artifact<T>;
  readonly state: 'open' | 'preparing' | 'prepared' | 'committed' | 'rolled-back' | 'failed';
  /** IRWB-004: the number of operations recorded so far (0: the edit is the identity). */
  readonly operationCount: number;
  // IRWB-001 E2: every edit takes an optional Reason, recorded in the operation log.
  insert(entity: IREntity, reason?: Reason): IRRef;
  replace(target: EntityTarget, entity: IREntity, reason?: Reason): void;
  remove(target: EntityTarget, reason?: Reason): void;
  update(target: EntityTarget, attributes: Readonly<Record<string, unknown>>, reason?: Reason): void;
  connect(from: EntityTarget, relation: string | RelationSpec, to: EntityTarget, reason?: Reason): string;
  disconnect(relationId: string, reason?: Reason): void;
  disconnect(from: EntityTarget, relationKind: string, to: EntityTarget, reason?: Reason): void;
  redirectReferences(from: EntityTarget, to: EntityTarget, options?: RedirectOptions): void;
  correspond(
    from: EntityTarget | readonly EntityTarget[],
    to: EntityTarget | readonly EntityTarget[],
    relation?: string,
    reason?: Reason,
  ): void;
  preview(): IRGraph;
  prepare(): TransformationResult<T>;
  commit(): Promise<TransformationResult<T>>;
  rollback(reason?: string): void;
}
export interface IRView<T = unknown> {
  readonly artifact: Artifact<T>;
  readonly adapter: IRAdapter<T>;
  readonly descriptor: AdapterDescriptor;
  readonly capabilities: readonly Capability[];
  ref(target: EntityTarget): IRRef;
  entities(): readonly IRRef[];
  resolve(target: EntityTarget): IREntity;
  describe(target: EntityTarget): EntityDescription;
  relations(target?: EntityTarget, direction?: 'incoming' | 'outgoing' | 'both'): readonly IRRelation[];
  operation(target: EntityTarget): Operation | undefined;
  walk(options?: WalkOptions): readonly WalkVisit[];
  children(target: EntityTarget): readonly IRRef[];
  parents(target: EntityTarget): readonly IRRef[];
  successors(target: EntityTarget, relation?: string | readonly string[]): readonly IRRef[];
  predecessors(target: EntityTarget, relation?: string | readonly string[]): readonly IRRef[];
  ancestors(
    target: EntityTarget,
    options?: {
      maxNodes?: number;
    },
  ): readonly IRRef[];
  dependencies(target: EntityTarget, options?: DependencyOptions): readonly IRRef[];
  subgraph(selection: readonly EntityTarget[], options?: SubgraphOptions): IRSubgraph;
  find(predicate: (entity: IREntity, ref: IRRef) => boolean): readonly IRRef[];
  graph(): IRGraph;
  serialize(): string;
  visualize(selection?: readonly EntityTarget[]): IRVisualization;
  beginEdit(options?: EditOptions<T>): IREdit<T>;
  /** Bind another retained revision through the same adapter and revision store. */
  at(artifact: Artifact<T>): IRView<T>;
}
