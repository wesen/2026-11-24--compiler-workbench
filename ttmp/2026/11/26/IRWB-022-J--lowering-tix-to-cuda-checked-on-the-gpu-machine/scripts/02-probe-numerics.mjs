// Run from the worktree root with Node 24.
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const count = 65536;
const values = new Float32Array(count * 2);
const words = new Uint32Array(values.buffer);
let state = 0x85e090f3;
function word() {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}
const edge = [0, -0, 1, -1, 2 ** -149, -(2 ** -149), 2 ** -126, Math.fround(3.4028235e38)];
for (let i = 0; i < count; i++) {
  if (i < edge.length ** 2) {
    values.set([edge[Math.floor(i / edge.length)], edge[i % edge.length]], 2 * i);
  } else if (i % 2) {
    values.set([(word() / 2 ** 32 - 0.5) * 240, (word() / 2 ** 32 - 0.5) * 240], 2 * i);
  } else {
    for (let j = 0; j < 2; j++) {
      let bits;
      do bits = word();
      while ((bits & 0x7f800000) === 0x7f800000);
      words[2 * i + j] = bits;
    }
  }
}
const dir = await mkdtemp(join(tmpdir(), 'tix-numerics-'));
try {
  await copyFile(new URL('./01-numerics.cu', import.meta.url), join(dir, 'main.cu'));
  await writeFile(join(dir, 'input.bin'), Buffer.from(values.buffer));
  const { stdout } = await promisify(execFile)(process.execPath, ['tools/cuda-remote.mjs', dir]);
  console.log(stdout.trim());
  const bytes = await readFile(join(dir, 'out/results.bin'));
  const columns = ['exp', 'log', 'sqrt', 'tanh', '+', '-', '*', '/', 'neg', 'max', 'min', 'max(div, x)', 'sum', 'cancellation'];
  if (bytes.length !== count * columns.length * 4) throw new Error('Incorrect output length');
  const metrics = columns.map(op => ({
    op, finitePairs: 0, differentWords: 0, differentNaNWords: 0, classMismatches: 0,
    differentZeroSigns: 0, f64BudgetExceeded: 0, maxFiniteBudgetFraction: 0,
  }));
  const scratch = new DataView(new ArrayBuffer(4));
  const witness = [];
  for (let i = 0; i < count; i++) {
    const x = values[2 * i], y = values[2 * i + 1];
    const div = x / y;
    const expected = [
      Math.exp(x), Math.log(x), Math.sqrt(x), Math.tanh(x), x + y, x - y, x * y, div, -x,
      Math.max(x, y), Math.min(x, y), Math.max(Math.fround(div), x), 1 + 3 * 2 ** -24, 1,
    ];
    for (let j = 0; j < columns.length; j++) {
      const reference = expected[j];
      scratch.setFloat32(0, j === 12 ? 1 : j === 13 ? 0 : reference, true);
      const offset = (i * columns.length + j) * 4;
      const got = bytes.readFloatLE(offset);
      const cpu = scratch.getFloat32(0, true);
      const m = metrics[j];
      if (bytes.readUInt32LE(offset) !== scratch.getUint32(0, true)) {
        m.differentWords++;
        if (Number.isNaN(got) && Number.isNaN(cpu)) m.differentNaNWords++;
        if (got === 0 && cpu === 0) m.differentZeroSigns++;
        if (witness.length < 5) witness.push({
          op: columns[j], i, x: String(x), y: String(y),
          cpu: scratch.getUint32(0, true).toString(16), gpu: bytes.readUInt32LE(offset).toString(16),
        });
      }
      if (Number.isNaN(cpu) !== Number.isNaN(got) ||
          ((!Number.isFinite(cpu) || !Number.isFinite(got)) &&
           !Number.isNaN(cpu) && !Number.isNaN(got) && cpu !== got)) m.classMismatches++;
      if (Number.isFinite(reference) && Number.isFinite(got)) {
        m.finitePairs++;
        const fraction = Math.abs(got - reference) / (2e-6 + 2e-5 * Math.abs(reference));
        m.maxFiniteBudgetFraction = Math.max(m.maxFiniteBudgetFraction, fraction);
        if (fraction > 1) m.f64BudgetExceeded++;
      }
    }
  }
  console.log(JSON.stringify({ count, metrics, witness }, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}
