/**
 * Tix's rewrites as rules over its expression signature (IRWB-060-B, IRWB-039 phase 4 item 4.6).
 *
 * Both Tix passes used to be hand-written tree walks (`mapExpr` with a body that recognised one shape). They are
 * rules now, applied through the standard library's matcher (`src/stdlib/term/`): the pattern says which
 * expressions a rule matches, the template says what replaces them, and `rewriteExpr` is the one place a rule meets
 * a tree. What stays here is what only Tix knows:
 *
 *   - the **signature**: an expression read as a term. The operator label carries the attributes a pattern cannot
 *     reach — a read's tensor and arity (`load:f/a/2`), a reduction's operator (`reduce:sum`) — so a rule names
 *     them without the library knowing what a tensor is. Axes are *not* children: a reduction's body is its only
 *     child, because an axis is a binder, not a subterm.
 *   - the **guards** (`singleDimAxis`) and the **templates** (`build`), because both rules need something a
 *     first-order template cannot state: the axes of the matched reduction, and the substitution of a producer's
 *     indices at the reader's index expressions.
 *   - the **walk** (`mapExpr`, the domain's, bottom-up: children first, the replacement not revisited).
 *
 * Neither rule is run through `verifyRule`. `split-sum` is a reassociation over a binder whose two sides agree only
 * within the tolerance the pass declares, and `inline` is a use-count property of a statement list rather than an
 * equation between terms; the pass-level meaning gate (`tix.meaning-gate`) remains the check for both.
 */
import {
  instantiate,
  type Bindings,
  type Builder,
  type Pattern,
  type Template,
} from '../stdlib/term/pattern.js';
import { firstMatch, indexRules, type Rule, type RuleIndex } from '../stdlib/term/rules.js';
import type { Signature } from '../stdlib/term/signature.js';
import {
  add,
  mapExpr,
  substitute,
  variable,
  width,
  type Affine,
  type Axis,
  type Expr,
  type Fn,
  type Op,
} from './model.js';

/** A read of the tensor `name` at `arity` indices: the label a pattern names. */
export const loadLabel = (name: string, arity: number) => `load:${name}/${arity}`;
/** The label of an operator expression: its operator and arity (`op:+/2`). */
const opLabel = (op: Op, arity: number) => `op:${op}/${arity}`;

/**
 * A Tix expression as a term. `args` are the operator's operands and a reduction's body; a read's indices are affine
 * forms over the axes in scope, not expressions, so a read is a leaf whose label names the tensor and its arity.
 */
export const exprSignature: Signature<Expr> = {
  op: e =>
    e.kind === 'literal'
      ? `literal:${e.text}`
      : e.kind === 'shape'
        ? `shape:${e.name}`
        : e.kind === 'load'
          ? loadLabel(e.name, e.indices.length)
          : e.kind === 'op'
            ? opLabel(e.op, e.args.length)
            : `reduce:${e.op}`,
  args: e => (e.kind === 'op' ? e.args : e.kind === 'reduce' ? [e.body] : []),
  constant: e => (e.kind === 'literal' ? Number(e.text) : undefined),
};

/**
 * Tix's rules make their replacements with a `build` template, so this builder states the two cases that would need
 * the label to be readable back into an expression — and it is not: `load:f/a/2` does not say which affine forms the
 * indices are, and a reduction's axes are not in its label. A rule that had to make a node would carry a `build`.
 */
const nodesNotInLabels: Builder<Expr> = {
  constant: () => {
    throw new Error('a Tix rule template that makes a constant must use a `build` template');
  },
  operator: () => {
    throw new Error('a Tix rule template that makes an operator must use a `build` template');
  },
};

/** The guards a Tix rule can name. */
export type ExprGuard = { readonly singleDimAxis: true };

/** The domain's guard hook: read off the matched node, which is where a reduction's axes are. */
const guardHolds = (g: ExprGuard, _b: Bindings<Expr>, node: Expr): boolean =>
  g.singleDimAxis
    ? node.kind === 'reduce' && node.axes.length === 1 && node.axes[0].extent.kind === 'dim'
    : false;

/** `expr` with every read of `name` at `indices` replaced by `body`'s loads at those indices. */
export function replaceIndices(expr: Expr, bindings: Map<string, Affine>): Expr {
  return mapExpr(expr, e =>
    e.kind === 'load' ? { ...e, indices: e.indices.map(a => substitute(a, bindings)) } : e,
  );
}

/** A reduction over one dimension, split into a sum over blocks of a sum over the block's lanes. */
function splitBody(body: Expr, node: Extract<Expr, { kind: 'reduce' }>): Expr {
  const [{ id, extent }] = node.axes;
  if (extent.kind !== 'dim')
    throw new Error('split-sum: the guard admitted a reduction whose axis is not a dimension');
  const { dim } = extent,
    block = id + '/block',
    lane = id + '/lane',
    address = add(variable(lane), variable(block), width);
  return {
    kind: 'reduce',
    op: 'sum',
    axes: [{ id: block, extent: { kind: 'blocks', dim, rounding: 'ceil' } }],
    body: {
      kind: 'reduce',
      op: 'sum',
      axes: [{ id: lane, extent: { kind: 'tail', dim, block } }],
      body: replaceIndices(body, new Map([[id, address]])),
    },
  };
}

/**
 * `sum(i, body)` over a single dimension becomes `sum(block, sum(lane, body[block + lane]))`. The rule's guard is the
 * shape condition the hand-written pass tested inline; the template is the domain's because the two new axes are not
 * subtrees of anything that was matched.
 */
export const splitSumRule: Rule<Expr, ExprGuard> = {
  name: 'split-sum',
  lhs: { op: 'reduce:sum', args: [{ var: 'body' }] },
  where: [{ singleDimAxis: true }],
  rhs: {
    build: (b, node) => splitBody(b.get('body')!, node as Extract<Expr, { kind: 'reduce' }>),
  },
};

/**
 * A read of the statement `producer`, whose axes are `axes`, becomes the producer's expression with its axes
 * substituted by the read's indices. Whether that is legal — the producer is pointwise and read exactly once — is a
 * property of the statement list, which the pass checks before it builds this rule; the rewrite itself is local.
 */
export function inlineRule(producer: {
  readonly name: string;
  readonly expr: Expr;
  readonly axes: readonly Axis[];
}): Rule<Expr, ExprGuard> {
  const lhs: Pattern<Expr> = { op: loadLabel(producer.name, producer.axes.length), args: [] };
  const rhs: Template<Expr> = {
    build: (b, node) => {
      const read = node as Extract<Expr, { kind: 'load' }>,
        bindings = new Map(producer.axes.map((a, k): [string, Affine] => [a.id, read.indices[k]]));
      void b;
      return replaceIndices(producer.expr, bindings);
    },
  };
  return { name: 'inline', lhs, rhs };
}

/** An expression rewritten bottom-up by a rule index: children first, the first matching rule at each node. */
export function rewriteExpr(expr: Expr, index: RuleIndex<Expr, ExprGuard>): Expr {
  return mapExpr(expr, e => {
    const m = firstMatch(index, exprSignature, e, { guard: guardHolds });
    return m ? instantiate(m.rule.rhs, m.bindings, nodesNotInLabels, e) : e;
  });
}

/** Every expression of a function rewritten by one rule index. */
export function rewriteFn(fn: Fn, index: RuleIndex<Expr, ExprGuard>): Fn {
  return { ...fn, statements: fn.statements.map(s => ({ ...s, expr: rewriteExpr(s.expr, index) })) };
}

/** A list of rules as the index `rewriteExpr` reads. */
export const indexOf = (rules: readonly Rule<Expr, ExprGuard>[]): RuleIndex<Expr, ExprGuard> =>
  indexRules(rules);
