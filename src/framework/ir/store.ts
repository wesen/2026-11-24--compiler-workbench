import { canonical, fingerprint, immutable } from '../core/data.js';
import type { Artifact } from '../core/types.js';
import type { EditAcceptance, RevisionRef } from './types.js';
import { IRError, requireText, syncFunction, synchronous } from './common.js';
const publications = new WeakMap<
  IRStore,
  (base: Artifact, next: Artifact, acceptance: EditAcceptance | undefined, generation: number) => Artifact
>();
/** A process-local immutable revision store. It owns the compare-and-swap head. */
export class IRStore {
  #revisions = new Map<string, Artifact>();
  #heads = new Map<string, string>();
  #generations = new Map<string, number>();
  #publishing = false;
  constructor() {
    publications.set(this, (base, next, acceptance, generation) =>
      this.#publish(base, next, acceptance, generation),
    );
  }
  #key(ref: RevisionRef): string {
    return canonical([ref.artifact, ref.revision]);
  }
  #snapshot<T>(artifact: Artifact<T>): Artifact<T> {
    const a = immutable(artifact);
    requireText(a.id, 'Artifact ID');
    requireText(a.kind, 'Artifact kind');
    requireText(a.schemaVersion, 'Artifact schema version');
    if (
      a.contentHash !== fingerprint(a.value) ||
      a.revision !==
        fingerprint({
          kind: a.kind,
          schemaVersion: a.schemaVersion,
          value: a.value,
        })
    )
      throw new IRError('ir.revision', 'Cannot retain a forged artifact revision');
    return a;
  }
  /** Seed a lineage once. Reopening an existing exact revision never changes its head. */
  retain<T>(artifact: Artifact<T>): Artifact<T> {
    if (this.#publishing)
      throw new IRError('ir.reentrant', 'Cannot retain revisions during atomic publication');
    const a = this.#snapshot(artifact),
      key = this.#key({
        artifact: a.id,
        revision: a.revision,
      }),
      previous = this.#revisions.get(key);
    if (previous) {
      if (canonical(previous) !== canonical(a))
        throw new IRError('ir.revision', 'Conflicting artifact at the same revision');
      return previous as Artifact<T>;
    }
    if (this.#heads.has(a.id))
      throw new IRError(
        'ir.unpublished',
        `Unknown revision of ${a.id}; new revisions must be committed through an edit`,
      );
    this.#revisions.set(key, a);
    this.#heads.set(a.id, a.revision);
    this.#generations.set(a.id, 0);
    return a;
  }
  get<T = unknown>(ref: RevisionRef): Artifact<T> {
    const result = this.#revisions.get(this.#key(ref));
    if (!result)
      throw new IRError('ir.revision-missing', `Revision ${ref.artifact}@${ref.revision} is not retained`);
    return result as Artifact<T>;
  }
  head<T = unknown>(id: string): Artifact<T> {
    const revision = this.#heads.get(id);
    if (!revision) throw new IRError('ir.revision-missing', `Artifact ${id} is not retained`);
    return this.get<T>({
      artifact: id,
      revision,
    });
  }
  revisions(id: string): readonly Artifact[] {
    return Object.freeze([...this.#revisions.values()].filter(a => a.id === id));
  }
  generation(id: string): number {
    this.head(id);
    return this.#generations.get(id)!;
  }
  assertHead(base: Artifact, generation?: number): void {
    if (this.#heads.get(base.id) !== base.revision)
      throw new IRError(
        'ir.stale-edit',
        `Stale edit: ${base.id}@${base.revision} is no longer the current revision`,
      );
    if (generation !== undefined && this.#generations.get(base.id) !== generation)
      throw new IRError('ir.stale-edit', `Stale edit: ${base.id} was committed after this edit began`);
    if (
      canonical(
        this.get({
          artifact: base.id,
          revision: base.revision,
        }),
      ) !== canonical(base)
    )
      throw new IRError('ir.revision', 'Edit base does not match the retained artifact');
  }
  /** Internal commit protocol. No asynchronous operation is permitted inside publication. */
  #publish<T>(
    base: Artifact<T>,
    next: Artifact<T>,
    acceptance: EditAcceptance | undefined,
    generation: number,
  ): Artifact<T> {
    if (this.#publishing) throw new IRError('ir.reentrant', 'Reentrant IR publication is forbidden');
    this.assertHead(base, generation);
    const a = this.#snapshot(next);
    if (a.id !== base.id || a.kind !== base.kind || a.schemaVersion !== base.schemaVersion)
      throw new IRError('ir.lineage', 'An edit must preserve artifact identity and native type');
    if (acceptance) {
      if (typeof acceptance.commit !== 'function' || typeof acceptance.rollback !== 'function')
        throw new IRError('ir.acceptance', 'Verification must return commit and rollback functions');
      syncFunction(acceptance.commit, 'Semantic acceptance commit');
      syncFunction(acceptance.rollback, 'Semantic acceptance rollback');
    }
    this.#publishing = true;
    try {
      if (acceptance) synchronous(acceptance.commit(), 'Semantic acceptance commit');
      this.#revisions.set(
        this.#key({
          artifact: a.id,
          revision: a.revision,
        }),
        a,
      );
      this.#heads.set(a.id, a.revision);
      this.#generations.set(a.id, this.#generations.get(a.id)! + 1);
      return a;
    } finally {
      this.#publishing = false;
    }
  }
}
/** Internal editing protocol; deliberately excluded from the package's public exports. */
export function publishRevision<T>(
  store: IRStore,
  base: Artifact<T>,
  next: Artifact<T>,
  acceptance: EditAcceptance | undefined,
  generation: number,
): Artifact<T> {
  const publish = publications.get(store);
  if (!publish) throw new IRError('ir.store', 'Unknown revision store');
  return publish(base, next, acceptance, generation) as Artifact<T>;
}
