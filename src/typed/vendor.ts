/**
 * The reused upstream components, injected rather than imported: the vendored ds-js-os files are classic scripts
 * that publish globals (`typedTape`, `typedWasm`, `typedRv32Interp`, `typedRv32`). A host loads them — a `<script>`
 * in the browser, `vm.runInThisContext` in Node (tools/node-vendor.mjs) — and the domain reads them from here.
 * See vendor/ds-js-os/VENDOR.json for the pinned commit and digests.
 */
/** One row of tape.js's operation table: opcode, names, operand formats, popped and pushed value types. */
export interface TapeRow {
  readonly code: number;
  readonly constant: string;
  readonly name: string;
  readonly operands: readonly string[];
  /** Value types popped (125 = F32, 127 = I32, 0 = the type of the local, callee or function); null for a call. */
  readonly pop: readonly number[] | null;
  readonly push: readonly number[];
  readonly effects: number;
}
/** One decoded tape operation (tape.js `decode`). */
export interface TapeOp {
  readonly ordinal: number;
  readonly offset: number;
  readonly length: number;
  readonly op: string;
  readonly opcode: number;
  readonly operands: number[];
}
export interface Vendor {
  /** The tape: the front end's operation table and its decoder. */
  typedTape?: {
    readonly rows: readonly TapeRow[];
    readonly I32: number;
    readonly F32: number;
    readonly VOID: number;
    row(code: number): TapeRow | undefined;
    decode(tape: ArrayLike<number>): TapeOp[];
  };
  /** The Typed front end: lexer, parser, type checker writing the tape (and the Wasm backend). */
  typedWasm?: {
    compile(source: string, options?: unknown): any;
    compileFunctions(
      source: string,
      functionBase: number,
      imported: unknown[],
      maxSourceLength: number,
      unused: undefined,
      onFunction?: (fn: any) => void,
      onSignatures?: (fns: any[]) => void,
      options?: unknown,
    ): any;
    recordLayouts(records: unknown): unknown;
    enumLayouts(enums: unknown): unknown;
    publicSignature(fn: unknown): unknown;
  };
  /** The RV32IM reference interpreter, with calling-convention checks. */
  typedRv32Interp?: {
    run(program: unknown, entry: string | number, args: unknown, memory: unknown, options?: unknown): any;
    Rv32Fault?: any;
  };
  /** The repository's own RV32 compiler; used only as an oracle (reference images). */
  typedRv32?: {
    compile(source: string, imports?: unknown, maxSourceLength?: number, options?: unknown): any;
  };
}

let current: Vendor = {};

export function setVendor(v: Vendor): void {
  current = { ...current, ...v };
}

export function vendor(): Vendor {
  return current;
}

export function requireVendor<K extends keyof Vendor>(key: K): NonNullable<Vendor[K]> {
  const v = current[key];
  if (!v) throw new Error(`noVendor: ${key} is not loaded (see vendor/ds-js-os/VENDOR.json and setVendor)`);
  return v as NonNullable<Vendor[K]>;
}
