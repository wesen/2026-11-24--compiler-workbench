// A plain backend against the tuned one on the same input, line by line,
// from scripts/compare.js (run on a fresh copy, so its two images do not
// land on the open program).
const size = ui.param.int('size', { min: 0, max: 40, default: 16 });
const shape = ui.param.choice(
  'shape',
  ['reversed', 'sorted', 'random', 'sawtooth'],
  { default: 'reversed' },
);
const input = ui.derive({ size, shape }, ({ size, shape }) =>
  Array.from({ length: size }, (_, i) =>
    shape === 'reversed'
      ? size - i
      : shape === 'sorted'
        ? i
        : shape === 'sawtooth'
          ? (i * 7) % 11
          : (i * 1103515245 + 12345) % 251,
  ),
);
const cmp = ui.from('compare', { input }, { fresh: true });

return ui.tile('heat-compare')
  .title('Plain vs tuned')
  .place({ tabWith: 'heat' })
  .body(
    ui.col(
      ui.row(
        ui.stat(
          'plain backend',
          cmp.map(c => c.steps.plain),
        ).unit('instructions'),
        ui.stat(
          'tuned',
          cmp.map(c => c.steps.tuned),
        ).share(cmp.map(c => c.steps.plain)),
      ),
      ui.chart(cmp.map(c => c.rows))
        .bar()
        .x('line')
        .y('plain', 'tuned')
        .sameAxis()
        .title('instructions per line, plain and tuned'),
      ui.table(cmp.map(c => c.rows))
        .columns('line', 'text', 'plain', 'tuned')
        .heat('plain', 'tuned'),
    ),
  );
