// IRWB-010: the guide's phase-ordering example, measured. `(x * 2) * 3` under O2 (simplify turns the inner product
// into a shift first, and no rule then combines the constants) against `x * 6` and against `(x << 2) + (x << 1)`,
// each lowered with the default backend options: the O2 tree, the machine code of the function, its length.
//   node scripts/04-phase-order-example.mjs
const root = new URL('../../../../../../', import.meta.url).pathname;
const { installVendor } = await import(root + 'tools/node-vendor.mjs');
await installVendor();
const { Program } = await import(root + 'dist/typed/program.js');
const { lowerToImage } = await import(root + 'dist/typed/backend/index.js');

const variants = {
  nested: 'function f(x: i32): i32 {\n    return (x * 2) * 3;\n}\n',
  folded: 'function f(x: i32): i32 {\n    return x * 6;\n}\n',
  shifts: 'function f(x: i32): i32 {\n    return (x << 2) + (x << 1);\n}\n',
  // f32: a product by the constant 2.0 against x + x; noise3's smoothing factor; noise3's interpolation
  f32Times2: 'function f(x: f32): f32 {\n    return x * 2.0;\n}\n',
  f32PlusSelf: 'function f(x: f32): f32 {\n    return x + x;\n}\n',
  smooth: 'function f(x: f32): f32 {\n    return (x * x) * (3.0 - (2.0 * x));\n}\n',
  lerp: 'function f(a: f32, b: f32, t: f32): f32 {\n    return a + ((b - a) * t);\n}\n',
};
for (const [name, source] of Object.entries(variants)) {
  const p = new Program(name, source);
  if (p.status !== 'ok') throw new Error(`${name}: ${p.status} ${JSON.stringify(p.error)}`);
  await p.pipeline('O2');
  const lowered = lowerToImage(p.head).image;
  const image = lowered.value ?? lowered;
  const code = image.insns.filter(i => i.fn === 'f').map(i => i.text);
  console.log(`== ${name}\n${p.listing('f')}\nrevisions ${p.revisions.length - 1}; machine code (${code.length} instructions):\n  ${code.join('\n  ')}\n`);
}
