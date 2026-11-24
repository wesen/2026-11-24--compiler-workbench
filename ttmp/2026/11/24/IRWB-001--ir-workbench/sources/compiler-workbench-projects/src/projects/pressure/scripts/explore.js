// Register pressure: the walk-through. Run it on r0 (Scripts view) to see
// it from the start.
const regs = wb.param.int('registers', {
  min: 1,
  max: 24,
  default: 4,
  about: 'registers the allocator may use',
});
p.pipeline('O1');
const img = p.compile({ registers: regs });
return {
  registers: regs,
  spills: img.fns.mixer.spills,
  bytes: img.fns.mixer.bytes,
  frame: img.fns.mixer.frame,
  check: img.check().status,
};
