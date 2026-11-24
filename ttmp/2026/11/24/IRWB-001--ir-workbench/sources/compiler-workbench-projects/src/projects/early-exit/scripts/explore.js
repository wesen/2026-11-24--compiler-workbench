// While with break: the walk-through. Run it on r0 (Scripts view) to see it
// from the start.
const loops = p.fn('find').loops();
log(
  loops.map(l => ({ head: l.head, body: l.body.length, exits: l.exits })),
);
p.pipeline('O2');
return { loops: p.fn('find').loops().length, check: p.check().status };
