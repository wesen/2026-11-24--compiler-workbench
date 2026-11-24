// Strength reduction with ranges: the walk-through. Run it on r0 (Scripts
// view) to see it from the start.
p.pipeline(['cfg', 'simplify', 'constprop', 'dce', 'cfg']);
const ret = p.fn('meter')
  .stmts()
  .where(s => s.op === 'return')
  .first();
log(
  p.fn('meter')
    .fact('ranges')
    .value.at(
      ret.id,
      p.fn('meter')
        .locals()
        .find(l => l.name === 'level').index,
    ),
);
const r = p.apply('strength');
return {
  edits: p.edits(r.rev).map(e => e.fn + ' ' + e.text),
  check: p.check().status,
};
