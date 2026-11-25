// Load the vendored ds-js-os classic scripts into this Node realm and hand them to the typed domain.
// Verifies each file's SHA-256 against vendor/ds-js-os/VENDOR.json first, so a test never runs a modified copy.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../vendor/ds-js-os/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'VENDOR.json'), 'utf8'));
const loaded = new Set();

export function loadVendorFile(path) {
  if (loaded.has(path)) return;
  const entry = manifest.files.find(f => f.path === path);
  if (!entry) throw new Error(`${path} is not in VENDOR.json`);
  const text = readFileSync(join(root, path));
  const digest = createHash('sha256').update(text).digest('hex');
  if (digest !== entry.sha256) throw new Error(`${path}: sha256 ${digest} does not match VENDOR.json ${entry.sha256}`);
  vm.runInThisContext(text.toString('utf8'), { filename: join(root, path) });
  loaded.add(path);
}

/** Load everything and install it into the typed domain's vendor slot. */
export async function installVendor({ reference = false } = {}) {
  for (const p of ['compiler/typed/tape.js', 'compiler/typed/typed-wasm.js', 'bench/host/rv32-interp.js']) loadVendorFile(p);
  if (reference)
    for (const p of ['typed-rv32.js', 'typed-rv32-inline.js', 'typed-rv32-loops.js', 'typed-rv32-kernel.js'])
      loadVendorFile(`compiler/typed/${p}`); // the core, then the pass groups its policies install
  const { setVendor } = await import('../dist/typed/vendor.js');
  setVendor({
    typedTape: globalThis.typedTape,
    typedWasm: globalThis.typedWasm,
    typedRv32Interp: globalThis.typedRv32Interp,
    ...(reference ? { typedRv32: globalThis.typedRv32 } : {}),
  });
  return manifest;
}
