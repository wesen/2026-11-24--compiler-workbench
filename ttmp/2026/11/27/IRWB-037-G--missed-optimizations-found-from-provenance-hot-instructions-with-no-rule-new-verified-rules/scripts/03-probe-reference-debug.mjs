// Probe: what does the reference compiler return besides the image? Is there a pc -> source position map?
import { projectFiles } from '../../../../../../tools/corpus.mjs';
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const { projectSource } = await import('../../../../../../dist/typed/project.js');
const ps = projectSource('regex-nfa', projectFiles('regex-nfa'));
const r = globalThis.typedRv32.compile(ps.source, [], undefined);
for (const [k, v] of Object.entries(r))
  console.log(k, Array.isArray(v) ? `array(${v.length}) ${JSON.stringify(v[0])?.slice(0, 200)}` : v instanceof Uint8Array ? `bytes(${v.length})` : JSON.stringify(v)?.slice(0, 300));
console.log(Object.keys(globalThis.typedRv32));
