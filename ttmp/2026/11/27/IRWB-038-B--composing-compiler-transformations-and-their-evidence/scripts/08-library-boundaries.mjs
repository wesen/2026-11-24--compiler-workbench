// Run from the review worktree root after building dist/.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const at = path => import(pathToFileURL(resolve('dist', path)));
const {intervals, usesOf, defsOf} = await at('typed/backend/regalloc.js');
const {solve} = await at('framework/dataflow/solver.js');
const {setLattice} = await at('framework/dataflow/lattices.js');
const {compileTix, runTix} = await at('tensor/index.js');
const {F32_BINARY, fromBits, toBits} = await at('typed/f32.js');

const program = compileTix('fn f(x:f32[N]):f32[N]{y[i]=max(x[i],1);return y;}');
const tixMax = runTix(program, 'f', {x:{shape:[1], data:Float32Array.of(NaN)}}).data[0];
const typedMax = fromBits(F32_BINARY.fmax(toBits(NaN), toBits(1)));
assert.ok(Number.isNaN(tixMax));
assert.equal(typedMax, 1);
console.log('max(NaN,1): Tix NaN, Typed 1');

const code = [
  {op:'j', target:'join'},
  {op:'label',name:'dead'}, {op:'j',target:'join'},
  {op:'label',name:'join'}, {op:'add',rd:66,rs1:64,rs2:65}
];
const machine = intervals(code);
const ids = machine.blocks.map((_, i) => String(i));
const succ = id => machine.blocks[Number(id)].succ.map(String);
const graph = {entry:ids[0],blocks:ids,succ,preds:id=>ids.filter(b=>succ(b).includes(id))};
function transfer(id, liveOut) {
  const live = new Set(liveOut);
  const {start,end} = machine.blocks[Number(id)];
  for (let i=end; i>=start; i--) {
    for (const reg of defsOf(code[i])) live.delete(reg);
    for (const reg of usesOf(code[i])) live.add(reg);
  }
  return live;
}
const facts = solve(graph,{direction:'backward',lattice:setLattice(),transfer});
const ordered = values => [...values].sort((a,b)=>a-b);
const machineOut = machine.liveOut.map(ordered);
const solverOut = ids.map(id=>ordered(facts.out.get(id)));
assert.deepEqual(machineOut, [[64,65],[64,65],[]]);
assert.deepEqual(solverOut, [[64,65],[],[]]);
console.log('machine vs entry-reachable live-out', machineOut, solverOut);

// Existing fixtures provide independent oracles for the graph and testing clients.
const {execFileSync} = await import('node:child_process');
execFileSync(process.execPath, [
  '--test','--test-name-pattern=phis at the loop head|loop whose header|sccp finds|Blend facts|strong cases extend|f32 operations on bits',
  'tests/typed/ssa.test.mjs','tests/typed/evaluate-analyses.test.mjs',
  'tests/typed/mutate.test.mjs','tests/typed/f32.test.mjs'
], {stdio:'inherit'});
