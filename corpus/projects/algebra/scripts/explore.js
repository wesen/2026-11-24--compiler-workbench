// Algebraic identities: the walk-through. Run it on r0 (Scripts view) to
// see it from the start.
const r = p.apply('simplify');
log(p.edits(r.rev).map(e => e.stmt + ': ' + e.text));
p.pipeline('O1');
return p.listing();
