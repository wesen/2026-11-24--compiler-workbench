// A task: replay the open program's passes on a fresh copy for every
// register count from 1 to 24, and chart bytes and spills as the rows
// arrive. It restarts when the order or spill choice moves.
const order = ui.param.choice('order', ['caller', 'callee'], {
  default: 'caller',
});
const spill = ui.param.choice('spill', ['furthest', 'current'], {
  default: 'furthest',
});
const sweep = ui.task(
  async ({ p, project }, { signal, progress, partial }) => {
    const passes = p.revisions().map(r => r.pass);
    for (let n = 1; n <= 24 && !signal.aborted; n++) {
      const r = project.run(
        'replay',
        {
          passes,
          options: { registers: n, order: order.value, spill: spill.value },
        },
        { fresh: true },
      );
      partial({
        registers: n,
        bytes: r.bytes,
        spills: r.fns.reduce((s, f) => s + f.spills, 0),
        steps: r.steps,
      });
      progress(n / 24);
      await ui.idle();
    }
  },
).restartOn(order, spill);

return ui.tile('spill-curve')
  .title('Spill curve')
  .place({ tabWith: 'registers' })
  .body(
    ui.col(
      sweep.controls(),
      ui.chart(sweep.rows)
        .line()
        .x('registers')
        .y('bytes', 'spills')
        .title('bytes (left) and spills (right) by register count'),
      ui.table(sweep.rows)
        .columns('registers', 'bytes', 'spills', 'steps')
        .empty('Press Start to sweep.'),
    ),
  );
