import { readFileSync } from 'node:fs';
const words = readFileSync(process.argv[2]);
if (words.length !== 16384 * 16) throw Error('incomplete observation');
for (const [j, name] of ['exp', 'log', 'sqrt', 'tanh'].entries()) {
  let different = 0, worst = 0, first;
  for (let i = 0; i < 16384; ++i) {
    const x = (i - 8192) / 1024, arg = j === 1 || j === 2 ? x + 9 : x;
    const ref = Math[name](arg), got = words.readFloatLE(16 * i + 4 * j);
    if (!Object.is(Math.fround(ref), got)) { ++different; first ??= {arg, f32: Math.fround(ref), got}; }
    worst = Math.max(worst, Math.abs(got - ref) / (2e-6 + 2e-5 * Math.abs(ref)));
  }
  console.log({name, different, worst, first});
}
