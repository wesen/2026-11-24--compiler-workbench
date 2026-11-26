import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { size } from './evaluate.js';
import { cudaSource, functionNamed } from './cuda-source.js';
import type { TixProgram } from './index.js';
import type { Fn } from './model.js';

export type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;
export interface CudaCase {
  id: number;
  inputs: CudaInputs;
}
interface Output {
  shape: number[];
  data: Float32Array;
  times: number[];
}
const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
const exec = promisify(execFile);
const version = 1;

function words(...values: number[]) {
  const buffer = Buffer.alloc(4 * values.length);
  values.forEach((v, i) => buffer.writeUInt32LE(v, 4 * i));
  return buffer;
}
export function encodeCases(fn: Fn, cases: readonly CudaCase[], repeats: number): Buffer {
  const chunks: Buffer[] = [words(version, cases.length, repeats)];
  for (const { id, inputs } of cases) {
    chunks.push(words(id));
    for (const p of fn.params) {
      const { shape, data } = inputs[p.name];
      if (shape.length !== p.shape.length || size(shape) !== data.length)
        throw Error('Invalid tensor ' + p.name);
      const dims = Buffer.alloc(8 * shape.length);
      shape.forEach((n, i) => dims.writeBigUInt64LE(BigInt(n), 8 * i));
      chunks.push(dims, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  }
  return Buffer.concat(chunks);
}
export function decodeResults(bytes: Buffer, fn: Fn, cases: readonly CudaCase[], repeats: number): Output[] {
  let pos = 0;
  function u32() {
    const n = bytes.readUInt32LE(pos);
    pos += 4;
    return n;
  }
  if (u32() !== version || u32() !== cases.length || u32() !== repeats) throw Error('Bad CUDA result header');
  const results = cases.map(({ id }) => {
    if (u32() !== id || u32() !== fn.shape.length) throw Error('Unexpected CUDA result ID or rank');
    const shape = fn.shape.map(() => {
      const n = Number(bytes.readBigUInt64LE(pos));
      pos += 8;
      return n;
    });
    const times = Array.from({ length: repeats }, () => {
      const ms = bytes.readFloatLE(pos);
      pos += 4;
      if (!Number.isFinite(ms) || ms < 0) throw Error('Invalid GPU time');
      return ms;
    });
    const n = size(shape);
    if (!Number.isSafeInteger(n) || pos + 4 * n > bytes.length) throw Error('Incomplete CUDA result');
    const data = new Float32Array(n);
    new Uint8Array(data.buffer).set(bytes.subarray(pos, pos + 4 * n));
    pos += 4 * n;
    return { shape, data, times };
  });
  if (pos !== bytes.length) throw Error('Extra CUDA result bytes');
  return results;
}

export async function runBatch(
  source: string,
  fn: Fn,
  cases: readonly CudaCase[],
  repeats: 0 | 1 | 3,
  host?: string,
) {
  const payload = encodeCases(fn, cases, repeats);
  const dir = await mkdtemp(join(tmpdir(), 'tix-cuda-'));
  try {
    await writeFile(join(dir, 'main.cu'), source);
    await writeFile(join(dir, 'cases.bin'), payload);
    const args = [tool, dir];
    if (host) args.push('--host', host);
    if (repeats === 3) args.push('--timed');
    let stdout: string;
    try {
      ({ stdout } = await exec(process.execPath, args));
    } catch (e) {
      const error = e as Error & { stdout?: string };
      throw Error(error.stdout?.trim() || error.message, { cause: e });
    }
    const receipt = JSON.parse(stdout);
    if (receipt.exit !== 0 || !receipt.outputs.includes('results.bin'))
      throw Error('Missing CUDA output: ' + stdout);
    return decodeResults(await readFile(join(dir, 'out', 'results.bin')), fn, cases, repeats);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: CudaInputs,
  options?: { host?: string },
) {
  const [result] = await runBatch(
    cudaSource(program, fn),
    functionNamed(program.current.value, fn),
    [{ id: 0, inputs }],
    1,
    options?.host,
  );
  return { shape: result.shape, data: result.data, gpuMs: result.times[0] };
}
