// IRWB-030-E script 14: what the check costs. For each corpus program and the two "inside" variants: the number
// of cases in the evidence (every sample on each side of the gate), and the wall time of a first and a repeated
// checkLowering, fused and unfused. The first fused check compiles once and runs the program twice
// (--gate=fused, --gate=unfused); the unfused check runs it once.
//   node <ticket>/scripts/14-contract-cost.mjs [name ...]
import { AnalysisManager } from '../../../../../../dist/framework/contracts/index.js';
import { compileTix } from '../../../../../../dist/tensor/index.js';
import { checkCudaLowering } from '../../../../../../dist/tensor/cuda-contract.js';
import { programs } from './01-benchmark.mjs';

const names = process.argv.slice(2);
const table = ['matmul', 'softmax', 'layernorm', 'layernorm-inside', 'attention', 'attention-inside', 'mlp', 'conv2d'];
for (const name of names.length ? names : table) {
  const spec = programs[name];
  const program = compileTix(spec.source);
  const row = { name };
  for (const fuse of [true, false]) {
    const manager = new AnalysisManager();
    const timed = async () => {
      const start = performance.now();
      const verdict = await checkCudaLowering(program.current, spec.fn ?? name, undefined, { fuse, manager });
      return { verdict, ms: Math.round(performance.now() - start) };
    };
    const first = await timed();
    const again = await timed();
    const evidence = manager.snapshot().executions.at(-1).checks.find(c => c.phase === 'ensures').evidence;
    row[fuse ? 'fused' : 'unfused'] = {
      accepted: first.verdict.accepted,
      cases: evidence.total,
      agree: evidence.agree,
      firstMs: first.ms,
      repeatMs: again.ms,
    };
  }
  console.log(JSON.stringify(row));
}
