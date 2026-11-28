/**
 * IRWB-056-A (R3 concept K2): a derivation — the producer's own record of *why* each change is valid — and the
 * correspondence computed from it.
 *
 * A pass's edits say *what* changed; each derivation step says which rule or decision licensed it, the site (the
 * entities it consumed and produced, in the input and output revisions), and the premises (the facts or entities
 * it relied on). The correspondence between the two revisions is then computed from the steps: one entry per
 * group of steps that share a site, completed by the coverage policy of `makeCorrespondence` (F35's vocabulary:
 * every source and target entity is accounted for), while the structural diff stays as the audit that the steps
 * claim nothing the revisions contradict.
 *
 * A step carries no class (local, structural): classification is a query over the records, never a stored field
 * (R3's decision, from A0: the same 2,021 O2 edit records support both policies that counted 203 and 395 local
 * edits; a framework enum would standardize one reading of an ambiguity).
 */
import { makeCorrespondence } from './correspondence.js';
import type { CorrespondenceEntry, EntityCorrespondence, RevisionRef } from './types.js';
import { IRError, compareText, requireText } from './common.js';

/** One step of a derivation: the producer's record of why one change is valid. */
export interface DerivationStep {
  /** The rule that licensed the step (a verified rule's name), or the decision id of the producer that decided it. */
  readonly by: string;
  /** The site, input side: entities of the input revision the step consumed. */
  readonly consumes: readonly string[];
  /** The site, output side: entities of the output revision the step produced. */
  readonly produces: readonly string[];
  /** The premises: facts or entities the step relied on (the `because` of the change). */
  readonly premises: readonly string[];
  /**
   * How the step's products relate to its consumed entities, in the producer's vocabulary (it names the
   * correspondence entry's relation; when nothing was produced, the entry says `removed`).
   */
  readonly relation: string;
  readonly note?: string;
}

/**
 * The correspondence entries of a derivation's steps: one entry per group of steps that share a site, their
 * premises the entry's `because`. A step is rejected when its site is empty, names an entity that exists in
 * neither revision, or claims something the revisions contradict.
 */
export function stepsToCorrespondence(
  steps: readonly DerivationStep[],
  sourceEntities: readonly string[],
  targetEntities: readonly string[],
): readonly CorrespondenceEntry[] {
  const source = new Set(sourceEntities),
    target = new Set(targetEntities);
  if (!Array.isArray(steps)) throw new IRError('ir.derivation', 'Derivation steps must be an array');
  const groups = new Map<
    string,
    { from: string[]; to: Set<string>; because: Set<string>; notes: string[]; relation: string }
  >();
  for (const s of steps) {
    requireText(s.by, 'Step rule or decision');
    requireText(s.relation, 'Step relation');
    if (!Array.isArray(s.consumes) || !Array.isArray(s.produces) || !Array.isArray(s.premises))
      throw new IRError('ir.derivation', 'Step site and premises must be arrays');
    if (!s.consumes.length && !s.produces.length)
      throw new IRError('ir.derivation', `Step by ${s.by} has an empty site: a mapping with no meaning`);
    for (const id of s.consumes) {
      requireText(id, 'Step consumed entity');
      if (!source.has(id) && !target.has(id))
        throw new IRError('ir.derivation', `Step by ${s.by} names the entity ${id}, which is in neither revision`);
      if (!source.has(id))
        throw new IRError('ir.derivation', `Step by ${s.by} consumes ${id}, which exists only in the output`);
    }
    for (const id of s.produces) {
      requireText(id, 'Step produced entity');
      if (!source.has(id) && !target.has(id))
        throw new IRError('ir.derivation', `Step by ${s.by} names the entity ${id}, which is in neither revision`);
      if (!target.has(id))
        throw new IRError(
          'ir.derivation',
          `Step by ${s.by} produces ${id}, which the diff says was removed`,
        );
    }
    const from = [...s.consumes].sort(compareText);
    // a step that produced nothing and consumed only surviving entities claims nothing about the published
    // revision (a removal the diff does not show), so it says nothing here either
    if (!s.produces.length && from.every(id => target.has(id))) continue;
    const key = from.join('\u0000');
    let g = groups.get(key);
    if (!g)
      groups.set(
        key,
        (g = {
          from,
          to: new Set(from.filter(id => target.has(id))),
          because: new Set(),
          notes: [],
          relation: s.relation,
        }),
      );
    for (const id of s.produces) g.to.add(id);
    for (const b of s.premises) {
      requireText(b, 'Step premise');
      g.because.add(b);
    }
    if (s.note) g.notes.push(s.note);
  }
  return [...groups.values()].map(g => ({
    from: g.from,
    to: [...g.to].sort(),
    relation: g.to.size ? g.relation : 'removed',
    ...(g.because.size ? { because: [...g.because].sort() } : {}),
    ...(g.notes.length ? { note: [...new Set(g.notes)].join(' > ') } : {}),
  }));
}

/**
 * The full entity correspondence of a derivation: the steps' entries, completed by `makeCorrespondence`'s
 * coverage policy (every source and target entity accounted for, including additions and removals the steps do
 * not mention).
 */
export function correspondenceOfDerivation(
  from: RevisionRef,
  to: RevisionRef,
  sourceEntities: readonly string[],
  targetEntities: readonly string[],
  steps: readonly DerivationStep[],
): EntityCorrespondence {
  return makeCorrespondence(
    from,
    to,
    sourceEntities,
    targetEntities,
    stepsToCorrespondence(steps, sourceEntities, targetEntities),
  );
}
