// E7: cost of the current sampled meaning gate per corpus function (this host, Node 24).
// Measures one applyNativePassSync(split-sum width 4) call end to end: candidate build,
// case generation, f64 origin evaluation, candidate f32 evaluation and comparison.
// Also measures one full-size f64 origin evaluation to show what full-scale CPU checking
// would cost, against which the E3 GPU certificate numbers (+0.4-3% on-kernel) are read.
// Usage: node scripts/05-check-cost.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileTix, runTix } from '../../../../../../dist/tensor/index.js';
import { applyNativePassSync, definePass } from '../../../../../../dist/framework/passes/index.js';
import { adapter, TixIR } from '../../../../../../dist/tensor/ir.js';
import { meaningGate } from '../../../../../../dist/tensor/contract.js';
import { add, mapExpr, substitute, variable } from '../../../../../../dist/tensor/model.js';

const here = import.meta.dirname;
const repo = join(here, '../../../../../../');

function replaceIndices(expr, bindings) {
  return mapExpr(expr, e =>
    e.kind === 'load' ? { ...e, indices: e.indices.map(a => substitute(a, bindings)) } : e,
  );
}
function splitWidth4(fn) {
  return {
    ...fn,
    statements: fn.statements.map(s => ({
      ...s,
      expr: mapExpr(s.expr, e => {
        if (e.kind !== 'reduce' || e.op !== 'sum' || e.axes.length !== 1) return e;
        const [{ id, extent }] = e.axes;
        if (extent.kind !== 'dim') return e;
        const { dim } = extent, block = id + '/block', lane = id + '/lane';
        const address = add(variable(lane), variable(block), 4);
        const body = replaceIndices(e.body, new Map([[id, address]]));
        return {
          kind: 'reduce', op: 'sum',
          axes: [{ id: block, extent: { kind: 'blocks', dim, rounding: 'ceil' } }],
          body: { kind: 'reduce', op: 'sum', axes: [{ id: lane, extent: { kind: 'tail', dim, block } }], body },
        };
      }),
    })),
  };
}
const splitPass = definePass({
  id: 'tensor.split-b4',
  version: '1',
  description: 'split-sum width 4',
  ir: TixIR,
  adapter,
  writes: { entities: ['tensor'], relations: ['reads', 'contains'] },
  run: ({ before }) => ({ native: { functions: before.value.functions.map(splitWidth4) } }),
});

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const rand = lcg(20);
const fullSizes = {
  matmul: { M: 128, K: 128, N: 128 },
  softmax: { N: 256, C: 256 },
  layernorm: { N: 256, D: 256 },
  attention: { Q: 64, K: 64, D: 16, V: 16 },
  mlp: { N: 64, D: 64, H: 128, O: 64 },
  conv2d: { N: 2, C: 4, H: 32, W: 32, O: 8 },
};

for (const name of Object.keys(fullSizes)) {
  const source = readFileSync(join(repo, 'corpus/tensor', name, 'main.tix'), 'utf8');
  const program = compileTix(source);
  const fn = program.current.value.functions[0];

  const t0 = performance.now();
  let accepted = 'threw';
  try {
    applyNativePassSync(splitPass, program.current, meaningGate(program.origin, 'tolerance'));
    accepted = true;
  } catch (e) {
    accepted = e?.code ?? String(e).slice(0, 60);
  }
  const gateMs = performance.now() - t0;

  // One f64 evaluation at a moderate full-size case, to extrapolate full-scale CPU checking.
  const dims = new Map(Object.entries(fullSizes[name]).map(([k, v]) => [k, v]));
  const inputs = Object.create(null);
  const t1 = performance.now();
  try {
    for (const p of fn.params) {
      const shape = p.shape.map(a => {
        const m = a.terms.map(([n, c]) => `${c}*${n}`).join('+') + (a.constant ? `+${a.constant}` : '');
        // evaluate affine form against dims
        const v = a.terms.reduce((acc, [n, c]) => acc + c * dims.get(n), a.constant);
        return v;
      });
      const n = shape.reduce((x, y) => x * y, 1);
      inputs[p.name] = { shape, data: Float32Array.from({ length: n }, () => 2 * rand() - 1) };
    }

    runTix(program, fn.name, inputs, { precision: 'f64' });
  } catch (e) {
    void e;
  }
  const f64Ms = performance.now() - t1;
  console.log(JSON.stringify({ fn: fn.name, gate_ms: +gateMs.toFixed(1), accepted, full_f64_ms_at_quarter_scale: +f64Ms.toFixed(1) }));
}
