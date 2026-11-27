// Probe: can the framework's IR correspondence express many Tix statements becoming one kernel?
//
// Builds two tiny artifacts: a "statements" universe (three statements) and a "kernels" universe (one kernel), then
// calls makeCorrespondence with one grouped entry [m,e,s] -> [k0]. If that is accepted, the IR layer can express
// many-to-one. Then asks the same question of the CUDA-source artifact kind, which is what the lowering's output
// port actually holds.
//
// Run from the worktree root after `npm run build`:  node <ticket>/scripts/01-correspondence-probe.mjs
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(process.cwd() + '/');
const { defineIR, createArtifact } = await import(new URL('dist/framework/contracts/index.js', root));
const { makeCorrespondence, defineAdapter, createIRArtifact, openIR } = await import(
  new URL('dist/framework/ir/index.js', root)
);

const list = {
  id: 'probe.list',
  version: '1',
  description: 'a list of named entities',
  validate(v) {
    if (!Array.isArray(v?.names)) throw Error('bad list');
  },
};
const ListIR = defineIR(list);
const adapterFor = kind =>
  defineAdapter({
    id: 'probe.' + kind + '.adapter',
    version: '1',
    description: 'entities are names',
    kind: ListIR.id,
    schemaVersion: ListIR.version,
    validate: list.validate,
    relationKinds: { contains: 'containment' },
    entities: v => v.names.map(n => ({ id: n, kind, attributes: {} })),
    relations: () => [],
    resolve: (v, id) => (v.names.includes(id) ? { id, kind, attributes: {} } : undefined),
    describe: (_, id) => ({ label: id }),
  });

const statements = createIRArtifact(adapterFor('statement'), 'probe/tix', { names: ['m', 'e', 's'] });
const kernels = createIRArtifact(adapterFor('kernel'), 'probe/cuda', { names: ['k0'] });
const view = openIR(statements, adapterFor('statement'));
console.log('source entities:', view.graph().entities.map(e => e.id).join(' '));

const grouped = makeCorrespondence(
  { artifact: statements.id, revision: statements.revision },
  { artifact: kernels.id, revision: kernels.revision },
  ['m', 'e', 's'],
  ['k0'],
  [{ from: ['m', 'e', 's'], to: ['k0'], relation: 'fused-into' }],
);
console.log('grouped many-to-one entries:', JSON.stringify(grouped.entries));

// The lowering's output port is a translation unit with no entities of its own (src/tensor/cuda-contract.ts).
const cuda = defineIR({
  id: 'probe.cuda-source',
  version: '1',
  description: 'a translation unit',
  validate(v) {
    if (typeof v?.source !== 'string') throw Error('bad source');
  },
});
const unit = createArtifact(cuda, 'probe/cuda-source', { fn: 'f', source: '__global__ void k0(){}' });
console.log('createArtifact (as src/tensor/cuda-contract.ts does) succeeded:', !!unit.revision);
console.log('CUDA artifact keys:', Object.keys(unit).join(' '));
console.log('CUDA artifact carries an adapter:', 'adapter' in unit);
console.log('kernels named by the CUDA artifact: none (its value is {fn, source}; the IR kind declares no entities)');
