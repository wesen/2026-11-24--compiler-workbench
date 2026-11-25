/**
 * The reference oracle: a program compiled by the repository's own RV32 compiler (vendored typed-rv32.js, used only
 * as an oracle) and run on the reference interpreter (bench/host/rv32-interp.js, RV32IMF with exact binary32
 * arithmetic). `referenceRun` calls one function with the ilp32f convention of typed-rv32.js
 * (`argumentRegisters`, `resultLocations`): integers in a0–a7 and f32 in fa0–fa7, each class in order; an f32 beyond
 * fa7 takes the next free integer register; an argument with no register left takes the next stack word at the
 * caller's sp + 4k. A record result's leaves return the same way, the overflow in stack words the callee writes.
 *
 * The result has the evaluator's shape (`RunResult`), with f32 values as their bits in a signed i32, so `agrees`
 * compares the two directly. An `ebreak` (a failed check or `unreachable`) and a memory fault are traps; the
 * instruction limit is inconclusive (`limit`); any other interpreter fault (a calling-convention check) is a
 * `fault`, which never agrees.
 */
import type { RunResult } from './evaluate.js';
import { requireVendor } from './vendor.js';

export interface ReferenceProgram {
  readonly image: Uint8Array;
  readonly entries: Readonly<Record<string, number>>;
  readonly signatures: readonly { name: string; params: string[]; result: string; results?: string[] }[];
  readonly [field: string]: unknown;
}

/** Compile with the reference compiler. `stock` (no tape passes) works with the vendored core alone. */
export function referenceCompile(
  source: string,
  options: { maxSourceLength?: number; policy?: string } = {},
): ReferenceProgram {
  return requireVendor('typedRv32').compile(source, [], options.maxSourceLength ?? 64 * 1024, {
    policy: options.policy ?? 'stock',
  });
}

const CALLEE_SAVED = [2, 3, 4, 8, 9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
const RETURN_TO_HOST = -4;
/** The stack the frames grow into, below the stack words of arguments and results. */
const STACK = 65536;

type Location =
  | { readonly cls: 'x' | 'f'; readonly reg: number }
  | { readonly cls: 'stack'; readonly word: number };
function argumentLocations(types: readonly string[]): Location[] {
  let x = 0,
    f = 0,
    k = 0;
  return types.map(t =>
    t === 'f32' && f < 8
      ? { cls: 'f', reg: 10 + f++ }
      : x < 8
        ? { cls: 'x', reg: 10 + x++ }
        : { cls: 'stack', word: k++ },
  );
}
function resultLocations(types: readonly string[]): Location[] {
  let x = 0,
    f = 0,
    k = 0;
  return types.map(t =>
    t === 'f32'
      ? f < 8
        ? { cls: 'f', reg: 10 + f++ }
        : { cls: 'stack', word: k++ }
      : x < 8
        ? { cls: 'x', reg: 10 + x++ }
        : { cls: 'stack', word: k++ },
  );
}

/**
 * Call `name` with `args` (i32s, f32s as bits) over guest memory `memory`; the memory the run leaves is compared
 * over `memory.length` bytes, as the evaluator's.
 */
export function referenceRun(
  program: ReferenceProgram,
  name: string,
  args: readonly number[],
  memory: Uint8Array,
  options: { limit?: number } = {},
): RunResult {
  const interp = requireVendor('typedRv32Interp');
  const sig = program.signatures.find(s => s.name === name);
  if (!sig) throw new Error(`referenceRun: no function ${name} in the reference image`);
  const params = argumentLocations(sig.params);
  const results = sig.results ? resultLocations(sig.results) : null;
  const words = Math.max(
    params.filter(p => p.cls === 'stack').length,
    results?.filter(r => r.cls === 'stack').length ?? 0,
  );
  // guest memory, then the stack, then the caller's stack words at sp
  const sp = (memory.length + STACK + 15) & -16;
  const bytes = new Uint8Array(sp + ((4 * words + 15) & -16));
  bytes.set(memory);
  const view = new DataView(bytes.buffer);
  const x = new Int32Array(32),
    f = new Uint32Array(32);
  for (const r of CALLEE_SAVED) x[r] = 0x12340000 + r;
  x[1] = RETURN_TO_HOST;
  x[2] = sp;
  params.forEach((p, i) => {
    if (p.cls === 'stack') view.setInt32(sp + 4 * p.word, args[i] | 0, true);
    else if (p.cls === 'f') f[p.reg] = args[i] >>> 0;
    else x[p.reg] = args[i] | 0;
  });
  const base = { kind: 'run' as const, engine: 'rv32', unit: 'instructions', counts: null };
  let run: any;
  try {
    run = interp.run(program, name, [], bytes, {
      registers: x,
      fregisters: f,
      limit: options.limit ?? 2e7,
      counts: false,
    });
  } catch (e) {
    const message = (e as Error).message;
    const limit = /instruction limit/.test(message);
    const trap = limit || /memory access outside guest memory/.test(message);
    return {
      ...base,
      trap: message,
      limit,
      ...(trap ? {} : { fault: true }),
      steps: 0,
      bytes: memory.slice(),
    };
  }
  const out = (run.bytes as Uint8Array).slice(0, memory.length);
  if (run.trap) return { ...base, trap: 'ebreak', limit: false, steps: run.steps, bytes: out };
  const after = new DataView((run.bytes as Uint8Array).buffer, (run.bytes as Uint8Array).byteOffset);
  const read = (l: Location) =>
    l.cls === 'stack'
      ? after.getInt32(sp + 4 * l.word, true)
      : l.cls === 'f'
        ? run.fregisters[l.reg] | 0
        : run.registers[l.reg] | 0;
  const result = results
    ? results.map(read)
    : sig.result === 'f32'
      ? run.fregisters[10] | 0
      : run.registers[10] | 0;
  return { ...base, trap: false, result, limit: false, steps: run.steps, bytes: out };
}
