// 01: local sanity, no GPU. The stage-2 digests (fuse: false must keep printing stage 2's bytes), the schedule
// each corpus program gets, its order certificate, and the tiled kernels' source shape.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileTix, cudaSource, optimizeTix, scheduleTix } from '../../../../../../dist/tensor/index.js';
import { checkOrder } from '../../../../../../dist/tensor/schedule.js';
import { planFusion } from '../../../../../../dist/tensor/fusion.js';

const dir = new URL('.', import.meta.url).pathname;
const digests = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../../ttmp/2026/11/26/IRWB-029-D--checked-fusion-of-tix-kernels-on-the-gpu/scripts/02-stage2-source-digests.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const corpus = name =>
  compileTix(readFileSync(new URL(`../../../../../../corpus/tensor/${name}/main.tix`, import.meta.url), 'utf8'));
const sha = text => createHash('sha256').update(text).digest('hex');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = corpus(name);
  check(`stage-2 digest ${name}`, sha(cudaSource(program, name, { fuse: false })) === digests[name]);
  const optimized = optimizeTix(program, ['inline', 'split-sum']).program;
  check(
    `stage-2 digest ${name}+inline+split`,
    sha(cudaSource(optimized, name, { fuse: false })) === digests[name + '+inline+split'],
  );
}

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const program = corpus(name);
  const { schedule, steps } = scheduleTix(program, name);
  const unit = schedule.value;
  const order = checkOrder(unit);
  const plan = planFusion(program.current.value.functions[0]);
  check(`order certificate ${name}`, order.ok, `${order.certificate.length} reductions`);
  console.log(`  ${name}: ${unit.kernels.map(k => k.kernel + ':' + k.mapping + (k.tile ? '(BM' + k.tile.block + ',BK' + k.tile.chunk + ',db' + k.tile.doubleBuffer + ')' : '') + (k.memberTiles?.length ? '+tiles' + k.memberTiles.length : '')).join(' ')}`);
  console.log(`  steps: ${steps.map(s => `${s.pass.replace('tensor.schedule.', '')}=${s.changed}(${s.reason})`).join(' | ')}`);
  console.log(`  tile refusals: ${unit.tileRefusals.map(r => `${r.statement}: ${r.reason}`).join(' ;; ') || 'none'}`);
  console.log(`  classes: ${[...new Set(order.certificate.map(c => c.kind))].join(',')}`);
}

// matmul's fused source must now be a tiled kernel, not stage 2's.
const matmul = cudaSource(corpus('matmul'), 'matmul');
check('matmul fused is one gemm kernel', (matmul.match(/__global__/g) ?? []).length === 1 && /aS\[/.test(matmul));
check('matmul kernel count', (cudaSource(corpus('matmul'), 'matmul').match(/__global__/g) ?? []).length === 1);
// attention's score must read its k tile from shared memory.
const attention = cudaSource(corpus('attention'), 'attention');
check('attention stages a k tile', /float\* const op3 = tiles/.test(attention));
// softmax/layernorm must be unchanged in structure (no tiles).
const softmax = cudaSource(corpus('softmax'), 'softmax');
check('softmax has no tiles', !/float\* const tiles/.test(softmax));
process.exit(failures ? 1 : 0);
