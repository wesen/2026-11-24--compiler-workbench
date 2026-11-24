// What to apply next: every built-in pass that would change something now,
// with a button each. The query is read-only (dryRun changes nothing); the
// handler is where the program changes.
const actions = ui.query(({ p }) => p.actions(), 'actions');

const applyBtn = row =>
  ui.button(`apply ${row.pass}`).on(({ p }) => p.apply(row.pass));

return ui.tile('next')
  .title(actions.map(a => `Next pass · ${a.length}`))
  .place({ tabWith: 'status' })
  .body(
    ui.col(
      ui.table(actions)
        .columns('pass', 'edits', ['', applyBtn])
        .empty('Nothing left to do: every pass is at a fixed point.'),
      ui.row(
        ui.button('undo')
          .on(({ p }) => p.undo())
          .disabledIf(ui.query(({ p }) => p.rev === 0)),
        ui.button('back to r0').on(({ p }) => p.checkout('r0')),
      ),
    ),
  );
