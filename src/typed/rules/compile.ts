/**
 * Compile a rule table into a `Tx.rewrite` visitor (IRWB-006, B1).
 *
 * The visitor reproduces a hand-written `switch (v.op) { … return … }` exactly: rules are indexed by the operator of
 * their pattern's root and tried in table order, the first rule whose pattern matches and whose guards hold
 * rewrites the node, and its replacement is made inside the visitor (so `from` is the visited node, as for
 * `tx.const`/`tx.make` called there) children first and left to right (so ids are allocated in the same order).
 * The guards call the predicates the hand-written passes call: `isPure`, `sameTree` (`handle.same`), `COMPARE`
 * (`handle.isBoolean`) and simplify's `isPow2`.
 */
import { binop } from '../evaluate.js';
import { F32_FOLDABLE, f32Op } from '../f32.js';
import type { MakeOptions, Tx, ValueHandle } from '../tx.js';
import type { Guard, Num, Pat, Rule, Tpl } from './form.js';

export type Bindings = Record<string, ValueHandle>;

const MIN = -2147483648;
/** simplify's isPow2 and log2 (passes.ts): a positive power of two, so -2^31 is excluded. */
export const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
export const log2 = (n: number) => 31 - Math.clz32(n);

/** Match a pattern against a value handle, extending `b`; false if it does not match. */
export function matchPat(p: Pat, h: ValueHandle, b: Bindings): boolean {
  if ('var' in p) {
    b[p.var] = h;
    return true;
  }
  if ('constVar' in p) {
    if (!h.isConst) return false;
    // a repeated constant variable is the same constant (IRWB-037-E): the first occurrence binds, later ones
    // must agree, exactly as same(x) is the same tree
    const prev = b[p.constVar];
    if (prev !== undefined && (!prev.isConst || prev.imm !== h.imm)) return false;
    b[p.constVar] = h;
    return true;
  }
  if ('const' in p) return h.isConst && h.imm === p.const;
  if ('same' in p) return h.same(b[p.same]);
  if (h.op !== p.op) return false;
  const args = h.args;
  if (args.length !== p.args.length) return false;
  for (let i = 0; i < args.length; i++) if (!matchPat(p.args[i], args[i], b)) return false;
  return true;
}

export function guardHolds(g: Guard, b: Bindings): boolean {
  if ('pure' in g) return b[g.pure].isPure;
  if ('pow2' in g) return isPow2(b[g.pow2].imm as number);
  if ('boolean' in g) return b[g.boolean].isBoolean;
  if ('shift' in g) {
    const n = b[g.shift].imm as number;
    return Number.isInteger(n) && n >= 0 && n <= 31;
  }
  const x = b[g.noTrap[0]].imm as number,
    y = b[g.noTrap[1]].imm as number;
  return !(y === 0 || (x === MIN && y === -1));
}

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
  if ('lowMask' in n) return (1 << imm(n.lowMask)) - 1;
  if ('highMask' in n) return ~((1 << imm(n.highMask)) - 1);
  return evalOp(n.eval, n.args.map(imm));
}

const noteOf = (text: string, b: Bindings): string =>
  text.replace(/\{(log2 )?([a-z]\w*)\}/g, (_m, l: string | undefined, x: string) => {
    const n = b[x].imm as number;
    return String(l ? log2(n) : n);
  });

function provenance(r: Rule, v: ValueHandle, b: Bindings): MakeOptions {
  const because =
    r.because === 'const-args' ? v.args.filter(x => x.isConst) : r.because === 'args' ? v.args : undefined;
  return { ...(because ? { because } : {}), ...(r.note ? { note: noteOf(r.note, b) } : {}) };
}

function instantiate(t: Tpl, b: Bindings, tx: Tx, prov: MakeOptions): string {
  if ('var' in t) return b[t.var].id;
  if ('const' in t)
    return tx.const(
      numOf(t.const, x => b[x].imm as number),
      t.type ? { ...prov, type: t.type } : prov,
    );
  const ids = t.args.map(a => instantiate(a, b, tx, {}));
  return tx.make(t.op, ...ids, prov);
}

/** Rule firings by rule name, collected by a visitor when the caller supplies the table. */
export type Firings = Map<string, number>;

/** The first rule of `rules` that rewrites `v`, with its bindings, or undefined. */
export function firstMatch(
  index: ReadonlyMap<string, readonly Rule[]>,
  v: ValueHandle,
): { rule: Rule; bindings: Bindings } | undefined {
  const list = index.get(v.op);
  if (!list) return undefined;
  for (const r of list) {
    const b: Bindings = {};
    if (!matchPat(r.lhs, v, b)) continue;
    if (r.where && !r.where.every(g => guardHolds(g, b))) continue;
    return { rule: r, bindings: b };
  }
  return undefined;
}

export function indexRules(rules: readonly Rule[]): Map<string, Rule[]> {
  const index = new Map<string, Rule[]>();
  for (const r of rules) {
    const list = index.get(r.lhs.op);
    if (list) list.push(r);
    else index.set(r.lhs.op, [r]);
  }
  return index;
}

/** A table as a function from a transaction to a `Tx.rewrite` visitor. */
export function compileRules(
  rules: readonly Rule[],
  firings?: Firings,
): (tx: Tx) => (v: ValueHandle) => string | undefined {
  const index = indexRules(rules);
  return tx => v => {
    const m = firstMatch(index, v);
    if (!m) return undefined;
    if (firings) firings.set(m.rule.name, (firings.get(m.rule.name) ?? 0) + 1);
    return instantiate(m.rule.rhs, m.bindings, tx, provenance(m.rule, v, m.bindings));
  };
}

/** The body of a table-driven pass: one `Tx.rewrite` over every statement of the function. */
export function tableBody(rules: readonly Rule[], firings?: Firings): (ctx: { tx: Tx }) => void {
  const visitor = compileRules(rules, firings);
  return ({ tx }) => tx.rewrite(visitor(tx));
}
