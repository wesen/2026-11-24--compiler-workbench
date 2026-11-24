// Collatz steps: the walk-through. Run it on r0 (Scripts view) to see it
// from the start.
p.pipeline('O2');
const img = p.compile();
const rows = [7, 27, 97, 871].map(n => ({
  n,
  steps: img.run('collatz', [n]).result,
  instructions: img.run('collatz', [n]).steps,
}));
return rows;
