// A fresh copy with the open program's passes replayed, then compiled with
// the options in args. Runs on a copy, so sweeping the options never adds
// images to the program you are looking at.
const opts = args.options || {};
const passes = (args.passes || []).filter(x => x !== 'ingest');
for (const name of passes) p.apply(name);
const img = p.compile(opts);
const fns = p.fns().map(fn => ({
  fn,
  bytes: img.fns[fn].bytes,
  spills: img.fns[fn].spills,
  frame: img.fns[fn].frame,
  saved: img.fns[fn].saved.length,
}));
return {
  rev: p.rev,
  bytes: img.bytes,
  fns,
  steps:
    img.run('mixer', [3, 5, 7, 11]).steps +
    img.run('accum', [[9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6], 16])
      .steps,
};
