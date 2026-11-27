/**
 * IRWB-034-E: attribution of executed RV32 instructions to the pass decisions that caused them.
 *
 * The compiler's own records already carry everything a decision-level cost account needs: the emulator counts
 * executions per instruction word, every image instruction names the typed.blocks statements it implements
 * (`covers`), and every published revision carries the edits the pass made and the correspondence from the
 * revision before it. `attributeSteps` puts them together, revision by revision:
 *
 *   - both revisions of a transition are lowered with the same backend options and run on the emulator with
 *     per-instruction counts, so the transition's cost is the emulator's own difference, not an estimate;
 *   - the counts are attributed to statements through `covers` (`heat`), and each statement's heat is carried
 *     across the transition through the revision's correspondence entries (`from → to` groups), so a surviving
 *     statement's delta, a removed statement's cost and a created statement's cost are all exact per entity and
 *     the account follows one instruction's history through as many passes as touched it;
 *   - each correspondence entry's credit (heat it gained or lost) is assigned to the first edit of the revision
 *     that names one of its entities, giving a decision table (an inline, an unroll, a hoist, a branch fold…);
 *   - what no entry covers — instructions that implement no statement, such as callee-saved saves and restores,
 *     spill code and frame setup, which the backend adds or removes because of a pass's register pressure — is
 *     reported as the transition's `overhead`, so `entries + overhead` always sums to the measured delta.
 *
 * `attributeOrigins` is the companion provenance view: every instruction the head image executes, credited to
 * the pass that produced its covering statement (the origin records' `rev`/`via`), for questions of the form
 * "who made what I am executing".
 */
import type { Artifact } from '../framework/core/types.js';
import type { CorrespondenceEntry, EntityCorrespondence } from '../framework/ir/types.js';
import type { Program, Revision } from './program.js';
import { storeOf } from './ir.js';
import type { TypedBlocks } from './model.js';
import { lowerToImage, runImage } from './backend/index.js';
import type { BackendOptionsInput } from './backend/options.js';

/** One call to attribute: the function, its arguments, and guest memory (buffers) if the program has them. */
export interface AttributeCase {
  readonly fn: string;
  readonly args: readonly number[];
  readonly memory?: Uint8Array;
  /** Backend options both revisions are lowered with (default: the backend's defaults). */
  readonly backend?: BackendOptionsInput;
  /** The emulator's instruction limit (default: `measure`'s 2e5). */
  readonly limit?: number;
}

/** A correspondence entry with the executed instructions its entities gained (positive) or lost (negative). */
export interface EntryCredit extends CorrespondenceEntry {
  readonly credit: number;
}

/** The credit carried by one edit of the revision (or by the pass itself, for entities no edit names). */
export interface DecisionCredit {
  /** The edit's id (`edit:r4.12`), or `pass` for correspondence no edit of the revision names. */
  readonly edit: string;
  readonly kind: string;
  readonly note?: string;
  readonly credit: number;
  /** The entry credits this decision sums, most expensive first. */
  readonly entries: readonly EntryCredit[];
}

export interface TransitionCredit {
  readonly rev: number;
  readonly pass: string;
  /** Executed instructions at the revision before (the input image on the same case). */
  readonly before: number;
  /** Executed instructions at this revision. */
  readonly after: number;
  /** `after - before`, from the emulator. */
  readonly delta: number;
  /**
   * The part of `delta` no correspondence entry accounts for: instructions covering no statement (saves,
   * restores, spills, frame code) the backend added or removed with this revision, and the residue of any
   * entity the correspondence shares between entries.
   */
  readonly overhead: number;
  /** The revision's correspondence entries with nonzero credit, most expensive first. */
  readonly entries: readonly EntryCredit[];
  /** Credit per edit (plus the `pass` bucket), most expensive first; sums to `delta - overhead`. */
  readonly decisions: readonly DecisionCredit[];
}

/** `attributeSteps` for every revision a program has published (r1 on; r0 has no transition). */
export function attributeSteps(p: Program, c: AttributeCase): readonly TransitionCredit[] {
  const out: TransitionCredit[] = [];
  for (let i = 1; i <= p.rev; i++) out.push(attributeTransition(p, i, c));
  return out;
}

/** The heat of one revision's image on one case: executed instructions per statement, and the run's total. */
const heatOf = (
  art: Artifact<TypedBlocks>,
  c: AttributeCase,
): { byStmt: ReadonlyMap<string, number>; steps: number } => {
  const { image } = lowerToImage(art, c.backend ?? {});
  const run = runImage(image, c.fn, c.args, c.memory ?? new Uint8Array(0), { limit: c.limit ?? 2e5 });
  if (run.trap || run.fault || run.limit || !run.counts)
    throw new Error(
      `attribution: the image of ${art.value.program} trapped on ${c.fn} (${run.trap ?? 'no counts'})`,
    );
  // heat()'s byStmt, without its per-line walk (linesOf is the expensive part, and this runs per revision)
  const st = storeOf(art.value);
  const byStmt = new Map<string, number>();
  for (const e of image.value.insns) {
    const n = run.counts[e.offset >>> 2];
    if (!n) continue;
    for (const cover of e.covers) {
      const k = st.get(cover);
      if (k && k.kind === 'stmt') byStmt.set(cover, (byStmt.get(cover) || 0) + n);
    }
  }
  return { byStmt, steps: run.steps };
};

const idsOf = (e: object): string[] => {
  const out: string[] = [];
  for (const v of Object.values(e))
    if (typeof v === 'string' && /^(s|v|bb|op|local|fn):/.test(v)) out.push(v);
    else if (Array.isArray(v))
      for (const x of v) if (typeof x === 'string' && /^(s|v|bb|op|local|fn):/.test(x)) out.push(x);
  return out;
};

const sortedEntries = (entries: readonly EntryCredit[]): readonly EntryCredit[] =>
  [...entries].sort((a, b) => Math.abs(b.credit) - Math.abs(a.credit));

/** Credit one revision (against the one before it) for the executed instructions its pass is responsible for. */
export function attributeTransition(p: Program, rev: number, c: AttributeCase): TransitionCredit {
  if (!(rev >= 1 && rev <= p.rev))
    throw new Error(`attribution: no revision r${rev} to credit (r1 to r${p.rev} have transitions)`);
  const r: Revision = p.revisions[rev];
  const corr: EntityCorrespondence | undefined = r.correspondence;
  if (!corr) throw new Error(`attribution: r${rev} (${r.pass}) has no correspondence to r${rev - 1}`);
  const A = heatOf(p.artifact(rev - 1), c),
    B = heatOf(p.artifact(rev), c);
  // one pass over the entries: each entity's heat counts once (first entry that names it), so the credits sum
  // exactly to covered(B) - covered(A) whatever the correspondence shares between entries
  const seenTo = new Set<string>(),
    seenFrom = new Set<string>();
  const credited: EntryCredit[] = [];
  let covered = 0;
  for (const e of corr.entries) {
    let credit = 0;
    for (const t of e.to)
      if (!seenTo.has(t)) {
        seenTo.add(t);
        credit += B.byStmt.get(t) ?? 0;
      }
    for (const f of e.from)
      if (!seenFrom.has(f)) {
        seenFrom.add(f);
        credit -= A.byStmt.get(f) ?? 0;
      }
    covered += credit;
    if (credit) credited.push({ ...e, credit });
  }
  const delta = B.steps - A.steps;
  const overhead = delta - covered;
  // assign each entry to the first edit of this revision that names one of its entities
  const edits = r.edits;
  const byEdit = new Map<string, { kind: string; note?: string; entries: EntryCredit[]; credit: number }>();
  const pass: { entries: EntryCredit[]; credit: number } = { entries: [], credit: 0 };
  for (const e of sortedEntries(credited)) {
    const ids = new Set([...e.from, ...e.to]);
    const edit = edits.find(x => idsOf(x).some(id => ids.has(id)));
    if (!edit) {
      pass.entries.push(e);
      pass.credit += e.credit;
      continue;
    }
    let b = byEdit.get(edit.id);
    if (!b) {
      b = {
        kind: edit.kind,
        ...(typeof edit.note === 'string' ? { note: edit.note } : {}),
        entries: [],
        credit: 0,
      };
      byEdit.set(edit.id, b);
    }
    b.entries.push(e);
    b.credit += e.credit;
  }
  const decisions: DecisionCredit[] = [
    ...[...byEdit.entries()].map(([id, b]) => ({
      edit: id,
      kind: b.kind,
      ...(b.note ? { note: b.note } : {}),
      credit: b.credit,
      entries: b.entries,
    })),
    ...(pass.credit ? [{ edit: 'pass', kind: 'pass', credit: pass.credit, entries: pass.entries }] : []),
  ].sort((a, b) => Math.abs(b.credit) - Math.abs(a.credit));
  return {
    rev,
    pass: r.pass,
    before: A.steps,
    after: B.steps,
    delta,
    overhead,
    entries: sortedEntries(credited),
    decisions,
  };
}

export interface OriginAttribution {
  /** Executed instructions of the head image, per pass that produced the covering statements. */
  readonly byPass: Readonly<{ pass: string; instructions: number; statements: number }[]>;
  /** Executed instructions covering no statement (prologue, callee-saved saves, spills, frame code). */
  readonly backend: number;
  readonly total: number;
}

/**
 * The head image's executed instructions, credited to the pass that produced each covered statement: a
 * statement's producer is the revision its current content's origin names (`origin[0].rev`), which updates when
 * a pass replaces a value in place, or the front end (`ingest`) when no origin names one.
 */
export function attributeOrigins(p: Program, c: AttributeCase): OriginAttribution {
  const head = p.artifact(p.rev);
  const { image } = lowerToImage(head, c.backend ?? {});
  const run = runImage(image, c.fn, c.args, c.memory ?? new Uint8Array(0), { limit: c.limit ?? 2e5 });
  if (run.trap || run.fault || run.limit || !run.counts)
    throw new Error(`attribution: the image trapped on ${c.fn} (${run.trap ?? 'no counts'})`);
  const st = storeOf(head.value);
  const passOf = new Map<string, string>();
  const byPass = new Map<string, { instructions: number; statements: Set<string> }>();
  let backend = 0;
  for (const insn of image.value.insns) {
    const n = run.counts[insn.offset >>> 2];
    if (!n) continue;
    let covered = false;
    for (const cover of insn.covers) {
      const e = st.get(cover);
      if (!e || e.kind !== 'stmt') continue;
      covered = true;
      let pass = passOf.get(cover);
      if (pass === undefined) {
        const origin = (e.origin ?? [])[0] as { rev?: number } | undefined;
        pass = origin?.rev !== undefined ? (p.revisions[origin.rev]?.pass ?? 'ingest') : 'ingest';
        passOf.set(cover, pass);
      }
      const b = byPass.get(pass) ?? { instructions: 0, statements: new Set<string>() };
      b.instructions += n;
      b.statements.add(cover);
      byPass.set(pass, b);
    }
    if (!covered) backend += n;
  }
  return {
    byPass: [...byPass.entries()]
      .map(([pass, b]) => ({ pass, instructions: b.instructions, statements: b.statements.size }))
      .sort((a, b) => b.instructions - a.instructions),
    backend,
    total: run.steps,
  };
}
