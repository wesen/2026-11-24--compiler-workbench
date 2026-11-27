const root = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a835ea9e40615941e/';
const { installVendor } = await import(root + 'tools/node-vendor.mjs'); await installVendor({});
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { listing } = await import(root + 'dist/typed/listing.js');
const st = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE });
console.log(listing(st, 'oRow'));
const size = n => { const f = st.fn(n); return f.blocks.reduce((a, b) => a + b.stmts.length, 0); };
console.log(['oRow','hitObj','xfP','finishHit','traceAll','traceScene','tracePath','renderPixel','evalMaterial','s0_evalMaterial','s0_mat_0','neeAt','lRow','sampleLight','hitAABB'].map(n => `${n} ${size(n)}`).join(', '));
