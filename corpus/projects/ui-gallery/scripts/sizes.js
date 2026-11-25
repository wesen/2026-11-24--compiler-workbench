// Read-only: statements and values per function at every revision so far.
return p.revisions().map(r => ({
  rev: r.rev,
  n: +r.rev.slice(1),
  pass: r.pass,
  edits: r.edits,
}));
