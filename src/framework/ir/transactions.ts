import { canonical, immutable } from '../core/data.js';
import type { Artifact } from '../core/types.js';
import type {
  CorrespondenceEntry,
  EditAcceptance,
  EditOperation,
  EditOptions,
  EntityTarget,
  IREdit,
  IREntity,
  IRGraph,
  IRRef,
  IRRelation,
  IRView,
  RedirectOptions,
  RelationSpec,
  Reason,
  TransformationResult,
} from './types.js';
import { createIRArtifact, project, validateEntity, validateGraph } from './adapters.js';
import { IRError, requireRecord, requireText, revisionRef, syncFunction, synchronous } from './common.js';
import { makeCorrespondence, normalizeReason } from './correspondence.js';
import { diffGraphs } from './diff.js';
import { IRStore, publishRevision } from './store.js';
/** Edits are draft-local; no operation mutates a retained native value. */
export class Edit<T> implements IREdit<T> {
  readonly base: Artifact<T>;
  #state: IREdit<T>['state'] = 'open';
  #view: IRView<T>;
  #store: IRStore;
  #generation: number;
  #options: EditOptions<T>;
  #entities: Map<string, IREntity>;
  #relations: Map<string, IRRelation>;
  #operations: EditOperation[] = [];
  #correspondence: CorrespondenceEntry[] = [];
  #prepared?: TransformationResult<T>;
  #committing = false;
  #publishing = false;
  #rollbackReason?: string;
  constructor(view: IRView<T>, store: IRStore, options: EditOptions<T> = {}) {
    if (!view.adapter.rebuild)
      throw new IRError('ir.capability', `Adapter ${view.adapter.id} is not Rewritable`);
    if (options.verify !== undefined && typeof options.verify !== 'function')
      throw new IRError('ir.acceptance', 'Edit verification must be callable');
    if (options.label !== undefined) requireText(options.label, 'Edit label');
    store.assertHead(view.artifact);
    this.#view = view;
    this.#store = store;
    this.base = view.artifact;
    this.#generation = store.generation(this.base.id);
    this.#options = Object.freeze({ ...options });
    this.#entities = new Map(view.graph().entities.map(e => [e.id, e]));
    this.#relations = new Map(view.graph().relations.map(r => [r.id, r]));
    Object.freeze(this);
  }
  get state(): IREdit<T>['state'] {
    return this.#state;
  }
  #open(): void {
    if (this.#state !== 'open')
      throw new IRError('ir.edit-state', `Edit is ${this.#state}; mutation requires an open draft`);
  }
  #id(target: EntityTarget, where: 'draft' | 'base' = 'draft'): string {
    const id = typeof target === 'string' ? target : target?.entity;
    requireText(id, 'Edit entity');
    if (
      typeof target !== 'string' &&
      (target.artifact !== this.base.id || target.revision !== this.base.revision)
    )
      throw new IRError('ir.stale-ref', `Edit entity ${id} refers to another artifact revision`);
    if (where === 'base') this.#view.ref(id);
    else if (!this.#entities.has(id)) throw new IRError('ir.entity-missing', `Unknown draft entity ${id}`);
    return id;
  }
  #ref(id: string): IRRef {
    return immutable({
      artifact: this.base.id,
      revision: this.base.revision,
      entity: id,
    });
  }
  /** `why` is an already normalized reason: methods validate it before they change the draft. */
  #record(kind: string, data: Record<string, unknown>, why: Reason = {}): void {
    this.#operations.push(
      immutable({
        kind,
        data: { ...data, ...why },
      }),
    );
  }
  insert(entity: IREntity, reason?: Reason): IRRef {
    this.#open();
    const why = normalizeReason(reason);
    const e = validateEntity(entity);
    if (this.#entities.has(e.id)) throw new IRError('ir.entity', `Entity ${e.id} already exists`);
    this.#entities.set(e.id, e);
    this.#record('insert', { entity: e }, why);
    return this.#ref(e.id);
  }
  replace(target: EntityTarget, entity: IREntity, reason?: Reason): void {
    this.#open();
    const why = normalizeReason(reason);
    const id = this.#id(target),
      e = validateEntity(entity);
    if (e.id !== id)
      throw new IRError(
        'ir.entity',
        'Replacement preserves entity identity; insert, redirect and remove to rename',
      );
    this.#entities.set(id, e);
    this.#record('replace', { entity: e }, why);
  }
  remove(target: EntityTarget, reason?: Reason): void {
    this.#open();
    const why = normalizeReason(reason);
    const id = this.#id(target),
      removedRelations: string[] = [];
    this.#entities.delete(id);
    for (const [key, r] of this.#relations)
      if (r.from === id || r.to === id) {
        this.#relations.delete(key);
        removedRelations.push(key);
      }
    this.#record(
      'remove',
      {
        entity: id,
        removedRelations,
      },
      why,
    );
  }
  update(target: EntityTarget, attributes: Readonly<Record<string, unknown>>, reason?: Reason): void {
    this.#open();
    const why = normalizeReason(reason);
    const id = this.#id(target);
    requireRecord(attributes, 'Attribute update');
    const snapshot = immutable(attributes),
      entity = this.#entities.get(id)!;
    this.#entities.set(
      id,
      validateEntity({
        ...entity,
        attributes: {
          ...entity.attributes,
          ...snapshot,
        },
      }),
    );
    this.#record(
      'update',
      {
        entity: id,
        attributes: snapshot,
      },
      why,
    );
  }
  connect(from: EntityTarget, relation: string | RelationSpec, to: EntityTarget, reason?: Reason): string {
    this.#open();
    const why = normalizeReason(reason);
    const source = this.#id(from),
      target = this.#id(to),
      spec = typeof relation === 'string' ? { kind: relation } : immutable(relation);
    requireText(spec.kind, 'Relation kind');
    if (!Object.hasOwn(this.#view.descriptor.relationKinds, spec.kind))
      throw new IRError('ir.relation', `Undeclared relation ${spec.kind}`);
    let id = spec.id;
    if (id === undefined) {
      const prefix = `${spec.kind}:${source}:${target}`;
      id = prefix;
      let n = 1;
      while (this.#relations.has(id)) id = `${prefix}:${n++}`;
    }
    requireText(id, 'Relation ID');
    if (this.#relations.has(id)) throw new IRError('ir.relation', `Relation ${id} already exists`);
    const edge: IRRelation = immutable({
      id,
      kind: spec.kind,
      category: this.#view.descriptor.relationKinds[spec.kind],
      from: source,
      to: target,
      ...(spec.order === undefined ? {} : { order: spec.order }),
      ...(spec.attributes === undefined ? {} : { attributes: spec.attributes }),
    });
    validateGraph(this.#view.adapter, {
      entities: [...this.#entities.values()],
      relations: [edge],
      roots: [],
    });
    this.#relations.set(id, edge);
    this.#record('connect', { relation: edge }, why);
    return id;
  }
  disconnect(relationId: string, reason?: Reason): void;
  disconnect(from: EntityTarget, relationKind: string, to: EntityTarget, reason?: Reason): void;
  disconnect(target: EntityTarget, kindOrReason?: string | Reason, to?: EntityTarget, reason?: Reason): void {
    this.#open();
    const kind = typeof kindOrReason === 'string' ? kindOrReason : undefined,
      why = normalizeReason(typeof kindOrReason === 'string' ? reason : kindOrReason);
    const removed: string[] = [];
    if (kind === undefined) {
      if (typeof target !== 'string' || !this.#relations.has(target))
        throw new IRError('ir.relation', 'Unknown relation to disconnect');
      this.#relations.delete(target);
      removed.push(target);
    } else {
      if (!Object.hasOwn(this.#view.descriptor.relationKinds, kind))
        throw new IRError('ir.relation', `Undeclared relation ${kind}`);
      const from = this.#id(target),
        destination = this.#id(to!);
      for (const [id, r] of this.#relations)
        if (r.from === from && r.to === destination && r.kind === kind) {
          this.#relations.delete(id);
          removed.push(id);
        }
      if (!removed.length) throw new IRError('ir.relation', 'No matching relation to disconnect');
    }
    this.#record('disconnect', { relations: removed }, why);
  }
  redirectReferences(from: EntityTarget, to: EntityTarget, options: RedirectOptions = {}): void {
    this.#open();
    const why = normalizeReason(options);
    const source = this.#id(from),
      target = this.#id(to),
      direction = options.direction ?? 'incoming';
    if (!['incoming', 'outgoing', 'both'].includes(direction))
      throw new IRError('ir.relation', 'Invalid redirect direction');
    const names =
      options.relations ??
      Object.entries(this.#view.descriptor.relationKinds)
        .filter(([, category]) => category === 'dependency' || category === 'binding')
        .map(([name]) => name);
    if (!Array.isArray(names) || names.some(k => !Object.hasOwn(this.#view.descriptor.relationKinds, k)))
      throw new IRError('ir.relation', 'Redirect contains an undeclared relation kind');
    const kinds = new Set(names),
      changed: string[] = [];
    for (const [id, r] of this.#relations) {
      if (!kinds.has(r.kind)) continue;
      const newFrom = direction !== 'incoming' && r.from === source ? target : r.from,
        newTo = direction !== 'outgoing' && r.to === source ? target : r.to;
      if (newFrom !== r.from || newTo !== r.to) {
        this.#relations.set(
          id,
          immutable({
            ...r,
            from: newFrom,
            to: newTo,
          }),
        );
        changed.push(id);
      }
    }
    this.#record(
      'redirectReferences',
      {
        from: source,
        to: target,
        direction,
        relations: names,
        changed,
      },
      why,
    );
  }
  correspond(
    from: EntityTarget | readonly EntityTarget[],
    to: EntityTarget | readonly EntityTarget[],
    relation = 'rewritten',
    reason?: Reason,
  ): void {
    this.#open();
    requireText(relation, 'Correspondence relation');
    const sources = (Array.isArray(from) ? from : [from]).map(x => this.#id(x, 'base')),
      targets = (Array.isArray(to) ? to : [to]).map(x => this.#id(x));
    if (!sources.length && !targets.length)
      throw new IRError('ir.correspondence', 'Empty correspondence has no endpoints');
    const entry = immutable({
      from: sources,
      to: targets,
      relation,
      ...normalizeReason(reason),
    });
    this.#correspondence.push(entry);
    this.#record('correspond', { ...entry });
  }
  preview(): IRGraph {
    return immutable({
      entities: [...this.#entities.values()],
      relations: [...this.#relations.values()],
      roots: this.#view.graph().roots.filter(r => this.#entities.has(r)),
    });
  }
  prepare(): TransformationResult<T> {
    if (this.#state === 'prepared') return this.#prepared!;
    this.#open();
    this.#state = 'preparing';
    try {
      this.#store.assertHead(this.base, this.#generation);
      const graph = validateGraph(this.#view.adapter, this.preview());
      const value = synchronous(this.#view.adapter.rebuild!(this.base.value, graph), 'Native IR rebuild');
      const artifact = createIRArtifact(this.#view.adapter, this.base.id, value),
        actual = project(this.#view.adapter, artifact.value);
      // Reject adapters that silently drop a requested edit or fabricate logical entities/edges.
      if (
        canonical(graph.entities) !== canonical(actual.entities) ||
        canonical(graph.relations) !== canonical(actual.relations)
      )
        throw new IRError(
          'ir.lossy-rebuild',
          'Native rebuild did not round-trip the complete edited logical projection',
        );
      const changes = diffGraphs(
        this.#view.graph(),
        actual,
        revisionRef(this.base),
        revisionRef(artifact),
        this.#operations,
      );
      const correspondence = makeCorrespondence(
        changes.from,
        changes.to,
        this.#view.graph().entities.map(e => e.id),
        actual.entities.map(e => e.id),
        this.#correspondence,
      );
      this.#prepared = immutable({
        artifact,
        changes,
        correspondence,
        diagnostics: [
          {
            severity: 'info' as const,
            code: 'ir.validated-edit',
            message: `${this.#options.label ?? 'Edit'} validated by ${this.#view.adapter.id}@${this.#view.adapter.version}`,
            data: {
              adapter: this.#view.descriptor,
              semanticVerification: this.#options.verify ? 'pending' : 'not-requested',
            },
          },
        ],
      });
      this.#state = 'prepared';
      return this.#prepared;
    } catch (error) {
      this.#state = 'failed';
      throw error;
    }
  }
  async commit(): Promise<TransformationResult<T>> {
    if (this.#committing) throw new IRError('ir.edit-state', 'A commit is already in progress');
    if (!['open', 'prepared'].includes(this.#state))
      throw new IRError('ir.edit-state', `Cannot commit a ${this.#state} edit`);
    this.#committing = true;
    let acceptance: EditAcceptance | undefined;
    try {
      const result = this.prepare();
      this.#state = 'preparing';
      this.#store.assertHead(this.base, this.#generation);
      if (this.#options.verify) {
        acceptance = await this.#options.verify(result, this.base);
        if (
          !acceptance ||
          typeof acceptance.commit !== 'function' ||
          typeof acceptance.rollback !== 'function'
        )
          throw new IRError(
            'ir.acceptance',
            'Verification must return a semantic acceptance with commit and rollback functions',
          );
      }
      if (this.#state !== 'preparing')
        throw new IRError('ir.cancelled', this.#rollbackReason ?? 'Edit cancelled during verification');
      this.#publishing = true;
      try {
        publishRevision(this.#store, this.base, result.artifact, acceptance, this.#generation);
      } finally {
        this.#publishing = false;
      }
      this.#state = 'committed';
      this.#prepared = immutable({
        ...result,
        diagnostics: [
          ...result.diagnostics,
          {
            severity: 'info' as const,
            code: this.#options.verify ? 'ir.semantic-accepted' : 'ir.committed',
            message: this.#options.verify
              ? 'Semantic acceptance and IR revision committed atomically'
              : 'Validated IR revision committed',
          },
        ],
      });
      return this.#prepared;
    } catch (error) {
      if (acceptance && typeof acceptance.rollback === 'function') {
        try {
          syncFunction(acceptance.rollback, 'Semantic acceptance rollback');
          synchronous(
            acceptance.rollback(error instanceof Error ? error.message : String(error)),
            'Semantic acceptance rollback',
          );
        } catch (rollbackError) {
          if (this.#state !== 'rolled-back') this.#state = 'failed';
          throw new AggregateError([error, rollbackError], 'IR commit and semantic rollback failed');
        }
      }
      if (this.#state !== 'rolled-back') this.#state = 'failed';
      throw error;
    } finally {
      this.#committing = false;
    }
  }
  rollback(reason = 'Edit rolled back'): void {
    if (this.#publishing)
      throw new IRError('ir.edit-state', 'Cannot roll back reentrantly during atomic publication');
    if (this.#state === 'committed')
      throw new IRError('ir.edit-state', 'A committed edit cannot be rolled back; start a new revision');
    if (this.#state === 'rolled-back') return;
    requireText(reason, 'Rollback reason');
    this.#rollbackReason = reason;
    this.#state = 'rolled-back';
  }
}
