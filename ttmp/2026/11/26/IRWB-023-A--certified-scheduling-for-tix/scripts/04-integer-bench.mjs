import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const dir = mkdtempSync(join(tmpdir(), 'irwb023a-integer-'));
try {
  const tix = readFileSync('corpus/tensor/matmul/main.tix', 'utf8');
  const generated = cudaSource(compileTix(tix), 'matmul');
  writeFileSync(join(dir, 'generated.cuh'), generated.replace('int main(', 'int stage2_original_main('));
  writeFileSync(join(dir, 'main.cu'), readFileSync(new URL('04-integer-kernels.cu', import.meta.url)));
  const result = spawnSync(process.execPath, ['tools/cuda-remote.mjs', dir, '--timed', '--host', 'manuel@bling'],
    { encoding: 'utf8' });
  if (!result.stdout) throw Error(result.stderr || String(result.error));
  console.log(result.stdout.trim());
  const remote = JSON.parse(result.stdout);
  if (remote.exit !== 0) throw Error('remote integer experiment exited ' + remote.exit);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
