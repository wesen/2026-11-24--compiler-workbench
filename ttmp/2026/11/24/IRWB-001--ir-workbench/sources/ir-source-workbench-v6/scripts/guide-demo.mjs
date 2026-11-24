/** Execute the guide's actual TypeScript tutorials after the normal build. */
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const tutorials = ['01-runtime', '02-ir-manipulation', '03-strategy-contracts', '04-domain-tour', '05-custom-adapter'];
await mkdir('output', { recursive: true });
const results = [];
for (const id of tutorials) {
  const run = spawnSync(process.execPath, [`dist/guide/${id}.js`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw new Error(`Guide tutorial ${id} failed: ${run.error?.message ?? run.stderr}`);
  const evidence = JSON.parse(run.stdout);
  await writeFile(`output/v6-guide-${id}.json`, JSON.stringify(evidence, null, 2) + '\n');
  results.push({ id, source: `src/guide/${id}.ts`, status: 'passed', evidence });
}
await writeFile('output/v6-guide-verification.json', JSON.stringify({ formatVersion: 1, tutorials: results }, null, 2) + '\n');
console.log(JSON.stringify({ tutorials: results.map(({ id, status }) => ({ id, status })) }, null, 2));
