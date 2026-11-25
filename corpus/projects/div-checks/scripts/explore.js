// Division checks and what removes them: the walk-through. Run it on r0
// (Scripts view) to see it from the start.
const useRanges = wb.param.bool('useRanges', {
  default: true,
  about: 'let the backend read the ranges fact',
});
const img = p.compile({ useRanges });
return {
  useRanges,
  share: img.fns.share.bytes,
  safeShare: img.fns.safeShare.bytes,
  ebreaks: img.insns().filter(i => i.text === 'ebreak').length,
};
