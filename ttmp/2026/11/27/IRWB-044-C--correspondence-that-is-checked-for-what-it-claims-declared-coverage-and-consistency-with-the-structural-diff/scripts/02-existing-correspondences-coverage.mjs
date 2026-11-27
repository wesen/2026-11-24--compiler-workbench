// IRWB-044-C probe 02: for every existing correspondence requirement in the repository, does the correspondence
// the domain produces name every source entity and every target entity? (What coverage policy can each declare?)
import { dist } from './00-root.mjs';
const { readdirSync, readFileSync } = await import('node:fs');
const { resolve } = await import('node:path');
const { at } = await import('./00-root.mjs');
const { compileTix } = await dist('tensor/index.js');
const { lowerSchedule } = await dist('tensor/strategy.js');
const { emitSchedule } = await dist('tensor/cuda-source.js');
const { kernelCorrespondence, cudaArtifact } = await dist('tensor/cuda-contract.js');
const { selectFunction } = await dist('tensor/model.js');

const dir = at('corpus/tensor');
for (const name of readdirSync(dir).sort()) {
  const program = compileTix(readFileSync(resolve(dir, name, 'main.tix'), 'utf8'));
  for (const fn of program.current.value.functions)
    for (const fuse of [true, false]) {
      const schedule = lowerSchedule(selectFunction(program.current.value, fn.name), fuse).value;
      const kernels = schedule.kernels.map(k => ({
        name: k.name,
        mapping: k.kind === 'contraction' ? 'tiled' : k.group.mapping,
        statements: k.group.statements,
        ...(k.kind === 'rows' && k.group.gated && { gated: true }),
      }));
      const subject = cudaArtifact(fn.name, emitSchedule(schedule), kernels);
      const c = kernelCorrespondence(program.current, subject);
      const src = new Set(c.sourceEntities), dst = new Set(c.targetEntities);
      const mappedSrc = new Set(c.entities.flatMap(e => e.from)), mappedDst = new Set(c.entities.flatMap(e => e.to));
      const missedSrc = [...src].filter(x => !mappedSrc.has(x)), missedDst = [...dst].filter(x => !mappedDst.has(x));
      console.log(`${name}/${fn.name} fuse=${fuse}: ${src.size} source, ${dst.size} targets | unmapped source ${JSON.stringify(missedSrc)} | unmapped target ${JSON.stringify(missedDst)}`);
    }
}
