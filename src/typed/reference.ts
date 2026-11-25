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
import { placeCall, readResults } from './ilp32f.js';
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

/**
 * Call `name` with `args` (i32s, f32s as bits) over guest memory `memory`; the memory the run leaves is compared
 * over `memory.length` bytes, as the evaluator's. Arguments and results are placed by ilp32f.ts (`placeCall`,
 * `readResults`): guest memory, then the stack, then the caller's stack words at sp.
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
  const placed = placeCall(sig, args, memory);
  const base = { kind: 'run' as const, engine: 'rv32', unit: 'instructions', counts: null };
  let run: any;
  try {
    run = interp.run(program, name, [], placed.bytes, {
      registers: placed.registers,
      fregisters: placed.fregisters,
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
  const result = readResults(sig, placed, run);
  return { ...base, trap: false, result, limit: false, steps: run.steps, bytes: out };
}
