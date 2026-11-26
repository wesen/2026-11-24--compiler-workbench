/**
 * The meaning of `typed.blocks`: an interpreter for statements over value trees, memory images for typed
 * arguments, deterministic case generation, and the differential check every optimization must pass.
 * A port of Compiler Workbench's evaluator.js (and its xorshift32 generator from base.js), so its case sets and
 * verdicts are reproduced exactly; the check is a framework `differential()` invariant (E5).
 */
import { differential, type DifferentialInvariant } from '../framework/contracts/differential.js';
import type { Artifact } from '../framework/core/types.js';
import { f32Op, toBits } from './f32.js';
import { BlocksIR, storeOf } from './ir.js';
import type { StmtRec, Store, TypedBlocks, ValueRec, WorkFn } from './model.js';

/** Compiler Workbench's generator (xorshift32): its seeds must give its cases. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** FNV-1a over UTF-16 code units, as Compiler Workbench hashes sources. */
export function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class Trap extends Error {
  limit = false;
  constructor(
    readonly trap: string,
    readonly at?: string,
  ) {
    super(trap);
  }
}

export interface MemoryItem {
  readonly kind: 'buffer' | 'record';
  readonly name: string;
  readonly at: number;
  readonly length?: number;
  readonly words?: number;
}

/** Guest memory for one call: buffers (u32 length then u16 cells) and records (one word per field). */
export class Memory {
  bytes: Uint8Array;
  view: DataView;
  top = 1024;
  readonly items: MemoryItem[] = [];
  constructor(size = 4096) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  alloc(n: number): number {
    const at = this.top;
    this.top = (this.top + n + 15) & ~15;
    if (this.top > this.bytes.length) this.grow(this.top + 1024);
    return at;
  }
  grow(n: number): void {
    const b = new Uint8Array(Math.ceil(n / 4096) * 4096);
    b.set(this.bytes);
    this.bytes = b;
    this.view = new DataView(b.buffer);
  }
  buffer(cells: readonly number[], name: string): number {
    const at = this.alloc(4 + 2 * Math.max(1, cells.length));
    this.view.setUint32(at, cells.length, true);
    cells.forEach((c, i) => this.view.setUint16(at + 4 + 2 * i, c & 65535, true));
    this.items.push({ kind: 'buffer', name, at, length: cells.length });
    return at;
  }
  string(text: string, name: string): number {
    return this.buffer(
      Array.from(text, ch => ch.charCodeAt(0)),
      name,
    );
  }
  record(words: readonly number[], name: string): number {
    const at = this.alloc(4 * Math.max(1, words.length));
    words.forEach((w, i) => this.view.setInt32(at + 4 * i, w | 0, true));
    this.items.push({ kind: 'record', name, at, words: words.length });
    return at;
  }
  image(): Uint8Array {
    return this.bytes.slice(0, Math.max(this.top, 1024));
  }
}

export function readBuffer(bytes: Uint8Array, at: number): number[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(at, true),
    out: number[] = [];
  for (let i = 0; i < Math.min(n, 256); i++) out.push(v.getUint16(at + 4 + 2 * i, true));
  return out;
}

/**
 * An input specification per parameter: `[lo, hi]` for i32, `{ buffer: [minLen, maxLen], cell: [lo, hi] }`,
 * `{ cells: [...] }`, `{ string: 'text' }`, `{ bool: true }`, `{ record: { field: spec } }`, `{ oneOf: [...] }`,
 * or a fixed number. For an f32: a number, `[lo, hi]` (uniform), `{ bits }` or `{ oneOf: [...] }`; a buffer of f32s:
 * `{ floats: [minLen, maxLen], range: [lo, hi] }` (without `range`, f32s as an unspecified f32 parameter gets them).
 * Unspecified parameters get defaults by type.
 */
export type InputSpec = number | readonly [number, number] | Readonly<Record<string, unknown>>;
export type FunctionInputs = Readonly<Record<string, InputSpec>>;
export type ProgramInputs = Readonly<Record<string, FunctionInputs>>;

interface FrontEndTables {
  records: Record<string, Record<string, { type: string }>>;
  enums: Record<string, Record<string, number>>;
}
const tables = (st: Store): FrontEndTables => ({
  records: (st.frontEnd.records as FrontEndTables['records']) ?? {},
  enums: (st.frontEnd.enums as FrontEndTables['enums']) ?? {},
});

function makeValue(
  spec: any,
  type: string,
  mem: Memory,
  rnd: () => number,
  fe: FrontEndTables,
  name: string,
): number {
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  if (type === 'f32') return makeF32(spec, rnd);
  if (typeof spec === 'number') return spec | 0;
  if (Array.isArray(spec)) return between(spec[0], spec[1]) | 0;
  if (spec && spec.cells) return mem.buffer(spec.cells, name);
  if (spec && spec.string !== undefined) return mem.string(spec.string, name);
  if (spec && spec.buffer) {
    const [a, b] = spec.buffer,
      [c0, c1] = spec.cell || [0, 255];
    const len = between(a, b);
    return mem.buffer(
      Array.from({ length: len }, () => between(c0, c1)),
      name,
    );
  }
  if (spec && spec.floats) {
    // a buffer of f32s as Typed reads them (getF32(i): UTF-16 units 2i and 2i + 1, the f32 at byte 4 + 4i)
    const [a, b] = spec.floats,
      len = between(a, b),
      cells: number[] = [];
    for (let i = 0; i < len; i++) {
      const bits = makeF32(spec.range ?? undefined, rnd);
      cells.push(bits & 65535, (bits >>> 16) & 65535);
    }
    return mem.buffer(cells, name);
  }
  if (spec && spec.bool) return rnd() < 0.5 ? 0 : 1;
  if (spec && spec.record) {
    const layout = fe.records[type] || {};
    const words = Object.entries(layout).map(([field, f]) =>
      makeValue(spec.record[field] ?? [-50, 50], f.type, mem, rnd, fe, name + '.' + field),
    );
    return mem.record(words, name);
  }
  if (spec && spec.oneOf) return spec.oneOf[Math.floor(rnd() * spec.oneOf.length)] | 0;
  if (type === 'bool') return rnd() < 0.5 ? 0 : 1;
  if (type === 'buffer') return makeValue({ buffer: [0, 40] }, type, mem, rnd, fe, name);
  if (type === 'string') return makeValue({ buffer: [0, 24], cell: [32, 126] }, type, mem, rnd, fe, name);
  if (fe.records[type]) return makeValue({ record: {} }, type, mem, rnd, fe, name);
  if (fe.enums[type]) {
    const vals = Object.values(fe.enums[type]);
    return vals[Math.floor(rnd() * vals.length)];
  }
  const r = rnd(),
    edges = [0, 1, -1, 2147483647, -2147483648, 65535, 65536];
  return r < 0.72
    ? between(-20, 60)
    : r < 0.92
      ? between(-1000, 1000)
      : r < 0.97
        ? edges[Math.floor(rnd() * edges.length)]
        : between(-2147483648, 2147483647);
}

/**
 * Edge values of f32, as bits, most telling first: NaN, ±∞, ±0, ±1, the smallest subnormal, the largest finite, the
 * smallest normal, 0.5, 2^24, ±2^31 (the saturation bounds of to_i32), and the negative smallest subnormal.
 */
export const F32_EDGES: readonly number[] = [
  0x7fc00000, 0x7f800000, -0x800000, -0x80000000, 0, 0x3f800000, -0x40800000, 1, 0x7f7fffff, 0x00800000,
  0x3f000000, 0x4b800000, 0x4f000000, -0x31000000, -0x7fffffff,
];
/**
 * An f32 argument, as its bits. A number or `[lo, hi]` spec gives that value or a uniform value in the range; `{ bits }`
 * gives exact bits; `{ oneOf: [...] }` one of the numbers. Unspecified: mostly small values in [-4, 4] and [-1000, 1000],
 * values in [0, 1], and with low probability an edge value (±0, ±∞, NaN, subnormals, extremes) or any bit pattern.
 * (`casesFrom` also gives the first cases of a function edge values outright.)
 */
function makeF32(spec: any, rnd: () => number): number {
  if (typeof spec === 'number') return toBits(spec);
  if (Array.isArray(spec)) return toBits(spec[0] + rnd() * (spec[1] - spec[0]));
  if (spec && spec.bits !== undefined) return spec.bits | 0;
  if (spec && spec.oneOf) return toBits(spec.oneOf[Math.floor(rnd() * spec.oneOf.length)]);
  const r = rnd();
  return r < 0.55
    ? toBits(-4 + 8 * rnd())
    : r < 0.75
      ? toBits(-1000 + 2000 * rnd())
      : r < 0.9
        ? toBits(rnd())
        : r < 0.97
          ? F32_EDGES[Math.floor(rnd() * F32_EDGES.length)]
          : (rnd() * 4294967296) | 0;
}

export interface Case {
  readonly fn: string;
  readonly n: number;
  readonly args: readonly number[];
  readonly memory: Uint8Array;
  readonly items: readonly MemoryItem[];
}

/** `count` cases for one function, deterministic in `seed` (Compiler Workbench's `cases.from`). */
export function casesFrom(
  st: Store,
  fname: string,
  { count = 50, seed = 7, inputs = {} as FunctionInputs } = {},
): Case[] {
  const f = st.fn(fname),
    fe = tables(st),
    out: Case[] = [],
    rnd = rng(seed);
  // the first quarter of the cases (at most one per edge value) give each unspecified f32 parameter an edge value:
  // parameter i of case k takes edge (k + i), so every edge meets every parameter and NaN meets ordinary values
  const edges = f.params.includes('f32') ? Math.min(F32_EDGES.length, Math.floor(count / 4)) : 0;
  for (let k = 0; k < count; k++) {
    const mem = new Memory();
    const args = f.params.map((t, i) =>
      t === 'f32' && k < edges && inputs[f.locals[i].name] === undefined
        ? F32_EDGES[(k + i) % F32_EDGES.length]
        : makeValue(inputs[f.locals[i].name], t, mem, rnd, fe, f.locals[i].name),
    );
    out.push({ fn: fname, n: k, args, memory: mem.image(), items: mem.items.slice() });
  }
  return out;
}

/** One concrete call: `{ name: number | {cells} | {buffer} | {string} }`. */
export function benchCase(st: Store, fname: string, bench: Readonly<Record<string, unknown>> = {}): Case {
  const f = st.fn(fname),
    mem = new Memory(),
    rnd = rng(1);
  const args = f.params.map((t, i) =>
    makeValue(bench[f.locals[i].name] ?? 0, t, mem, rnd, tables(st), f.locals[i].name),
  );
  return { fn: fname, n: 0, args, memory: mem.image(), items: mem.items.slice() };
}

const MASK = 31;
export function binop(op: string, a: number, b: number): number {
  switch (op) {
    case 'add':
      return (a + b) | 0;
    case 'sub':
      return (a - b) | 0;
    case 'mul':
      return Math.imul(a, b);
    case 'div':
      if (b === 0) throw new Trap('division by zero');
      if (a === -2147483648 && b === -1) throw new Trap('division overflow');
      return (a / b) | 0;
    case 'rem':
      if (b === 0) throw new Trap('division by zero');
      if (b === -1) return 0;
      return a % b | 0;
    case 'and':
      return a & b;
    case 'or':
      return a | b;
    case 'xor':
      return a ^ b;
    case 'shl':
      return a << (b & MASK);
    case 'shr':
      return a >> (b & MASK);
    case 'shru':
      return (a >>> (b & MASK)) | 0;
    case 'eq':
      return +(a === b);
    case 'ne':
      return +(a !== b);
    case 'lt':
      return +(a < b);
    case 'gt':
      return +(a > b);
    case 'le':
      return +(a <= b);
    case 'ge':
      return +(a >= b);
    case 'ltu':
      return +(a >>> 0 < b >>> 0);
    case 'geu':
      return +(a >>> 0 >= b >>> 0);
  }
  throw new Error('evaluator: unknown operator ' + op);
}

export interface RunResult {
  readonly kind: 'run';
  readonly engine: string;
  readonly trap: string | false;
  /** The result: an i32 (an f32's bits), or the leaves of a value-record result. */
  readonly result?: number | readonly number[];
  readonly at?: string;
  readonly limit: boolean;
  readonly fault?: boolean;
  readonly steps: number;
  readonly unit: string;
  readonly counts: Map<string, number> | null;
  readonly bytes: Uint8Array;
}

/** The stack area the evaluator adds above guest memory when a program has frame arrays (as the interpreter's). */
export const STACK_BYTES = 65536;
const hasFrames = new WeakMap<Store, boolean>();
const I32_BINARY = new Set(
  ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'shru'].concat([
    'eq',
    'ne',
    'lt',
    'gt',
    'le',
    'ge',
    'ltu',
    'geu',
  ]),
);

export function evaluate(
  st: Store,
  fname: string,
  args: readonly number[],
  memBytes: Uint8Array,
  opts: {
    limit?: number;
    counts?: boolean;
    /** IRWB-005 C5: called before each executed statement with the frame's locals (read only; facts checking). */
    observe?: (fn: string, stmt: string, locals: Int32Array) => void;
  } = {},
): RunResult {
  const limit = opts.limit ?? 2e5,
    counts = opts.counts ? new Map<string, number>() : null,
    observe = opts.observe;
  // frame arrays live in a stack area above the guest memory, as on the target; programs without them get none, so
  // an access past the memory image still traps
  let frames = hasFrames.get(st);
  if (frames === undefined) hasFrames.set(st, (frames = [...st.fns.values()].some(f => f.arrayBytes)));
  const size = frames ? (memBytes.length + STACK_BYTES + 15) & -16 : memBytes.length;
  const bytes = new Uint8Array(size);
  bytes.set(memBytes);
  const mem = new DataView(bytes.buffer);
  let steps = 0,
    sp = size;
  const check = (addr: number, w: number) => {
    if (addr < 0 || addr + w > bytes.length) throw new Trap('memory access outside guest memory: ' + addr);
  };
  function call(name: string, argv: readonly number[], depth: number): number | number[] {
    if (depth > 64) throw new Trap('call depth');
    const f: WorkFn = st.fn(name);
    const L = new Int32Array(f.locals.length);
    argv.forEach((a, i) => (L[i] = a));
    const saved = sp;
    let frame = 0,
      results: readonly number[] = [];
    if (f.arrayBytes) {
      sp = (sp - f.arrayBytes) & -16;
      if (sp < memBytes.length) throw new Trap('stack overflow');
      frame = sp;
    }
    const ev = (id: string): number => {
      const v = st.get(id) as ValueRec;
      switch (v.op) {
        case 'const':
          return v.imm as number;
        case 'get':
          return L[v.imm as number];
        case 'eqz':
          return +(ev(v.args[0]) === 0);
        case 'load': {
          const a = ev(v.args[0]) + (v.imm as number);
          check(a, 4);
          return mem.getInt32(a, true);
        }
        case 'load16u': {
          const a = ev(v.args[0]) + (v.imm as number);
          check(a, 2);
          return mem.getUint16(a, true);
        }
        case 'call': {
          const r = call(v.imm as string, v.args.map(ev), depth + 1);
          if (typeof r === 'number') return r;
          results = r;
          return 0;
        }
        case 'result':
          return results[v.imm as number];
        case 'caddr': {
          // text.checked_address: trap unless position < capacity (unsigned), then receiver + 2 * position
          const r = ev(v.args[0]),
            p = ev(v.args[1]);
          check(r, 4);
          if (p >>> 0 >= mem.getInt32(r, true) >>> 0) throw new Trap('checked address out of range', id);
          return (r + (p << 1)) | 0;
        }
        case 'aaddr':
          return (frame + (v.imm as number)) | 0;
        case 'tuple':
          throw new Error('evaluator: a tuple is only a returned value');
        default: {
          const a = ev(v.args[0]);
          if (v.args.length === 1) return f32Op(v.op, a)!;
          const b = ev(v.args[1]);
          return I32_BINARY.has(v.op) ? binop(v.op, a, b) : f32Op(v.op, a, b)!;
        }
      }
    };
    try {
      let b = f.blocks[0];
      for (;;) {
        let next: string | undefined;
        for (const sid of b.stmts) {
          if (++steps > limit) {
            const t = new Trap('step limit ' + limit);
            t.limit = true;
            throw t;
          }
          if (counts) counts.set(sid, (counts.get(sid) || 0) + 1);
          if (observe) observe(name, sid, L);
          const s = st.get(sid) as StmtRec;
          switch (s.op) {
            case 'set':
              L[s.local!] = ev(s.value!);
              break;
            case 'eval':
              ev(s.value!);
              break;
            case 'store': {
              const a = ev(s.addr!) + s.offset!,
                v = ev(s.value!);
              if (s.width === 32) {
                check(a, 4);
                mem.setInt32(a, v, true);
              } else {
                check(a, 2);
                mem.setUint16(a, v & 65535, true);
              }
              break;
            }
            case 'zero':
              bytes.fill(0, frame + s.offset!, frame + s.offset! + s.bytes!);
              break;
            case 'br':
              next = s.to;
              break;
            case 'br_if':
              next = ev(s.cond!) ? s.then : s.else;
              break;
            case 'return': {
              const rv = st.get(s.value!) as ValueRec;
              return rv.op === 'tuple' ? rv.args.map(ev) : ev(s.value!);
            }
            case 'trap':
              throw new Trap(s.why || 'unreachable', sid);
          }
          if (next) break;
        }
        if (!next) next = b.succ[0];
        if (!next) throw new Trap('fell off the end of ' + b.id);
        b = st.get(next);
      }
    } finally {
      sp = saved;
    }
  }
  const image = () => (size === memBytes.length ? bytes : bytes.slice(0, memBytes.length));
  try {
    const result = call(fname, args, 0);
    return {
      kind: 'run',
      engine: 'evaluator',
      trap: false,
      result,
      limit: false,
      steps,
      unit: 'statements',
      counts,
      bytes: image(),
    };
  } catch (e) {
    if (e instanceof Trap)
      return {
        kind: 'run',
        engine: 'evaluator',
        trap: e.trap,
        at: e.at,
        limit: e.limit,
        steps,
        unit: 'statements',
        counts,
        bytes: image(),
      };
    throw e;
  }
}

export const outcome = (r: RunResult): number | readonly number[] | 'trap' => (r.trap ? 'trap' : r.result!);
const sameResult = (a: RunResult['result'], b: RunResult['result']): boolean =>
  typeof a === 'number' || typeof b === 'number' || a === undefined || b === undefined
    ? a === b
    : a.length === b.length && a.every((x, i) => x === b[i]);
const sameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Compiler Workbench's verdict for one case: `expected` is the meaning, `got` the run under test. A fault (a
 * calling-convention violation the emulator detects) never agrees; a trap agrees with any trap; otherwise
 * results and the memory both wrote must match.
 */
export function agrees(expected: RunResult, got: RunResult): boolean {
  if (got.fault) return false;
  if (expected.trap) return !!got.trap;
  if (got.trap || !sameResult(got.result, expected.result)) return false;
  const n = Math.min(expected.bytes.length, got.bytes.length);
  return sameBytes(got.bytes.subarray(0, expected.bytes.length), expected.bytes.subarray(0, n));
}

export interface MeaningParams {
  readonly count?: number;
  readonly seed?: number;
  readonly inputs?: ProgramInputs;
  readonly limit?: number;
  /**
   * The functions the program's host calls. When given, only they are compared: the program's meaning is what its
   * entries compute, and functions only they call may change or disappear (dead-function elimination).
   */
  readonly roots?: readonly string[];
}

const meaningChecks = new Map<string, DifferentialInvariant<any>>();
const canonicalJson = (x: unknown): string =>
  JSON.stringify(x, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

/**
 * `typed.meaning-kept`: every function of `candidate` agrees with `origin` (normally r0) on `count` generated
 * cases per function. The case parameters are part of the definition (its version carries their hash), and one
 * definition object exists per parameter set, as the contract registry requires.
 */
export function meaningKept(
  params: MeaningParams = {},
): DifferentialInvariant<{ origin: typeof BlocksIR; candidate: typeof BlocksIR }> {
  const count = params.count ?? 40,
    seed = params.seed ?? 7,
    inputs = params.inputs ?? {},
    limit = params.limit ?? 2e4,
    roots = params.roots ? [...params.roots].sort() : null;
  const key = canonicalJson(roots ? { count, seed, inputs, limit, roots } : { count, seed, inputs, limit });
  let check = meaningChecks.get(key);
  if (!check) {
    check = differential<{ origin: typeof BlocksIR; candidate: typeof BlocksIR }, Case, RunResult>({
      id: 'typed.meaning-kept',
      version: `1+${hash(key)}`,
      description: `${roots ? `the entries ${roots.join(', ')} agree` : 'every function agrees'} with the origin on ${count} generated cases (seed ${seed})`,
      inputs: { origin: BlocksIR, candidate: BlocksIR },
      baseline: 'origin',
      subject: 'candidate',
      count,
      seed,
      random: rng,
      cases: ({ origin }) => {
        const st = storeOf(origin.value);
        return (roots ?? [...st.fns.keys()]).flatMap(fn =>
          casesFrom(st, fn, { count, seed, inputs: inputs[fn] ?? {} }),
        );
      },
      run: (_side, art, c) =>
        evaluate(storeOf((art as Artifact<TypedBlocks>).value), c.fn, c.args, c.memory, { limit }),
      inconclusive: r => r.limit,
      compare: (expected, got, c) =>
        agrees(expected, got)
          ? true
          : {
              ok: false,
              reason: `${c.fn}#${c.n}: expected ${String(outcome(expected))}, got ${String(outcome(got))}`,
            },
      describeCase: c => ({ fn: c.fn, n: c.n, args: c.args }),
      maxCounterexamples: 5,
    });
    meaningChecks.set(key, check);
  }
  return check;
}
