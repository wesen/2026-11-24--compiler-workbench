/**
 * Running images on the reused emulator (ds-js-os `bench/host/rv32-interp.js`, RV32IM with calling-convention
 * checks), and what is built on runs: execution heat attributed to statements and source lines through covers,
 * instruction-level diffs of two images, an image's status against a revision chain, and `rv32.image-agrees`, the
 * differential check of an image against the evaluator.
 *
 * The emulator checks at every call and return that sp is 16-byte aligned, that ra matches the call, and that
 * s0-s11 hold what they held at the call. A violation is a fault, reported apart from a trap, and never agrees.
 */
import { differential, type DifferentialInvariant } from '../../framework/contracts/differential.js';
import { canonical } from '../../framework/core/data.js';
import type { Artifact } from '../../framework/core/types.js';
import { BlocksIR, storeOf } from '../ir.js';
import {
  agrees,
  casesFrom,
  evaluate,
  hash,
  outcome,
  rng,
  type Case,
  type ProgramInputs,
  type RunResult,
} from '../evaluate.js';
import { linesOf } from '../listing.js';
import type { Store, TypedBlocks } from '../model.js';
import { changedSavedF, needsConvention, placeCall, readResults, type CallSignature } from '../ilp32f.js';
import { typeClass } from '../model.js';
import { requireVendor } from '../vendor.js';
import { fail } from './errors.js';
import { REGS, decode } from './encode.js';
import {
  ImageIR,
  codeBytes,
  insnId,
  toBase64,
  validateImage,
  type ImageInsn,
  type ImageSig,
  type Rv32Image,
} from './image.js';

/** One run of an image: the evaluator's `RunResult` shape, with per-word execution counts. */
export interface ImageRun extends Omit<RunResult, 'counts'> {
  readonly engine: 'rv32';
  readonly unit: 'instructions';
  readonly program: string;
  /** Executions per instruction word (index = offset / 4), or null after a fault. */
  readonly counts: Uint32Array | null;
}

const valueOf = (img: Rv32Image | Artifact<Rv32Image>): Rv32Image =>
  'formatVersion' in img ? img : (img as Artifact<Rv32Image>).value;

export interface RunImageOptions {
  /** The emulator's instruction limit (default 2e5). */
  readonly limit?: number;
  /**
   * The function's signature, for ilp32f placement (f32 arguments in fa0-fa7, stack words, record results). Default:
   * the one the image records; without either, the arguments are integers in a0.. and the result is a0.
   */
  readonly sig?: CallSignature;
  /** Count executions per instruction word (default true; heat needs them, a check does not). */
  readonly counts?: boolean;
}

/**
 * Run `fname` of an image on the emulator with `args` and `memBytes` as guest memory (the stack is placed above it).
 * A function with an f32 parameter or result, a record result or stack arguments is called under ilp32f
 * (`placeCall`, `readResults`), and must also preserve fs0-fs11, which the emulator itself does not check; any other
 * gets its arguments in a0.. as before. A step limit or an access outside guest memory is a trap; any other emulator
 * fault is a fault.
 */
export function runImage(
  image: Rv32Image | Artifact<Rv32Image>,
  fname: string,
  args: readonly number[],
  memBytes: Uint8Array,
  opts: RunImageOptions = {},
): ImageRun {
  const img = valueOf(image);
  const interp = requireVendor('typedRv32Interp');
  if (!(fname in img.entries))
    fail(
      'unknownFunction',
      `${img.program}'s image has no entry "${fname}"`,
      `entries: ${img.fnOrder.join(', ')}`,
    );
  const program = { image: codeBytes(img), entries: img.entries, relocations: [], imports: [] };
  const sig = opts.sig ?? img.fns[fname]?.sig;
  const base = {
    kind: 'run' as const,
    engine: 'rv32' as const,
    program: img.program,
    unit: 'instructions' as const,
  };
  try {
    if (sig && needsConvention(sig)) {
      const placed = placeCall(sig, args, memBytes, { fsPatterns: true });
      const r = interp.run(program as unknown as Uint8Array, fname, [], placed.bytes, {
        registers: placed.registers,
        fregisters: placed.fregisters,
        limit: opts.limit ?? 2e5,
        counts: opts.counts !== false,
      });
      const bytes = (r.bytes as Uint8Array).slice(0, memBytes.length);
      if (r.trap)
        return { ...base, trap: 'ebreak', limit: false, steps: r.steps, counts: r.counts ?? null, bytes };
      const changed = changedSavedF(placed, r.fregisters);
      if (changed >= 0)
        return {
          ...base,
          trap: `callee-saved f${changed} (${REGS[32 + changed]}) changed across the call`,
          fault: true,
          limit: false,
          steps: r.steps,
          counts: null,
          bytes,
        };
      return {
        ...base,
        trap: false,
        result: readResults(sig, placed, r),
        limit: false,
        steps: r.steps,
        counts: r.counts ?? null,
        bytes,
      };
    }
    // vendor.ts types the first parameter as bytes; the interpreter takes the program object
    // ({ image, entries, relocations, imports }) that typedRv32.compile returns.
    const r = interp.run(program as unknown as Uint8Array, fname, args, memBytes, {
      limit: opts.limit ?? 2e5,
      ...(opts.counts === false ? { counts: false } : {}),
    });
    return {
      kind: 'run',
      engine: 'rv32',
      program: img.program,
      trap: r.trap ? 'ebreak' : false,
      ...(r.trap ? {} : { result: r.result as number }),
      limit: false,
      steps: r.steps,
      unit: 'instructions',
      counts: r.counts ?? null,
      bytes: r.bytes,
    };
  } catch (e) {
    if (!interp.Rv32Fault || !(e instanceof interp.Rv32Fault)) throw e;
    const message = (e as Error).message;
    const limit = /instruction limit/.test(message),
      memory = /outside guest memory/.test(message);
    return {
      kind: 'run',
      engine: 'rv32',
      program: img.program,
      trap: memory ? 'memory' : message,
      fault: !limit && !memory,
      limit,
      steps: NaN,
      unit: 'instructions',
      counts: null,
      bytes: new Uint8Array(0),
    };
  }
}

export interface Heat {
  readonly byInsn: readonly { readonly id: string; readonly n: number }[];
  readonly byStmt: ReadonlyMap<string, number>;
  readonly byLine: ReadonlyMap<number, number>;
}

/** Per-instruction execution counts, attributed to statements and source lines through covers. */
export function heat(st: Store, image: Rv32Image | Artifact<Rv32Image>, counts: Uint32Array | null): Heat {
  const img = valueOf(image);
  const byInsn: { id: string; n: number }[] = [],
    byStmt = new Map<string, number>(),
    byLine = new Map<number, number>();
  const lookup = (id: string) => st.get(id);
  for (const e of img.insns) {
    const n = counts ? counts[e.offset >>> 2] : 0;
    byInsn.push({ id: e.id, n });
    if (!n) continue;
    for (const c of e.covers) {
      const k = st.get(c);
      if (k && k.kind === 'stmt') byStmt.set(c, (byStmt.get(c) || 0) + n);
    }
    for (const l of new Set(linesOf(lookup, e.covers[0] || ''))) byLine.set(l, (byLine.get(l) || 0) + n);
  }
  return { byInsn, byStmt, byLine };
}

export interface ImageDiff {
  readonly rows: readonly { readonly op: '=' | '-' | '+'; readonly a?: ImageInsn; readonly b?: ImageInsn }[];
  readonly same: number;
  readonly removed: number;
  readonly added: number;
}

/**
 * Instruction-level diff of two images, one function: a longest common subsequence over the instructions with
 * branch targets named, so code that only moved does not count as changed.
 */
export function diffImages(
  A: Rv32Image | Artifact<Rv32Image>,
  B: Rv32Image | Artifact<Rv32Image>,
  fname: string,
): ImageDiff {
  const rows = (img: Rv32Image) => img.insns.filter(e => e.fn === fname);
  const a = rows(valueOf(A)),
    b = rows(valueOf(B)),
    n = a.length,
    m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i].sym === b[j].sym ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { op: '=' | '-' | '+'; a?: ImageInsn; b?: ImageInsn }[] = [];
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i].sym === b[j].sym) {
      out.push({ op: '=', a: a[i], b: b[j] });
      i++;
      j++;
    } else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) {
      out.push({ op: '-', a: a[i] });
      i++;
    } else {
      out.push({ op: '+', b: b[j] });
      j++;
    }
  }
  return {
    rows: out,
    same: out.filter(r => r.op === '=').length,
    removed: out.filter(r => r.op === '-').length,
    added: out.filter(r => r.op === '+').length,
  };
}

/**
 * `current` when the image was lowered from the head of `revisions` (r0 first), `older (rK)` when from an earlier
 * one, `stale` otherwise (its revision is not in the chain, or it was not lowered from typed.blocks).
 */
export function imageStatus(
  image: Rv32Image | Artifact<Rv32Image>,
  revisions: readonly Artifact<TypedBlocks>[],
): string {
  const src = valueOf(image).source;
  const k = src ? revisions.findIndex(r => r.revision === src.revision) : -1;
  return k < 0 ? 'stale' : k === revisions.length - 1 ? 'current' : `older (r${k})`;
}

/** A signature by type class, as an image records it (Typed types: f32 is f32, every other type i32). */
export const imageSig = (sig: CallSignature): ImageSig => ({
  params: sig.params.map(typeClass),
  result: typeClass(sig.result),
  ...(sig.results ? { results: sig.results.map(typeClass) } : {}),
});

/**
 * An image another compiler made (for instance ds-js-os's `typedRv32.compile`, an independent oracle) in the
 * `rv32.image` format: functions from its entries, every word decoded, nothing covered. With `signatures` (the
 * reference compiler's `{ name, params, result, results? }` list), functions that need ilp32f record their `sig`, so
 * `runImage` and `imageAgrees` call them as our own images.
 */
export function imageFromCode(
  program: string,
  code: Uint8Array,
  entries: Readonly<Record<string, number>>,
  signatures: readonly (CallSignature & { readonly name: string })[] = [],
): Rv32Image {
  const sigs = new Map(signatures.filter(needsConvention).map(s => [s.name, imageSig(s)]));
  const order = Object.entries(entries).sort((p, q) => p[1] - q[1]);
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const insns: ImageInsn[] = [],
    fns: Rv32Image['fns'] = {};
  order.forEach(([name, entry], i) => {
    const end = i + 1 < order.length ? order[i + 1][1] : code.length;
    for (let at = entry; at < end; at += 4) {
      const word = view.getUint32(at, true),
        text = decode(word, at).text;
      insns.push({
        id: insnId(name, at, entry),
        fn: name,
        offset: at,
        op: text.split(' ')[0],
        word,
        text,
        sym: text,
        covers: [],
      });
    }
    (fns as Record<string, unknown>)[name] = {
      name,
      entry,
      bytes: end - entry,
      insns: (end - entry) / 4,
      ...(sigs.has(name) ? { sig: sigs.get(name) } : {}),
    };
  });
  const img: Rv32Image = {
    formatVersion: 1,
    program,
    source: null,
    options: null,
    bytes: code.length,
    code: toBase64(code),
    entries: Object.fromEntries(order),
    fnOrder: order.map(([n]) => n),
    fns,
    insns,
  };
  validateImage(img);
  return img;
}

// ---------- rv32.image-agrees ----------
export interface ImageCheckParams {
  /** Cases per function (default 40, as the prototype's project check). */
  readonly count?: number;
  /** The xorshift32 seed (default 7, Compiler Workbench's). */
  readonly seed?: number;
  /** Input specifications per function, as in project.json. */
  readonly inputs?: ProgramInputs;
  /** Statement limit for the evaluator (default 2e4). */
  readonly limit?: number;
  /** Instruction limit for the emulator (default 2e5). */
  readonly imageLimit?: number;
}

type ImagePorts = { program: typeof BlocksIR; image: typeof ImageIR };
/** A function the image lacks: a fault, so the case disagrees instead of aborting the check. */
const missing = (img: Rv32Image, fn: string): ImageRun => ({
  kind: 'run',
  engine: 'rv32',
  program: img.program,
  trap: `no entry "${fn}" in the image`,
  fault: true,
  limit: false,
  steps: NaN,
  unit: 'instructions',
  counts: null,
  bytes: new Uint8Array(0),
});
const imageChecks = new Map<string, DifferentialInvariant<ImagePorts>>();

const describeOutcome = (r: RunResult | ImageRun): string =>
  r.fault ? `fault: ${r.trap}` : String(outcome(r as RunResult));

/** The signature of `fn` in the check's program. */
const programSig = (ports: { readonly program: unknown }, fn: string): CallSignature => {
  const f = storeOf((ports.program as Artifact<TypedBlocks>).value).fn(fn);
  return { params: f.params, result: f.result, ...(f.results ? { results: f.results } : {}) };
};

/**
 * `rv32.image-agrees`: every function of `image` agrees with the evaluator on `program` (expected) for `count`
 * generated cases per function of the program, with Compiler Workbench's verdict (`agrees`: a fault never agrees,
 * a trap agrees with any trap, otherwise result and memory must match). A step limit on either side makes a case
 * inconclusive. One definition object exists per parameter set; its version carries their hash.
 */
export function imageAgrees(params: ImageCheckParams = {}): DifferentialInvariant<ImagePorts> {
  const count = params.count ?? 40,
    seed = params.seed ?? 7,
    inputs = params.inputs ?? {},
    limit = params.limit ?? 2e4,
    imageLimit = params.imageLimit ?? 2e5;
  const key = canonical({ count, seed, inputs, limit, imageLimit });
  let check = imageChecks.get(key);
  if (!check) {
    check = differential<ImagePorts, Case, RunResult | ImageRun>({
      id: 'rv32.image-agrees',
      version: `1+${hash(key)}`,
      description: `every function of the image agrees with the evaluator on ${count} generated cases (seed ${seed})`,
      inputs: { program: BlocksIR, image: ImageIR },
      baseline: 'program',
      subject: 'image',
      count,
      seed,
      random: rng,
      cases: ({ program }) => {
        const st = storeOf(program.value);
        return [...st.fns.keys()].flatMap(fn => casesFrom(st, fn, { count, seed, inputs: inputs[fn] ?? {} }));
      },
      run: (side, art, c, ports) =>
        side === 'baseline'
          ? evaluate(storeOf((art as Artifact<TypedBlocks>).value), c.fn, c.args, c.memory, { limit })
          : c.fn in (art as Artifact<Rv32Image>).value.entries
            ? runImage(art as Artifact<Rv32Image>, c.fn, c.args, c.memory, {
                limit: imageLimit,
                counts: false,
                // the program's signature places f32 arguments and reads record results, for an image that
                // records none (another compiler's)
                sig: programSig(ports, c.fn),
              })
            : missing((art as Artifact<Rv32Image>).value, c.fn),
      inconclusive: r => r.limit,
      compare: (expected, got, c) =>
        agrees(expected as RunResult, { ...got, counts: null })
          ? true
          : {
              ok: false,
              reason: `${c.fn}#${c.n}: expected ${describeOutcome(expected)}, got ${describeOutcome(got)}`,
            },
      describeCase: c => ({ fn: c.fn, n: c.n, args: c.args }),
      maxCounterexamples: 5,
    });
    imageChecks.set(key, check);
  }
  return check;
}
