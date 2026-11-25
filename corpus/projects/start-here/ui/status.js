// A status board: the revision, the size of the program, and its shape per
// function. Cells read the program, so the tile updates after every Apply,
// Undo or pipeline run.
const rev = ui.query(({ p }) => p.rev, 'rev');
const count = q => q.fns().reduce((n, f) => n + q.fn(f).stmts().count(), 0);
const stmts = ui.query(({ p }) => count(p), 'stmts');
const shape = ui.from('shape');
// reads the files only: a fresh copy is r0
const r0 = ui.query(({ project }) => count(project.fresh()), 'stmts at r0');

return ui.tile('status')
  .title(rev.map(r => `Status · ${r}`))
  .place({ splitRight: 'source', size: 0.5 })
  .body(
    ui.col(
      ui.row(
        ui.stat('revision', rev),
        ui.stat('statements', stmts).compareTo(r0),
        ui.stat(
          'traps',
          shape.map(rows => rows.reduce((n, r) => n + r.traps, 0)),
        ).badIf(n => n > 0),
      ),
      ui.table(shape)
        .columns('fn', 'stmts', 'blocks', 'loops', 'muls', 'calls', 'traps')
        .onRow((row, { wb }) => wb.focus(`fn:${row.fn}`)),
      ui.text(
        'Rows come from `scripts/shape.js`. Click one to select the function.',
      ),
    ),
  );
