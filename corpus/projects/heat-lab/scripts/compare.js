// The same input on two images of the open program: the default backend,
// and a plain one with no compare fusing, no immediates and four registers.
// Instructions executed per source line.
const input = args.input || [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const plain = p.compile({
  fuse: false,
  immediates: false,
  registers: 4,
}).heat('sort', [input]);
const tuned = p.compile().heat('sort', [input]);
const lines = p.source.split('\n');
const all = [
  ...new Set(
    [...Object.keys(plain.byLine), ...Object.keys(tuned.byLine)].map(
      Number,
    ),
  ),
].sort((a, b) => a - b);
return {
  steps: { plain: plain.steps, tuned: tuned.steps },
  rows: all.map(line => ({
    line,
    text: lines[line - 1].trim(),
    plain: plain.byLine[line] || 0,
    tuned: tuned.byLine[line] || 0,
  })),
};
