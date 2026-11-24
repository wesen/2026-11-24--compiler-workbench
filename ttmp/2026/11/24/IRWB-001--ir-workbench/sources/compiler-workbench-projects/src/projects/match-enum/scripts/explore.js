// Enums and match: the walk-through. Run it on r0 (Scripts view) to see it
// from the start. which front-end ops did line 6 produce, and what became
// of them?
for (const line of [6, 7, 8])
  log(
    line +
      ': ' +
      p.fn('area')
        .ops()
        .line(line)
        .map(
          o => o.op + (o.operands.length ? ' ' + o.operands.join(',') : ''),
        )
        .join(' · '),
  );
return wb.focus(p.fn('area').ops().line(7).first().id);
