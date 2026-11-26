// Exercise the compile lock with two fresh private directories and the same cold key.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const dirs = [await mkdtemp(join(tmpdir(), 'irwb022k-a-')), await mkdtemp(join(tmpdir(), 'irwb022k-b-'))];
try {
  const kernel = await readFile(new URL('./01-gb10/main.cu', import.meta.url), 'utf8');
  for (const dir of dirs) await writeFile(join(dir, 'main.cu'), kernel + '// ' + basename(dirs[0]) + '\n');
  async function run(dir) {
    const { stdout } = await exec(process.execPath, ['tools/cuda-remote.mjs', dir, '--host', 'manuel@bling']);
    const receipt = JSON.parse(stdout);
    const digest = createHash('sha256')
      .update(await readFile(join(dir, 'out/values.f32')))
      .digest('hex');
    assert.equal(receipt.exit, 0);
    assert.equal(digest, '8b018535f7d8439707fa812261d5a4a6192a186e0c4b222b60408883ceace434');
    return { compiled: receipt.compiled, hash: receipt.hash };
  }
  const concurrent = await Promise.all(dirs.map(run));
  assert.equal(concurrent[0].hash, concurrent[1].hash);
  assert.equal(concurrent.filter(r => r.compiled).length, 1);
  const repeat = await run(dirs[0]);
  assert.equal(repeat.compiled, false);
  console.log({ concurrent, repeat });
} finally {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}
