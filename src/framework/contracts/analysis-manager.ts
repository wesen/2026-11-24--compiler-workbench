import { canonical, fingerprint, immutable } from '../core/data.js';
import type { Artifact, EntityRef } from '../core/types.js';
import { entityPresence } from '../ir/diff.js';
import {
  Check,
  DEFAULT_CORRESPONDENCE_COVERAGE,
  JsonValue,
  definitionRef,
  describeDefinition,
  validateArtifact,
} from './definitions.js';
import { MemoryResources } from './effects.js';
import { ContractRegistry } from './registry.js';
import type {
  AnalysisDefinition,
  AnalysisRecord,
  Assurance,
  CheckEvidence,
  CheckResult,
  Condition,
  ContractContext,
  ContractEvent,
  ContractExecution,
  ContractSnapshot,
  Correspondence,
  CorrespondenceRequirement,
  Dependency,
  EffectAccess,
  EffectDefinition,
  ExecutionOptions,
  InvariantDefinition,
  IRType,
  ObjectiveDefinition,
  PortValues,
  Ports,
  PreparedTransformation,
  PropertyDefinition,
  PropertyFact,
  ResourcePort,
  ResourceStamp,
  ResourceWrite,
  TransformationDefinition,
  TransformationTransaction,
  VersionRef,
} from './types.js';
export class ContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContractError';
  }
}
interface Store {
  analyses: Map<string, AnalysisRecord>;
  facts: Map<string, PropertyFact>;
  analysisHistory: Map<string, AnalysisRecord>;
  factHistory: Map<string, PropertyFact>;
  resourceView?: Map<string, ResourceWrite>;
}
interface Frame {
  allowed: readonly EffectDefinition[];
  deps: Dependency[];
  stack: readonly string[];
  store: Store;
  events: ContractEvent[];
  effects: EffectAccess[];
  writes: Map<string, ResourceWrite>;
  expected: Map<string, ResourceStamp>;
  analyses: Set<string>;
  facts: Set<string>;
  active: boolean;
  cacheable: boolean;
  pending: Set<Promise<unknown>>;
  bodyToken?: {
    open: boolean;
  };
  parent?: Frame;
}
interface CacheEntry {
  outputs: unknown;
  correspondence: readonly Correspondence[];
  dependencies: readonly Dependency[];
}
type MutableExecution = {
  -readonly [K in keyof ContractExecution]: ContractExecution[K];
};
const ref = (a: Artifact): EntityRef => ({
  artifact: a.id,
  revision: a.revision,
});
const sameRef = (a: EntityRef, b: Artifact) => a.artifact === b.id && a.revision === b.revision;
const subjectKey = (a: Artifact) =>
  canonical({
    id: a.id,
    revision: a.revision,
    kind: a.kind,
    schemaVersion: a.schemaVersion,
  });
const uniquePush = (items: Dependency[], dependency: Dependency) => {
  if (!items.some(d => canonical(d) === canonical(dependency))) items.push(immutable(dependency));
};
const checkResult = (v: unknown): CheckResult => {
  Check.validate(v);
  return immutable(v);
};
/** Revision-specific semantic facts, dependency-aware analyses and transactional verification. */
export class AnalysisManager {
  readonly registry: ContractRegistry;
  readonly resources: ResourcePort;
  private readonly store: Store = {
    analyses: new Map(),
    facts: new Map(),
    analysisHistory: new Map(),
    factHistory: new Map(),
  };
  private readonly executions: MutableExecution[] = [];
  private readonly events: ContractEvent[] = [];
  private readonly epochs = new Map<string, number>();
  private readonly activeFrames = new Map<string, Frame>();
  private readonly transformCache = new Map<string, CacheEntry>();
  private serial = 0;
  constructor(registry = new ContractRegistry(), resources: ResourcePort = new MemoryResources()) {
    if (!resources || typeof resources.read !== 'function' || typeof resources.commit !== 'function')
      throw new ContractError(
        'resource-port',
        'Resource port requires synchronous read and commit functions',
      );
    if (
      resources.read.constructor.name === 'AsyncFunction' ||
      resources.commit.constructor.name === 'AsyncFunction'
    )
      throw new ContractError('async-resource-port', 'Resource reads and atomic commits must be synchronous');
    this.registry = registry;
    this.resources = resources;
  }
  private snapshotArtifact<S>(subject: Artifact<S>, type?: IRType<S>): Artifact<S> {
    const captured = immutable(subject);
    if (
      !captured ||
      typeof captured !== 'object' ||
      typeof captured.kind !== 'string' ||
      !captured.kind.trim() ||
      typeof captured.schemaVersion !== 'string' ||
      !captured.schemaVersion.trim()
    )
      throw new ContractError('artifact', 'Expected a versioned artifact');
    const ir =
      type ??
      (this.registry.has(
        {
          id: captured.kind,
          version: captured.schemaVersion,
        },
        'ir',
      )
        ? this.registry.get<IRType<S>>(
            {
              id: captured.kind,
              version: captured.schemaVersion,
            },
            'ir',
          )
        : {
            id: captured.kind,
            version: captured.schemaVersion,
            category: 'ir' as const,
            description: 'Artifact envelope',
            validate: JsonValue.validate,
          });
    validateArtifact(ir, captured);
    return captured;
  }
  private id(prefix: string) {
    return `${prefix}-${++this.serial}`;
  }
  private event(
    frame: Frame | undefined,
    type: string,
    data: unknown,
    definition?: VersionRef,
    subject?: EntityRef,
  ) {
    const e = immutable({
      sequence: this.events.length + 1,
      type,
      data,
      ...(definition ? { definition: definitionRef(definition) } : {}),
      ...(subject ? { subject } : {}),
    });
    this.events.push(e);
    frame?.events.push(e);
  }
  canReuseDependencies(dependencies: readonly Dependency[]): boolean {
    return this.validDependencies(dependencies, this.store) && this.reusable(dependencies, this.store);
  }
  private freshFrame(allowed: readonly EffectDefinition[], store = this.store, parent?: Frame): Frame {
    return {
      allowed,
      deps: [],
      stack: [],
      store,
      events: parent?.events ?? [],
      effects: parent?.effects ?? [],
      writes: parent?.writes ?? new Map(),
      expected: parent?.expected ?? new Map(),
      analyses: parent?.analyses ?? new Set(),
      facts: parent?.facts ?? new Set(),
      active: true,
      cacheable: true,
      pending: new Set(),
      ...(parent ? { parent } : {}),
    };
  }
  private epochKey(
    definition: VersionRef,
    subject: {
      id: string;
      revision: string;
      kind: string;
      schemaVersion: string;
    },
  ) {
    return canonical({
      definition: definitionRef(definition),
      id: subject.id,
      revision: subject.revision,
      kind: subject.kind,
      schemaVersion: subject.schemaVersion,
    });
  }
  private epoch(definition: VersionRef, subject: Artifact) {
    return this.epochs.get(this.epochKey(definition, subject)) ?? 0;
  }
  private epochValid(record: AnalysisRecord | PropertyFact) {
    const definition = 'analysis' in record ? record.analysis : record.property,
      key = this.epochKey(definition, {
        id: record.subject.artifact,
        revision: record.subject.revision,
        kind: record.subjectKind,
        schemaVersion: record.subjectSchemaVersion,
      });
    return record.invalidationEpoch === (this.epochs.get(key) ?? 0);
  }
  private analysisKey(d: AnalysisDefinition<any, any>, a: Artifact, params: unknown) {
    return fingerprint({
      analysis: definitionRef(d),
      input: definitionRef(d.input),
      output: definitionRef(d.output),
      subject: subjectKey(a),
      params,
    });
  }
  private propertyKey(d: PropertyDefinition<any>, a: Artifact) {
    return fingerprint({
      property: definitionRef(d),
      checker: definitionRef(d.check),
      subject: subjectKey(a),
    });
  }
  private lookupAnalysis(key: string, store: Store) {
    return store.analyses.get(key) ?? this.store.analyses.get(key);
  }
  private lookupFact(key: string, store: Store) {
    return store.facts.get(key) ?? this.store.facts.get(key);
  }
  private resourceRevision(resource: string, store: Store, view?: 'base' | 'staged', commit = false): string {
    const staged = !(commit && view === 'base') ? store.resourceView?.get(resource) : undefined;
    return staged ? fingerprint(staged.value) : (this.resources.read(resource)?.revision ?? 'missing');
  }
  private validDependencies(
    dependencies: readonly Dependency[],
    store: Store,
    seen = new Set<string>(),
    commit = false,
  ): boolean {
    for (const d of dependencies) {
      if (d.type === 'resource') {
        if (this.resourceRevision(d.resource, store, d.view, commit) !== d.revision) return false;
      } else if (d.type === 'analysis') {
        const key = `a:${d.recordId}`;
        if (seen.has(key)) return false;
        const r = commit
          ? (store.analysisHistory.get(d.recordId) ?? this.store.analysisHistory.get(d.recordId))
          : this.lookupAnalysis(d.key, store);
        if (!r || r.id !== d.recordId || !r.valid || !this.epochValid(r)) return false;
        const next = new Set(seen);
        next.add(key);
        if (!this.validDependencies(r.dependencies, store, next, commit)) return false;
      } else {
        const key = `p:${d.factId}`;
        if (seen.has(key)) return false;
        const f = commit
          ? (store.factHistory.get(d.factId) ?? this.store.factHistory.get(d.factId))
          : this.lookupFact(d.key, store);
        if (!f || f.id !== d.factId || !f.valid || !this.epochValid(f)) return false;
        const next = new Set(seen);
        next.add(key);
        if (!this.validDependencies(f.dependencies, store, next, commit)) return false;
      }
    }
    return true;
  }
  private isActive(frame: Frame): boolean {
    for (let current: Frame | undefined = frame; current; current = current.parent)
      if (!current.active) return false;
    return true;
  }
  private checkActive(frame: Frame) {
    if (!this.isActive(frame)) throw new ContractError('closed-context', 'Contract context is closed');
  }
  private effectAllowed(frame: Frame, effect: EffectDefinition, access: 'read' | 'write') {
    this.checkActive(frame);
    this.registry.register(effect);
    if (effect.access !== access)
      throw new ContractError('effect-access', `Effect ${effect.id} does not permit ${access}`);
    for (let f: Frame | undefined = frame; f; f = f.parent)
      if (
        !f.allowed.some(
          e =>
            e.id === effect.id &&
            e.version === effect.version &&
            e.access === access &&
            e.resource === effect.resource,
        )
      )
        throw new ContractError(
          'undeclared-effect',
          `${access} of ${effect.resource} is not declared by the active contract`,
        );
  }
  private recordResource(
    frame: Frame,
    effect: EffectDefinition,
    access: 'read' | 'write',
    revision: string,
    staged: boolean,
  ) {
    frame.effects.push(
      immutable({
        effect: definitionRef(effect),
        resource: effect.resource,
        access,
        revision,
        staged,
      }),
    );
    if (!frame.expected.has(effect.resource))
      frame.expected.set(effect.resource, {
        resource: effect.resource,
        revision: this.resources.read(effect.resource)?.revision ?? 'missing',
      });
    if (access === 'read')
      uniquePush(frame.deps, {
        type: 'resource',
        resource: effect.resource,
        revision,
        view: staged ? 'staged' : 'base',
      });
    this.event(
      frame,
      `resource.${access}`,
      {
        resource: effect.resource,
        revision,
        staged,
      },
      effect,
    );
  }
  private context(frame: Frame, token = { open: true }): ContractContext {
    const ensure = () => {
      if (!token.open) throw new ContractError('closed-context', 'Contract context is sealed');
      this.checkActive(frame);
    };
    const track = <T>(promise: Promise<T>): Promise<T> => {
      frame.pending.add(promise);
      void promise.then(
        () => frame.pending.delete(promise),
        () => {
          frame.pending.delete(promise);
          if (this.isActive(frame)) {
            frame.cacheable = false;
            this.event(frame, 'cache.disabled', { reason: 'A requested semantic dependency failed' });
          }
        },
      );
      return promise;
    };
    return {
      analysis: <S, R>(d: AnalysisDefinition<S, R>, a: Artifact<S>, params: unknown = null) => {
        ensure();
        return track(this.analyseInternal(d, a, params, frame).then(r => r.value));
      },
      check: <S>(d: PropertyDefinition<S>, a: Artifact<S>) => {
        ensure();
        return track(this.checkInternal(d, a, frame));
      },
      checkInvariant: <P extends Ports>(d: InvariantDefinition<P>, values: PortValues<P>) => {
        ensure();
        return track(this.invariantInternal(d, values, frame));
      },
      require: <S>(d: PropertyDefinition<S>, a: Artifact<S>) => {
        ensure();
        return track(
          this.checkInternal(d, a, frame).then(f => {
            if (!f.ok || f.assurance === 'declared')
              throw new ContractError('property-required', `${d.id} failed: ${f.reason}`);
            return f;
          }),
        );
      },
      properties: a => {
        ensure();
        frame.cacheable = false;
        this.event(frame, 'cache.disabled', {
          reason: 'Property-set introspection observes presence and absence of facts',
        });
        return this.propertiesInternal(a, frame.store);
      },
      explainProperty: (d, a) => {
        ensure();
        frame.cacheable = false;
        this.event(frame, 'cache.disabled', {
          reason: 'Property explanation introspection observes fact-store state',
        });
        return this.explainInternal(d, a, frame.store);
      },
      readResource: <T>(effect: EffectDefinition<T>): T => {
        ensure();
        this.effectAllowed(frame, effect, 'read');
        const staged = frame.writes.get(effect.resource),
          base = this.resources.read(effect.resource),
          current = staged
            ? {
                resource: effect.resource,
                revision: fingerprint(staged.value),
                value: staged.value,
              }
            : base;
        this.recordResource(frame, effect, 'read', current?.revision ?? 'missing', !!staged);
        if (!current) throw new ContractError('missing-resource', `Resource ${effect.resource} is missing`);
        effect.type.validate(current.value);
        return immutable(current.value) as T;
      },
      writeResource: <T>(effect: EffectDefinition<T>, value: T) => {
        ensure();
        this.effectAllowed(frame, effect, 'write');
        const captured = immutable(value);
        effect.type.validate(captured);
        const current = this.resources.read(effect.resource);
        frame.writes.set(effect.resource, {
          resource: effect.resource,
          value: captured,
        });
        this.recordResource(frame, effect, 'write', current?.revision ?? 'missing', true);
      },
      record: (label, data) => {
        ensure();
        this.event(frame, 'evidence', {
          label,
          data,
        });
      },
    };
  }
  private async drain(frame: Frame): Promise<void> {
    if (!frame.pending.size) return;
    await Promise.allSettled([...frame.pending]);
    throw new ContractError(
      'unawaited-analysis',
      'All requested analyses and property checks must be awaited before returning',
    );
  }
  private reusable(deps: readonly Dependency[], store: Store, seen = new Set<string>()): boolean {
    for (const d of deps) {
      if (d.type === 'analysis') {
        if (seen.has(d.recordId)) return false;
        const r = this.lookupAnalysis(d.key, store);
        if (!r || !r.cacheable || !this.reusable(r.dependencies, store, new Set([...seen, d.recordId])))
          return false;
      } else if (d.type === 'property') {
        const f = this.lookupFact(d.key, store);
        if (!f || !this.reusable(f.dependencies, store, seen)) return false;
      }
    }
    return true;
  }
  private replayPermissions(record: AnalysisRecord, frame: Frame, seen = new Set<string>()) {
    if (seen.has(record.id)) return;
    seen.add(record.id);
    const definition = this.registry.get<AnalysisDefinition<any, any>>(record.analysis, 'analysis');
    for (const dependency of record.dependencies) {
      if (dependency.type === 'resource') {
        const effect = definition.effects.find(
          e => e.resource === dependency.resource && e.access === 'read',
        );
        if (effect) {
          this.effectAllowed(frame, effect, 'read');
          this.recordResource(
            frame,
            effect,
            'read',
            dependency.revision,
            !!frame.writes.get(effect.resource),
          );
        } else if (!frame.allowed.some(e => e.resource === dependency.resource && e.access === 'read'))
          throw new ContractError(
            'undeclared-effect',
            `Cached analysis depends on undeclared resource ${dependency.resource}`,
          );
      } else if (dependency.type === 'analysis') {
        const child = this.lookupAnalysis(dependency.key, frame.store);
        if (child) this.replayPermissions(child, frame, seen);
      } else {
        const fact = this.lookupFact(dependency.key, frame.store);
        if (fact)
          for (const d of fact.dependencies)
            if (d.type === 'analysis') {
              const child = this.lookupAnalysis(d.key, frame.store);
              if (child) this.replayPermissions(child, frame, seen);
            }
      }
    }
  }
  async analyse<S, R>(
    definition: AnalysisDefinition<S, R>,
    subject: Artifact<S>,
    params: unknown = null,
  ): Promise<AnalysisRecord<R>> {
    return this.analyseInternal(definition, subject, params);
  }
  private async analyseInternal<S, R>(
    definition: AnalysisDefinition<S, R>,
    subject: Artifact<S>,
    params: unknown,
    parent?: Frame,
  ): Promise<AnalysisRecord<R>> {
    if (parent) this.checkActive(parent);
    this.registry.register(definition);
    subject = this.snapshotArtifact(subject, definition.input);
    const captured = immutable(params),
      epoch = this.epoch(definition, subject),
      key = this.analysisKey(definition, subject, captured),
      store = parent?.store ?? this.store;
    if (parent?.stack.includes(`a:${key}`))
      throw new ContractError('analysis-cycle', `Analysis dependency cycle involving ${definition.id}`);
    const current = this.lookupAnalysis(key, store);
    if (
      current &&
      current.cacheable &&
      current.valid &&
      this.epochValid(current) &&
      this.validDependencies(current.dependencies, store) &&
      this.reusable(current.dependencies, store)
    ) {
      if (parent) {
        this.replayPermissions(current, parent);
        uniquePush(parent.deps, {
          type: 'analysis',
          key,
          recordId: current.id,
        });
        parent.analyses.add(current.id);
      }
      this.event(
        parent,
        'analysis.reused',
        {
          recordId: current.id,
          reason: 'Exact revision, definition version and dependencies remain valid',
        },
        definition,
        ref(subject),
      );
      return current as AnalysisRecord<R>;
    }
    const frame = this.freshFrame(definition.effects, store, parent);
    frame.stack = [...(parent?.stack ?? []), `a:${key}`];
    try {
      const value = immutable(await definition.run(this.context(frame), immutable(subject), captured));
      await this.drain(frame);
      definition.output.validate(value);
      this.checkActive(frame);
      if (this.epoch(definition, subject) !== epoch)
        throw new ContractError('invalidated-analysis', 'Analysis was invalidated while it was computing');
      const record: AnalysisRecord<R> = immutable({
        id: `analysis-${fingerprint({
          key,
          value,
          epoch,
          deps: frame.deps,
          generation: (current?.generation ?? 0) + 1,
          cacheable: frame.cacheable,
        }).slice(0, 24)}`,
        key,
        analysis: definitionRef(definition),
        subject: ref(subject),
        subjectKind: subject.kind,
        subjectSchemaVersion: subject.schemaVersion,
        params: captured,
        value,
        invalidationEpoch: epoch,
        cacheable: frame.cacheable,
        dependencies: frame.deps,
        assurance: 'checked',
        valid: true,
        generation: (current?.generation ?? 0) + 1,
      });
      store.analyses.set(key, record);
      store.analysisHistory.set(record.id, record);
      frame.analyses.add(record.id);
      if (parent && !record.cacheable) parent.cacheable = false;
      if (parent)
        uniquePush(parent.deps, {
          type: 'analysis',
          key,
          recordId: record.id,
        });
      this.event(
        frame,
        'analysis.computed',
        {
          recordId: record.id,
          reason: current ? 'Previous dependencies or explicit validity changed' : 'No cached analysis',
        },
        definition,
        ref(subject),
      );
      return record;
    } finally {
      await Promise.allSettled([...frame.pending]);
      frame.active = false;
    }
  }
  hasAnalysis<S, R>(
    definition: AnalysisDefinition<S, R>,
    subject: Artifact<S>,
    params: unknown = null,
  ): boolean {
    this.registry.register(definition);
    validateArtifact(definition.input, subject);
    const record = this.lookupAnalysis(this.analysisKey(definition, subject, params), this.store);
    return (
      !!record &&
      record.cacheable &&
      record.valid &&
      this.epochValid(record) &&
      this.validDependencies(record.dependencies, this.store) &&
      this.reusable(record.dependencies, this.store)
    );
  }
  invalidate(
    definition: AnalysisDefinition<any, any> | PropertyDefinition<any>,
    subject: Artifact,
    reason = 'Explicit invalidation',
  ): number {
    const epochKey = this.epochKey(definition, subject);
    this.epochs.set(epochKey, (this.epochs.get(epochKey) ?? 0) + 1);
    let count = 0;
    const records = definition.category === 'analysis' ? this.store.analyses : this.store.facts;
    for (const [key, record] of records) {
      const d = 'analysis' in record ? record.analysis : record.property;
      if (d.id === definition.id && d.version === definition.version && sameRef(record.subject, subject)) {
        const next = immutable({
          ...record,
          valid: false,
          invalidation: reason,
        });
        if ('analysis' in next) {
          this.store.analyses.set(key, next);
          this.store.analysisHistory.set(next.id, next);
        } else {
          this.store.facts.set(key, next);
          this.store.factHistory.set(next.id, next);
        }
        count++;
      }
    }
    this.event(
      undefined,
      'information.invalidated',
      {
        reason,
        count,
      },
      definition,
      ref(subject),
    );
    return count;
  }
  async check<S>(property: PropertyDefinition<S>, subject: Artifact<S>): Promise<PropertyFact> {
    return this.checkInternal(property, subject);
  }
  private async checkInternal<S>(
    property: PropertyDefinition<S>,
    subject: Artifact<S>,
    parent?: Frame,
  ): Promise<PropertyFact> {
    if (parent) this.checkActive(parent);
    this.registry.register(property);
    subject = this.snapshotArtifact(subject, property.subject);
    const epoch = this.epoch(property, subject),
      key = this.propertyKey(property, subject),
      store = parent?.store ?? this.store;
    if (parent?.stack.includes(`p:${key}`))
      throw new ContractError('property-cycle', `Property dependency cycle involving ${property.id}`);
    const current = this.lookupFact(key, store);
    if (
      current &&
      current.assurance !== 'declared' &&
      current.valid &&
      this.epochValid(current) &&
      this.validDependencies(current.dependencies, store) &&
      this.reusable(current.dependencies, store)
    ) {
      if (parent) {
        for (const d of current.dependencies)
          if (d.type === 'analysis') {
            const a = this.lookupAnalysis(d.key, store);
            if (a) this.replayPermissions(a, parent);
          }
        uniquePush(parent.deps, {
          type: 'property',
          key,
          factId: current.id,
        });
        parent.facts.add(current.id);
      }
      this.event(
        parent,
        'property.reused',
        {
          factId: current.id,
          assurance: current.assurance,
        },
        property,
        ref(subject),
      );
      return current;
    }
    const frame = this.freshFrame(property.check.effects, store, parent);
    frame.stack = [...(parent?.stack ?? []), `p:${key}`];
    try {
      const analysis = await this.analyseInternal(property.check, subject, null, frame),
        result = checkResult(analysis.value);
      this.checkActive(frame);
      if (this.epoch(property, subject) !== epoch)
        throw new ContractError(
          'invalidated-property',
          'Property was invalidated while its checker was computing',
        );
      const fact: PropertyFact = immutable({
        id: `fact-${fingerprint({
          key,
          epoch,
          analysis: analysis.id,
          result,
          assurance: analysis.assurance,
        }).slice(0, 24)}`,
        key,
        property: definitionRef(property),
        checker: definitionRef(property.check),
        subject: ref(subject),
        subjectKind: subject.kind,
        subjectSchemaVersion: subject.schemaVersion,
        ok: result.ok,
        invalidationEpoch: epoch,
        assurance: analysis.assurance,
        valid: true,
        reason: result.reason ?? (result.ok ? 'Dynamically checked' : 'Checker rejected the proposition'),
        evidence: result.evidence ?? null,
        dependencies: frame.deps,
        analysisRecord: analysis.id,
      });
      store.facts.set(key, fact);
      store.factHistory.set(fact.id, fact);
      frame.facts.add(fact.id);
      if (parent)
        uniquePush(parent.deps, {
          type: 'property',
          key,
          factId: fact.id,
        });
      this.event(
        frame,
        'property.checked',
        {
          factId: fact.id,
          ok: fact.ok,
          assurance: fact.assurance,
        },
        property,
        ref(subject),
      );
      return fact;
    } finally {
      await Promise.allSettled([...frame.pending]);
      frame.active = false;
    }
  }
  properties(subject: Artifact): PropertyFact[] {
    return this.propertiesInternal(subject, this.store);
  }
  private propertiesInternal(subject: Artifact, store: Store): PropertyFact[] {
    subject = this.snapshotArtifact(subject);
    const all = new Map([...this.store.facts, ...store.facts]);
    return [...all.values()]
      .filter(
        f =>
          sameRef(f.subject, subject) &&
          f.subjectKind === subject.kind &&
          f.subjectSchemaVersion === subject.schemaVersion,
      )
      .map(f =>
        immutable({
          ...f,
          valid: f.valid && this.epochValid(f) && this.validDependencies(f.dependencies, store),
        }),
      );
  }
  explainProperty<S>(property: PropertyDefinition<S>, subject: Artifact<S>): unknown {
    return this.explainInternal(property, subject, this.store);
  }
  private explainInternal(property: PropertyDefinition<any>, subject: Artifact, store: Store) {
    this.registry.register(property);
    subject = this.snapshotArtifact(subject, property.subject);
    const fact = this.lookupFact(this.propertyKey(property, subject), store);
    return immutable({
      property: definitionRef(property),
      checker: definitionRef(property.check),
      subject: ref(subject),
      available: !!fact,
      valid:
        !!fact && fact.valid && this.epochValid(fact) && this.validDependencies(fact.dependencies, store),
      fact: fact ?? null,
      reason: !fact
        ? 'No fact for this exact property, checker version and artifact revision'
        : fact.assurance === 'declared'
          ? 'Declaration is not verification'
          : fact.valid && this.epochValid(fact) && this.validDependencies(fact.dependencies, store)
            ? 'Evidence and dependencies remain valid'
            : 'Evidence was invalidated or a dependency changed',
    });
  }
  declare<S>(property: PropertyDefinition<S>, subject: Artifact<S>, reason: string): PropertyFact {
    this.registry.register(property);
    validateArtifact(property.subject, subject);
    const epochKey = this.epochKey(property, subject);
    this.epochs.set(epochKey, (this.epochs.get(epochKey) ?? 0) + 1);
    const key = this.propertyKey(property, subject),
      fact: PropertyFact = immutable({
        id: this.id('declaration'),
        key,
        property: definitionRef(property),
        checker: definitionRef(property.check),
        subject: ref(subject),
        subjectKind: subject.kind,
        subjectSchemaVersion: subject.schemaVersion,
        ok: false,
        invalidationEpoch: this.epoch(property, subject),
        assurance: 'declared',
        valid: true,
        reason,
        evidence: null,
        dependencies: [],
      });
    this.store.facts.set(key, fact);
    this.store.factHistory.set(fact.id, fact);
    this.event(
      undefined,
      'property.declared',
      {
        factId: fact.id,
        reason,
      },
      property,
      ref(subject),
    );
    return fact;
  }
  async recordProof<S>(
    property: PropertyDefinition<S>,
    subject: Artifact<S>,
    certificate: unknown,
  ): Promise<PropertyFact> {
    if (!property.proofVerifier)
      throw new ContractError('proof-verifier', 'Property has no external proof verifier');
    this.registry.register(property);
    subject = this.snapshotArtifact(subject, property.subject);
    certificate = immutable(certificate);
    const epoch = this.epoch(property, subject);
    const analysis = await this.analyse(property.proofVerifier, subject, certificate),
      checked = checkResult(analysis.value);
    if (!checked.ok)
      throw new ContractError('proof-rejected', checked.reason ?? 'External verifier rejected proof');
    if (this.epoch(property, subject) !== epoch)
      throw new ContractError('invalidated-property', 'Property was invalidated during proof verification');
    const epochKey = this.epochKey(property, subject);
    this.epochs.set(epochKey, epoch + 1);
    const key = this.propertyKey(property, subject),
      fact: PropertyFact = immutable({
        id: this.id('proof'),
        key,
        property: definitionRef(property),
        checker: definitionRef(property.check),
        subject: ref(subject),
        subjectKind: subject.kind,
        subjectSchemaVersion: subject.schemaVersion,
        ok: true,
        invalidationEpoch: epoch + 1,
        assurance: 'proof',
        valid: true,
        reason: checked.reason ?? 'External proof verifier accepted certificate',
        evidence: {
          certificate,
          verifier: definitionRef(property.proofVerifier),
          result: checked.evidence ?? null,
          trust: 'External verifier; this framework is not a theorem prover',
        },
        dependencies: [
          {
            type: 'analysis',
            key: analysis.key,
            recordId: analysis.id,
          },
        ],
        analysisRecord: analysis.id,
      });
    this.store.facts.set(key, fact);
    this.store.factHistory.set(fact.id, fact);
    return fact;
  }
  async preserve<S, R>(
    definition: AnalysisDefinition<S, R>,
    from: Artifact<S>,
    to: Artifact<S>,
    correspondence: Correspondence,
    params: unknown = null,
  ): Promise<AnalysisRecord<R>> {
    return this.preserveInternal(definition, from, to, correspondence, undefined, params);
  }
  private async preserveInternal<S, R>(
    definition: AnalysisDefinition<S, R>,
    from: Artifact<S>,
    to: Artifact<S>,
    correspondence: Correspondence,
    parent?: Frame,
    params: unknown = null,
  ): Promise<AnalysisRecord<R>> {
    if (parent) this.checkActive(parent);
    this.registry.register(definition);
    from = this.snapshotArtifact(from, definition.input);
    to = this.snapshotArtifact(to, definition.input);
    correspondence = immutable(correspondence);
    params = immutable(params);
    this.validateCorrespondence(correspondence, from, to, definition.input, definition.input);
    const epoch = this.epoch(definition, to),
      store = parent?.store ?? this.store,
      source = this.lookupAnalysis(this.analysisKey(definition, from, params), store);
    if (
      !source ||
      !source.valid ||
      !this.epochValid(source) ||
      !this.validDependencies(source.dependencies, store)
    )
      throw new ContractError('transfer-source', 'A valid source analysis must exist before transfer');
    if (subjectKey(from) === subjectKey(to)) {
      if (parent) {
        uniquePush(parent.deps, {
          type: 'analysis',
          key: source.key,
          recordId: source.id,
        });
        parent.analyses.add(source.id);
      }
      this.event(parent, 'analysis.identity-reused', { recordId: source.id }, definition, ref(to));
      return source as AnalysisRecord<R>;
    }
    if (!definition.transfer)
      throw new ContractError('transfer-unauthorized', `Analysis ${definition.id} has no transfer rule`);
    const frame = this.freshFrame(definition.effects, store, parent);
    try {
      const justification = checkResult(
        await definition.transfer.verify(this.context(frame), {
          from: immutable(from),
          to: immutable(to),
          record: source as AnalysisRecord<R>,
          correspondence: immutable(correspondence),
        }),
      );
      await this.drain(frame);
      this.checkActive(frame);
      if (this.epoch(definition, to) !== epoch || !this.epochValid(source))
        throw new ContractError(
          'invalidated-transfer',
          'Analysis was invalidated while its transfer was checked',
        );
      if (!justification.ok)
        throw new ContractError(
          'transfer-rejected',
          justification.reason ?? 'Correspondence did not justify analysis transfer',
        );
      uniquePush(frame.deps, {
        type: 'analysis',
        key: source.key,
        recordId: source.id,
      });
      const key = this.analysisKey(definition, to, params),
        record: AnalysisRecord<R> = immutable({
          ...source,
          value: source.value as R,
          id: this.id('transfer'),
          key,
          subject: ref(to),
          subjectKind: to.kind,
          subjectSchemaVersion: to.schemaVersion,
          dependencies: frame.deps,
          assurance: 'transferred',
          invalidationEpoch: epoch,
          cacheable: source.cacheable && frame.cacheable,
          valid: true,
          generation: (this.lookupAnalysis(key, store)?.generation ?? 0) + 1,
          transfer: {
            rule: {
              id: definition.transfer.id,
              version: definition.transfer.version,
            },
            sourceRecord: source.id,
            correspondence,
            evidence: justification.evidence ?? null,
          },
        });
      store.analyses.set(key, record);
      store.analysisHistory.set(record.id, record);
      frame.analyses.add(record.id);
      if (parent && !record.cacheable) parent.cacheable = false;
      if (parent)
        uniquePush(parent.deps, {
          type: 'analysis',
          key,
          recordId: record.id,
        });
      this.event(
        frame,
        'analysis.transferred',
        {
          recordId: record.id,
          sourceRecord: source.id,
          rule: record.transfer!.rule,
        },
        definition,
        ref(to),
      );
      return record;
    } finally {
      await Promise.allSettled([...frame.pending]);
      frame.active = false;
    }
  }
  async evaluateObjective<S>(
    objective: ObjectiveDefinition<S>,
    subject: Artifact<S>,
  ): Promise<{
    value: number;
    direction: 'min' | 'max';
    analysis: AnalysisRecord<number>;
  }> {
    this.registry.register(objective);
    const analysis = await this.analyse(objective.analysis, subject);
    if (typeof analysis.value !== 'number' || !Number.isFinite(analysis.value))
      throw new ContractError('objective-value', 'Objective must produce a finite number');
    return {
      value: analysis.value,
      direction: objective.direction,
      analysis,
    };
  }
  private validatePorts(ports: Ports, values: unknown) {
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new ContractError('ports', 'Expected named port values');
    const entries = values as Record<string, unknown>;
    if (Object.keys(entries).length !== Object.keys(ports).length)
      throw new ContractError('ports', 'Port names do not match contract');
    for (const [name, type] of Object.entries(ports)) {
      if (!Object.hasOwn(entries, name)) throw new ContractError('ports', `Missing port ${name}`);
      if (type.category === 'ir') validateArtifact(type, entries[name]);
      else {
        const validateValue: (value: unknown) => void = type.validate;
        validateValue(entries[name]);
        canonical(entries[name]);
      }
    }
  }
  /** The entity universe of one correspondence endpoint: what the IR type enumerates or, when it does not
   * enumerate, what the record itself declares. Undefined when neither states anything (IRWB-044-C). */
  private entityUniverse(
    type: IRType<any>,
    artifact: Artifact,
    declared: readonly string[] | undefined,
  ): ReadonlySet<string> | undefined {
    if (type.entities) return new Set(type.entities(artifact.value));
    return declared ? new Set(declared) : undefined;
  }
  private validateCorrespondence(
    c: Correspondence,
    from: Artifact,
    to: Artifact,
    sourceType: IRType<any>,
    targetType: IRType<any>,
    requirement?: CorrespondenceRequirement,
  ) {
    canonical(c);
    if (!c.id || !c.relation || !sameRef(c.from, from) || !sameRef(c.to, to))
      throw new ContractError(
        'correspondence',
        'Correspondence must identify exact input/output artifact revisions',
      );
    if (
      c.entities?.some(
        e =>
          !Array.isArray(e.from) ||
          !Array.isArray(e.to) ||
          e.from.some(x => typeof x !== 'string') ||
          e.to.some(x => typeof x !== 'string'),
      )
    )
      throw new ContractError('correspondence', 'Correspondence entities must be string lists');
    const universes = new Map<'source' | 'target', ReadonlySet<string> | undefined>();
    for (const [label, type, artifact, declared] of [
      ['source', sourceType, from, c.sourceEntities],
      ['target', targetType, to, c.targetEntities],
    ] as const) {
      const universe = this.entityUniverse(type, artifact, declared);
      universes.set(label, universe);
      if (!universe) continue;
      const listed = new Set(declared ?? []);
      const mismatch = [...universe]
        .filter(id => !listed.has(id))
        .concat([...listed].filter(id => !universe.has(id)));
      if (mismatch.length)
        throw new ContractError(
          'correspondence',
          `Correspondence ${label} entity mismatch: ${mismatch.join(', ')}`,
        );
      for (const entry of c.entities ?? [])
        for (const id of label === 'source' ? entry.from : entry.to)
          if (!universe.has(id)) throw new ContractError('correspondence', `Unknown ${label} entity ${id}`);
    }
    if (requirement)
      this.auditCorrespondenceContent(
        c,
        universes,
        requirement,
        sourceType.id === targetType.id && sourceType.version === targetType.version,
      );
  }
  /**
   * IRWB-044-C: a required correspondence is checked for what it claims. Coverage: the requirement says which
   * entity universes the mapping must name, and it is checked against each universe the record or its IR type
   * states (a type that enumerates nothing leaves nothing to check, as the entity-list check always has).
   * Consistency: a group with an empty target claims its source entities have no counterpart after the change;
   * the structural diff's presence classification refuses that for an entity it keeps. Only one IR kind is one
   * universe in two revisions, so a cross-kind correspondence (a lowering) is not audited against a diff.
   */
  private auditCorrespondenceContent(
    c: Correspondence,
    universes: ReadonlyMap<'source' | 'target', ReadonlySet<string> | undefined>,
    requirement: CorrespondenceRequirement,
    sameKind: boolean,
  ) {
    const coverage = requirement.coverage ?? DEFAULT_CORRESPONDENCE_COVERAGE,
      entries = c.entities ?? [],
      required = {
        source: coverage === 'sourceTotal' || coverage === 'bothTotal',
        target: coverage === 'targetTotal' || coverage === 'bothTotal',
      };
    for (const label of ['source', 'target'] as const) {
      const universe = universes.get(label);
      if (!required[label] || !universe) continue;
      const named = new Set(
        entries.flatMap(entry => (label === 'source' ? entry.from : entry.to) as readonly string[]),
      );
      const missing = [...universe].filter(id => !named.has(id));
      if (missing.length)
        throw new ContractError(
          'correspondence',
          `Correspondence does not cover ${label} entities: ${missing.join(', ')}`,
        );
    }
    const before = universes.get('source'),
      after = universes.get('target');
    if (!sameKind || !before || !after) return;
    const presence = entityPresence(before, after);
    for (const entry of entries) {
      if (entry.to.length) continue;
      const kept = entry.from.filter(id => presence.get(id) === 'kept');
      if (kept.length)
        throw new ContractError(
          'correspondence',
          `Correspondence maps ${kept.join(', ')} to nothing; the structural diff keeps ${
            kept.length === 1 ? 'it' : 'them'
          }`,
        );
    }
  }
  async checkInvariant<P extends Ports>(
    definition: InvariantDefinition<P>,
    inputs: PortValues<P>,
  ): Promise<CheckEvidence> {
    return this.invariantInternal(definition, inputs);
  }
  private async invariantInternal<P extends Ports>(
    definition: InvariantDefinition<P>,
    inputs: PortValues<P>,
    parent?: Frame,
  ): Promise<CheckEvidence> {
    if (parent) this.checkActive(parent);
    this.registry.register(definition);
    const captured = immutable(inputs);
    this.validatePorts(definition.inputs, captured);
    // the key only detects cycles on the frame stack; an IR port is named by its artifact's identity and revision
    // (IRWB-004: equal exactly when the artifacts are, without encoding two programs to compare them)
    const key = `invariant:${fingerprint({
      definition: definitionRef(definition),
      inputs: Object.fromEntries(
        Object.entries(captured as Record<string, unknown>).map(([name, value]) => {
          const a = value as Artifact;
          return [
            name,
            definition.inputs[name]?.category === 'ir'
              ? { id: a.id, kind: a.kind, schemaVersion: a.schemaVersion, revision: a.revision }
              : value,
          ];
        }),
      ),
    })}`;
    if (parent?.stack.includes(key))
      throw new ContractError('invariant-cycle', `Invariant cycle involving ${definition.id}`);
    const frame = this.freshFrame(definition.effects, parent?.store ?? this.store, parent);
    frame.stack = [...(parent?.stack ?? []), key];
    try {
      const result = checkResult(await definition.check(this.context(frame), captured));
      await this.drain(frame);
      this.checkActive(frame);
      if (parent) {
        for (const dependency of frame.deps) uniquePush(parent.deps, dependency);
        if (!frame.cacheable) parent.cacheable = false;
      }
      const evidence: CheckEvidence = immutable({
        phase: 'query',
        definition: definitionRef(definition),
        ok: result.ok,
        assurance: 'checked',
        reason: result.reason ?? (result.ok ? 'Invariant checked' : 'Invariant rejected'),
        evidence: result.evidence ?? null,
      });
      this.event(
        frame,
        'invariant.checked',
        {
          inputs: captured,
          result: evidence,
        },
        definition,
      );
      return evidence;
    } finally {
      await Promise.allSettled([...frame.pending]);
      frame.active = false;
    }
  }
  private async condition(
    condition: Condition,
    phase: CheckEvidence['phase'],
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>,
    frame: Frame,
  ): Promise<CheckEvidence> {
    const select = (s: { from: 'inputs' | 'outputs'; port: string }) =>
      (s.from === 'inputs' ? inputs : outputs)[s.port];
    if ('property' in condition) {
      const subject = select(condition.subject) as Artifact,
        fact = await this.checkInternal(condition.property, subject, frame);
      return immutable({
        phase,
        definition: definitionRef(condition.property),
        ok: fact.ok,
        assurance: fact.assurance,
        reason: fact.reason,
        evidence: fact.evidence,
        subject: fact.subject,
        factId: fact.id,
      });
    }
    const values = Object.fromEntries(Object.entries(condition.bindings).map(([k, s]) => [k, select(s)]));
    const result = await this.invariantInternal(condition.invariant, values, frame);
    return immutable({
      ...result,
      phase,
    });
  }
  async beginTransformation<I extends Ports, O extends Ports>(
    definition: TransformationDefinition<I, O>,
    inputs: PortValues<I>,
    options: ExecutionOptions = {},
  ): Promise<TransformationTransaction<I, O>> {
    this.registry.register(definition);
    const captured = immutable(inputs);
    const overlay: Store = {
        analyses: new Map(),
        facts: new Map(),
        analysisHistory: new Map(),
        factHistory: new Map(),
      },
      frame = this.freshFrame(definition.effects, overlay),
      checks: CheckEvidence[] = [],
      correspondences: Correspondence[] = [];
    const execution: MutableExecution = {
      id: options.id ?? this.id('contract'),
      transformation: definitionRef(definition),
      descriptor: describeDefinition(definition),
      status: 'prepared',
      cached: options.cached ?? false,
      cacheReason: options.cached
        ? 'Compiler reused an artifact; semantic checks still run'
        : 'New transformation verification',
      inputs: captured,
      dependencies: [],
      bodyDependencies: [],
      bodyCacheable: true,
      checks,
      analyses: [],
      facts: [],
      effects: frame.effects,
      correspondence: correspondences,
      events: frame.events,
      ...(options.invocationId ? { invocationId: options.invocationId } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
    };
    this.executions.push(execution);
    overlay.resourceView = frame.writes;
    this.activeFrames.set(execution.id, frame);
    let prepared = false,
      verifying = false,
      closed = false;
    const bodyToken = { open: true },
      bodyFrame = this.freshFrame(definition.effects, overlay, frame),
      bodyContext = this.context(bodyFrame, bodyToken);
    const refresh = () => {
      execution.bodyDependencies = immutable(bodyFrame.deps);
      execution.bodyCacheable = bodyFrame.cacheable && this.reusable(bodyFrame.deps, overlay);
      execution.dependencies = immutable(frame.deps);
      execution.analyses = [...frame.analyses];
      execution.facts = [...frame.facts];
    };
    const discard = () => {
      for (const [id, a] of overlay.analysisHistory)
        if (!this.store.analysisHistory.has(id))
          this.store.analysisHistory.set(
            id,
            immutable({
              ...a,
              valid: false,
              invalidation: 'Discarded provisional transaction',
            }),
          );
      for (const [id, f] of overlay.factHistory)
        if (!this.store.factHistory.has(id))
          this.store.factHistory.set(
            id,
            immutable({
              ...f,
              valid: false,
              invalidation: 'Discarded provisional transaction',
            }),
          );
    };
    const rollback = (reason = 'Transformation was not committed') => {
      if (closed && execution.status === 'accepted')
        throw new ContractError('committed-transaction', 'Cannot roll back an accepted transformation');
      if (closed) return;
      closed = true;
      bodyToken.open = false;
      frame.active = false;
      this.activeFrames.delete(execution.id);
      discard();
      execution.status = 'rolled-back';
      execution.error = {
        code: 'rolled-back',
        message: reason,
      };
      refresh();
      this.event(frame, 'transformation.rolled-back', { reason }, definition);
    };
    const fail = (error: unknown) => {
      if (closed) {
        if (execution.status === 'accepted')
          throw new ContractError('committed-transaction', 'Cannot fail an accepted transformation');
        return;
      }
      closed = true;
      bodyToken.open = false;
      frame.active = false;
      this.activeFrames.delete(execution.id);
      discard();
      execution.status = error instanceof ContractError ? 'rejected' : 'failed';
      execution.error = {
        code: error instanceof ContractError ? error.code : 'contract-error',
        message: error instanceof Error ? error.message : String(error),
      };
      refresh();
      this.event(frame, 'transformation.rejected', execution.error, definition);
    };
    try {
      this.validatePorts(definition.inputs, captured);
      for (const c of definition.requires) {
        const check = await this.condition(c, 'requires', captured, {}, frame);
        checks.push(check);
        if (!check.ok || check.assurance === 'declared')
          throw new ContractError('precondition', `${check.definition.id}: ${check.reason}`);
      }
    } catch (error) {
      fail(error);
      throw error;
    }
    const transaction: TransformationTransaction<I, O> = {
      inputs: captured,
      context: bodyContext,
      get execution() {
        refresh();
        return immutable(execution);
      },
      settle: async () => {
        bodyToken.open = false;
        while (bodyFrame.pending.size || frame.pending.size)
          await Promise.allSettled([...bodyFrame.pending, ...frame.pending]);
      },
      importBodyDependencies: dependencies => {
        if (closed || verifying || prepared)
          throw new ContractError(
            'transaction-state',
            'Cannot import dependencies after verification starts',
          );
        const imported = immutable(dependencies);
        if (!this.canReuseDependencies(imported))
          throw new ContractError('stale-evidence', 'Cached body dependencies are no longer reusable');
        for (const dependency of imported) {
          uniquePush(bodyFrame.deps, dependency);
          if (dependency.type === 'resource') {
            const effect = definition.effects.find(
              e => e.resource === dependency.resource && e.access === 'read',
            );
            if (!effect)
              throw new ContractError(
                'undeclared-effect',
                `Cached body depends on undeclared resource ${dependency.resource}`,
              );
            this.effectAllowed(bodyFrame, effect, 'read');
            this.recordResource(
              bodyFrame,
              effect,
              'read',
              dependency.revision,
              !!bodyFrame.writes.get(effect.resource),
            );
          } else if (dependency.type === 'analysis') {
            const a = this.lookupAnalysis(dependency.key, overlay);
            if (a) {
              this.replayPermissions(a, bodyFrame);
              bodyFrame.analyses.add(a.id);
            }
          } else {
            const fact = this.lookupFact(dependency.key, overlay);
            if (fact) {
              bodyFrame.facts.add(fact.id);
              for (const dep of fact.dependencies)
                if (dep.type === 'analysis') {
                  const a = this.lookupAnalysis(dep.key, overlay);
                  if (a) {
                    this.replayPermissions(a, bodyFrame);
                    bodyFrame.analyses.add(a.id);
                  }
                }
            }
          }
        }
        this.event(bodyFrame, 'body.dependencies-reused', { dependencies: imported }, definition);
      },
      verify: async (outputs, correspondence = [], info = {}) => {
        if (closed || prepared || verifying)
          throw new ContractError(
            'transaction-state',
            'Transaction is already verifying, verified or closed',
          );
        verifying = true;
        bodyToken.open = false;
        try {
          const after = immutable(outputs),
            capturedCorrespondence = immutable(correspondence);
          await this.drain(bodyFrame);
          for (const dependency of bodyFrame.deps) uniquePush(frame.deps, dependency);
          if (!bodyFrame.cacheable) frame.cacheable = false;
          bodyFrame.active = false;
          this.validatePorts(definition.outputs, after);
          execution.outputs = after;
          execution.cached = info.cached ?? execution.cached;
          execution.cacheReason = execution.cached
            ? 'Cached computational output; current contract checks and body dependencies were revalidated'
            : 'Computed output; current contract checked before acceptance';
          if (execution.cached && definition.cache === 'never')
            throw new ContractError('cache-policy', 'This transformation forbids cached output acceptance');
          for (const c of capturedCorrespondence) {
            if (correspondences.some(x => x.id === c.id))
              throw new ContractError('correspondence', 'Duplicate correspondence id');
            correspondences.push(immutable(c));
          }
          for (const requirement of definition.correspondence) {
            const c = correspondences.find(x => x.id === requirement.id);
            if (!c) throw new ContractError('correspondence', `Missing correspondence ${requirement.id}`);
            this.validateCorrespondence(
              c,
              captured[requirement.from] as Artifact,
              after[requirement.to] as Artifact,
              definition.inputs[requirement.from] as IRType<any>,
              definition.outputs[requirement.to] as IRType<any>,
              requirement,
            );
            if (requirement.relation && c.relation !== requirement.relation)
              throw new ContractError(
                'correspondence',
                'Correspondence relation does not match its declaration',
              );
            checks.push({
              phase: 'correspondence',
              definition: {
                id: requirement.id,
                version: '1',
              },
              ok: true,
              assurance: 'checked',
              reason: 'Exact input/output revisions and relation match',
              evidence: c,
            });
          }
          for (const p of definition.preserves) {
            const from = captured[p.from] as Artifact,
              to = after[p.to] as Artifact,
              source = await this.checkInternal(p.property, from, frame);
            if (!source.ok)
              throw new ContractError(
                'preservation-source',
                `Cannot preserve false property ${p.property.id}`,
              );
            if (p.mode === 'transfer') {
              const correspondence = correspondences.find(c => c.id === p.correspondence);
              if (!correspondence)
                throw new ContractError(
                  'correspondence',
                  `Missing transfer correspondence ${p.correspondence}`,
                );
              await this.preserveInternal(p.property.check, from, to, correspondence, frame);
            }
            const fact = await this.checkInternal(p.property, to, frame),
              check: CheckEvidence = {
                phase: 'preserves',
                definition: definitionRef(p.property),
                ok: fact.ok,
                assurance: fact.assurance,
                reason: fact.reason,
                evidence: fact.evidence,
                subject: fact.subject,
                factId: fact.id,
              };
            checks.push(check);
            if (!fact.ok)
              throw new ContractError('preservation-failed', `${p.property.id} was not preserved`);
          }
          for (const [phase, conditions] of [
            ['ensures', definition.ensures],
            ['establishes', definition.establishes],
          ] as const)
            for (const c of conditions) {
              const check = await this.condition(c, phase, captured, after, frame);
              checks.push(check);
              if (!check.ok || check.assurance === 'declared')
                throw new ContractError('postcondition', `${check.definition.id}: ${check.reason}`);
            }
          this.checkActive(frame);
          prepared = true;
          refresh();
          this.event(frame, 'transformation.prepared', { checks: checks.length }, definition);
          const accepted: PreparedTransformation<O> = {
            outputs: after,
            get execution() {
              refresh();
              return immutable(execution);
            },
            commit: () => {
              if (closed) throw new ContractError('transaction-state', 'Transaction is already closed');
              if (!this.validDependencies(frame.deps, overlay, new Set(), true)) {
                const e = new ContractError('stale-evidence', 'A semantic dependency changed before commit');
                fail(e);
                throw e;
              }
              try {
                const committed: unknown = this.resources.commit(
                  immutable([...frame.writes.values()]),
                  immutable([...frame.expected.values()]),
                );
                if (
                  committed &&
                  typeof (
                    committed as {
                      then?: unknown;
                    }
                  ).then === 'function'
                ) {
                  void Promise.resolve(committed).catch(() => {});
                  throw new ContractError(
                    'async-resource-commit',
                    'Resource commit returned asynchronous work; atomic synchronous commit is required',
                  );
                }
              } catch (error) {
                fail(error);
                throw error;
              }
              for (const [k, v] of overlay.analyses) this.store.analyses.set(k, v);
              for (const [k, v] of overlay.facts) this.store.facts.set(k, v);
              for (const [k, v] of overlay.analysisHistory) this.store.analysisHistory.set(k, v);
              for (const [k, v] of overlay.factHistory) this.store.factHistory.set(k, v);
              closed = true;
              frame.active = false;
              this.activeFrames.delete(execution.id);
              execution.status = 'accepted';
              refresh();
              this.event(frame, 'transformation.accepted', { outputs: Object.keys(after) }, definition);
              return immutable(execution);
            },
            rollback,
            fail,
          };
          return accepted;
        } catch (error) {
          fail(error);
          throw error;
        }
      },
      rollback,
      fail,
    };
    return transaction;
  }
  async verifyTransformation<I extends Ports, O extends Ports>(
    before: PortValues<I>,
    after: PortValues<O>,
    contract: TransformationDefinition<I, O>,
    correspondence: readonly Correspondence[] = [],
    options: ExecutionOptions = {},
  ): Promise<PreparedTransformation<O>> {
    before = immutable(before);
    after = immutable(after);
    correspondence = immutable(correspondence);
    options = immutable(options);
    const transaction = await this.beginTransformation(contract, before, options);
    const prepared = await transaction.verify(after, correspondence, { cached: options.cached });
    if (!options.deferCommit) prepared.commit();
    return prepared;
  }
  async execute<I extends Ports, O extends Ports>(
    definition: TransformationDefinition<I, O>,
    inputs: PortValues<I>,
    options: ExecutionOptions = {},
  ): Promise<PreparedTransformation<O>> {
    if (!definition.run)
      throw new ContractError(
        'missing-implementation',
        `Transformation ${definition.id} has no run implementation`,
      );
    inputs = immutable(inputs);
    options = immutable(options);
    const transaction = await this.beginTransformation(definition, inputs, options),
      key = fingerprint({
        definition: describeDefinition(definition),
        inputs: transaction.inputs,
      }),
      cached = this.transformCache.get(key);
    try {
      let outputs: PortValues<O>,
        correspondence: readonly Correspondence[] = [];
      let reused = false;
      if (definition.cache !== 'never' && cached && this.canReuseDependencies(cached.dependencies)) {
        outputs = cached.outputs as PortValues<O>;
        correspondence = cached.correspondence;
        reused = true;
        transaction.importBodyDependencies(cached.dependencies);
      } else {
        const result = await definition.run(transaction.context, transaction.inputs);
        outputs = result.outputs;
        correspondence = result.correspondence ?? [];
      }
      const prepared = await transaction.verify(outputs, correspondence, { cached: reused });
      if (!options.deferCommit) {
        prepared.commit();
        if (definition.cache !== 'never') {
          const execution = this.executions.find(x => x.id === prepared.execution.id)!;
          const dependencies = execution.bodyDependencies;
          if (execution.bodyCacheable && this.reusable(dependencies, this.store))
            this.transformCache.set(key, {
              outputs: prepared.outputs,
              correspondence,
              dependencies: immutable(dependencies),
            });
          else this.transformCache.delete(key);
        }
      }
      return prepared;
    } catch (error) {
      await transaction.settle();
      if (transaction.execution.status === 'prepared') transaction.fail(error);
      throw error;
    }
  }
  snapshot(): ContractSnapshot {
    const analyses = [...this.store.analysisHistory.values()].map(a =>
        immutable({
          ...a,
          valid: a.valid && this.epochValid(a) && this.validDependencies(a.dependencies, this.store),
        }),
      ),
      facts = [...this.store.factHistory.values()].map(f =>
        immutable({
          ...f,
          valid: f.valid && this.epochValid(f) && this.validDependencies(f.dependencies, this.store),
        }),
      );
    return immutable({
      formatVersion: 1,
      definitions: this.registry.list(),
      analyses,
      facts,
      executions: this.executions,
      events: this.events,
    });
  }
}
