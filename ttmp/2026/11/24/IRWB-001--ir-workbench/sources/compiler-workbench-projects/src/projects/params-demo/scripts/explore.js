// Parameters: sliders in a script: the walk-through. Run it on r0 (Scripts
// view) to see it from the start.
const level = wb.param.choice('pipeline', ['O0', 'O1', 'O2'], {
  default: 'O2',
});
const regs = wb.param.int('registers', { min: 1, max: 24, default: 24 });
const fuse = wb.param.bool('fuse', {
  default: true,
  about: 'fuse compares into branches',
});
const n = wb.param.int('n', { min: 0, max: 40, default: 20 });
if (level !== 'O0') p.pipeline(level, { checkEach: false });
const img = p.compile({ registers: regs, fuse });
const run = img.run('blend', [
  Array.from({ length: 40 }, (_, i) => i),
  n,
  3,
  5,
]);
return {
  level,
  regs,
  fuse,
  n,
  bytes: img.bytes,
  steps: run.steps,
  result: run.result,
};
