import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkLowering, compileTix, cudaSource, runTix, runTixCuda } from '../../dist/tensor/index.js';

const buf = (shape, data) => ({ shape, data: Float32Array.from(data) });
const words = ({ data }) => new Uint32Array(data.buffer, data.byteOffset, data.length);
const same = (a, b) =>
  a.shape.join() === b.shape.join() &&
  words(a).length === words(b).length &&
  words(a).every((w, i) => w === words(b)[i]);

test('GB10: the fused and stage-2 lowerings agree bit for bit on every corpus function', async () => {
  for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
    const source = await readFile(
      new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url),
      'utf8',
    );
    const program = compileTix(source);
    const fn = program.current.value.functions[0];
    let state = name.length * 104729 + 5;
    const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    const symbols = {
      matmul: { M: 17, K: 13, N: 11 },
      softmax: { N: 9, C: 37 },
      layernorm: { N: 9, D: 37 },
      attention: { Q: 8, K: 13, D: 12, V: 6 },
      mlp: { N: 5, D: 8, H: 13, O: 7 },
      conv2d: { N: 2, C: 3, H: 9, W: 8, O: 4 },
    }[name];
    const inputs = {};
    for (const p of fn.params) {
      const shape = p.shape.map(a => a.constant + a.terms.reduce((n, [k, c]) => n + c * symbols[k], 0));
      inputs[p.name] = {
        shape,
        data: Float32Array.from({ length: shape.reduce((a, b) => a * b, 1) }, random),
      };
    }
    const reference = runTix(program, name, inputs);
    const unfused = await runTixCuda(program, name, inputs, { fuse: false });
    const fused = await runTixCuda(program, name, inputs, { fuse: true });
    assert.ok(same(reference, unfused), name + ' stage 2');
    assert.ok(same(reference, fused), name + ' fused');
  }
});

test('GB10: fused row kernels handle empty rows, empty outputs and a returned row scalar', async () => {
  const softmax = compileTix(
    await readFile(new URL('../../corpus/tensor/softmax/main.tix', import.meta.url), 'utf8'),
  );
  for (const shape of [
    [0, 5],
    [3, 0],
    [2, 5],
  ]) {
    const inputs = {
      x: buf(
        shape,
        new Array(shape[0] * shape[1]).fill(0).map((_, i) => (i % 3) - 1),
      ),
    };
    const reference = runTix(softmax, 'softmax', inputs);
    const fused = await runTixCuda(softmax, 'softmax', inputs);
    assert.ok(same(reference, fused), 'softmax ' + shape);
  }
  const rowOnly = compileTix(
    'fn f(x:f32[N,C]):f32[N] { m[i] = max(j) x[i,j]; s[i] = sum(j) x[i,j] - m[i]; return s; }',
  );
  for (const shape of [
    [0, 4],
    [3, 0],
    [4, 6],
  ]) {
    const inputs = {
      x: buf(
        shape,
        new Array(shape[0] * shape[1]).fill(0).map((_, i) => (i % 5) / 4),
      ),
    };
    const reference = runTix(rowOnly, 'f', inputs);
    const fused = await runTixCuda(rowOnly, 'f', inputs);
    assert.ok(same(reference, fused), 'rowOnly ' + shape);
  }
});

test('GB10: the stage-2 lowering still checks as exact when fusion is off', async () => {
  const softmax = compileTix(
    await readFile(new URL('../../corpus/tensor/softmax/main.tix', import.meta.url), 'utf8'),
  );
  const verdict = await checkLowering(softmax, 'softmax', { fuse: false });
  assert.equal(verdict.accepted, true, verdict.reason);
  assert.equal(verdict.relation, 'exact');
});

test('GB10: random programs fused match the f32 meaning bit for bit', async () => {
  // A generator over small valid programs: elementwise chains, row reductions, contractions and
  // epilogues, all with identity or row-local loads, so every fusion the planner accepts must be exact.
  const ops = ['+', '-', '*'];
  let seed = 20261126;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = xs => xs[Math.floor(random() * xs.length)];
  for (let p = 0; p < 12; p++) {
    const statements = [];
    let last = 'x',
      lastRow = false;
    const count = 2 + Math.floor(random() * 3);
    for (let k = 0; k < count; k++) {
      const name = 't' + k;
      if (!lastRow && random() < 0.4) {
        statements.push(`${name}[i] = ${pick(['sum', 'max'])}(j) ${last}[i,j];`);
        lastRow = true;
      } else if (!lastRow && random() < 0.35) {
        statements.push(`${name}[i,j] = sum(k) ${last}[i,k] * w[k,j];`);
      } else if (lastRow) {
        // keep a plain witness for j so the result's extent is inferable
        statements.push(`${name}[i,j] = ${last}[i] ${pick(ops)} ${pick(['x[i,j]', 'w[0,j]'])};`);
        lastRow = false;
      } else {
        statements.push(
          `${name}[i,j] = ${last}[i,j] ${pick(ops)} ${pick(['x[i,j]', 'w[0,j]', '0.5', 'w[j,j]'])};`,
        );
      }
      last = name;
    }
    const source = `fn f(x:f32[N,C], w:f32[C,C]):f32[${lastRow ? 'N' : 'N,C'}] {\n  ${statements.join('\n  ')}\n  return ${last};\n}`;
    const program = compileTix(source);
    const N = 3 + Math.floor(random() * 4),
      C = 2 + Math.floor(random() * 5);
    const inputs = {
      x: buf(
        [N, C],
        Array.from({ length: N * C }, (_, i) => (i % 4 ? 2 * random() - 1 : 0)),
      ),
      w: buf(
        [C, C],
        Array.from({ length: C * C }, () => random()),
      ),
    };
    const reference = runTix(program, 'f', inputs);
    const fused = await runTixCuda(program, 'f', inputs);
    assert.ok(
      same(reference, fused),
      source +
        '\n' +
        JSON.stringify(reference.data.slice(0, 4)) +
        ' vs ' +
        JSON.stringify(fused.data.slice(0, 4)),
    );
  }
});

test('fused sources of every corpus function keep one kernel where the plan says so', async () => {
  for (const [name, kernels] of [
    ['softmax', 1],
    ['layernorm', 1],
    ['attention', 2],
    ['mlp', 2],
  ]) {
    const source = await readFile(
      new URL('../../corpus/tensor/' + name + '/main.tix', import.meta.url),
      'utf8',
    );
    assert.equal((cudaSource(compileTix(source), name).match(/__global__ void/g) ?? []).length, kernels);
  }
});
