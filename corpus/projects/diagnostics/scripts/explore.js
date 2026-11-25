// Mistakes and the errors they get: the walk-through. Run it on r0 (Scripts
// view) to see it from the start.
const tries = {
  typo: () => p.fn('f').blokcs(),
  assign: () => {
    p.fn('f').name = 'g';
  },
  noWrites: () =>
    p.apply(
      wb.pass('sneaky').run((fn, tx) =>
        tx.rewrite(v => (v.op === 'mul' ? tx.const(0) : undefined)),
      ),
    ),
  noBecause: () =>
    p.apply(
      wb.pass('rude')
        .writes('stmts')
        .run((fn, tx) => tx.remove(fn.stmts().first().id)),
    ),
  badPass: () => p.apply('constant-fold'),
};
const out = {};
for (const [k, fn] of Object.entries(tries)) {
  try {
    fn();
    out[k] = 'no error?';
  } catch (e) {
    out[k] = e.message;
  }
}
return out;
