import { applyNativePassSync, definePass, PassError, type Pass } from '../framework/passes/index.js';
import type { CorrespondenceEntry } from '../framework/ir/index.js';
import { checkMeaning, type Relation } from './contract.js';
import { TensorIR, tensorAdapter, tensorId } from './ir.js';
import type { TixProgram } from './index.js';
import { rewrite, substitute, walk, type Definition, type Expr, type TensorModule } from './model.js';

function inlineRead(producer: Definition, indices: Extract<Expr, { kind: 'read' }>['indices']): Expr {
  const bindings = new Map(producer.axes.map((a, i) => [a.id, indices[i]]));
  return rewrite(producer.body, e =>
    e.kind === 'read' ? { ...e, indices: e.indices.map(a => substitute(a, id => bindings.get(id)!)) } : e,
  );
}
export const inline = definePass<TensorModule>({
  id: 'tensor.inline',
  version: '1',
  description: 'Substitute single-use pointwise tensor definitions',
  ir: TensorIR,
  adapter: tensorAdapter,
  writes: { entities: ['definition'], relations: ['read', 'member'] },
  run({ before }) {
    const correspondence: CorrespondenceEntry[] = [];
    const functions = before.value.functions.map(f => {
      const defs = new Map(f.definitions.map(d => [d.name, d])),
        merged = new Map<string, string>();
      for (const name of defs.keys()) {
        const producer = defs.get(name)!;
        if (name === f.result) continue;
        let pointwise = true;
        walk(producer.body, e => {
          if (e.kind === 'fold') pointwise = false;
        });
        if (!pointwise) continue;
        const uses: Definition[] = [];
        for (const consumer of defs.values())
          walk(consumer.body, e => {
            if (e.kind === 'read' && e.tensor === name) uses.push(consumer);
          });
        if (uses.length !== 1) continue;
        const [consumer] = uses;
        const body = rewrite(consumer.body, e =>
          e.kind === 'read' && e.tensor === name ? inlineRead(producer, e.indices) : e,
        );
        defs.set(consumer.name, { ...consumer, body });
        defs.delete(name);
        merged.set(name, consumer.name);
      }
      for (const [source, first] of merged) {
        let dest = first;
        while (merged.has(dest)) dest = merged.get(dest)!;
        correspondence.push({
          from: [tensorId(f.name, source)],
          to: [tensorId(f.name, dest)],
          relation: 'inlined',
        });
      }
      return { ...f, definitions: [...defs.values()] };
    });
    if (correspondence.length) return { native: { functions }, correspondence, edits: correspondence.length };
  },
});

export const splitSum = definePass<TensorModule>({
  id: 'tensor.split-sum',
  version: '1',
  description: 'Accumulate single-axis sums in blocks of four',
  ir: TensorIR,
  adapter: tensorAdapter,
  writes: { entities: ['definition'], relations: [] },
  run({ before }) {
    let edits = 0;
    const functions = before.value.functions.map(f => ({
      ...f,
      definitions: f.definitions.map(d => ({
        ...d,
        body: rewrite(d.body, e => {
          if (e.kind !== 'fold' || e.op !== 'sum' || e.axes.length !== 1 || e.axes[0].kind !== 'full')
            return e;
          edits++;
          const [axis] = e.axes,
            outer = 'block:' + axis.id,
            size = 4;
          return {
            ...e,
            axes: [{ kind: 'blocks', id: outer, extent: axis.extent, size }],
            body: { ...e, axes: [{ ...axis, kind: 'within', outer, size }] },
          };
        }),
      })),
    }));
    if (edits) return { native: { functions }, edits };
  },
});

interface Step {
  name: string;
  pass: Pass<TensorModule, {}, void>;
  relation: Relation;
}
const builtins = new Map<string, Step>([
  ['inline', { name: 'inline', pass: inline, relation: 'exact' }],
  ['split-sum', { name: 'split-sum', pass: splitSum, relation: 'tolerance' }],
]);
export function runSteps(program: TixProgram, plan: Step[]) {
  const steps: { pass: string; accepted: boolean }[] = [];
  for (const { name, pass, relation } of plan) {
    try {
      const result = applyNativePassSync(pass, program.current, (before, after) =>
        checkMeaning(relation, program.origin, before, after),
      );
      if (result.changed) program = Object.freeze({ origin: program.origin, current: result.artifact });
      steps.push({ pass: name, accepted: true });
    } catch (e) {
      if (!(e instanceof PassError) || e.code !== 'contractRejected') throw e;
      steps.push({ pass: name, accepted: false });
    }
  }
  return { program, steps };
}
export function optimizeTix(program: TixProgram, passes: string[]) {
  return runSteps(
    program,
    passes.map(name => {
      const step = builtins.get(name);
      if (!step) throw new Error(`unknown Tix pass ${name}`);
      return step;
    }),
  );
}
