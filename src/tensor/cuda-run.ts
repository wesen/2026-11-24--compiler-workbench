import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cudaSource, selected } from './cuda-source.js';
import type { TixProgram } from './index.js';
import { size, type Inputs } from './evaluate.js';
import { plain, value, type Fn } from './model.js';

const exec = promisify(execFile);
const tool = fileURLToPath(new URL('../../tools/cuda-remote.mjs', import.meta.url));
export function encode(fn: Fn, cases: Inputs[]) {
  const header = Buffer.alloc(8);
  header.writeUInt32LE(1);
  header.writeUInt32LE(cases.length, 4);
  const parts: Buffer[] = [header];
  const shapes = cases.map(inputs => {
    const symbols = new Map<string, number>();
    for (const p of fn.params) {
      const t = inputs[p.name];
      if (
        !t ||
        !(t.data instanceof Float32Array) ||
        t.shape.length !== p.shape.length ||
        t.data.length !== size(t.shape) ||
        !t.data.every(Number.isFinite)
      )
        throw Error('Invalid input: ' + p.name);
      const dims = Buffer.alloc(8 * t.shape.length);
      t.shape.forEach((d, i) => {
        if (!Number.isSafeInteger(d) || d < 0) throw Error('Invalid dimension');
        const name = plain(p.shape[i]);
        if (name) symbols.set(name, d);
        dims.writeBigInt64LE(BigInt(d), 8 * i);
      });
      parts.push(dims, Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength));
    }
    for (const p of fn.params)
      if (!p.shape.every((a, i) => value(a, symbols) === inputs[p.name].shape[i]))
        throw Error('Inconsistent input shape: ' + p.name);
    for (const s of fn.statements) {
      const shape = s.shape.map(a => value(a, symbols));
      if (!shape.every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isSafeInteger(size(shape)))
        throw Error('Invalid statement shape');
    }
    return fn.shape.map(a => value(a, symbols));
  });
  return { packet: Buffer.concat(parts), shapes };
}
export function decode(packet: Buffer, shapes: number[][], timed: boolean) {
  let pos = 0;
  function u32() {
    const x = packet.readUInt32LE(pos);
    pos += 4;
    return x;
  }
  if (u32() !== 1 || u32() !== shapes.length) throw Error('Incomplete result packet');
  const out = shapes.map((shape, i) => {
    if (u32() !== i || u32() !== shape.length) throw Error('Unexpected case or rank');
    for (const d of shape) {
      if (packet.readBigInt64LE(pos) !== BigInt(d)) throw Error('Output shape differs');
      pos += 8;
    }
    const times = Array.from({ length: timed ? 3 : 1 }, () => {
      const ms = packet.readFloatLE(pos);
      pos += 4;
      if (!(ms >= 0 && Number.isFinite(ms))) throw Error('Invalid CUDA event time');
      return ms;
    });
    const bytes = size(shape) * 4;
    if (pos + bytes > packet.length) throw Error('Truncated output');
    const data = new Float32Array(size(shape));
    Buffer.from(data.buffer).set(packet.subarray(pos, pos + bytes));
    pos += bytes;
    return { shape, data, times };
  });
  if (pos !== packet.length) throw Error('Unexpected trailing output');
  return out;
}
export async function runBatch(
  source: string,
  fn: Fn,
  cases: Inputs[],
  options: { host?: string; timed?: boolean } = {},
) {
  const { packet, shapes } = encode(fn, cases);
  const dir = await mkdtemp(join(tmpdir(), 'tix-cuda-'));
  try {
    await Promise.all([writeFile(join(dir, 'main.cu'), source), writeFile(join(dir, 'input.bin'), packet)]);
    const args = [
      tool,
      dir,
      ...(options.host ? ['--host', options.host] : []),
      ...(options.timed ? ['--timed', '--', 'bench'] : []),
    ];
    const { stdout } = await exec(process.execPath, args);
    const meta = JSON.parse(stdout);
    if (meta.exit !== 0 || !meta.outputs.includes('result.bin'))
      throw Error('Missing CUDA result: ' + stdout);
    return decode(await readFile(join(dir, 'out/result.bin')), shapes, !!options.timed);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function runTixCuda(
  program: TixProgram,
  fn: string,
  inputs: Record<string, { shape: number[]; data: Float32Array }>,
  options?: { host?: string },
) {
  const [{ shape, data, times }] = await runBatch(
    cudaSource(program, fn),
    selected(program, fn),
    [inputs],
    options,
  );
  return { shape, data, gpuMs: times[0] };
}
