// Read-only: the shape of every function right now (statements, loops,
// multiplies, bounds checks). It changes nothing, so the UI can call it on
// the open program: ui.from('shape').
return p.fns().map(name => {
  const f = p.fn(name);
  return {
    fn: name,
    stmts: f.stmts().count(),
    blocks: f.blocks().count(),
    loops: f.loops().length,
    muls: f.values().op('mul').count(),
    calls: f.values().op('call').count(),
    traps: f.stmts()
      .where(s => s.op === 'trap')
      .count(),
  };
});
