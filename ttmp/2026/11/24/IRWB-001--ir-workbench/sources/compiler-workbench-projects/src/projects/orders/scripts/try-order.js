// One order of passes on a fresh copy: cfg first, dce last, the order in
// args.order between.
const order = args.order || ['fold', 'licm', 'lvn'];
p.pipeline(['cfg', ...order, 'dce'], { checkEach: false });
const img = p.compile();
const stmts = p.fns().reduce((n, f) => n + p.fn(f).stmts().count(), 0);
const steps =
  img.run('kernel', [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 12, 5])
    .steps + img.run('rescale', [77, 9]).steps;
return {
  order: order.join(' → '),
  bytes: img.bytes,
  stmts,
  steps,
  check: args.check === false ? 'skipped' : p.check({ count: 24 }).status,
};
