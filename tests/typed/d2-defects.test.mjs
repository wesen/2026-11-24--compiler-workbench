// IRWB-039 phase 1a: three defects IRWB-037-G (D2) found and left unchanged, as tests of the CORRECT behaviour
// (BACKLOG F36-F38; IRWB-037-G scripts/13 and 14). F36 and F38 are fixed (IRWB-042-C); F37 is still a todo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVendor } from '../../tools/node-vendor.mjs';
import { projectFiles } from '../../tools/corpus.mjs';

await installVendor();
const { Program } = await import('../../dist/typed/program.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { PIPELINES } = await import('../../dist/typed/passes.js');

test('F36: bce keeps a bounds check when the index is reassigned between the guard and the check', async () => {
  // the only assignment to i lies between `i < buf.length` and `buf.charCodeAt(i)`, and reaches both: the sets of
  // reaching definitions are equal, the values are not
  const source = `
function walk(buf: buffer, c: bool): i32 {
    let i = 0;
    let s = 0;
    while (i < buf.length) {
        if (c) {
            i = i + 1;
        }
        s = s + buf.charCodeAt(i);
        if (s > 1000) {
            break;
        }
    }
    return s;
}`;
  const p = Program.fromProject(
    projectSource('bce-probe', {
      'main.typed': source,
      'project.json': JSON.stringify({
        inputs: { walk: { buf: { buffer: [1, 4], cell: [400, 600] }, c: { bool: true } } },
      }),
    }),
  );
  assert.equal(p.status, 'ok');
  await p.apply('cfg');
  await p.apply('simplify');
  // before the fix bce removed the check and only the meaning check rejected the pass (16 of 40 cases disagree)
  await assert.doesNotReject(p.apply('bce'), 'bce produced a candidate the meaning check rejects');
});

test(
  'F37: typed.ranges keeps an outer loop counter non-negative under an inner loop',
  { todo: 'F37' },
  async () => {
    const p = Program.fromProject(projectSource('chess-search', projectFiles('chess-search')));
    for (const pass of PIPELINES.speed.slice(0, PIPELINES.speed.indexOf('strength')))
      await p.apply(pass, { count: 3 });
    const f = storeOf(p.head.value).fn('chessPseudoMoves');
    const dense = String(f.locals.findIndex(l => l.name === 'dense'));
    const ranges = (await p.fact('ranges', 'chessPseudoMoves')).value;
    // dense counts 0..63; today its interval at the block of `dense / 8` is [-2^31, 63]
    const [lo] = ranges.in['bb:chessPseudoMoves.3'][dense];
    assert.ok(lo >= 0, `dense's lower bound is ${lo}`);
  },
);

test('F38: lvn can run a second time (speed with lvn again before rotate, on regex-nfa)', async () => {
  const p = Program.fromProject(projectSource('regex-nfa', projectFiles('regex-nfa')));
  const speed = [...PIPELINES.speed];
  speed.splice(speed.indexOf('rotate'), 0, 'lvn');
  const r = await p.pipeline(speed, { count: 3 });
  assert.deepEqual(
    r.steps.filter(s => s.rejected).map(s => s.pass),
    [],
  );
});
