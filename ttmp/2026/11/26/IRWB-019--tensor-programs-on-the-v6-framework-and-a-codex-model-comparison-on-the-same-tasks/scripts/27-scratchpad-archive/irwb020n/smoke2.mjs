import fs from 'node:fs';
const W = process.argv[2];
const T = await import(W + '/dist/tensor/index.js');
const P = await import(W + '/dist/framework/passes/index.js');
const C = await import(W + '/dist/framework/contracts/index.js');
for (const name of ['matmul','softmax','layernorm','attention','mlp']) {
  const p = T.compileTix(fs.readFileSync(`${W}/corpus/tensor/${name}/main.tix`, 'utf8'));
  const e = (() => { try { P.applyPassSync(T.splitSum, p, { contract: T.exactContract, contractInputs: { origin: p } }); } catch (e) { return e.evidence.checks[0].evidence; } })();
  const ok = P.applyPassSync(T.splitSum, p, { contractInputs: { origin: p } });
  const wrong = (() => { try { P.applyPassSync(T.splitSumWrong, p, { contractInputs: { origin: p } }); } catch (e) { return e.evidence.checks[0].evidence; } })();
  console.log(name, 'exact cx n:', e.counterexamples.map(c => c.case.n).join(','), '| tol inconclusive', ok.contract[0].evidence.inconclusive,
    'agree', ok.contract[0].evidence.agree, '| split err', T.maxScaledError(p, ok.artifact).toExponential(2), '| wrong:', wrong.counterexamples[0].reason.slice(-40));
  const m = new C.AnalysisManager();
  const r = await P.applyPass(T.splitSum, p, { manager: m, contractInputs: { origin: p } });
  let rej; try { await P.applyPass(T.splitSum, p, { manager: new C.AnalysisManager(), contract: T.exactContract, contractInputs: { origin: p } }); } catch (x) { rej = x.message.slice(0, 140); }
  console.log('  async:', r.artifact.revision === ok.artifact.revision, rej);
}
