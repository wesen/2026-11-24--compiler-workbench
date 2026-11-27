#!/usr/bin/env node
// IRWB-046-C probe 01: the two answers liveness can give for a block no path from the entry reaches.
//   block 0 (entry): j join          block 1 (dead label): j join          join: uses r64, r65; ret
// Block 1 is unreachable. The join's live-in is {64, 65} because the join uses them, so block 1's live-out is
// {64, 65} in the machine code's liveness (src/typed/backend/regalloc.ts `intervals`, which sweeps every block) and
// {} in the framework's solver (src/framework/dataflow/solver.ts, which visits only entry-reachable blocks).
// Run after `npm run build`:  node scripts/01-unreachable-block-scopes.mjs
const { intervals, machineBlocks } = await import('../../../../../../dist/typed/backend/index.js');
const { solve, setLattice } = await import('../../../../../../dist/framework/dataflow/index.js');

const m = (op, extra = {}) => ({ op, covers: [], ...extra });
const CODE = [
  m('label', { name: 'entry' }), // item 0, block 0
  m('j', { target: 'join' }), // item 1
  m('label', { name: 'dead' }), // item 2, block 1 — nothing jumps to `dead`
  m('j', { target: 'join' }), // item 3
  m('label', { name: 'join' }), // item 4, block 2
  m('add', { rd: 66, rs1: 64, rs2: 65 }), // item 5: uses 64 and 65, defines 66
  m('ret'), // item 6
];

const blocks = machineBlocks(CODE);
console.log('blocks:', blocks.map(b => ({ start: b.start, end: b.end, labels: b.labels, succ: b.succ })));

// 1. the machine code's liveness: every block, as `intervals` computes it today
const { list, liveOut } = intervals(CODE);
const set = s => `{${[...s].sort((x, y) => x - y).join(', ')}}`;
console.log('machine liveness (every block):');
blocks.forEach((b, k) => console.log(`  block ${k} ${JSON.stringify(b.labels)} live-out ${set(liveOut[k])}`));
for (const x of list) console.log(`  interval r${x.reg}: [${x.start}, ${x.end}]`);
console.log('  r64 and r65 are stretched back to item', list.find(x => x.reg === 64)?.start, 'and',
  list.find(x => x.reg === 65)?.start, '(block 1, items 2-3)');
console.log('  r66, defined in the join:', JSON.stringify(list.find(x => x.reg === 66)));

// 2. the framework's solver: entry-reachable blocks only (its `sources` filter drops unreachable blocks)
const names = blocks.map((b, k) => (b.labels[0] ?? `b${k}`));
const index = new Map(names.map((n, k) => [n, k]));
const graph = {
  entry: names[0],
  blocks: names,
  succ: b => blocks[index.get(b)].succ.map(s => names[s]),
  preds: b =>
    blocks
      .map((x, k) => k)
      .filter(k => blocks[k].succ.includes(index.get(b)))
      .map(k => names[k]),
};
const use = [new Set([64, 65]), new Set([64, 65]), new Set([64, 65])],
  def = [new Set([66]), new Set(), new Set()];
const solution = solve(graph, {
  direction: 'backward',
  lattice: setLattice(),
  transfer: (b, out) => {
    const k = index.get(b);
    const s = new Set(use[k]);
    for (const r of out) if (!def[k].has(r)) s.add(r);
    return s;
  },
  strategy: 'round-robin',
});
console.log('framework solver (entry-reachable only):');
for (const b of names) {
  const k = index.get(b);
  console.log(`  block ${k} ${JSON.stringify(blocks[k].labels)} in ${set(solution.in.get(b))} out ${set(solution.out.get(b))}`);
}
console.log('disagreement on block 1 live-out:', set(liveOut[1]), 'vs', set(solution.out.get(names[1])));
