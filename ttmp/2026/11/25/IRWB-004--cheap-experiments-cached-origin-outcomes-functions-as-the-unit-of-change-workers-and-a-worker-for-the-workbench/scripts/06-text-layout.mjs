// IRWB-004: where each table of Candela r0 sits in its revision text (as a percentage of the text), and how many
// records each table has. Shows how early a pass's first changed byte is (rev and counters change with every pass).
//   node --max-old-space-size=8192 …/06-text-layout.mjs
const root = process.env.IRWB_ROOT ?? new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { candelaSource, MAX_SOURCE } = await import(root + 'tools/candela.mjs');
const { ingest } = await import(root + 'dist/typed/lift.js');
const { canonical } = await import(root + 'dist/framework/core/data.js');
const v = ingest('candela', candelaSource(), { tape: true, maxSourceLength: MAX_SOURCE }).toNative();
const text = canonical({ kind: 'typed.blocks', schemaVersion: '1', value: v });
const out = { chars: text.length, startsAtPercent: {} };
for (const k of ['blocks', 'counters', 'fnOrder', 'fns', 'formatVersion', 'frontEnd', 'ops', 'program', 'rev', 'stmts', 'values'])
  out.startsAtPercent[k] = +((text.indexOf(`"${k}":`) / text.length) * 100).toFixed(2);
out.records = Object.fromEntries(['fns', 'blocks', 'stmts', 'values', 'ops'].map(k => [k, Object.keys(v[k]).length]));
console.log(JSON.stringify(out));
