// Records in memory: the walk-through. Run it on r0 (Scripts view) to see
// it from the start.
p.pipeline('O2');
const stores = p.fn('nudge')
  .stmts()
  .where(s => s.op === 'store')
  .table('id', 'text');
return { stores, check: p.check().status };
