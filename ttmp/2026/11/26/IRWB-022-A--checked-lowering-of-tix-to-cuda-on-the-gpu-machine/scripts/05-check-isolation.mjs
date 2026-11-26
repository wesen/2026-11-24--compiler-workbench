import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const helper = promisify(execFile);
const source =
  (await readFile(new URL('./01-gb10/main.cu', import.meta.url), 'utf8')) + '\n// ' + randomUUID();
const dirs = await Promise.all([1, 2].map(() => mkdtemp(join(tmpdir(), 'tix-identical-'))));
try {
  await Promise.all(dirs.map(dir => writeFile(join(dir, 'main.cu'), source)));
  const reports = await Promise.all(
    dirs.map(async dir => {
      const { stdout } = await helper(process.execPath, ['tools/cuda-remote.mjs', dir]);
      return JSON.parse(stdout);
    }),
  );
  assert.equal(reports[0].hash, reports[1].hash);
  assert.deepEqual(reports.map(r => r.compiled).sort(), [false, true]);
  const bytes = await Promise.all(dirs.map(dir => readFile(join(dir, 'out', 'results.bin'))));
  assert.deepEqual(bytes[0], bytes[1]);
  assert.equal(bytes[0].length, 8192 * 12 * 4);
  console.log(
    reports.map(({ hash, compiled, exit }) => ({ hash, compiled, exit })),
    bytes[0].length,
  );
} finally {
  await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
}
