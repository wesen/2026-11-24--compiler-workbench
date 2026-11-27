import { emitCuda } from './cuda-source.js';
import { parse } from './parser.js';
import { planFusion } from './fusion.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-g-h-irwb-033-f/corpus/tensor/';
for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const f = parse(readFileSync(root + name + '/main.tix', 'utf8')).functions[0];
  const source = emitCuda(f, planFusion(f));
  console.log(JSON.stringify({ name, sha: createHash('sha256').update(source).digest('hex') }));
}
