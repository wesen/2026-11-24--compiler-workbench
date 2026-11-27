// IRWB-029-I script 04: certify the branchless minmax against the JS meaning.
// The stage-3 kernels replaced the branchy minmax helper with a totally-ordered-integer max/min.
// This probe runs the helper exactly as the lowering ships it (extracted from the emitted source)
// over ~160k f32 pairs on the GB10 — boundary words crossed with each other and with random words,
// including NaN payloads, signed zeros and infinities — and compares every non-NaN result bit for
// bit against Math.fround(Math.max/min(a, b)) on Node 24; NaN results are compared as a class.
// Run from the worktree root.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const { lowerCuda } = await import('../../../../../../dist/tensor/cuda-source.js');
const { compileTix } = await import('../../../../../../dist/tensor/index.js');

const unit = lowerCuda(
  compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i]; return y; }').current.value.functions[0],
  true,
);
const start = unit.source.indexOf('__device__ static float minmax');
const end = unit.source.indexOf('}', unit.source.indexOf('return (isnan(a)', start)) + 1;
const helper = unit.source.slice(start, end);
if (!helper.includes('0x7fc00000u')) throw Error('could not extract the emitted minmax helper');

const source = `
#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>
#include <vector>
#define CUDA(call) do { \\
  cudaError_t error = (call); \\
  if (error != cudaSuccess) { fprintf(stderr, "%s\\n", cudaGetErrorString(error)); return 1; } \\
} while (0)
using U = unsigned long long;
${helper}
__global__ void probe(const unsigned* a, const unsigned* b, unsigned* out, U n) {
  U i = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;
  if (i >= n) return;
  float x = __uint_as_float(a[i]), y = __uint_as_float(b[i]);
  out[2 * i] = __float_as_uint(minmax(x, y, true));
  out[2 * i + 1] = __float_as_uint(minmax(x, y, false));
}
int main() {
  FILE* input = fopen("inputs.bin", "rb");
  if (!input || fseek(input, 0, SEEK_END) != 0) return 2;
  const U n = ftell(input) / 8;
  std::vector<unsigned> a(n), b(n), out(2 * n);
  rewind(input);
  if (fread(a.data(), 4, n, input) != n) return 2;
  if (fread(b.data(), 4, n, input) != n) return 2;
  fclose(input);
  unsigned *da, *db, *dout;
  CUDA(cudaMalloc(&da, n * 4));
  CUDA(cudaMalloc(&db, n * 4));
  CUDA(cudaMalloc(&dout, out.size() * 4));
  CUDA(cudaMemcpy(da, a.data(), n * 4, cudaMemcpyHostToDevice));
  CUDA(cudaMemcpy(db, b.data(), n * 4, cudaMemcpyHostToDevice));
  probe<<<(n + 255) / 256, 256>>>(da, db, dout, n);
  CUDA(cudaGetLastError());
  CUDA(cudaMemcpy(out.data(), dout, out.size() * 4, cudaMemcpyDeviceToHost));
  FILE* output = fopen("out/outputs.bin", "wb");
  if (!output || fwrite(out.data(), 4, out.size(), output) != out.size()) return 2;
  return fclose(output) != 0;
}
`;

const scratch = new DataView(new ArrayBuffer(4));
const fromWord = w => (scratch.setUint32(0, w, true), scratch.getFloat32(0, true));
const word = v => (scratch.setFloat32(0, v, true), scratch.getUint32(0, true));
let state = 0x2911c0de;
const xorshift = () => {
  let x = state ^ (state << 13);
  x ^= x >>> 17;
  x = (x ^ (x << 5)) >>> 0;
  state = x;
  return x;
};
const special = [
  0x00000000, 0x80000000, // ±0
  0x7f800000, 0xff800000, // ±inf
  0x7fc00000, 0xffc00000, 0x7fffffff, 0xffffffff, // quiet and payload NaNs
  0x00000001, 0x80000001, 0x007fffff, 0x807fffff, // smallest subnormals
  0x3f800000, 0xbf800000, 0x4b000000, 0xdb000000, // 1, -1, 2^23, -2^23
];
const pairs = [];
for (const a of special) for (const b of special) pairs.push([a, b]);
for (let i = 0; i < 80000; i++) pairs.push([xorshift(), xorshift()]);
for (let i = 0; i < 80000; i++) {
  const bounded = () => {
    const w = xorshift();
    // keep most exponents ordinary so the pairs are mostly finite numbers
    return ((w & 0x80000000) | (((w >> 23) % 200) << 23) | (w & 0x7fffff)) >>> 0;
  };
  pairs.push([bounded(), bounded()]);
}

const temp = await mkdtemp(join(tmpdir(), 'irwb-tix-minmax-'));
try {
  const input = Buffer.alloc(8 * pairs.length);
  // the CUDA host reads all a-words, then all b-words
  pairs.forEach(([a, b], i) => {
    input.writeUInt32LE(a, 4 * i);
    input.writeUInt32LE(b, 4 * pairs.length + 4 * i);
  });
  await writeFile(join(temp, 'main.cu'), source);
  await writeFile(join(temp, 'inputs.bin'), input);
  const { stdout } = await promisify(execFile)(process.execPath, [
    'tools/cuda-remote.mjs',
    temp,
    '--runtime-input',
    'inputs.bin',
  ]);
  JSON.parse(stdout);
  const result = await readFile(join(temp, 'out', 'outputs.bin'));
  if (result.length !== pairs.length * 8) throw Error('unexpected probe output length');
  let wordMismatch = 0,
    nanMismatch = 0,
    first;
  const record = (i, tag, why) => {
    if (!first) first = { index: i, a: pairs[i][0].toString(16), b: pairs[i][1].toString(16), tag, why };
  };
  pairs.forEach(([x, y], i) => {
    const a = fromWord(x),
      b = fromWord(y);
    const gotMax = result.readUInt32LE(8 * i),
      gotMin = result.readUInt32LE(8 * i + 4);
    const judge = (expect, got, tag) => {
      if (expect === null) {
        const nan = (got & 0x7f800000) === 0x7f800000 && (got & 0x7fffff) !== 0;
        if (!nan) {
          record(i, tag, `expected NaN, got ${got.toString(16)}`);
          nanMismatch++;
        }
      } else if (got !== word(expect)) {
        record(i, tag, `expected ${word(expect).toString(16)}, got ${got.toString(16)}`);
        wordMismatch++;
      }
    };
    judge(Number.isNaN(Math.max(a, b)) ? null : Math.fround(Math.max(a, b)), gotMax, 'max');
    judge(Number.isNaN(Math.min(a, b)) ? null : Math.fround(Math.min(a, b)), gotMin, 'min');
  });
  console.log(
    `pairs ${pairs.length} | word mismatches ${wordMismatch} | NaN-class mismatches ${nanMismatch}`,
    first ? JSON.stringify(first) : '(all agree)',
  );
  if (wordMismatch || nanMismatch) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
