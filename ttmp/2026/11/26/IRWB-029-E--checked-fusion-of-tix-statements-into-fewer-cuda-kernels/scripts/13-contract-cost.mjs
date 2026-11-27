// Run from the worktree root after building. What checkLowering costs for each corpus program, fused and unfused:
// the number of cases, the JS time for their references (the f32 meaning), the nvcc compile time of the source
// (measured through the tool on a copy with a unique comment, so that the remote build cache misses), and the
// wall time of the whole check with the build cached (one GPU batch unfused; two, the second with spilled rows,
// when the source has a row kernel).
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { checkLowering, compileTix, cudaSource } = await import(new URL('dist/tensor/index.js', root));
const { cudaCases } = await import(new URL('dist/tensor/contract.js', root));
const { encodeCudaCases } = await import(new URL('dist/tensor/cuda-runtime.js', root));
const { seededRandom } = await import(new URL('dist/framework/contracts/index.js', root));
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = compileTix(readFileSync(new URL(`corpus/tensor/${name}/main.tix`, root), 'utf8'));
  const fn = program.current.value.functions.find(f => f.name === name);
  let start = performance.now();
  const cases = cudaCases(fn, seededRandom(20));
  const referenceMs = Math.round(performance.now() - start);
  for (const fuse of [false, true]) {
    const source = cudaSource(program, name, { fuse });
    const dir = mkdtempSync(join(tmpdir(), 'irwb-029-cost-'));
    writeFileSync(join(dir, 'main.cu'), `// ${randomUUID()}\n` + source);
    writeFileSync(join(dir, 'inputs.bin'), encodeCudaCases(fn, cases.map(c => c.inputs)));
    const tool = JSON.parse(
      execFileSync(process.execPath, ['tools/cuda-remote.mjs', dir, '--runtime-input', 'inputs.bin'], { encoding: 'utf8' }),
    );
    rmSync(dir, { recursive: true, force: true });
    start = performance.now();
    const verdict = await checkLowering(program, name, { fuse });
    console.log(
      JSON.stringify({
        name,
        fuse,
        cases: cases.length,
        referenceMs,
        compileMs: tool.compileMs,
        batchRunMs: tool.runMs,
        checkWallMs: Math.round(performance.now() - start),
        accepted: verdict.accepted,
      }),
    );
  }
}
