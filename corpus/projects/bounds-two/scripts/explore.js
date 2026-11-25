// Two buffers, one proof: the walk-through. Run it on r0 (Scripts view) to
// see it from the start.
const traps = () =>
  p.fn('dot')
    .stmts()
    .where(s => s.op === 'trap')
    .count();
const before = traps();
p.pipeline('O2');
return {
  trapsBefore: before,
  trapsAfter: traps(),
  check: p.check({ count: 200 }),
};
