/**
 * Attribution and provenance as queries over the record chain (IRWB-065-A, R3 K2, IRWB-039 phase 4.3).
 *
 * A transformation's own records — the correspondence it published (computed from its derivation, `derivation.ts`)
 * and the records that name entities (Typed: its edit records) — already say what the optimizer did. The two queries
 * here answer the two questions the explanation tools used to re-derive from IR trees and per-entity origins:
 *
 *   credit       how a link's weight difference distributes over the entities the link's records join. D1
 *                (`src/typed/attribute.ts`) charges executed instructions to pass decisions with this: the weights
 *                are emulator counts per site, pushed onto statements through the lowering correspondence, and the
 *                join a group rests on is the link's own correspondence entry, not the entity's origin.
 *   provenance   which link of a chain last changed an entity. D2 (`src/typed/missed.ts`) labels a site's code by
 *                the passes that made it with this, instead of walking each entity's origin fields.
 *
 * The queries read only the records: the correspondence entries (their relations, notes and reasons are the
 * derivation steps' own words) and the naming records the domain hands over. They never re-run a pass, re-match a
 * rule, or read an entity's `origin`. What a "site" is (D1: a statement, `frame`, `backend`) and what the naming
 * records are is the domain's; the domain supplies the site sets and translates its records, the query owns the
 * join, the distribution and the aggregation.
 */
import { validateCorrespondence } from './correspondence.js';
import type { CorrespondenceEntry, EntityCorrespondence } from './types.js';
import type { Derivation } from './derivation.js';

/** A record that names entities of a link's two revisions and says what it did to them (Typed: an edit record). */
export interface NamingRecord {
  /** What the record is, for the decision label (an edit kind: `replace`, `retarget`, …). */
  readonly key: string;
  readonly note?: string;
  readonly because: readonly string[];
  /** The entities the record names, of either revision; the ones that are sites name a group. */
  readonly entities: readonly string[];
}

/** One link of a revision chain: the correspondence its producer recorded, and the records that name its sites. */
export interface CreditLink {
  readonly correspondence: EntityCorrespondence;
  /** The link's derivation, when its producer records one: the per-entity words for what it made. */
  readonly derivation?: Derivation;
  readonly names: readonly NamingRecord[];
}

/** One side of a link, as the credit query sees it: which entities are sites, and each site's weight. */
export interface CreditSide {
  readonly sites: ReadonlySet<string>;
  readonly weights: ReadonlyMap<string, number>;
}

/** One group a link's records join: the sites of both revisions the entry binds, and what the records say of them. */
export interface CreditGroup {
  /** The group's site of the revision before (a new site joins the source entity its entry maps, as D1's join did). */
  readonly key: string;
  /** Every site of either revision in the group, sorted; a site no instruction ran can still be named. */
  readonly sites: readonly string[];
  readonly before: number;
  readonly after: number;
  /** The naming records' keys, sorted and distinct (D1's decision label aggregates them). */
  readonly keys: readonly string[];
  /** The notes of the naming records and of the entries that produced the group's new sites, sorted and distinct. */
  readonly notes: readonly string[];
  /** The naming records' reasons, with the entries' reasons for the group's new sites, sorted and distinct. */
  readonly because: readonly string[];
}

/**
 * Credit one link of a revision chain: join the sites of the two revisions through the link's correspondence —
 * a site the revision before also has joins itself; a site only the revision after has joins the source entity of
 * the entry that produced it, when that is a site of the revision before — and distribute the two weight maps over
 * the groups, aggregating the naming records that name each group's sites. A naming record's site that only the
 * revision after has contributes the note and reasons of the derivation step that produced it: the producer's own
 * words for that one entity. Groups are returned in no particular order; a group with a change but no naming
 * record is the link's indirect effect (D1 names it so).
 */
export function creditLink(link: CreditLink, before: CreditSide, after: CreditSide): readonly CreditGroup[] {
  const correspondence = validateCorrespondence(link.correspondence);
  const into = new Map<string, CorrespondenceEntry[]>();
  for (const entry of correspondence.entries)
    for (const target of entry.to) into.set(target, [...(into.get(target) ?? []), entry]);
  // a site of the revision after joins the source entity its entry maps, when that is a site of the revision before
  const groupOf = (id: string): string => {
    if (before.sites.has(id)) return id;
    if (!after.sites.has(id)) return id;
    for (const entry of into.get(id) ?? [])
      if (entry.from.length === 1 && before.sites.has(entry.from[0])) return entry.from[0];
    return id;
  };
  interface Group {
    before: number;
    after: number;
    sites: Set<string>;
    keys: Set<string>;
    notes: Set<string>;
    because: Set<string>;
  }
  const groups = new Map<string, Group>();
  const group = (id: string): Group => {
    const key = groupOf(id);
    let g = groups.get(key);
    if (!g)
      groups.set(
        key,
        (g = {
          before: 0,
          after: 0,
          sites: new Set(),
          keys: new Set(),
          notes: new Set(),
          because: new Set(),
        }),
      );
    g.sites.add(id);
    return g;
  };
  for (const [site, n] of before.weights) group(site).before += n;
  for (const [site, n] of after.weights) group(site).after += n;
  for (const record of link.names)
    for (const id of record.entities) {
      if (!before.sites.has(id) && !after.sites.has(id)) continue;
      const g = group(id);
      g.keys.add(record.key);
      if (record.note !== undefined) g.notes.add(record.note);
      for (const b of record.because) g.because.add(b);
      // a site only the revision after has says why in the step that produced it: the derivation's own words for
      // that one entity (an entry can map several, and its reasons would be all of theirs). A link whose producer
      // records no derivation has only the entry: its reasons are the group's.
      if (after.sites.has(id) && !before.sites.has(id)) {
        const steps = (link.derivation?.steps ?? []).filter(s => s.produces.includes(id));
        for (const s of steps) {
          if (s.note !== undefined) g.notes.add(s.note);
          for (const p of s.premises) if (!p.startsWith('guard:')) g.because.add(p);
        }
        if (!link.derivation)
          for (const entry of into.get(id) ?? []) {
            if (entry.note !== undefined) g.notes.add(entry.note);
            for (const b of entry.because ?? []) g.because.add(b);
          }
      }
    }
  return [...groups].map(([key, g]) => ({
    key,
    sites: [...g.sites].sort(),
    before: g.before,
    after: g.after,
    keys: [...g.keys].sort(),
    notes: [...g.notes].sort(),
    because: [...g.because].sort(),
  }));
}

/** One link of a provenance chain: the pass that produced the revision, and the correspondence it recorded. */
export interface ProvenanceLink {
  readonly pass: string;
  readonly correspondence: EntityCorrespondence;
}

/**
 * Which link of the chain last changed each entity of its last revision, as a query over the recorded
 * correspondences: an entry that maps an entity to itself says it survived the link; an entry that maps source
 * entities to it says this link's pass made it what it is (an entry with no sources, an insertion, says the same);
 * an entity no link changed predates the chain. Returns a function labeling entities with the changing link's
 * pass, or undefined for an entity the whole chain leaves alone (D2: `ingest`).
 */
export function provenanceLabels(chain: readonly ProvenanceLink[]): (entity: string) => string | undefined {
  const links = chain.map(({ pass, correspondence }) => ({
    pass,
    into: new Map<string, CorrespondenceEntry[]>(),
    correspondence: validateCorrespondence(correspondence),
  }));
  for (const link of links)
    for (const entry of link.correspondence.entries)
      for (const target of entry.to) link.into.set(target, [...(link.into.get(target) ?? []), entry]);
  const memo = new Map<string, string | undefined>();
  return entity => {
    let label = memo.get(entity);
    if (label !== undefined || memo.has(entity)) return label;
    let current = entity;
    label = undefined;
    for (let i = links.length - 1; i >= 0; i--) {
      const link = links[i],
        entries = link.into.get(current) ?? [];
      // an entry that maps the entity to itself: it survived the link (an antecedent of new entities, unchanged)
      const entry = entries.find(e => e.from.includes(current)) ?? entries.find(e => e.to.includes(current));
      if (!entry) break;
      if (entry.from.includes(current)) continue;
      label = link.pass;
      break;
    }
    memo.set(entity, label);
    return label;
  };
}
