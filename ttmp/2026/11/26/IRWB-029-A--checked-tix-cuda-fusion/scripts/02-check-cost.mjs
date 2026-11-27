// Measure a fresh process's exact differential check, including the remote tool.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileTix, checkLowering } from '../../../../../../dist/tensor/index.js';
import { cudaCases, seed } from '../../../../../../dist/tensor/contract.js';
import { seededRandom } from '../../../../../../dist/framework/contracts/index.js';

for (const name of ['matmul', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']) {
  const p = compileTix(await readFile(`corpus/tensor/${name}/main.tix`, 'utf8'));
  const started = performance.now();
  const actual = await checkLowering(p, name);
  const wallMs = performance.now() - started;
  assert.deepEqual(actual, { accepted: true, relation: 'exact' });
  const replayStarted = performance.now();
  assert.deepEqual(await checkLowering(p, name), actual);
  const replayMs = performance.now() - replayStarted;
  const samples = cudaCases(p.current.value.functions[0], seededRandom(seed));
  console.log(JSON.stringify({ name, samples: samples.length, wallMs, replayMs }));
}
