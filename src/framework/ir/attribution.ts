/**
 * IRWB-065-B (IRWB-039 phase 4, concept K2): credit and provenance as queries over a chain of records.
 *
 * A program under a pipeline is a chain of revisions, r0 → r1 → … → rN (and, for a compiler that lowers to another
 * IR, one more link to its image). Each link is a transformation that published a correspondence; since phase 4.1 a
 * Typed `Tx` pass publishes a derivation next to it. A *measurement* puts a weight on the entities of a revision —
 * the RV32 instructions a statement executes, the bytes a kernel touches, the time its code takes. This module
 * answers two questions over those records alone, with no IR trees and no re-derivation:
 *
 *   - `creditChain(links, weightsAt)`: for each link, the **groups** of entities it relates, each group's weight
 *     before and after the link, the records that name it (the derivation steps, the entries' reasons), and the
 *     entities of the chain's first revision its weight came from. Every unit of a change is credited to exactly one
 *     group, so a caller can name every unit of a difference and none is estimated.
 *   - `changedBy(entities, links)`: for each entity of the last revision, the labels of the links at which its
 *     lineage did not keep its identity, oldest first. That is provenance — "which passes made this code" — as a
 *     query over the same records.
 *
 * Two rules about identity make both queries read the correspondence the way its producer wrote it:
 *
 *   1. **An entity keeps its identity at a link when an entry maps it to itself.** An entry may carry a relation for
 *      an entity that did not change (a pass that names the entities it read: Typed's `inline` and `rotate` map
 *      unchanged statements with their own label); the step records the link, the correspondence records survival
 *      (`derivation.ts`). So a relation is not a change, and an entry whose `from` holds the entity it produces is
 *      the record that it survived.
 *   2. **An entity that did not survive was made by its link**, and the link's label names it — whether its entry
 *      maps it from other entities or from none (an `inserted` entry has no relation to name).
 *
 * Groups are the relation's connected components: an entry binds the entities of its `from` to the entities of its
 * `to`, and entities bound by one entry are one group. A group's weight before a link is the sum over its entities
 * of the revision before, its weight after the sum over its entities of the revision after — so what one statement
 * became is one row, and its difference is what that change cost or saved.
 *
 * Weights may name ids no revision has (Typed's `frame` and `backend`: instructions that cover no statement); such
 * an id is a one-entity group of its own, which no correspondence relates to anything.
 */
import type { EntityCorrespondence } from './types.js';
import type { Derivation, DerivationBy, DerivationStep } from './derivation.js';
import { compareText, IRError, sameRevision } from './common.js';

/** One link of a chain: the correspondence into a revision, and the producer's own steps for it. */
export interface ChainLink {
  /** The name the link's producer gives itself: the derivation's label and, in a domain, its pass (`simplify`). */
  readonly label: string;
  readonly correspondence: EntityCorrespondence;
  readonly derivation?: Derivation;
}

/** A weight per entity id, e.g. executed instructions per statement. */
export type WeightMap = ReadonlyMap<string, number>;

/** One group of one link: the entities it joined across the two revisions, and what they weighed. */
export interface Credit {
  /** Index of the link in the chain; the group lies between revision `link` and revision `link + 1`. */
  readonly link: number;
  /** The group's entities in the revision before the link, sorted; empty for an insertion. */
  readonly before: readonly string[];
  /** The group's entities in the revision after it, sorted; empty for a removal. */
  readonly after: readonly string[];
  /** The relations of the entries that formed the group, each once, sorted. */
  readonly relations: readonly string[];
  /** Indices of the link derivation's steps that name one of the group's entities, in step order. */
  readonly steps: readonly number[];
  /** Those steps' rules or decisions, in step order, each once. */
  readonly by: readonly DerivationBy[];
  /** Those steps' premises, each once, sorted. */
  readonly premises: readonly string[];
  /** The reasons the group's entries carry, each once, sorted (a step's domain facts, an edit's `because`). */
  readonly because: readonly string[];
  /** The notes the group's entries carry, each once, sorted (what a step says it did, in its own words). */
  readonly notes: readonly string[];
  readonly beforeWeight: number;
  readonly afterWeight: number;
  /** `afterWeight - beforeWeight`: what the link's change to this group cost (+) or saved (-). */
  readonly delta: number;
  /**
   * The entities of the chain's first revision this group's weight traces back to, sorted; for a group whose trace
   * begins later (an entity a pass inserted), that entity. Empty when the group carries no weight.
   */
  readonly sources: readonly string[];
}

/** The index of one link: the groups, and what the entries say about each entity. */
interface LinkIndex {
  /** entity -> the key of its group (the smallest id of the component). */
  readonly group: ReadonlyMap<string, string>;
  /** Entities some entry maps to themselves: their identity survived the link. */
  readonly carried: ReadonlySet<string>;
  readonly relations: ReadonlyMap<string, readonly string[]>;
  readonly because: ReadonlyMap<string, readonly string[]>;
  readonly notes: ReadonlyMap<string, readonly string[]>;
  /** entity -> the `from` sets of the entries that produce it. */
  readonly into: ReadonlyMap<string, readonly (readonly string[])[]>;
}

function indexLink(c: EntityCorrespondence): LinkIndex {
  // union-find over the ids the entries mention, keyed by the smallest id of the component
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  for (const e of c.entries) for (const id of [...e.from, ...e.to]) if (!parent.has(id)) parent.set(id, id);
  for (const e of c.entries)
    for (const from of e.from)
      for (const to of e.to) {
        const a = find(from),
          b = find(to);
        if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
      }
  const group = new Map<string, string>();
  for (const id of parent.keys()) group.set(id, find(id));
  const carried = new Set<string>(),
    relations = new Map<string, Set<string>>(),
    because = new Map<string, Set<string>>(),
    notes = new Map<string, Set<string>>(),
    into = new Map<string, (readonly string[])[]>();
  for (const e of c.entries) {
    for (const to of e.to) {
      if (e.from.includes(to)) carried.add(to);
      into.set(to, [...(into.get(to) ?? []), e.from]);
    }
    for (const id of [...e.from, ...e.to]) {
      let r = relations.get(id);
      if (!r) relations.set(id, (r = new Set()));
      r.add(e.relation);
      let b = because.get(id);
      if (!b) because.set(id, (b = new Set()));
      for (const x of e.because ?? []) b.add(x);
      let n = notes.get(id);
      if (!n) notes.set(id, (n = new Set()));
      if (e.note) n.add(e.note);
    }
  }
  const sorted = (m: Map<string, Set<string>>) =>
    new Map([...m].map(([id, s]) => [id, [...s].sort(compareText)] as const));
  return {
    group,
    carried,
    relations: sorted(relations),
    because: sorted(because),
    notes: sorted(notes),
    into,
  };
}

/** The derivation steps that name one of `ids`: a step's site is the entities it consumed and produced. */
function stepsOf(derivation: Derivation | undefined, ids: ReadonlySet<string>): readonly number[] {
  if (!derivation) return [];
  const out: number[] = [];
  derivation.steps.forEach((s: DerivationStep, i: number) => {
    if (s.consumes.some(id => ids.has(id)) || s.produces.some(id => ids.has(id))) out.push(i);
  });
  return out;
}

/** Steps' rules or decisions, each once, in step order. */
const byOf = (steps: readonly DerivationStep[]): readonly DerivationBy[] => {
  const seen = new Set<string>();
  const out: DerivationBy[] = [];
  for (const s of steps) {
    const key = 'rule' in s.by ? `rule:${s.by.table ?? ''}/${s.by.rule}` : `decision:${s.by.decision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.by);
  }
  return out;
};

interface Slot {
  readonly before: string[];
  readonly after: string[];
  readonly relations: Set<string>;
  readonly because: Set<string>;
  readonly notes: Set<string>;
  weight: boolean;
}

/**
 * A chain of records, indexed once: the groups of every link, what each link's entries say about each entity, and
 * the labels of the links that made them. `recordChain` validates the chain and does the indexing; the two queries
 * are cheap afterwards (provenance is memoized per entity and revision, so asking for many sites shares the walk).
 */
export interface RecordChain {
  readonly links: readonly ChainLink[];
  /**
   * Credit the weight of every revision to the groups each link relates. `weightsAt(i)` is the weight of revision
   * `i`'s entities; it is asked for every revision of the chain (0 … links.length). `entities(i)` names ids a caller
   * wants in a group even when they carry no weight — the statements an edit names, so a group with a decision but
   * no change of weight still has a row. A group with no entity of either kind is not reported.
   */
  credit(
    weightsAt: (revision: number) => WeightMap,
    options?: { readonly entities?: (revision: number) => readonly string[] },
  ): readonly Credit[];
  /**
   * For each entity of the chain's last revision, the label of the link that made it as it is there — walking back
   * while the entity kept its identity, each once. An entity nothing in the chain made (the program the first
   * revision already had) has no labels.
   *
   * The walk stops at the link that made the entity: what the entity was computed *from* is that link's business,
   * and following the antecedent would name every pass that ever made an ancestor of every value, which is not what
   * "which passes touched this code" asks.
   */
  changedBy(entities: readonly string[]): ReadonlyMap<string, readonly string[]>;
}

/** Index a chain: validate that it is contiguous, then index each link once. */
export function recordChain(links: readonly ChainLink[]): RecordChain {
  links.forEach((l, i) => {
    if (i && !sameRevision(links[i - 1].correspondence.to, l.correspondence.from))
      throw new IRError('ir.attribution', `Link ${i} does not continue the chain at link ${i - 1}`);
  });
  const index = links.map(l => indexLink(l.correspondence));
  const memo = new Map<string, readonly string[]>();

  /** Where a group's weight came from: its before-entities walked back to the chain's first revision. */
  const trace = (before: readonly string[], i: number): string[] => {
    let current = [...before];
    for (let k = i - 1; k >= 0 && current.length; k--) {
      const next: string[] = [];
      for (const id of current)
        for (const f of index[k].into.get(id) ?? []) for (const x of f) if (!next.includes(x)) next.push(x);
      if (!next.length) break;
      current = next;
    }
    return [...new Set(current)].sort(compareText);
  };

  const credit = (
    weightsAt: (revision: number) => WeightMap,
    options: { readonly entities?: (revision: number) => readonly string[] } = {},
  ): readonly Credit[] => {
    const weights = Array.from({ length: links.length + 1 }, (_, i) => weightsAt(i));
    const named = Array.from({ length: links.length + 1 }, (_, i) => new Set(options.entities?.(i) ?? []));
    const rows: Credit[] = [];
    links.forEach((link, i) => {
      const ix = index[i],
        c = link.correspondence;
      const slots = new Map<string, Slot>();
      const slot = (key: string) => {
        let s = slots.get(key);
        if (!s)
          slots.set(
            key,
            (s = {
              before: [],
              after: [],
              relations: new Set(),
              because: new Set(),
              notes: new Set(),
              weight: false,
            }),
          );
        return s;
      };
      /** The entities of one revision that take part: they carry weight, or the caller names them. */
      const take = (
        ids: readonly string[],
        side: 'before' | 'after',
        weight: WeightMap,
        revision: number,
      ) => {
        for (const id of ids) {
          const weighed = weight.has(id);
          if (!weighed && !named[revision].has(id)) continue;
          const s = slot(ix.group.get(id) ?? `#${id}`);
          s[side].push(id);
          s.weight ||= weighed;
        }
      };
      take(c.sourceEntities, 'before', weights[i], i);
      take(c.targetEntities, 'after', weights[i + 1], i + 1);
      // ids with weight that this link does not know: they are groups of their own (`frame`, `backend`)
      for (const [weight, side] of [
        [weights[i], 'before'],
        [weights[i + 1], 'after'],
      ] as const)
        for (const [id] of weight)
          if (!ix.group.has(id)) {
            const s = slot(`#${id}`);
            s[side].push(id);
            s.weight = true;
          }
      for (const s of slots.values())
        for (const id of [...s.before, ...s.after]) {
          for (const r of ix.relations.get(id) ?? []) s.relations.add(r);
          for (const b of ix.because.get(id) ?? []) s.because.add(b);
          for (const n of ix.notes.get(id) ?? []) s.notes.add(n);
        }
      for (const s of slots.values()) {
        const ids = new Set([...s.before, ...s.after]);
        const stepIds = stepsOf(link.derivation, ids);
        const steps = stepIds.map(k => link.derivation!.steps[k]);
        const beforeWeight = s.before.reduce((n, id) => n + (weights[i].get(id) ?? 0), 0);
        const afterWeight = s.after.reduce((n, id) => n + (weights[i + 1].get(id) ?? 0), 0);
        rows.push({
          link: i,
          before: [...s.before].sort(compareText),
          after: [...s.after].sort(compareText),
          relations: [...s.relations].sort(compareText),
          steps: stepIds,
          by: byOf(steps),
          premises: [...new Set(steps.flatMap(st => st.premises))].sort(compareText),
          because: [...s.because].sort(compareText),
          notes: [...s.notes].sort(compareText),
          beforeWeight,
          afterWeight,
          delta: afterWeight - beforeWeight,
          sources: s.weight ? trace(s.before, i) : [],
        });
      }
    });
    return rows;
  };

  const changedBy = (entities: readonly string[]): ReadonlyMap<string, readonly string[]> => {
    const labelsOf = (entity: string, revision: number): readonly string[] => {
      const key = `${revision}:${entity}`;
      const hit = memo.get(key);
      if (hit) return hit;
      const made =
        revision > 0 && !index[revision - 1].carried.has(entity) ? [links[revision - 1].label] : [];
      const out = made.length ? made : revision > 0 ? labelsOf(entity, revision - 1) : [];
      memo.set(key, out);
      return out;
    };
    return new Map(entities.map(e => [e, labelsOf(e, links.length)] as const));
  };

  return { links, credit, changedBy };
}

/** Whether a chain mentions an entity at any link, on either side. */
export function inChain(entity: string, links: readonly ChainLink[]): boolean {
  return links.some(
    l => l.correspondence.sourceEntities.includes(entity) || l.correspondence.targetEntities.includes(entity),
  );
}
