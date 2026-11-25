/**
 * The ilp32f calling convention, as the reference compiler defines it (vendored typed-rv32.js, `argumentRegisters`
 * and `resultLocations`), and a host-side call of an image function under it on the reference interpreter.
 *
 *   arguments   integers in a0–a7 and f32 in fa0–fa7, each class in order; an f32 beyond fa7 takes the next free
 *               integer register (its bits); an argument with no register left takes the next stack word k, at the
 *               caller's sp + 4k
 *   results     one result in a0 (an integer) or fa0 (an f32); a record result's leaves in a0–a7 and fa0–fa7 per
 *               class, and a leaf beyond its class's eight in the next stack word k at the caller's sp + 4k, which
 *               the callee writes before it returns
 *
 * Both the reference oracle (reference.ts) and the backend's image runner (backend/run.ts) call functions through
 * `placeCall` and `readResults`, so the two read arguments and results in the same places.
 */

/** A value's location: register `reg` of class x or f (10 + k for a_k and fa_k), or stack word `word`. */
export type Location =
  | { readonly cls: 'x' | 'f'; readonly reg: number }
  | { readonly cls: 'stack'; readonly word: number };

const isF32 = (t: string) => t === 'f32';

/** Where each argument of a function with these parameter types arrives. */
export function argumentLocations(types: readonly string[]): Location[] {
  let x = 0,
    f = 0,
    k = 0;
  return types.map(t =>
    isF32(t) && f < 8
      ? { cls: 'f', reg: 10 + f++ }
      : x < 8
        ? { cls: 'x', reg: 10 + x++ }
        : { cls: 'stack', word: k++ },
  );
}

/** Where each leaf of a record result with these leaf types returns. */
export function resultLocations(types: readonly string[]): Location[] {
  let x = 0,
    f = 0,
    k = 0;
  return types.map(t =>
    isF32(t)
      ? f < 8
        ? { cls: 'f', reg: 10 + f++ }
        : { cls: 'stack', word: k++ }
      : x < 8
        ? { cls: 'x', reg: 10 + x++ }
        : { cls: 'stack', word: k++ },
  );
}

/** A function's signature as the convention needs it: parameter types, the result type, a record's leaf types. */
export interface CallSignature {
  readonly params: readonly string[];
  readonly result: string;
  readonly results?: readonly string[];
}

const stackOf = (ls: readonly Location[]) => ls.filter(l => l.cls === 'stack').length;

/** The stack words a call needs at the caller's sp: its stack arguments, or its stack results if more. */
export function stackWords(sig: CallSignature): number {
  return Math.max(
    stackOf(argumentLocations(sig.params)),
    sig.results ? stackOf(resultLocations(sig.results)) : 0,
  );
}

/** Whether a call needs more than the integer convention (a0–a7 in, a0 out): an f32, a record result or stack words. */
export const needsConvention = (sig: CallSignature): boolean =>
  sig.params.some(isF32) || isF32(sig.result) || !!sig.results || sig.params.length > 8;

/** The callee-saved x registers the interpreter checks (sp, gp, tp, s0-s11), with their initial patterns. */
export const CALLEE_SAVED_X: readonly number[] = [2, 3, 4, 8, 9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
/** fs0-fs11, as indices into the f register file. The interpreter does not check them; `readResults` callers may. */
export const CALLEE_SAVED_F: readonly number[] = [8, 9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
/** ra for a call from the host: the interpreter returns to the host there. */
export const RETURN_TO_HOST = -4;
/** The stack the frames grow into, below the stack words of arguments and results. */
export const STACK = 65536;

export interface PlacedCall {
  /** Guest memory, then the stack, then the caller's stack words at sp. */
  readonly bytes: Uint8Array;
  readonly registers: Int32Array;
  readonly fregisters: Uint32Array;
  readonly sp: number;
  readonly results: readonly Location[] | null;
}

/**
 * The machine state of a call of `sig` with `args` (i32s, f32s as bits) from the host: x registers with the
 * interpreter's callee-saved patterns, ra = RETURN_TO_HOST and sp at the caller's stack words; arguments in their
 * registers and stack words. `fsPatterns` also gives fs0-fs11 patterns, so a caller can check them after the call.
 */
export function placeCall(
  sig: CallSignature,
  args: readonly number[],
  memory: Uint8Array,
  options: { fsPatterns?: boolean } = {},
): PlacedCall {
  const params = argumentLocations(sig.params);
  const results = sig.results ? resultLocations(sig.results) : null;
  const words = Math.max(stackOf(params), results ? stackOf(results) : 0);
  const sp = (memory.length + STACK + 15) & -16;
  const bytes = new Uint8Array(sp + ((4 * words + 15) & -16));
  bytes.set(memory);
  const view = new DataView(bytes.buffer);
  const x = new Int32Array(32),
    f = new Uint32Array(32);
  for (const r of CALLEE_SAVED_X) x[r] = 0x12340000 + r;
  if (options.fsPatterns) for (const r of CALLEE_SAVED_F) f[r] = (0x7f000000 + 0x10000 * r) >>> 0;
  x[1] = RETURN_TO_HOST;
  x[2] = sp;
  params.forEach((p, i) => {
    if (p.cls === 'stack') view.setInt32(sp + 4 * p.word, args[i] | 0, true);
    else if (p.cls === 'f') f[p.reg] = args[i] >>> 0;
    else x[p.reg] = args[i] | 0;
  });
  return { bytes, registers: x, fregisters: f, sp, results };
}

/** The result of a finished call placed by `placeCall`: a0 or fa0, or the leaves from their registers and words. */
export function readResults(
  sig: CallSignature,
  placed: PlacedCall,
  run: {
    readonly bytes: Uint8Array;
    readonly registers: ArrayLike<number>;
    readonly fregisters: ArrayLike<number>;
  },
): number | number[] {
  const after = new DataView(run.bytes.buffer, run.bytes.byteOffset);
  const read = (l: Location) =>
    l.cls === 'stack'
      ? after.getInt32(placed.sp + 4 * l.word, true)
      : l.cls === 'f'
        ? run.fregisters[l.reg] | 0
        : run.registers[l.reg] | 0;
  if (placed.results) return placed.results.map(read);
  return isF32(sig.result) ? run.fregisters[10] | 0 : run.registers[10] | 0;
}

/** The first of fs0-fs11 whose bits differ from `placeCall`'s patterns, or -1. */
export function changedSavedF(placed: PlacedCall, fregisters: ArrayLike<number>): number {
  for (const r of CALLEE_SAVED_F) if (fregisters[r] >>> 0 !== placed.fregisters[r]) return r;
  return -1;
}
