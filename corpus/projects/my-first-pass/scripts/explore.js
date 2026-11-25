// Write a pass: x + x into x * 2: the walk-through. Run it on r0 (Scripts
// view) to see it from the start.
wb.pass('add-self')
  .about('x + x, for a pure x, becomes x * 2')
  .writes('values')
  .preserves('cfg', 'dominators', 'loops', 'liveness', 'reaching')
  .run((fn, tx) => {
    tx.rewrite(v => {
      if (v.op === 'add' && v.args[0].isPure && v.args[0].same(v.args[1]))
        return tx.make('mul', v.args[0].id, tx.const(2), {
          because: [v.args[1].id],
          note: 'x + x = x * 2',
        });
    });
  });
const r = p.apply('add-self');
log(p.edits(r.rev).map(e => e.text));
p.apply('simplify'); // x * 2 then becomes x << 1
return { listing: p.listing(), check: p.check().status };
