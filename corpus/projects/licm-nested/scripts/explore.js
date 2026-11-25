// Hoisting through two loops: the walk-through. Run it on r0 (Scripts view)
// to see it from the start.
const before = p.compile().run('table', [10, 10, 3, 4]).steps;
const runs = [];
for (let i = 0; i < 3; i++) {
  const r = p.apply('licm');
  runs.push(r.edits);
  if (!r.edits) break;
}
const after = p.compile().run('table', [10, 10, 3, 4]).steps;
return {
  licmEdits: runs,
  instructions: [before, after],
  listing: p.listing(),
};
