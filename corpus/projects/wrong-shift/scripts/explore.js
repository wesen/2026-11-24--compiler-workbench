// A pass that is wrong for negatives: the walk-through. Run it on r0
// (Scripts view) to see it from the start.
p.apply('div-to-shift');
const c = p.check({ count: 100 });
log(c.fns.map(f => f.fn + ' ' + f.agree + '/' + f.total));
return c.fns[0].counterexamples[0];
