// IRWB-029-D: which statements of a Tix function can share a CUDA kernel without changing any result bit, decided
// from the Tix IR alone, before code generation (design-doc/01 in the ticket).
// IRWB-030-G: which of a block-mode kernel's reductions compute their terms in parallel (`planTerms`).
//
// A group is a contiguous run of statements whose first `depth` axes have equal extents (the block domain). A
// statement joins the current group when it reads a member, and every read of a member has, in each of the first
// `depth` positions, exactly the reader's own axis there. Each block-domain point then needs only its own slice of
// every member, so the group can compute its members in order, point by point:
//   - thread mode (every member has rank `depth`): one thread per point; a member is a register;
//   - block mode (some member has trailing axes): one block per point; a member's row lives in a row buffer, a
//     member with no trailing axes is computed by thread 0, and `__syncthreads()` separates the members.
// Every element is still computed by one thread with stage 2's scalar code, so its evaluation order is unchanged.
import { plain, visit, type Affine, type Expr, type Fn, type Statement, type Tensor } from './model.js';

type Reduce = Extract<Expr, { kind: 'reduce' }>;

export interface FusionGroup {
  kernel: string;
  /** Member statements, in source order. */
  statements: string[];
  /** Number of leading axes shared by the members (the block domain). */
  depth: number;
  mapping: 'thread' | 'block';
  /** Members written to global memory: the result, those read by a later kernel, and every singleton. */
  stored: string[];
  /** Block mode: members read by a later member, kept in a row buffer. */
  buffered: string[];
  /** Block mode: other tensors whose block-domain rows are copied to a row buffer before the members run. */
  staged: string[];
  /** Why the statements share this kernel, and what changed in the thread mapping. */
  reasons: string[];
  /**
   * Block mode: reductions whose terms the whole block computes in parallel, one term per thread, before one
   * thread folds the array in the meaning's order (IRWB-030-G). Empty in thread mode.
   */
  terms: FusionTerm[];
  /** Block mode: reductions left as a serial fold by one thread, with the reason each was refused. */
  serial: FusionSerial[];
}
export interface FusionTerm {
  /** Member whose expression holds the reduction. */
  member: string;
  /** The reduction, rendered by its extents: `sum(D)`, `max(C)`, `sum(C,D)`. */
  reduction: string;
  /** How many terms it has, as an affine expression of the shape symbols, e.g. `D`. */
  terms: string;
}
export interface FusionSerial {
  member: string;
  reduction: string;
  reason: string;
}
export interface FusionRefusal {
  statement: string;
  kernel: string;
  reason: string;
}
export interface FusionPlan {
  fn: string;
  groups: FusionGroup[];
  refusals: FusionRefusal[];
  /**
   * Groups this stage refused to fuse from their shape values, and why (IRWB-030-G). Empty when the caller gave
   * no shape values, because the rule cannot be decided then.
   */
  gate: FusionGate[];
}
export interface FusionGate {
  statements: string[];
  reason: string;
  /** The width the rule measured: the block's widest row or staged term array, in elements. */
  width: number;
}

type Load = Extract<Expr, { kind: 'load' }>;
const same = (a: Affine, b: Affine) => JSON.stringify(a) === JSON.stringify(b);
function loads(s: Statement): Load[] {
  const out: Load[] = [];
  visit(s.expr, e => {
    if (e.kind === 'load') out.push(e);
  });
  return out;
}
const text = (a: Affine) =>
  [
    ...a.terms.map(([n, k]) => (k === 1 ? n : `${k}*${n}`)),
    ...(a.constant || !a.terms.length ? [a.constant] : []),
  ].join(' + ');

/** The deepest block domain s can share with the group's members, or 0 with the reason it cannot join. */
function joinDepth(s: Statement, members: Statement[], depth: number): { depth: number; reason: string } {
  const names = new Set(members.map(m => m.name));
  const reads = loads(s).filter(e => names.has(e.name));
  if (!reads.length) return { depth: 0, reason: 'reads no tensor of the kernel (no horizontal fusion)' };
  let k = Math.min(depth, s.axes.length),
    reason = `it has ${s.axes.length} ${s.axes.length === 1 ? 'axis' : 'axes'}`;
  for (let p = 0; p < k; p++)
    if (!same(s.shape[p], members[0].shape[p])) {
      [k, reason] = [
        p,
        `its axis ${p} has extent ${text(s.shape[p])}, the kernel's ${text(members[0].shape[p])}`,
      ];
      break;
    }
  for (const r of reads)
    for (let p = 0; p < k; p++)
      if (plain(r.indices[p]) !== s.axes[p].id) {
        const at = text(r.indices[p]);
        [k, reason] = [p, `reads ${r.name} at index ${at} in position ${p}, not its own axis there`];
        break;
      }
  return { depth: k, reason };
}

export function planFusion(fn: Fn, sizes?: ShapeValues): FusionPlan {
  const runs: { members: Statement[]; depth: number; reasons: string[] }[] = [];
  const refusals: FusionRefusal[] = [];
  for (const s of fn.statements) {
    const current = runs.at(-1);
    if (current) {
      const join = joinDepth(s, current.members, current.depth);
      if (join.depth > 0) {
        if (join.depth < current.depth)
          current.reasons.push(
            `${s.name} narrows the block domain to ${join.depth} ${join.depth === 1 ? 'axis' : 'axes'}: ${join.reason}`,
          );
        current.members.push(s);
        current.depth = join.depth;
        continue;
      }
      refusals.push({ statement: s.name, kernel: 'k' + (runs.length - 1), reason: join.reason });
    }
    runs.push({ members: [s], depth: s.axes.length, reasons: [] });
  }
  const readers = new Map<string, number[]>();
  runs.forEach((run, g) =>
    run.members.forEach(s => loads(s).forEach(e => readers.set(e.name, [...(readers.get(e.name) ?? []), g]))),
  );
  const groups = runs.map(({ members, depth, reasons }, g): FusionGroup => {
    const names = new Set(members.map(m => m.name));
    const single = members.length === 1;
    const stored = members
      .filter(m => single || m.name === fn.result || (readers.get(m.name) ?? []).some(r => r > g))
      .map(m => m.name);
    const block = members.some(m => m.axes.length > depth);
    const buffered = block
      ? members.filter((m, i) => members.slice(i + 1).some(r => loads(r).some(e => e.name === m.name)))
      : [];
    const staged = new Set<string>();
    const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
    if (block)
      for (const m of members)
        for (const e of loads(m)) {
          const t = tensors.get(e.name)!;
          if (names.has(e.name) || t.shape.length <= depth) continue;
          const rows = members[0].shape.slice(0, depth);
          if (rows.every((d, p) => same(d, t.shape[p]) && plain(e.indices[p]) === m.axes[p].id))
            staged.add(e.name);
        }
    const axes = members[0].shape.slice(0, depth).map(text).join(', ');
    const terms = block ? members.flatMap(m => planTerms(m, depth).terms) : [];
    const serial = block ? members.flatMap(m => planTerms(m, depth).serial) : [];
    const why = single
      ? []
      : block
        ? [
            `one block per point of [${axes}] instead of one thread per element; the members run in order, ` +
              'separated by barriers, each element by one thread',
            ...members
              .filter(m => m.axes.length === depth)
              .map(m => `thread 0 computes ${m.name} (one element per row) in the meaning's order`),
            ...terms.map(
              t =>
                `the block computes the terms of ${t.reduction} in ${t.member} in parallel (${t.terms} terms), ` +
                "and thread 0 folds them in the meaning's order",
            ),
            ...(staged.size ? [`rows of ${[...staged].join(', ')} are staged in the row buffer`] : []),
          ]
        : [
            `one thread per element of [${axes}] computes ${members.map(m => m.name).join(', ')} in registers`,
          ];
    return {
      kernel: 'k' + g,
      statements: members.map(m => m.name),
      depth,
      mapping: block ? 'block' : 'thread',
      stored,
      buffered: buffered.map(m => m.name),
      staged: [...staged],
      reasons: [...why, ...reasons],
      terms,
      serial,
    };
  });
  const decision = applyGate(groups, fn, sizes);
  return { fn: fn.name, groups: decision.groups, refusals, gate: decision.gate };
}

/** Stage 2's plan: one thread-mode kernel per statement. */
export function unfusedPlan(fn: Fn): FusionPlan {
  return {
    fn: fn.name,
    groups: fn.statements.map((s, g) => ({
      kernel: 'k' + g,
      statements: [s.name],
      depth: s.axes.length,
      mapping: 'thread',
      stored: [s.name],
      buffered: [],
      staged: [],
      reasons: [],
      terms: [],
      serial: [],
    })),
    refusals: [],
    gate: [],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// IRWB-030-G: parallel terms.
//
// A rank-depth member of a block-mode group has one element per block point, so one thread (thread 0) computes its
// whole value, a reduction included: every term of `sum(j) x[i,j] / D` is evaluated by that one thread, while stage
// 2 gave each row its own thread across the grid. A term never reads the accumulator (Tix has no name for it), so
// any thread can compute any term: the block writes them into a term array, and one thread then adds them in the
// meaning's order. Each term is rounded exactly as before and the fold keeps its order, so the value is
// bit-identical.
//
// Refused, with the reason in `serial`:
//   - a reduction in a member that has axes beyond the block domain: its terms are per row element, so the array
//     would need one slot per (element, term) pair (1024 x 64 floats for the corpus attention), and each element's
//     fold would still have to run in its own order;
//   - a reduction with an axis whose extent split-sum generated (`blocks`/`tail`), because a term's position in the
//     fold is then not a product of known extents;
//   - a reduction whose body costs no more than the fold: the block computes such a term as fast as it can write and
//     read the array. Measured in the report: staging softmax's `s` (body = a load) loses.
//
// Cost of a body: a division or `exp`/`log`/`tanh`/`sqrt`, or a nested reduction, each of which takes several times
// a shared-memory round trip. Multiplications, additions and loads do not.
const costly = (e: Expr): number => {
  switch (e.kind) {
    case 'op':
      return (
        (e.op === '/' || e.op === 'exp' || e.op === 'log' || e.op === 'tanh' || e.op === 'sqrt' ? 1 : 0) +
        e.args.reduce((n, a) => n + costly(a), 0)
      );
    case 'reduce':
      return 1 + costly(e.body);
    default:
      return 0;
  }
};

/** The reductions of `e` that are evaluated once per block point: those not inside another reduction. */
function outerReductions(e: Expr, out: Reduce[] = []): Reduce[] {
  if (e.kind === 'reduce') out.push(e);
  else if (e.kind === 'op') e.args.forEach(a => outerReductions(a, out));
  return out;
}

const describe = (e: Reduce) => `${e.op}(${e.axes.map(a => text(a.extent.dim)).join(',')})`;

/** Why `reduction` in `member` stays a serial fold, or undefined when its terms are staged in parallel. */
function serialReason(member: Statement, depth: number, e: Reduce): string | undefined {
  const reduction = describe(e);
  if (member.axes.length > depth) {
    const beyond = member.axes.length - depth;
    return (
      `it has ${beyond} ${beyond === 1 ? 'axis' : 'axes'} beyond the block domain, so its ${reduction} runs once ` +
      'per row element: staging the terms would need one slot per element and term, and one fold per element'
    );
  }
  if (e.axes.some(a => a.extent.kind !== 'dim'))
    return "an extent generated by split-sum: a term's position in the fold is not a product of known extents";
  if (!costly(e.body))
    return (
      'its body has no division, transcendental or inner reduction, so the block computes a term of ' +
      `${reduction} no slower than it can write and read the term array`
    );
  return undefined;
}

/** Which reductions of `member` compute their terms in parallel, and which stay serial, with the reason. */
export function planTerms(member: Statement, depth: number) {
  const terms: FusionTerm[] = [],
    serial: FusionSerial[] = [];
  for (const e of outerReductions(member.expr)) {
    const reduction = describe(e);
    const reason = serialReason(member, depth, e);
    if (reason) serial.push({ member: member.name, reduction, reason });
    else terms.push({ member: member.name, reduction, terms: e.axes.map(a => text(a.extent.dim)).join(' * ') });
  }
  return { terms, serial };
}

/** A reduction whose terms the emitter stages, with the term array's name. */
export interface TermArray {
  member: Statement;
  reduction: Reduce;
  array: string;
}

/** The reductions the emitter stages, in the plan's order, matched to the statements. */
export function termArrays(group: FusionGroup, members: Statement[]): TermArray[] {
  const out: TermArray[] = [];
  if (group.mapping !== 'block') return out;
  for (const m of members)
    for (const e of outerReductions(m.expr))
      if (!serialReason(m, group.depth, e)) out.push({ member: m, reduction: e, array: 'a' + out.length });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// IRWB-030-G: the cost gate.
//
// Block mode replaces stage 2's one thread per element with one thread per element *of a row*, in a block of its
// own. That is a gain while a row fills a warp. Below a warp the block launches lanes that do nothing, and the GB10
// admits at most 24 blocks per SM, so a short row leaves the SM mostly idle: it can run at most 24 * width lanes of
// work where stage 2 fills 1,536 threads. Measured (report, fused against unfused, 2^21 elements):
//
//   row      4      8     16     32     64
//   fused   1.469  0.736 0.372  0.188  0.189   ms
//   stage 2 0.298  0.282 0.330  0.329  0.296   ms
//
// so the crossover lies between 16 and 32 elements, and 32 is the warp: the smallest value the measurements do not
// contradict, and the width at which the block's lanes start to pay for themselves.
//
// The width a block puts to work is the wider of its rows and its staged term arrays (a staged reduction's terms
// are spread over the whole block), so a group with a short row but a long staged reduction stays fused.
export const warp = 32;

/** Shape symbol values, e.g. `{ N: 4096, C: 1024 }`, as a launch knows them. */
export type ShapeValues = Readonly<Record<string, number>>;

/** The value of an affine extent, or undefined when a symbol it names has no value. */
function extentValue(a: Affine, sizes: ShapeValues): number | undefined {
  let n = a.constant;
  for (const [name, k] of a.terms) {
    const v = sizes[name];
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    n += k * v;
  }
  return n;
}

/** The product of some extents, or undefined when one of them is unknown. */
function extentProduct(shapes: readonly Affine[], sizes: ShapeValues): number | undefined {
  let n = 1;
  for (const a of shapes) {
    const v = extentValue(a, sizes);
    if (v === undefined) return undefined;
    n *= v;
  }
  return n;
}

/** The lanes a block-mode group puts to work: its widest row or staged term array. */
export function blockWidth(group: FusionGroup, tensors: ReadonlyMap<string, Tensor>, sizes: ShapeValues) {
  if (group.mapping !== 'block') return undefined;
  const members = group.statements.map(n => tensors.get(n) as Statement);
  const lengths = [
    ...[...group.staged, ...group.statements].map(n =>
      extentProduct(tensors.get(n)!.shape.slice(group.depth), sizes),
    ),
    ...termArrays(group, members).map(a => extentProduct(a.reduction.axes.map(x => x.extent.dim), sizes)),
  ];
  if (lengths.some(n => n === undefined)) return undefined;
  return Math.max(1, ...(lengths as number[]));
}

/** One statement as stage 2 lowers it: its own thread-mode kernel, with the reason it is not in a fused group. */
function singleton(s: Statement, reason: string): FusionGroup {
  return {
    kernel: '',
    statements: [s.name],
    depth: s.axes.length,
    mapping: 'thread',
    stored: [s.name],
    buffered: [],
    staged: [],
    reasons: [reason],
    terms: [],
    serial: [],
  };
}

/** Keeps a block-mode group whole only when its block fills a warp; otherwise stage 2's kernels for its statements. */
function applyGate(groups: FusionGroup[], fn: Fn, sizes?: ShapeValues) {
  const gate: FusionGate[] = [];
  if (!sizes) return { groups, gate };
  const tensors = new Map([...fn.params, ...fn.statements].map(t => [t.name, t]));
  const out: FusionGroup[] = [];
  for (const g of groups) {
    const width = blockWidth(g, tensors, sizes);
    if (width === undefined || width >= warp) {
      out.push(g);
      continue;
    }
    const reason =
      `the block domain's widest row is ${width} ${width === 1 ? 'element' : 'elements'}, under the ${warp}-lane ` +
      'warp every block launches, and the device admits at most 24 blocks per SM: stage 2 fills up to 1,536 threads ' +
      'instead';
    gate.push({ statements: g.statements, reason, width });
    for (const name of g.statements) out.push(singleton(tensors.get(name) as Statement, reason));
  }
  return { groups: out.map((g, i) => ({ ...g, kernel: 'k' + i })), gate };
}
