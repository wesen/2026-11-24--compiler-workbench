import type { IRGraph } from '../framework/ir/index.js';
import { definePass } from '../framework/passes/index.js';
import { subst } from './affine.js';
import { adapter, Index, TixIR } from './ir.js';
import { exact, tolerance } from './contract.js';

export const inline = definePass<IRGraph>({
  id: 'tensor.inline',
  version: '1',
  description: 'Substitute a single-use pointwise tensor',
  adapter,
  ir: TixIR,
  contract: exact,
  writes: { entities: ['def', 'axis', 'expr.*'], relations: ['stmt', 'axis', 'arg', 'reads'] },
  run({ edit, before }) {
    const ix = new Index(before.value);
    for (const fn of ix.graph.roots) {
      for (const def of ix.kids(fn, 'stmt')) {
        const uses = ix.graph.relations.filter(
          r => r.to === def && (r.kind === 'reads' || r.kind === 'returns'),
        );
        if (uses.length !== 1 || uses[0].kind !== 'reads') continue;
        const body = ix.one(def, 'arg'),
          subtree: string[] = [];
        function collect(id: string) {
          subtree.push(id);
          ix.kids(id, 'arg').forEach(collect);
        }
        collect(body);
        if (subtree.some(id => ix.n(id).kind.startsWith('expr.reduce.'))) continue;
        const load = uses[0].from,
          axes = ix.kids(def, 'axis'),
          actual = ix.indices(load);
        const substitutions = new Map(axes.map((id, j) => [id, actual[j]]));
        // Move, rather than duplicate, the sole producer expression under its consumer.
        for (const id of subtree)
          if (ix.n(id).kind === 'expr.load')
            edit.update(id, { indices: ix.indices(id).map(a => subst(a, s => substitutions.get(s)!)) });
        edit.redirectReferences(load, body, { relations: ['arg'] });
        edit.remove(load);
        edit.remove(def);
        axes.forEach(id => edit.remove(id));
        edit.correspond([def, load], [body], 'inlined');
        break;
      }
    }
  },
});
export const splitSum = definePass<IRGraph>({
  id: 'tensor.split-sum',
  version: '1',
  description: 'Sum partial blocks of four, including the last short block',
  ir: TixIR,
  adapter,
  contract: tolerance,
  writes: { entities: ['axis', 'expr.reduce.sum'], relations: ['axis', 'arg', 'block'] },
  run({ before, edit }) {
    const ix = new Index(before.value);
    for (const n of ix.graph.entities) {
      if (n.kind !== 'expr.reduce.sum') continue;
      const axes = ix.kids(n.id, 'axis');
      if (axes.length !== 1 || ix.a(axes[0]).mode !== 'range') continue;
      const k = axes[0],
        base = k + '/base',
        inner = n.id + '/partial',
        body = ix.one(n.id, 'arg');
      edit.insert({ id: inner, kind: n.kind, attributes: n.attributes });
      edit.insert({
        id: base,
        kind: 'axis',
        attributes: { ...ix.a(k), name: 'block', mode: 'starts', width: 4 },
      });
      edit.update(k, { mode: 'inner' });
      edit.disconnect(ix.edges(n.id, 'axis')[0].id);
      edit.disconnect(ix.edges(n.id, 'arg')[0].id);
      edit.connect(n.id, { kind: 'axis', order: 0 }, base);
      edit.connect(n.id, { kind: 'arg', order: 0 }, inner);
      edit.connect(inner, { kind: 'axis', order: 0 }, k);
      edit.connect(inner, { kind: 'arg', order: 0 }, body);
      edit.connect(k, { kind: 'block', order: 0 }, base);
      edit.correspond(n.id, [n.id, inner], 'split');
    }
  },
});
