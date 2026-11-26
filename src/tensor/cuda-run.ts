import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { emitCuda, functionNamed } from './cuda-source.js';
import { size, type F32Inputs } from './evaluate.js';
import type { TixProgram } from './index.js';
import type { Fn } from './model.js';

export interface CudaResult {
  shape: number[];
  data: Float32Array;
  gpuMs: number;
}

const exec = promisify(execFile);
const runner = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));

export function encodeBatch(fn: Fn, cases: readonly F32Inputs[]): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(cases.length);
  const parts: Buffer[] = [header];
  for (const inputs of cases) {
    for (const p of fn.params) {
      const tensor = inputs[p.name];
      if (
        !tensor ||
        tensor.shape.length !== p.shape.length ||
        !(tensor.data instanceof Float32Array) ||
        !tensor.shape.every(d => Number.isSafeInteger(d) && d >= 0) ||
        size(tensor.shape) !== tensor.data.length
      )
        throw Error('Invalid f32 input ' + p.name);
      const dims = Buffer.alloc(tensor.shape.length * 8);
      tensor.shape.forEach((n, j) => dims.writeBigUInt64LE(BigInt(n), j * 8));
      parts.push(dims, Buffer.from(tensor.data.buffer, tensor.data.byteOffset, tensor.data.byteLength));
    }
  }
  return Buffer.concat(parts);
}

export function decodeBatch(bytes: Buffer, rank: number, count: number): CudaResult[] {
  if (bytes.readUInt32LE(0) !== count) throw Error('CUDA result count differs');
  const results: CudaResult[] = [];
  let offset = 4;
  for (let i = 0; i < count; ++i) {
    const shape = Array.from({ length: rank }, () => {
      const n = Number(bytes.readBigUInt64LE(offset));
      offset += 8;
      if (!Number.isSafeInteger(n)) throw Error('Invalid CUDA result extent');
      return n;
    });
    const length = size(shape);
    if (offset + length * 4 + 8 > bytes.length) throw Error('Incomplete CUDA result');
    const data = new Float32Array(length);
    bytes.copy(new Uint8Array(data.buffer), 0, offset, offset + data.byteLength);
    offset += data.byteLength;
    const gpuMs = bytes.readDoubleLE(offset);
    offset += 8;
    if (!Number.isFinite(gpuMs) || gpuMs < 0) throw Error('Invalid CUDA event interval');
    results.push({ shape, data, gpuMs });
  }
  if (offset !== bytes.length) throw Error('Unexpected trailing CUDA results');
  return results;
}

export async function runCudaBatch(
  source: string,
  fn: Fn,
  cases: readonly F32Inputs[],
  options: { host?: string; timed?: boolean } = {},
) {
  const bytes = encodeBatch(fn, cases);
  const dir = await mkdtemp(join(tmpdir(), 'tix-cuda-'));
  try {
    await writeFile(join(dir, 'main.cu'), source);
    await writeFile(join(dir, 'in.bin'), bytes);
    const args = [runner, dir];
    if (options.host) args.push('--host', options.host);
    if (options.timed) args.push('--timed');
    const { stdout } = await exec(process.execPath, args).catch(e => {
      throw Error(`CUDA runner failed: ${e.stdout || e.stderr || e.message}`, { cause: e });
    });
    const receipt = JSON.parse(stdout);
    if (receipt.exit !== 0 || !receipt.outputs.includes('results.bin'))
      throw Error('CUDA runner did not return results: ' + receipt.stderr);
    const [device, versions] = receipt.stdout.trim().split('\n');
    const [major, minor, runtime] = versions.split(' ').map(Number);
    const results = decodeBatch(await readFile(join(dir, 'out/results.bin')), fn.shape.length, cases.length);
    return { results, engine: { host: String(receipt.host), device, major, minor, runtime } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: F32Inputs,
  options?: { host?: string },
): Promise<CudaResult> {
  const f = functionNamed(program, fn);
  const batch = await runCudaBatch(emitCuda(f), f, [inputs], options);
  return batch.results[0];
}
