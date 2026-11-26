// Audit of the class equivalent-spec ("agrees on every specified case tried, differs on an unconstrained one"): for
// a mutant whose affected functions have no input specification at all, the specified and the unconstrained
// distributions are the same, so an unconstrained witness is a specified one and the mutant is wrong. Lists every
// equivalent-spec mutant of a corpus run with the specifications of its function and of the functions it affects.
//   node ttmp/2026/11/25/IRWB-005--*/scripts/23-equivalent-spec-audit.mjs <run.jsonl>
import { readFileSync } from 'node:fs';
const root = new URL('../../../../../../', import.meta.url).pathname;
const { projectFiles } = await import(root + 'tools/corpus.mjs');
const rs = readFileSync(process.argv[2], 'utf8').trim().split('\n').map(JSON.parse);
const eq = rs.filter(r => r.classification?.class === 'equivalent-spec');
let unspecified = 0;
for (const r of eq) {
  const inputs = JSON.parse(projectFiles(r.subject)['project.json']).inputs ?? {};
  const spec = inputs[r.fn] ?? {};
  const none = Object.keys(spec).length === 0;
  if (none) unspecified++;
  console.log(`${none ? 'UNSPECIFIED ' : ''}${r.subject}.${r.fn} ${r.operator} ${r.variant} ${JSON.stringify(r.text).slice(0, 50)} affected=${r.classification.affected} spec=${JSON.stringify(spec).slice(0, 70)}`);
}
console.log(`equivalent-spec: ${eq.length}; with an unspecified mutated function: ${unspecified}`);
