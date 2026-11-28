#!/usr/bin/env node
// IRWB-047-B probe 01: the primitives' answers on the four small graphs the stdlib test uses, printed so the test's
// expectations are read off a run rather than guessed. Each graph is also printed as its predecessor lists.
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const { depthFirst, dominators, dominates, dominatorTree, naturalLoops, predecessors } = await import(
  pathToFileURL(resolve(root, 'dist/stdlib/index.js')).href
);

const G = (entry, edges) => {
  const nodes = [...new Set([entry, ...edges.flat()])];
  const succ = new Map(nodes.map(n => [n, []]));
  for (const [from, to] of edges) succ.get(from).push(to);
  return { nodes, entry, succ: n => succ.get(n) ?? [] };
};
const show = (name, g) => {
  const d = depthFirst(g),
    dom = dominators(g);
  console.log(`\n== ${name}`);
  console.log(`predecessors  ${[...predecessors(g)].map(([n, p]) => `${n}<-{${p.join(',')}}`).join(' ')}`);
  console.log(`postorder     ${d.postorder.join(' ')}`);
  console.log(`rpo           ${d.rpo.join(' ')}`);
  console.log(`retreating    ${d.retreating.map(e => `${e.from}->${e.to}`).join(' ') || '(none)'}`);
  console.log(`idom          ${[...dom.idom].map(([n, p]) => `${n}<-${p}`).join(' ')}  rounds=${dom.rounds}`);
  console.log(`dom-tree      ${[...dominatorTree(dom.idom)].map(([n, c]) => `${n}:[${c.join(',')}]`).join(' ')}`);
  for (const [a, b] of [
    ['e', 't'],
    ['c', 'd'],
    ['a', 'd'],
    ['h', 'l1'],
    ['l1', 'l2'],
    ['u', 'u'],
    ['e', 'u'],
    ['a', 'b'],
    ['b', 'a'],
  ])
    if (dom.idom.has(a) || dom.idom.has(b) || g.nodes.includes(a))
      if (g.nodes.includes(a) && g.nodes.includes(b)) console.log(`dominates     ${a} dom ${b} = ${dominates(dom.idom, a, b)}`);
  for (const L of naturalLoops(g))
    console.log(
      `loop          header=${L.header} latches=[${L.latches}] body=[${L.body}] exits=[${L.exits}] preheader=${L.preheader}`,
    );
  if (!naturalLoops(g).length) console.log('loop          (none)');
};

// A: a loop whose header has one outside predecessor, which is a preheader
show('A loop with a preheader', G('e', [['e', 'a'], ['a', 'c'], ['c', 'd'], ['c', 'x'], ['d', 'c']]));
// A2: the same loop with a second outside predecessor: no single preheader
show('A2 loop with two outside predecessors', G('e', [['e', 'a'], ['e', 'b'], ['a', 'c'], ['b', 'c'], ['c', 'd'], ['c', 'x'], ['d', 'c']]));
// B: an unreachable block, and a self-loop on an unreachable block
show('B unreachable block and self-loop', G('e', [['e', 't'], ['u', 't'], ['u', 'u']]));
// C: two back edges to one header (a `continue` shape)
show('C two back edges to one header', G('e', [['e', 'h'], ['h', 'a'], ['h', 'x'], ['a', 'l1'], ['a', 'l2'], ['l1', 'h'], ['l2', 'h']]));
// D: an irreducible two-entry cycle
show('D irreducible two-entry cycle', G('e', [['e', 'a'], ['e', 'b'], ['a', 'b'], ['b', 'a'], ['a', 'x'], ['b', 'x']]));
