/** Run after building: node dist/labs/conformance/01-runtime.js */
import { Compiler } from '../runtime.js';
import { assert, task, type Task } from '../../framework/core/types.js';

interface Scalar {
  value: number;
}
const compiler = new Compiler();
compiler.registerKind<Scalar>({
  id: 'guide.scalar',
  version: '1',
  description: 'A finite scalar result',
  validate(value: unknown): asserts value is Scalar {
    assert(!!value && typeof value === 'object', 'Expected a scalar record');
    assert(Number.isFinite((value as Scalar).value), 'Expected a finite value');
  },
});
compiler.register<{ key: string }, Scalar>({
  id: 'guide.read',
  version: '1',
  kind: 'guide.scalar',
  description: 'Read one tracked source input',
  run(context, { key }) {
    return { value: context.read<number>(key) };
  },
});
compiler.register<{ left: Task; right: Task }, Scalar>({
  id: 'guide.add',
  version: '1',
  kind: 'guide.scalar',
  description: 'Add the results of two requested tasks',
  async run(context, { left, right }) {
    const [a, b] = await Promise.all([context.require<Scalar>(left), context.require<Scalar>(right)]);
    context.decision({
      code: 'guide.sum',
      message: 'Add the two exact input revisions',
      evidence: { left: a.revision, right: b.revision },
    });
    return { value: a.value.value + b.value.value };
  },
});

const left = task('guide/left', 'guide.read', { key: 'guide.left' });
const right = task('guide/right', 'guide.read', { key: 'guide.right' });
const sum = task('guide/sum', 'guide.add', { left, right });
compiler.setInputs({ 'guide.left': 3, 'guide.right': 4 });
const cold = await compiler.run('Cold sum', run => run.require<Scalar>(sum));
const warm = await compiler.run('Warm sum', run => run.require<Scalar>(sum));
compiler.setInput('guide.left', 10);
const changed = await compiler.run('Changed left input', run => run.require<Scalar>(sum));
assert(cold.value.value.value === 7, 'Cold result');
assert(warm.value.revision === cold.value.revision, 'Warm revision reuse');
assert(changed.value.value.value === 14, 'Changed result');
const rows = changed.run.query.invocations();
assert(
  rows.find(row => row.taskId === right.id)?.status === 'cached',
  'The unchanged right input should remain cached',
);
console.log(
  JSON.stringify(
    {
      cold: cold.value.value.value,
      warm: warm.value.value.value,
      changed: changed.value.value.value,
      warmCache: warm.run.explainCache(sum.id),
      changedCache: changed.run.explainCache(sum.id),
      comparison: changed.run.compare(warm.run),
    },
    null,
    2,
  ),
);
