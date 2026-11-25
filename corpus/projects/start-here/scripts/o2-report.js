// O2 on a fresh copy: what each pass did, and the image before and after.
// The UI's report tile shows this script's result: ui.from('o2-report').
const level = args.level || 'O2';
const before = p.compile();
const run = p.pipeline(level, { checkEach: false });
const after = p.compile();
const sample = [[3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8], 12, 3];
return {
  level,
  passes: run.steps
    .filter(s => s.edits)
    .map(s => ({ pass: s.pass, rev: s.rev, edits: s.edits })),
  bytes: { before: before.bytes, after: after.bytes },
  steps: {
    before: before.run('smooth', sample).steps,
    after: after.run('smooth', sample).steps,
  },
  check: p.check({ count: 60 }).status,
};
