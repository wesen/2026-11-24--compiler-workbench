// The Candela gallery program (corpus/candela-gallery, copied from ds-js-os b19062b): its source, lifted from the tape.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const candelaDir = fileURLToPath(new URL('../corpus/candela-gallery/', import.meta.url));
export const candelaManifest = JSON.parse(readFileSync(join(candelaDir, 'VENDOR.json'), 'utf8'));
export const MAX_SOURCE = 1 << 22;

/**
 * Inputs for functions that take Candela's kernel record K or a buffer: K's row buffers hold 512 f32s in [0, 4] (so
 * counts and indices read from them stay small), the scene index is one of the gallery's 18, and the per-hit fields
 * are in their ranges. skyBuild (and cdlSky, which calls it) fills the 64 x 64 x 3 sky table, so their K gets one of
 * 12288 f32s. Scalar parameters keep the evaluator's default generation.
 */
const rows = n => ({ floats: [n, n], range: [0, 4] });
export const kSpec = (sky = 512) => ({
  record: {
    bU: rows(512), bO: rows(512), bL: rows(512), bB: rows(512), bS: rows(512), etab: rows(512), sky: rows(sky),
    scene: { oneOf: Array.from({ length: 18 }, (_, i) => i) },
    spectral: { bool: true }, skyOn: { bool: true },
    rngS: [1, 2147483647], gTime: [0, 1], gLam: [380, 780], gTau: [0, 1], gTri: [0, 7], gBary__x: [0, 1], gBary__y: [0, 1],
  },
});
const SKY_WRITERS = new Set(['skyBuild', 'cdlSky']);
export function candelaInputs(st) {
  const inputs = {};
  for (const f of st.fns.values()) {
    const spec = {};
    f.params.forEach((t, i) => {
      if (t === 'K') spec[f.locals[i].name] = kSpec(SKY_WRITERS.has(f.name) ? 12288 : 512);
      else if (t === 'buffer') spec[f.locals[i].name] = rows(512);
    });
    if (Object.keys(spec).length) inputs[f.name] = spec;
  }
  return inputs;
}

/** The concatenated source in app.json's order (each file ends in a newline), after checking every digest. */
export function candelaSource() {
  let source = '';
  for (const f of candelaManifest.sources) {
    const entry = candelaManifest.files.find(x => x.file === f);
    const text = readFileSync(join(candelaDir, f));
    const digest = createHash('sha256').update(text).digest('hex');
    if (!entry || digest !== entry.sha256) throw new Error(`${f}: sha256 ${digest} does not match VENDOR.json`);
    let t = text.toString('utf8');
    if (!t.endsWith('\n')) t += '\n';
    source += t;
  }
  return source;
}
