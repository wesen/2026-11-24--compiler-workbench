// Marks on the built-in views: a badge on each bounds check in the IR, and
// a gutter mark on each source line that has one (✓ bce removes it, ! it
// stays). No tile: annotations only.
const checks = ui.from('checks');
const byId = checks.map(rows => new Map(rows.map(r => [r.check, r])));
const byLine = checks.map(rows => {
  const m = new Map();
  for (const r of rows) m.set(r.line, (m.get(r.line) || []).concat([r]));
  return m;
});
ui.annotate('ir').stmt(s => {
  const r = byId.value.get(s.id);
  return (
    r &&
    ui.badge(
      r.bce === 'removes' ? 'bce removes' : 'check stays',
      r.bce === 'removes' ? 'good' : 'warn',
    )
  );
});
ui.annotate('source').gutter(line => {
  const rs = byLine.value.get(line);
  return (
    rs &&
    ui.badge(
      rs.map(r => (r.bce === 'removes' ? '✓' : '!')).join(''),
      rs.every(r => r.bce === 'removes') ? 'good' : 'warn',
    )
  );
});
return [];
