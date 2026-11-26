import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir, endianness } from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TixProgram } from './index.js';
import { emitCuda, named, inputMagic, outputMagic } from './cuda-source.js';
import { plain, type Affine, type Fn } from './model.js';

export type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;
export interface Invocation {
  id: number;
  inputs: CudaInputs;
}
const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
const exec = promisify(execFile);
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const dim64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
function valid(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid concrete dimension/size');
  return n;
}
const numel = (s: number[]) => s.reduce((n, d) => valid(n * valid(d)), 1);
function bound(a: Affine, env: Map<string, number>) {
  let v = a.constant;
  for (const [n, k] of a.terms) {
    const term = env.get(n)! * k;
    v += term;
    if (!Number.isSafeInteger(term) || !Number.isSafeInteger(v)) throw Error('Shape arithmetic overflow');
  }
  return valid(v);
}
export function encodeBatch(fn: Fn, cases: readonly Invocation[]) {
  if (endianness() !== 'LE') throw Error('Tix CUDA requires little-endian f32 storage');
  const chunks: Buffer[] = [u32(inputMagic), u32(1), u32(cases.length)];
  const expected = cases.map(({ inputs, id }) => {
    chunks.push(u32(id));
    const env = new Map<string, number>();
    if (Object.keys(inputs).length !== fn.params.length) throw Error('Input parameter mismatch');
    for (const p of fn.params) {
      const t = Object.hasOwn(inputs, p.name) ? inputs[p.name] : undefined;
      if (
        !t ||
        t.shape.length !== p.shape.length ||
        !(t.data instanceof Float32Array) ||
        numel(t.shape) !== t.data.length
      )
        throw Error('Invalid input ' + p.name);
      if (!t.data.every(Number.isFinite)) throw Error('Nonfinite input ' + p.name);
      chunks.push(
        u32(t.shape.length),
        ...t.shape.map(dim64),
        Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength),
      );
      p.shape.forEach((d, j) => {
        const n = plain(d);
        if (n) env.set(n, t.shape[j]);
      });
    }
    for (const p of fn.params)
      if (p.shape.some((a, j) => bound(a, env) !== inputs[p.name].shape[j]))
        throw Error('Inconsistent input shape ' + p.name);
    for (const s of fn.statements) numel(s.shape.map(a => bound(a, env)));
    return { id, shape: fn.shape.map(a => bound(a, env)) };
  });
  return { bytes: Buffer.concat(chunks), expected };
}
export function decodeBatch(b: Buffer, expected: readonly { id: number; shape: number[] }[]) {
  let pos = 0;
  const take = (n: number) => {
    const i = pos;
    pos += n;
    if (pos > b.length) throw Error('Short GPU output');
    return i;
  };
  const u = () => b.readUInt32LE(take(4));
  if (u() !== outputMagic || u() !== 1 || u() !== expected.length) throw Error('Invalid GPU output header');
  const results = expected.map(({ id, shape }) => {
    if (u() !== id || u() !== shape.length || shape.some(d => BigInt(d) !== b.readBigUInt64LE(take(8))))
      throw Error('Wrong GPU output ID or shape');
    const gpuMs = b.readDoubleLE(take(8));
    if (!Number.isFinite(gpuMs) || gpuMs < 0) throw Error('Invalid GPU event time');
    const n = numel(shape),
      offset = take(n * 4),
      data = new Float32Array(n);
    new Uint8Array(data.buffer).set(b.subarray(offset, offset + 4 * n));
    return { shape, data, gpuMs };
  });
  if (pos !== b.length) throw Error('Trailing GPU output');
  return results;
}
export async function runBatch(
  unit: string,
  fn: Fn,
  cases: readonly Invocation[],
  host?: string,
  benchmark = false,
  nvcc?: string,
) {
  const { bytes, expected } = encodeBatch(fn, cases),
    dir = await mkdtemp(join(tmpdir(), 'irwb-tix-'));
  try {
    await writeFile(join(dir, 'main.cu'), unit);
    await writeFile(join(dir, 'in.bin'), bytes);
    const args = [
      tool,
      dir,
      ...(host ? ['--host', host] : []),
      ...(benchmark ? ['--timed', '--', '--benchmark'] : []),
    ];
    const { stdout } = await exec(process.execPath, args, {
      maxBuffer: 4 * 1024 * 1024,
      env: nvcc ? { ...process.env, CUDA_REMOTE_NVCC: nvcc } : process.env,
    }).catch(e => {
      throw Error(`CUDA remote: ${e.stdout || e.stderr || e.message}`);
    });
    const job = JSON.parse(stdout);
    if (job.exit !== 0 || !job.outputs.includes('result.bin'))
      throw Error(`Missing CUDA result: ${job.stderr}`);
    return {
      results: decodeBatch(await readFile(join(dir, 'out', 'result.bin')), expected),
      stdout: job.stdout as string,
    };
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
  const f = named(program.current.value, fn);
  return (await runBatch(emitCuda(f), f, [{ id: 0, inputs }], options?.host)).results[0];
}
