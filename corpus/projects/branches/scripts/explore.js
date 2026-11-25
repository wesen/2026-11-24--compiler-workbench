// Branches, jump threading, block merging: the walk-through. Run it on r0
// (Scripts view) to see it from the start.
const count = () =>
  p.fns().map(f => f + ' ' + p.fn(f).blocks().count() + ' blocks');
const before = count();
const r = p.apply('cfg');
return { before, after: count(), kinds: r.kinds };
