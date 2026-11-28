/**
 * Attribution of executed instructions to pass decisions (IRWB-034-G).
 *
 * For one concrete call and a chain of revisions, each pass step is measured on the emulator: the revision before
 * the pass and the one after are both lowered and run, and the per-instruction counts are summed per site. A site
 * is the statement an instruction covers, `frame` for an instruction that covers only its function (frame, saved
 * registers, ret), or `backend` for one that covers nothing.
 *
 * IRWB-065-A: the attribution itself is a query over the records the passes write (`creditLink`,
 * `src/framework/ir/attribution.ts`), not a second account computed from the IR trees. The counts reach statements
 * through the lowering correspondence — the `covered-by` entries of `typed.lower-rv32`, the chain's last link —
 * and the sites of the two revisions are joined and named through the pass's own recorded correspondence (the
 * runner computes it from the pass's derivation): an entry that produced a new statement names the group it joins,
 * and its note and reasons are the derivation's words for what the pass did. What the edit records still supply is
 * the decision label's shape — their kinds and notes — because that is the format the report prints.
 *
 * A group that changed without a record naming it is the pass's indirect effect: the same statement, compiled
 * differently. The rows of a step sum to the emulator's difference for that step, and the steps to the difference
 * between the first revision and the last, so every instruction of the difference is credited exactly once and
 * none is estimated.
 */
import type { Artifact } from '../framework/core/types.js';
import { creditLink, type NamingRecord } from '../framework/ir/attribution.js';
import type { Derivation } from '../framework/ir/derivation.js';
import type { EntityCorrespondence } from '../framework/ir/types.js';
import { lowerToImage, runImage, type BackendOptionsInput } from './backend/index.js';
import { storeOf } from './ir.js';
import { showStmt } from './listing.js';
import type { Store, TypedBlocks } from './model.js';
import type { Edit } from './tx.js';

/** What `attributeSteps` needs of a revision (`Program.revisions` has it). */
export interface AttributedRevision {
  readonly rev: number;
  readonly pass: string;
  readonly artifact: Artifact<TypedBlocks>;
  readonly edits: readonly Edit[];
  /** The correspondence the pass's application recorded (`Revision.correspondence`). */
  readonly correspondence: EntityCorrespondence;
  /** The pass's own record of why (`Revision.derivation`); present for every pass but `inline`. */
  readonly derivation?: Derivation;
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

interface Measured {
  readonly st: Store;
  /** The revision's statements: the sites an instruction can be credited to. */
  readonly sites: ReadonlySet<string>;
  readonly total: number;
  readonly bySite: Map<string, number>;
}

const isStmt = (st: Store, id: unknown): id is string =>
  typeof id === 'string' && st.has(id) && (st.get(id) as { kind?: string }).kind === 'stmt';

/** Measure one revision: lower it, run the call, and push the executed counts onto statements through the lowering. */
function measureSites(r: AttributedRevision, call: AttributedCall, backend: BackendOptionsInput): Measured {
  const st = storeOf(r.artifact.value);
  const { image, correspondence } = lowerToImage(r.artifact, backend);
  const run = runImage(image, call.fn, call.args, call.memory);
  if (run.trap || run.limit || run.fault || !run.counts)
    throw new Error(`attribute: ${call.fn} did not finish at r${r.rev}`);
  // the chain's last link: which typed.blocks entities each instruction implements
  const coveredBy = new Map<string, string[]>();
  for (const entry of correspondence.entries)
    if (entry.relation === 'covered-by')
      for (const insn of entry.to) coveredBy.set(insn, [...(coveredBy.get(insn) ?? []), ...entry.from]);
  const bySite = new Map<string, number>();
  let total = 0;
  for (const m of image.value.insns) {
    const n = run.counts[m.offset >>> 2];
    if (!n) continue;
    const sources = coveredBy.get(m.id) ?? [];
    // an instruction implements at most one statement (`select.ts` builds `[value, stmt]`)
    const site = sources.find(c => isStmt(st, c)) ?? (sources.length ? FRAME : BACKEND);
    bySite.set(site, (bySite.get(site) ?? 0) + n);
    total += n;
  }
  return { st, sites: new Set(Object.keys(r.artifact.value.stmts)), total, bySite };
}

/** One pass step: the query joins the two revisions' sites through the pass's correspondence and names the groups. */
function stepRows(A: Measured, B: Measured, r: AttributedRevision): AttributionRow[] {
  if (!r.correspondence) throw new Error(`attribute: r${r.rev} (${r.pass}) recorded no correspondence`);
  const names: NamingRecord[] = r.edits.map(e => {
    const named = [e.stmt, ...(e.kind === 'replaceStmt' ? [e.from, e.to] : [])].filter(
      (x): x is string => typeof x === 'string',
    );
    return {
      key: e.kind,
      ...(typeof e.note === 'string' ? { note: e.note } : {}),
      because: (e.because as string[] | undefined) ?? [],
      entities: named,
    };
  });
  const groups = creditLink(
    { correspondence: r.correspondence, derivation: r.derivation, names },
    { sites: A.sites, weights: A.bySite },
    { sites: B.sites, weights: B.bySite },
  );
  const text = (id: string) =>
    isStmt(B.st, id) ? showStmt(B.st, id) : isStmt(A.st, id) ? showStmt(A.st, id) : id;
  const rows: AttributionRow[] = [];
  for (const g of groups) {
    if (g.after === g.before && !g.keys.length) continue;
    const what = g.keys.length
      ? g.keys.join('+') + (g.notes.length ? ` (${g.notes.join('; ')})` : '')
      : g.key === FRAME
        ? 'indirect, frame'
        : 'indirect';
    rows.push({
      rev: r.rev,
      pass: r.pass,
      decision: `${r.pass}: ${what}`,
      because: [...g.because],
      delta: g.after - g.before,
      before: g.before,
      after: g.after,
      sites: g.sites.map(id => ({ id, text: text(id) })),
    });
  }
  return rows.sort((a, b) => b.delta - a.delta || (a.sites[0].id < b.sites[0].id ? -1 : 1));
}

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
  const rows: AttributionRow[] = [];
  let prev = measureSites(revisions[0], call, backend);
  const totals = [{ rev: revisions[0].rev, pass: revisions[0].pass, instructions: prev.total }];
  for (const r of revisions.slice(1)) {
    const cur = measureSites(r, call, backend);
    rows.push(...stepRows(prev, cur, r));
    totals.push({ rev: r.rev, pass: r.pass, instructions: cur.total });
    prev = cur;
  }
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
