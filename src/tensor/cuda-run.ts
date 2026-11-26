import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { endianness, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cudaProtocol } from './cuda-source.js';
import { plain, value, type Fn } from './model.js';

export type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;
export type CudaOptions = { host?: string };
export type CudaResult = { shape: number[]; data: Float32Array; gpuMs: number };
export type CudaCase = { id: number; inputs: CudaInputs };
export type CudaRecord = CudaResult & { times: number[] };

export function cudaEngine(options?: CudaOptions) {
  return {
    host: options?.host ?? process.env.CUDA_REMOTE_HOST ?? 'manuel@bling',
    nvcc: process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc',
    arch: 'sm_121',
    flags: '-O3',
    protocol: cudaProtocol,
  };
}
export type CudaEngine = ReturnType<typeof cudaEngine>;

function elements(shape: number[]): number {
  if (shape.some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('Invalid CUDA tensor extent');
  if (shape.includes(0)) return 0;
  const n = shape.reduce((a, b) => a * b, 1);
  if (!Number.isSafeInteger(n * 4)) throw Error('Invalid CUDA tensor length');
  return n;
}

export function encodeCases(fn: Fn, cases: readonly CudaCase[]): Buffer {
  if (endianness() !== 'LE') throw Error('Tix CUDA needs a little-endian host');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(cudaProtocol, 0);
  header.writeUInt32LE(cases.length, 4);
  const chunks: Buffer[] = [header];
  for (const { id, inputs } of cases) {
    if (Object.keys(inputs).length !== fn.params.length) throw Error('Wrong CUDA input names');
    const env = new Map<string, number>();
    const wordBlock = Buffer.alloc(4 + 8 * fn.params.reduce((n, p) => n + p.shape.length, 0));
    wordBlock.writeUInt32LE(id);
    let offset = 4;
    const data = fn.params.map(p => {
      if (!Object.hasOwn(inputs, p.name)) throw Error(`Missing CUDA input ${p.name}`);
      const t = inputs[p.name];
      if (t.shape.length !== p.shape.length) throw Error(`Wrong rank for ${p.name}`);
      if (!(t.data instanceof Float32Array) || elements(t.shape) !== t.data.length)
        throw Error(`Wrong f32 storage for ${p.name}`);
      if (!t.data.every(Number.isFinite)) throw Error(`Nonfinite input ${p.name}`);
      p.shape.forEach((dim, j) => {
        const n = plain(dim);
        if (n !== undefined) {
          if (env.has(n) && env.get(n) !== t.shape[j]) throw Error(`Inconsistent binding for ${n}`);
          env.set(n, t.shape[j]);
        }
        wordBlock.writeBigInt64LE(BigInt(t.shape[j]), offset);
        offset += 8;
      });
      return Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength);
    });
    for (const p of fn.params)
      if (p.shape.some((dim, j) => value(dim, env) !== inputs[p.name].shape[j]))
        throw Error(`Inconsistent CUDA input extent for ${p.name}`);
    chunks.push(wordBlock, ...data);
  }
  return Buffer.concat(chunks);
}

export function decodeResults(
  bytes: Buffer,
  rank: number,
  ids: readonly number[],
  reps: 1 | 3,
): CudaRecord[] {
  let offset = 0;
  function take(n: number) {
    if (n > bytes.length - offset) throw Error('Truncated CUDA result bundle');
    offset += n;
    return offset - n;
  }
  if (bytes.readUInt32LE(take(4)) !== cudaProtocol) throw Error('Wrong CUDA result protocol');
  if (bytes.readUInt32LE(take(4)) !== ids.length) throw Error('Wrong CUDA result count');
  const results = ids.map(id => {
    if (bytes.readUInt32LE(take(4)) !== id) throw Error(`Wrong CUDA result case id (expected ${id})`);
    if (bytes.readUInt32LE(take(4)) !== reps) throw Error('Wrong CUDA timing count');
    const times = Array.from({ length: reps }, () => bytes.readFloatLE(take(4)));
    if (times.some(t => !Number.isFinite(t) || t < 0)) throw Error('Invalid CUDA kernel time');
    const shape = Array.from({ length: rank }, () => Number(bytes.readBigInt64LE(take(8))));
    const n = elements(shape);
    const start = take(4 * n);
    const data = new Float32Array(n);
    new Uint8Array(data.buffer).set(bytes.subarray(start, offset));
    return { shape, data, gpuMs: [...times].sort((a, b) => a - b)[reps >> 1], times };
  });
  if (offset !== bytes.length) throw Error('Unexpected trailing CUDA result bytes');
  return results;
}

const remoteTool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
const exec = promisify(execFile);

export async function runCudaBatch(
  source: string,
  fn: Fn,
  cases: readonly CudaCase[],
  engine: CudaEngine,
  benchmark = false,
) {
  const bundle = encodeCases(fn, cases);
  const dir = await mkdtemp(join(tmpdir(), 'tix-cuda-'));
  try {
    await Promise.all([writeFile(join(dir, 'main.cu'), source), writeFile(join(dir, 'cases.bin'), bundle)]);
    const args = [remoteTool, dir, '--standalone', '--host', engine.host, '--arch', engine.arch];
    if (benchmark) args.push('--timed', '--', '--benchmark');
    let stdout: string;
    try {
      ({ stdout } = await exec(process.execPath, args, {
        env: { ...process.env, CUDA_REMOTE_NVCC: engine.nvcc },
        timeout: 120_000,
      }));
    } catch (error) {
      const failure = error as Error & { killed?: boolean; stdout?: string; stderr?: string };
      if (failure.killed) throw Error('CUDA remote tool timed out after 120 seconds', { cause: error });
      throw Error(
        `CUDA remote tool failed: ${failure.stdout?.trim() || failure.stderr?.trim() || failure.message}`,
        {
          cause: error,
        },
      );
    }
    const remote = JSON.parse(stdout) as {
      exit: number;
      compiled: boolean;
      stdout: string;
      outputs: string[];
    };
    if (remote.exit !== 0 || !remote.outputs.includes('results.bin'))
      throw Error('Missing CUDA result bundle');
    const bytes = await readFile(join(dir, 'out', 'results.bin'));
    return {
      remote,
      records: decodeResults(
        bytes,
        fn.shape.length,
        cases.map(c => c.id),
        benchmark ? 3 : 1,
      ),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
