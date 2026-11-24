// The pass-order explorer. Pick passes; a task tries every order of them on
// fresh copies, and rows arrive as each finishes. It restarts when the set
// changes. A row's button replays it.
const passes = ui.param.set(
  'passes',
  ['fold', 'constprop', 'simplify', 'licm', 'lvn', 'strength', 'subst'],
  { default: ['fold', 'licm', 'lvn', 'strength'] },
);
const permutations = list =>
  list.length <= 1
    ? [list]
    : list.flatMap((x, i) =>
        permutations(list.filter((_, j) => j !== i)).map(rest => [
          x,
          ...rest,
        ]),
      );

const explore = ui.task(
  async ({ project }, { signal, progress, partial }) => {
    const orders = permutations(passes.value).slice(0, 120);
    for (let i = 0; i < orders.length && !signal.aborted; i++) {
      partial({
        n: i + 1,
        list: orders[i],
        ...project.run('try-order', { order: orders[i] }, { fresh: true }),
      });
      progress((i + 1) / orders.length);
      await ui.idle();
    }
  },
).restartOn(passes);

const best = explore.rows.map(rows =>
  rows.length ? Math.min(...rows.map(r => r.bytes)) : null,
);
const replay = row =>
  ui.button('replay').on(({ p }) => {
    p.checkout('r0');
    p.pipeline(['cfg', ...row.list, 'dce'], { checkEach: false });
  });

return ui.tile('orders')
  .title(explore.rows.map(rows => `Pass orders · ${rows.length}`))
  .place({ splitRight: 'pipeline', size: 0.5 })
  .body(
    ui.col(
      ui.multiselect(passes),
      explore.controls(),
      ui.row(
        ui.stat('orders tried', explore.rows.map(r => r.length)),
        ui.stat('smallest image', best).unit('bytes'),
        ui.stat(
          'disagreeing',
          explore.rows.map(
            rows => rows.filter(r => r.check !== 'agree').length,
          ),
        ).badIf(n => n > 0),
      ),
      ui.chart(explore.rows)
        .bar()
        .x('n')
        .y('bytes')
        .tone(r =>
          r.check !== 'agree'
            ? 'bad'
            : r.bytes === best.peek()
              ? 'good'
              : 'ink',
        )
        .title('image bytes per order (green: smallest)'),
      ui.table(explore.rows)
        .columns('n', 'order', 'bytes', 'stmts', 'steps', 'check', [
          '',
          replay,
        ])
        .sort('bytes')
        .limit(30)
        .empty('Press Start to try every order.'),
    ),
  );
