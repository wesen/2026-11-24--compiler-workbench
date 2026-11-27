// Verify a copied project first reports its missing row, then passes all affected full-corpus checks with one row.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = 'corpus/projects/irwb-028-copy';
const table = 'tests/typed/corpus-expectations.mjs';
const original = readFileSync(table, 'utf8');
const run = args => spawnSync(process.execPath, ['--test', ...args], { encoding: 'utf8', maxBuffer: 10_000_000 });
try {
  cpSync('corpus/projects/blend', dir, { recursive: true, errorOnExist: true });
  const missing = run(['--test-name-pattern=SSA def-use agrees', 'tests/typed/ssa.test.mjs']);
  assert.notEqual(missing.status, 0, missing.stdout + missing.stderr);
  assert.match(missing.stdout + missing.stderr, /No corpus expectation for project "irwb-028-copy"; add its row/);
  console.log('Missing-row diagnostic verified.');
  const row = original.match(/^  "blend": .+,$/m)?.[0];
  assert.ok(row);
  writeFileSync(table, original.replace(row, `${row}\n${row.replace('"blend"', '"irwb-028-copy"')}`));
  const result = run(['--test-name-pattern=every function of every corpus|evaluator at r0 agrees|SSA def-use agrees|corpus lifted from the tape|corpus parity|book.s table against', 'tests/typed/backend.test.mjs', 'tests/typed/ssa.test.mjs', 'tests/typed/tape.test.mjs', 'tests/typed/passes.test.mjs']);
  console.log(result.stdout, result.stderr);
  assert.equal(result.status, 0, 'affected checks must pass with one additional row');
} finally {
  writeFileSync(table, original);
  rmSync(dir, { recursive: true, force: true });
}
