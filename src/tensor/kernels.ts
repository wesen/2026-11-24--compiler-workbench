// The kernel plan (IRWB-029-E): which statements of a Tix function share a CUDA kernel. It is a v6 artifact between
// the Tix artifact and the CUDA source. Its validator is the legality check for fusion, so an illegal plan cannot
// exist as an artifact; the planner proposes with the same rules. The rules read only the Tix function.
//
// Both fusions keep every element's expression tree as the f32 meaning has it: each reduction is still one
// thread's loop in the meaning's order. Only which thread evaluates a tree, and where an intermediate f32 is kept,
// change.
import { defineIR } from '../framework/contracts/index.js';
import { TixIR } from './ir.js';
import { mapExpr, plain, substitute, visit, type Expr, type Fn, type Statement } from './model.js';

export type Kernel =
  // stage 2's mapping: one thread per element of the statement
  | { mapping: 'element'; statement: string }
  // one block per row: the statements' first `outer` axes select the row
  | { mapping: 'row'; outer: number; statements: string[] };
export interface KernelPlan {
  fn: Fn;
  /** Statements with no kernel: each is substituted into its readers. */
  inlined: string[];
  /** In statement order. */
  kernels: Kernel[];
}
export interface Refusal {
  statement: string;
  fusion: 'inline' | 'row';
  reason: string;
}
type Load = Extract<Expr, { kind: 'load' }>;

function loads(e: Expr, reduced = false, out: { load: Load; reduced: boolean }[] = []) {
  if (e.kind === 'load') out.push({ load: e, reduced });
  if (e.kind === 'op') e.args.forEach(x => loads(x, reduced, out));
  if (e.kind === 'reduce') loads(e.body, true, out);
  return out;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every statement's expression with the inlined statements substituted. Binder ids are unique in a function. */
export function expandStatements(fn: Fn, inlined: Iterable<string>): Map<string, Expr> {
  const gone = new Set(inlined),
    statements = new Map(fn.statements.map(s => [s.name, s])),
    out = new Map<string, Expr>();
  for (const s of fn.statements)
    out.set(
      s.name,
      mapExpr(s.expr, e => {
        if (e.kind !== 'load' || !gone.has(e.name) || !out.has(e.name)) return e;
        const bindings = new Map(statements.get(e.name)!.axes.map((a, k) => [a.id, e.indices[k]]));
        return mapExpr(out.get(e.name)!, x =>
          x.kind === 'load' ? { ...x, indices: x.indices.map(a => substitute(a, bindings)) } : x,
        );
      }),
    );
  return out;
}

/** Why statement `p` may not be inlined into its readers; undefined when it may. */
function inlineRefusal(fn: Fn, p: Statement, expanded: Expr): string | undefined {
  if (p.name === fn.result) return 'it is the result';
  const tuples = new Set<string>(),
    readers = new Set<string>();
  for (const c of fn.statements.slice(fn.statements.indexOf(p) + 1))
    for (const { load, reduced } of loads(c.expr)) {
      if (load.name !== p.name) continue;
      if (reduced)
        return `${c.name} reads it inside a reduction: substituting would evaluate it once per term`;
      const ids = load.indices.map(plain);
      if (ids.length !== c.axes.length || !c.axes.every(a => ids.includes(a.id)))
        return `${c.name} does not read one element of it per element of ${c.name}`;
      tuples.add(ids.join());
      readers.add(c.name);
    }
  if (!readers.size) return 'nothing reads it';
  let reduces = false;
  visit(expanded, e => {
    if (e.kind === 'reduce') reduces = true;
  });
  if (reduces && (readers.size > 1 || tuples.size > 1))
    return `it contains a reduction and has ${readers.size} readers: substituting would repeat the reduction`;
  return undefined;
}

/** Why statement `t` may not extend the row run `run` (rows keyed by the first `outer` axes). */
function rowRefusal(run: Statement[], outer: number, t: Statement, expanded: Expr): string | undefined {
  const rank = t.shape.length;
  if (outer < 1 || (rank !== outer && rank !== outer + 1))
    return `its rank ${rank} is neither a row scalar's (${outer}) nor a row vector's (${outer + 1})`;
  if (!run.length) return undefined;
  if (!same(t.shape.slice(0, outer), run[0].shape.slice(0, outer))) return 'its rows differ from the run’s';
  const names = new Set(run.map(s => s.name));
  for (const { load } of loads(expanded))
    if (names.has(load.name) && !load.indices.slice(0, outer).every((a, k) => plain(a) === t.axes[k].id))
      return `it reads another row of ${load.name}`;
  return undefined;
}

/** Whether reads among the run's statements connect all of them (the planner's choice, not a legality rule). */
function connected(run: Statement[], expanded: ReadonlyMap<string, Expr>) {
  const group = new Map(run.map((s, i) => [s.name, i]));
  for (const s of run)
    for (const { load } of loads(expanded.get(s.name)!)) {
      const a = group.get(load.name),
        b = group.get(s.name)!;
      if (a !== undefined && a !== b) for (const [n, g] of group) if (g === b) group.set(n, a);
    }
  return new Set(group.values()).size === 1;
}

function fail(reason: string): never {
  throw Error('Illegal kernel plan: ' + reason);
}
export function validatePlan(value: unknown) {
  const plan = value as KernelPlan;
  if (!plan || !Array.isArray(plan.inlined) || !Array.isArray(plan.kernels)) fail('malformed');
  const validateTix: (value: unknown) => void = TixIR.validate;
  validateTix({ functions: [plan.fn] });
  const { fn } = plan,
    statements = new Map(fn.statements.map(s => [s.name, s])),
    inlined = new Set(plan.inlined),
    expanded = expandStatements(fn, inlined);
  for (const name of inlined) {
    const p = statements.get(name) ?? fail('unknown statement ' + name);
    const refusal = inlineRefusal(fn, p, expanded.get(name)!);
    if (refusal) fail(`${name} cannot be inlined: ${refusal}`);
  }
  const order: string[] = [];
  for (const k of plan.kernels) {
    if (k.mapping === 'element') {
      order.push(k.statement);
      continue;
    }
    if (k.mapping !== 'row' || !Number.isSafeInteger(k.outer) || !Array.isArray(k.statements))
      fail('malformed kernel');
    if (k.statements.length < 2) fail('a row kernel needs at least two statements');
    const run: Statement[] = [];
    for (const name of k.statements) {
      const t = statements.get(name) ?? fail('unknown statement ' + name);
      const refusal = rowRefusal(run, k.outer, t, expanded.get(name)!);
      if (refusal) fail(`${name} cannot join the row kernel: ${refusal}`);
      run.push(t);
    }
    order.push(...k.statements);
  }
  // every statement is inlined or in exactly one kernel, and kernels follow statement order, so each kernel
  // runs after the kernels of everything it reads
  if (
    !same(
      order,
      fn.statements.map(s => s.name).filter(n => !inlined.has(n)),
    ) ||
    inlined.size !== plan.inlined.length
  )
    fail('kernels do not cover the statements in order');
}
export const KernelIR = defineIR<KernelPlan>({
  id: 'tensor.kernels',
  version: '1',
  description: 'Which statements of a Tix function share a CUDA kernel, and each kernel’s thread mapping',
  validate: validatePlan,
});

/** Stage 2's plan: one element kernel per statement. */
export function unfusedPlan(fn: Fn): KernelPlan {
  return { fn, inlined: [], kernels: fn.statements.map(s => ({ mapping: 'element', statement: s.name })) };
}

/** The fused plan, and the fusions it refused (one reason per statement that stays apart from a neighbour). */
export function planKernels(fn: Fn): { plan: KernelPlan; refused: Refusal[] } {
  const inlined: string[] = [],
    refused: Refusal[] = [];
  for (const p of fn.statements) {
    // statements before p are decided, so p's own expansion is final
    const reason = inlineRefusal(fn, p, expandStatements(fn, inlined).get(p.name)!);
    if (!reason) inlined.push(p.name);
    else if (p.name !== fn.result && reason !== 'nothing reads it')
      refused.push({ statement: p.name, fusion: 'inline', reason });
  }
  const expanded = expandStatements(fn, inlined),
    rest = fn.statements.filter(s => !inlined.includes(s.name)),
    kernels: Kernel[] = [];
  for (let i = 0; i < rest.length; ) {
    let best: { outer: number; run: Statement[]; reason?: string } = { outer: 0, run: [rest[i]] };
    // a tie goes to the vector reading (rank - 1): all threads of the block work, not thread 0 alone
    for (const outer of [rest[i].shape.length - 1, rest[i].shape.length]) {
      const run: Statement[] = [];
      let reason: string | undefined;
      for (let j = i; j < rest.length && !reason; j++) {
        reason = rowRefusal(run, outer, rest[j], expanded.get(rest[j].name)!);
        if (!reason) run.push(rest[j]);
      }
      // a kernel is for statements that pass values to each other: drop a tail that only shares the rows
      while (run.length > 1 && !connected(run, expanded)) {
        reason = `no read connects it to ${run.length > 2 ? 'all of ' : ''}${run.slice(0, -1).map(s => s.name)}`;
        run.pop();
      }
      if (run.length > best.run.length || (run.length === best.run.length && !best.outer))
        best = { outer, run, reason };
    }
    const next = rest[i + best.run.length];
    if (next && best.reason && best.run.length)
      refused.push({ statement: next.name, fusion: 'row', reason: best.reason });
    if (best.run.length >= 2)
      kernels.push({ mapping: 'row', outer: best.outer, statements: best.run.map(s => s.name) });
    else kernels.push({ mapping: 'element', statement: rest[i].name });
    i += Math.max(1, best.run.length);
  }
  // an inline refusal is not reported for a statement that a row kernel fused with its readers instead
  const inRows = new Set(kernels.flatMap(k => (k.mapping === 'row' ? k.statements : [])));
  return {
    plan: { fn, inlined, kernels },
    refused: refused.filter(r => r.fusion === 'row' || !inRows.has(r.statement)),
  };
}
