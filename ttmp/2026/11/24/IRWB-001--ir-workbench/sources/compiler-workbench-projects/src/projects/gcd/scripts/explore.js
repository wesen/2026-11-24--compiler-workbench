// Euclid: the walk-through. Run it on r0 (Scripts view) to see it from the
// start.
p.pipeline('O2');
const img = p.compile();
return {
  gcd: img.run('gcd', [1071, 462]).result,
  steps: img.run('gcd', [1071, 462]).steps,
  ebreaks: img.insns().filter(i => i.text === 'ebreak').length,
};
