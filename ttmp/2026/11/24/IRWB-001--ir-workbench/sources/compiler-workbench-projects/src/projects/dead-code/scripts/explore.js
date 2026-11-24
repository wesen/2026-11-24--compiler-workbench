// Dead stores and a branch that never runs: the walk-through. Run it on r0
// (Scripts view) to see it from the start.
const blocks = () => p.fn('pick').blocks().count();
const b0 = blocks();
p.pipeline('O1');
log(
  p.diff('r0').filter(e => e.kind === 'remove' || e.kind === 'unreachable'),
);
return { blocks: [b0, blocks()], stmts: p.fn('pick').stmts().count() };
