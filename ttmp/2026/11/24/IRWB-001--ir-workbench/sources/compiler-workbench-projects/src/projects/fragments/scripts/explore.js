// Fragments: add members to handles: the walk-through. Run it on r0
// (Scripts view) to see it from the start.
if (!wb.fragments().some(f => f.name === 'cost'))
  wb.fragment('cost')
    .on('Value')
    .attr(
      'cost',
      v =>
        ({ mul: 3, div: 34, rem: 34, load: 2, load16u: 2, call: 5 })[
          v.op
        ] ?? 1,
    )
    .on('Function')
    .method('cost', f => f.values().sum(v => v.cost));
wb.use('cost');
const before = p.fn('blend').cost();
p.pipeline('O2');
return {
  before,
  after: p.fn('blend').cost(),
  note: 'illustrative costs, not measured ones',
};
