#!/usr/bin/env node
// IRWB-048-B probe: SCCP over the whole corpus, and a fingerprint that can be compared against the pre-change code.
// For every corpus project it applies `sccp` alone (under the pass's meaning contract, as Program.apply does), then
// prints the constants the pass materialized — the reads it turned into constants, sorted and hashed — and checks the
// program still verifies. The fingerprint is the pass's output in the IR, so it is the same measure under the old
// private lattice and under the library's flat lattice. Run after `npm run build`:
//   node ttmp/2026/11/27/IRWB-048-B--*/scripts/03-sccp-corpus.mjs > 03-sccp-corpus.out.txt
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../../../..');
const imp = p => import(pathToFileURL(resolve(root, p)).href);
const { installVendor } = await imp('tools/node-vendor.mjs');
await installVendor();
const { projectIds, projectFiles } = await imp('tools/corpus.mjs');
const { projectSource } = await imp('dist/typed/project.js');
const { Program } = await imp('dist/typed/program.js');
const { sccp } = await imp('dist/typed/sccp.js');

const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const rows = [];
for (const id of projectIds()) {
  const p = Program.fromProject(projectSource(id, projectFiles(id)));
  const before = p.rev;
  let rejected = null;
  try {
    await p.apply(sccp);
  } catch (e) {
    if (e.code !== 'contractRejected') throw e;
    rejected = e.message.slice(0, 200);
  }
  assert.equal(rejected, null, `${id}: sccp rejected`);
  assert.equal((await p.verify()).ok, true, `${id}: the program no longer verifies`);
  // The pass's output: which constants it wrote, as a sorted multiset of (bits, type) — the same measure under the old
  // private lattice and under the library's flat lattice.
  const native = p.artifact().value;
  const made = Object.values(native.values)
    .filter(v => v.op === 'const' && v.origin?.[0]?.via === 'sccp')
    .map(v => [v.imm, v.type])
    .sort();
  rows.push({ id, revisions: p.rev - before, constants: made.length, fingerprint: sha(made) });
}
const sum = k => rows.reduce((n, r) => n + r[k], 0);
console.log(`${rows.length} projects: every sccp application accepted and every program verifies`);
console.log(`constants sccp wrote: ${sum('constants')}; projects it changed: ${rows.filter(r => r.revisions > 0).length}`);
console.log(`corpus fingerprint: ${sha(rows)}`);
for (const r of rows)
  if (r.revisions > 0) console.log(`  ${r.id}: ${r.revisions} revision(s), ${r.constants} constants, ${r.fingerprint}`);
