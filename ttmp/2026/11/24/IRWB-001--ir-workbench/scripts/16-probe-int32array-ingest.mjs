import { installVendor } from '/home/manuel/code/wesen/2026-11-24--compiler-workbench/tools/node-vendor.mjs';
await installVendor();
import { ingest } from '/home/manuel/code/wesen/2026-11-24--compiler-workbench/dist/typed/lift.js';
const src = `function f(n: i32): i32 {
  const a = new Int32Array(16);
  let s = 0;
  for (let i = 0; i < 16; i = i + 1) { a[i] = i * n; }
  for (let i = 0; i < 16; i = i + 1) { s = s + a[i]; }
  return s;
}`;
for (const opts of [undefined, { tape: true }]) {
  try { const st = ingest('probe', src, opts); console.log(JSON.stringify(opts ?? 'default'), 'OK', Object.keys(st.toNative?.().functions ?? {}).length || 'ingested'); }
  catch (e) { console.log(JSON.stringify(opts ?? 'default'), 'FAIL:', String(e.message).slice(0, 120)); }
}
