import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { endianness, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sha256Parts } from '../framework/core/sha256.js';
import { inputMagic, resultMagic } from './cuda-source.js';
import { plain, value, type Fn } from './model.js';

export type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;
export interface CudaResult {
  shape: number[];
  data: Float32Array;
  gpuMs: number;
}
const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
const run = promisify(execFile);
const littleEndian = endianness() === 'LE';
const defaultNvcc = '/usr/local/cuda-13.0/bin/nvcc';
const arch = 'sm_121';

export function engine(host = process.env.CUDA_REMOTE_HOST ?? 'manuel@bling') {
  const nvcc = process.env.CUDA_REMOTE_NVCC ?? defaultNvcc;
  return {
    host,
    nvcc,
    key: sha256Parts([
      JSON.stringify({ host, nvcc, arch, flags: '-O3', inputMagic, resultMagic }),
      readFileSync(tool, 'utf8'),
    ]),
  };
}
function elements(shape: number[]) {
  if (shape.some(d => !Number.isSafeInteger(d) || d < 0)) throw Error('Invalid tensor extent');
  const size = shape.includes(0) ? 0 : shape.reduce((n, d) => n * d, 1);
  if (!Number.isSafeInteger(size)) throw Error('Invalid tensor length');
  return size;
}
function bind(fn: Fn, inputs: CudaInputs) {
  const env = new Map<string, number>();
  if (Object.keys(inputs).length !== fn.params.length) throw Error('Input names do not match function');
  for (const p of fn.params) {
    if (!Object.hasOwn(inputs, p.name)) throw Error(`Missing input ${p.name}`);
    const { shape, data } = inputs[p.name];
    if (shape.length !== p.shape.length || !(data instanceof Float32Array) || data.length !== elements(shape))
      throw Error(`Invalid shape or data for ${p.name}`);
    if (!data.every(Number.isFinite)) throw Error(`Nonfinite input ${p.name}`);
    p.shape.forEach((a, i) => {
      const n = plain(a);
      if (!n) return;
      if (env.has(n) && env.get(n) !== shape[i]) throw Error(`Inconsistent binding for ${n}`);
      env.set(n, shape[i]);
    });
  }
  for (const p of fn.params)
    if (p.shape.some((a, i) => value(a, env) !== inputs[p.name].shape[i]))
      throw Error(`Inconsistent shape for ${p.name}`);
  const shape = fn.shape.map(a => value(a, env));
  elements(shape);
  return shape;
}

export function encodeCudaBatch(fn: Fn, batch: readonly CudaInputs[]) {
  const shapes = batch.map(inputs => bind(fn, inputs));
  const buffers = batch.flatMap(inputs => {
    const dims = Buffer.alloc(8 * fn.params.reduce((n, p) => n + p.shape.length, 0));
    let at = 0;
    for (const p of fn.params)
      for (const d of inputs[p.name].shape) {
        dims.writeBigInt64LE(BigInt(d), at);
        at += 8;
      }
    return [
      dims,
      ...fn.params.map(p => {
        const data = inputs[p.name].data;
        const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        return littleEndian ? bytes : Buffer.from(bytes).swap32();
      }),
    ];
  });
  const header = Buffer.alloc(8);
  header.writeUInt32LE(inputMagic, 0);
  header.writeUInt32LE(batch.length, 4);
  return { bytes: Buffer.concat([header, ...buffers]), shapes };
}

export function decodeCudaBatch(bytes: Buffer, expected: readonly number[][], repeats: number) {
  let at = 0;
  function take(n: number) {
    if (n > bytes.length - at) throw Error('Incomplete CUDA result');
    const chunk = bytes.subarray(at, at + n);
    at += n;
    return chunk;
  }
  if (take(4).readUInt32LE(0) !== resultMagic || take(4).readUInt32LE(0) !== expected.length)
    throw Error('CUDA result does not match batch ABI/count');
  const cases = expected.map(want => {
    if (take(4).readUInt32LE(0) !== want.length) throw Error('CUDA result rank differs');
    const shape = want.map(d => {
      if (take(8).readBigInt64LE(0) !== BigInt(d)) throw Error('CUDA result shape differs');
      return d;
    });
    if (take(4).readUInt32LE(0) !== repeats) throw Error('Wrong number of CUDA timings');
    const times = Array.from({ length: repeats }, () => take(4).readFloatLE(0));
    if (times.some(t => !Number.isFinite(t) || t < 0)) throw Error('Invalid CUDA event time');
    const raw = take(4 * elements(shape));
    const data = new Float32Array(raw.length / 4);
    const native = Buffer.from(data.buffer);
    raw.copy(native);
    if (!littleEndian) native.swap32();
    return { shape, data, times };
  });
  if (at !== bytes.length) throw Error('Trailing bytes in CUDA result');
  return cases;
}

interface ToolReport {
  host: string;
  hash: string;
  compiled: boolean;
  exit: number;
  stdout: string;
  stderr: string;
  outputs: string[];
}
export async function runCudaBatch(
  fn: Fn,
  source: string,
  batch: readonly CudaInputs[],
  profile: ReturnType<typeof engine>,
  benchmark = false,
): Promise<{ report: ToolReport; cases: ReturnType<typeof decodeCudaBatch> }> {
  const { bytes, shapes } = encodeCudaBatch(fn, batch);
  const dir = await mkdtemp(join(tmpdir(), 'tix-cuda-'));
  try {
    await Promise.all([writeFile(join(dir, 'main.cu'), source), writeFile(join(dir, 'inputs.bin'), bytes)]);
    const args = [tool, dir, '--cache-main', '--host', profile.host, '--arch', arch];
    if (benchmark) args.push('--timed', '--', '--benchmark');
    const { stdout } = await run(process.execPath, args, {
      env: { ...process.env, CUDA_REMOTE_NVCC: profile.nvcc },
      maxBuffer: 8 << 20,
    }).catch((error: { message: string; stdout?: string; stderr?: string }) => {
      let details: string | undefined;
      try {
        details = (JSON.parse(error.stdout ?? '') as ToolReport).stderr.trim();
      } catch {
        /* See stderr. */
      }
      throw Error(`CUDA tool failed: ${details || error.stderr?.trim() || error.message}`);
    });
    const report = JSON.parse(stdout) as ToolReport;
    if (report.exit !== 0 || !report.outputs.includes('result.bin'))
      throw Error('CUDA tool did not return a result');
    const cases = decodeCudaBatch(await readFile(join(dir, 'out/result.bin')), shapes, benchmark ? 5 : 1);
    return { report, cases };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
