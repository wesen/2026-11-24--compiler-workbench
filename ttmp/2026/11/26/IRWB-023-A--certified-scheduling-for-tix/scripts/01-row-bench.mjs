import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emitCertifiedRow } from './07-emit-certified-row.mjs';
import { compileTix, cudaSource } from '../../../../../../dist/tensor/index.js';

const args = process.argv.slice(2);
const defaults = ['softmax', 'layernorm', 'attention'];
const only = args.filter(arg => !arg.startsWith('--'));
const names = only.length ? only : defaults;
const sweep = args.includes('--sweep');
for (const name of names) {
  const dir = mkdtempSync(join(tmpdir(), 'irwb023a-row-'));
  try {
    mkdirSync(join(dir, 'out'));
    const tix = readFileSync(`corpus/tensor/${name}/main.tix`, 'utf8');
    const program = compileTix(tix);
    const generated = cudaSource(program, name);
    writeFileSync(join(dir, 'generated.cuh'), generated.replace('int main(', 'int stage2_original_main('));
    const harness = readFileSync(new URL('01-row-kernels.cu', import.meta.url), 'utf8');
    let macros = '#define CASE_' + name.toUpperCase() + '\n';
    let certificate;
    if (args.includes('--certified') && name !== 'attention') {
      const { code, ...evidence } = await emitCertifiedRow(program.current, name);
      certificate = evidence;
      writeFileSync(join(dir, 'certificate.cuh'), code);
      macros += '#define CERTIFIED_ROW\n';
    }
    writeFileSync(join(dir, 'main.cu'), macros + harness);
    const measurement = spawnSync(process.execPath, ['tools/cuda-remote.mjs', dir,
      '--host', 'manuel@bling', '--timed', ...(sweep ? ['--', 'sweep'] : [])], { encoding: 'utf8' });
    if (!measurement.stdout) throw Error(measurement.stderr || String(measurement.error));
    const remote = JSON.parse(measurement.stdout);
    console.log(JSON.stringify({ name, certificate, ...remote }));
    if (remote.exit !== 0) throw Error(name + ' remote exit ' + remote.exit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
