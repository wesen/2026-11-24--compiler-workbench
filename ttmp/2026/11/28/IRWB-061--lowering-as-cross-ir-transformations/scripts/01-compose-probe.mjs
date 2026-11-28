// IRWB-061 probe 01: does tix -> schedule -> (fuse, loops) -> CUDA kernels, composed with composeCorrespondence,
// give the statement-to-kernel mapping of today's kernelCorrespondence? Run after `npm run build`:
//   node <ticket>/scripts/01-compose-probe.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../../../../..');
const imp = p => import(resolve(root, p));
const { applyTransformationSync } = await imp('dist/framework/passes/index.js');
const { makeCorrespondence, composeCorrespondence } = await imp('dist/framework/ir/index.js');
const { openIR } = await imp('dist/framework/ir/index.js');
const T = await imp('dist/tensor/index.js');
const { adapter } = await imp('dist/tensor/ir.js');
const S = await imp('dist/tensor/schedule.js');
const St = await imp('dist/tensor/strategy.js');
const { emitScheduleProgram } = await imp('dist/tensor/cuda-source.js');
const C = await imp('dist/tensor/cuda-contract.js');

const ids = (art, a) => openIR(art, a).graph().entities.map(e => e.id);
const ref = a => ({ artifact: a.id, revision: a.revision });
const pairs = entries => [...new Set(entries.flatMap(e => e.from.flatMap(f => e.to.map(t => f + ' -> ' + t))))].sort();
let rows = 0, same = 0;
for (const name of readdirSync(resolve(root, 'corpus/tensor'))) {
  const p0 = T.compileTix(readFileSync(resolve(root, 'corpus/tensor', name, 'main.tix'), 'utf8'));
  for (const [label, p] of [['r0', p0], ['inline+split', T.optimizeTix(p0, ['inline', 'split-sum']).program]])
    for (const f of p.current.value.functions)
      for (const fuse of [true, false]) {
        const s0 = S.initialSchedule(f);
        const chain = [
          makeCorrespondence(ref(p.current), ref(s0), ids(p.current, adapter), ids(s0, S.scheduleAdapter),
            s0.value.kernels.map(k => ({ from: k.group.statements.map(s => f.name + '/' + s), to: [k.name], relation: 'scheduled' }))),
        ];
        let s = s0;
        if (fuse) {
          for (const [pass, decide] of [[S.fusePass, x => St.chooseFusion(x.fn)], [S.loopsPass, St.chooseLoops]]) {
            const r = applyTransformationSync(pass, s, { params: decide(s.value) });
            if (r.changed) chain.push(r.correspondence);
            s = r.artifact;
          }
        }
        const lowered = St.lowerSchedule(f, fuse);
        if (lowered.revision !== s.revision) throw Error('schedule differs from lowerSchedule: ' + name + '/' + f.name);
        const { source, kernels } = emitScheduleProgram(s.value);
        const unit = C.cudaArtifact(f.name, source, kernels);
        chain.push(makeCorrespondence(ref(s), ref(unit), ids(s, S.scheduleAdapter), kernels.map(k => k.name),
          kernels.map(k => ({ from: [k.name], to: [k.name], relation: 'emitted' }))));
        const composed = chain.reduce((a, b) => composeCorrespondence(a, b));
        const today = C.kernelCorrespondence(p.current, unit);
        const a = pairs(composed.entries), b = pairs(today.entities);
        rows++;
        const eq = JSON.stringify(a) === JSON.stringify(b);
        if (eq) same++;
        else console.log('DIFFERS', name, label, f.name, 'fuse=' + fuse, { composed: a, today: b });
      }
}
console.log(`${same}/${rows} composed mappings equal kernelCorrespondence's`);
