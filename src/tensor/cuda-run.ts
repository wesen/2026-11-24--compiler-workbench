import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { endianness, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cudaSource, selectFn } from './cuda-source.js';
import type { TixProgram } from './index.js';
import { size, type Inputs } from './evaluate.js';
import { plain, value, type Fn } from './model.js';

export type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;
export interface CudaResult {
  shape: number[];
  data: Float32Array;
  gpuMs: number;
}
const exec = promisify(execFile);
const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

// TXI1|count:u32| (ordinal:u32| (rank:u32|dims:i64[rank]|data:f32[product])*params)*count
export function encodeBatch(fn: Fn, batch: readonly Inputs[]) {
  if (endianness() !== 'LE') throw Error('Tix CUDA requires a little-endian host');
  const chunks: Buffer[] = [Buffer.from('TXI1'), u32(batch.length)];
  const shapes = batch.map((inputs, i) => {
    const dims = new Map<string, number>();
    chunks.push(u32(i));
    if (Object.keys(inputs).length !== fn.params.length) throw Error('Wrong parameter count');
    for (const p of fn.params) {
      if (!Object.hasOwn(inputs, p.name)) throw Error('Missing input ' + p.name);
      const { data, shape } = inputs[p.name];
      if (
        !(data instanceof Float32Array) ||
        shape.length !== p.shape.length ||
        shape.some(x => x < 0 || !Number.isSafeInteger(x)) ||
        size(shape) !== data.length ||
        !data.every(Number.isFinite)
      )
        throw Error('Invalid input ' + p.name);
      const ds = Buffer.alloc(8 * shape.length);
      p.shape.forEach((d, j) => {
        const n = plain(d);
        if (n) dims.set(n, shape[j]);
        ds.writeBigInt64LE(BigInt(shape[j]), 8 * j);
      });
      chunks.push(u32(shape.length), ds, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
    for (const p of fn.params)
      if (p.shape.some((d, j) => value(d, dims) !== inputs[p.name].shape[j]))
        throw Error('Inconsistent shape ' + p.name);
    const shape = fn.shape.map(d => value(d, dims));
    if (shape.some(x => !Number.isSafeInteger(x) || x < 0) || !Number.isSafeInteger(size(shape)))
      throw Error('Invalid result shape');
    return shape;
  });
  return { bytes: Buffer.concat(chunks), shapes };
}
// TXO1|count:u32| (ordinal:u32|rank:u32|dims:i64[rank]|data:f32[product]|gpuMs:f32)*count
export function decodeBatch(bytes: Buffer, shapes: number[][]): CudaResult[] {
  let pos = 4;
  const readU32 = () => {
    const n = bytes.readUInt32LE(pos);
    pos += 4;
    return n;
  };
  if (bytes.toString('ascii', 0, 4) !== 'TXO1' || readU32() !== shapes.length)
    throw Error('Invalid result header/count');
  const results = shapes.map((shape, i) => {
    if (readU32() !== i || readU32() !== shape.length) throw Error('Invalid result ordinal/rank');
    for (const n of shape) {
      if (bytes.readBigInt64LE(pos) !== BigInt(n)) throw Error('Invalid result shape');
      pos += 8;
    }
    const length = size(shape) * 4;
    if (bytes.length - pos < length + 4) throw Error('Truncated result');
    const data = new Float32Array(length / 4);
    Buffer.from(data.buffer).set(bytes.subarray(pos, pos + length));
    pos += length;
    const gpuMs = bytes.readFloatLE(pos);
    pos += 4;
    if (!Number.isFinite(gpuMs) || gpuMs < 0) throw Error('Invalid event time');
    return { shape, data, gpuMs };
  });
  if (pos !== bytes.length) throw Error('Extra result bytes');
  return results;
}
export function profile(host?: string, nvcc?: string) {
  return {
    host: host ?? process.env.CUDA_REMOTE_HOST ?? 'manuel@bling',
    nvcc: nvcc ?? process.env.CUDA_REMOTE_NVCC ?? '/usr/local/cuda-13.0/bin/nvcc',
    arch: 'sm_121',
    flags: ['-O3', '-arch=sm_121'],
  };
}
export async function runBatch(
  fn: Fn,
  source: string,
  batch: readonly Inputs[],
  options: { host?: string; nvcc?: string; timed?: boolean } = {},
): Promise<CudaResult[]> {
  const { bytes, shapes } = encodeBatch(fn, batch),
    target = profile(options.host, options.nvcc);
  const dir = await mkdtemp(join(tmpdir(), 'tix-cuda-'));
  try {
    await Promise.all([writeFile(join(dir, 'main.cu'), source), writeFile(join(dir, 'input.bin'), bytes)]);
    const args = [
      tool,
      dir,
      '--host',
      target.host,
      '--arch',
      target.arch,
      ...(options.timed ? ['--timed'] : []),
    ];
    let stdout: string;
    try {
      ({ stdout } = await exec(process.execPath, args, {
        encoding: 'utf8',
        maxBuffer: 4 << 20,
        env: { ...process.env, CUDA_REMOTE_NVCC: target.nvcc },
      }));
    } catch (error) {
      const e = error as Error & { stdout?: string };
      throw Error('CUDA remote: ' + (e.stdout?.trim() || e.message));
    }
    const result = JSON.parse(stdout);
    if (result.exit !== 0 || !result.outputs?.includes('result.bin'))
      throw Error('Missing CUDA result: ' + result.stderr);
    return decodeBatch(await readFile(join(dir, 'out/result.bin')), shapes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: CudaInputs,
  options?: { host?: string },
): Promise<CudaResult> {
  return (await runBatch(selectFn(program.current, fn), cudaSource(program, fn), [inputs], options))[0];
}
