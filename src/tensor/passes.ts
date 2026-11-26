import { applyNativePassSync, PassError, type NativePassSpec } from '../framework/passes/define-pass.js';
import type { CorrespondenceEntry } from '../framework/ir/types.js';
import { substitute, type Affine } from './affine.js';
import { TensorIR, tensorAdapter, visit, type Expr, type TensorModule } from './ir.js';
import { checkMeaning, type Relation } from './meaning.js';
import { originOf, retainOrigin, type TixProgram } from './program.js';

/** Bottom-up replacement with structural sharing and unchanged IDs. */
function rewrite(e: Expr, replace: (n: Expr) => Expr): Expr {
  if (e.kind === 'op') {
    const args = e.args.map(a => rewrite(a, replace));
    if (args.some((a, i) => a !== e.args[i])) return replace({ ...e, args });
  } else if (e.kind === 'reduce' || e.kind === 'blockedSum') {
    const body = rewrite(e.body, replace);
    if (body !== e.body) return replace({ ...e, body });
  }
  return replace(e);
}

const base = { version: '1', ir: TensorIR, adapter: tensorAdapter } as const;

export const inlinePass: NativePassSpec<TensorModule> = {
  ...base,
  id: 'tensor.inline',
  description: 'Substitute single-use pointwise definitions at their access maps',
  writes: {
    entities: ['tensor.definition', 'binder', 'expr.load'],
    relations: ['contains', 'reads', 'binds'],
  },
  run({ before }) {
    const correspondence: CorrespondenceEntry[] = [];
    let edits = 0;
    const functions = before.value.functions.map(fn => {
      let definitions = [...fn.definitions];
      const redirects = new Map<string, string>();
      // Visit producers in definition order. Each removed producer moves (not duplicates) its scalar tree.
      for (const original of fn.definitions) {
        const producer = definitions.find(d => d.id === original.id)!;
        if (fn.result === producer.id) continue;
        let pointwise = true;
        visit(producer.expr, n => {
          if (n.kind === 'reduce' || n.kind === 'blockedSum') pointwise = false;
        });
        if (!pointwise) continue;
        let uses = 0;
        for (const d of definitions)
          visit(d.expr, n => {
            if (n.kind === 'load' && n.tensor === producer.id) uses++;
          });
        if (uses !== 1) continue;
        edits++;
        definitions = definitions
          .filter(d => d !== producer)
          .map(d => {
            const expr = rewrite(d.expr, n => {
              if (n.kind !== 'load' || n.tensor !== producer.id) return n;
              const coords = new Map<string, Affine>(producer.binders.map((b, i) => [b.id, n.access[i]]));
              redirects.set(n.id, producer.expr.id);
              return rewrite(producer.expr, sub =>
                sub.kind === 'load'
                  ? { ...sub, access: sub.access.map(a => substitute(a, id => coords.get(id)!)) }
                  : sub,
              );
            });
            return expr === d.expr ? d : { ...d, expr };
          });
      }
      for (const [from, to] of redirects) {
        let target = to;
        while (redirects.has(target)) target = redirects.get(target)!;
        correspondence.push({ from: [from], to: [target], relation: 'inline' });
      }
      return { ...fn, definitions };
    });
    if (edits) return { native: { functions }, correspondence, edits };
  },
};

export const splitSumPass: NativePassSpec<TensorModule> = {
  ...base,
  id: 'tensor.split-sum',
  description: 'Accumulate clipped blocks of four before the final sum',
  writes: { entities: ['expr.reduce', 'expr.blockedSum'], relations: [] },
  run({ before }) {
    const correspondence: CorrespondenceEntry[] = [];
    const functions = before.value.functions.map(fn => ({
      ...fn,
      definitions: fn.definitions.map(d => ({
        ...d,
        expr: rewrite(d.expr, e => {
          if (e.kind !== 'reduce' || e.op !== 'sum' || e.binders.length !== 1) return e;
          const {
            id,
            at,
            binders: [binder],
            body,
          } = e;
          correspondence.push({ from: [id], to: [id], relation: 'block-sum' });
          return { id, at, body, binders: [binder], kind: 'blockedSum', blockSize: 4 };
        }),
      })),
    }));
    if (correspondence.length) return { native: { functions }, correspondence, edits: correspondence.length };
  },
};

/** The same gate is used by the public pipeline and mutation/negative tests. */
export function applyCheckedPass(
  pass: NativePassSpec<TensorModule>,
  program: TixProgram,
  relation: Relation,
) {
  const origin = originOf(program);
  const result = applyNativePassSync(pass, program, (before, candidate) =>
    checkMeaning(origin, before, candidate, relation),
  );
  retainOrigin(result.artifact, origin);
  return result;
}

const pipeline = new Map<string, readonly [NativePassSpec<TensorModule>, Relation]>([
  ['inline', [inlinePass, 'exact']],
  ['split-sum', [splitSumPass, 'tolerance']],
]);
export function optimizeTix(
  program: TixProgram,
  passes: string[],
): { program: TixProgram; steps: { pass: string; accepted: boolean }[] } {
  const steps = [];
  for (const name of passes) {
    const entry = pipeline.get(name);
    if (!entry) throw new Error(`Unknown Tix pass '${name}'`);
    const [pass, relation] = entry;
    try {
      program = applyCheckedPass(pass, program, relation).artifact;
      steps.push({ pass: name, accepted: true });
    } catch (e) {
      if (!(e instanceof PassError) || e.code !== 'contractRejected') throw e;
      steps.push({ pass: name, accepted: false });
    }
  }
  return { program, steps };
}
