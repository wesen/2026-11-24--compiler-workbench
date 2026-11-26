import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const names = process.argv.length > 2 ? process.argv.slice(2) : ['softmax', 'layernorm', 'attention'];
for (const name of names) {
  const dir = mkdtempSync(join(tmpdir(), 'irwb023a-row-'));
  try {
    mkdirSync(join(dir, 'out'));
    const tix = readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8');
    const generated = cudaSource(compileTix(tix), name);
    writeFileSync(join(dir, 'generated.cuh'), generated.replace('int main(', 'int stage2_original_main('));
    const harness = readFileSync(new URL('01-row-kernels.cu', import.meta.url), 'utf8');
    writeFileSync(join(dir, 'main.cu'), '#define CASE_' + name.toUpperCase() + '\n' + harness);
    const measurement = spawnSync(process.execPath, ['tools/cuda-remote.mjs', dir,
      '--host', 'manuel@bling', '--timed'], { encoding: 'utf8' });
    if (!measurement.stdout) throw Error(measurement.stderr || String(measurement.error));
    const remote = JSON.parse(measurement.stdout);
    console.log(JSON.stringify({ name, ...remote }));
    if (remote.exit !== 0) throw Error(name + ' remote exit ' + remote.exit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
