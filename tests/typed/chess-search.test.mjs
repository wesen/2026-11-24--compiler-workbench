import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAllFiles } from '../../tools/corpus.mjs';
import {
  id, loadProject, buildImages, checkGenerated, checkMoveFixtures, checkSearchFixture,
  depthOneFixtures, fixture,
} from '../../corpus/projects/chess-search/scripts/fixtures.mjs';

const context = await loadProject();
let images;
test.before(async () => {
  images = await buildImages(context);
});

test('chess-search generated entries agree through speed and all RV32 images', () => {
  checkGenerated(context, images);
});

test('chess-search legal moves, check status, and perft match the reference positions', () => {
  checkMoveFixtures(context, images);
});

test('chess-search finds mates, handles terminal positions, and avoids the poisoned pawn', () => {
  for (const position of depthOneFixtures) checkSearchFixture(context, images, position, 1);
  checkSearchFixture(context, images, fixture('quiet-mate-in-two'), 3);
});

test('chess-search workbench and fresh inspector check the configured roots', async () => {
  const { createWb } = await import('../../dist/workbench/index.js');
  const wb = createWb({ projects: [{ id, files: projectAllFiles(id) }] });
  const project = wb.projects.open(id);
  const checkRows = (rows, count) => {
    assert.deepEqual(rows.map(row => row.fn), ['chessSearch', 'chessPerft']);
    for (const row of rows) {
      assert.equal(row.agree, count, row.fn);
      assert.equal(row.total, count, row.fn);
      assert.equal(row.bothTrap, 0, row.fn);
      assert.equal(row.inconclusive, 0, row.fn);
    }
  };
  assert.deepEqual(wb.current.locate(project.meta.focus), { file: 'main.typed', line: 5 });
  checkRows(wb.current.check({ count: 1 }).fns, 1);
  const inspection = await project.run('explore');
  assert.equal(wb.current.rev, 'r0');
  assert.equal(inspection.searchStep, 'fn:chessSearchStep');
  assert.ok(inspection.attackRays.length > 0);
  assert.deepEqual(inspection.rejectedPasses, []);
  assert.ok(inspection.changedPasses.length > 0);
  for (const { pass, check } of inspection.changedPasses) assert.equal(check, '80/80', pass);
  checkRows(inspection.entries, 20);
});
