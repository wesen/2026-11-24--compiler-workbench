/**
 * Rewrite rules over value trees as data (IRWB-006, agenda item B1).
 *
 * A rule is a name, a pattern (the left-hand side), a guard (conditions the shape cannot express), a replacement
 * template (the right-hand side) and the provenance its outermost made value carries. Rules are plain, frozen,
 * JSON-serializable objects: the workbench lists them, the verifier (verify.ts) evaluates them, and the compiler
 * (compile.ts) turns a table of them into a `Tx.rewrite` visitor that reproduces the hand-written passes exactly.
 *
 *   pattern     { var: x }         any tree, bound to x
 *               { const: n }       a const value with immediate n
 *               { constVar: k }    any const value, bound to k (its immediate is the number)
 *               { same: x }        a tree structurally equal (sameTree) to the one bound to x
 *               { op, args }       an operator applied to sub-patterns
 *   guard       { pure: x }        the tree bound to x can be evaluated or dropped without effect (isPure)
 *               { pow2: k }        k is 2^j with 0 <= j <= 30 (simplify's isPow2: n > 0 && n & (n-1) == 0)
 *               { boolean: x }     the tree bound to x is a comparison, so its value is 0 or 1
 *               { noTrap: [a, b], op }   op(a, b) would not trap (div, rem: b != 0 and not MIN / -1)
 *   template    { var: x }         the bound tree itself (no new value)
 *               { const: num }     tx.const; num is a number, { log2: k } or { eval: op, args } (the evaluator)
 *               { op, args }       tx.make, sub-templates first, left to right
 */
import type { NodePattern } from '../../framework/ir/patterns.js';
import { capture, entity, op as nodeOp } from '../../framework/ir/patterns.js';
import { SYMBOL } from '../listing.js';
import type { ValueOp } from '../model.js';

/** The declared type of a pattern variable: an i32, the bits of an f32, or an i32 that is 0 or 1. */
export type VarType = 'i32' | 'f32' | 'bool';

export type Pat =
  | { readonly var: string }
  | { readonly const: number }
  | { readonly constVar: string }
  | { readonly same: string }
  | OpPat;
export interface OpPat {
  readonly op: ValueOp;
  readonly args: readonly Pat[];
}

export type Guard =
  | { readonly pure: string }
  | { readonly pow2: string }
  | { readonly boolean: string }
  | { readonly noTrap: readonly [string, string]; readonly op: 'div' | 'rem' };

/** A number computed from the immediates of constant variables. */
export type Num =
  | number
  | { readonly log2: string }
  | { readonly eval: ValueOp; readonly args: readonly string[] };

export type Tpl =
  | { readonly var: string }
  | { readonly const: Num; readonly type?: 'f32' }
  | { readonly op: ValueOp; readonly args: readonly Tpl[] };

export interface Rule {
  readonly name: string;
  readonly version: string;
  readonly about: string;
  /** Every variable of the pattern (var, constVar) with its declared type. */
  readonly types: Readonly<Record<string, VarType>>;
  readonly lhs: OpPat;
  readonly where?: readonly Guard[];
  readonly rhs: Tpl;
  /**
   * The `because` of the outermost made value: the constant operands of the matched node in operand order
   * (simplify's `note(text)`), or all its operands (fold). Absent: none. Values made below it carry none.
   */
  readonly because?: 'const-args' | 'args';
  /** The note of the outermost made value; `{k}` is a constant variable's immediate, `{log2 k}` its log2. */
  readonly note?: string;
}

export interface RuleSet {
  readonly name: string;
  readonly version: string;
  readonly about: string;
  readonly rules: readonly Rule[];
  /** A declared property of the whole set, e.g. that no rule has an f32 root operator. */
  readonly property?: string;
}

const deepFreeze = <T>(x: T): T => {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
};

// ---------- builders ----------
export const v = (name: string) => ({ var: name }) as const;
export const kv = (name: string) => ({ constVar: name }) as const;
export const same = (name: string) => ({ same: name }) as const;
export function c(n: number): { readonly const: number };
export function c(n: Num, type?: 'f32'): { readonly const: Num; readonly type?: 'f32' };
export function c(n: Num, type?: 'f32') {
  return type ? { const: n, type } : { const: n };
}
/**
 * An operator node, usable as a pattern or as a template; which one is checked at run time by `rule` (checkRule),
 * not by the type, so one builder serves both sides of a rule.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function op(
  name: ValueOp,
  ...args: (Pat | Tpl)[]
): { readonly op: ValueOp; readonly args: readonly any[] } {
  return { op: name, args };
}

export function rule(
  name: string,
  types: Readonly<Record<string, VarType>>,
  lhs: OpPat,
  rhs: Tpl,
  opts: {
    readonly about?: string;
    readonly where?: readonly Guard[];
    readonly because?: 'const-args' | 'args';
    readonly note?: string;
    readonly version?: string;
  } = {},
): Rule {
  const r: Rule = {
    name,
    version: opts.version ?? '1',
    about: opts.about ?? `${patText(lhs)} → ${tplText(rhs)}`,
    types,
    lhs,
    ...(opts.where && opts.where.length ? { where: opts.where } : {}),
    rhs,
    ...(opts.because ? { because: opts.because } : {}),
    ...(opts.note ? { note: opts.note } : {}),
  };
  checkRule(r);
  return deepFreeze(r);
}

export function ruleSet(
  name: string,
  about: string,
  rules: readonly Rule[],
  opts: { version?: string; property?: string } = {},
): RuleSet {
  const names = new Set<string>();
  for (const r of rules) {
    if (names.has(r.name)) throw new Error(`rule set ${name}: duplicate rule name ${r.name}`);
    names.add(r.name);
  }
  return deepFreeze({
    name,
    version: opts.version ?? '1',
    about,
    rules: [...rules],
    ...(opts.property ? { property: opts.property } : {}),
  });
}

// ---------- well-formedness ----------
/** The variables a pattern binds (var, constVar), in left-to-right order, and the repeats (same). */
export function patternVars(
  p: Pat,
  out: { binds: string[]; repeats: string[] } = { binds: [], repeats: [] },
) {
  if ('var' in p) out.binds.push(p.var);
  else if ('constVar' in p) out.binds.push(p.constVar);
  else if ('same' in p) out.repeats.push(p.same);
  else if ('op' in p) for (const a of p.args) patternVars(a, out);
  return out;
}
/** The variables a template uses, in left-to-right order (with repetition), and the constant variables it reads. */
export function templateVars(t: Tpl, out: { uses: string[]; consts: string[] } = { uses: [], consts: [] }) {
  if ('var' in t) out.uses.push(t.var);
  else if ('const' in t) {
    const n = t.const;
    if (typeof n === 'object') {
      if ('log2' in n) out.consts.push(n.log2);
      else out.consts.push(...n.args);
    }
  } else for (const a of t.args) templateVars(a, out);
  return out;
}

function checkRule(r: Rule): void {
  const fail = (m: string) => {
    throw new Error(`rule ${r.name}: ${m}`);
  };
  if (!/^[a-z0-9-]+$/.test(r.name)) fail('a rule name is lower-case letters, digits and dashes');
  const isPat = (p: Pat): boolean =>
    'var' in p || 'constVar' in p || 'same' in p
      ? true
      : 'const' in p
        ? typeof p.const === 'number' && !('type' in p)
        : 'op' in p && p.args.every(isPat);
  const isTpl = (t: Tpl): boolean =>
    'var' in t || 'const' in t ? !('constVar' in t) : 'op' in t && t.args.every(isTpl);
  if (!('op' in r.lhs) || !isPat(r.lhs)) fail('the pattern must be an operator over patterns');
  if (!isTpl(r.rhs) || JSON.stringify(r.rhs).match(/"(constVar|same)"/))
    fail('the replacement may use variables, constants and operators only');
  const { binds, repeats } = patternVars(r.lhs);
  if (new Set(binds).size !== binds.length) fail('a variable is bound twice; use same(x) for a repeat');
  for (const x of repeats) if (!binds.includes(x)) fail(`same(${x}) before ${x} is bound`);
  for (const x of binds) if (!r.types[x]) fail(`variable ${x} has no declared type`);
  for (const x of Object.keys(r.types)) if (!binds.includes(x)) fail(`declared variable ${x} is not bound`);
  const { uses, consts } = templateVars(r.rhs);
  for (const x of [...uses, ...consts]) if (!binds.includes(x)) fail(`the replacement uses unbound ${x}`);
  const constVars = new Set<string>();
  const walk = (p: Pat) => {
    if ('constVar' in p) constVars.add(p.constVar);
    else if ('op' in p) p.args.forEach(walk);
  };
  walk(r.lhs);
  for (const x of consts)
    if (!constVars.has(x)) fail(`${x} is used as a number but is not a constant variable`);
  for (const g of r.where ?? []) {
    const names = 'pure' in g ? [g.pure] : 'pow2' in g ? [g.pow2] : 'boolean' in g ? [g.boolean] : g.noTrap;
    for (const x of names) if (!binds.includes(x)) fail(`guard on unbound ${x}`);
    if ('pow2' in g && !constVars.has(g.pow2)) fail(`pow2(${g.pow2}) needs a constant variable`);
    if ('noTrap' in g && !g.noTrap.every(x => constVars.has(x))) fail('noTrap needs constant variables');
  }
}

// ---------- text ----------
const numText = (n: Num): string =>
  typeof n === 'number' ? String(n) : 'log2' in n ? `log2 ${n.log2}` : `${n.eval}(${n.args.join(', ')})`;
export function patText(p: Pat): string {
  if ('var' in p) return p.var;
  if ('constVar' in p) return `#${p.constVar}`;
  if ('const' in p) return String(p.const);
  if ('same' in p) return p.same;
  return `${p.op}(${p.args.map(patText).join(', ')})`;
}
export function tplText(t: Tpl): string {
  if ('var' in t) return t.var;
  if ('const' in t) return typeof t.const === 'number' ? String(t.const) : `#${numText(t.const)}`;
  return `${t.op}(${t.args.map(tplText).join(', ')})`;
}
export function guardText(g: Guard): string {
  if ('pure' in g) return `pure ${g.pure}`;
  if ('pow2' in g) return `pow2 ${g.pow2}`;
  if ('boolean' in g) return `bool ${g.boolean}`;
  return `no trap(${g.noTrap.join(', ')})`;
}
/** A rule as one line: `mul(x, #k) → shl(x, #log2 k) if pow2 k`. */
export function ruleText(r: Rule): string {
  const where = r.where?.length ? ` if ${r.where.map(guardText).join(', ')}` : '';
  return `${patText(r.lhs)} → ${tplText(r.rhs)}${where}`;
}

/** The comparison inversions simplify applies under eqz, with their notes (`!(<) is >=`). */
export const COMPARE_INVERSE: readonly (readonly [ValueOp, ValueOp])[] = [
  ['lt', 'ge'],
  ['ge', 'lt'],
  ['gt', 'le'],
  ['le', 'gt'],
  ['eq', 'ne'],
  ['ne', 'eq'],
  ['ltu', 'geu'],
  ['geu', 'ltu'],
];
export const inversionNote = (a: ValueOp, b: ValueOp) => `!(${SYMBOL[a]}) is ${SYMBOL[b]}`;

// ---------- the framework's pattern language ----------
/**
 * The rule's pattern as a framework `NodePattern` (src/framework/ir/patterns.ts), for listing and for matching on a
 * projection with `searchPattern`. A variable becomes a capture, a constant literal `entity('value.const', { imm })`,
 * a constant variable a capture of a const entity. `exact` is false when the pattern has a repeat: the framework's
 * `sameAs` binds the same entity again, and its `equalContent` compares one entity's attributes (including its
 * origin), neither of which is simplify's structural equality, so the converted pattern matches a superset.
 */
export function toNodePattern(r: Rule): { pattern: NodePattern; exact: boolean } {
  let exact = true;
  const conv = (p: Pat): NodePattern => {
    if ('var' in p) return capture(p.var);
    if ('constVar' in p) return capture(p.constVar, entity('value.const'));
    if ('const' in p) return entity('value.const', { imm: p.const });
    if ('same' in p) {
      exact = false;
      return capture(`${p.same}'`);
    }
    return nodeOp(p.op, ...p.args.map(conv));
  };
  const pattern = conv(r.lhs);
  return { pattern, exact };
}
