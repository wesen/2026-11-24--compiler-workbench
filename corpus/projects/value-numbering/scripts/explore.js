// The same expression twice: the walk-through. Run it on r0 (Scripts view)
// to see it from the start.
const before = p.compile().run('halves', [40]);
const r = p.apply('lvn');
log(p.edits(r.rev));
const after = p.compile().run('halves', [40]);
return {
  steps: [before.steps, after.steps],
  result: [before.result, after.result],
};
