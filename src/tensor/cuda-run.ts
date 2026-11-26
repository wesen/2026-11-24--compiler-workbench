import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { size } from './evaluate.js';
import { plain, value, type Fn } from './model.js';

export type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;

export interface CudaCase {
  id: number;
  inputs: CudaInputs;
}

export interface CudaResult {
  shape: number[];
  data: Float32Array;
  trials: number[];
}

export interface CudaOptions {
  host?: string;
  timed?: boolean;
  warmup?: number;
  repeat?: number;
}

const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
const execute = promisify(execFile);

function validShape(shape: number[]) {
  return shape.every(n => Number.isSafeInteger(n) && n >= 0) && Number.isSafeInteger(size(shape));
}

export function encodeCudaCases(fn: Fn, cases: readonly CudaCase[]): Buffer {
  let bytes = 4;
  for (const { inputs } of cases) {
    bytes += 4;
    const shapes = new Map<string, number>();
    for (const { name, shape } of fn.params) {
      const input = inputs[name];
      if (
        !input ||
        input.shape.length !== shape.length ||
        !validShape(input.shape) ||
        !(input.data instanceof Float32Array) ||
        input.data.length !== size(input.shape)
      )
        throw Error('Invalid CUDA input tensor ' + name);
      shape.forEach((dim, axis) => {
        const symbol = plain(dim);
        if (symbol) shapes.set(symbol, input.shape[axis]);
      });
      bytes += shape.length * 8 + input.data.byteLength;
    }
    for (const { name, shape } of fn.params) {
      if (shape.some((dim, i) => value(dim, shapes) !== inputs[name].shape[i]))
        throw Error('Inconsistent CUDA input shape for ' + name);
    }
    for (const { name, shape } of fn.statements) {
      if (!validShape(shape.map(dim => value(dim, shapes))))
        throw Error('Invalid CUDA result shape for ' + name);
    }
  }
  const payload = Buffer.allocUnsafe(bytes);
  let at = payload.writeUInt32LE(cases.length);
  for (const { id, inputs } of cases) {
    at = payload.writeUInt32LE(id, at);
    for (const { name } of fn.params) {
      const { shape, data } = inputs[name];
      for (const dim of shape) at = payload.writeBigUInt64LE(BigInt(dim), at);
      const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
      for (const word of words) at = payload.writeUInt32LE(word, at);
    }
  }
  return payload;
}

export function decodeCudaResults(fn: Fn, cases: readonly CudaCase[], bytes: Buffer, repeat: number) {
  let at = 0;
  function check(length: number) {
    if (length > bytes.length - at) throw Error('Truncated CUDA results');
  }
  function readId() {
    check(4);
    const id = bytes.readUInt32LE(at);
    at += 4;
    return id;
  }
  if (readId() !== cases.length) throw Error('Unexpected CUDA result count');
  const results: CudaResult[] = [];
  for (const { id } of cases) {
    if (readId() !== id) throw Error('Unexpected CUDA result ID');
    const shape = fn.shape.map(() => {
      check(8);
      const dim = Number(bytes.readBigUInt64LE(at));
      at += 8;
      return dim;
    });
    if (!validShape(shape)) throw Error('Invalid CUDA output shape');
    const trials = Array.from({ length: repeat }, () => {
      check(4);
      const ms = bytes.readFloatLE(at);
      at += 4;
      if (!Number.isFinite(ms) || ms < 0) throw Error('Invalid CUDA event time');
      return ms;
    });
    const count = size(shape);
    check(count * 4);
    const words = new Uint32Array(count);
    for (let i = 0; i < count; i++, at += 4) words[i] = bytes.readUInt32LE(at);
    results.push({ shape, trials, data: new Float32Array(words.buffer) });
  }
  if (at !== bytes.length) throw Error('Extra bytes after CUDA results');
  return results;
}

export async function executeCuda(
  source: string,
  fn: Fn,
  cases: readonly CudaCase[],
  { host, timed = false, warmup = 0, repeat = 1 }: CudaOptions = {},
): Promise<CudaResult[]> {
  const inputs = encodeCudaCases(fn, cases);
  const dir = await mkdtemp(join(tmpdir(), 'irwb-tix-cuda-'));
  try {
    await mkdir(join(dir, 'inputs'));
    await Promise.all([
      writeFile(join(dir, 'main.cu'), source),
      writeFile(join(dir, 'inputs', 'cases.bin'), inputs),
    ]);
    const args = [tool, dir, '--source-only'];
    if (host !== undefined) args.push('--host', host);
    if (timed) args.push('--timed');
    args.push('--', String(warmup), String(repeat));
    try {
      await execute(process.execPath, args, { maxBuffer: 1024 * 1024 });
    } catch (error) {
      const { stdout, stderr, message } = error as Error & { stdout?: string; stderr?: string };
      let diagnostic = stderr?.trim();
      if (stdout) {
        try {
          const result: { stderr?: string } = JSON.parse(stdout);
          diagnostic ||= result.stderr?.trim();
        } catch {
          diagnostic ||= stdout.trim();
        }
      }
      throw Error('CUDA remote run failed: ' + (diagnostic || message), { cause: error });
    }
    return decodeCudaResults(fn, cases, await readFile(join(dir, 'out', 'results.bin')), repeat);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
