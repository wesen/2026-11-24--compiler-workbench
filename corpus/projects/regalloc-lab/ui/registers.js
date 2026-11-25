// The allocator's options as controls, and what they do to one function:
// stats, intervals, code.
const fns = ui.query(({ p }) => p.fns(), 'fns');
const fn = ui.param.choice('function', fns, { default: 'mixer' });
const registers = ui.param.int('registers', {
  min: 1,
  max: 24,
  default: 24,
  about: 'how many the allocator may use',
});
const order = ui.param.choice('order', ['caller', 'callee'], {
  default: 'caller',
});
const spill = ui.param.choice('spill', ['furthest', 'current'], {
  default: 'furthest',
});
const hints = ui.param.bool('hints', { default: true });
const options = ui.derive({ registers, order, spill, hints }, o => o);
const machine = ui.query(
  ({ p }) => p.machine(fn.value, options.value),
  'machine',
); // reads the program, fn and options

return ui.tile('registers')
  .title(
    ui.derive(
      { fn, registers },
      ({ fn, registers }) => `Registers · ${fn} · ${registers}`,
    ),
  )
  .place({ splitRight: 'source', size: 0.5 })
  .body(
    ui.col(
      ui.row(
        ui.select(fn),
        ui.slider(registers),
        ui.select(order),
        ui.select(spill),
        ui.toggle(hints),
      ),
      ui.row(
        ui.stat('intervals', machine.map(m => m.intervals.length)),
        ui.stat(
          'spilled',
          machine.map(m => m.spilled.length),
        ).badIf(n => n > 0),
        ui.stat(
          'across calls',
          machine.map(m => m.intervals.filter(i => i.crossesCall).length),
        ),
        ui.badge(machine.map(m => (m.leaf ? 'leaf' : 'calls out'))),
      ),
      ui.intervals({ fn, options }),
      ui.tabs({
        selected: ui.code(machine.map(m => m.selected.join('\n'))),
        spilled: ui.list(machine.map(m => m.spilled)).empty(
          'Nothing spilled.',
        ),
      }),
    ),
  );
