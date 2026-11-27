// Run from the worktree root after `npm run build` and after scripts/04-gemm-cost has run.
//
// The prototype SGEMM in 04-gemm-cost is only evidence for a compiler claim if it computes *Tix's*
// matrix multiply, word for word. This reads the dumped A, B and C from the GB10, evaluates the same Tix
// program with the Stage 1 f32 interpreter, and compares 32-bit words.
//
// The [Tix] program is the corpus matmul, unchanged.
//
// Usage: node <ticket>/scripts/05-check-gemm-bits.mjs
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { compileTix, runTix } = await import(new URL('dist/tensor/index.js', root));
const dir = new URL(
  'ttmp/2026/11/26/IRWB-023-G--what-compiler-work-would-make-tix-best-in-class-speed-at-a-fixed-f32-meaning/scripts/04-gemm-cost/out/',
  root,
);
const read = async name => {
  const bytes = new Uint8Array(await readFile(new URL(name, dir)));
  const n = new DataView(bytes.buffer).getInt32(0, true);
  return { n, data: new Float32Array(bytes.buffer, 4, n * n) };
};
const a = await read('gemm128-A.bin');
const b = await read('gemm128-B.bin');
const c = await read('gemm128-C.bin');
const n = a.n;
const source = `fn matmul(a: f32[M,K], b: f32[K,N]): f32[M,N] {
  y[i,j] = sum(k) a[i,k] * b[k,j];
  return y;
}`;
const program = compileTix(source);
const started = process.hrtime.bigint();
const reference = runTix(
  program,
  'matmul',
  { a: { shape: [n, n], data: a.data }, b: { shape: [n, n], data: b.data } },
  { precision: 'f32' },
);
const ms = Number(process.hrtime.bigint() - started) / 1e6;
const words = x => new Uint32Array(x.data.buffer, x.data.byteOffset, x.data.length);
const ref = words(reference);
const got = words(c);
let first = -1;
for (let i = 0; i < ref.length; i++) if (ref[i] !== got[i] && first < 0) first = i;
const differing = ref.reduce((k, w, i) => k + (w !== got[i] ? 1 : 0), 0);
const maxUlp = ref.reduce((m, w, i) => Math.max(m, Math.abs(w - got[i])), 0);
console.log({
  n,
  elements: ref.length,
  'Tix f32 interpreter ms': Math.round(ms),
  'words differing': differing,
  'max ULP distance': maxUlp,
  firstMismatch: first < 0 ? null : { index: first, tix: ref[first].toString(16), gpu: got[first].toString(16) },
});
console.log(
  differing === 0
    ? 'The tiled, register-blocked, shared-memory kernel is bit-identical to the Tix f32 meaning.'
    : 'BIT MISMATCH: the schedule change was not neutral, or the two programs differ.',
);
