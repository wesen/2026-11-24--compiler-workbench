import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { plain, value, type Fn } from './model.js';

export type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;
export interface CudaResult {
  shape: number[];
  data: Float32Array;
  gpuMs: number;
}

const magic = Buffer.from('TIXCUDA1');
const header = magic.length + 8;

function elements(shape: number[]): number {
  if (shape.some(dim => !Number.isSafeInteger(dim) || dim < 0)) throw Error('Invalid CUDA tensor shape');
  const count = shape.includes(0) ? 0 : shape.reduce((n, dim) => n * dim, 1);
  if (!Number.isSafeInteger(count)) throw Error('CUDA tensor size exceeds the host integer range');
  return count;
}

export function encodeCudaCases(fn: Fn, cases: readonly CudaInputs[]): Buffer {
  const tensors = cases.flatMap(inputs => {
    const dims = new Map<string, number>();
    const ordered = fn.params.map(p => {
      const tensor = Object.hasOwn(inputs, p.name) ? inputs[p.name] : undefined;
      if (!tensor || tensor.shape.length !== p.shape.length || elements(tensor.shape) !== tensor.data.length)
        throw Error('Invalid input shape or length for ' + p.name);
      for (const [i, d] of p.shape.entries()) {
        const key = plain(d);
        if (key === undefined) continue;
        if (dims.has(key) && dims.get(key) !== tensor.shape[i])
          throw Error('Inconsistent input extent ' + key);
        dims.set(key, tensor.shape[i]);
      }
      return tensor;
    });
    for (const [i, p] of fn.params.entries())
      if (p.shape.some((d, j) => value(d, dims) !== ordered[i].shape[j]))
        throw Error('Inconsistent affine shape for ' + p.name);
    return ordered;
  });
  const bytes = Buffer.allocUnsafe(
    header + tensors.reduce((n, t) => n + 8 * t.shape.length + 4 * t.data.length, 0),
  );
  magic.copy(bytes);
  let offset = bytes.writeBigUInt64LE(BigInt(cases.length), magic.length);
  for (const { shape, data } of tensors) {
    for (const dim of shape) offset = bytes.writeBigUInt64LE(BigInt(dim), offset);
    const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
    for (const word of words) offset = bytes.writeUInt32LE(word, offset);
  }
  return bytes;
}

export function decodeCudaCases(bytes: Buffer, count: number, rank: number): CudaResult[] {
  if (bytes.length < header || !bytes.subarray(0, magic.length).equals(magic))
    throw Error('Invalid CUDA response header');
  if (bytes.readBigUInt64LE(magic.length) !== BigInt(count)) throw Error('Wrong CUDA response case count');
  const results: CudaResult[] = [];
  let offset = header;
  for (let c = 0; c < count; ++c) {
    if (rank * 8 > bytes.length - offset) throw Error('Short CUDA response shape');
    const shape = Array.from({ length: rank }, () => {
      const extent = Number(bytes.readBigUInt64LE(offset));
      offset += 8;
      return extent;
    });
    const n = elements(shape);
    if (n > (bytes.length - offset - 8) / 4) throw Error('Short CUDA response data');
    const words = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      words[i] = bytes.readUInt32LE(offset);
      offset += 4;
    }
    const gpuMs = bytes.readDoubleLE(offset);
    offset += 8;
    if (!Number.isFinite(gpuMs) || gpuMs < 0) throw Error('Invalid CUDA event time');
    results.push({ shape, data: new Float32Array(words.buffer), gpuMs });
  }
  if (offset !== bytes.length) throw Error('Trailing CUDA response bytes');
  return results;
}

const exec = promisify(execFile);
const runner = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
export async function runCudaBatch(
  source: string,
  fn: Fn,
  cases: readonly CudaInputs[],
  options?: { host?: string; benchmark?: boolean },
): Promise<CudaResult[]> {
  const request = encodeCudaCases(fn, cases);
  const dir = await mkdtemp(join(tmpdir(), 'irwb-tix-cuda-'));
  try {
    await Promise.all([writeFile(join(dir, 'main.cu'), source), writeFile(join(dir, 'inputs.bin'), request)]);
    const args = [runner, dir, '--runtime-input', 'inputs.bin'];
    if (options?.host !== undefined) args.push('--host', options.host);
    if (options?.benchmark) args.push('--timed', '--', '--benchmark');
    try {
      await exec(process.execPath, args);
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      let diagnostic = failure.stderr?.trim();
      try {
        const result = JSON.parse(failure.stdout ?? '');
        diagnostic ||= [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
      } catch {
        // Copy and fetch failures can exit before the runner prints JSON.
      }
      throw new Error(diagnostic || failure.message, { cause: error });
    }
    return decodeCudaCases(await readFile(join(dir, 'out', 'results.bin')), cases.length, fn.shape.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
