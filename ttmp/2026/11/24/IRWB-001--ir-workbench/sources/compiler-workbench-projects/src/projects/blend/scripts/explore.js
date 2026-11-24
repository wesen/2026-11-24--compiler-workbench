// Blend: fold, hoist, check bounds: the walk-through. Run it on r0 (Scripts
// view) to see it from the start.
const before = p.compile();
const run = p.pipeline('O2');
const after = p.compile();
log(
  run.steps
    .filter(s => s.edits)
    .map(s => s.pass + ' ' + s.rev + ' ' + s.edits + ' edits'),
);
// a * b + 64 now sits in the preheader: find the statement that holds it
const hoisted = p.fn('blend')
  .stmts()
  .where(s => s.op === 'set' && s.localName.startsWith('inv'))
  .first();
log(hoisted && hoisted.why());
return {
  bytes: [before.bytes, after.bytes],
  steps: [
    before.run('blend', [[1, 2, 3, 4, 5, 6, 7, 8], 8, 3, 5]).steps,
    after.run('blend', [[1, 2, 3, 4, 5, 6, 7, 8], 8, 3, 5]).steps,
  ],
};
