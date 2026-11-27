import fs from 'node:fs';
const root = process.argv[2];
const T = await import(root + '/dist/tensor/index.js');
const P = await import(root + '/dist/tensor/passes.js');
for (const name of fs.readdirSync(root + '/corpus/tensor').sort()) {
  const t0 = Date.now();
  const prog = T.compileTix(fs.readFileSync(`${root}/corpus/tensor/${name}/main.tix`, 'utf8'));
  const row = [name];
  for (const [label, entry] of [['inline', P.PASSES.inline], ['split', P.PASSES['split-sum']], ['wInline', P.WRONG_PASSES.inline], ['wSplit', P.WRONG_PASSES.splitSum]])
    for (const rel of ['exact', 'tolerance']) {
      const { step } = P.applyChecked(prog, entry, rel);
      row.push(`${label}/${rel[0]}:${step.changed ? (step.accepted ? 'ok' : 'REJ') : step.accepted ? '-' : 'REJ'}`);
      if (process.argv[3] && !step.accepted) console.log('   ', step.reason);
    }
  console.log(row.join(' '), Date.now() - t0, 'ms');
}
