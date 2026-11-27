/**
 * Instruction attribution (IRWB-034-D): which pass decisions hold the executed RV32 instructions, and which
 * decisions cost the difference against r0.
 *
 * Every executed instruction maps back to the compiler's own records twice over:
 *   - `rv32.image`'s `covers` names the the `typed.blocks` statement (and value) it implements, and every entity
 *     records its `origin`: the entity it was made from, the pass (`via`), the revision and a `note` — so an
 *     instruction can be credited to the decision that placed its statement;
 *   - each published revision carries an `EntityCorrespondence` to the revision before it, so a statement of the
 *     final revision can be traced back through every pass to the r0 statements it descends from.
 *
 * `attributeRun` credits a run's per-instruction counts to `(statement, pass, r0 roots)` and checks that the
 * credits add up to the run's executed instructions; `deltaBetween` compares two attributions (r0 and the head)
 * per r0 root, which is the table of "which decision costs the extra instructions".
 *
 * This is a measurement, not a cost model: nothing here predicts what a pass will cost, it reports what the
 * emulator counted and which records produced it.
 */
import type { Artifact } from '../framework/core/types.js';
import type { EntityCorrespondence } from '../framework/ir/types.js';
import type { Rv32Image } from './backend/image.js';
import { storeOf } from './ir.js';
import type { TypedBlocks } from './model.js';
import { statementOf as owningStatement } from './tx.js';

/** One revision of a chain, as attribution needs it: the artifact and how it relates to the one before. */
export interface AttributionStep {
  readonly rev: number;
  readonly pass: string;
  readonly artifact: Artifact<TypedBlocks>;
  readonly correspondence?: EntityCorrespondence;
  /** The pass's edit records, where a retained statement's later change is recorded (`retarget`, `move`, …). */
  readonly edits?: readonly AttributionEdit[];
}

/** The part of a typed pass's `Edit` record attribution reads: which statement it names, and why. */
export interface AttributionEdit {
  readonly pass: string;
  readonly kind: string;
  readonly stmt?: string;
  readonly note?: string;
}

/** The minimum a host (a `Program`, a strategy run) has to offer: its revision timeline. */
export interface ChainHost {
  readonly revisions: readonly {
    readonly rev: number;
    readonly pass: string;
    readonly artifact: Artifact<TypedBlocks>;
    readonly correspondence?: EntityCorrespondence;
    readonly edits?: readonly AttributionEdit[];
  }[];
}

/** The steps of a host's revision timeline, r0 first. */
export function chainOf(host: ChainHost): AttributionStep[] {
  return host.revisions.map(r => ({
    rev: r.rev,
    pass: r.pass,
    artifact: r.artifact,
    ...(r.correspondence ? { correspondence: r.correspondence } : {}),
    ...(r.edits ? { edits: r.edits } : {}),
  }));
}

export interface Lineage {
  readonly steps: readonly AttributionStep[];
  /** The r0 entities `entity` of step `at` descends from (empty when a pass made it from nothing). */
  rootsOf(at: number, entity: string): readonly string[];
  /** The same, as r0 statements: a value is reported as the statement that computes it. */
  statementsOf(at: number, entity: string): readonly string[];
  /**
   * The pass whose edit record last named a statement, up to step `at`: for a statement the front end made, this
   * is the pass that changed it after all (`cfg` retargeting a branch, `subst` replacing an operand).
   */
  touchedBy(at: number, statement: string): { pass: string; kind: string; note?: string } | undefined;
  /** Every statement of r0, in id order: the roots a difference against r0 can name. */
  readonly statements: readonly string[];
  /** Entities whose correspondence was missing (0 for a chain the framework published; the test asserts it). */
  readonly gaps: number;
}

/**
 * Compose the chain's correspondences into a backward map per step, so any final entity can be traced to r0.
 * An entry maps one before-entity to the entities it became (a split), or several before-entities to one (a
 * merge); an entry with no `from` is an addition, and one with no `to` a removal.
 */
export function lineageOf(steps: readonly AttributionStep[]): Lineage {
  const back: Map<string, readonly string[]>[] = steps.map(() => new Map());
  let gaps = 0;
  for (let i = 1; i < steps.length; i++) {
    const corr = steps[i].correspondence;
    if (!corr) {
      gaps++;
      continue;
    }
    for (const e of corr.entries) for (const to of e.to) back[i].set(to, e.from);
  }
  // per step: which pass last named each statement in an edit record (a retained statement's later change)
  const touched: Map<string, { pass: string; kind: string; note?: string }>[] = steps.map(() => new Map());
  for (let i = 1; i < steps.length; i++) {
    touched[i] = new Map(touched[i - 1]);
    for (const e of steps[i].edits ?? [])
      if (e.stmt) touched[i].set(e.stmt, { pass: e.pass, kind: e.kind, ...(e.note ? { note: e.note } : {}) });
  }
  const touchedBy = (at: number, statement: string) => touched[at]?.get(statement);
  const rootStore = steps.length ? storeOf(steps[0].artifact.value) : undefined;
  const rootStatements = [...(rootStore?.fns.values() ?? [])].flatMap(f =>
    f.blocks.flatMap(b => b.stmts.filter(sid => rootStore!.get(sid)?.kind === 'stmt')),
  );
  const cache = new Map<string, readonly string[]>();
  const asStatement = (id: string): string => {
    const rec = rootStore?.get(id);
    if (!rec || rec.kind !== 'value') return id;
    return owningStatement(rootStore!, id) ?? id;
  };
  const stmtCache = new Map<string, readonly string[]>();
  const statementsOf = (at: number, entity: string): readonly string[] => {
    const key = `${at}:${entity}`;
    const hit = stmtCache.get(key);
    if (hit) return hit;
    const out = [...new Set(rootsOf(at, entity).map(asStatement))];
    stmtCache.set(key, out);
    return out;
  };
  const rootsOf = (at: number, entity: string): readonly string[] => {
    const key = `${at}:${entity}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let cur = [entity];
    for (let i = at; i >= 1; i--) {
      const next: string[] = [];
      for (const id of cur) {
        const froms = back[i].get(id);
        if (froms === undefined) {
          // a retained entity the correspondence did not list: it is its own ancestor
          gaps++;
          next.push(id);
        } else next.push(...froms);
      }
      cur = [...new Set(next)];
    }
    cache.set(key, cur);
    return cur;
  };
  return {
    steps,
    rootsOf,
    statementsOf,
    touchedBy,
    statements: rootStatements,
    get gaps() {
      return gaps;
    },
  };
}

/** A run of an image lowered from one step: `counts` indexes the image's words, as `runImage` returns them. */
export interface AttributionRun {
  readonly image: Rv32Image | Artifact<Rv32Image>;
  readonly counts: Uint32Array | null;
}

/** The pass name the front end's entities carry; a pass that is not the front end is credited by its own name. */
export const SOURCE = 'source';

export interface Credit {
  /** The statement the instruction implements (`s:NAME.n`), or a function bucket (`fn:NAME`). */
  readonly statement: string;
  readonly fn: string;
  /** The pass that made this statement (`source` for the front end's own statements). */
  readonly pass: string;
  /** The decision's note, when the pass recorded one (`hoisted out of loop:…`). */
  readonly note?: string;
  /**
   * For a statement the front end made: the pass whose edit record last changed it (`cfg` retargeting a branch,
   * `subst` replacing an operand). This is the pass that changed the statement's cost.
   */
  readonly touchedBy?: string;
  /** The r0 statements this statement descends from; empty when a pass made it from nothing. */
  readonly roots: readonly string[];
  readonly insns: number;
}

export interface Attribution {
  readonly at: number;
  /** Executed instructions credited to a statement or function bucket plus `unattributed`; the run's steps. */
  readonly total: number;
  readonly credits: readonly Credit[];
  readonly byPass: readonly { readonly pass: string; readonly insns: number }[];
  /** Instructions whose image record covers nothing this artifact holds (should be 0 on the VM's images). */
  readonly unattributed: number;
  /**
   * r0 statements with no instruction at this step, and the pass whose edit record last named them: the pass that
   * removed them. `deltaBetween` uses it so a removed statement's instructions are credited to its removal.
   */
  readonly gone: ReadonlyMap<string, string>;
}

const imageValue = (img: Rv32Image | Artifact<Rv32Image>): Rv32Image =>
  'formatVersion' in img ? img : (img as Artifact<Rv32Image>).value;

/** The statement a credit is keyed by: the first statement cover, else the function (prologue, frame, epilogue). */
export function statementOf(covers: readonly string[]): string | undefined {
  return covers.find(c => c.startsWith('s:')) ?? covers[0];
}

/** The pass that placed a statement, from its origin record: `source` for the front end's own. */
function producerOf(origin: readonly { via?: string; note?: string }[] | undefined): {
  pass: string;
  note?: string;
} {
  const o = origin?.[0];
  const via = o?.via;
  const pass = !via || via === 'ingest' ? SOURCE : via;
  return { pass, ...(o?.note ? { note: o.note } : {}) };
}

/**
 * Credit every executed instruction of `run` (an image lowered from step `at`) to the statement it implements, the
 * pass that placed that statement and the r0 statements it descends from.
 */
export function attributeRun(lineage: Lineage, at: number, run: AttributionRun): Attribution {
  const step = lineage.steps[at];
  if (!step) throw new Error(`attribution: no revision at ${at}`);
  const st = storeOf(step.artifact.value);
  const img = imageValue(run.image);
  const byStatement = new Map<string, Credit>();
  let unattributed = 0;
  for (const e of img.insns) {
    const n = run.counts ? (run.counts[e.offset >>> 2] ?? 0) : 0;
    if (!n) continue;
    const key = statementOf(e.covers);
    if (!key) {
      unattributed += n;
      continue;
    }
    const seen = byStatement.get(key);
    if (seen) {
      byStatement.set(key, { ...seen, insns: seen.insns + n });
      continue;
    }
    const rec = st.get(key) as { origin?: readonly { via?: string; note?: string }[] } | undefined;
    if (!rec) {
      // the image covers an entity this revision does not hold: report it, do not guess
      unattributed += n;
      continue;
    }
    const { pass, note } = producerOf(rec.origin);
    const touch = pass === SOURCE ? lineage.touchedBy(at, key) : undefined;
    byStatement.set(key, {
      statement: key,
      fn: e.fn,
      pass,
      ...(note ? { note } : {}),
      ...(touch ? { touchedBy: touch.pass } : {}),
      roots: lineage.statementsOf(at, key),
      insns: n,
    });
  }
  const credits = [...byStatement.values()].sort(
    (a, b) => b.insns - a.insns || a.statement.localeCompare(b.statement),
  );
  const perPass = new Map<string, number>();
  for (const c of credits) perPass.set(c.pass, (perPass.get(c.pass) ?? 0) + c.insns);
  const byPass = [...perPass]
    .map(([pass, insns]) => ({ pass, insns }))
    .sort((a, b) => b.insns - a.insns || a.pass.localeCompare(b.pass));
  const total = credits.reduce((n, c) => n + c.insns, 0) + unattributed;
  const present = new Set(credits.flatMap(c => c.roots));
  const gone = new Map<string, string>();
  for (const sid of lineage.statements) {
    if (present.has(sid)) continue;
    const touch = lineage.touchedBy(at, sid);
    if (touch) gone.set(sid, touch.pass);
  }
  return { at, total, credits, byPass, unattributed, gone };
}

/** One r0 root's instructions before and after, and the pass whose decisions changed them. */
export interface Delta {
  /** The r0 statement (or `fn:NAME` bucket) the executions belong to; `(new)` for what a pass made from nothing. */
  readonly root: string;
  readonly pass: string;
  readonly base: number;
  readonly next: number;
  readonly delta: number;
}

/** Instructions credited to each root of an attribution; a credit with several roots is split evenly. */
function byRoot(a: Attribution): Map<string, { insns: number; passes: Set<string> }> {
  const out = new Map<string, { insns: number; passes: Set<string> }>();
  const add = (root: string, insns: number, pass: string) => {
    const row = out.get(root) ?? { insns: 0, passes: new Set<string>() };
    row.insns += insns;
    row.passes.add(pass);
    out.set(root, row);
  };
  for (const c of a.credits) {
    const roots = c.roots.length ? c.roots : ['(new)'];
    const each = Math.floor(c.insns / roots.length);
    const extra = c.insns - each * roots.length;
    const by = c.touchedBy ?? c.pass;
    roots.forEach((r, i) => add(r, each + (i < extra ? 1 : 0), by));
  }
  if (a.unattributed) add('(unattributed)', a.unattributed, 'none');
  return out;
}

/**
 * Compare an attribution of the head with one of r0: per root, the instructions at each end and the difference,
 * credited to the pass that changed that root. The deltas sum to `next.total − base.total`, which the test
 * asserts, so the table accounts for every instruction the samples execute.
 */
export function deltaBetween(base: Attribution, next: Attribution): Delta[] {
  const b = byRoot(base),
    n = byRoot(next);
  const roots = [...new Set([...b.keys(), ...n.keys()])];
  const rows = roots.map(root => {
    const before = b.get(root),
      after = n.get(root);
    // the pass that changed this root: everything but the front end that touched it, at either end; a statement
    // that is gone is credited to the pass whose record removed it
    const changed = [
      ...new Set([...(after?.passes ?? []), ...(before?.passes ?? []), next.gone.get(root) ?? '']),
    ].filter(p => p && p !== SOURCE);
    return {
      root,
      pass: changed.length ? changed.sort().join('+') : SOURCE,
      base: before?.insns ?? 0,
      next: after?.insns ?? 0,
      delta: (after?.insns ?? 0) - (before?.insns ?? 0),
    };
  });
  return rows
    .filter(r => r.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.root.localeCompare(y.root));
}

/** The deltas rolled up per pass: the answer to "which decision costs the extra instructions". */
export function deltaByPass(deltas: readonly Delta[]): { pass: string; delta: number; rows: number }[] {
  const per = new Map<string, { pass: string; delta: number; rows: number }>();
  for (const d of deltas) {
    const row = per.get(d.pass) ?? { pass: d.pass, delta: 0, rows: 0 };
    row.delta += d.delta;
    row.rows++;
    per.set(d.pass, row);
  }
  return [...per.values()].sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.pass.localeCompare(b.pass),
  );
}
