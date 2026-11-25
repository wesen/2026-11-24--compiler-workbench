// Nested loops: the walk-through. Run it on r0 (Scripts view) to see it
// from the start.
log(
  p.fn('grid')
    .loops()
    .map(l => ({ head: l.head, body: l.body, assigned: l.assigned })),
);
const r = p.apply('licm');
log(p.edits(r.rev));
return p.listing();
