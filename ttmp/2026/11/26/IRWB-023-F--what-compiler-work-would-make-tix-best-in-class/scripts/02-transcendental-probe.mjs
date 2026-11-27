// IRWB-023-F, experiment 2: what the exact f32 meaning costs in transcendental
// calls, and whether a Ziv-guarded float exponential can replace the double one
// without changing a bit.
//
// Usage: node <ticket>/scripts/02-transcendental-probe.mjs
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
const work = new URL('../prototypes/work/', import.meta.url);
const dir = new URL('exp/', work);
await mkdir(dir, { recursive: true });

// reuse the softmax request file produced by experiment 1
const input = await readFile(new URL('probe/inputs-softmax.bin', work));
await writeFile(new URL('inputs-softmax.bin', dir), input);
await cp(new URL('../prototypes/02-transcendental/main.cu', import.meta.url), new URL('main.cu', dir));

const { stdout } = await run(
  'node',
  [
    repo + 'tools/cuda-remote.mjs',
    fileURLToPath(dir),
    '--runtime-input',
    'inputs-softmax.bin',
    '--',
    '--benchmark',
    process.argv[2] ?? String(1 << 30),
  ],
  { maxBuffer: 1 << 26, cwd: repo },
);
const meta = JSON.parse(stdout.trim().split('\n').at(-1));
console.log('compileMs', meta.compileMs, 'runMs', meta.runMs, 'stderr', meta.stderr.slice(0, 400));
console.log(meta.stdout.slice(meta.stdout.indexOf('{')));

// bit-exactness across processes: the fused Ziv kernel must reproduce the
// four-kernel double reference on every element of the real 4096x1024 case
const read = async name =>
  new Float32Array(
    (await readFile(new URL("out/" + name, dir))).buffer.slice(0),
  );
const a = await read('softmax_s0.bin'),
  b = await read('softmax_fused_row_ziv.bin');
let differ = 0;
for (let i = 0; i < a.length; i++)
  if (
    new Uint32Array(a.buffer, i * 4, 1)[0] !== new Uint32Array(b.buffer, i * 4, 1)[0]
  )
    differ++;
console.log(JSON.stringify({ fusedRowZivVsReference: { differ, total: a.length } }));
