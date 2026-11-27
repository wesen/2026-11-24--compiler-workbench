// Format measured rows and identify the 44 projects present when chapter 13 was written.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = new URL('../../../../../../', import.meta.url);
const rows = JSON.parse(readFileSync(new URL('02-measurements.json', import.meta.url), 'utf8'));
const book = execFileSync('git', ['ls-tree', '-d', '--name-only', 'ea1d742', 'corpus/projects/'], { cwd: root, encoding: 'utf8' }).trim().split('\n').map(p => p.split('/').at(-1));
const sums = book.reduce((a, id) => {
  const r = rows[id];
  for (const k of ['fns', 'decided', 'inconclusive']) a.ref[k] += r.ref[k];
  for (const k of ['fns', 'total', 'agree', 'inconclusive']) a.parity[k] += r.parity[k];
  a.bytes[0] += r.bytes[0]; a.bytes[1] += r.bytes[1];
  return a;
}, { ref: { fns: 0, decided: 0, inconclusive: 0 }, parity: { fns: 0, total: 0, agree: 0, inconclusive: 0 }, bytes: [0, 0] });
console.log(JSON.stringify({ projects: book.length, ...sums }));
const lines = Object.entries(rows).map(([id, row]) => `  ${JSON.stringify(id)}: ${JSON.stringify(row)},`).join('\n');
const out = `// Per-project compiler and coverage baselines, measured by IRWB-028 scripts/02-measure.mjs.\nimport assert from 'node:assert/strict';\n\nconst rows = {\n${lines}\n};\n\n// Projects in the revision where chapter 13's 44-project figures were published.\nexport const bookProjects = ${JSON.stringify(book)};\n\nexport const expectedProjects = Object.keys(rows);\n\nexport function expectation(id) {\n  assert.ok(Object.hasOwn(rows, id), \`No corpus expectation for project "\${id}"; add its row to tests/typed/corpus-expectations.mjs\`);\n  return rows[id];\n}\n`;
writeFileSync(new URL('tests/typed/corpus-expectations.mjs', root), out);
