// Deliberate mistakes, each caught and shown with the error it raises. The
// DSL's builders are proxies, so a wrong member, a wrong kind of value or a
// side effect in a query names itself.
const cases = [
  ['a misspelt member', () => ui.table(ui.state([])).colums('a')],
  ['a member ui does not have', () => ui.histogram([])],
  ['a Selection handle', () => ui.table(p.fn('score').stmts())],
  ['a Promise as data', () => ui.chart(Promise.resolve([]))],
  [
    'a side effect in a query',
    () => ui.query(({ p }) => p.apply('fold')).value,
  ],
  ['a slider on a plain cell', () => ui.slider(ui.state(3))],
  [
    'a placement that does not exist',
    () => ui.tile('t').place({ splitRigth: 'ir' }),
  ],
  ['an object inside a row', () => ui.row({ bytes: 12 })],
  ['setting a computed cell', () => ui.query(({ p }) => p.rev).set('r9')],
  [
    'a cycle between cells',
    () => {
      let b = null;
      const a = ui.query(() => b.value + 1, 'a');
      b = a.map(x => x + 1).as('b');
      return a.value;
    },
  ],
  [
    'a wrong prop on a component',
    () => {
      ui.component('pill')
        .props({ text: 'string' })
        .render((d, h, { text }) => h('span', {}, text))
        .register();
      return ui.pill({ txt: 'hi' });
    },
  ],
  ['a fragment that does not exist', () => ui.use('sparkle')],
];
const rows = cases.map(([what, fn]) => {
  const code = String(fn)
    .replace(/^\(\) => (\{ )?/, '')
    .replace(/ \}$/, '');
  try {
    fn();
    return { what, code, error: 'no error', fix: '' };
  } catch (e) {
    const fix = e.fix || '';
    return {
      what,
      code,
      error: e.message.split('\n')[0],
      fix: fix.length > 160 ? fix.slice(0, 157) + '…' : fix,
    };
  }
});

return ui.tile('diagnostics')
  .title(`Diagnostics · ${rows.length}`)
  .place({ tabWith: 'gallery' })
  .body(
    ui.col(
      ui.text(
        'Each line ran when this script did; the error is what the DSL ' +
          'threw. Every one names the problem and how to fix it.',
      ),
      ui.list(rows).item(r =>
        ui.col(
          ui.row(ui.badge(r.what, 'accent'), ui.code(r.code, 'js')),
          ui.text(`\`${r.error}\``),
          r.fix ? ui.text(`fix: ${r.fix}`) : null,
        ),
      ),
    ),
  );
