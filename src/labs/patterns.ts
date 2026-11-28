import { canonical, fingerprint, immutable } from '../framework/core/data.js';
import type { EntityTarget, IREntity, IRRef, RevisionRef, VersionRef } from '../framework/ir/types.js';
import { compareText, syncFunction, synchronous } from '../framework/ir/common.js';
import { readIR } from '../framework/ir/readers.js';
import type { IRReader } from '../framework/ir/readers.js';
/** Patterns are finite data. Callback code lives in a separately versioned registry. */
export type NodePattern =
  | {
      readonly type: 'entity';
      readonly kind?: string;
      readonly attributes?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'op';
      readonly name: string;
      readonly operands: readonly NodePattern[];
    }
  | {
      readonly type: 'capture';
      readonly name: string;
      readonly pattern: NodePattern;
    }
  | {
      readonly type: 'same-as';
      readonly name: string;
    };
export type PatternCondition =
  | {
      readonly type: 'distinct';
      readonly names: readonly string[];
    }
  | {
      readonly type: 'equal-content';
      readonly names: readonly string[];
    }
  | {
      readonly type: 'relation';
      readonly kind: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly type: 'predicate';
      readonly predicate: VersionRef;
      readonly params: unknown;
    };
export type PatternDescriptor =
  | {
      readonly type: 'node';
      readonly node: NodePattern;
      readonly conditions: readonly PatternCondition[];
    }
  | {
      readonly type: 'graph';
      readonly nodes: Readonly<Record<string, NodePattern>>;
      readonly conditions: readonly PatternCondition[];
    };
export type PatternInput = NodePattern | PatternDescriptor | PatternBuilder;
function name(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300)
    throw new Error(label + ' must be a nonempty string of at most 300 characters');
}
function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(label + ' must be a record');
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error(label + ' must be a plain record');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !('value' in Object.getOwnPropertyDescriptor(value, key)!))
      throw new Error(label + ' cannot contain symbols or accessors');
  }
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(label + ' contains unsupported field ' + key);
}
function checkedRef(ref: VersionRef): VersionRef {
  record(ref, 'Predicate reference');
  keys(ref as unknown as Record<string, unknown>, ['id', 'version'], 'Predicate reference');
  name(ref.id, 'Predicate ID');
  name(ref.version, 'Predicate version');
  return immutable(ref);
}
export function entity(kind?: string, attributes?: Readonly<Record<string, unknown>>): NodePattern {
  if (kind !== undefined) name(kind, 'Entity kind');
  if (attributes !== undefined) record(attributes, 'Entity attributes');
  return immutable({
    type: 'entity',
    ...(kind === undefined ? {} : { kind }),
    ...(attributes === undefined ? {} : { attributes }),
  });
}
export function op(operation: string, ...operands: NodePattern[]): NodePattern {
  name(operation, 'Operation name');
  return immutable({
    type: 'op',
    name: operation,
    operands,
  });
}
export function capture(captureName: string, inner: NodePattern = entity()): NodePattern {
  name(captureName, 'Capture name');
  return immutable({
    type: 'capture',
    name: captureName,
    pattern: inner,
  });
}
export function sameAs(captureName: string): NodePattern {
  name(captureName, 'Capture name');
  return immutable({
    type: 'same-as',
    name: captureName,
  });
}
export function distinct(...names: string[]): PatternCondition {
  return nameCondition('distinct', names);
}
export function equalContent(...names: string[]): PatternCondition {
  return nameCondition('equal-content', names);
}
function nameCondition(type: 'distinct' | 'equal-content', names: string[]): PatternCondition {
  if (names.length < 2) throw new Error(type + ' requires at least two captures');
  names.forEach(value => name(value, 'Capture name'));
  return immutable({
    type,
    names,
  });
}
/** Relationship names are adapter-declared types, never an untyped graph edge. */
export function relation(kind: string, from: string, to: string): PatternCondition {
  name(kind, 'Relation kind');
  name(from, 'Source capture');
  name(to, 'Target capture');
  return immutable({
    type: 'relation',
    kind,
    from,
    to,
  });
}
export function where(predicate: VersionRef, params: unknown = {}): PatternCondition {
  return immutable({
    type: 'predicate',
    predicate: checkedRef(predicate),
    params,
  });
}
export class PatternBuilder {
  readonly descriptor: PatternDescriptor;
  constructor(descriptor: PatternDescriptor) {
    this.descriptor = validateDescriptor(descriptor);
    Object.freeze(this);
  }
  where(condition: PatternCondition): PatternBuilder {
    return new PatternBuilder({
      ...this.descriptor,
      conditions: [...this.descriptor.conditions, condition],
    });
  }
  toJSON(): PatternDescriptor {
    return this.descriptor;
  }
}
export function pattern(nodes: NodePattern | Readonly<Record<string, NodePattern>>): PatternBuilder {
  record(nodes, 'Pattern');
  return new PatternBuilder(
    typeof (nodes as NodePattern).type === 'string'
      ? {
          type: 'node',
          node: nodes as NodePattern,
          conditions: [],
        }
      : {
          type: 'graph',
          nodes: nodes as Readonly<Record<string, NodePattern>>,
          conditions: [],
        },
  );
}
export function describePattern(input: PatternInput): PatternDescriptor {
  if (input instanceof PatternBuilder) return input.descriptor;
  record(input, 'Pattern');
  return validateDescriptor(
    input.type === 'graph' || input.type === 'node'
      ? (input as PatternDescriptor)
      : {
          type: 'node',
          node: input as NodePattern,
          conditions: [],
        },
  );
}
function validateDescriptor(input: PatternDescriptor): PatternDescriptor {
  record(input, 'Pattern');
  const declared = new Set<string>(),
    referenced = new Set<string>();
  let count = 0;
  function node(value: NodePattern, depth: number): void {
    if (++count > 1000 || depth > 100) throw new Error('Pattern structure exceeds 1000 nodes or depth 100');
    record(value, 'Node pattern');
    switch (value.type) {
      case 'entity':
        keys(value, ['type', 'kind', 'attributes'], 'Entity pattern');
        if (value.kind !== undefined) name(value.kind, 'Entity kind');
        if (value.attributes !== undefined) {
          record(value.attributes, 'Entity attribute pattern');
          canonical(value.attributes);
        }
        break;
      case 'op':
        keys(value, ['type', 'name', 'operands'], 'Operation pattern');
        name(value.name, 'Operation name');
        if (!Array.isArray(value.operands)) throw new Error('Operation operands must be an array');
        value.operands.forEach(child => node(child, depth + 1));
        break;
      case 'capture':
        keys(value, ['type', 'name', 'pattern'], 'Capture pattern');
        name(value.name, 'Capture name');
        declared.add(value.name);
        node(value.pattern, depth + 1);
        break;
      case 'same-as':
        keys(value, ['type', 'name'], 'Identity pattern');
        name(value.name, 'Capture name');
        referenced.add(value.name);
        break;
      default:
        throw new Error(
          'Unknown node pattern type ' +
            String(
              (
                value as {
                  type?: unknown;
                }
              ).type,
            ),
        );
    }
  }
  if (input.type === 'node') {
    keys(input, ['type', 'node', 'conditions'], 'Node pattern descriptor');
    node(input.node, 0);
  } else if (input.type === 'graph') {
    keys(input, ['type', 'nodes', 'conditions'], 'Graph pattern descriptor');
    record(input.nodes, 'Graph pattern nodes');
    const entries = Object.entries(input.nodes);
    if (!entries.length || entries.length > 100)
      throw new Error('Graph patterns require between 1 and 100 named nodes');
    for (const [key, value] of entries) {
      name(key, 'Graph capture');
      declared.add(key);
      node(value, 0);
    }
  } else throw new Error('Unknown pattern descriptor type');
  if (!Array.isArray(input.conditions) || input.conditions.length > 1000)
    throw new Error('Pattern conditions must be an array of at most 1000 conditions');
  for (const condition of input.conditions) {
    record(condition, 'Pattern condition');
    switch (condition.type) {
      case 'distinct':
      case 'equal-content':
        keys(condition, ['type', 'names'], 'Capture condition');
        if (!Array.isArray(condition.names) || condition.names.length < 2)
          throw new Error('Capture conditions require at least two names');
        condition.names.forEach(value => {
          name(value, 'Capture name');
          referenced.add(value);
        });
        break;
      case 'relation':
        keys(condition, ['type', 'kind', 'from', 'to'], 'Relation condition');
        name(condition.kind, 'Relation kind');
        name(condition.from, 'Source capture');
        name(condition.to, 'Target capture');
        referenced.add(condition.from);
        referenced.add(condition.to);
        break;
      case 'predicate':
        keys(condition, ['type', 'predicate', 'params'], 'Predicate condition');
        checkedRef(condition.predicate as VersionRef);
        canonical(condition.params);
        break;
      default:
        throw new Error('Unknown pattern condition type');
    }
  }
  for (const captureName of referenced)
    if (!declared.has(captureName)) throw new Error('Pattern references undeclared capture ' + captureName);
  return immutable(input);
}
export interface PatternPredicateContext<T = unknown> {
  readonly view: IRReader<T>;
  readonly bindings: Readonly<Record<string, IRRef>>;
}
export interface PatternPredicateDefinition<T = unknown, P = unknown> extends VersionRef {
  readonly description: string;
  test(
    context: PatternPredicateContext<T>,
    params: P,
  ):
    | boolean
    | {
        readonly pass: boolean;
        readonly reason: string;
      };
}
export interface PatternPredicateDescriptor extends VersionRef {
  readonly description: string;
}
/** A query snapshots these callbacks before evaluating any candidate. */
export class PatternPredicateRegistry {
  private definitions = new Map<string, PatternPredicateDefinition<any, any>>();
  register<T, P>(definition: PatternPredicateDefinition<T, P>): this {
    name(definition.id, 'Predicate ID');
    name(definition.version, 'Predicate version');
    name(definition.description, 'Predicate description');
    if (typeof definition.test !== 'function') throw new Error('Pattern predicate requires a test callback');
    syncFunction(definition.test, 'Pattern predicate');
    const key = canonical([definition.id, definition.version]);
    if (this.definitions.has(key)) throw new Error('Pattern predicate version is already registered: ' + key);
    this.definitions.set(
      key,
      Object.freeze({
        id: definition.id,
        version: definition.version,
        description: definition.description,
        test: definition.test,
      }),
    );
    return this;
  }
  get(reference: VersionRef): PatternPredicateDefinition<any, any> {
    const found = this.definitions.get(canonical([reference.id, reference.version]));
    if (!found) throw new Error('Unregistered pattern predicate ' + reference.id + '@' + reference.version);
    return found;
  }
  descriptors(): readonly PatternPredicateDescriptor[] {
    return immutable(
      [...this.definitions.values()]
        .map(({ id, version, description }) => ({
          id,
          version,
          description,
        }))
        .sort((a, b) => compareText(a.id + '@' + a.version, b.id + '@' + b.version)),
    );
  }
  snapshot(): PatternPredicateRegistry {
    const copy = new PatternPredicateRegistry();
    copy.definitions = new Map(this.definitions);
    return copy;
  }
}
export interface MatchEvidence {
  readonly code: string;
  readonly pass: boolean;
  readonly message: string;
  readonly entities: readonly IRRef[];
  readonly data?: unknown;
}
export interface PatternMatch {
  readonly formatVersion: 1;
  readonly key: string;
  readonly artifact: RevisionRef;
  readonly root: IRRef;
  readonly bindings: Readonly<Record<string, IRRef>>;
  readonly pattern: PatternDescriptor;
  readonly evidence: readonly MatchEvidence[];
  readonly steps: number;
}
export interface MatchOptions {
  /** Exact candidate roots. Omit to search all entities, including disconnected entities. */
  readonly roots?: readonly EntityTarget[];
  readonly order?: 'pre' | 'post' | 'breadth';
  /** Relationship names defining traversal order. Defaults to adapter containment. */
  readonly relations?: readonly string[];
  readonly maxSteps?: number;
  readonly maxMatches?: number;
  readonly registry?: PatternPredicateRegistry;
}
export interface MatchExplanation {
  readonly matched: boolean;
  readonly artifact: RevisionRef;
  readonly pattern: PatternDescriptor;
  readonly root?: IRRef;
  readonly bindings: Readonly<Record<string, IRRef>>;
  readonly evidence: readonly MatchEvidence[];
  readonly steps: number;
  readonly candidatesTested: number;
  readonly reason: string;
}
export interface PatternSearch {
  readonly matches: readonly PatternMatch[];
  readonly steps: number;
  readonly explanation: MatchExplanation;
}
export class PatternBudgetError extends Error {
  readonly code = 'IR_PATTERN_BUDGET';
  constructor(
    readonly budget: 'steps' | 'matches',
    readonly limit: number,
    readonly steps: number,
    readonly partial: readonly PatternMatch[],
  ) {
    super('Pattern ' + budget + ' budget exhausted at ' + limit + '; the query is incomplete');
    this.name = 'PatternBudgetError';
  }
}
function positive(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new Error(label + ' must be a positive safe integer');
  return result;
}
function isView(value: unknown): value is IRReader<any> {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as IRReader).resolve === 'function' &&
    typeof (value as IRReader).entities === 'function'
  );
}
function args(
  a: IRReader<any> | PatternInput,
  b: IRReader<any> | PatternInput,
): [IRReader<any>, PatternInput] {
  if (isView(a) && !isView(b)) return [a, b as PatternInput];
  if (isView(b) && !isView(a)) return [b, a as PatternInput];
  throw new Error('Pattern query requires exactly one IR view and one pattern');
}
function ownBindings(bindings: Map<string, IRRef>): Readonly<Record<string, IRRef>> {
  return immutable(Object.fromEntries([...bindings].sort(([a], [b]) => compareText(a, b))));
}
/** Selected relationship topology determines roots; containment is never silently conflated with dependency. */
export function orderedCandidates(
  view: IRReader<any>,
  order: 'pre' | 'post' | 'breadth' = 'pre',
  relations?: readonly string[],
): readonly IRRef[] {
  if (!['pre', 'post', 'breadth'].includes(order)) throw new Error('Unsupported pattern traversal order');
  const all = view.entities();
  if (
    relations !== undefined &&
    (!Array.isArray(relations) || relations.some(kind => !Object.hasOwn(view.descriptor.relationKinds, kind)))
  )
    throw new Error('Traversal ordering uses an undeclared relation kind');
  let roots: readonly IRRef[] | undefined;
  if (relations !== undefined) {
    const selected = new Set(relations),
      incoming = new Set(
        view
          .relations()
          .filter(edge => selected.has(edge.kind))
          .map(edge => edge.to),
      );
    roots = [...all.filter(ref => !incoming.has(ref.entity)), ...all];
  }
  const ordered = view
    .walk({
      order,
      maxNodes: Math.max(1, all.length),
      maxDepth: Math.max(1, all.length),
      ...(roots ? { roots } : {}),
      ...(relations === undefined ? {} : { relations }),
    })
    .map(visit => visit.ref);
  const seen = new Set(ordered.map(ref => ref.entity));
  return immutable([...ordered, ...all.filter(ref => !seen.has(ref.entity))]);
}
/** Detailed query result is useful when the host accounts for a shared algorithm budget. */
export function searchPattern(
  view: IRReader<any>,
  input: PatternInput,
  options: MatchOptions = {},
  firstOnly = false,
): PatternSearch {
  const descriptor = describePattern(input),
    registry = options.registry?.snapshot();
  const maxSteps = positive(options.maxSteps, 100000, 'Pattern step budget');
  const maxMatches = positive(options.maxMatches, 10000, 'Pattern match budget');
  const all = view.entities(),
    allIds = new Set(all.map(ref => ref.entity));
  const order = options.order ?? 'pre';
  if (!['pre', 'post', 'breadth'].includes(order)) throw new Error('Unsupported pattern traversal order');
  if (
    options.relations !== undefined &&
    (!Array.isArray(options.relations) ||
      options.relations.some(kind => !Object.hasOwn(view.descriptor.relationKinds, kind)))
  )
    throw new Error('Traversal ordering uses an undeclared relation kind');
  let ordered = options.roots
    ? options.roots.map(target => view.ref(target))
    : [...orderedCandidates(view, order, options.relations)];
  const seenRoots = new Set<string>();
  ordered = ordered.filter(ref => !seenRoots.has(ref.entity) && !!seenRoots.add(ref.entity));
  for (const condition of descriptor.conditions) {
    if (condition.type === 'relation' && !Object.hasOwn(view.descriptor.relationKinds, condition.kind))
      throw new Error('Pattern uses undeclared relation kind ' + condition.kind);
    if (condition.type === 'predicate') {
      if (!registry) throw new Error('Pattern requires a predicate registry');
      registry.get(condition.predicate);
    }
  }
  const artifact = {
    artifact: view.artifact.id,
    revision: view.artifact.revision,
  };
  const results: PatternMatch[] = [],
    seen = new Set<string>();
  let steps = 0,
    candidatesTested = 0,
    lastRoot: IRRef | undefined;
  let lastBindings: Readonly<Record<string, IRRef>> = {},
    lastEvidence: MatchEvidence[] = [];
  function tick(): void {
    if (steps >= maxSteps) throw new PatternBudgetError('steps', maxSteps, steps, immutable(results));
    steps++;
  }
  function evidence(
    out: MatchEvidence[],
    code: string,
    pass: boolean,
    message: string,
    entities: IRRef[],
    data?: unknown,
  ): boolean {
    out.push({
      code,
      pass,
      message,
      entities,
      ...(data === undefined ? {} : { data }),
    });
    return pass;
  }
  function bind(
    bindings: Map<string, IRRef>,
    captureName: string,
    ref: IRRef,
    out: MatchEvidence[],
    identity = false,
  ): boolean {
    tick();
    const previous = bindings.get(captureName),
      pass = !previous || previous.entity === ref.entity;
    if (pass) bindings.set(captureName, ref);
    return evidence(
      out,
      identity ? 'same-as' : 'capture',
      pass,
      (identity ? 'Identity constraint ' : 'Capture ') +
        captureName +
        (pass ? ' binds ' + ref.entity : ' conflicts with ' + previous!.entity),
      previous ? [previous, ref] : [ref],
      { name: captureName },
    );
  }
  function nodeMatches(
    node: NodePattern,
    ref: IRRef,
    bindings: Map<string, IRRef>,
    out: MatchEvidence[],
  ): boolean {
    tick();
    const value = view.resolve(ref);
    switch (node.type) {
      case 'entity': {
        const kindPass = node.kind === undefined || value.kind === node.kind;
        if (
          !evidence(
            out,
            'entity-kind',
            kindPass,
            kindPass ? 'Entity kind matches' : 'Expected ' + node.kind + ', received ' + value.kind,
            [ref],
            {
              actual: value.kind,
              ...(node.kind === undefined ? {} : { expected: node.kind }),
            },
          )
        )
          return false;
        for (const [key, expected] of Object.entries(node.attributes ?? {}).sort(([a], [b]) =>
          compareText(a, b),
        )) {
          tick();
          const exists = Object.hasOwn(value.attributes, key),
            pass = exists && canonical(value.attributes[key]) === canonical(expected);
          if (
            !evidence(
              out,
              'entity-attribute',
              pass,
              'Attribute ' + key + (pass ? ' matches' : ' differs or is missing'),
              [ref],
              {
                key,
                expected,
                ...(exists ? { actual: value.attributes[key] } : {}),
              },
            )
          )
            return false;
        }
        return true;
      }
      case 'capture':
        return bind(bindings, node.name, ref, out) && nodeMatches(node.pattern, ref, bindings, out);
      case 'same-as':
        return bind(bindings, node.name, ref, out, true);
      case 'op': {
        if (!view.capabilities.includes('Operations'))
          throw new Error('Operation patterns require the Operations adapter capability');
        const operation = view.operation(ref),
          pass = operation?.name === node.name;
        if (
          !evidence(
            out,
            'operation',
            pass,
            pass
              ? 'Operation ' + node.name + ' matches'
              : 'Operation name differs or entity is not an operation',
            [ref],
            {
              expected: node.name,
              actual: operation?.name ?? null,
            },
          )
        )
          return false;
        if (
          !evidence(
            out,
            'arity',
            operation!.operands.length === node.operands.length,
            'Expected ' + node.operands.length + ' ordered operands; received ' + operation!.operands.length,
            [ref],
          )
        )
          return false;
        for (let i = 0; i < node.operands.length; i++) {
          if (!allIds.has(operation!.operands[i]))
            throw new Error('Adapter operation refers to missing operand ' + operation!.operands[i]);
          if (!nodeMatches(node.operands[i], view.ref(operation!.operands[i]), bindings, out)) return false;
        }
        return true;
      }
    }
  }
  function content(ref: IRRef): unknown {
    const value = view.resolve(ref),
      operation = view.capabilities.includes('Operations') ? view.operation(ref) : undefined;
    return {
      kind: value.kind,
      attributes: value.attributes,
      ...(operation ? { operation } : {}),
    };
  }
  function conditions(bindings: Map<string, IRRef>, out: MatchEvidence[]): boolean {
    for (const condition of descriptor.conditions) {
      tick();
      if (condition.type === 'distinct' || condition.type === 'equal-content') {
        const refs = condition.names.map(captureName => {
          const value = bindings.get(captureName);
          if (!value) throw new Error('Capture was not bound: ' + captureName);
          return value;
        });
        const pass =
          condition.type === 'distinct'
            ? new Set(refs.map(ref => ref.entity)).size === refs.length
            : refs.every(ref => canonical(content(ref)) === canonical(content(refs[0])));
        if (
          !evidence(
            out,
            condition.type,
            pass,
            condition.names.join(', ') +
              (condition.type === 'distinct'
                ? ' are ' + (pass ? 'distinct' : 'not distinct')
                : ' have ' + (pass ? 'equal' : 'different') + ' logical content'),
            refs,
          )
        )
          return false;
      } else if (condition.type === 'relation') {
        const from = bindings.get(condition.from)!,
          to = bindings.get(condition.to)!;
        const edges = view
          .relations(from, 'outgoing')
          .filter(edge => edge.kind === condition.kind && edge.to === to.entity);
        if (
          !evidence(
            out,
            'relation',
            edges.length > 0,
            condition.kind +
              (edges.length ? ' relates ' : ' does not relate ') +
              condition.from +
              ' to ' +
              condition.to,
            [from, to],
            { relations: edges.map(edge => edge.id) },
          )
        )
          return false;
      } else {
        const definition = registry!.get(condition.predicate),
          result = synchronous(
            definition.test(
              Object.freeze({
                view: readIR(view),
                bindings: ownBindings(bindings),
              }),
              condition.params,
            ),
            'Pattern predicate',
          );
        if (
          typeof result !== 'boolean' &&
          (!result ||
            typeof result !== 'object' ||
            typeof result.pass !== 'boolean' ||
            typeof result.reason !== 'string')
        )
          throw new Error('Pattern predicate must return a boolean or {pass,reason}');
        const pass = typeof result === 'boolean' ? result : result.pass;
        if (
          !evidence(
            out,
            'predicate',
            pass,
            typeof result === 'boolean'
              ? definition.description + (pass ? ': accepted' : ': rejected')
              : result.reason,
            [...bindings.values()],
            {
              predicate: condition.predicate,
              params: condition.params,
            },
          )
        )
          return false;
      }
    }
    return true;
  }
  function failed(root: IRRef, bindings: Map<string, IRRef>, out: MatchEvidence[]): void {
    lastRoot = root;
    lastBindings = ownBindings(bindings);
    lastEvidence = out;
  }
  function accepted(root: IRRef, bindings: Map<string, IRRef>, out: MatchEvidence[]): boolean {
    const bound = ownBindings(bindings),
      key = fingerprint({
        pattern: descriptor,
        artifact,
        root,
        bindings: bound,
      });
    if (seen.has(key)) return false;
    if (results.length >= maxMatches)
      throw new PatternBudgetError('matches', maxMatches, steps, immutable(results));
    seen.add(key);
    results.push(
      immutable({
        formatVersion: 1,
        key,
        artifact,
        root,
        bindings: bound,
        pattern: descriptor,
        evidence: out,
        steps,
      }),
    );
    return firstOnly;
  }
  if (descriptor.type === 'node') {
    for (const root of ordered) {
      candidatesTested++;
      const bindings = new Map<string, IRRef>(),
        out: MatchEvidence[] = [];
      if (nodeMatches(descriptor.node, root, bindings, out) && conditions(bindings, out)) {
        if (accepted(root, bindings, out)) break;
      } else failed(root, bindings, out);
    }
  } else {
    const entries = Object.entries(descriptor.nodes).sort(([a], [b]) => compareText(a, b));
    function search(
      index: number,
      root: IRRef | undefined,
      previous: Map<string, IRRef>,
      priorEvidence: MatchEvidence[],
    ): boolean {
      if (index === entries.length) {
        const out = [...priorEvidence];
        if (conditions(previous, out)) return accepted(root!, previous, out);
        failed(root!, previous, out);
        return false;
      }
      const [captureName, node] = entries[index],
        bound = previous.get(captureName);
      const candidates = index === 0 ? ordered : bound ? [bound] : all;
      for (const candidate of candidates) {
        candidatesTested++;
        const bindings = new Map(previous),
          out = [...priorEvidence],
          first = root ?? candidate;
        if (bind(bindings, captureName, candidate, out) && nodeMatches(node, candidate, bindings, out)) {
          if (search(index + 1, first, bindings, out)) return true;
        } else failed(first, bindings, out);
      }
      return false;
    }
    search(0, undefined, new Map(), []);
  }
  const chosen = results[0];
  return immutable({
    matches: results,
    steps,
    explanation: {
      matched: !!chosen,
      artifact,
      pattern: descriptor,
      ...((chosen?.root ?? lastRoot) ? { root: chosen?.root ?? lastRoot } : {}),
      bindings: chosen?.bindings ?? lastBindings,
      evidence: chosen?.evidence ?? lastEvidence,
      steps,
      candidatesTested,
      reason: chosen
        ? 'Pattern matched with revision-specific bindings'
        : ordered.length
          ? 'No candidate satisfied the complete pattern'
          : 'The candidate selection is empty',
    },
  });
}
export function match(
  input: PatternInput,
  view: IRReader<any>,
  options?: MatchOptions,
): PatternMatch | undefined;
export function match(
  view: IRReader<any>,
  input: PatternInput,
  options?: MatchOptions,
): PatternMatch | undefined;
export function match(
  a: PatternInput | IRReader<any>,
  b: PatternInput | IRReader<any>,
  options?: MatchOptions,
): PatternMatch | undefined {
  const [view, input] = args(a, b);
  return searchPattern(view, input, options, true).matches[0];
}
export function matchAll(
  input: PatternInput,
  view: IRReader<any>,
  options?: MatchOptions,
): readonly PatternMatch[];
export function matchAll(
  view: IRReader<any>,
  input: PatternInput,
  options?: MatchOptions,
): readonly PatternMatch[];
export function matchAll(
  a: PatternInput | IRReader<any>,
  b: PatternInput | IRReader<any>,
  options?: MatchOptions,
): readonly PatternMatch[] {
  const [view, input] = args(a, b);
  return searchPattern(view, input, options).matches;
}
export function explainMatch(found: PatternMatch): MatchExplanation;
export function explainMatch(
  input: PatternInput,
  view: IRReader<any>,
  target?: EntityTarget,
  options?: MatchOptions,
): MatchExplanation;
export function explainMatch(
  view: IRReader<any>,
  input: PatternInput,
  target?: EntityTarget,
  options?: MatchOptions,
): MatchExplanation;
export function explainMatch(
  a: PatternMatch | PatternInput | IRReader<any>,
  b?: PatternInput | IRReader<any>,
  target?: EntityTarget,
  options: MatchOptions = {},
): MatchExplanation {
  if (b === undefined) {
    const found = a as PatternMatch;
    if (found?.formatVersion !== 1 || !found.bindings || !Array.isArray(found.evidence))
      throw new Error('explainMatch requires a match or a pattern and view');
    return immutable({
      matched: true,
      artifact: found.artifact,
      pattern: found.pattern,
      root: found.root,
      bindings: found.bindings,
      evidence: found.evidence,
      steps: found.steps,
      candidatesTested: 1,
      reason: 'Recorded matching evidence; references name the matched revision',
    });
  }
  const [view, input] = args(a as PatternInput | IRReader<any>, b);
  return searchPattern(
    view,
    input,
    {
      ...options,
      ...(target === undefined ? {} : { roots: [target] }),
    },
    true,
  ).explanation;
}
