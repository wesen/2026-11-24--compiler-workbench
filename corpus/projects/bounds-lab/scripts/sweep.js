// On a fresh copy: the pipeline with and without bce, so the cost of the
// checks shows in bytes and steps.
const base = ['cfg', 'fold', 'simplify', 'constprop', 'dce', 'licm', 'lvn'];
const run = (q, passes) => {
  q.pipeline(passes, { checkEach: false });
  const img = q.compile();
  return {
    bytes: img.bytes,
    steps:
      img.run('total', [[5, 4, 3, 2, 1, 9, 8, 7]]).steps +
      img.run('pairs', [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ]).steps,
  };
};
const without = run(project.fresh(), base);
const withBce = run(p, base.concat(['bce', 'cfg', 'dce']));
return [
  { pipeline: 'without bce', ...without },
  { pipeline: 'with bce', ...withBce },
];
