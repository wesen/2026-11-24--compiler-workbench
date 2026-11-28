/**
 * Attribution of executed instructions to pass decisions (IRWB-034-G), as a query over the passes' records
 * (IRWB-065-B, phase 4 item 4.3).
 *
 * For one concrete call and a chain of revisions, each pass step is measured on the emulator: the revision before
 * the pass and the one after are both lowered and run, and the per-instruction counts are summed per site. A site
 * is the statement an instruction covers, `frame` for an instruction that covers only its function (frame, saved
 * registers, ret), or `backend` for one that covers nothing. The weights reach the statements through the lowering's
 * own correspondence (`typed.lower-rv32`: which statement an instruction implements), not by reading the image's
 * `covers` by hand.
 *
 * The join of the two revisions is `creditChain`'s (`src/framework/ir/attribution.ts`): the groups are the
 * connected components of the pass's correspondence, so what a statement became is one group, and each group's
 * difference is the pass's cost or saving on it. Each group also carries the derivation steps the pass recorded for
 * its entities (`by`: a verified rule or a pass-local decision) and the reasons its entries give. The decision text
 * a row prints is the edit records' — `<pass>: <edit kinds> (<note>)` — because that is the vocabulary of the
 * IRWB-034-G tables; a group whose count changed without an edit naming it is the pass's indirect effect: the same
 * statement, compiled differently.
 *
 * The rows of a step sum to the emulator's difference for that step, and the steps to the difference between the
 * first revision and the last, so every instruction of the difference is credited exactly once and none is
 * estimated.
 */
import type { Artifact } from '../framework/core/types.js';
import type { ChainLink, WeightMap } from '../framework/ir/attribution.js';
import { recordChain } from '../framework/ir/attribution.js';
import type { DerivationBy, DerivationStep } from '../framework/ir/derivation.js';
import { lowerToImage, runImage, type BackendOptionsInput } from './backend/index.js';
import { storeOf } from './ir.js';
import { showStmt } from './listing.js';
import type { StmtRec, Store, TypedBlocks } from './model.js';
import type { Edit } from './tx.js';

/** What `attributeSteps` needs of a revision (`Program.revisions` has it). */
export interface AttributedRevision {
  readonly rev: number;
  readonly pass: string;
  readonly artifact: Artifact<TypedBlocks>;
  readonly edits: readonly Edit[];
  /** The producer's steps for this revision, and the correspondence into it: the records the query reads. */
  readonly derivation?: ChainLink['derivation'];
  readonly correspondence?: ChainLink['correspondence'];
}

export interface AttributedCall {
  readonly fn: string;
  readonly args: readonly number[];
  readonly memory: Uint8Array;
}

/** One group of one step: the statements joined across the two revisions, and what the pass did to them. */
export interface AttributionRow {
  /** The revision the pass produced. */
  readonly rev: number;
  readonly pass: string;
  /** `<pass>: <edit kinds> (<note>)`, or `<pass>: indirect` for a group no edit names. */
  readonly decision: string;
  readonly because: readonly string[];
  /** Executed instructions after the pass minus before it. */
  readonly delta: number;
  readonly before: number;
  readonly after: number;
  /** The group's statements (or `frame`, `backend`), with their text at the newer revision that has them. */
  readonly sites: readonly { readonly id: string; readonly text: string }[];
  /** The rules or decisions the pass recorded for the group's entities (empty when it recorded none). */
  readonly by: readonly DerivationBy[];
}

export interface DecisionRow {
  readonly decision: string;
  readonly pass: string;
  readonly delta: number;
  /** Instructions the decision's groups execute after its pass. */
  readonly after: number;
  readonly groups: number;
}

export interface Attribution {
  readonly call: { readonly fn: string; readonly args: readonly number[] };
  /** Executed instructions at each revision of the chain. */
  readonly totals: readonly { readonly rev: number; readonly pass: string; readonly instructions: number }[];
  /** Every group that changed or that an edit names, in chain order, largest difference first within a step. */
  readonly rows: readonly AttributionRow[];
  /** The rows summed by decision, largest cost first. */
  readonly decisions: readonly DecisionRow[];
}

const FRAME = 'frame',
  BACKEND = 'backend';

/** Rules and decisions, in order, each once: what the query found and what the edits cite. */
const byOf = (a: readonly DerivationBy[], b: readonly DerivationStep[]): DerivationBy[] => {
  const seen = new Set<string>();
  const out: DerivationBy[] = [];
  for (const by of [...a, ...b.map(s => s.by)]) {
    const key = 'rule' in by ? `rule:${by.table ?? ''}/${by.rule}` : `decision:${by.decision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(by);
  }
  return out;
};

const isStmt = (st: Store, id: unknown): id is string =>
  typeof id === 'string' && st.has(id) && (st.get(id) as { kind?: string }).kind === 'stmt';

interface Measured {
  readonly st: Store;
  readonly total: number;
  /** Executed instructions per site: the statement an instruction implements, or `frame` / `backend`. */
  readonly weights: WeightMap;
}

/**
 * Lower one revision, run the call on the image, and push the per-instruction counts onto the revision's entities
 * through the lowering's correspondence: an instruction's site is the first statement among the entities it was
 * lowered from (`frame` when it has entities but no statement, `backend` when it has none).
 */
function measureSites(r: AttributedRevision, call: AttributedCall, backend: BackendOptionsInput): Measured {
  const st = storeOf(r.artifact.value);
  const { image, correspondence } = lowerToImage(r.artifact, backend);
  // image entity -> the typed.blocks entities it was lowered from, in the correspondence's order
  const from = new Map<string, string[]>();
  for (const e of correspondence.entries)
    for (const to of e.to) from.set(to, [...(from.get(to) ?? []), ...e.from]);
  const run = runImage(image, call.fn, call.args, call.memory);
  if (run.trap || run.limit || run.fault || !run.counts)
    throw new Error(`attribute: ${call.fn} did not finish at r${r.rev}`);
  const weights = new Map<string, number>();
  let total = 0;
  for (const m of image.value.insns) {
    const n = run.counts[m.offset >>> 2];
    if (!n) continue;
    const sources = from.get(m.id) ?? [];
    const site = sources.find(c => isStmt(st, c)) ?? (sources.length ? FRAME : BACKEND);
    weights.set(site, (weights.get(site) ?? 0) + n);
    total += n;
  }
  return { st, total, weights };
}

/** The statements one edit names: its site, and for a `replaceStmt` both statements it relates. */
const namedBy = (e: Edit): readonly string[] => [
  e.stmt as string,
  ...(e.kind === 'replaceStmt' ? [e.from as string, e.to as string] : []),
];

/**
 * Credit the difference in executed instructions along a revision chain to the decisions of its passes, for one
 * call that finishes on every revision. `revisions[0]` is the baseline (normally r0).
 */
export function attributeSteps(
  revisions: readonly AttributedRevision[],
  call: AttributedCall,
  options: { readonly backend?: BackendOptionsInput } = {},
): Attribution {
  if (!revisions.length) throw new Error('attribute: no revisions');
  const backend = options.backend ?? {};
  const measured = revisions.map(r => measureSites(r, call, backend));
  const links: ChainLink[] = revisions.slice(1).map((r, i) => {
    if (!r.correspondence)
      throw new Error(
        `attribute: r${r.rev} ${r.pass} recorded no correspondence, so nothing joins it to r${r.rev - 1}`,
      );
    return { label: r.pass, correspondence: r.correspondence, derivation: r.derivation };
  });
  const totals = revisions.map((r, i) => ({ rev: r.rev, pass: r.pass, instructions: measured[i].total }));
  // A statement an edit of a revision names takes part in that revision even when it executes nothing: its group
  // gets a row with a decision and no change of weight. An edit names statements of the revision it applied to and
  // of the one before it (a `replaceStmt` names both, a `remove` names the one it took away).
  const namedAt = measured.map(() => new Set<string>());
  revisions.forEach((r, j) => {
    for (const id of r.edits.flatMap(namedBy))
      for (const k of [j - 1, j]) if (k >= 0 && isStmt(measured[k].st, id)) namedAt[k].add(id);
  });
  const credits = recordChain(links).credit(i => measured[i].weights, { entities: j => [...namedAt[j]] });

  const text = (link: number, id: string) =>
    isStmt(measured[link + 1].st, id)
      ? showStmt(measured[link + 1].st, id)
      : isStmt(measured[link].st, id)
        ? showStmt(measured[link].st, id)
        : id;
  const rows: AttributionRow[] = [];
  credits.forEach(c => {
    const r = revisions[c.link + 1];
    const sites = [...new Set([...c.before, ...c.after])];
    // the decisions the group's statements carry, from the edit records of the application
    const kinds = new Set<string>(),
      notes = new Set<string>(c.notes),
      because = new Set<string>();
    // the steps the edits that name the group cite: a step that made a value inside the statement the weight is
    // attached to names a value, not the statement, so the edit record is what ties the two together
    const cited: DerivationStep[] = [];
    for (const e of r.edits) {
      if (!namedBy(e).some(id => sites.includes(id))) continue;
      kinds.add(e.kind);
      if (typeof e.note === 'string') notes.add(e.note);
      for (const b of (e.because as string[] | undefined) ?? []) because.add(b);
      for (const k of e.steps ?? []) if (r.derivation?.steps[k]) cited.push(r.derivation.steps[k]);
    }
    // a statement the pass made says why it exists in the steps that made it (IRWB-034-G's `because` column: the
    // facts of that statement, not those of every value under it, which its entry also aggregates)
    for (const id of c.after)
      if (isStmt(measured[c.link + 1].st, id) && !isStmt(measured[c.link].st, id))
        for (const s of r.derivation?.steps ?? [])
          if (s.produces.includes(id))
            for (const p of s.premises) if (!p.startsWith('guard:')) because.add(p);
    if (c.delta === 0 && !kinds.size) return;
    const what = kinds.size
      ? [...kinds].sort().join('+') + (notes.size ? ` (${[...notes].sort().join('; ')})` : '')
      : sites.includes(FRAME)
        ? 'indirect, frame'
        : 'indirect';
    rows.push({
      rev: r.rev,
      pass: r.pass,
      decision: `${r.pass}: ${what}`,
      because: [...because].sort(),
      delta: c.delta,
      before: c.beforeWeight,
      after: c.afterWeight,
      sites: sites.sort().map(id => ({ id, text: text(c.link, id) })),
      by: byOf(c.by, cited),
    });
  });
  rows.sort((a, b) => a.rev - b.rev || b.delta - a.delta || (a.sites[0].id < b.sites[0].id ? -1 : 1));
  const byDecision = new Map<string, { pass: string; delta: number; after: number; groups: number }>();
  for (const row of rows) {
    let d = byDecision.get(row.decision);
    if (!d) byDecision.set(row.decision, (d = { pass: row.pass, delta: 0, after: 0, groups: 0 }));
    d.delta += row.delta;
    d.after += row.after;
    d.groups++;
  }
  const decisions = [...byDecision]
    .map(([decision, d]) => ({ decision, ...d }))
    .sort((a, b) => b.delta - a.delta || (a.decision < b.decision ? -1 : 1));
  return { call: { fn: call.fn, args: [...call.args] }, totals, rows, decisions };
}

/** The totals per revision and the decisions table, as text. */
export function formatAttribution(a: Attribution): string {
  const first = a.totals[0],
    last = a.totals.at(-1)!;
  const lines = [
    `${a.call.fn}(${a.call.args.join(', ')}): r${first.rev} ${first.instructions} -> r${last.rev} ${last.instructions} instructions (${signed(last.instructions - first.instructions)})`,
    '',
    'revision       instructions   step',
    ...a.totals.map(
      (t, i) =>
        `${`r${t.rev} ${t.pass}`.padEnd(14)} ${String(t.instructions).padStart(12)}   ${i ? signed(t.instructions - a.totals[i - 1].instructions) : ''}`,
    ),
    '',
    '   delta    after  groups  decision',
    ...a.decisions.map(
      d =>
        `${signed(d.delta).padStart(8)} ${String(d.after).padStart(8)} ${String(d.groups).padStart(7)}  ${d.decision}`,
    ),
  ];
  return lines.join('\n');
}
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
