/**
 * Verify a rewrite rule once, for every input of its declared types (IRWB-006, B2).
 *
 * A rule L → R with guard G claims: for every assignment of values to its variables that satisfies G, R has the
 * same outcome as L (a value, or a trap; outcomes agree as the meaning check's `agrees` says). The verifier applies
 * every method that applies to the rule and records each result; a counterexample from any method rejects it.
 *
 *   structural       effects (a dropped, duplicated or reordered variable needs pure), types      side condition
 *   by-construction  fold: R is the evaluator's own value of L; the guard excludes every trap      relative proof
 *   symbolic-linear  both sides are degree-one polynomials over Z/2^32 with equal coefficients    proof
 *   bitwise-w1       both sides use only and/or/xor and 0/-1; checked at width 1                  proof
 *   exhaustive-w8    every assignment at 8 bits (width-generic rules)          complete at 8 bits only
 *   exhaustive-32    every assignment at 32 bits (one full variable, or small guarded domains)      complete
 *   random-32        boundary values crossed, plus N random assignments                           sampled
 *   f32-special      f32 special values (zeros, infinities, NaN payloads) crossed, plus random bits sampled
 *
 * Exhaustive checking at 8 bits does not by itself imply anything at 32 bits (x * 256 → 0 holds for every 8-bit x),
 * so its strength counts only for rules with a stated argument that the property does not depend on the width
 * (`argumentFor`); otherwise the rule's strength is what its 32-bit methods give.
 */
import { fingerprint } from '../../framework/core/data.js';
import { VALUE_SIGNATURES } from '../ir.js';
import { patternVars, templateVars, type Guard, type Pat, type Rule, type Tpl } from './form.js';
import { log2 } from './compile.js';
import {
  BITWISE,
  boundaryI32,
  COMPARISONS,
  compileSide,
  F32_SPECIALS,
  I32_BINARY,
  LINEAR,
  maxOf,
  minOf,
  opW,
  TRAP,
} from './semantics.js';

export type MethodName =
  | 'structural'
  | 'by-construction'
  | 'symbolic-linear'
  | 'bitwise-w1'
  | 'exhaustive-w8'
  | 'random-32'
  | 'f32-special'
  | 'exhaustive-32';
export interface MethodResult {
  readonly method: MethodName;
  readonly verdict: 'pass' | 'fail' | 'n/a';
  readonly cases?: number;
  readonly instances?: number;
  readonly ms?: number;
  readonly detail?: string;
}
export interface Counterexample {
  readonly bindings: Readonly<Record<string, number>>;
  readonly lhs: number | 'trap';
  readonly rhs: number | 'trap';
  readonly method: MethodName;
  readonly width: number;
}
export type Strength = 'proof' | 'exhaustive' | 'reduced-width+argument' | 'sampled' | 'by-construction';
export interface RuleEvidence {
  readonly rule: string;
  readonly version: string;
  readonly fingerprint: string;
  readonly verdict: 'sound' | 'unsound';
  readonly strength?: Strength;
  readonly methods: readonly MethodResult[];
  readonly argument?: string;
  readonly counterexample?: Counterexample;
  readonly reason?: string;
}
export interface VerifyOptions {
  /** Random assignments at 32 bits (default 1e5). */
  readonly random?: number;
  readonly seed?: number;
  /** Run exhaustive checking over 2^32 inputs (minutes per rule); small domains are always exhaustive. */
  readonly exhaustive32?: boolean;
  /** The f32 special values (default F32_SPECIALS). */
  readonly specials?: readonly number[];
  /** The largest number of assignments the reduced-width method enumerates (default 2^24). */
  readonly maxW8?: number;
}

export const ruleFingerprint = (r: Rule): string => fingerprint(r);

/** Why exhaustive evidence at a reduced width transfers to 32 bits for this rule, or undefined. */
export function argumentFor(r: Rule): string | undefined {
  const ops = opsOf(r);
  if ([...ops].every(o => COMPARISONS.has(o)))
    return (
      'At every width w, lt/le/gt/ge are the strict and non-strict signed total orders on w-bit integers, ' +
      'ltu/geu the unsigned ones, eq/ne equality and its complement, and eqz(c) is 1 exactly when c is 0. ' +
      'eqz(cmp(a, b)) = inv(a, b) says inv is the complement relation of cmp, a law of these relations that ' +
      'does not depend on w. The 8-bit exhaustive check confirms the operators implement the relations; ' +
      'the 32-bit sample checks the 32-bit operators directly.'
    );
  return undefined;
}

// ---------- the rule's variables and their domains ----------
interface Var {
  readonly name: string;
  readonly type: 'i32' | 'f32' | 'bool';
  readonly constVar: boolean;
  readonly pow2: boolean;
}
function varsOf(r: Rule): Var[] {
  const consts = new Set<string>();
  const walk = (p: Pat) => {
    if ('constVar' in p) consts.add(p.constVar);
    else if ('op' in p) p.args.forEach(walk);
  };
  walk(r.lhs);
  const pow2 = new Set((r.where ?? []).flatMap(g => ('pow2' in g ? [g.pow2] : [])));
  return patternVars(r.lhs).binds.map(name => ({
    name,
    type: r.types[name],
    constVar: consts.has(name),
    pow2: pow2.has(name),
  }));
}
function opsOf(r: Rule): Set<string> {
  const out = new Set<string>();
  const walk = (n: Pat | Tpl) => {
    if ('op' in n) {
      out.add(n.op);
      (n.args as readonly (Pat | Tpl)[]).forEach(walk);
    } else if ('const' in n && typeof n.const === 'object' && 'eval' in n.const) out.add(n.const.eval);
  };
  walk(r.lhs);
  walk(r.rhs);
  return out;
}
const literals = (r: Rule): number[] => {
  const out: number[] = [];
  const walk = (n: Pat | Tpl) => {
    if ('const' in n && typeof n.const === 'number') out.push(n.const);
    else if ('op' in n) (n.args as readonly (Pat | Tpl)[]).forEach(walk);
  };
  walk(r.lhs);
  walk(r.rhs);
  return out;
};
/** The values a variable takes at width w when enumerated, or null for "all w-bit values". */
function domainAt(x: Var, w: number): number[] | null {
  if (x.type === 'bool') return [0, 1];
  if (x.pow2) return Array.from({ length: w - 1 }, (_, j) => 2 ** j);
  return null;
}
const sizeAt = (x: Var, w: number) => domainAt(x, w)?.length ?? 2 ** w;

function guardsHold(guards: readonly Guard[], slot: Map<string, number>, env: ArrayLike<number>, w: number) {
  for (const g of guards)
    if ('noTrap' in g) {
      const a = env[slot.get(g.noTrap[0])!],
        b = env[slot.get(g.noTrap[1])!];
      if (b === 0 || (a === minOf(w) && b === -1)) return false;
    }
  return true;
}

class Rng {
  constructor(private s: number) {
    if (!this.s) this.s = 0x2545f491;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (this.s = x | 0);
  }
}

// ---------- the verifier ----------
export function verifyRule(r: Rule, opts: VerifyOptions = {}): RuleEvidence {
  const vars = varsOf(r),
    slot = new Map(vars.map((x, i) => [x.name, i])),
    guards = r.where ?? [];
  const methods: MethodResult[] = [];
  let counter: Counterexample | undefined, reason: string | undefined;
  const base = { rule: r.name, version: r.version, fingerprint: ruleFingerprint(r) };
  const show = (o: number) => (o === TRAP ? ('trap' as const) : o);
  const sides = (w: number) => [compileSide(r.lhs, slot, w), compileSide(r.rhs, slot, w)] as const;
  const failWith = (method: MethodName, env: ArrayLike<number>, l: number, rr: number, w: number) => {
    counter = {
      bindings: Object.fromEntries(vars.map((x, i) => [x.name, env[i]])),
      lhs: show(l),
      rhs: show(rr),
      method,
      width: w,
    };
  };
  const done = (): RuleEvidence => {
    if (counter || reason)
      return {
        ...base,
        verdict: 'unsound',
        methods,
        ...(counter ? { counterexample: counter } : {}),
        ...(reason ? { reason } : {}),
      };
    const passed = new Set(methods.filter(m => m.verdict === 'pass').map(m => m.method));
    const argument = argumentFor(r);
    const strength: Strength = passed.has('by-construction')
      ? 'by-construction'
      : passed.has('symbolic-linear') || passed.has('bitwise-w1')
        ? 'proof'
        : passed.has('exhaustive-32')
          ? 'exhaustive'
          : passed.has('exhaustive-w8') && argument
            ? 'reduced-width+argument'
            : 'sampled';
    return {
      ...base,
      verdict: 'sound',
      strength,
      methods,
      ...(strength === 'reduced-width+argument' ? { argument } : {}),
    };
  };
  const timed = (method: MethodName, f: () => Omit<MethodResult, 'method' | 'ms'>) => {
    const t = performance.now();
    const res = f();
    methods.push({ method, ...res, ms: Math.round(performance.now() - t) });
    return res.verdict !== 'fail';
  };

  // 1. structural: effects and types
  if (
    !timed('structural', () => {
      const problem = structuralProblem(r, vars);
      if (problem) reason = problem;
      return problem ? { verdict: 'fail', detail: problem } : { verdict: 'pass' };
    })
  )
    return done();

  const hasF32 = vars.some(x => x.type === 'f32'),
    ops = opsOf(r);

  // 2. by construction (fold): R is { const: { eval: L.op, args: L's constant variables in order } }
  const rhsEval =
    'const' in r.rhs && typeof r.rhs.const === 'object' && 'eval' in r.rhs.const ? r.rhs.const : null;
  const byConstruction =
    !!rhsEval &&
    rhsEval.eval === r.lhs.op &&
    r.lhs.args.every((a, i) => 'constVar' in a && a.constVar === rhsEval.args[i]) &&
    rhsEval.args.length === r.lhs.args.length;
  if (byConstruction) {
    const ok = timed('by-construction', () => {
      // the guard must exclude every input on which the operator traps; count the inputs it excludes that do not
      let cases = 0,
        conservative = 0;
      const check = (env: number[], w: number): boolean => {
        cases++;
        const trap = opW(r.lhs.op, env, w) === TRAP;
        if (guardsHold(guards, slot, env, w)) {
          if (trap) {
            failWith('by-construction', env, TRAP, TRAP, w);
            return false;
          }
        } else if (!trap) conservative++;
        return true;
      };
      if (!hasF32 && vars.length <= 2 && [...ops].every(o => I32_BINARY.has(o) || o === 'eqz')) {
        const n = vars.length;
        for (let i = 0; i < 2 ** (8 * n); i++) {
          const env = Array.from({ length: n }, (_, k) => ((i >> (8 * k)) << 24) >> 24);
          if (!check(env, 8)) return { verdict: 'fail', cases };
        }
      }
      const B = hasF32 ? F32_SPECIALS : boundaryI32();
      const cross = (k: number, env: number[]): boolean => {
        if (k === vars.length) return check(env, 32);
        for (const x of B) if (!cross(k + 1, [...env, x])) return false;
        return true;
      };
      if (!cross(0, [])) return { verdict: 'fail', cases };
      return {
        verdict: 'pass',
        cases,
        detail:
          'the replacement is the evaluator’s value of the matched operator (binop, f32Op)' +
          (guards.length
            ? `; the guard excludes every trapping input and ${conservative} non-trapping ones (conservative)`
            : '; the operator never traps'),
      };
    });
    if (!ok) return done();
  }

  // 3. symbolic linear: degree-one polynomials over Z/2^32, once per instance of the guarded constants
  if (!hasF32 && [...ops].every(o => LINEAR.has(o))) {
    const finite = vars.filter(x => x.constVar);
    if (finite.every(x => x.pow2)) {
      const ok = timed('symbolic-linear', () => {
        const instances = product(finite.map(x => domainAt(x, 32)!));
        for (const inst of instances) {
          const at = new Map(finite.map((x, i) => [x.name, inst[i]]));
          const L = lin(r.lhs, at),
            R = lin(r.rhs, at);
          if (!L || !R) return { verdict: 'n/a', detail: 'not linear' };
          if (!sameLin(L, R))
            return {
              verdict: 'fail',
              instances: instances.length,
              detail: `instance ${JSON.stringify(Object.fromEntries(at))}: ${linText(L)} ≠ ${linText(R)}`,
            };
        }
        return {
          verdict: 'pass',
          instances: instances.length,
          detail:
            instances.length > 1
              ? `normal forms equal for all ${instances.length} guard instances`
              : 'normal forms equal',
        };
      });
      if (!ok) {
        // a symbolic difference is a counterexample in principle; find a concrete one at 32 bits
        if (!counter) reason = methods.at(-1)!.detail;
        return done();
      }
    }
  }

  // 4. bitwise at width 1
  const lits = literals(r);
  if (
    !hasF32 &&
    [...ops].every(o => BITWISE.has(o)) &&
    vars.every(x => !x.constVar && x.type === 'i32') &&
    lits.every(n => n === 0 || n === -1)
  ) {
    const [L, R] = sides(1);
    const ok = timed('bitwise-w1', () => {
      let cases = 0;
      for (const env of product(vars.map(() => [0, -1]))) {
        cases++;
        const l = L(env),
          rr = R(env);
        if (l !== rr) {
          failWith('bitwise-w1', env, l, rr, 1);
          return { verdict: 'fail', cases };
        }
      }
      return {
        verdict: 'pass',
        cases,
        detail: 'each result bit depends only on the same bit of each operand',
      };
    });
    if (!ok) return done();
  }

  const proved = methods.some(
    m => m.verdict === 'pass' && (m.method === 'symbolic-linear' || m.method === 'bitwise-w1'),
  );

  // 5. exhaustive at 8 bits, for width-generic rules
  const widthGeneric =
    !hasF32 &&
    lits.every(n => n === 0 || n === 1 || n === -1) &&
    [...ops].every(o => I32_BINARY.has(o) || o === 'eqz');
  const total8 = vars.reduce((n, x) => n * sizeAt(x, 8), 1);
  if (widthGeneric && total8 <= (opts.maxW8 ?? 2 ** 24) && !byConstruction) {
    const [L, R] = sides(8);
    const ok = timed('exhaustive-w8', () => {
      let cases = 0;
      const doms = vars.map(x => domainAt(x, 8) ?? range(minOf(8), maxOf(8)));
      for (const env of product(doms)) {
        if (!guardsHold(guards, slot, env, 8)) continue;
        cases++;
        const l = L(env),
          rr = R(env);
        if (l !== rr) {
          failWith('exhaustive-w8', env, l, rr, 8);
          return { verdict: 'fail', cases };
        }
      }
      return { verdict: 'pass', cases };
    });
    if (!ok) return done();
  }

  // 6. sampled at 32 bits: boundary values crossed, then random assignments (f32: special values)
  {
    const [L, R] = sides(32);
    const rng = new Rng(opts.seed ?? 7);
    const B = boundaryI32(),
      S = opts.specials ?? F32_SPECIALS;
    const values = (x: Var) => (x.type === 'f32' ? S : (domainAt(x, 32) ?? B));
    const draw = (x: Var): number => {
      const d = domainAt(x, 32);
      if (d) return d[(rng.next() >>> 0) % d.length];
      if (x.type === 'f32') return (rng.next() & 7) === 0 ? S[(rng.next() >>> 0) % S.length] : rng.next();
      return (rng.next() & 3) === 0 ? rng.next() % 17 | 0 : rng.next();
    };
    const method: MethodName = hasF32 ? 'f32-special' : 'random-32';
    const ok = timed(method, () => {
      let cases = 0;
      const test = (env: number[]): boolean => {
        if (!guardsHold(guards, slot, env, 32)) return true;
        cases++;
        const l = L(env),
          rr = R(env);
        if (l !== rr) {
          failWith(method, env, l, rr, 32);
          return false;
        }
        return true;
      };
      const crossed = vars.reduce((n, x) => n * values(x).length, 1);
      if (crossed <= 200000) {
        for (const env of product(vars.map(values))) if (!test(env)) return { verdict: 'fail', cases };
      } else
        for (let i = 0; i < 200000; i++)
          if (!test(vars.map(x => { const vs = values(x); return vs[(rng.next() >>> 0) % vs.length]; }))) return { verdict: 'fail', cases }; // prettier-ignore
      for (let i = 0; i < (opts.random ?? 1e5); i++)
        if (!test(vars.map(draw))) return { verdict: 'fail', cases };
      return {
        verdict: 'pass',
        cases,
        detail: `boundary values crossed (${Math.min(crossed, 200000)}), then random`,
      };
    });
    if (!ok) return done();
  }

  // 7. exhaustive at 32 bits: small domains always; a full 32-bit variable only on request
  const total32 = vars.reduce((n, x) => n * sizeAt(x, 32), 1);
  if (!proved && !byConstruction && total32 <= 2 ** 32 && (total32 <= 2 ** 20 || opts.exhaustive32)) {
    const [L, R] = sides(32);
    timed('exhaustive-32', () => {
      let cases = 0;
      const full = vars.findIndex(x => !domainAt(x, 32));
      const doms = vars.map(x => domainAt(x, 32));
      const rest = product(doms.map((d, i) => (i === full ? [0] : d!)));
      const env = new Array<number>(vars.length).fill(0);
      for (const fixed of rest) {
        for (let i = 0; i < vars.length; i++) env[i] = fixed[i];
        if (full < 0) {
          if (!guardsHold(guards, slot, env, 32)) continue;
          cases++;
          const l = L(env),
            rr = R(env);
          if (l !== rr) {
            failWith('exhaustive-32', env, l, rr, 32);
            return { verdict: 'fail', cases };
          }
          continue;
        }
        for (let x = 0; x < 4294967296; x++) {
          env[full] = x | 0;
          const l = L(env),
            rr = R(env);
          if (l !== rr) {
            failWith('exhaustive-32', env, l, rr, 32);
            return { verdict: 'fail', cases: cases + x };
          }
        }
        cases += 4294967296;
      }
      return { verdict: 'pass', cases, detail: premise(vars) };
    });
  } else if (!proved && !byConstruction)
    methods.push({
      method: 'exhaustive-32',
      verdict: 'n/a',
      detail: total32 > 2 ** 32 ? 'more than 2^32 inputs' : 'not requested (exhaustive32)',
    });
  return done();
}

const premise = (vars: readonly Var[]) =>
  vars.some(x => x.type === 'bool')
    ? 'bool variables range over {0, 1}: every comparison yields 0 or 1'
    : undefined;

// ---------- structural checks ----------
function structuralProblem(r: Rule, vars: readonly Var[]): string | undefined {
  const pure = new Set((r.where ?? []).flatMap(g => ('pure' in g ? [g.pure] : [])));
  const lhsSeq: string[] = [];
  const walk = (p: Pat) => {
    if ('var' in p) lhsSeq.push(p.var);
    else if ('same' in p) lhsSeq.push(p.same);
    else if ('op' in p) p.args.forEach(walk);
  };
  walk(r.lhs);
  const rhsSeq = templateVars(r.rhs).uses;
  const count = (s: string[], x: string) => s.filter(y => y === x).length;
  for (const x of new Set(lhsSeq)) {
    const nL = count(lhsSeq, x),
      nR = count(rhsSeq, x);
    if (nL !== nR && !pure.has(x))
      return `${x} is ${nR < nL ? 'dropped' : 'duplicated'} (${nL} on the left, ${nR} on the right) without pure(${x}): its traps or effects would change`;
  }
  const order = (s: string[]) => [...new Set(s.filter(x => !pure.has(x)))];
  if (order(lhsSeq).join() !== order(rhsSeq).join())
    return `the variables ${order(lhsSeq).join(', ')} are reordered without pure: their effects would change order`;
  // types: each variable's type from the operator signatures, both sides' result types
  const declared = new Map(vars.map(x => [x.name, x.type === 'bool' ? 'i32' : x.type]));
  let problem: string | undefined;
  const typeOf = (n: Pat | Tpl, expect?: string): string | undefined => {
    if ('var' in n || 'constVar' in n || 'same' in n) {
      const name = 'var' in n ? n.var : 'constVar' in n ? n.constVar : n.same;
      const t = declared.get(name);
      if (expect && t !== expect) problem ??= `${name} is declared ${t} but used as ${expect}`;
      return t;
    }
    if ('const' in n) {
      const t = 'type' in n && n.type === 'f32' ? 'f32' : (expect ?? 'i32');
      if ('type' in n && n.type === 'f32' && expect && expect !== 'f32')
        problem ??= `an f32 constant used as ${expect}`;
      return t;
    }
    const sig = VALUE_SIGNATURES[n.op];
    if (!sig.args || sig.args.length !== n.args.length) {
      problem ??= `${n.op} takes ${sig.args?.length ?? 'any number of'} operands`;
      return undefined;
    }
    (n.args as readonly (Pat | Tpl)[]).forEach((a, i) => typeOf(a, sig.args![i]));
    const res =
      typeof sig.result === 'string' && (sig.result === 'i32' || sig.result === 'f32')
        ? sig.result
        : undefined;
    if (expect && res && res !== expect) problem ??= `${n.op} yields ${res}, used as ${expect}`;
    return res;
  };
  const tl = typeOf(r.lhs),
    tr = typeOf(r.rhs, tl);
  if (problem) return `types: ${problem}`;
  if (tl !== tr) return `types: the left side yields ${tl}, the right side ${tr}`;
  return undefined;
}

// ---------- linear normal forms over Z/2^32 ----------
interface Lin {
  readonly c0: number;
  readonly coef: ReadonlyMap<string, number>;
}
function lin(n: Pat | Tpl, at: ReadonlyMap<string, number>): Lin | null {
  if ('var' in n) return { c0: 0, coef: new Map([[n.var, 1]]) };
  if ('same' in n) return { c0: 0, coef: new Map([[n.same, 1]]) };
  if ('constVar' in n) return at.has(n.constVar) ? { c0: at.get(n.constVar)! | 0, coef: new Map() } : null;
  if ('const' in n) {
    const c = n.const;
    if (typeof c === 'number') return { c0: c | 0, coef: new Map() };
    if ('log2' in c) return at.has(c.log2) ? { c0: log2(at.get(c.log2)!), coef: new Map() } : null;
    return null;
  }
  const [a, b] = (n.args as readonly (Pat | Tpl)[]).map(x => lin(x, at));
  if (!a || !b) return null;
  const combine = (s: number) => {
    const coef = new Map(a.coef);
    for (const [k, v] of b.coef) coef.set(k, ((coef.get(k) ?? 0) + Math.imul(s, v)) | 0);
    return { c0: (a.c0 + Math.imul(s, b.c0)) | 0, coef };
  };
  const scale = (x: Lin, k: number): Lin => ({
    c0: Math.imul(x.c0, k),
    coef: new Map([...x.coef].map(([v, c]) => [v, Math.imul(c, k)])),
  });
  switch (n.op) {
    case 'add':
      return combine(1);
    case 'sub':
      return combine(-1);
    case 'mul':
      return !a.coef.size ? scale(b, a.c0) : !b.coef.size ? scale(a, b.c0) : null;
    case 'shl':
      return b.coef.size ? null : scale(a, 1 << (b.c0 & 31));
  }
  return null;
}
const sameLin = (a: Lin, b: Lin): boolean => {
  if (a.c0 !== b.c0) return false;
  const keys = new Set([...a.coef.keys(), ...b.coef.keys()]);
  for (const k of keys) if ((a.coef.get(k) ?? 0) !== (b.coef.get(k) ?? 0)) return false;
  return true;
};
const linText = (x: Lin) =>
  [String(x.c0), ...[...x.coef].filter(([, c]) => c).map(([v, c]) => `${c}·${v}`)].join(' + ');

// ---------- small helpers ----------
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
function product(doms: readonly (readonly number[])[]): number[][] {
  let out: number[][] = [[]];
  for (const d of doms) out = out.flatMap(p => d.map(x => [...p, x]));
  return out;
}
