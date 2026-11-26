// One corpus project after a pipeline: per function, the variant the backend's estimate chose under the given
// options and the estimates, the block frequencies, and the code with and without the options.
//   node 06-variant-probe.mjs <project> [--pipeline O2] [--options '{"layout":"loops"}'] [--code]
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const { Program } = await import(root + 'dist/typed/program.js');
const { projectSource } = await import(root + 'dist/typed/project.js');
const { storeOf } = await import(root + 'dist/typed/ir.js');
const { blockFrequencies } = await import(root + 'dist/typed/backend/frequency.js');
const { layoutBlocks } = await import(root + 'dist/typed/backend/layout.js');
const B = await import(root + 'dist/typed/backend/index.js');
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const id = process.argv[2];
const options = JSON.parse(arg('--options', '{}'));
const p = Program.fromProject(projectSource(id, projectFiles(id)));
const pipeArg = arg('--pipeline', 'O2');
await p.pipeline(pipeArg.startsWith('[') ? JSON.parse(pipeArg) : pipeArg);
const st = storeOf(p.head.value);
const choices = B.variantChoices(p.head, options);
for (const f of st.fns.values()) {
  const fr = blockFrequencies(st, f);
  console.log(`${f.name}: ${JSON.stringify(choices[f.name])}`);
  console.log('  freq', [...fr.block].map(([b, v]) => `${b.replace(/^bb:[^.]+/, '')}=${+v.toFixed(2)}`).join(' '));
  console.log('  loops order', layoutBlocks(st, f, fr).map(b => b.replace(/^bb:[^.]+/, '')).join(' '));
}
if (process.argv.includes('--code'))
  for (const o of [{}, options]) {
    const img = B.lowerToImage(p.head, o).image;
    console.log(`--- ${JSON.stringify(o)} ${img.value.bytes} bytes`);
    console.log(img.value.insns.map(i => `  ${i.fn.padEnd(8)} ${i.sym}${i.why ? `   ; ${i.why}` : ''}`).join('\n'));
  }
