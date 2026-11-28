// IRWB-044-C probe 03: the two checks on the R3 probe-04 program, separated. Under the default (`bothTotal`)
// the zero group fails coverage; under `partial` the same zero group passes coverage and the false group is
// refused by the structural-diff audit alone.
import { dist } from './00-root.mjs';
const C = await dist('framework/contracts/index.js');
const { applyNativePassSync, semanticCorrespondence } = await dist('framework/passes/index.js');
const { compileTix } = await dist('tensor/index.js');
const { inlinePass } = await dist('tensor/passes.js');
const { meaningGate } = await dist('tensor/contract.js');
const { TixIR } = await dist('tensor/ir.js');

const q = compileTix('fn f(x:f32[N,N]):f32[N,N] { p[i,j] = x[i,j] + 1; y[i,j] = p[j,i]; return y; }');
const inline = applyNativePassSync(inlinePass, q.current, meaningGate(q.origin, 'exact'));
const lists = { sourceEntities: TixIR.entities(q.current.value), targetEntities: TixIR.entities(inline.artifact.value) };
const src = re => lists.sourceEntities.filter(e => re.test(e)),
  dst = re => lists.targetEntities.filter(e => re.test(e));
const honest = [{ from: src(/\/(p|y)$/), to: dst(/\/y$/) }];
const falseGroup = [{ from: src(/\/y$/), to: [] }];

for (const coverage of ['bothTotal', 'partial'])
  for (const [label, entities] of [
    ['zero groups', []],
    ['honest group', honest],
    ['false group (y -> nothing)', falseGroup],
  ]) {
    const contract = C.defineTransformation({
      id: `probe.${coverage}`,
      version: '1',
      description: 'requires an entity mapping',
      inputs: { input: TixIR },
      outputs: { output: TixIR },
      correspondence: [{ id: 'entities', from: 'input', to: 'output', relation: 'generic-ir-edit', coverage }],
    });
    const record = { ...semanticCorrespondence(inline.correspondence), ...lists, entities };
    try {
      await new C.AnalysisManager().verifyTransformation(
        { input: q.current },
        { output: inline.artifact },
        contract,
        [record],
      );
      console.log(`coverage=${coverage}, ${label}: ACCEPTED`);
    } catch (e) {
      console.log(`coverage=${coverage}, ${label}: rejected - ${String(e.message).slice(0, 110)}`);
    }
  }
console.log('source universe', JSON.stringify(lists.sourceEntities), '->', JSON.stringify(lists.targetEntities));
