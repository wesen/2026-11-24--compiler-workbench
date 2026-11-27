import './02-source-loader.mjs';
import assert from 'node:assert/strict';

const root = new URL('../../../../../../', import.meta.url);
const source = path => import(new URL(path, root));

const { F32_BINARY, isNaNBits, toBits } = await source('src/typed/f32.ts');
const { compileTix, runTix } = await source('src/tensor/index.ts');
const tensor = compileTix('fn f(x:f32[N], y:f32[N]):f32[N] { z[i] = max(x[i], y[i]); return z; }');
const result = runTix(tensor, 'f', {
  x: { shape: [2], data: Float32Array.of(NaN, -0) },
  y: { shape: [2], data: Float32Array.of(7, 0) },
});
const rv32 = [F32_BINARY.fmax(toBits(NaN), toBits(7)), F32_BINARY.fmax(toBits(-0), toBits(0))];
assert(isNaNBits(toBits(result.data[0])));
assert.equal(rv32[0], toBits(7));
assert.equal(toBits(result.data[1]), 0);
assert.equal(rv32[1], 0);
assert.equal(F32_BINARY.fadd(toBits(2 ** -149), toBits(2 ** -149)), 2);
console.log('binary32 max: Typed RV32F returns 7 for (NaN, 7); Tix propagates NaN; both return +0 for (-0, +0)');

const { add, constant, value } = await source('src/tensor/model.ts');
const max = Number.MAX_SAFE_INTEGER;
const factor = 4503599627370497;
const exact = Number(3n * BigInt(factor) - BigInt(max));
const observed = add(constant(-max), constant(factor), 3).constant;
assert.equal(observed, exact + 1);
assert.equal(value({ constant: 0, terms: [['a', 1], ['b', 1], ['c', -1]] },
  new Map([['a', max], ['b', 2], ['c', max]])), 1);
console.log('direct Tix affine helpers: rounded intermediates change safe final integers (outside the tested corpus)');

const { depthFirst, solve } = await source('src/framework/dataflow/solver.ts');
const { setLattice } = await source('src/framework/dataflow/lattices.ts');
const { flowGraph, loopsOf } = await source('src/typed/analyses.ts');
const nodes = { entry: ['a', 'b'], a: ['b'], b: ['a', 'exit'], exit: [] };
const fn = { blocks: Object.entries(nodes).map(([id, succ]) => ({ id, succ })) };
const irreducible = flowGraph(fn);
assert.deepEqual([...depthFirst(irreducible).loopHeads], ['a']);
assert.deepEqual(loopsOf({ get() { throw new Error('unexpected natural loop body'); } }, fn), []);
console.log('two-entry cycle: DFS names a retreating target; dominance finds no natural loop');

const { intervals, usesOf, defsOf } = await source('src/typed/backend/regalloc.ts');
const code = [
  { op: 'addi', rd: 64, rs1: 0 },
  { op: 'beq', rs1: 1, rs2: 2, target: 'left' },
  { op: 'addi', rd: 65, rs1: 64 },
  { op: 'j', target: 'join' },
  { op: 'label', name: 'left' },
  { op: 'addi', rd: 65, rs1: 64 },
  { op: 'label', name: 'join' },
  { op: 'add', rd: 1, rs1: 64, rs2: 65 },
  { op: 'ret' },
];
const machine = intervals(code);
const graph = flowGraph({
  blocks: machine.blocks.map((b, i) => ({ id: String(i), succ: b.succ.map(String) })),
});
const solution = solve(graph, {
  direction: 'backward', lattice: setLattice(),
  transfer(key, outgoing) {
    const b = machine.blocks[Number(key)];
    const live = new Set(outgoing);
    for (let i = b.end; i >= b.start; i--) {
      for (const def of defsOf(code[i])) live.delete(def);
      for (const use of usesOf(code[i])) live.add(use);
    }
    return live;
  },
});
assert.deepEqual(graph.blocks.map(b => solution.out.get(b)), machine.liveOut);
assert.deepEqual(machine.liveOut, [new Set([64]), new Set([64, 65]), new Set([64, 65]), new Set()]);
console.log('machine diamond: generic backward solver and native register liveness agree on all four live-out sets');
