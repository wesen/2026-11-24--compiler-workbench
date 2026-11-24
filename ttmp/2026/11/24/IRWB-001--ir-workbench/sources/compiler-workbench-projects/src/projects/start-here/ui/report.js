// The O2 report: a workbench script's result as a tile. The script runs on
// a fresh copy, so it can change that copy freely; the level is a
// parameter, and the tile reruns when it moves.
const level = ui.param.choice('report level', ['O1', 'O2', 'loops'], {
  default: 'O2',
});
const report = ui.from('o2-report', { level }, { fresh: true });

return ui.tile('report')
  .title(level.map(l => `${l} report`))
  .place({ tabWith: 'status' })
  .body(
    ui.col(
      ui.row(ui.select(level)),
      ui.row(
        ui.stat(
          'bytes',
          report.map(r => r.bytes.after),
        ).compareTo(report.map(r => r.bytes.before)),
        ui.stat(
          'instructions run',
          report.map(r => r.steps.after),
        ).compareTo(report.map(r => r.steps.before)),
        ui.badge(
          report.map(r =>
            r.check === 'agree' ? 'checks agree' : 'checks DISAGREE',
          ),
        ),
      ),
      ui.table(report.map(r => r.passes))
        .columns('pass', 'rev', 'edits')
        .empty('No pass changed anything.'),
    ),
  );
