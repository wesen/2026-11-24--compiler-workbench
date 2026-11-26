/**
 * IRWB-005 D2b: a stronger, opt-in case generator and the meaning contract's version 2.
 *
 * The default generator (`casesFrom`, evaluate.ts) is frozen: the corpus's book numbers depend on its exact cases.
 * This module appends cases to it instead of changing it. For each parameter it builds a pool of telling values
 * from three sources, clipped to the parameter's input specification:
 *   - the boundaries of the specification: lo, lo + 1, hi - 1, hi of a range; the extreme lengths of a buffer;
 *     cells all at the low or the high end, ramps, alternation;
 *   - the special values of the type: 0, ±1, ±2, the i32 extremes and their neighbours, powers of two and their
 *     neighbours; for f32 the edge sweep F32_EDGES and further patterns (negative and signalling NaN, the largest
 *     subnormal, the neighbours of 1, 2^23, halfway values);
 *   - the program's own constants: every i32 constant c in the function at r0 contributes c - 1, c, c + 1.
 * Boundary case j gives parameter i the value pool_i[(j + 3i) mod |pool_i|], so with `extra` >= |pool_i| every value
 * of every pool occurs at least once. `strongCasesFrom` returns the default cases first, unchanged, then the
 * `extra` boundary cases; a check with it therefore kills every mutant the default check with the same `count` kills.
 *
 * Optionally (`coverage: true`) the `extra` cases are chosen instead from a larger pool (boundary and random) by
 * greedy statement coverage of the origin: a candidate is kept if it executes a statement no earlier case did.
 *
 * `meaningKeptStrong` is `typed.meaning-kept` version `2+<hash>` with these cases and the default verdict rules
 * (evaluate.ts `agrees`, a step limit on either side is inconclusive); `strongOptimizationContract` wraps it as
 * `typed.optimization` of the same version. Nothing calls them by default.
 */
import { defineTransformation } from '../framework/contracts/definitions.js';
import { differential, type DifferentialInvariant } from '../framework/contracts/differential.js';
import type { TransformationDefinition } from '../framework/contracts/types.js';
import type { Artifact } from '../framework/core/types.js';
import {
  agrees,
  casesFrom,
  evaluate,
  F32_EDGES,
  hash,
  Memory,
  outcome,
  rng,
  type Case,
  type FunctionInputs,
  type MeaningParams,
  type RunResult,
} from './evaluate.js';
import { toBits } from './f32.js';
import { BlocksIR, storeOf } from './ir.js';
import type { StmtRec, Store, TypedBlocks, ValueRec, WorkFn } from './model.js';

const MIN = -2147483648,
  MAX = 2147483647;
/** f32 bit patterns beyond F32_EDGES. */
export const F32_EXTRA: readonly number[] = [
  0xffc00000 | 0, // a negative quiet NaN
  0x7fa00000, // a signalling NaN
  0x007fffff, // the largest subnormal
  0x3f7fffff, // the largest f32 below 1
  0x3f800001, // the smallest f32 above 1
  0xff7fffff | 0, // the most negative finite value
  0x4b000000, // 2^23: from here on every f32 is an integer
  0x3effffff, // the largest f32 below 0.5
  0x3fc00000, // 1.5
  0x40200000, // 2.5
  0xbf000000 | 0, // -0.5
  0xcf000000 | 0, // -2^31
  0x4f800000, // 2^32
];

/** Every i32 constant in a function's value trees, in a fixed order. */
export function constantsOf(st: Store, f: WorkFn): number[] {
  const out = new Set<number>();
  const walk = (id: string | undefined) => {
    if (!id) return;
    const v = st.get(id) as ValueRec;
    if (v.op === 'const' && !v.type) out.add(v.imm as number);
    v.args.forEach(walk);
  };
  for (const b of f.blocks)
    for (const sid of b.stmts) {
      const s = st.get(sid) as StmtRec;
      walk(s.value);
      walk(s.cond);
      walk(s.addr);
    }
  return [...out];
}

const uniq = (xs: readonly number[]) => [...new Set(xs.map(x => x | 0))];
const near = (cs: readonly number[]) => cs.flatMap(c => [c - 1, c, c + 1]);
const POWERS = Array.from({ length: 30 }, (_, k) => 2 ** (k + 1));
const I32_SPECIAL = [0, 1, -1, 2, -2, MAX, MIN, MAX - 1, MIN + 1, 127, 128, -128, 255, 256, 65535, 65536];

function i32Pool(lo: number, hi: number, consts: readonly number[]): number[] {
  const inside = (x: number) => x >= lo && x <= hi;
  const ends = [lo, hi, lo + 1, hi - 1];
  const special = [...I32_SPECIAL, ...POWERS.flatMap(p => [p, p - 1, -p])];
  return uniq([...ends, ...near(consts), ...special].filter(inside));
}

function f32Pool(spec: any): number[] {
  if (typeof spec === 'number') return [toBits(spec)];
  if (spec && spec.bits !== undefined) return [spec.bits | 0];
  if (spec && spec.oneOf) return uniq((spec.oneOf as number[]).map(toBits));
  if (Array.isArray(spec)) {
    const [lo, hi] = spec as [number, number];
    const xs = [lo, hi, (lo + hi) / 2, 0, -0, 1, -1, 0.5, Math.fround(lo + (hi - lo) * 0.999)].filter(
      x => x >= lo && x <= hi,
    );
    return [...new Set(xs.map(x => toBits(x)))];
  }
  return uniq([...F32_EDGES, ...F32_EXTRA]);
}

/** A pool entry writes its value into the case's memory (buffers, records) and returns the argument. */
type Entry = (mem: Memory, name: string) => number;

interface Tables {
  readonly records: Record<string, Record<string, { type: string; offset?: number }>>;
  readonly enums: Record<string, Record<string, number>>;
}

function cellPatterns(len: number, lo: number, hi: number, consts: readonly number[]): number[][] {
  const span = hi - lo + 1;
  const cs = uniq(near(consts).filter(c => c >= lo && c <= hi));
  const pats: number[][] = [
    Array(len).fill(lo),
    Array(len).fill(hi),
    Array.from({ length: len }, (_, i) => lo + (i % span)),
    Array.from({ length: len }, (_, i) => hi - (i % span)),
    Array.from({ length: len }, (_, i) => (i % 2 ? hi : lo)),
  ];
  if (cs.length) pats.push(Array.from({ length: len }, (_, i) => cs[i % cs.length]));
  return pats;
}

function pool(spec: any, type: string, t: Tables, consts: readonly number[]): Entry[] {
  const value =
    (x: number): Entry =>
    () =>
      x | 0;
  if (type === 'f32') return f32Pool(spec).map(value);
  if (typeof spec === 'number') return [value(spec)];
  if (Array.isArray(spec)) return i32Pool(spec[0], spec[1], consts).map(value);
  if (spec && spec.cells) return [(mem, name) => mem.buffer(spec.cells as number[], name)];
  if (spec && spec.string !== undefined) return [(mem, name) => mem.string(spec.string as string, name)];
  if (spec && (spec.buffer || spec.floats)) {
    const [a, b] = (spec.buffer ?? spec.floats) as [number, number];
    const lengths = uniq([a, b, a + 1, b - 1, ...near(consts)].filter(n => n >= a && n <= b && n >= 0));
    const out: Entry[] = [];
    if (spec.floats) {
      const fp = f32Pool(spec.range);
      for (const len of lengths)
        for (let k = 0; k < Math.min(3, fp.length); k++)
          out.push((mem, name) => {
            const cells: number[] = [];
            for (let i = 0; i < len; i++) {
              const bits = fp[(i + k) % fp.length];
              cells.push(bits & 65535, (bits >>> 16) & 65535);
            }
            return mem.buffer(cells, name);
          });
      return out;
    }
    const [c0, c1] = (spec.cell as [number, number]) ?? [0, 255];
    for (const len of lengths)
      for (const cells of cellPatterns(len, c0, c1, consts)) out.push((mem, name) => mem.buffer(cells, name));
    return out;
  }
  if (spec && spec.bool) return [value(0), value(1)];
  if (spec && spec.record) {
    // fields in the order of their offsets: Memory.record writes word i at offset 4i
    const layout = byOffset(t.records[type] ?? {});
    const fields = Object.entries(layout).map(([field, f]) =>
      pool(spec.record[field] ?? [-50, 50], f.type, t, consts),
    );
    const size = Math.max(1, ...fields.map(p => p.length));
    return Array.from(
      { length: size },
      (_, j): Entry =>
        (mem, name) => {
          const names = Object.keys(layout);
          const words = fields.map((p, i) => p[(j + i) % p.length](mem, name + '.' + names[i]));
          return mem.record(words, name);
        },
    );
  }
  if (spec && spec.oneOf) return uniq(spec.oneOf as number[]).map(value);
  if (type === 'bool') return [value(0), value(1)];
  if (type === 'buffer') return pool({ buffer: [0, 40] }, type, t, consts);
  if (type === 'string') return pool({ buffer: [0, 24], cell: [32, 126] }, type, t, consts);
  if (t.records[type]) return pool({ record: {} }, type, t, consts);
  if (t.enums[type]) return uniq(Object.values(t.enums[type])).map(value);
  return i32Pool(MIN, MAX, consts).map(value);
}

/** The pools of a function's parameters (for tests and reports): their sizes. */
export function poolSizes(st: Store, fname: string, inputs: FunctionInputs = {}): number[] {
  const f = st.fn(fname),
    t = tables(st),
    consts = constantsOf(st, f);
  return f.params.map((type, i) => pool(inputs[f.locals[i].name], type, t, consts).length);
}

/**
 * A record type's fields in the order of their offsets. The front end's tables keep declaration order, but the
 * tables of a frozen artifact are key-sorted.
 */
const byOffset = <F extends { offset?: number }>(fields: Readonly<Record<string, F>>): Record<string, F> =>
  Object.fromEntries(Object.entries(fields).sort((a, b) => (a[1].offset ?? 0) - (b[1].offset ?? 0)));

/**
 * A view of `st` whose record tables list fields in offset order. The default generator (`makeValue`) writes a
 * record's words in the order of its table's keys; on a store made from an artifact those keys are sorted, so a
 * record whose fields are not declared alphabetically (Candela's `K`) gets its words at the wrong offsets. Generating
 * from this view gives each word its declared offset. On the corpus, whose two record types are `{ x, y }`, the
 * cases are identical.
 */
export function offsetOrdered(st: Store): Store {
  const records = st.frontEnd.records as Tables['records'] | null;
  if (!records) return st;
  const view = Object.create(st) as Store;
  Object.defineProperty(view, 'frontEnd', {
    value: {
      ...st.frontEnd,
      records: Object.fromEntries(Object.entries(records).map(([k, f]) => [k, byOffset(f)])),
    },
  });
  return view;
}

const tables = (st: Store): Tables => ({
  records: (st.frontEnd.records as Tables['records']) ?? {},
  enums: (st.frontEnd.enums as Tables['enums']) ?? {},
});

/** `extra` boundary cases for one function; case numbers start at `offset`. */
export function boundaryCases(
  st: Store,
  fname: string,
  { inputs = {} as FunctionInputs, extra = 40, offset = 100000 } = {},
): Case[] {
  const f = st.fn(fname),
    t = tables(st),
    consts = constantsOf(st, f);
  const pools = f.params.map((type, i) => pool(inputs[f.locals[i].name], type, t, consts));
  const out: Case[] = [];
  if (!pools.every(p => p.length)) return out;
  for (let j = 0; j < extra; j++) {
    const mem = new Memory();
    const args = pools.map((p, i) => p[(j + 3 * i) % p.length](mem, f.locals[i].name));
    out.push({ fn: fname, n: offset + j, args, memory: mem.image(), items: mem.items.slice() });
  }
  return out;
}

/** Statements of `fname` (and its callees) a set of cases executes on `st`. */
export function coveredStatements(st: Store, cases: readonly Case[], limit = 2e4): Set<string> {
  const out = new Set<string>();
  for (const c of cases) {
    const r = evaluate(st, c.fn, c.args, c.memory, { limit, counts: true });
    for (const s of r.counts!.keys()) out.add(s);
  }
  return out;
}

/** The share of a function's blocks a set of cases executes (a block counts when its first statement runs). */
export function blockCoverage(
  st: Store,
  fname: string,
  cases: readonly Case[],
  limit = 2e4,
): { blocks: number; covered: number } {
  const f = st.fn(fname),
    ran = coveredStatements(st, cases, limit);
  const blocks = f.blocks.filter(b => b.stmts.length);
  return { blocks: blocks.length, covered: blocks.filter(b => ran.has(b.stmts[0])).length };
}

/** `extra` cases chosen by greedy statement coverage from boundary and random candidates. */
function coverageCases(
  st: Store,
  fname: string,
  inputs: FunctionInputs,
  extra: number,
  seed: number,
  offset: number,
): Case[] {
  const candidates = [
    ...boundaryCases(st, fname, { inputs, extra: 4 * extra, offset }),
    ...casesFrom(st, fname, { count: 4 * extra, seed: seed + 1, inputs }).map(c => ({
      ...c,
      n: offset + 4 * extra + c.n,
    })),
  ];
  const seen = new Set<string>(),
    chosen: Case[] = [],
    rest: Case[] = [];
  for (const c of candidates) {
    if (chosen.length >= extra) break;
    const r = evaluate(st, c.fn, c.args, c.memory, { limit: 2e4, counts: true });
    const fresh = [...r.counts!.keys()].filter(s => !seen.has(s));
    if (fresh.length) {
      fresh.forEach(s => seen.add(s));
      chosen.push(c);
    } else rest.push(c);
  }
  return [...chosen, ...rest.slice(0, extra - chosen.length)].map((c, j) => ({ ...c, n: offset + j }));
}

export interface StrongParams extends MeaningParams {
  /** Boundary cases appended to the `count` default cases of each function (default: `count`). */
  readonly extra?: number;
  /** Choose the extra cases by statement coverage of the origin instead of the fixed boundary scheme. */
  readonly coverage?: boolean;
  /**
   * The divergence rule (default 10; 0 turns it off). Version 1 counts a case as no verdict when either side hits the
   * step limit, so a candidate that never terminates on some inputs is accepted if the others agree, and one that
   * never terminates anywhere is accepted as soon as a single case terminates. With the rule, a candidate that hits
   * the limit is run again with `divergence` times the limit; if it still does not finish while the origin finished
   * within the limit, the case is a disagreement ("diverges"). When the origin hits the limit the case stays no verdict.
   */
  readonly divergence?: number;
  /** Record layout of the default part of the cases (see `offsetOrdered`): 'offset' (default) or 'keys' (version 1's). */
  readonly layout?: 'offset' | 'keys';
}

/** A candidate's run that did not finish within `divergence` times the limit. */
interface Diverged extends RunResult {
  readonly diverged?: true;
}

/** The default cases of a function, unchanged, followed by `extra` boundary (or coverage-chosen) cases. */
export function strongCasesFrom(
  st: Store,
  fname: string,
  opts: {
    count?: number;
    extra?: number;
    seed?: number;
    inputs?: FunctionInputs;
    coverage?: boolean;
    layout?: 'offset' | 'keys';
  } = {},
): Case[] {
  const count = opts.count ?? 40,
    extra = opts.extra ?? count,
    seed = opts.seed ?? 7,
    inputs = opts.inputs ?? {},
    coverage = !!opts.coverage,
    gst = opts.layout === 'keys' ? st : offsetOrdered(st);
  return [
    ...casesFrom(gst, fname, { count, seed, inputs }),
    ...(coverage
      ? coverageCases(gst, fname, inputs, extra, seed, count)
      : boundaryCases(st, fname, { inputs, extra, offset: count })),
  ];
}

const canonicalJson = (x: unknown): string =>
  JSON.stringify(x, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
const strongChecks = new Map<string, DifferentialInvariant<any>>();
/** Cases per origin revision and parameter key: generation (and coverage selection) runs once per program. */
const caseCache = new Map<string, Case[]>();

/**
 * `typed.meaning-kept` version 2: every function (or every root) of `candidate` agrees with `origin` on the default
 * cases plus `extra` boundary cases per function. The verdict rules are version 1's.
 */
export function meaningKeptStrong(
  params: StrongParams = {},
): DifferentialInvariant<{ origin: typeof BlocksIR; candidate: typeof BlocksIR }> {
  const count = params.count ?? 40,
    extra = params.extra ?? count,
    seed = params.seed ?? 7,
    inputs = params.inputs ?? {},
    limit = params.limit ?? 2e4,
    coverage = !!params.coverage,
    divergence = params.divergence ?? 10,
    layout = params.layout ?? 'offset',
    roots = params.roots ? [...params.roots].sort() : null;
  const key = canonicalJson({
    generator: 'strong-1',
    count,
    extra,
    coverage,
    divergence,
    layout,
    seed,
    inputs,
    limit,
    ...(roots ? { roots } : {}),
  });
  let check = strongChecks.get(key);
  if (!check) {
    /** Per case: did the origin finish within the limit (set when the baseline runs, read by the subject's run). */
    const originFinished = new WeakMap<Case, boolean>();
    check = differential<{ origin: typeof BlocksIR; candidate: typeof BlocksIR }, Case, RunResult>({
      id: 'typed.meaning-kept',
      version: `2+${hash(key)}`,
      description: `${roots ? `the entries ${roots.join(', ')} agree` : 'every function agrees'} with the origin on ${count} generated and ${extra} ${coverage ? 'coverage-chosen' : 'boundary'} cases (seed ${seed})${divergence ? `; a candidate still running at ${divergence}x the step limit where the origin finished disagrees` : ''}`,
      inputs: { origin: BlocksIR, candidate: BlocksIR },
      baseline: 'origin',
      subject: 'candidate',
      count: count + extra,
      seed,
      random: rng,
      cases: ({ origin }) => {
        const art = origin as Artifact<TypedBlocks>,
          ck = `${art.revision}|${key}`;
        let cases = caseCache.get(ck);
        if (!cases) {
          const st = storeOf(art.value);
          cases = (roots ?? [...st.fns.keys()]).flatMap(fn =>
            strongCasesFrom(st, fn, { count, extra, seed, inputs: inputs[fn] ?? {}, coverage, layout }),
          );
          if (caseCache.size > 64) caseCache.clear();
          caseCache.set(ck, cases);
        }
        return cases;
      },
      run: (side, art, c, ports): Diverged => {
        const st = storeOf((art as Artifact<TypedBlocks>).value),
          r = evaluate(st, c.fn, c.args, c.memory, { limit });
        if (side === 'baseline') {
          originFinished.set(c, !r.limit);
          return r;
        }
        // re-run only where the origin finished: elsewhere the case is no verdict whatever the candidate does.
        // runDifferential runs a case's baseline before its subject, so this is usually known; where the baseline's
        // outcome was replayed instead (a memo, a worker), the origin is run here
        if (!r.limit || !divergence) return r;
        let finished = originFinished.get(c);
        if (finished === undefined) {
          const origin = (ports as { origin?: Artifact<TypedBlocks> } | undefined)?.origin;
          finished = origin
            ? !evaluate(storeOf(origin.value), c.fn, c.args, c.memory, { limit }).limit
            : false;
          originFinished.set(c, finished);
        }
        if (!finished) return r;
        const again = evaluate(st, c.fn, c.args, c.memory, { limit: limit * divergence });
        // not inconclusive: if the origin finished, compare reports the divergence; if not, the case is skipped
        return again.limit ? { ...again, limit: false, diverged: true } : again;
      },
      inconclusive: r => r.limit,
      compare: (expected, got: Diverged, c) =>
        got.diverged
          ? {
              ok: false,
              reason: `${c.fn}#${c.n}: expected ${String(outcome(expected))}, got no result within ${divergence}x the step limit`,
            }
          : agrees(expected, got)
            ? true
            : {
                ok: false,
                reason: `${c.fn}#${c.n}: expected ${String(outcome(expected))}, got ${String(outcome(got))}`,
              },
      describeCase: c => ({ fn: c.fn, n: c.n, args: c.args }),
      maxCounterexamples: 5,
    });
    strongChecks.set(key, check);
  }
  return check;
}

const contracts = new Map<string, TransformationDefinition<any, any>>();
/** The optimization contract with the version-2 meaning check; pass it to `applyPass` as `contract` to opt in. */
export function strongOptimizationContract(params: StrongParams = {}): TransformationDefinition<any, any> {
  const check = meaningKeptStrong(params);
  let c = contracts.get(check.version);
  if (!c) {
    c = defineTransformation({
      id: 'typed.optimization',
      version: check.version,
      description: 'an optimization keeps the meaning of the original program (boundary cases added)',
      inputs: { input: BlocksIR, origin: BlocksIR },
      outputs: { output: BlocksIR },
      ensures: [
        {
          invariant: check,
          bindings: {
            origin: { from: 'inputs', port: 'origin' },
            candidate: { from: 'outputs', port: 'output' },
          },
        },
      ],
    });
    contracts.set(check.version, c);
  }
  return c;
}
