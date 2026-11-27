// IRWB-030-I script 03: probes behind the staging rules, on the GB10.
//   node <ticket>/scripts/03-staging-probes.mjs [cheap|globalload]
// Each probe times a row-scalar reduction inline (what the plan refuses) against the same reduction staged
// (a crafted plan with the terms entry added), through runCudaBatch in benchmark mode, and compares both
// outputs word for word with the f32 interpreter, so the staged path is also exactness evidence.
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { runCudaBatch } from '../../../../../../dist/tensor/cuda-runtime.js';
import { emitCuda } from '../../../../../../dist/tensor/cuda-source.js';
import { planFusion, reduceNodes, unfusedPlan } from '../../../../../../dist/tensor/fusion.js';
import { createHash } from 'node:crypto';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

const N = 4096,
  C = 1024;
const size = probe => probe.size ?? [N, C];
const probes = {
  // S2: the terms are a multiply of loads; the plan refuses to stage. Does staging one help or hurt?
  cheap: {
    source:
      'fn f(x: f32[N,C], w: f32[C]): f32[N,C] { s[i] = sum(j) x[i,j] * w[j]; y[i,j] = x[i,j] - s[i]; return y; }',
    fn: 'f',
    statement: 's',
  },
  // S1/S2: the terms are single loads of a global tensor; the plan refuses. Does staging one pay?
  // A term pool big enough to push the row set past the opt-in shared limit: the staged kernel runs its rows
  // and its fold from global scratch while the inline kernel keeps the rows in shared memory.
  // S1: the terms are loads of the staged row itself; staging would copy shared memory into another buffer and
  // add a barrier. The fold over the row buffer directly is the same chain either way.
  residentcopy: {
    source:
      'fn f(x: f32[N,C]): f32[N,C] { m[i] = max(j) x[i,j]; y[i,j] = x[i,j] - m[i]; return y; }',
    fn: 'f',
    statement: 'm',
  },
  bigfold: {
    source:
      'fn f(x: f32[N,C]): f32[N,C] { s[i] = sum(j) x[i,j] / C; y[i,j] = x[i,j] - s[i]; return y; }',
    fn: 'f',
    statement: 's',
    size: [64, 20000],
  },
  globalload: {
    source:
      'fn f(x: f32[N,C], g: f32[C]): f32[N,C] { m[i]: f32[N] = max(j) g[j]; y[i,j] = x[i,j] - m[i]; return y; }',
    fn: 'f',
    statement: 'm',
  },
};
const digest = ({ data }) =>
  createHash('sha256').update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest('hex');

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2);
  for (const name of names.length ? names : Object.keys(probes)) {
    const probe = probes[name];
    const program = compileTix(probe.source);
    const fn = program.current.value.functions[0];
    const [rows, cols] = size(probe);
    const random = seededRandom(35);
    const inputs = {
      x: { shape: [rows, cols], data: Float32Array.from({ length: rows * cols }, () => 0.2 * random() - 0.1) },
      [probe.statement === 's' ? 'w' : 'g']: {
        shape: [C],
        data: Float32Array.from({ length: C }, () => 0.2 * random() + 0.4),
      },
    };
    const reference = digest(runTix(program, probe.fn, inputs));
    for (const staged of [false, true]) {
      // Both sides are the fused block kernel: the planned decision (inline fold) against the staged fold.
    const plan = planFusion(fn);
    if (!staged) plan.groups[0].terms = [];
      if (staged) {
        const statement = fn.statements.find(s => s.name === probe.statement);
        const node = reduceNodes(statement.expr)[0].at;
        plan.groups[0].terms = [{ statement: probe.statement, node, axes: 1, reason: 'probe' }];
      }
      const source = emitCuda(fn, plan);
      if (staged && !/for \(U t = threadIdx\.x; t < nq0/.test(source))
        throw Error('The crafted plan did not stage the reduction');
      const [result] = await runCudaBatch(source, fn, [inputs], { benchmark: true });
      console.log(
        JSON.stringify({
          probe: name,
          staged,
          gpuMs: result.gpuMs,
          digest: digest(result),
          exact: digest(result) === reference,
        }),
      );
    }
  }
}
