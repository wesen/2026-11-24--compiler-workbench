// The bounds-check helper: every check, what bce would do with it now, and
// why. The rows come from scripts/checks.js; they follow the program, the
// selection follows the IR.
const checks = ui.from('checks');
const sel = ui.selection();
const count = what =>
  checks.map(rows => rows.filter(r => r.bce === what).length);
const removable = count('removes');

return ui.tile('bce')
  .title(checks.map(rows => `Bounds checks · ${rows.length}`))
  .place({ splitRight: 'ir', size: 0.45 })
  .body(
    ui.col(
      ui.row(
        ui.stat('checks', checks.map(rows => rows.length)),
        ui.stat('bce removes', removable),
        ui.stat('stay', count('keeps')).badIf(n => n > 0),
      ),
      ui.table(checks)
        .columns('fn', 'line', 'test', 'bce', 'why')
        .rowClass(r => (r.bce === 'removes' ? 'good' : 'warn'))
        .highlight(sel, (r, s) => s.id === r.check)
        .onRow((r, { wb }) => wb.focus(r.check))
        .empty('No bounds checks left.'),
      ui.row(
        ui.button('apply bce')
          .tone('primary')
          .on(({ p }) => {
            p.apply('bce');
            p.apply('cfg');
          })
          .disabledIf(removable.map(n => n === 0)),
        ui.button('undo')
          .on(({ p }) => p.undo())
          .disabledIf(ui.query(({ p }) => p.rev === 'r0')),
      ),
      ui.section(
        'What the checks cost',
        ui.table(ui.from('sweep', {}, { fresh: true })).columns(
          'pipeline',
          'bytes',
          'steps',
        ),
      ),
    ),
  );
