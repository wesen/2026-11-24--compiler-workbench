// Values that live across calls: the walk-through. Run it on r0 (Scripts
// view) to see it from the start.
const regs = wb.param.int('registers', {
  min: 1,
  max: 16,
  default: 16,
  about: 'registers the allocator may use',
});
const img = p.compile({ registers: regs });
return { registers: regs, keep: img.fns.keep, check: img.check().status };
