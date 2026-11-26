import { definePass } from '../framework/passes/index.js';
import type { CorrespondenceEntry } from '../framework/ir/index.js';
import { AffineOverflow, combine, constant, type Affine } from './affine.js';
import { UnprovenBounds, validateTensor } from './check.js';
import { indexedAdapter, IndexedIR, tensorId } from './ir.js';
import { expressions, mapExpr, type Expr, type Stmt, type TensorIR } from './model.js';

export const inlinePass = definePass<TensorIR>({
  mode: 'native',
  id: 'tensor.inline',
  version: '1',
  description: 'Substitute a single-use pointwise definition at its sole load',
  adapter: indexedAdapter,
  ir: IndexedIR,
  writes: { entities: ['statement'], relations: ['contains', 'reads'] },
  run({ before }) {
    const correspondence: CorrespondenceEntry[] = [];
    const functions = before.value.functions.map(fn => {
      let statements = fn.statements;
      for (;;) {
        const uses = new Map<string, Stmt | null>([[fn.return, null]]);
        for (const stmt of statements)
          for (const e of expressions(stmt.expr))
            if (e.tag === 'load') {
              uses.set(e.load.tensor, uses.has(e.load.tensor) ? null : stmt);
            }
        // Work backwards: inline a chain at the final use without repeatedly copying the growing producer.
        let changed = false;
        for (let i = statements.length - 1; i >= 0; i--) {
          const producer = statements[i],
            user = uses.get(producer.name);
          if (!user || [...expressions(producer.expr)].some(e => e.tag === 'fold')) continue;
          try {
            const expr = substitute(producer, user);
            const candidate = statements
              .filter(s => s !== producer)
              .map(s => (s === user ? { ...s, expr } : s));
            validateTensor({ functions: [{ ...fn, statements: candidate }] });
            statements = candidate;
          } catch (e) {
            // Eliding a tensor can obscure a bounds proof that held in two stages.
            if (e instanceof UnprovenBounds || e instanceof AffineOverflow) continue;
            throw e;
          }
          correspondence.push({
            from: [tensorId(fn.name, producer.name)],
            to: [],
            relation: 'removed',
            note: `inlined into ${user.name}`,
          });
          changed = true;
          break;
        }
        if (!changed) return statements === fn.statements ? fn : { ...fn, statements };
      }
    });
    return correspondence.length
      ? { native: { functions }, correspondence, edits: correspondence.length }
      : undefined;
  },
});

function substitute(producer: Stmt, user: Stmt): Expr {
  return mapExpr(user.expr, site => {
    if (site.tag !== 'load' || site.load.tensor !== producer.name) return site;
    const bindings = new Map(producer.axes.map((a, i) => [a.id, site.load.subscripts[i]]));
    return mapExpr(producer.expr, e => {
      if (e.tag !== 'load') return e;
      const subscripts = e.load.subscripts.map(s =>
        s.terms.reduce<Affine>(
          (form, [axis, coeff]) => combine(form, bindings.get(axis)!, coeff, site.at),
          constant(s.constant),
        ),
      );
      return { ...e, load: { ...e.load, subscripts } };
    });
  });
}

const BLOCK_SIZE = 4;
export const splitSumPass = definePass<TensorIR>({
  mode: 'native',
  id: 'tensor.split-sum',
  version: '1',
  description: 'Reassociate single-axis sums into four-element blocks',
  adapter: indexedAdapter,
  ir: IndexedIR,
  writes: { entities: ['statement'], relations: [] },
  run({ before }) {
    let edits = 0;
    const functions = before.value.functions.map(fn => {
      const ids = new Set<string>();
      for (const stmt of fn.statements) {
        for (const axis of stmt.axes) ids.add(axis.id);
        for (const e of expressions(stmt.expr))
          if (e.tag === 'fold') for (const axis of e.axes) ids.add(axis.id);
      }
      const split = (e: Expr): Expr => {
        if (e.tag !== 'fold' || e.op !== 'sum' || e.axes.length !== 1 || e.axes[0].range.kind !== 'full')
          return e;
        const [axis] = e.axes;
        let block = `split:${axis.id}`;
        while (ids.has(block)) block += ':';
        ids.add(block);
        edits++;
        return {
          ...e,
          axes: [{ id: block, extent: axis.extent, range: { kind: 'blocks', size: BLOCK_SIZE } }],
          body: { ...e, axes: [{ ...axis, range: { kind: 'within', block, size: BLOCK_SIZE } }] },
        };
      };
      return { ...fn, statements: fn.statements.map(s => ({ ...s, expr: mapExpr(s.expr, split) })) };
    });
    return edits ? { native: { functions }, edits } : undefined;
  },
});
