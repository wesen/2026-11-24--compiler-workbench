// A chain of calls: the walk-through. Run it on r0 (Scripts view) to see it
// from the start.
const img = p.compile();
return p.fns().map(fn => ({
  fn,
  leaf: img.fns[fn].leaf,
  frame: img.fns[fn].frame,
  saved: img.fns[fn].saved,
  bytes: img.fns[fn].bytes,
}));
