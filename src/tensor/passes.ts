import type { Artifact } from '../framework/core/types.js';
import type { CorrespondenceEntry, EntityCorrespondence } from '../framework/ir/index.js';
import type { Derivation } from '../framework/ir/derivation.js';
import { transformation, type EnsuresCheck, type Transformation } from '../framework/passes/index.js';
import { meaningGate, type Relation } from './contract.js';
import { adapter, TixIR } from './ir.js';
import { visit, type Fn, type Module } from './model.js';
import { indexOf, inlineRule, rewriteExpr, rewriteFn, splitSumRule } from './rules.js';

/** One merge `inline` made: the statement `from` was substituted into the statement `into`, which then removed it. */
export interface Merge {
  readonly fn: string;
  readonly from: string;
  readonly into: string;
}

/**
 * `inline`'s output and the merges it made, in the order it made them: a statement that is pointwise and read
 * exactly once is substituted into its reader. The rewrite itself is the rule `rules.ts` builds for that producer
 * (`load f/a(i) → body[i]`), applied by the library's matcher; what the pass decides is the rule's side condition,
 * which is about the statement list and not about any term.
 */
export function inline(fn: Fn): { fn: Fn; merges: readonly { from: string; into: string }[] } {
  const statements = [...fn.statements];
  const merges: { from: string; into: string }[] = [];
  for (let i = 0; i < statements.length; i++) {
    const p = statements[i];
    if (p.name === fn.result) continue;
    let pointwise = true;
    visit(p.expr, e => {
      if (e.kind === 'reduce') pointwise = false;
    });
    if (!pointwise) continue;
    let uses = 0,
      consumer = -1;
    for (let j = i + 1; j < statements.length; j++)
      visit(statements[j].expr, e => {
        if (e.kind === 'load' && e.name === p.name) {
          uses++;
          consumer = j;
        }
      });
    if (uses !== 1) continue;
    const s = statements[consumer];
    statements[consumer] = { ...s, expr: rewriteExpr(s.expr, indexOf([inlineRule(p)])) };
    statements.splice(i--, 1);
    merges.push({ from: p.name, into: s.name });
  }
  return { fn: { ...fn, statements }, merges };
}

export type TixPass = Transformation<Module>;

/**
 * The Tix meaning gate, as the obligation every Tix pass carries (F27; the one encoding of the gate since
 * IRWB-052). It reads the relation the pass declares and the origin the application supplies (`inputs.origin`), so
 * no caller builds the gate from the pass's name, and it runs wherever the pass does: `optimizeTix`, a strategy
 * plan, either driver.
 */
export const tixMeaning: EnsuresCheck<Module, unknown> = {
  id: 'tix.meaning-gate',
  check({ before, candidate, relation, inputs }) {
    if (!inputs.origin) throw new Error('tix.meaning-gate needs inputs.origin');
    return meaningGate(inputs.origin as Artifact<Module>, relation)(before, candidate);
  },
};
function pass(name: string, relation: Relation, transform: (fn: Fn) => Fn): TixPass {
  return transformation<Module>({
    id: 'tensor.' + name,
    version: '1',
    description: name,
    ir: TixIR,
    adapter,
    writes: { entities: ['tensor'], relations: ['reads', 'contains'] },
    relation,
    prepare: ({ before }) => ({ native: { functions: before.value.functions.map(transform) } }),
    obligations: { ensures: [tixMeaning] },
  });
}

/**
 * The correspondence entries of `inline`'s merges (F40): the merged statement maps to the statement that absorbed it,
 * with relation `merged`, which is what happened — the reader was rewritten to return the merged result and the
 * producer is gone. A producer can be absorbed by a consumer that is itself merged later, so each merge is resolved
 * to its final survivor before it is published: a correspondence entry names an entity the new revision has.
 */
export function mergeEntries(merges: readonly Merge[]): CorrespondenceEntry[] {
  const into = new Map<string, string>();
  for (const m of merges) into.set(`${m.fn}/${m.from}`, `${m.fn}/${m.into}`);
  return [...into].map(([id, consumer]) => {
    let final = consumer;
    while (into.has(final)) final = into.get(final)!;
    return { from: [id], to: [final], relation: 'merged' };
  });
}

/**
 * `inline`, with the correspondence its merges imply: every statement it substituted says `merged` into its reader
 * (F40; before IRWB-060-B the entries came from the two projections' completion, which said `removed` and left the
 * link only in a derivation). What the pass reports besides the candidate is how many edits it made; the meaning
 * gate is its check.
 */
export const inlinePass: TixPass = {
  ...pass('inline', 'exact', fn => inline(fn).fn),
  prepare({ before }) {
    const merges: Merge[] = [];
    const functions = before.value.functions.map(fn => {
      const out = inline(fn);
      for (const m of out.merges) merges.push({ fn: fn.name, ...m });
      return out.fn;
    });
    const entries = mergeEntries(merges);
    return {
      native: { functions },
      ...(entries.length ? { correspondence: entries } : {}),
      edits: merges.length * 2,
    };
  },
};

/**
 * The statement each merged Tix entity was merged into (F40): the `merged` entries of a correspondence, or the
 * `merged` steps of a derivation (the shape IRWB-056-B recorded it in). Empty when the source carries neither.
 */
export function mergedInto(
  source: Derivation | EntityCorrespondence | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!source) return out;
  if ('steps' in source) {
    for (const step of source.steps)
      if (step.relation === 'merged' && step.consumes.length && step.produces.length)
        out.set(step.consumes[0], step.produces[0]);
    return out;
  }
  for (const entry of source.entries)
    if (entry.relation === 'merged' && entry.from.length === 1 && entry.to.length === 1)
      out.set(entry.from[0], entry.to[0]);
  return out;
}

/** `split-sum`, as the rule `rules.ts` states: a single-dimension sum over blocks of a sum over lanes. */
export const splitPass = pass('split-sum', 'tolerance', fn => rewriteFn(fn, indexOf([splitSumRule])));
