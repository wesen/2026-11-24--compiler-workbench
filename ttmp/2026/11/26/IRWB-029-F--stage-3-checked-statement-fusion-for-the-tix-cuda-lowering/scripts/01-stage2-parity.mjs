// IRWB-029-F script 01: fuse:false must be the unchanged stage 2 lowering (byte-identical CUDA source),
// and the fused plan/kernel counts per corpus program.
//
// The stage 2 reference is the emitter at this branch's base commit (f706115, the IRWB-019 merge): the script
// extracts that file, transpiles it with esbuild into dist/ (gitignored) so its './model.js' import resolves
// to the current build, and compares byte for byte.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../../');
const base = 'f706115';

const oldSource = execFileSync('git', ['-C', root, 'show', `${base}:src/tensor/cuda-source.ts`], {
  encoding: 'utf8',
  maxBuffer: 1 << 24,
});
// The worktree has no node_modules of its own; the checkout shares the parent repository's.
const esbuild = ['.', '..', '../..', '../../..']
  .map(part => join(root, part, 'node_modules/.bin/esbuild'))
  .find(existsSync);
const staged = join(root, 'dist/tensor/stage2-cuda-source.mjs');
writeFileSync(
  staged,
  execFileSync(esbuild, ['--format=esm', '--loader=ts'], {
    input: oldSource,
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  }),
);

const { compileTix, cudaSource } = await import(join(root, 'dist/tensor/index.js'));
const { fusionPlan } = await import(join(root, 'dist/tensor/fusion.js'));
const stage2 = (await import(staged)).emitCuda;

const programs = ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d'];
const load = name => compileTix(readFileSync(join(root, 'corpus/tensor', name, 'main.tix'), 'utf8'));

let mismatches = 0;
for (const name of programs) {
  const program = load(name);
  const now = cudaSource(program, name, { fuse: false });
  const then = stage2(program.current.value.functions[0]);
  const identical = now === then;
  if (!identical) mismatches++;
  const fused = cudaSource(program, name);
  const plan = fusionPlan(program.current.value.functions[0]);
  console.log(
    name.padEnd(10),
    'stage2-identical:', identical,
    'kernels:', (then.match(/__global__ void/g) ?? []).length, '->', (fused.match(/__global__ void/g) ?? []).length,
    'plan:', JSON.stringify(plan.segments.map(s => s.kind + ':' + (s.kind === 'single' ? s.index : s.start + '-' + s.end))),
  );
}
console.log(mismatches === 0 ? 'fuse:false is byte-identical to stage 2' : mismatches + ' MISMATCHES');
