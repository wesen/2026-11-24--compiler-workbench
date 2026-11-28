// Runs the portable v6 guide tutorials (src/labs/conformance/) as conformance programs.
// Each asserts its own results and exits non-zero on any violated expectation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
for (const id of ['02-ir-manipulation', '03-strategy-contracts']) {
  test(`v6 guide tutorial ${id} runs and asserts its documented results`, () => {
    const run = spawnSync(process.execPath, [`${root}dist/labs/conformance/${id}.js`], { encoding: 'utf8', maxBuffer: 16 << 20 });
    assert.equal(run.status, 0, `${id} failed:\n${run.stdout}\n${run.stderr}`);
  });
}
