// Check inputs for the Candela program's functions (see candela.ts); a module of its own so projects.ts can
// derive them for a project whose project.json says "inputsFrom": "candela".
import type { Store } from '../typed/model.js';

/**
 * Check inputs for functions that take Candela's kernel record K or a buffer: K's row buffers hold 512 f32s in
 * [0, 4], the scene index is one of the 18, the per-hit fields are in range; skyBuild and cdlSky fill the 64 x 64 x 3
 * sky table, so their K gets 12288 f32s. A port of tools/candela.mjs candelaInputs.
 */
export function candelaInputs(st: Store): Record<string, Record<string, unknown>> {
  const rows = (n: number) => ({ floats: [n, n], range: [0, 4] });
  const kSpec = (sky: number) => ({
    record: {
      bU: rows(512),
      bO: rows(512),
      bL: rows(512),
      bB: rows(512),
      bS: rows(512),
      etab: rows(512),
      sky: rows(sky),
      scene: { oneOf: Array.from({ length: 18 }, (_, i) => i) },
      spectral: { bool: true },
      skyOn: { bool: true },
      rngS: [1, 2147483647],
      gTime: [0, 1],
      gLam: [380, 780],
      gTau: [0, 1],
      gTri: [0, 7],
      gBary__x: [0, 1],
      gBary__y: [0, 1],
    },
  });
  const skyWriters = new Set(['skyBuild', 'cdlSky']);
  const inputs: Record<string, Record<string, unknown>> = {};
  for (const f of st.fns.values()) {
    const spec: Record<string, unknown> = {};
    f.params.forEach((t, i) => {
      if (t === 'K') spec[f.locals[i].name] = kSpec(skyWriters.has(f.name) ? 12288 : 512);
      else if (t === 'buffer') spec[f.locals[i].name] = rows(512);
    });
    if (Object.keys(spec).length) inputs[f.name] = spec;
  }
  return inputs;
}
