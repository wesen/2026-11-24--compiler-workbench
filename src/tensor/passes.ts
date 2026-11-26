import { definePass } from '../framework/passes/index.js';
import type { NativeResult, Pass } from '../framework/passes/index.js';
import type { CorrespondenceEntry } from '../framework/ir/index.js';
import { AffineBoundsError, validateModule } from './check.js';
import { tensorAdapter, TensorIR } from './ir.js';
import { AffineRangeError, mapChildren, substitute, walk } from './model.js';
import type { Expr, TensorModule } from './model.js';

export type TensorPass = Pass<TensorModule, {}, unknown>;

const containsReduction = (expr: Expr) => {
  for (const e of walk(expr)) if (e.op === 'sum' || e.op === 'max' || e.op === 'blockedSum') return true;
  return false;
};

export const inline = definePass({
  id: 'tensor.inline',
  version: '1',
  description: 'Substitute a single-use pointwise tensor at its load coordinates',
  ir: TensorIR,
  adapter: tensorAdapter,
  writes: { entities: ['statement', 'axis', 'expr.*'], relations: ['contains', 'reads', 'binds'] },
  run({ before }): NativeResult<TensorModule> | undefined {
    const correspondence: CorrespondenceEntry[] = [];
    let changed = false;
    const functions = before.value.functions.map(fn => {
      let statements = fn.statements;
      // Work backwards so a substituted producer can itself receive substitutions from earlier tensors.
      for (let i = statements.length - 1; i >= 0; i--) {
        const producer = statements[i];
        if (producer.id === fn.result || containsReduction(producer.expr)) continue;
        const uses = statements.flatMap((s, consumer) =>
          [...walk(s.expr)].flatMap(e =>
            e.op === 'load' && e.tensor === producer.id ? [{ consumer, e }] : [],
          ),
        );
        if (uses.length !== 1) continue;
        const { consumer, e: load } = uses[0];
        const axes = new Map(producer.axes.map((a, axis) => [a.id, load.subs[axis]]));
        const links: CorrespondenceEntry[] = [];
        const clone = (e: Expr): Expr => {
          const id = `${load.id}/${e.id}`;
          links.push({ from: [e.id], to: [id], relation: 'inline-copy' });
          return e.op === 'load'
            ? { ...e, id, subs: e.subs.map(s => substitute(s, key => axes.get(key)!, e.at)) }
            : mapChildren({ ...e, id }, clone);
        };
        try {
          const replacement = clone(producer.expr);
          const rewrite = (e: Expr): Expr => (e.id === load.id ? replacement : mapChildren(e, rewrite));
          const candidate = statements
            .map((s, j) => (j === consumer ? { ...s, expr: rewrite(s.expr) } : s))
            .filter((_, j) => i !== j);
          // Replacing the load can collapse multiple range assumptions into one harder inequality.
          // Leave this producer alone if the static checker cannot re-establish representable bounds.
          validateModule({ functions: [{ ...fn, statements: candidate }] });
          statements = candidate;
          correspondence.push(...links, { from: [load.id], to: [replacement.id], relation: 'substitute' });
          changed = true;
        } catch (e) {
          if (!(e instanceof AffineBoundsError || e instanceof AffineRangeError)) throw e;
        }
      }
      return statements === fn.statements ? fn : { ...fn, statements };
    });
    if (!changed) return;
    // A later substitution can replace an intermediate expression created in this pass. Trace it through
    // to surviving IDs; the framework accounts for untouched and deleted entities.
    const original = new Set(
      before.value.functions.flatMap(f => f.statements.flatMap(s => [...walk(s.expr)].map(e => e.id))),
    );
    const live = new Set(functions.flatMap(f => f.statements.flatMap(s => [...walk(s.expr)].map(e => e.id))));
    const next = new Map(correspondence.map(c => [c.from[0], c]));
    const survivor = (id: string): string | undefined =>
      live.has(id) ? id : next.has(id) ? survivor(next.get(id)!.to[0]) : undefined;
    return {
      native: { functions },
      correspondence: correspondence.flatMap(c => {
        const to = original.has(c.from[0]) && survivor(c.to[0]);
        return to ? [{ ...c, to: [to] }] : [];
      }),
    };
  },
});

export const splitSum = definePass({
  id: 'tensor.split-sum',
  version: '1',
  description: 'Use ordered four-element partial sums then sum the partials',
  ir: TensorIR,
  adapter: tensorAdapter,
  writes: { entities: ['expr.sum', 'expr.blockedSum'], relations: [] },
  run({ before }): NativeResult<TensorModule> | undefined {
    let edits = 0;
    const correspondence: CorrespondenceEntry[] = [];
    const rewrite = (expr: Expr): Expr => {
      const e = mapChildren(expr, rewrite);
      if (e.op !== 'sum' || e.axes.length !== 1) return e;
      edits++;
      correspondence.push({ from: [e.id], to: [e.id], relation: 'blocked-sum' });
      return { id: e.id, at: e.at, op: 'blockedSum', axis: e.axes[0], blockSize: 4, body: e.body };
    };
    const functions = before.value.functions.map(f => ({
      ...f,
      statements: f.statements.map(s => ({ ...s, expr: rewrite(s.expr) })),
    }));
    if (edits) return { native: { functions }, correspondence, edits };
  },
});
