// The heat map: shape an input, run the current image on it, and see where
// the instructions go: counts in the source gutter, a shade on hot lines,
// badges on the hottest instructions.
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
const heat = ui.query(({ p }) => {
  const img =
    // reuse the current image
    p.image() && p.image().status === 'current' ? p.image() : p.compile();
  return { image: img.id, ...img.heat('sort', [input.value]) };
}, 'heat');
const peak = heat.map(h => Math.max(1, ...Object.values(h.byLine)));

ui.annotate('source').gutter(line => {
  const n = heat.value.byLine[line];
  return n ? ui.badge(String(n), 'dim') : null;
});
ui.annotate('source').lineClass(line => {
  const n = heat.value.byLine[line] || 0;
  return n
    ? 'heat' + Math.min(4, 1 + Math.floor((4 * n) / peak.value))
    : '';
});
ui.annotate('rv32').insn(x => {
  const hot = heat.value.hottest.find(h => h.insn === x.id);
  return hot && ui.badge(`${hot.n}×`, 'warn');
});

const lines = ui.query(({ p }) => p.source.split('\n'), 'lines');
const rows = ui.derive({ heat, lines }, ({ heat, lines }) =>
  Object.entries(heat.byLine).map(([line, n]) => ({
    line: +line,
    text: lines[line - 1].trim(),
    n,
  })),
);

return ui.tile('heat')
  .title(heat.map(h => `Heat · ${h.steps} instructions`))
  .place({ splitRight: 'source', size: 0.45 })
  .body(
    ui.col(
      ui.row(ui.slider(size), ui.select(shape)),
      ui.row(
        ui.stat('instructions run', heat.map(h => h.steps)),
        ui.stat('swaps', heat.map(h => h.result)),
        ui.stat(
          'hottest line',
          rows.map(
            r =>
              r.reduce((a, b) => (b.n > a.n ? b : a), { line: '–', n: 0 })
                .line,
          ),
        ),
      ),
      ui.table(rows)
        .columns('line', 'text', 'n')
        .heat('n')
        .onRow((r, { p, wb }) => {
          const op = p.fn('sort').ops().line(r.line).first();
          if (op) wb.focus(op.id);
        }),
      ui.section(
        'Hottest instructions',
        ui.table(heat.map(h => h.hottest))
          .columns('insn', 'text', 'n')
          .heat('n')
          .onRow((r, { wb }) => wb.focus(r.insn)),
      ),
    ),
  );
