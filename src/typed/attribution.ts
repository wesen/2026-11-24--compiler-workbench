/**
 * Instruction attribution (IRWB-034-F): which pass decisions the executed instructions of an image come from.
 *
 * Two images are lowered with the same backend options, one from the first revision of a chain and one from the
 * last, and run on the same cases with per-instruction counts. Every executed instruction of the last image is
 * credited to a decision and every executed instruction of the first image is debited to one, so the difference
 * of the two totals splits exactly into per-decision nets.
 *
 * A decision is one pass's change for one reason: (revision, pass, the sorted `because` ids). The records read
 * are the instructions' `covers` (typed.blocks ids), each revision's correspondence (new entities from their
 * origins, removals with their reasons) and each revision's edit log, which has the in-place edits that the
 * correspondence shows as `retained` (a retargeted branch, a replaced operand, a moved statement).
 *
 * - Lineage (backwards): for an entity of the last revision, every decision on the way back to the first
 *   revision: a step that derived it from other entities, or edited it in place.
 * - Fate (forwards): for an entity of the first revision, the first step that removed it, derived something from
 *   it, or edited it in place.
 * - An instruction of the last image is credited to the earliest decision in the lineage of its covers; one of
 *   the first image is debited to the earliest fate of its covers. The same rule on both sides keeps a statement
 *   that two passes changed on one decision. Covers without any decision go to `unchanged`; instructions that
 *   cover only the function (frame, saves, restores, return) go to `frame <fn>`.
 */
import type { CorrespondenceEntry } from '../framework/ir/types.js';
import { lowerToImage, runImage, type BackendOptionsInput, type ImageInsn } from './backend/index.js';
import type { Case } from './evaluate.js';
import type { Revision } from './program.js';
import type { Edit } from './tx.js';

/** One step of an entity's history: the revision and pass that changed it, how, and why. */
export interface LineageStep {
  readonly rev: number;
  readonly pass: string;
  /** A correspondence relation (the pass's `via`, `removed`, ...) or an edit kind (`replace`, `retarget`, ...). */
  readonly kind: string;
  readonly because: readonly string[];
  /** The entity at that revision (the one derived or edited). */
  readonly entity: string;
  readonly note?: string;
}

export interface DecisionRow {
  /** `r<rev> <pass>` and the reasons in brackets; or `unchanged`; or `frame <fn>`. */
  readonly key: string;
  readonly rev: number | null;
  readonly pass: string | null;
  readonly because: readonly string[];
  readonly kinds: readonly string[];
  /** Executions of last-image instructions credited to the decision. */
  readonly credit: number;
  /** Executions of first-image instructions debited to it. */
  readonly debit: number;
  readonly net: number;
  /** Distinct executed instructions credited, and debited. */
  readonly insns: readonly [number, number];
}

export interface AttributedInsn {
  readonly id: string;
  readonly fn: string;
  readonly sym: string;
  readonly count: number;
  readonly covers: readonly string[];
  /** The decision row this instruction's count went to. */
  readonly decision: string;
  /** Last image: the whole lineage of its covers, oldest first. First image: the fate steps of its covers. */
  readonly steps: readonly LineageStep[];
}

export interface Attribution {
  readonly from: { readonly rev: number; readonly revision: string; readonly total: number };
  readonly to: { readonly rev: number; readonly revision: string; readonly total: number };
  /** to.total - from.total, which the nets sum to. */
  readonly difference: number;
  /** Sorted by |net|, largest first. */
  readonly decisions: readonly DecisionRow[];
  /** The decisions summed per revision and pass (`r<rev> <pass>`), plus `unchanged` and the frames. */
  readonly passes: readonly DecisionRow[];
  /** Executed instructions of the last image, and of the first image. */
  readonly insns: readonly AttributedInsn[];
  readonly baseline: readonly AttributedInsn[];
}

const IN_PLACE = new Set(['replace', 'retarget', 'move', 'insert']);
const keyOf = (rev: number, pass: string, because: readonly string[]) =>
  `r${rev} ${pass}` + (because.length ? ` [${[...because].sort().join(', ')}]` : '');
const stepKey = (s: LineageStep) => keyOf(s.rev, s.pass, s.because);
const earliest = (steps: readonly LineageStep[]) =>
  steps.reduce<LineageStep | null>(
    (best, s) => (!best || s.rev < best.rev || (s.rev === best.rev && stepKey(s) < stepKey(best)) ? s : best),
    null,
  );

interface Step {
  readonly rev: number;
  readonly pass: string;
  readonly byTo: Map<string, CorrespondenceEntry[]>;
  readonly byFrom: Map<string, CorrespondenceEntry[]>;
  readonly edits: Map<string, Edit[]>;
}

const push = <V>(m: Map<string, V[]>, k: string, v: V) => {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
};

function stepsOf(chain: readonly Revision[]): Step[] {
  const out: Step[] = [];
  for (let k = 1; k < chain.length; k++) {
    const r = chain[k],
      c = r.correspondence;
    if (!c || c.from.revision !== chain[k - 1].artifact.revision || c.to.revision !== r.artifact.revision)
      throw new Error(`attribution: r${r.rev} is not the revision after r${chain[k - 1].rev}`);
    const byTo = new Map<string, CorrespondenceEntry[]>(),
      byFrom = new Map<string, CorrespondenceEntry[]>(),
      edits = new Map<string, Edit[]>();
    for (const e of c.entries) {
      for (const t of e.to) push(byTo, t, e);
      for (const f of e.from) push(byFrom, f, e);
    }
    for (const e of r.edits) if (IN_PLACE.has(e.kind) && typeof e.stmt === 'string') push(edits, e.stmt, e);
    out.push({ rev: r.rev, pass: r.pass, byTo, byFrom, edits });
  }
  return out;
}

const plain = (e: CorrespondenceEntry) => e.relation === 'retained' && !e.because?.length;
const editStep = (s: Step, e: Edit, entity: string): LineageStep => ({
  rev: s.rev,
  pass: s.pass,
  kind: e.kind,
  because: (e.because as string[] | undefined) ?? [],
  entity,
});
const entryStep = (s: Step, e: CorrespondenceEntry, entity: string): LineageStep => ({
  rev: s.rev,
  pass: s.pass,
  kind: e.relation,
  because: e.because ?? [],
  entity,
  ...(e.note ? { note: e.note } : {}),
});

/** Executions per instruction of `image` over `cases`, summed. */
function counted(image: ReturnType<typeof lowerToImage>['image'], cases: readonly Case[], label: string) {
  const sums = new Map<string, number>();
  let total = 0;
  for (const [i, c] of cases.entries()) {
    const r = runImage(image, c.fn, c.args, c.memory);
    if (r.limit || r.fault || !r.counts)
      throw new Error(`attribution: case ${i} of ${c.fn} did not finish on the ${label} image`);
    total += r.steps;
    for (const insn of image.value.insns) {
      const n = r.counts[insn.offset >>> 2];
      if (n) sums.set(insn.id, (sums.get(insn.id) ?? 0) + n);
    }
  }
  return { sums, total };
}

/**
 * Attribute the instruction difference between the first and the last revision of `chain` (consecutive
 * revisions as `Program.revisions` holds them) on `cases`, with both images lowered with `options`.
 */
export function attributeInstructions(
  chain: readonly Revision[],
  cases: readonly Case[],
  options: BackendOptionsInput = {},
): Attribution {
  if (!chain.length) throw new Error('attribution: the chain is empty');
  const steps = stepsOf(chain);
  const first = chain[0],
    last = chain[chain.length - 1];

  // lineage of an entity of revision index k (0 = first), memoized per (k, entity)
  const memo = new Map<string, LineageStep[]>();
  const lineage = (entity: string, k: number): LineageStep[] => {
    if (k === 0) return [];
    const mk = `${k}|${entity}`;
    const known = memo.get(mk);
    if (known) return known;
    memo.set(mk, []); // a cycle cannot occur in a chain; this guards against a malformed one
    const s = steps[k - 1],
      out: LineageStep[] = [];
    for (const e of s.byTo.get(entity) ?? []) {
      if (plain(e)) {
        for (const ed of s.edits.get(entity) ?? []) out.push(editStep(s, ed, entity));
        out.push(...lineage(entity, k - 1));
      } else {
        out.push(entryStep(s, e, entity));
        for (const f of e.from) out.push(...lineage(f, k - 1));
      }
    }
    const seen = new Set<string>();
    const unique = out
      .filter(x => {
        const id = `${stepKey(x)}|${x.kind}|${x.entity}`;
        return !seen.has(id) && !!seen.add(id);
      })
      .sort((a, b) => a.rev - b.rev);
    memo.set(mk, unique);
    return unique;
  };
  // fate of an entity of the first revision: the steps of the first step that changes it
  const fate = (entity: string): LineageStep[] => {
    for (const s of steps) {
      const changed = (s.byFrom.get(entity) ?? []).filter(e => !plain(e));
      if (changed.length) return changed.map(e => entryStep(s, e, entity));
      const edits = s.edits.get(entity);
      if (edits?.length) return edits.map(e => editStep(s, e, entity));
    }
    return [];
  };

  const rows = new Map<
    string,
    {
      rev: number | null;
      pass: string | null;
      because: readonly string[];
      kinds: Set<string>;
      credit: number;
      debit: number;
      insns: [number, number];
    }
  >();
  const row = (key: string, step: LineageStep | null) => {
    let r = rows.get(key);
    if (!r)
      rows.set(
        key,
        (r = {
          rev: step?.rev ?? null,
          pass: step?.pass ?? null,
          because: step ? [...step.because].sort() : [],
          kinds: new Set(),
          credit: 0,
          debit: 0,
          insns: [0, 0],
        }),
      );
    return r;
  };
  const isProgramEntity = (id: string) => !id.startsWith('fn:');

  const side = (rev: Revision, which: 'credit' | 'debit') => {
    const { image } = lowerToImage(rev.artifact, options);
    const { sums, total } = counted(image, cases, which === 'credit' ? `r${last.rev}` : `r${first.rev}`);
    const out: AttributedInsn[] = [];
    for (const insn of image.value.insns as readonly ImageInsn[]) {
      const count = sums.get(insn.id);
      if (!count) continue;
      const covers = insn.covers.filter(isProgramEntity);
      let key: string,
        chosen: LineageStep | null = null,
        all: LineageStep[] = [];
      if (!covers.length) key = `frame ${insn.fn}`;
      else {
        all = covers.flatMap(c => (which === 'credit' ? lineage(c, chain.length - 1) : fate(c)));
        chosen = earliest(all);
        key = chosen ? stepKey(chosen) : 'unchanged';
      }
      const r = row(key, chosen);
      if (chosen) for (const s of all) if (stepKey(s) === key) r.kinds.add(s.kind);
      if (which === 'credit') {
        r.credit += count;
        r.insns[0]++;
      } else {
        r.debit += count;
        r.insns[1]++;
      }
      out.push({
        id: insn.id,
        fn: insn.fn,
        sym: insn.sym,
        count,
        covers: insn.covers,
        decision: key,
        steps: all.sort((a, b) => a.rev - b.rev),
      });
    }
    return { out, total };
  };
  const credited = side(last, 'credit'),
    debited = side(first, 'debit');

  const finish = (key: string, r: NonNullable<ReturnType<typeof rows.get>>): DecisionRow => ({
    key,
    rev: r.rev,
    pass: r.pass,
    because: r.because,
    kinds: [...r.kinds].sort(),
    credit: r.credit,
    debit: r.debit,
    net: r.credit - r.debit,
    insns: [r.insns[0], r.insns[1]],
  });
  const byNet = (a: DecisionRow, b: DecisionRow) =>
    Math.abs(b.net) - Math.abs(a.net) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const decisions = [...rows].map(([k, r]) => finish(k, r)).sort(byNet);
  const perPass = new Map<string, DecisionRow>();
  for (const d of decisions) {
    const key = d.pass === null ? d.key : `r${d.rev} ${d.pass}`;
    const p = perPass.get(key);
    perPass.set(
      key,
      p
        ? {
            ...p,
            kinds: [...new Set([...p.kinds, ...d.kinds])].sort(),
            credit: p.credit + d.credit,
            debit: p.debit + d.debit,
            net: p.net + d.net,
            insns: [p.insns[0] + d.insns[0], p.insns[1] + d.insns[1]],
          }
        : { ...d, key, because: [] },
    );
  }
  return {
    from: { rev: first.rev, revision: first.artifact.revision, total: debited.total },
    to: { rev: last.rev, revision: last.artifact.revision, total: credited.total },
    difference: credited.total - debited.total,
    decisions,
    passes: [...perPass.values()].sort(byNet),
    insns: credited.out,
    baseline: debited.out,
  };
}

/**
 * The same attribution one revision at a time: step k compares the images of revisions k-1 and k, so its nets sum
 * to that pass's own effect on the count (what replaying the chain pass by pass measures), and every decision in
 * it is the pass's own. The whole-chain attribution instead credits an instruction to the first pass that changed
 * it, which can move a term from the pass that caused it to an earlier one that touched the same statements.
 */
export function attributeSteps(
  chain: readonly Revision[],
  cases: readonly Case[],
  options: BackendOptionsInput = {},
): readonly Attribution[] {
  const out: Attribution[] = [];
  for (let k = 1; k < chain.length; k++)
    out.push(attributeInstructions(chain.slice(k - 1, k + 1), cases, options));
  return out;
}
