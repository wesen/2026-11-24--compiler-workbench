import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { emit, selected } from './cuda-source.js';
import type { Inputs } from './evaluate.js';
import type { Fn } from './model.js';
import type { TixProgram } from './index.js';

type CudaInputs = Record<string, { shape: number[]; data: Float32Array }>;
export interface CudaResult {
  shape: number[];
  data: Float32Array;
  gpuMs: number;
}
const execute = promisify(execFile);
const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));

function encode(fn: Fn, cases: readonly Inputs[]) {
  const count = Buffer.alloc(4);
  count.writeUInt32LE(cases.length);
  const parts: Buffer[] = [count];
  for (const inputs of cases)
    for (const p of fn.params) {
      const { shape, data } = inputs[p.name];
      if (!(data instanceof Float32Array)) throw Error('CUDA input must be f32');
      const header = Buffer.alloc(4 + 8 * shape.length);
      header.writeUInt32LE(shape.length);
      shape.forEach((n, i) => header.writeBigUInt64LE(BigInt(n), 4 + 8 * i));
      parts.push(header, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  return Buffer.concat(parts);
}

export function decode(bytes: Buffer, count: number): CudaResult[] {
  if (bytes.readUInt32LE() !== count) throw Error('Wrong CUDA result count');
  let offset = 4;
  const results: CudaResult[] = [];
  for (let i = 0; i < count; i++) {
    const rank = bytes.readUInt32LE(offset);
    offset += 4;
    const shape: number[] = [];
    for (let j = 0; j < rank; j++) {
      shape.push(Number(bytes.readBigUInt64LE(offset)));
      offset += 8;
    }
    const length = shape.reduce((a, b) => a * b, 1);
    if (length * 4 + 4 > bytes.length - offset) throw Error('Truncated CUDA tensor');
    const data = new Float32Array(length);
    new Uint8Array(data.buffer).set(bytes.subarray(offset, offset + data.byteLength));
    offset += data.byteLength;
    const gpuMs = bytes.readFloatLE(offset);
    offset += 4;
    if (!(Number.isFinite(gpuMs) && gpuMs >= 0)) throw Error('Invalid CUDA event time');
    results.push({ shape, data, gpuMs });
  }
  if (offset !== bytes.length) throw Error('Extra CUDA result bytes');
  return results;
}

export async function runBatch(
  source: string,
  fn: Fn,
  cases: readonly Inputs[],
  options: { host?: string; benchmark?: boolean } = {},
): Promise<CudaResult[]> {
  const dir = await mkdtemp(join(tmpdir(), 'tix-cuda-'));
  try {
    await writeFile(join(dir, 'main.cu'), source);
    await writeFile(join(dir, 'inputs.bin'), encode(fn, cases));
    const args = [tool, dir];
    if (options.host) args.push('--host', options.host);
    if (options.benchmark) args.push('--timed', '--', '--benchmark');
    const { stdout } = await execute(process.execPath, args);
    const result = JSON.parse(stdout);
    if (result.exit !== 0 || !result.outputs.includes('results.bin')) throw Error('Incomplete CUDA run');
    return decode(await readFile(join(dir, 'out', 'results.bin')), cases.length);
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && error.stdout) {
      throw Error('CUDA helper: ' + String(error.stdout), { cause: error });
    }
    throw error;
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
  const f = selected(program.current, fn);
  const [result] = await runBatch(emit(f), f, [inputs], options);
  return result;
}
