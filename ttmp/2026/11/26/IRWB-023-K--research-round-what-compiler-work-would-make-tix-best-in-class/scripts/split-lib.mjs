// Shared width-parameterized split-sum over Tix IR, mirroring src/tensor/passes.ts
// split() but with a configurable block width. Used by experiments 02 and 03.
import { add, substitute, variable } from '../../../../../../dist/tensor/model.js';

export function mapExpr(e, f) {
  if (e.kind === 'op') e = { ...e, args: e.args.map(x => mapExpr(x, f)) };
  if (e.kind === 'reduce') e = { ...e, body: mapExpr(e.body, f) };
  return f(e);
}
export function replaceIndices(expr, bindings) {
  return mapExpr(expr, e =>
    e.kind === 'load' ? { ...e, indices: e.indices.map(a => substitute(a, bindings)) } : e,
  );
}
export function splitWidth(fn, w) {
  const out = JSON.parse(JSON.stringify(fn));
  for (const s of out.statements) {
    s.expr = mapExpr(s.expr, e => {
      if (e.kind !== 'reduce' || e.op !== 'sum' || e.axes.length !== 1) return e;
      const [{ id, extent }] = e.axes;
      if (extent.kind !== 'dim') return e;
      const { dim } = extent,
        block = id + '/block',
        lane = id + '/lane';
      const body = replaceIndices(e.body, new Map([[id, add(variable(lane), variable(block), w)]]));
      return {
        kind: 'reduce',
        op: 'sum',
        axes: [{ id: block, extent: { kind: 'blocks', dim, rounding: 'ceil' } }],
        body: {
          kind: 'reduce',
          op: 'sum',
          axes: [{ id: lane, extent: { kind: 'tail', dim, block } }],
          body,
        },
      };
    });
  }
  return out;
}
