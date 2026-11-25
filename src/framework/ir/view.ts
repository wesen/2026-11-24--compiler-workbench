import { canonical, immutable } from '../core/data.js';
import type { Artifact } from '../core/types.js';
import type {
  AdapterDescriptor,
  Capability,
  DependencyOptions,
  EditOptions,
  EntityDescription,
  EntityTarget,
  IRAdapter,
  IREdit,
  IREntity,
  IRGraph,
  IRRef,
  IRRelation,
  IRSubgraph,
  IRView,
  IRVisualization,
  Operation,
  SubgraphOptions,
  WalkOptions,
  WalkVisit,
} from './types.js';
import { defineAdapter, describeAdapter, project, validateIRArtifact } from './adapters.js';
import { IRError, requireText, synchronous } from './common.js';
import { IRStore } from './store.js';
import { Edit } from './transactions.js';
import * as traversal from './traversal.js';
class View<T> implements IRView<T> {
  readonly artifact: Artifact<T>;
  readonly adapter: IRAdapter<T>;
  readonly descriptor: AdapterDescriptor;
  readonly capabilities: readonly Capability[];
  #graph: IRGraph;
  #entities: Map<string, IREntity>;
  #store: IRStore;
  constructor(artifact: Artifact<T>, adapter: IRAdapter<T>, store: IRStore, graph?: IRGraph) {
    this.adapter = defineAdapter(adapter);
    this.artifact = validateIRArtifact(this.adapter, artifact);
    const retained = store.get<T>({
      artifact: this.artifact.id,
      revision: this.artifact.revision,
    });
    if (canonical(retained) !== canonical(this.artifact))
      throw new IRError('ir.revision', 'View artifact differs from its retained revision');
    this.#store = store;
    this.#graph = graph ?? project(this.adapter, this.artifact.value);
    this.#entities = new Map(this.#graph.entities.map(e => [e.id, e]));
    this.descriptor = describeAdapter(this.adapter);
    this.capabilities = this.descriptor.capabilities;
    Object.freeze(this);
  }
  ref(target: EntityTarget): IRRef {
    const id = typeof target === 'string' ? target : target?.entity;
    requireText(id, 'Entity reference');
    if (
      typeof target !== 'string' &&
      (target.artifact !== this.artifact.id || target.revision !== this.artifact.revision)
    )
      throw new IRError('ir.stale-ref', `Entity reference ${id} belongs to another artifact revision`);
    if (!this.#entities.has(id))
      throw new IRError('ir.entity-missing', `Unknown entity ${id} in ${this.artifact.id}`);
    return immutable({
      artifact: this.artifact.id,
      revision: this.artifact.revision,
      entity: id,
    });
  }
  entities(): readonly IRRef[] {
    return immutable(this.#graph.entities.map(e => this.ref(e.id)));
  }
  resolve(target: EntityTarget): IREntity {
    return this.#entities.get(this.ref(target).entity)!;
  }
  describe(target: EntityTarget): EntityDescription {
    const value = immutable(
      synchronous(this.adapter.describe(this.artifact.value, this.ref(target).entity), 'Entity description'),
    );
    requireText(value.label, 'Entity description label');
    return value;
  }
  relations(
    target?: EntityTarget,
    direction: 'incoming' | 'outgoing' | 'both' = 'both',
  ): readonly IRRelation[] {
    if (!['incoming', 'outgoing', 'both'].includes(direction))
      throw new IRError('ir.relation', 'Invalid relation direction');
    if (target === undefined) return this.#graph.relations;
    const id = this.ref(target).entity;
    return Object.freeze(
      this.#graph.relations.filter(
        r => (direction !== 'incoming' && r.from === id) || (direction !== 'outgoing' && r.to === id),
      ),
    );
  }
  operation(target: EntityTarget): Operation | undefined {
    const id = this.ref(target).entity;
    if (!this.adapter.operation) return undefined;
    const value = synchronous(this.adapter.operation(this.artifact.value, id), 'Operation projection');
    if (value === undefined) return undefined;
    const operation = immutable(value);
    requireText(operation.name, 'Operation name');
    if (!Array.isArray(operation.operands))
      throw new IRError('ir.operation', 'Operation operands must be an ordered entity list');
    operation.operands.forEach(id => this.ref(id));
    return operation;
  }
  walk(options?: WalkOptions): readonly WalkVisit[] {
    return traversal.walk(this, options);
  }
  children(target: EntityTarget): readonly IRRef[] {
    return traversal.children(this, target);
  }
  parents(target: EntityTarget): readonly IRRef[] {
    return traversal.parents(this, target);
  }
  successors(target: EntityTarget, relation?: string | readonly string[]): readonly IRRef[] {
    return traversal.successors(this, target, relation);
  }
  predecessors(target: EntityTarget, relation?: string | readonly string[]): readonly IRRef[] {
    return traversal.predecessors(this, target, relation);
  }
  ancestors(
    target: EntityTarget,
    options?: {
      maxNodes?: number;
    },
  ): readonly IRRef[] {
    return traversal.ancestors(this, target, options);
  }
  dependencies(target: EntityTarget, options?: DependencyOptions): readonly IRRef[] {
    return traversal.dependencies(this, target, options);
  }
  subgraph(selection: readonly EntityTarget[], options?: SubgraphOptions): IRSubgraph {
    return traversal.subgraph(this, selection, options);
  }
  find(predicate: (entity: IREntity, ref: IRRef) => boolean): readonly IRRef[] {
    if (typeof predicate !== 'function') throw new IRError('ir.query', 'Find requires a predicate');
    return immutable(
      this.#graph.entities
        .filter(e => {
          const answer = synchronous(predicate(e, this.ref(e.id)), 'Find predicate');
          if (typeof answer !== 'boolean')
            throw new IRError('ir.query', 'Find predicates must return a boolean');
          return answer;
        })
        .map(e => this.ref(e.id)),
    );
  }
  graph(): IRGraph {
    return this.#graph;
  }
  serialize(): string {
    if (!this.adapter.serialize)
      throw new IRError('ir.capability', `Adapter ${this.adapter.id} is not Serializable`);
    const value = synchronous(this.adapter.serialize(this.artifact.value), 'IR serialization');
    if (typeof value !== 'string') throw new IRError('ir.serialize', 'Serializer must return text');
    return value;
  }
  visualize(selection: readonly EntityTarget[] = this.entities()): IRVisualization {
    if (!this.adapter.visualize)
      throw new IRError('ir.capability', `Adapter ${this.adapter.id} is not Visualizable`);
    const value = immutable(
      synchronous(
        this.adapter.visualize(
          this.artifact.value,
          selection.map(r => this.ref(r).entity),
        ),
        'IR visualization',
      ),
    );
    requireText(value.kind, 'Visualization kind');
    return value;
  }
  beginEdit(options?: EditOptions<T>): IREdit<T> {
    return new Edit(this, this.#store, options);
  }
  at(artifact: Artifact<T>): IRView<T> {
    return new View(artifact, this.adapter, this.#store);
  }
}
export function openIR<T>(
  artifact: Artifact<T>,
  adapter: IRAdapter<T>,
  store: IRStore = new IRStore(),
): IRView<T> {
  const captured = defineAdapter(adapter),
    snapshot = validateIRArtifact(captured, artifact),
    graph = project(captured, snapshot.value);
  store.retain(snapshot);
  return new View(snapshot, captured, store, graph);
}
