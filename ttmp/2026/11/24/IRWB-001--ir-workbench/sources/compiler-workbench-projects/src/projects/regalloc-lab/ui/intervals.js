// A new component, intervals: the allocator's live intervals for one
// function, one bar each, coloured by the register it got (red: spilled).
// It is registered here and used in ui/registers.js.
ui.component('intervals')
  .props({ fn: 'string', options: 'object' })
  .data(({ p }, { fn, options }) => p.machine(fn, options))
  .render((m, h) => {
    if (!m) return h('p', { class: 'empty' }, 'No function.');
    const rows = m.intervals
      .slice()
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const end = Math.max(1, ...rows.map(r => r.end));
    const W = 460;
    const L = 70;
    const row = 15;
    const x = t => L + ((W - L - 8) * t) / end;
    return h.svg(
      {
        viewBox: `0 0 ${W} ${rows.length * row + 18}`,
        class: 'dslchart intervals',
      },
      rows.map((r, i) =>
        h(
          'g',
          {},
          h(
            'text',
            {
              x: L - 6,
              y: i * row + 11,
              class: 'tick',
              'text-anchor': 'end',
            },
            `${r.vreg} → ${r.reg}`,
          ),
          h(
            'rect',
            {
              x: x(r.start),
              y: i * row + 3,
              width: Math.max(2, x(r.end) - x(r.start)),
              height: row - 5,
              rx: 2,
              class:
                'cbar ' +
                (r.reg === 'spilled'
                  ? 'bad'
                  : r.crossesCall
                    ? 'mut'
                    : 'ink'),
            },
            h(
              'title',
              {},
              `${r.vreg}: ${r.start}–${r.end}` +
                (r.crossesCall ? ', live across a call' : '') +
                ` → ${r.reg}`,
            ),
          ),
        ),
      ),
      h(
        'text',
        { x: L, y: rows.length * row + 14, class: 'tick' },
        `0 … ${end} (positions) · red spilled · grey crosses a call`,
      ),
    );
  })
  .register();
return [];
