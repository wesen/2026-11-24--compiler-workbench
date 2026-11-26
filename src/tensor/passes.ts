import { definePass } from '../framework/passes/define-pass.js';
import { Indexed, adapter } from './ir.js';
import { walk, subst, transform, type Fn, type Module } from './model.js';
function inline(f: Fn): Fn {
  const defs = [...f.defs];
  for (let i = 0; i < defs.length; i++) {
    const s = defs[i];
    if (s.name === f.ret || [...walk(s.rhs)].some(e => e.op === 'reduce')) continue;
    const uses = defs.flatMap((d, j) =>
      [...walk(d.rhs)].flatMap(e => (e.op === 'read' && e.name === s.name ? [j] : [])),
    );
    if (uses.length !== 1) continue;
    const j = uses[0];
    defs[j] = {
      ...defs[j],
      rhs: transform(defs[j].rhs, e => {
        if (e.op !== 'read' || e.name !== s.name) return e;
        const env = new Map(s.axes.map((a, k) => [a.id, e.sub[k]]));
        return transform(s.rhs, node =>
          node.op === 'read' ? { ...node, sub: node.sub.map(a => subst(a, env)) } : node,
        );
      }),
    };
    defs.splice(i--, 1);
  }
  return { ...f, defs };
}
function split(f: Fn): Fn {
  return {
    ...f,
    defs: f.defs.map(s => ({
      ...s,
      rhs: transform(s.rhs, e =>
        e.op === 'reduce' && e.fn === 'sum' && e.axes.length === 1 ? { ...e, fn: 'blocked' } : e,
      ),
    })),
  };
}
function pass(id: string, rewrite: (f: Fn) => Fn) {
  return definePass<Module>({
    id,
    version: '1',
    description: `Tix ${id}`,
    adapter,
    ir: Indexed,
    writes: { entities: ['def'], relations: ['contains', 'reads'] },
    run: ({ before }) => ({ native: before.value.map(rewrite) }),
  });
}
export const passes = new Map([
  ['inline', pass('inline', inline)],
  ['split-sum', pass('split-sum', split)],
]);
