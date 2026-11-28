import { readFileSync } from 'node:fs';

function stats(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  const median = (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  return { median, range: `${sorted[0].toFixed(2)}–${sorted.at(-1).toFixed(2)}` };
}

console.log(
  '| Program | Functions | Statements | Values | Edits | Today ms/edit, median (range) | Runtime ms/edit, median (range) | Runtime / today |',
);
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const file of ['01-e1-output.jsonl', '02-e1-controlled-chess.jsonl']) {
  const rows = readFileSync(new URL(`../various/${file}`, import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse);
  for (let i = 0; i < rows.length; ) {
    const { id, functions, statements, values } = rows[i++];
    const edits = [];
    while (i < rows.length && !rows[i].id) edits.push(rows[i++]);
    if (edits.length === 0) throw new Error(`No measured edits for ${id} (${functions} functions)`);
    const today = stats(edits.map(row => row.todayMs));
    const runtime = stats(edits.map(row => row.runtimeMs));
    console.log(
      `| ${id} | ${functions} | ${statements} | ${values} | ${edits.length} | ${today.median.toFixed(2)} (${today.range}) | ${runtime.median.toFixed(2)} (${runtime.range}) | ${(runtime.median / today.median).toFixed(3)} |`,
    );
  }
}
