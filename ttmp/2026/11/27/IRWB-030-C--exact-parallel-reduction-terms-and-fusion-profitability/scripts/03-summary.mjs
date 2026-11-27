import { readFileSync } from 'node:fs';
const directory = new URL('.', import.meta.url);
const rows = ['a', 'b', 'c'].flatMap(letter => readFileSync(new URL(`01-results-${letter}.jsonl`, directory), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
for (const name of [...new Set(rows.map(row => row.name))]) {
  const group = rows.filter(row => row.name === name);
  const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({ name, calls: group.length, kernels: [group[0].fused.kernels, group[0].unfused.kernels], ms: [median(group.map(r => r.fused.gpuMs)), median(group.map(r => r.unfused.gpuMs))], equal: group.every(r => r.equal) }));
}
