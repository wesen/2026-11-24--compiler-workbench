import { openIR, type CorrespondenceEntry } from '../framework/ir/index.js';
import { definePass, prepareNativeCandidate, type NativeResult } from '../framework/passes/define-pass.js';
import { gates, type Relation } from './contract.js';
import { adapter, TensorIR } from './ir.js';
import {
  add,
  constant,
  variable,
  visit,
  width,
  type Aff,
  type Binder,
  type Expr,
  type Program,
} from './model.js';
import type { TixProgram } from './program.js';

function rewrite(e: Expr, fn: (node: Expr) => Expr): Expr {
  if (e.tag === 'op') e = { ...e, args: e.args.map(a => rewrite(a, fn)) };
  if (e.tag === 'reduce') e = { ...e, body: rewrite(e.body, fn) };
  return fn(e);
}
function substitute(e: Expr, env: Map<string, Aff>) {
  return rewrite(e, n =>
    n.tag !== 'load'
      ? n
      : {
          ...n,
          subs: n.subs.map(a =>
            a.terms.reduce((v, [k, c]) => add(v, env.get(k) ?? variable(k), c), constant(a.c)),
          ),
        },
  );
}

type Kernel = (p: Program) => NativeResult<Program>;
const inline: Kernel = p => {
  let edits = 0;
  const correspondence: CorrespondenceEntry[] = [];
  const functions = p.functions.map(f => {
    let stmts = f.stmts.slice();
    for (const producer of f.stmts) {
      const s = stmts.find(s => s.id === producer.id)!;
      if (s.id === f.result) continue;
      let pointwise = true;
      visit(s.body, n => {
        if (n.tag === 'reduce') pointwise = false;
      });
      if (!pointwise) continue;
      const uses: string[] = [];
      for (const consumer of stmts)
        visit(consumer.body, n => {
          if (n.tag === 'load' && n.def === s.id) uses.push(n.id);
        });
      if (uses.length !== 1) continue;
      stmts = stmts
        .filter(d => d !== s)
        .map(d => ({
          ...d,
          body: rewrite(d.body, n => {
            if (n.tag !== 'load' || n.id !== uses[0]) return n;
            // Move (don't clone) the unique definition's scalar tree. Its operation IDs survive.
            return substitute(s.body, new Map(s.axes.map((b, i) => [b.id, n.subs[i]])));
          }),
        }));
      edits++;
      // Intermediate loads may themselves be consumed later in this same pass.
      correspondence.push({ from: [s.id, uses[0]], to: [s.body.id], relation: 'inlined' });
    }
    return { ...f, stmts };
  });
  const live = new Set<string>();
  for (const f of functions) for (const s of f.stmts) visit(s.body, e => live.add(e.id));
  return {
    native: { functions },
    edits,
    correspondence: correspondence.filter(c => c.to.every(id => live.has(id))),
  };
};
const split: Kernel = p => {
  let edits = 0;
  const correspondence: CorrespondenceEntry[] = [];
  const functions = p.functions.map(f => ({
    ...f,
    stmts: f.stmts.map(s => ({
      ...s,
      body: rewrite(s.body, n => {
        if (n.tag !== 'reduce' || n.op !== 'sum' || n.axes.length !== 1 || n.axes[0].loop) return n;
        const [k] = n.axes,
          block: Binder = { ...k, id: k.id + '.block', loop: { kind: 'blocks', round: 'ceil' } },
          lane: Binder = { ...k, id: k.id + '.lane', loop: { kind: 'lanes', block: block.id } };
        const index = add(variable(lane.id), variable(block.id), width);
        const inner: Expr = {
          ...n,
          id: n.id + '.partial',
          axes: [lane],
          body: substitute(n.body, new Map([[k.id, index]])),
        };
        edits++;
        correspondence.push(
          { from: [k.id], to: [block.id, lane.id], relation: 'partitioned' },
          { from: [n.id], to: [n.id, inner.id], relation: 'split' },
        );
        return { ...n, axes: [block], body: inner };
      }),
    })),
  }));
  return { native: { functions }, edits, correspondence };
};
export function tensorPass(name: string, relation: Relation, kernel: Kernel, entities: string[]) {
  const gate = gates[relation];
  const pass = definePass<Program>({
    id: `tensor.${name}`,
    version: '1',
    description: name,
    adapter,
    ir: TensorIR,
    writes: { entities, relations: ['contains', 'reads', 'index'] },
    contract: gate.contract,
    run: ctx => kernel(ctx.before.value),
  });
  return { pass, gate, kernel };
}
const passes = new Map([
  [
    'inline',
    tensorPass('inline', 'exact', inline, ['assignment', 'binder', 'literal', 'shape', 'load', 'op']),
  ],
  ['split-sum', tensorPass('split-sum', 'tolerant', split, ['reduce', 'binder', 'load'])],
]);
/** Prepare and check on detached revisions; only return a new handle on agreement. */
export function checkedStep(p: TixProgram, descriptor: ReturnType<typeof tensorPass>) {
  const { pass, kernel, gate } = descriptor;
  const proposal = kernel(p.current.value);
  const { after } = prepareNativeCandidate(pass, openIR(p.current, adapter), proposal);
  if (after.revision === p.current.revision) return { accepted: true, program: p };
  const evidence = gate.check(p.origin, p.current, after),
    accepted = evidence.status === 'agree';
  return { accepted, evidence, program: accepted ? Object.freeze({ origin: p.origin, current: after }) : p };
}
export function optimizeTix(program: TixProgram, names: string[]) {
  const steps: { pass: string; accepted: boolean }[] = [];
  for (const name of names) {
    const pass = passes.get(name);
    if (!pass) throw new Error(`Unknown tensor pass ${name}`);
    const step = checkedStep(program, pass);
    program = step.program;
    steps.push({ pass: name, accepted: step.accepted });
  }
  return { program, steps };
}
