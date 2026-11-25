// The corpus's project scripts are data run through the wb layer, unchanged, as the Scripts view runs them (with
// their project open). A sample by default; every script of every project with IRWB_FULL=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWb } from './helpers.mjs';

const SAMPLE = ['blend/explore', 'start-here/o2-report', 'match-enum/explore', 'strength/explore', 'my-first-pass/explore'];
// the one script that differs: the kernel gates every pass, so a pass that changes the meaning is refused
const EXPECTED = { 'wrong-shift/explore': 'contractRejected' };

test('project scripts run unchanged through the wb layer', { timeout: 600000 }, async () => {
  const { wb } = makeWb();
  const all = [];
  for (const x of wb.projects.list())
    for (const s of wb.projects.get(x.id).scripts()) all.push(`${x.id}/${s.name}`);
  assert.equal(all.length, 46);
  const run = process.env.IRWB_FULL ? all : [...SAMPLE, ...Object.keys(EXPECTED)];
  const failed = {};
  for (const name of run) {
    const [id, script] = name.split('/');
    wb.projects.open(id);
    try {
      await wb.projects.get(id).run(script);
    } catch (e) {
      failed[name] = e.code || e.message;
    }
  }
  assert.deepEqual(failed, EXPECTED);
});
