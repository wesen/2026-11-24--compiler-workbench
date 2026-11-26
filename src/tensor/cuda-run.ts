import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { endianness, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cudaAbi } from './cuda-emit.js';
import { plain, type Affine, type Fn } from './model.js';

export type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;
export interface CudaResult {
  shape: number[];
  data: Float32Array;
  gpuMs: number;
}
export interface CudaTarget {
  host: string;
  nvcc: string;
}
export const cudaTarget = (host?: string): CudaTarget => ({
  host: host ?? process.env.CUDA_REMOTE_HOST ?? 'manuel@bling',
  nvcc: process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc',
});

const run = promisify(execFile);
const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
const validDim = (n: number) => Number.isSafeInteger(n) && n >= 0;
function elementCount(shape: number[]) {
  if (!shape.every(validDim)) throw Error('Invalid tensor dimensions');
  const n = shape.includes(0) ? 0 : shape.reduce((size, d) => size * d, 1);
  if (!Number.isSafeInteger(n * 4)) throw Error('Tensor size overflow');
  return n;
}
function affineDim(a: Affine, env: Map<string, number>) {
  let sum = a.constant;
  for (const [name, coefficient] of a.terms) {
    const product = coefficient * env.get(name)!;
    sum += product;
    if (!Number.isSafeInteger(product) || !Number.isSafeInteger(sum))
      throw Error('Affine dimension overflow');
  }
  return sum;
}
function frame(rank: number, bytes: Buffer, offset: number) {
  const shape: number[] = [];
  for (let i = 0; i < rank; ++i) shape.push(Number(bytes.readBigUInt64LE(offset + 8 * i)));
  return shape;
}

// Frame: u32 ABI, u32 case count, then for each case all parameter dimensions (u64) and all f32 arrays.
export function encodeCudaCases(fn: Fn, cases: readonly CudaInputs[]): Buffer {
  if (endianness() !== 'LE') throw Error('CUDA runner requires a little-endian Node host');
  if (!cases.length) throw Error('No CUDA inputs');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(cudaAbi, 0);
  header.writeUInt32LE(cases.length, 4);
  const frames: Buffer[] = [header];
  for (const inputs of cases) {
    const symbols = new Map<string, number>();
    const data: Buffer[] = [];
    const dims = Buffer.alloc(8 * fn.params.reduce((rank, p) => rank + p.shape.length, 0));
    let offset = 0;
    if (Object.keys(inputs).length !== fn.params.length) throw Error('Wrong number of Tix arguments');
    for (const p of fn.params) {
      const input = Object.hasOwn(inputs, p.name) && inputs[p.name];
      if (!input || !Array.isArray(input.shape) || input.shape.length !== p.shape.length)
        throw Error(`Missing argument or wrong rank: ${p.name}`);
      if (!(input.data instanceof Float32Array) || input.data.length !== elementCount(input.shape))
        throw Error(`Wrong data type or length: ${p.name}`);
      if (!input.data.every(Number.isFinite)) throw Error(`Nonfinite input: ${p.name}`);
      p.shape.forEach((a, i) => {
        const d = input.shape[i];
        const name = plain(a);
        if (name !== undefined) {
          if (symbols.has(name) && symbols.get(name) !== d) throw Error(`Inconsistent shape ${name}`);
          symbols.set(name, d);
        }
        dims.writeBigUInt64LE(BigInt(d), offset);
        offset += 8;
      });
      data.push(Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength));
    }
    for (const p of fn.params)
      if (!p.shape.every((a, i) => affineDim(a, symbols) === inputs[p.name].shape[i]))
        throw Error(`Inconsistent shape of ${p.name}`);
    for (const s of fn.statements) elementCount(s.shape.map(a => affineDim(a, symbols)));
    frames.push(dims, ...data);
  }
  return Buffer.concat(frames);
}

// Result frame: u32 ABI/count, then result dimensions, f64 event time and f32 words per case.
export function decodeCudaResults(bytes: Buffer, rank: number, cases: number): CudaResult[] {
  if (bytes.length < 8 || bytes.readUInt32LE(0) !== cudaAbi || bytes.readUInt32LE(4) !== cases)
    throw Error('Bad CUDA result header or case count');
  const results: CudaResult[] = [];
  let offset = 8;
  for (let i = 0; i < cases; ++i) {
    if (bytes.length - offset < 8 * rank + 8) throw Error(`Truncated CUDA result ${i}`);
    const shape = frame(rank, bytes, offset);
    offset += 8 * rank;
    const gpuMs = bytes.readDoubleLE(offset);
    offset += 8;
    if (!Number.isFinite(gpuMs) || gpuMs < 0) throw Error(`Invalid CUDA event time in result ${i}`);
    const dataBytes = 4 * elementCount(shape);
    if (dataBytes > bytes.length - offset) throw Error(`Truncated CUDA payload ${i}`);
    const storage = new ArrayBuffer(dataBytes);
    new Uint8Array(storage).set(bytes.subarray(offset, offset + dataBytes));
    results.push({ shape, gpuMs, data: new Float32Array(storage) });
    offset += dataBytes;
  }
  if (offset !== bytes.length) throw Error('Unexpected bytes after CUDA results');
  return results;
}

interface RemoteRun {
  exit: number;
  stdout: string;
  stderr: string;
  outputs: string[];
  compiled: boolean;
  hash: string;
}

export async function runCudaBatch(
  source: string,
  fn: Fn,
  cases: readonly CudaInputs[],
  target: CudaTarget,
  benchmark = false,
): Promise<{ results: CudaResult[]; remote: RemoteRun }> {
  const inputs = encodeCudaCases(fn, cases);
  const dir = await mkdtemp(join(tmpdir(), 'irwb-tix-'));
  try {
    await mkdir(join(dir, 'inputs'));
    await writeFile(join(dir, 'main.cu'), source);
    await writeFile(join(dir, 'inputs', 'cases.bin'), inputs);
    const args = [tool, dir, '--host', target.host, '--runtime-dir', 'inputs'];
    if (benchmark) args.push('--timed', '--', '--benchmark');
    let remote: RemoteRun;
    try {
      const { stdout } = await run(process.execPath, args, {
        env: { ...process.env, CUDA_REMOTE_NVCC: target.nvcc },
        maxBuffer: 4 << 20,
      });
      remote = JSON.parse(stdout);
    } catch (error) {
      const e = error as Error & { stdout?: string; stderr?: string };
      // The helper reports compiler and program errors in JSON even when its own exit is nonzero.
      let diagnostic = e.stderr?.trim();
      try {
        const failed = JSON.parse(e.stdout ?? '') as RemoteRun;
        diagnostic = failed.stderr?.trim() || failed.stdout?.trim() || `exit ${failed.exit}`;
      } catch {
        /* keep the child-process error if no structured diagnostic was emitted */
      }
      throw Error(`CUDA remote run failed: ${diagnostic || e.message}`, { cause: error });
    }
    if (remote.exit !== 0 || !remote.outputs.includes('results.bin'))
      throw Error('Missing successful CUDA result');
    const bytes = await readFile(join(dir, 'out', 'results.bin'));
    return { results: decodeCudaResults(bytes, fn.shape.length, cases.length), remote };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
