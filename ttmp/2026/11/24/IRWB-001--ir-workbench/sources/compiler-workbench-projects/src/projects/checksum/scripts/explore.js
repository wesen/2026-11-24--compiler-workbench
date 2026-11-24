// Checksum: a check that goes away: the walk-through. Run it on r0 (Scripts
// view) to see it from the start.
p.pipeline(['cfg', 'fold', 'simplify', 'constprop', 'dce', 'cfg']);
const before = p.fn('total')
  .stmts()
  .where(s => s.op === 'br_if')
  .count();
const r = p.apply('bce');
log(p.edits(r.rev));
const after = p.fn('total')
  .stmts()
  .where(s => s.op === 'br_if')
  .count();
p.apply('cfg');
return { branches: [before, after], check: p.check().status };
