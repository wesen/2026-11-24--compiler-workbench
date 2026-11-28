/**
 * Compile a rule table into a `Tx.rewrite` visitor (IRWB-006, B1; over the standard library since IRWB-060-B).
 *
 * The visitor reproduces a hand-written `switch (v.op) { … return … }` exactly: rules are indexed by the operator of
 * their pattern's root and tried in table order, the first rule whose pattern matches and whose guards hold
 * rewrites the node, and its replacement is made inside the visitor (so `from` is the visited node, as for
 * `tx.const`/`tx.make` called there) children first and left to right (so ids are allocated in the same order).
 * The guards call the predicates the hand-written passes call: `isPure`, `sameTree` (`handle.same`), `COMPARE`
 * (`handle.isBoolean`) and simplify's `isPow2`.
 *
 * Since IRWB-060-B the matching and the instantiation are the standard library's (`src/stdlib/term/`): a rule's
 * pattern and template are converted once into the library's `Pattern`/`Template` over **Typed's value-handle
 * signature**, `firstMatch` tries them with `guardHolds` as the guard function and `handle.same` (sameTree) as the
 * equality a `{same: x}` pattern uses, and `instantiate` builds the replacement through a `Builder` that closes over
 * the transaction. What stays here is everything that is Typed's and not the library's: the signature, the guards,
 * the provenance a made value carries, the derivation step a rule firing records, and the note its template's
 * `{k}`/`{log2 k}` placeholders are filled from.
 */
import {
  instantiate as instantiateIn,
  type Builder,
  type ConstantValue,
  type Pattern,
  type Template,
} from '../../stdlib/term/pattern.js';
import {
  firstMatch as firstMatchIn,
  indexRules as indexRulesIn,
  type Rule as LibraryRule,
  type RuleIndex,
} from '../../stdlib/term/rules.js';
import type { Bindings as BindingsOf } from '../../stdlib/term/pattern.js';
import { binop } from '../evaluate.js';
import { F32_FOLDABLE, f32Op } from '../f32.js';
import type { ValueOp } from '../model.js';
import { valueHandle, type MakeOptions, type Tx, type ValueHandle } from '../tx.js';
import type { Guard, Num, Pat, Rule, Tpl } from './form.js';

/** What a pattern bound: a variable's name and the value handle it stands for. */
export type Bindings = BindingsOf<ValueHandle>;

const MIN = -2147483648;
/** simplify's isPow2 and log2 (passes.ts): a positive power of two, so -2^31 is excluded. */
export const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
export const log2 = (n: number) => 31 - Math.clz32(n);

/**
 * Typed's signature: a value tree read as a term. The operator is the value's own (`add`, `mul`, `eqz`, …) and the
 * children are its operands in order; a `const` value is the only constant, and its immediate is the term's.
 */
export const valueSignature = {
  op: (h: ValueHandle) => h.op as string,
  args: (h: ValueHandle) => h.args,
  constant: (h: ValueHandle) => (h.isConst ? (h.imm as number) : undefined),
};
/** Typed's structural equality for a `{same: x}` pattern: `sameTree`, which also compares a value's type. */
const sameHandle = (a: ValueHandle, b: ValueHandle) => a.same(b);

export function guardHolds(g: Guard, b: Bindings): boolean {
  if ('pure' in g) return b.get(g.pure)!.isPure;
  if ('pow2' in g) return isPow2(b.get(g.pow2)!.imm as number);
  if ('boolean' in g) return b.get(g.boolean)!.isBoolean;
  const x = b.get(g.noTrap[0])!.imm as number,
    y = b.get(g.noTrap[1])!.imm as number;
  return !(y === 0 || (x === MIN && y === -1));
}
/** The library's guard hook: a rule's guards, over the bindings the match made. */
const guardsHold = (g: Guard, b: Bindings) => guardHolds(g, b);

/** The value of an operator on constants, as `fold` computes it: eqz, the f32 operators by f32Op, else binop. */
export function evalOp(op: string, args: readonly number[]): number {
  if (op === 'eqz') return +(args[0] === 0);
  if (F32_FOLDABLE.has(op)) return f32Op(op, args[0], args[1])!;
  return binop(op, args[0], args[1]);
}

/** A template number, given the immediates of the constant variables. */
export function numOf(n: Num, imm: (name: string) => number): number {
  if (typeof n === 'number') return n;
  if ('log2' in n) return log2(imm(n.log2));
  return evalOp(n.eval, n.args.map(imm));
}
/** The constant variables a computed template number reads. */
const numReads = (n: Num): readonly string[] =>
  typeof n === 'number' ? [] : 'log2' in n ? [n.log2] : n.args;

const noteOf = (text: string, b: Bindings): string =>
  text.replace(/\{(log2 )?([a-z]\w*)\}/g, (_m, l: string | undefined, x: string) => {
    const n = b.get(x)!.imm as number;
    return String(l ? log2(n) : n);
  });

/** The facts a rule's guards checked, as premises of the step (compile.ts's `pure`, `pow2`, `boolean`, `noTrap`). */
export function guardPremises(r: Rule, b: Bindings): string[] {
  return (r.where ?? []).map(g =>
    'pure' in g
      ? `guard:pure(${b.get(g.pure)!.id})`
      : 'pow2' in g
        ? `guard:pow2(${b.get(g.pow2)!.id})`
        : 'boolean' in g
          ? `guard:boolean(${b.get(g.boolean)!.id})`
          : `guard:noTrap(${g.noTrap[1]} at ${b.get(g.noTrap[0])!.id})`,
  );
}

/** The entities a rule's `because` names: the constant operands (`const-args`) or all operands (`args`). */
function becauseEntities(r: Rule, v: ValueHandle): string[] {
  const which =
    r.because === 'const-args' ? v.args.filter(x => x.isConst) : r.because === 'args' ? v.args : [];
  return which.map(x => x.id);
}

/** The site of a rule firing: the matched tree, as entity ids (the node and everything under it). */
function subtree(v: ValueHandle): string[] {
  return [v.id, ...v.args.flatMap(subtree)];
}

function provenance(r: Rule, v: ValueHandle, b: Bindings): MakeOptions {
  const because =
    r.because === 'const-args' ? v.args.filter(x => x.isConst) : r.because === 'args' ? v.args : undefined;
  return { ...(because ? { because } : {}), ...(r.note ? { note: noteOf(r.note, b) } : {}) };
}

// ---------- Typed's rules as library rules (converted once per rule) ----------
/** A Typed pattern as the library's, over Typed's signature. */
export const libraryPattern = (p: Pat): Pattern<ValueHandle> => {
  if ('var' in p) return { var: p.var };
  if ('constVar' in p) return { bindConst: p.constVar };
  if ('const' in p) return { const: p.const };
  if ('same' in p) return { same: p.same };
  return { op: p.op, args: p.args.map(libraryPattern) };
};
/** A Typed template as the library's, over Typed's signature. */
export const libraryTemplate = (t: Tpl): Template<ValueHandle> => {
  if ('var' in t) return { var: t.var };
  if ('const' in t) {
    const n = t.const,
      value: ConstantValue<ValueHandle> =
        typeof n === 'number'
          ? n
          : { compute: (b: Bindings) => numOf(n, x => b.get(x)!.imm as number), reads: numReads(n) };
    return { const: value, ...(t.type ? { attrs: { type: t.type } } : {}) };
  }
  return { op: t.op, args: t.args.map(libraryTemplate) };
};
const CONVERTED = new WeakMap<Rule, LibraryRule<ValueHandle, Guard>>();
/** A Typed rule as the library's: its name, pattern, guards and template. */
export function libraryRule(r: Rule): LibraryRule<ValueHandle, Guard> {
  let out = CONVERTED.get(r);
  if (!out)
    CONVERTED.set(
      r,
      (out = {
        name: r.name,
        lhs: libraryPattern(r.lhs),
        ...(r.where && r.where.length ? { where: r.where } : {}),
        rhs: libraryTemplate(r.rhs),
      }),
    );
  return out;
}
/** A table's rules, indexed by the operator of their pattern's root, as the library's `firstMatch` reads them. */
export function libraryIndex(rules: readonly Rule[]): RuleIndex<ValueHandle, Guard> {
  return indexRulesIn(rules.map(libraryRule));
}

/**
 * The builder a rule's replacement is made with: the transaction allocates the value (its id, its origin), the
 * template's `attrs` say what the node is (`{ type: 'f32' }` on an f32 constant), and the replacement's root also
 * carries the rule's provenance (`because`, `note`), as `Tx.make`'s options do.
 */
function builderFor(tx: Tx, r: Rule, v: ValueHandle, b: Bindings): Builder<ValueHandle> {
  const root = provenance(r, v, b),
    own = (attrs: unknown): MakeOptions => (attrs as MakeOptions | undefined) ?? {};
  return {
    constant: (value, attrs, outermost) =>
      valueHandle(tx.st, tx.const(value, outermost ? { ...root, ...own(attrs) } : own(attrs))),
    operator: (op, args, attrs, outermost) =>
      valueHandle(
        tx.st,
        tx.make(op as ValueOp, ...args.map(a => a.id), outermost ? { ...root, ...own(attrs) } : own(attrs)),
      ),
  };
}

/** Rule firings by rule name, collected by a visitor when the caller supplies the table. */
export type Firings = Map<string, number>;

/** The first rule of `index` that rewrites `v`, with its bindings and the node it matched, or undefined. */
export function firstMatch(
  index: RuleIndex<ValueHandle, Guard>,
  v: ValueHandle,
): { rule: LibraryRule<ValueHandle, Guard>; bindings: Bindings; node: ValueHandle } | undefined {
  return firstMatchIn(index, valueSignature, v, { guard: guardsHold, equal: sameHandle });
}

export function indexRules(rules: readonly Rule[]): RuleIndex<ValueHandle, Guard> {
  return libraryIndex(rules);
}

/**
 * A table as a function from a transaction to a `Tx.rewrite` visitor (IRWB-006, IRWB-056-B).
 *
 * The rule is applied under `tx.withRule`, so every entity its right-hand side makes is a derivation step of that
 * rule's, with the guards it checked and the operands its `because` names as the premises; an edit the `Tx.rewrite`
 * records cites the steps its field's walk took. A rule that makes nothing (`x + 0` becomes `x`) records an
 * in-place step whose site is the matched tree and the operand it produced. `table` is the rule set's name, so a
 * step names `simplify/mul-pow2` and not just a rule two tables could share.
 */
export function compileRules(
  rules: readonly Rule[],
  firings?: Firings,
  table?: string,
): (tx: Tx) => (v: ValueHandle) => string | undefined {
  const index = libraryIndex(rules),
    byName = new Map(rules.map(r => [r.name, r]));
  return tx => v => {
    const m = firstMatch(index, v);
    if (!m) return undefined;
    const typedRule = byName.get(m.rule.name)!;
    if (firings) firings.set(m.rule.name, (firings.get(m.rule.name) ?? 0) + 1);
    const by = { rule: m.rule.name, ...(table ? { table } : {}) };
    const premises = [...guardPremises(typedRule, m.bindings), ...becauseEntities(typedRule, v)];
    const note = typedRule.note ? noteOf(typedRule.note, m.bindings) : undefined;
    const site = subtree(v);
    const active = { by, premises, site, ...(note ? { note } : {}) };
    return tx.withRule(active, () => {
      const made = tx.steps.length;
      const out = instantiateIn(m.rule.rhs, m.bindings, builderFor(tx, typedRule, v, m.bindings), v);
      // the rule produced an entity it consumed again: the rewrite is recorded, though no entity was made
      if (tx.steps.length === made) tx.inPlace(active, site, out.id);
      return out.id;
    });
  };
}

/** The body of a table-driven pass: one `Tx.rewrite` over every statement of the function. */
export function tableBody(
  rules: readonly Rule[],
  firings?: Firings,
  table?: string,
): (ctx: { tx: Tx }) => void {
  const visitor = compileRules(rules, firings, table);
  return ({ tx }) => tx.rewrite(visitor(tx));
}
