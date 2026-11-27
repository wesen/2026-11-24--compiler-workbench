/**
 * Attribution of executed instructions to pass decisions (IRWB-034-G).
 *
 * For one concrete call and a chain of revisions, each pass step is measured on the emulator: the revision before
 * the pass and the one after are both lowered and run, and the per-instruction counts are summed per site. A site
 * is the statement an instruction covers, `frame` for an instruction that covers only its function (frame, saved
 * registers, ret), or `backend` for one that covers nothing. Sites of the two revisions are joined into groups (the
 * same statement id; a new statement with the statement it replaced), and each group's difference is credited to
 * the decision the pass's edit records give for its statements: the edit kinds, their note and their `because`. A
 * group that changed without an edit is the pass's indirect effect: the same statement, compiled differently.
 *
 * The rows of a step sum to the emulator's difference for that step, and the steps to the difference between the
 * first revision and the last, so every instruction of the difference is credited exactly once and none is
 * estimated.
 */
import type { Artifact } from '../framework/core/types.js';
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
  readonly total: number;
  readonly bySite: Map<string, number>;
  /** The executed machine instructions of each site, with their counts, in address order. */
  readonly insns: Map<string, { readonly text: string; readonly count: number }[]>;
}

function measureSites(r: AttributedRevision, call: AttributedCall, backend: BackendOptionsInput): Measured {
  const st = storeOf(r.artifact.value);
  const { image } = lowerToImage(r.artifact, backend);
  const run = runImage(image, call.fn, call.args, call.memory);
  if (run.trap || run.limit || run.fault || !run.counts)
    throw new Error(`attribute: ${call.fn} did not finish at r${r.rev}`);
  const bySite = new Map<string, number>();
  const insns = new Map<string, { text: string; count: number }[]>();
  let total = 0;
  for (const m of image.value.insns) {
    const n = run.counts[m.offset >>> 2];
    if (!n) continue;
    const stmt = m.covers.find(c => st.has(c) && (st.get(c) as { kind?: string }).kind === 'stmt');
    const site = stmt ?? (m.covers.length ? FRAME : BACKEND);
    bySite.set(site, (bySite.get(site) ?? 0) + n);
    let list = insns.get(site);
    if (!list) insns.set(site, (list = []));
    list.push({ text: m.text, count: n });
    total += n;
  }
  return { st, total, bySite, insns };
}

const isStmt = (st: Store, id: unknown): id is string =>
  typeof id === 'string' && st.has(id) && (st.get(id) as { kind?: string }).kind === 'stmt';

function stepRows(A: Measured, B: Measured, r: AttributedRevision): AttributionRow[] {
  // a statement of B that A does not have joins the statement it was made from, when A has that one
  const groupOf = (id: string): string => {
    if (id === FRAME || id === BACKEND || isStmt(A.st, id)) return id;
    if (!isStmt(B.st, id)) return id;
    const from = (B.st.get(id) as StmtRec).origin[0]?.from;
    return isStmt(A.st, from) ? from : id;
  };
  interface Group {
    before: number;
    after: number;
    sites: Set<string>;
    kinds: Set<string>;
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
          kinds: new Set(),
          notes: new Set(),
          because: new Set(),
        }),
      );
    g.sites.add(id);
    return g;
  };
  for (const [site, n] of A.bySite) group(site).before += n;
  for (const [site, n] of B.bySite) group(site).after += n;
  for (const e of r.edits) {
    const named = [e.stmt, ...(e.kind === 'replaceStmt' ? [e.from, e.to] : [])].filter(
      (x): x is string => isStmt(A.st, x) || isStmt(B.st, x),
    );
    for (const id of named) {
      const g = group(id);
      g.kinds.add(e.kind);
      if (typeof e.note === 'string') g.notes.add(e.note);
      for (const b of (e.because as string[] | undefined) ?? []) g.because.add(b);
      // a statement the pass made says why in its origin
      if (isStmt(B.st, id) && !isStmt(A.st, id)) {
        const o = (B.st.get(id) as StmtRec).origin[0];
        if (o?.note) g.notes.add(o.note);
        for (const b of o?.because ?? []) g.because.add(b);
      }
    }
  }
  const text = (id: string) =>
    isStmt(B.st, id) ? showStmt(B.st, id) : isStmt(A.st, id) ? showStmt(A.st, id) : id;
  const rows: AttributionRow[] = [];
  for (const [key, g] of groups) {
    if (g.after === g.before && !g.kinds.size) continue;
    const what = g.kinds.size
      ? [...g.kinds].sort().join('+') + (g.notes.size ? ` (${[...g.notes].sort().join('; ')})` : '')
      : key === FRAME
        ? 'indirect, frame'
        : 'indirect';
    rows.push({
      rev: r.rev,
      pass: r.pass,
      decision: `${r.pass}: ${what}`,
      because: [...g.because].sort(),
      delta: g.after - g.before,
      before: g.before,
      after: g.after,
      sites: [...g.sites].sort().map(id => ({ id, text: text(id) })),
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

/** One statement of the last revision, by executed instructions, with what the chain did to it (IRWB-037-F). */
export interface HotSite {
  /** The statement id at the last revision (or `frame`, `backend`). */
  readonly id: string;
  readonly text: string;
  /** Executed instructions credited to it at the last revision. */
  readonly count: number;
  /** Its ancestor at the first revision (through statement origins), and that statement's count there. */
  readonly ancestor?: string;
  readonly first?: number;
  /** The decisions of the chain that name it or an ancestor: `r<rev> <pass>: <edit kinds> (<note>)`. */
  readonly decisions: readonly string[];
  /** Its executed machine instructions with their counts. */
  readonly insns: readonly { readonly text: string; readonly count: number }[];
}

/**
 * The hot statements of the last revision of a chain, with their provenance: the machine instructions they
 * execute, the statement they descend from at the first revision and its count there, and every edit of the chain
 * that names them or an ancestor. A hot statement whose decisions are empty, or whose count did not fall, is code no
 * pass improved: the starting point for a missed optimization (IRWB-037-F). The counts sum to the emulator's total
 * of the last revision.
 */
export function hotSites(
  revisions: readonly AttributedRevision[],
  call: AttributedCall,
  options: { readonly backend?: BackendOptionsInput } = {},
): { readonly total: number; readonly sites: readonly HotSite[] } {
  if (!revisions.length) throw new Error('attribute: no revisions');
  const backend = options.backend ?? {};
  const first = measureSites(revisions[0], call, backend);
  const last = measureSites(revisions.at(-1)!, call, backend);
  const stores = revisions.map(r => storeOf(r.artifact.value));
  const sites: HotSite[] = [];
  for (const [id, count] of last.bySite) {
    const decisions: string[] = [];
    let cur: string | undefined = id;
    if (id !== FRAME && id !== BACKEND)
      for (let i = revisions.length - 1; i >= 1 && cur; i--) {
        const r = revisions[i],
          here: string = cur;
        for (const e of r.edits)
          if ([e.stmt, e.from, e.to].includes(here))
            decisions.push(
              `r${r.rev} ${r.pass}: ${e.kind}${typeof e.note === 'string' ? ` (${e.note})` : ''}`,
            );
        if (!isStmt(stores[i - 1], here)) {
          const from = (stores[i].get(here) as StmtRec).origin[0]?.from;
          cur = isStmt(stores[i - 1], from) ? from : undefined;
        }
      }
    const ancestor = id === FRAME || id === BACKEND ? id : cur;
    sites.push({
      id,
      text: isStmt(last.st, id) ? showStmt(last.st, id) : id,
      count,
      ...(ancestor ? { ancestor, first: first.bySite.get(ancestor) ?? 0 } : {}),
      decisions: [...new Set(decisions)].reverse(),
      insns: last.insns.get(id) ?? [],
    });
  }
  sites.sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
  return { total: last.total, sites };
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
