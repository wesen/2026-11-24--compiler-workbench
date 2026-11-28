/**
 * IRWB-056-B (IRWB-039 phase 4, concept K2): a derivation — the producer's own record of why a revision changed.
 *
 * A transformation's edits say *what* changed. A derivation says *why*: one step per thing the producer did, naming
 *   - `by`: the verified rule that licensed it (`{ rule, table }`), or the pass-local decision (`{ decision }`);
 *   - `consumes` / `produces`: the site, the entities it read in the input revision and the ones it made in the
 *     output (a step may name an entity an earlier step of the same derivation made: that is how a tree rebuilt
 *     bottom-up is recorded);
 *   - `premises`: the facts and entities it relied on. A premise prefixed `guard:` is a fact the rule's own guard
 *     checked (the rule table's `pure`, `pow2`, `boolean`, `noTrap`); every other premise is a domain fact (e.g.
 *     `fact:liveness(f)@r3`, `fact:ranges(f)@r5: x in [0, 255]`) or an entity;
 *   - `relation`: how the site in the input relates to the site in the output.
 *
 * From the steps, `correspondenceFromDerivation` computes the entity correspondence under a coverage policy (F35's
 * vocabulary: `partial`, `nonempty`, `source`, `target`, `both`). The rule it applies is the survival relation the
 * correspondence is about: a step contributes an entry only when it makes an entity the output did not have
 * (`relation` is then the derivation's `label`), and a `removed` step contributes one only for a source entity the
 * output no longer has, and a `merged` step maps the statement it consumed to the one that absorbed it — the
 * output already had it, so the entry is named by the step's own relation, `merged` (F40, IRWB-060-A). An entity
 * the step carries — an input entity it produced again, or an output entity that already existed — keeps its own
 * identity in the correspondence; the step records the link, the correspondence records survival. That is why a
 * derivation-computed correspondence equals the one the domains computed before derivations (the check in
 * tests/typed/derivations.test.mjs), and it is why Tix `inline` records `f/a → f/b` as `merged` — the survival
 * claim the two projections alone could only state as `removed`.
 *
 * Classification is a query, not a field: `locality` answers two declared policies over the same steps (R3: A0's
 * and G's, 203 and 395 local edits of the O2 corpus) and `stepText`/`byText` name a step for a report.
 */
import { immutable, canonical } from '../core/data.js';
import type { EntityCorrespondence, RevisionRef } from './types.js';
import { compareText, IRError, requireText } from './common.js';
import { checkCoverage, makeCorrespondence, type Coverage } from './correspondence.js';

/** How a step relates its site in the input revision to its site in the output revision. */
export type DerivationRelation = 'modified' | 'merged' | 'split' | 'inserted' | 'removed' | 'retained';
/** What licensed a step: a verified rule (with the table it belongs to), or a pass-local decision id. */
export type DerivationBy = { readonly rule: string; readonly table?: string } | { readonly decision: string };

export interface DerivationStep {
  readonly by: DerivationBy;
  /**
   * Entities of the input revision the step read (and any entity an earlier step of the derivation made). The first
   * is the step's antecedent: the entity its products stand for in the correspondence. The rest is the site it read
   * to get there (the operands the rule matched).
   */
  readonly consumes: readonly string[];
  /** Entities the step made; an entity of the input it produces again is `retained`/`modified`, not new. */
  readonly produces: readonly string[];
  readonly premises: readonly string[];
  readonly relation: DerivationRelation;
  readonly note?: string;
}

export interface Derivation {
  readonly formatVersion: 1;
  /** The relation a mapped correspondence entry names: the producer's own label (`simplify`, `inline`). */
  readonly label: string;
  readonly steps: readonly DerivationStep[];
}

/** Coverage policy accepted by derivation producers: the one vocabulary of `correspondence.ts` (F41). */
export type DerivationCoverage = Coverage;

const RELATIONS = new Set<string>(['modified', 'merged', 'split', 'inserted', 'removed', 'retained']);
const GUARD = 'guard:';

const text = (value: unknown, label: string): string => (requireText(value, label), value as string);
const texts = (value: readonly string[] | undefined, label: string): readonly string[] => {
  if (!Array.isArray(value)) throw new IRError('ir.derivation', `${label} must be an array`);
  value.forEach(v => text(v, label));
  // in the producer's order: a step's first consumed entity is its antecedent (see `stepEntries`)
  return immutable([...new Set(value as readonly string[])]);
};
const by = (value: DerivationBy | undefined): DerivationBy => {
  if (!value || typeof value !== 'object') throw new IRError('ir.derivation', 'A step needs `by`');
  if ('rule' in value) {
    text(value.rule, 'Step rule');
    if (value.table !== undefined) text(value.table, 'Step rule table');
    return immutable({
      rule: value.rule as string,
      ...(value.table ? { table: value.table as string } : {}),
    });
  }
  return immutable({ decision: text((value as { decision?: unknown }).decision, 'Step decision') });
};

export function makeDerivation(label: string, steps: readonly DerivationStep[]): Derivation {
  requireText(label, 'Derivation label');
  if (!Array.isArray(steps)) throw new IRError('ir.derivation', 'Derivation steps must be an array');
  return immutable({
    formatVersion: 1 as const,
    label,
    steps: steps.map(s => {
      if (!s || typeof s !== 'object') throw new IRError('ir.derivation', 'A step must be an object');
      if (!RELATIONS.has(s.relation))
        throw new IRError('ir.derivation', `Unknown step relation ${String(s.relation)}`);
      if (s.note !== undefined) text(s.note, 'Step note');
      return {
        by: by(s.by),
        consumes: texts(s.consumes, 'Step consumes'),
        produces: texts(s.produces, 'Step produces'),
        premises: texts(s.premises, 'Step premises'),
        relation: s.relation,
        ...(s.note ? { note: s.note } : {}),
      };
    }),
  });
}

/** `simplify/mul-pow2`, `simplify/...` or `decision:remove` — a step's name in an error or a report. */
export function byText(value: DerivationBy): string {
  return 'rule' in value
    ? `${value.table ? value.table + '/' : ''}${value.rule}`
    : `decision:${value.decision}`;
}

/**
 * The site check: every entity a step names must exist — in the input revision or the output revision, or be made
 * (or read) by a step of the same derivation. A rule that carries an existing entity produces it again rather than
 * making it, so a produced entity may be one of the input's; a value touched only by this derivation but dropped from
 * the output (a tree rebuilt and then folded away) is reachable through the step that read it.
 */
export function validateDerivation(
  derivation: Derivation,
  sourceEntities: readonly string[],
  targetEntities: readonly string[],
): Derivation {
  const source = new Set(sourceEntities),
    target = new Set(targetEntities),
    produced = new Set(derivation.steps.flatMap(s => s.produces)),
    consumed = new Set(derivation.steps.flatMap(s => s.consumes));
  derivation.steps.forEach((step, i) => {
    if (!step.consumes.length && !step.produces.length)
      throw new IRError(
        'ir.derivation',
        `Step ${i} (${byText(step.by)}) names no site: a step records what it consumed and produced`,
      );
    for (const id of step.consumes)
      if (!source.has(id) && !produced.has(id))
        throw new IRError(
          'ir.derivation',
          `Step ${i} (${byText(step.by)}) consumes ${id}, which is in neither the input revision nor this derivation`,
        );
    for (const id of step.produces)
      if (!target.has(id) && !source.has(id) && !consumed.has(id))
        throw new IRError(
          'ir.derivation',
          `Step ${i} (${byText(step.by)}) produces ${id}, which is in neither the output revision nor this derivation`,
        );
  });
  return derivation;
}

/** The entries the steps themselves map: source entities to output entities, grouped by source entity. */
function stepEntries(derivation: Derivation, source: Set<string>, target: Set<string>) {
  const groups = new Map<
    string,
    {
      from: readonly string[];
      to: Set<string>;
      because: Set<string>;
      notes: Map<string, string>;
      relation: string;
    }
  >();
  const group = (from: readonly string[]) => {
    const key = canonical(from);
    let g = groups.get(key);
    if (!g)
      groups.set(
        key,
        (g = { from, to: new Set(), because: new Set(), notes: new Map(), relation: derivation.label }),
      );
    return g;
  };
  // a group's notes are in the order of the entities they are about, and each note is said once
  const noteOf = (g: { notes: Map<string, string> }) =>
    [...g.notes]
      .sort(([a], [b]) => compareText(a, b))
      .map(([, note]) => note)
      .filter((note, i, all) => all.indexOf(note) === i)
      .join(' > ');
  for (const step of derivation.steps) {
    const antecedent = step.consumes[0];
    if (antecedent === undefined || !source.has(antecedent)) continue; // nothing of the input to relate: the correspondence's own fill says 'inserted'
    const from = [antecedent];
    const produced = step.produces.filter(id => target.has(id));
    const fresh = produced.filter(id => !source.has(id));
    const survived = from.filter(id => target.has(id));
    if (fresh.length) {
      const g = group(from);
      for (const id of [...produced, ...survived]) g.to.add(id);
      for (const p of step.premises) if (!p.startsWith(GUARD)) g.because.add(p);
      for (const id of produced) if (step.note && !g.notes.has(id)) g.notes.set(id, step.note);
      continue;
    }
    // F40 (IRWB-060-A): a merge is survival with a new identity — the consumed entity lives on in the one
    // that absorbed it, which the output already had. The step maps them, and the entry is named by the
    // step's own relation (`merged`), because it states what happened to the consumed side, which the
    // derivation's label (the rewrite the pass performs) does not.
    if (step.relation === 'merged' && produced.length) {
      const g = group(from);
      for (const id of produced) g.to.add(id);
      for (const p of step.premises) if (!p.startsWith(GUARD)) g.because.add(p);
      for (const id of produced) if (step.note && !g.notes.has(id)) g.notes.set(id, step.note);
      g.relation = 'merged';
      continue;
    }
    if (step.relation !== 'removed') continue; // a step that carries its entities changes no identity
    const gone = from.filter(id => !target.has(id));
    if (!gone.length || produced.length) continue;
    const g = group(gone);
    for (const p of step.premises) if (!p.startsWith(GUARD)) g.because.add(p);
    for (const id of gone) if (step.note && !g.notes.has(id)) g.notes.set(id, step.note);
  }
  return [...groups.values()]
    .filter(g => g.to.size || g.from.some(id => !target.has(id)))
    .map(g => ({
      from: [...g.from].sort(compareText),
      to: [...g.to].sort(compareText),
      relation: g.to.size ? g.relation : 'removed',
      ...(g.because.size ? { because: [...g.because].sort(compareText) } : {}),
      ...(g.notes.size ? { note: noteOf(g) } : {}),
    }));
}

/**
 * The correspondence the steps imply, completed the way every correspondence is: entities the steps do not mention
 * keep their identity (`retained`), source entities that are gone are `removed`, output entities with no antecedent
 * are `inserted`. `coverage` says what the *steps* must account for: `nonempty` (at least one mapped entry when the
 * two revisions differ), `source`/`target`/`both` (every entity on that side mapped by an entry), `partial` (no
 * requirement). A policy it cannot meet is an `IRError`: an empty mapping explains nothing and is not a
 * correspondence.
 */
export function correspondenceFromDerivation(
  derivation: Derivation,
  from: RevisionRef,
  to: RevisionRef,
  sourceEntities: readonly string[],
  targetEntities: readonly string[],
  options: { readonly coverage?: DerivationCoverage } = {},
): EntityCorrespondence {
  const coverage = options.coverage ?? 'partial';
  if (!['partial', 'nonempty', 'source', 'target', 'both'].includes(coverage))
    throw new IRError('ir.derivation', `Unknown coverage policy ${coverage}`);
  const entries = stepEntries(derivation, new Set(sourceEntities), new Set(targetEntities));
  const c = makeCorrespondence(from, to, sourceEntities, targetEntities, entries);
  const failure = checkCoverage(coverage === 'nonempty' ? { ...c, entries } : c, coverage);
  if (failure === 'empty')
    throw new IRError(
      'ir.derivation',
      `The derivation maps nothing${derivation.steps.length ? ` (${derivation.steps.length} steps, none of them a mapping)` : ' (no steps)'}: coverage 'nonempty' is not met`,
    );
  if (failure === 'source')
    throw new IRError('ir.derivation', 'The derivation does not cover every source entity');
  if (failure === 'target')
    throw new IRError('ir.derivation', 'The derivation does not cover every target entity');
  return c;
}

/** How a step's work is read, for a query: `local` (the claim is about the input revision alone) or not. */
export type LocalityPolicy = 'scoped' | 'in-place';

/**
 * Classification as a query (R3: no `class` field on a step). It reads one step and the facts it cited, and answers
 * `local` when the claim the step makes is about the input revision alone. R3 counted two policies' answers on the O2
 * corpus (203 and 395 local edit records); they differ in what they accept as the input's own:
 *   scoped    (A0): the step needs nothing outside its site — every premise is a guard, a domain fact, or an entity
 *                   the step itself consumed. A rewrite that cites another statement's definition (`constprop`,
 *                   `subst`) is not local.
 *   in-place  (G):  the step needs nothing this application put into the program — every premise is a guard, a domain
 *                   fact, or an entity of `input` (the input revision's entities, and whatever the producer only remade
 *                   from them: a tree rebuilt around a changed operand is the input's tree). `constprop` and `subst`
 *                   are local (their premises are the input's statements); a rewrite whose premise is a statement
 *                   this same application inserted (`licm`, `lvn`) is not.
 * A step that only records a removal or an insertion is `other` under both. A query over an edit's records applies
 * this to every step the edit cites and requires all of them to be local.
 */
export function locality(
  step: DerivationStep,
  input: ReadonlySet<string>,
  policy: LocalityPolicy,
): 'local' | 'structural' | 'other' {
  if (step.relation !== 'modified' || !step.consumes.length) return 'other';
  const site = new Set(step.consumes);
  for (const premise of step.premises) {
    // a guard, or a domain fact about the input revision (`fact:ranges(f)@r5: x in [0, 255]`): not an entity
    if (premise.startsWith(GUARD) || premise.startsWith('fact:')) continue;
    if (policy === 'scoped' ? site.has(premise) : input.has(premise)) continue;
    return 'structural';
  }
  return 'local';
}

/**
 * The entities an application's steps may rest on under the in-place policy (IRWB-065-A): the input revision's
 * entities, and what the application's own rewrite chains only remade — the products of `rebuild` steps (a tree
 * re-hung around a changed operand is the input's tree) and of rule steps (an intermediate a rule chain computes
 * and a later rule of the same chain consumes is part of that chain's net change, not something the application
 * placed into the program). Not included: locals the application created, statements it inserted, and values it
 * made outside a rule chain (`licm`'s hoisted tree, `lvn`'s numbered value) — a step citing one of those needs
 * something the application introduced, so it is structural.
 *
 * This is the settled reading of R3's two counts (203 and 395 local edits of the O2 corpus): A0's header defines a
 * local rewrite as one "where B reads only locals the input revision already defines", and a chain of replaces by
 * its net change — so the two `fold` records whose premise is a constant the same application's rule chain
 * computed are local, and the in-place policy answers 395 where taking every made entity as new answered 393.
 */
export function inPlaceInput(derivation: Derivation, sourceEntities: readonly string[]): ReadonlySet<string> {
  const input = new Set(sourceEntities);
  for (const step of derivation.steps)
    if ('rule' in step.by || ('decision' in step.by && step.by.decision === 'rebuild'))
      for (const id of step.produces) input.add(id);
  return input;
}
