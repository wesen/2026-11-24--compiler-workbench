// From the repository root after npm run build. --events measures a single warmed launch under the GPU lock.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const count = 4096,
  seed = 22,
  random = seededRandom(seed);
const x = Float32Array.from({ length: count }, () => random() * 4 - 2);
const y = Float32Array.from({ length: count }, () => random() * 1.875 + 0.125);
x[0] = 1 + 2 ** -23;
y[0] = 1 - 2 ** -23;
x[1] = 2 ** -149;
y[1] = 1;
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const input = Buffer.concat([bytes(x), bytes(y)]);
const sha = data => createHash('sha256').update(data).digest('hex');
const word = n => '0x' + new Uint32Array(Float32Array.of(n).buffer)[0].toString(16).padStart(8, '0');
const dir = mkdtempSync('/tmp/irwb-022-l-probe-');
try {
  copyFileSync(new URL('./01-numeric-probe.cu', import.meta.url), join(dir, 'main.cu'));
  writeFileSync(join(dir, 'inputs.bin'), input);
  const eventArgs = process.argv.includes('--events') ? ['--timed', '--', 'events'] : [];
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['tools/cuda-remote.mjs', dir, '--host', 'manuel@bling', ...eventArgs],
    { encoding: 'utf8' },
  );
  const remote = JSON.parse(stdout);
  const raw = readFileSync(join(dir, 'out', 'words.bin'));
  const gpu = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const operations = {
    add: 'x[i]+y[i]',
    sub: 'x[i]-y[i]',
    mul: 'x[i]*y[i]',
    div: 'x[i]/y[i]',
    exp: 'exp(x[i])',
    log: 'log(y[i])',
    sqrt: 'sqrt(y[i])',
    tanh: 'tanh(x[i])',
    dot7: 'sum(k) x[i,k]*y[i,k]',
    mulSub: 'x[i]*y[i]-1',
  };
  const cols = Object.keys(operations).length;
  if (gpu.length !== count * cols) throw Error('incomplete GPU output');
  const window = a =>
    Float32Array.from({ length: count * 7 }, (_, i) => a[(Math.floor(i / 7) + (i % 7)) % count]);
  const ops = {};
  for (const [j, [name, rhs]] of Object.entries(operations).entries()) {
    const dot = name === 'dot7';
    const type = dot ? 'f32[N,7]' : 'f32[N]';
    const program = compileTix(`fn f(x: ${type}, y: ${type}): f32[N] { out[i] = ${rhs}; return out; }`);
    const tensor = a => ({ shape: dot ? [count, 7] : [count], data: dot ? window(a) : a });
    const inputs = { x: tensor(x), y: tensor(y) };
    const f32 = runTix(program, 'f', inputs).data;
    const f64 = runTix(program, 'f', inputs, { precision: 'f64' }).data;
    let different = 0,
      first,
      maxAbs = 0,
      maxBudgetFraction = 0;
    for (let i = 0; i < count; i++) {
      const n = gpu[cols * i + j];
      if (!Number.isFinite(n) || !Number.isFinite(f64[i])) throw Error('expected a finite probe');
      if (word(n) !== word(f32[i])) {
        different++;
        first ??= { i, x: word(x[i]), y: word(y[i]), gpu: word(n), f32: word(f32[i]) };
      }
      const delta = Math.abs(n - f64[i]);
      maxAbs = Math.max(maxAbs, delta);
      maxBudgetFraction = Math.max(maxBudgetFraction, delta / (2e-6 + 2e-5 * Math.abs(f64[i])));
    }
    ops[name] = { different, first, maxAbs, maxBudgetFraction };
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        remote,
        seed,
        count,
        inputSHA256: sha(input),
        outputSHA256: sha(raw),
        contractionWitness: word(gpu[9]),
        subnormalProduct: word(gpu[cols + 2]),
        ops,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
