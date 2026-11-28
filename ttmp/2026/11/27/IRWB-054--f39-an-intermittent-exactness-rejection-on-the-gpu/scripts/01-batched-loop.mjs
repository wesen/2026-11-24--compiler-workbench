// IRWB-054 probe 01: run the `batched` contraction's lowering check (tests/tensor/schedule-gpu.test.mjs:35) in a
// loop and record every rejection with its counterexample. Usage: node 01-batched-loop.mjs [runs] [--verbose]
import { checkLowering, compileTix } from '../../../../../../dist/tensor/index.js';

const runs = Number(process.argv[2] ?? 10);
const verbose = process.argv.includes('--verbose');
const features = compileTix(`
  fn batched(a:f32[B,M,K], b:f32[B,K,N]):f32[B,M,N] { y[z,i,j] = sum(k) a[z,i,k] * b[z,k,j]; return y; }
`);
const started = Date.now();
let failures = 0;
for (let i = 0; i < runs; i++) {
  const t0 = Date.now();
  const verdict = await checkLowering(features, 'batched');
  if (verbose || !verdict.accepted)
    process.stdout.write(
      JSON.stringify({ run: i, ms: Date.now() - t0, ...verdict }, null, verbose ? 2 : 0) + '\n',
    );
  if (!verdict.accepted) failures++;
}
process.stdout.write(
  JSON.stringify({ runs, failures, rate: failures / runs, seconds: (Date.now() - started) / 1000 }) + '\n',
);
