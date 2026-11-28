import type { Artifact } from '../framework/core/types.js';
import { transformation, type EnsuresCheck, type Transformation } from '../framework/passes/index.js';
import { makeDerivation, type Derivation, type DerivationStep } from '../framework/ir/derivation.js';
import { meaningGate, type Relation } from './contract.js';
import { adapter, TixIR } from './ir.js';
import {
  add,
  mapExpr,
  substitute,
  variable,
  visit,
  width,
  type Affine,
  type Expr,
  type Fn,
  type Module,
} from './model.js';

function replaceIndices(expr: Expr, bindings: Map<string, Affine>): Expr {
  return mapExpr(expr, e =>
    e.kind === 'load' ? { ...e, indices: e.indices.map(a => substitute(a, bindings)) } : e,
  );
}
/** One merge `inline` made: the statement `from` was substituted into the statement `into`, which then removed it. */
export interface Merge {
  readonly fn: string;
  readonly from: string;
  readonly into: string;
}

/** `inline`'s output and the merges it made, in the order it made them (IRWB-056-B: a derivation step each). */
function inline(fn: Fn): { fn: Fn; merges: readonly { from: string; into: string }[] } {
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
    statements[consumer] = {
      ...s,
      expr: mapExpr(s.expr, e => {
        if (e.kind !== 'load' || e.name !== p.name) return e;
        return replaceIndices(p.expr, new Map(p.axes.map((a, k) => [a.id, e.indices[k]])));
      }),
    };
    statements.splice(i--, 1);
    merges.push({ from: p.name, into: s.name });
  }
  return { fn: { ...fn, statements }, merges };
}
function split(fn: Fn): Fn {
  return {
    ...fn,
    statements: fn.statements.map(s => ({
      ...s,
      expr: mapExpr(s.expr, e => {
        if (e.kind !== 'reduce' || e.op !== 'sum' || e.axes.length !== 1) return e;
        const [{ id, extent }] = e.axes;
        if (extent.kind !== 'dim') return e;
        const { dim } = extent,
          block = id + '/block',
          lane = id + '/lane';
        const address = add(variable(lane), variable(block), width);
        const body = replaceIndices(e.body, new Map([[id, address]]));
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
      }),
    })),
  };
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
 * `inline`, with the merge it made for every statement it substituted: `f/a` was merged into `f/b`. The step's
 * relation is `merged`, and the correspondence it implies is the one the two projections give (the merged statement
 * is gone, its consumer stays and was updated): what the derivation adds is the link the correspondence cannot state,
 * which `derivationOf`/`mergedInto` answer from the steps.
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
    return {
      native: { functions },
      ...(merges.length
        ? {
            derivation: makeDerivation(
              'inline',
              merges.map(
                (m): DerivationStep => ({
                  by: { decision: 'inline.merge' },
                  consumes: [`${m.fn}/${m.from}`],
                  produces: [`${m.fn}/${m.into}`],
                  premises: [],
                  relation: 'merged',
                  note: `${m.fn}/${m.from} is substituted into ${m.fn}/${m.into}, which returns its result`,
                }),
              ),
            ),
          }
        : {}),
      edits: merges.length * 2,
    };
  },
};

/** The statement each removed Tix entity was merged into, from a pass application's derivation (empty without one). */
export function mergedInto(derivation: Derivation | undefined): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const step of derivation?.steps ?? [])
    if (step.relation === 'merged' && step.consumes.length && step.produces.length)
      out.set(step.consumes[0], step.produces[0]);
  return out;
}

export const splitPass = pass('split-sum', 'tolerance', split);
