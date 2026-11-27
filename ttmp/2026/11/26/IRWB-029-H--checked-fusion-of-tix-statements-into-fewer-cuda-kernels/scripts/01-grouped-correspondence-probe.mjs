// Probe 01: can a v6 correspondence express several Tix statements becoming one kernel?
//
// The fused lowering folds a group of statements into one kernel. To record that, the framework would need a
// many-to-one correspondence. `makeCorrespondence` takes (from, to, sourceEntities, targetEntities, entries) and
// `validateCorrespondence` requires every declared entity on both sides to be accounted for, so the question is
// whether a grouped entry works at all, and what the target side has to be.
//
// Run from the worktree root after `npm run build`:
//   node ttmp/2026/11/26/IRWB-029-H--*/scripts/01-grouped-correspondence-probe.mjs
const { makeCorrespondence, validateCorrespondence } = await import(
  new URL('dist/framework/ir/correspondence.js', `file://${process.cwd()}/`)
);

const from = { artifact: 'tix', revision: 'r1' };
const to = { artifact: 'tix-cuda/softmax', revision: 'r2' };
const report = {};

// 1. A grouped entry, many statements to one kernel, with both universes declared.
const grouped = makeCorrespondence(from, to, ['m', 's'], ['k0'], [
  { from: ['m', 's'], to: ['k0'], relation: 'becomes-one-kernel' },
]);
report.grouped = {
  accepted: true,
  entries: grouped.entries,
  validated: validateCorrespondence(grouped).entries.length,
};

// 2. The same with a declared but unaccounted target entity (a second kernel the source does not name).
try {
  validateCorrespondence(
    makeCorrespondence(from, to, ['m', 's'], ['k0', 'k1'], [
      { from: ['m', 's'], to: ['k0'], relation: 'becomes-one-kernel' },
    ]),
  );
  report.unaccountedTarget = 'accepted (unexpected)';
} catch (error) {
  report.unaccountedTarget = error.message;
}

// 3. A target with no entities at all, naming a kernel: rejected, because the target entity is unknown. This is
//    the CUDA artifact's situation: its payload is {fn, source} and it declares no entity universe.
try {
  const empty = makeCorrespondence(from, to, ['m', 's'], [], [
    { from: ['m', 's'], to: ['k0'], relation: 'becomes-one-kernel' },
  ]);
  report.noTargetUniverse = { accepted: true, entries: empty.entries };
} catch (error) {
  report.noTargetUniverse = error.message;
}

// 4. What an empty target list does record: the statements became nothing (a removal), not one kernel.
const removed = makeCorrespondence(from, to, ['m', 's'], [], [
  { from: ['m', 's'], to: [], relation: 'becomes-one-kernel' },
]);
report.removalNotGrouping = removed.entries;

console.log(JSON.stringify(report, null, 2));
