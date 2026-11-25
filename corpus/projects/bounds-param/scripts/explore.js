// A loop to n, not to length: the walk-through. Run it on r0 (Scripts view)
// to see it from the start.
p.pipeline('O2');
const c = p.check({ count: 200 });
return {
  traps: p.fn('prefix')
    .stmts()
    .where(s => s.op === 'trap')
    .count(),
  bothTrap: c.fns[0].bothTrap,
  agree: c.fns[0].agree,
};
