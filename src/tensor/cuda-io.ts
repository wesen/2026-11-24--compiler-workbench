import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inputMagic, protocolVersion, resultMagic } from './cuda-source.js';
import { plain, value, type Fn } from './model.js';
import type { F32Inputs } from './samples.js';

const launchTool = promisify(execFile);
const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
const defaultHost = 'manuel@bling';
const inputFile = 'cases.bin';

export interface CudaResult {
  shape: number[];
  data: Float32Array;
  gpuMs: number;
}

interface RemoteResult {
  host: string;
  hash: string;
  compiled: boolean;
  compileMs: number;
  runMs: number;
  exit: number;
  stdout: string;
  stderr: string;
  outputs: string[];
}

function countElements(shape: number[]): number {
  if (shape.some(extent => !Number.isSafeInteger(extent) || extent < 0))
    throw Error('Unsupported tensor extent');
  if (shape.includes(0)) return 0;
  const length = shape.reduce((n, extent) => n * extent, 1);
  if (!Number.isSafeInteger(length)) throw Error('Unsupported tensor size');
  return length;
}

function header(magic: number, count: number): Buffer {
  const bytes = Buffer.alloc(12);
  bytes.writeUInt32LE(magic, 0);
  bytes.writeUInt32LE(protocolVersion, 4);
  bytes.writeUInt32LE(count, 8);
  return bytes;
}

export function encodeCases(fn: Fn, cases: readonly F32Inputs[]): Buffer {
  const parts = [header(inputMagic, cases.length)];
  for (const inputs of cases) {
    const shapes = new Map<string, number>();
    for (const p of fn.params) {
      const input = Object.hasOwn(inputs, p.name) ? inputs[p.name] : undefined;
      if (!input || input.shape.length !== p.shape.length || input.data.length !== countElements(input.shape))
        throw Error('Invalid input tensor ' + p.name);
      p.shape.forEach((form, axis) => {
        const name = plain(form);
        if (name === undefined) return;
        const extent = input.shape[axis];
        if (shapes.has(name) && shapes.get(name) !== extent) throw Error('Inconsistent shape ' + name);
        shapes.set(name, extent);
      });
    }
    for (const p of fn.params) {
      const { shape, data } = inputs[p.name];
      const extents = Buffer.alloc(shape.length * 8);
      shape.forEach((extent, axis) => {
        if (value(p.shape[axis], shapes) !== extent) throw Error('Inconsistent input shape for ' + p.name);
        extents.writeBigUInt64LE(BigInt(extent), 8 * axis);
      });
      parts.push(extents, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  }
  return Buffer.concat(parts);
}

export function decodeResults(bytes: Buffer, cases: number, rank: number, repetitions: number) {
  if (
    bytes.length < 12 ||
    bytes.readUInt32LE(0) !== resultMagic ||
    bytes.readUInt32LE(4) !== protocolVersion ||
    bytes.readUInt32LE(8) !== cases
  )
    throw Error('Invalid CUDA result header');
  let pos = 12;
  function take(size: number) {
    const end = pos + size;
    if (end > bytes.length) throw Error('Truncated CUDA result');
    const value = bytes.subarray(pos, end);
    pos = end;
    return value;
  }
  const outputs = [];
  for (let i = 0; i < cases; i++) {
    const shape = Array.from({ length: rank }, () => Number(take(8).readBigUInt64LE()));
    const length = countElements(shape);
    const samples = Array.from({ length: repetitions }, () => take(4).readFloatLE());
    if (samples.some(time => !Number.isFinite(time) || time < 0)) throw Error('Invalid CUDA event time');
    const payload = take(length * 4);
    const data = new Float32Array(length);
    payload.copy(Buffer.from(data.buffer));
    const measured = (repetitions === 1 ? samples : samples.slice(1)).toSorted((a, b) => a - b);
    const gpuMs = measured[Math.floor(measured.length / 2)];
    outputs.push({ shape, data, gpuMs, samples });
  }
  if (pos !== bytes.length) throw Error('Trailing bytes in CUDA result');
  return outputs;
}

export async function runCudaBatch(
  fn: Fn,
  source: string,
  cases: readonly F32Inputs[],
  options: { host?: string; timed?: boolean; repetitions?: number } = {},
) {
  const repetitions = options.repetitions ?? 1;
  const bytes = encodeCases(fn, cases);
  const dir = await mkdtemp('/tmp/irwb-tix-cuda-');
  try {
    await Promise.all([writeFile(join(dir, 'main.cu'), source), writeFile(join(dir, inputFile), bytes)]);
    const args = [tool, dir, '--host', options.host ?? defaultHost, '--input', inputFile];
    if (options.timed) args.push('--timed');
    args.push('--', String(repetitions));
    let remote: RemoteResult;
    try {
      const { stdout } = await launchTool(process.execPath, args);
      remote = JSON.parse(stdout) as RemoteResult;
      if (remote.exit !== 0 || !remote.outputs?.includes('results.bin')) throw Error('Missing CUDA result');
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      throw Error(
        'Remote CUDA job failed: ' + (failure.stdout?.trim() || failure.stderr?.trim() || failure.message),
      );
    }
    const output = await readFile(join(dir, 'out', 'results.bin'));
    return { outputs: decodeResults(output, cases.length, fn.shape.length, repetitions), remote };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
