// IRWB-030-D: benchmark helper. bench(name, { fuse, terms, chunk, threads, shapes }) runs one GPU call
// (runCudaBatch, benchmark: warm-up + median of 3 launches under --timed) with one case per shape assignment and
// returns [{ shape, gpuMs, sha }] (sha: SHA-256 of the output words, to compare plans bit for bit).
import { createHash } from 'node:crypto';
import { planFusion, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { emitCuda, termChunk, blockThreads } from '../../../../../../dist/tensor/cuda-source.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { fnName, inputs, program, sizes } from './01-programs.mjs';

export async function bench(name, { fuse = true, terms, chunk, rows, shapes = [sizes[fnName(name)]] } = {}) {
  const f = program(name).current.value.functions[0];
  const saved = [termChunk.size, blockThreads.rows];
  if (chunk) termChunk.size = chunk;
  if (rows) blockThreads.rows = rows;
  const source = emitCuda(f, fuse ? planFusion(f, { terms }) : unfusedPlan(f));
  [termChunk.size, blockThreads.rows] = saved;
  const cases = shapes.map(s => inputs(name, s));
  const results = await runCudaBatch(source, f, cases, { benchmark: true });
  return results.map((r, i) => ({
    shape: shapes[i],
    gpuMs: r.gpuMs,
    sha: createHash('sha256').update(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength)).digest('hex').slice(0, 16),
  }));
}
export const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
