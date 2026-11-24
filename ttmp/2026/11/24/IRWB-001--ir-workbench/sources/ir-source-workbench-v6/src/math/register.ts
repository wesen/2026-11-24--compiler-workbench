import type { Registry, Task } from '../core/types.js';
import { compileTape, validateNumericTape, validateResidualProgram, type NumericTape, type ResidualProgram } from './expressions.js';

/** Shared IRs and algorithms; registration has no CAD/physics/game dependency. */
export function registerMath(registry: Registry): void {
  registry.registerKind<ResidualProgram>({
    id: 'math.residual-program', version: '1', description: 'Scalar symbolic DAG with named residuals and explicit unknown/parameter partition', validate: validateResidualProgram,
    describe: p => ({ label: 'Residual program', stats: { nodes: p.nodes.length, residuals: p.residuals.length, unknowns: p.variables.length } }),
    structure: p => p.nodes.flatMap(n => n.args.map(a => ({ from: `expr:${a}`, to: `expr:${n.id}`, relation: 'operand' }))),
  });
  registry.registerKind<NumericTape>({
    id: 'math.numeric-tape', version: '1', description: 'Topologically ordered scalar instructions with forward automatic differentiation', validate: validateNumericTape,
    describe: t => ({ label: 'Numeric tape', stats: { instructions: t.instructions.length, outputs: t.outputs.length, folded: t.foldedNodeCount } }),
    structure: t => t.instructions.flatMap((n, i) => n.args.map(a => ({ from: `register:${a}`, to: `register:${i}`, relation: 'operand' }))),
  });
  registry.register<{ program: Task }, NumericTape>({
    id: 'math.compile-tape', version: '1', kind: 'math.numeric-tape', description: 'Compile reachable symbolic residuals into an interned numeric tape',
    async run(ctx, { program }) {
      const source = await ctx.require<ResidualProgram>(program), tape = compileTape(source.value);
      ctx.metric('instructions', tape.instructions.length); ctx.metric('foldedNodes', tape.foldedNodeCount); ctx.metric('eliminatedNodes', tape.eliminatedNodeCount);
      for (let i = 0; i < tape.instructions.length; i++) ctx.derive(source, { from: tape.instructions[i].origins.map(id => `expr:${id}`), to: [`register:${i}`], relation: 'tape-lowering' });
      return tape;
    },
  });
}
