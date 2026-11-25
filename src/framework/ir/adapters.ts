import { canonical, fingerprint, immutable } from '../core/data.js';
import type { Artifact } from '../core/types.js';
import type { AdapterDescriptor, Capability, IRAdapter, IREntity, IRGraph, IRRelation } from './types.js';
import { compareText, IRError, requireRecord, requireText, synchronous, syncFunction } from './common.js';
const categories = new Set(['containment', 'dependency', 'binding', 'adjacency', 'provenance']);
const captured = new WeakSet<object>();
const requiredFunctions = ['entities', 'resolve', 'relations', 'describe'] as const;
const optionalFunctions = [
  'roots',
  'validate',
  'rebuild',
  'operation',
  'serialize',
  'deserialize',
  'visualize',
] as const;
/** Snapshot metadata and callable identities; native storage is never converted in place. */
export function defineAdapter<T>(definition: IRAdapter<T>): IRAdapter<T> {
  if (captured.has(definition)) return definition;
  if (!definition || typeof definition !== 'object')
    throw new IRError('ir.adapter', 'Expected an adapter definition');
  const prototype = Object.getPrototypeOf(definition);
  if (prototype !== Object.prototype && prototype !== null)
    throw new IRError(
      'ir.adapter',
      'Adapter definitions must be plain records with own callback properties; wrap class methods explicitly',
    );
  for (const key of Reflect.ownKeys(definition)) {
    if (typeof key !== 'string' || !('value' in Object.getOwnPropertyDescriptor(definition, key)!))
      throw new IRError('ir.adapter', 'Adapter definitions require own data properties');
  }
  for (const key of ['id', 'version', 'kind', 'schemaVersion', 'description'] as const)
    requireText(definition[key], `Adapter ${key}`);
  requireRecord(definition.relationKinds, 'Adapter relation kinds');
  for (const [name, category] of Object.entries(definition.relationKinds)) {
    requireText(name, 'Relation name');
    if (!categories.has(category)) throw new IRError('ir.adapter', `Unknown relation category ${category}`);
  }
  for (const name of requiredFunctions)
    if (typeof definition[name] !== 'function') throw new IRError('ir.adapter', `Adapter requires ${name}`);
  for (const name of [...requiredFunctions, ...optionalFunctions]) {
    if (definition[name] !== undefined && typeof definition[name] !== 'function')
      throw new IRError('ir.adapter', `Adapter ${name} must be callable`);
    // Entity/relation enumerators may be synchronous generators.
    if (definition[name] && !['entities', 'relations'].includes(name))
      syncFunction(definition[name]!, `Adapter ${name}`);
  }
  if (definition.rebuild && !definition.validate)
    throw new IRError('ir.adapter', 'Rewritable adapters require a native value validator');
  if (Boolean(definition.serialize) !== Boolean(definition.deserialize))
    throw new IRError('ir.adapter', 'Serializable adapters require serialize and deserialize together');
  const result = Object.freeze({
    ...definition,
    relationKinds: immutable(definition.relationKinds),
  });
  captured.add(result);
  return result;
}
export function describeAdapter(adapter: IRAdapter<any>): AdapterDescriptor {
  const a = defineAdapter(adapter);
  const capabilities: Capability[] = ['Traversable', 'Queryable', 'Diffable'];
  if (a.rebuild) capabilities.push('Rewritable');
  if (a.validate) capabilities.push('Verifiable');
  if (a.serialize) capabilities.push('Serializable');
  if (a.visualize) capabilities.push('Visualizable');
  if (a.operation) capabilities.push('Operations');
  return immutable({
    id: a.id,
    version: a.version,
    kind: a.kind,
    schemaVersion: a.schemaVersion,
    description: a.description,
    relationKinds: a.relationKinds,
    capabilities,
  });
}
export class AdapterRegistry {
  #adapters = new Map<string, IRAdapter<any>>();
  register<T>(definition: IRAdapter<T>): IRAdapter<T> {
    const adapter = defineAdapter(definition),
      key = canonical([adapter.id, adapter.version]);
    const old = this.#adapters.get(key);
    if (old && old !== adapter) {
      const same =
        canonical(describeAdapter(old)) === canonical(describeAdapter(adapter)) &&
        [...requiredFunctions, ...optionalFunctions].every(k => old[k] === adapter[k]);
      if (!same)
        throw new IRError(
          'ir.adapter-version',
          `Adapter ${adapter.id}@${adapter.version} is already registered with another definition`,
        );
      return old;
    }
    this.#adapters.set(key, adapter);
    return adapter;
  }
  get<T = unknown>(id: string, version: string): IRAdapter<T> {
    const result = this.#adapters.get(canonical([id, version]));
    if (!result) throw new IRError('ir.adapter-missing', `Unknown adapter ${id}@${version}`);
    return result;
  }
  describe(): readonly AdapterDescriptor[] {
    return immutable(
      [...this.#adapters.values()]
        .map(describeAdapter)
        .sort((a, b) => compareText(a.id, b.id) || compareText(a.version, b.version)),
    );
  }
}
export function createIRArtifact<T>(definition: IRAdapter<T>, id: string, value: T): Artifact<T> {
  const adapter = defineAdapter(definition);
  requireText(id, 'Artifact ID');
  const snapshot = immutable(value);
  if (adapter.validate) synchronous(adapter.validate(snapshot), 'Adapter validation');
  const artifact = immutable({
    id,
    kind: adapter.kind,
    schemaVersion: adapter.schemaVersion,
    value: snapshot,
    contentHash: fingerprint(snapshot),
    revision: fingerprint({
      kind: adapter.kind,
      schemaVersion: adapter.schemaVersion,
      value: snapshot,
    }),
  });
  project(adapter, artifact.value);
  return artifact;
}
export function validateIRArtifact<T>(definition: IRAdapter<T>, artifact: Artifact<T>): Artifact<T> {
  const adapter = defineAdapter(definition),
    snapshot = immutable(artifact);
  requireText(snapshot.id, 'Artifact ID');
  if (snapshot.kind !== adapter.kind || snapshot.schemaVersion !== adapter.schemaVersion)
    throw new IRError('ir.kind', `Adapter ${adapter.id} requires ${adapter.kind}@${adapter.schemaVersion}`);
  if (
    snapshot.contentHash !== fingerprint(snapshot.value) ||
    snapshot.revision !==
      fingerprint({
        kind: snapshot.kind,
        schemaVersion: snapshot.schemaVersion,
        value: snapshot.value,
      })
  )
    throw new IRError('ir.revision', 'Artifact content/revision hash does not match its value');
  if (adapter.validate) synchronous(adapter.validate(snapshot.value), 'Adapter validation');
  return snapshot;
}
export function validateEntity(entity: IREntity): IREntity {
  const e = immutable(entity);
  requireText(e.id, 'Entity ID');
  requireText(e.kind, 'Entity kind');
  requireRecord(e.attributes, 'Entity attributes');
  if (Object.keys(e).some(k => !['id', 'kind', 'attributes'].includes(k)))
    throw new IRError('ir.entity', 'Entity projection permits only id, kind and attributes');
  return e;
}
export function validateGraph(adapter: IRAdapter<any>, input: IRGraph): IRGraph {
  const graph = immutable(input);
  if (!Array.isArray(graph.entities) || !Array.isArray(graph.relations) || !Array.isArray(graph.roots))
    throw new IRError('ir.graph', 'Expected entities, relations and roots arrays');
  const entities = new Set<string>(),
    relations = new Set<string>();
  for (const e of graph.entities) {
    validateEntity(e);
    if (entities.has(e.id)) throw new IRError('ir.entity', `Duplicate entity ${e.id}`);
    entities.add(e.id);
  }
  for (const r of graph.relations) {
    requireText(r.id, 'Relation ID');
    requireText(r.kind, 'Relation kind');
    if (!Object.hasOwn(adapter.relationKinds, r.kind) || adapter.relationKinds[r.kind] !== r.category)
      throw new IRError('ir.relation', `Undeclared or mistyped relation ${r.kind}`);
    if (!entities.has(r.from) || !entities.has(r.to))
      throw new IRError('ir.relation', `Dangling relation ${r.id}: ${r.from} -> ${r.to}`);
    if (relations.has(r.id)) throw new IRError('ir.relation', `Duplicate relation ${r.id}`);
    if (r.order !== undefined && (!Number.isSafeInteger(r.order) || r.order < 0))
      throw new IRError('ir.relation', `Invalid order on ${r.id}`);
    if (r.attributes !== undefined) requireRecord(r.attributes, 'Relation attributes');
    if (
      Object.keys(r).some(k => !['id', 'kind', 'category', 'from', 'to', 'order', 'attributes'].includes(k))
    )
      throw new IRError('ir.relation', `Unknown relation field on ${r.id}`);
    relations.add(r.id);
  }
  if (new Set(graph.roots).size !== graph.roots.length || graph.roots.some(r => !entities.has(r)))
    throw new IRError('ir.roots', 'Roots must be unique existing entity IDs');
  return immutable({
    entities: [...graph.entities].sort((a, b) => compareText(a.id, b.id)),
    relations: [...graph.relations].sort(compareRelations),
    roots: graph.roots,
  });
}
export function compareRelations(a: IRRelation, b: IRRelation): number {
  return (
    compareText(a.from, b.from) ||
    compareText(a.kind, b.kind) ||
    (a.order ?? 0) - (b.order ?? 0) ||
    compareText(a.id, b.id)
  );
}
export function project<T>(adapter: IRAdapter<T>, value: T): IRGraph {
  const entities = [...synchronous(adapter.entities(value), 'Entity enumeration')];
  const relations = [...synchronous(adapter.relations(value), 'Relation enumeration')];
  const incoming = new Set(relations.filter(r => r.category === 'containment').map(r => r.to));
  const roots = adapter.roots
    ? synchronous(adapter.roots(value), 'Root enumeration')
    : entities
        .filter(e => !incoming.has(e.id))
        .map(e => e.id)
        .sort(compareText);
  const graph = validateGraph(adapter, {
    entities,
    relations,
    roots,
  });
  for (const entity of graph.entities) {
    const resolved = synchronous(adapter.resolve(value, entity.id), 'Entity resolution');
    if (!resolved || canonical(validateEntity(resolved)) !== canonical(entity))
      throw new IRError('ir.resolve', `Adapter resolve disagrees with enumeration for ${entity.id}`);
  }
  return graph;
}
export function deserializeIR<T>(adapter: IRAdapter<T>, id: string, text: string): Artifact<T> {
  const a = defineAdapter(adapter);
  if (!a.deserialize) throw new IRError('ir.capability', `Adapter ${a.id} is not Serializable`);
  return createIRArtifact(a, id, synchronous(a.deserialize(text), 'IR deserialization'));
}
