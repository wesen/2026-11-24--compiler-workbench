// Division by constants: the walk-through. Run it on r0 (Scripts view) to
// see it from the start.
const magic = wb.param.bool('divmagic', {
  default: true,
  about: 'divide by constants with mulh',
});
p.pipeline('O2');
const img = p.compile({ divmagic: magic });
return {
  divmagic: magic,
  bytes: img.fns.sevenths.bytes,
  steps: img.run('digitsum', [987654321]).steps,
  listing: img.listing('sevenths'),
};
