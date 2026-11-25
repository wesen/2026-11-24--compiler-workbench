/**
 * The reused upstream components, injected rather than imported: the vendored ds-js-os files are classic scripts
 * that publish globals (`typedTape`, `typedWasm`, `typedRv32Interp`, `typedRv32`). A host loads them — a `<script>`
 * in the browser, `vm.runInThisContext` in Node (tools/node-vendor.mjs) — and the domain reads them from here.
 * See vendor/ds-js-os/VENDOR.json for the pinned commit and digests.
 */
export interface Vendor {
  /** The Typed front end: lexer, parser, type checker writing the tape (and the Wasm backend). */
  typedWasm?: { compile(source: string, options?: unknown): any };
  /** The RV32IM reference interpreter, with calling-convention checks. */
  typedRv32Interp?: {
    run(code: Uint8Array, entry: string | number, args: unknown, memory: unknown, options?: unknown): any;
    Rv32Fault?: any;
  };
  /** The repository's own RV32 compiler; used only as an oracle (reference images). */
  typedRv32?: { compile(source: string, imports?: unknown, options?: unknown): any };
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
