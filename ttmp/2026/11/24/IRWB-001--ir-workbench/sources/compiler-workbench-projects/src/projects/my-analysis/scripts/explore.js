// Write an analysis: the walk-through. Run it on r0 (Scripts view) to see
// it from the start.
wb.analysis('reassigned')
  .about(
    'locals assigned again, after the entry block, on some path ' +
      'to the start of each block',
  )
  .forward()
  .lattice(wb.lattice.set())
  .transfer((block, inn) =>
    block.preds().length ? new Set([...inn, ...block.defs()]) : inn,
  )
  .register();
const fact = p.fn('f').fact('reassigned');
const names = s => [...s].map(i => p.fn('f').locals()[i].name);
return {
  id: fact.id,
  visits: fact.visits,
  in: Object.fromEntries([...fact.value.in].map(([b, s]) => [b, names(s)])),
};
