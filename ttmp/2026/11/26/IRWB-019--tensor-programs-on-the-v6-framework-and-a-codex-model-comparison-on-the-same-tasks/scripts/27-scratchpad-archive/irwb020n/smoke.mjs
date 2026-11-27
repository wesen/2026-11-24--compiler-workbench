import fs from 'node:fs';
const W = process.argv[2];
const T = await import(W + '/dist/tensor/index.js');
for (const name of ['matmul','softmax','layernorm','attention','mlp','conv2d']) {
  const src = fs.readFileSync(`${W}/corpus/tensor/${name}/main.tix`, 'utf8');
  const p = T.compileTix(src);
  const t0 = Date.now();
  const r = T.optimizeTix(p, ['inline', 'split-sum']);
  const ex = (await import(W + '/dist/framework/passes/index.js')).applyPassSync;
  let exact;
  try { ex(T.splitSum, p, { contract: T.exactContract, contractInputs: { origin: p } }); exact = 'ACCEPTED'; } catch (e) { exact = e.code + ' ' + e.message.slice(0, 100); }
  let w1, w2;
  try { ex(T.inlineWrong, p, { contractInputs: { origin: p } }); w1 = 'accepted'; } catch (e) { w1 = e.code; }
  try { ex(T.splitSumWrong, p, { contractInputs: { origin: p } }); w2 = 'accepted'; } catch (e) { w2 = e.code; }
  console.log(name, JSON.stringify(r.steps), 'exact(split):', exact, '| inline-wrong:', w1, '| split-wrong:', w2,
    '| origin err', T.maxScaledError(p, p).toExponential(2), 'opt err', T.maxScaledError(p, r.program).toExponential(2), Date.now() - t0, 'ms');
}
