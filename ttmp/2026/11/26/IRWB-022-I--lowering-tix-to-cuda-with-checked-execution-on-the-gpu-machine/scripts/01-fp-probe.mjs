// Run from the worktree root. The existing runner owns every GPU operation.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const { compileTix, optimizeTix, runTix } = await import(
  pathToFileURL(join(process.cwd(), 'dist/tensor/index.js'))
);
const temp = await mkdtemp(join(tmpdir(), 'irwb-tix-fp-'));
try {
  const scratch = new DataView(new ArrayBuffer(4));
  function fromWord(word) {
    scratch.setUint32(0, word, true);
    return scratch.getFloat32(0, true);
  }
  function word(value) {
    scratch.setFloat32(0, value, true);
    return scratch.getUint32(0, true);
  }
  let state = 0x20c0ffee;
  function randomWord() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  }
  function finite() {
    let x;
    do x = fromWord(randomWord());
    while (!Number.isFinite(x));
    return x;
  }
  const cases = [];
  const dotWidth = 1023,
    dotRows = 4;
  for (let row = 0; row < dotRows; row++) {
    for (let k = 0; k < dotWidth; k++) {
      const unit = () => randomWord() / 2 ** 32;
      const pair = [
        () => [2 * unit() - 1, 2 * unit() - 1],
        () => [0.25 + 0.75 * unit(), 0.25 + 0.75 * unit()],
        () => [[1, 0, 0, 0, 2 ** -24, 2 ** -24, 2 ** -24][k] ?? 0, 1],
        () => [(k % 2 ? -1 : 1) * (0.25 + 0.75 * unit()), 0.25 + 0.75 * unit()],
      ][row]();
      cases.push([...pair.map(Math.fround), 0]);
    }
  }
  state = 0x20c0ffee;
  for (const a of [-0, 0, -(2 ** -149), 2 ** -149, -(2 ** -126), 2 ** -126, -1, 1, fromWord(0x7f7fffff)])
    for (const b of [-0, 0, -1, 1, 2 ** -149, 2 ** -24, 2]) cases.push([a, b, -1]);
  cases.push([1 + 2 ** -23, 1 - 2 ** -23, -1], [1, 2 ** -24, 2 ** -24]);
  for (let i = 0; i < 98_304; i++) {
    // Alternate between raw finite f32 words and values in ranges with observable transcendental variation.
    const a = i % 2 ? finite() : Math.fround((randomWord() / 2 ** 32 - 0.5) * (i % 4 ? 210 : 20));
    cases.push([a, finite(), finite()]);
  }
  const input = Buffer.alloc(12 * cases.length);
  cases.forEach((row, i) => row.forEach((x, j) => input.writeFloatLE(x, (3 * i + j) * 4)));
  await copyFile(new URL('./fp-probe/main.cu', import.meta.url), join(temp, 'main.cu'));
  await writeFile(join(temp, 'inputs.bin'), input);
  const { stdout } = await promisify(execFile)(process.execPath, ['tools/cuda-remote.mjs', temp]);
  const remote = JSON.parse(stdout);
  const result = await readFile(join(temp, 'out', 'outputs.bin'));
  const names = [
    'add',
    'sub',
    'mul',
    'div',
    'neg',
    'sqrt',
    'expf',
    'logf',
    'tanhf',
    'exp(double)',
    'log(double)',
    'tanh(double)',
    'max',
    'min',
    'separate mul-add',
    'plain mul-add',
    'NaN propagation',
    'max of sqrt',
    'ordered sum tail',
  ];
  const stats = names.map(op => ({
    op,
    nonNaNWordMismatch: 0,
    nanWordMismatch: 0,
    worstFiniteBudgetFraction: 0,
  }));
  const columns = names.length + 2;
  if (result.length !== cases.length * columns * 4) throw Error('Unexpected GPU output length');
  const f = Math.fround;
  for (const [i, [a, b, c]] of cases.entries()) {
    const exp = Math.exp(a),
      log = Math.log(a),
      tanh = Math.tanh(a),
      sqrt = Math.sqrt(a);
    const reference = [
      a + b,
      a - b,
      a * b,
      a / b,
      -a,
      sqrt,
      exp,
      log,
      tanh,
      exp,
      log,
      tanh,
      Math.max(a, b),
      Math.min(a, b),
      f(a * b) + c,
      f(a * b) + c,
      f(sqrt) + b,
      Math.max(f(sqrt), b),
      f(a + b) + c,
    ];
    for (const [j, expected] of reference.entries()) {
      const offset = (i * columns + j) * 4;
      const got = result.readFloatLE(offset);
      const gotWord = result.readUInt32LE(offset);
      const expectedWord = word(expected);
      if (gotWord !== expectedWord) {
        const mismatch =
          Number.isNaN(expected) && Number.isNaN(got) ? 'nanWordMismatch' : 'nonNaNWordMismatch';
        stats[j][mismatch]++;
        if (mismatch === 'nonNaNWordMismatch' && !stats[j].firstMismatch)
          stats[j].firstMismatch = { args: [a, b, c].map(word), expectedWord, gotWord };
        if (mismatch === 'nanWordMismatch' && !stats[j].firstNaNMismatch)
          stats[j].firstNaNMismatch = { args: [a, b, c].map(word), expectedWord, gotWord };
      }
      if (Number.isFinite(expected) && Number.isFinite(f(expected)) && Number.isFinite(got)) {
        const fraction = Math.abs(expected - got) / (2e-6 + 2e-5 * Math.abs(expected));
        stats[j].worstFiniteBudgetFraction = Math.max(stats[j].worstFiniteBudgetFraction, fraction);
      }
    }
  }
  const dot = compileTix('fn dot(a:f32[N,K], b:f32[N,K]):f32[N] { y[i]=sum(k) a[i,k]*b[i,k]; return y; }');
  const split = optimizeTix(dot, ['split-sum']);
  if (!split.steps[0].accepted || split.program.current.revision === dot.current.revision)
    throw Error('Expected a genuine accepted split-sum');
  const shape = [dotRows, dotWidth];
  const dots = cases.slice(0, dotRows * dotWidth);
  const inputs = {
    a: { shape, data: Float32Array.from(dots, row => row[0]) },
    b: { shape, data: Float32Array.from(dots, row => row[1]) },
  };
  const reductions = [dot, split.program].map((program, variant) => {
    const f32 = runTix(program, 'dot', inputs).data;
    const f64 = runTix(program, 'dot', inputs, { precision: 'f64' }).data;
    return Array.from(f64, (reference, row) => {
      const got = result.readFloatLE((row * dotWidth * columns + names.length + variant) * 4);
      const error = Math.abs(got - reference);
      return {
        reference,
        got,
        f32WordEqual: word(f32[row]) === word(got),
        error,
        budgetFraction: error / (2e-6 + 2e-5 * Math.abs(reference)),
      };
    });
  });
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  console.log(
    JSON.stringify(
      {
        node: process.version,
        remote,
        cases: cases.length,
        inputSha256: hash(input),
        outputSha256: hash(result),
        stats,
        reductions,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
