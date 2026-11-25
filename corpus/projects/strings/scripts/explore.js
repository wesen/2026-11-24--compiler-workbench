// Strings: vowels and digits: the walk-through. Run it on r0 (Scripts view)
// to see it from the start.
p.pipeline('O2');
return {
  vowels: p.exec('vowels', ['programs compile into code']).result,
  digits: p.exec('digits', ['r2d2 is 42']).result,
  blocks: p.fn('vowels').blocks().count(),
};
