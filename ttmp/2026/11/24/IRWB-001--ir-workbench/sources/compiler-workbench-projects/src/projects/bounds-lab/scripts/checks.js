// Read-only: every bounds check in the program, and what bce would do with
// it now. A check is a br_if on index >=u buffer.length whose taken arm
// traps. bce runs as a dry run: it reports the edits it would make and
// keeps none of them.
const isCheck = s =>
  s.op === 'br_if' &&
  s.cond.op === 'geu' &&
  p.get(s.then).stmts().first()?.op === 'trap';
const dry = p.dryRun('bce');
const removed = new Map(
  dry.changes.filter(c => c.kind === 'replaceStmt').map(c => [c.from, c]),
);
// the expression an index temporary holds, when the block assigns it
const defOf = (s, local) => {
  const set = p.get(s.block)
    .stmts()
    .where(x => x.op === 'set' && x.localName === local)
    .first();
  return set ? set.value.text : local;
};
return p.fns().flatMap(fn =>
  p.fn(fn)
    .stmts()
    .where(isCheck)
    .list()
    .map(s => {
      const index = s.cond.args[0].text;
      const buffer = s.cond.args[1].args[0].text;
      const expr = defOf(s, index);
      const c = removed.get(s.id);
      const fact = c && String(c.because[1]).replace(/^fact:/, '');
      const why = c
        ? `${c.because[0]} proved ${expr} < ${buffer}.length; ${fact}`
        : /[-+*]/.test(expr)
          ? `the index is ${expr}, not a local a branch compares`
          : `no branch above it proves ${expr} < ${buffer}.length`;
      return {
        fn,
        check: s.id,
        line: s.lines()[0],
        test: `${expr} <u ${buffer}.length`,
        bce: c ? 'removes' : 'keeps',
        why,
      };
    }),
);
