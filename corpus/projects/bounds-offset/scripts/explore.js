// Reading the next element: the walk-through. Run it on r0 (Scripts view)
// to see it from the start.
p.pipeline('O2');
const traps = p.fn('rises')
  .stmts()
  .where(s => s.op === 'trap')
  .count();
return {
  traps,
  note: 'bce needs the loop test to compare the same local the check uses',
};
