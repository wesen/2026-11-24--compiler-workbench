// Claims (A, B): acceptance is not atomic.
//  (B) a candidate the contract rejects stays visible as the head of a caller-supplied IRStore;
//  (A) a contract can record an accepted execution and a fact about the candidate before the enclosing pass rejects
//      the candidate (here on a false preservation claim).
// Method: the real Tix inline pass under applyPass, with a store and a contract that rejects (1), and with a contract
// that establishes a property plus a false `preserves` claim (2). Control: the manager's `deferCommit` path (3).
import { dist } from './00-root.mjs';
const C = await dist('framework/contracts/index.js');
const { applyPass, definePass } = await dist('framework/passes/index.js');
const { IRStore } = await dist('framework/ir/index.js');
const { compileTix, optimizeTix } = await dist('tensor/index.js');
const { inlinePass } = await dist('tensor/passes.js');
const { TixIR } = await dist('tensor/ir.js');

const p = compileTix('fn f(x:f32[N]):f32[N] { y[i] = x[i] * 2; z[i] = y[i] + 1; return z; }');
const candidate = optimizeTix(p, ['inline']).program.current;
const desc = 'probe';

// 1. a contract that always rejects, with a store and a fresh output id
const no = C.defineInvariant({ id: 'probe.no', version: '1', description: desc, inputs: { output: TixIR }, check: () => ({ ok: false, reason: 'probe rejects every candidate' }) });
const rejecting = C.defineTransformation({ id: 'probe.rejecting', version: '1', description: desc, inputs: { input: TixIR }, outputs: { output: TixIR },
  ensures: [{ invariant: no, bindings: { output: { from: 'outputs', port: 'output' } } }] });
const store = new IRStore();
let outcome;
try { await applyPass(inlinePass, p.current, { manager: new C.AnalysisManager(), store, outputId: 'candidate', contract: rejecting }); outcome = 'accepted'; }
catch (e) { outcome = `${e.code}: ${String(e.message).slice(0, 70)}`; }
const head = (() => { try { return store.head('candidate'); } catch (e) { return undefined; } })();
console.log('1. rejecting contract, store, fresh output id:', outcome);
console.log('   store.head("candidate") after the rejection:', head ? `revision ${head.revision.slice(0, 12)} (the rejected candidate: ${head.revision === candidate.revision})` : 'none');

// 2. contract establishes a property of the candidate; the pass then rejects on a false preservation claim
const count = C.defineAnalysis({ id: 'probe.count', version: '1', description: desc, input: TixIR, output: C.Integer, run: (_c, a) => a.value.functions[0].statements.length });
const one = C.defineAnalysis({ id: 'probe.one', version: '1', description: desc, input: TixIR, output: C.Check, run: (_c, a) => ({ ok: a.value.functions[0].statements.length === 1 }) });
const property = C.defineProperty({ id: 'probe.single-statement', version: '1', description: desc, subject: TixIR, check: one });
const establishes = C.defineTransformation({ id: 'probe.establishes', version: '1', description: desc, inputs: { input: TixIR }, outputs: { output: TixIR },
  establishes: [{ property, subject: { from: 'outputs', port: 'output' } }] });
const m = new C.AnalysisManager();
const falseClaim = definePass({ ...inlinePass, id: 'probe.false-claim', contract: establishes, preserves: [count] });
try { await applyPass(falseClaim, p.current, { manager: m, auditPreservation: true }); outcome = 'accepted'; }
catch (e) { outcome = `${e.code}`; }
const props = m.properties(candidate);
console.log('2. pass outcome:', outcome, '| manager: last execution status', m.snapshot().executions.at(-1)?.status,
  '| facts about the rejected candidate:', props.length, props.map(r => `${r.property?.id ?? r.definition?.id ?? '?'} ok=${r.ok}`).join(', '));

// 3. control: the manager's deferred commit keeps the same fact private and lets the caller roll back
const staged = new C.AnalysisManager();
const prepared = await staged.verifyTransformation({ input: p.current }, { output: candidate }, establishes, [], { deferCommit: true });
const before = staged.properties(candidate).length;
prepared.rollback('probe');
console.log('3. deferCommit: facts visible before commit', before, '| after rollback', staged.properties(candidate).length);
