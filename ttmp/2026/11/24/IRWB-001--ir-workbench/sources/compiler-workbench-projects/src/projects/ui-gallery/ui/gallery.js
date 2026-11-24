// Every built-in component once, grouped in tabs. Reading p in a cell makes
// the tile follow the program.
const rev = ui.query(({ p }) => p.rev, 'rev');
const fns = ui.query(
  ({ p }) =>
    p.fns().map(name => ({
      fn: name,
      stmts: p.fn(name).stmts().count(),
      values: p.fn(name).values().count(),
      muls: p.fn(name).values().op('mul').count(),
    })),
  'fns',
);
const history = ui.from('sizes');
const sel = ui.selection();
const n = ui.param.int('gallery n', { min: 1, max: 12, default: 6 });
const show = ui.param.bool('gallery details', { default: true });
const pick = ui.param.choice(
  'gallery fn',
  fns.map(rows => rows.map(r => r.fn)),
);
const tags = ui.param.set('gallery tags', ['loops', 'calls', 'traps'], {
  default: ['loops'],
});
const note = ui.state('type here', 'note');
const clicks = ui.state(0, 'clicks');
const why = ui.query(({ p }) => {
  const s = p.fn('score')
    .stmts()
    .where(x => x.op === 'return')
    .first();
  return s ? p.why(s.id) : null;
}, 'why');
const listing = ui.query(({ p }) => p.listing('score'), 'listing');
const r0listing = ui.query(
  ({ project }) => project.fresh().listing('score'),
  'r0 listing',
);
const curve = n.map(k =>
  Array.from({ length: k + 1 }, (_, i) => ({
    x: i,
    square: i * i,
    double: 2 * i,
  })),
);

return ui.tile('gallery')
  .title(rev.map(r => `Gallery · ${r}`))
  .place({ splitRight: 'ir', size: 0.5 })
  .body(
    ui.tabs({
      values: ui.col(
        ui.text('**text**: Markdown, with ids like `fn:score` that link.'),
        ui.row(
          ui.stat('revision', rev),
          ui.stat('functions', fns.map(r => r.length)),
          ui.stat(
            'multiplies',
            fns.map(r => r.reduce((s, x) => s + x.muls, 0)),
          ).badIf(k => k > 2),
        ),
        ui.row(
          ui.badge('plain'),
          ui.badge('good', 'good'),
          ui.badge('warn', 'warn'),
          ui.badge('accent', 'accent'),
          ui.badge(rev),
        ),
        ui.code(listing, 'text'),
        ui.json(fns.map(r => r[0])),
      ),
      tables: ui.col(
        ui.table(fns)
          .columns('fn', 'stmts', 'values', ['muls ×2', r => r.muls * 2])
          .onRow((r, { wb }) => wb.focus(`fn:${r.fn}`))
          .title('table: click a row to select the function'),
        ui.table(history)
          .columns('rev', 'pass', 'edits')
          .title('from a script: ui.from("sizes")'),
        ui.list(fns.map(r => r.map(x => x.fn))).item(name =>
          ui.row(ui.badge(name), ui.text(`a function`)),
        ),
      ),
      charts: ui.col(
        ui.row(ui.slider(n)),
        ui.chart(curve)
          .line()
          .x('x')
          .y('square', 'double')
          .title('line, two axes'),
        ui.chart(curve).bar().x('x').y('square').title('bar'),
        ui.chart(curve)
          .scatter()
          .x('double')
          .y('square')
          .mark(r => (r.x % 2 ? 'cross' : 'dot'))
          .title('scatter with marks'),
      ),
      controls: ui.col(
        ui.row(ui.slider(n), ui.toggle(show), ui.select(pick)),
        ui.multiselect(tags),
        ui.row(
          ui.input(note, { placeholder: 'a note' }),
          ui.text(note.map(t => `you wrote: *${t}*`)),
        ),
        ui.row(
          ui.button(clicks.map(c => `clicked ${c}`)).on(() =>
            clicks.update(c => c + 1),
          ),
          ui.button('apply fold')
            .tone('primary')
            .on(({ p }) => p.apply('fold'))
            .disabledIf(
              ui.query(
                ({ p }) => !p.actions().some(a => a.pass === 'fold'),
              ),
            ),
        ),
        ui.when(show, () =>
          ui.text(
            ui.derive(
              { n, pick, tags },
              v =>
                `n = ${v.n}, function ${v.pick}, ` +
                `tags ${v.tags.join(', ') || 'none'}`,
            ),
          ),
        ).else(ui.text('_details are off_')),
      ),
      layout: ui.col(
        ui.section(
          'section',
          ui.text(
            'A section has a header; row and col lay components out.',
          ),
        ),
        ui.row(
          ui.col(ui.badge('col 1'), ui.text('stacked')),
          ui.col(ui.badge('col 2'), ui.text('side by side')),
        ),
        ui.when(
          sel.map(s => s.id),
          id => ui.text(`selected: \`${id}\``),
        ).else(
          ui.text('Select something in the IR: this line follows it.'),
        ),
      ),
      provenance: ui.col(
        ui.text('**tree**: why the return in score is what it is.'),
        ui.tree(why),
        ui.text('**diff**: the listing of score at r0 against now.'),
        ui.diff(ui.derive({ a: r0listing, b: listing }, x => x)),
      ),
    }),
  );
