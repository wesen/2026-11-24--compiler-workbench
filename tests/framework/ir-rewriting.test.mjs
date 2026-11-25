import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIRArtifact, defineAdapter, openIR, IRStore,
  entity, op, capture, sameAs, pattern, relation, distinct, equalContent, where,
  describePattern, match, matchAll, explainMatch, searchPattern, PatternBudgetError, PatternPredicateRegistry,
  rewrite, applyOnce, applyAll, topDown, bottomUp, innermost, outermost, saturate,
  RewriteRegistry, RewriteRejected, RewriteExecutionError
} from '../../dist/framework/ir/index.js';
import { expressionAdapter } from '../../dist/labs/expressions.js';
import { expressionDouble } from '../../dist/labs/rules.js';

const adapter = defineAdapter({
  id: 'test.logical', version: '1', kind: 'test.logical', schemaVersion: '1', description: 'Test graph with native validation',
  relationKinds: { child: 'containment', arg: 'containment', uses: 'dependency', binds: 'binding', touches: 'adjacency' },
  entities(value) { return value.entities; }, resolve(value, id) { return value.entities.find(e => e.id === id); },
  relations(value) { return value.relations; }, roots(value) { return value.roots; }, describe(_value, id) { return { label: id }; },
  validate(value) {
    assert.ok(Array.isArray(value.entities) && Array.isArray(value.relations) && Array.isArray(value.roots));
    for (const e of value.entities) if (e.attributes.n !== undefined && (typeof e.attributes.n !== 'number' || e.attributes.n < 0)) throw new Error('Native number must be nonnegative');
  },
  rebuild(_base, graph) { return graph; },
  operation(value, id) {
    const e = value.entities.find(e => e.id === id);
    if (!e?.attributes.operator) return undefined;
    return { name: e.attributes.operator, operands: value.relations.filter(r => r.kind === 'arg' && r.from === id).sort((a, b) => a.order - b.order).map(r => r.to) };
  }
});
const ent = (id, kind = 'item', attributes = {}) => ({ id, kind, attributes });
const edge = (id, kind, from, to, order) => ({ id, kind, category: adapter.relationKinds[kind], from, to, ...(order === undefined ? {} : { order }) });
function graph(entities = [ent('x', 'item', { n: 0 })], relations = [], roots = entities.map(e => e.id), id = 'test') {
  const store = new IRStore(), artifact = createIRArtifact(adapter, id, { entities, relations, roots });
  return { store, view: openIR(artifact, adapter, store) };
}
function expression() {
  return graph([
    ent('x', 'variable', { name: 'x' }), ent('y', 'variable', { name: 'y' }),
    ent('double', 'operator', { operator: 'add' }), ent('different', 'operator', { operator: 'add' }),
    ent('wrong-arity', 'operator', { operator: 'add' }), ent('product', 'operator', { operator: 'mul' })
  ], [
    edge('d0', 'arg', 'double', 'x', 0), edge('d1', 'arg', 'double', 'x', 1),
    edge('v0', 'arg', 'different', 'x', 0), edge('v1', 'arg', 'different', 'y', 1),
    edge('w0', 'arg', 'wrong-arity', 'x', 0),
    edge('p0', 'arg', 'product', 'x', 0), edge('p1', 'arg', 'product', 'double', 1)
  ], ['product', 'different', 'wrong-arity']);
}
const increment = rewrite({
  id: 'test.increment', version: '1', description: 'Increment a bounded integer', match: capture('x', entity('item')),
  guard(found, view) { return view.resolve(found.bindings.x).attributes.n < 3; },
  replace(found, edit, view) { edit.update(found.bindings.x, { n: view.resolve(found.bindings.x).attributes.n + 1 }); },
  preserves: [{ id: 'nonnegative', version: '1' }]
});

test('operation matching enforces exact name, arity, order and captured entity identity', () => {
  const { view } = expression(), repeated = pattern(op('add', capture('x'), sameAs('x')));
  const matches = matchAll(repeated, view);
  assert.deepEqual(matches.map(m => m.root.entity), ['double']);
  assert.equal(matches[0].bindings.x.entity, 'x');
  assert.equal(matches[0].bindings.x.revision, view.artifact.revision);
  assert.equal(explainMatch(matches[0]).matched, true);
  assert.ok(matches[0].evidence.some(e => e.code === 'same-as' && e.pass));
  assert.equal(explainMatch(view, repeated, 'different').matched, false);
  assert.equal(explainMatch(view, repeated, 'wrong-arity').evidence.at(-1).code, 'arity');
  assert.equal(match(view, op('mul', capture('a'), capture('b'))).bindings.a.entity, 'x');
});

test('forward identity constraints unify declared captures without leaking failed candidates', () => {
  const { view } = expression();
  assert.deepEqual(matchAll(op('add', sameAs('x'), capture('x')), view).map(m => m.root.entity), ['double']);
  assert.throws(() => match(sameAs('undeclared'), view), /undeclared capture/);
  const cyclicNames = pattern({ a: sameAs('z'), z: entity('variable', { name: 'y' }) });
  const matches = matchAll(cyclicNames, view);
  assert.equal(matches.length, 1); assert.equal(matches[0].bindings.a.entity, 'y'); assert.equal(matches[0].bindings.z.entity, 'y');
});

test('typed graph conditions and content conditions compose with exact evidence', () => {
  const { view } = graph([ent('a', 'definition', { mesh: [1, 2] }), ent('b', 'definition', { mesh: [1, 2] }), ent('i', 'instance')], [edge('bind', 'binds', 'i', 'b')]);
  const duplicate = pattern({ a: entity('definition'), b: entity('definition') }).where(distinct('a', 'b')).where(equalContent('a', 'b'));
  assert.equal(matchAll(duplicate, view).length, 2);
  const bound = pattern({ d: entity('definition'), i: entity('instance') }).where(relation('binds', 'i', 'd'));
  const found = match(bound, view); assert.equal(found.bindings.d.entity, 'b');
  assert.deepEqual(found.evidence.find(e => e.code === 'relation').data.relations, ['bind']);
  assert.throws(() => match(pattern({ a: entity(), b: entity() }).where(relation('not-a-relation', 'a', 'b')), view), /undeclared relation/);
});

test('equalContent includes ordered operand identities without pretending to prove recursive equivalence', () => {
  const { view } = expression();
  const p = pattern({ a: entity('operator', { operator: 'add' }), b: entity('operator', { operator: 'add' }) }).where(distinct('a', 'b')).where(equalContent('a', 'b'));
  assert.equal(matchAll(p, view).length, 0);
});

test('pattern serialization is finite, immutable, and semantically reusable', () => {
  const { view } = expression(), p = pattern(op('add', capture('x'), sameAs('x')));
  const encoded = JSON.stringify(p), restored = JSON.parse(encoded);
  assert.deepEqual(matchAll(restored, view), matchAll(p, view));
  assert.ok(Object.isFrozen(p.descriptor.node.operands));
  assert.deepEqual(describePattern(restored), p.descriptor);
  assert.throws(() => p.descriptor.node.operands.push(entity()), TypeError);
  const attributes = { name: 'x' }, e = entity('variable', attributes); attributes.name = 'y';
  assert.equal(match(e, view).root.entity, 'x');
});

test('pattern queries cover disconnected entities and explicit roots reject stale references', async () => {
  const { view } = graph([ent('root'), ent('island')], [], ['root']);
  assert.deepEqual(matchAll(entity(), view).map(m => m.root.entity), ['root', 'island']);
  assert.deepEqual(matchAll(entity(), view, { roots: ['island', 'island'] }).map(m => m.root.entity), ['island']);
  const edit = view.beginEdit(); edit.update('root', { flag: true }); const next = view.at((await edit.commit()).artifact);
  assert.throws(() => matchAll(entity(), next, { roots: [view.ref('root')] }), /another artifact revision/);
  const empty = graph([], [], []).view; assert.equal(match(entity(), empty), undefined); assert.equal(explainMatch(entity(), empty).reason, 'The candidate selection is empty');
});

test('versioned predicates are snapshotted and delimiter-safe, with reason evidence', () => {
  const { view } = graph([ent('a', 'item', { n: 1 }), ent('b', 'item', { n: 2 })]);
  const registry = new PatternPredicateRegistry();
  const definition = { id: 'n@value', version: '1', description: 'Number threshold', test: ({ view, bindings }, params) => ({ pass: view.resolve(bindings.x).attributes.n >= params.min, reason: 'Compared the requested threshold' }) };
  registry.register(definition); definition.test = () => false;
  registry.register({ id: 'n', version: 'value@1', description: 'Other identity', test: () => false });
  const p = pattern(capture('x', entity('item'))).where(where({ id: 'n@value', version: '1' }, { min: 2 }));
  const found = match(p, view, { registry }); assert.equal(found.bindings.x.entity, 'b');
  assert.equal(found.evidence.at(-1).message, 'Compared the requested threshold');
  assert.equal(registry.descriptors().length, 2);
  assert.throws(() => registry.register({ ...definition, test: () => true }), /already registered/);
  assert.throws(() => match(p, view), /predicate registry/);
});

test('predicate callbacks cannot substitute promises, throw away bugs, or mutate query snapshots', () => {
  let calls = 0;
  assert.throws(() => new PatternPredicateRegistry().register({ id: 'async', version: '1', description: 'async', async test() { calls++; return true; } }), /synchronous/);
  assert.equal(calls, 0);
  const registry = new PatternPredicateRegistry().register({ id: 'thenable', version: '1', description: 'bad async result', test() { return Promise.reject(new Error('must be drained')); } });
  const p = pattern(capture('x')).where(where({ id: 'thenable', version: '1' }));
  assert.throws(() => match(p, graph().view, { registry }), /synchronous/);
  const throwing = new PatternPredicateRegistry().register({ id: 'bug', version: '1', description: 'Throw', test() { throw new Error('implementation bug'); } });
  assert.throws(() => match(pattern(capture('x')).where(where({ id: 'bug', version: '1' })), graph().view, { registry: throwing }), /implementation bug/);
});

test('matching budgets never return a truncated successful enumeration', () => {
  const { view } = graph([ent('a'), ent('b')]);
  assert.throws(() => matchAll(entity(), view, { maxMatches: 1 }), error => error instanceof PatternBudgetError && error.budget === 'matches' && error.partial.length === 1);
  assert.throws(() => matchAll(entity(), view, { maxSteps: 1 }), error => error instanceof PatternBudgetError && error.budget === 'steps');
  assert.equal(match(entity(), view, { maxMatches: 1, maxSteps: 1 }).root.entity, 'a');
  assert.equal(searchPattern(view, entity()).steps, 2);
  assert.throws(() => matchAll(entity(), view, { maxSteps: Infinity }), /positive safe integer/);
});

test('special capture names are data and malformed patterns are rejected', () => {
  const nodes = Object.fromEntries([['__proto__', entity('item')]]), p = pattern(nodes);
  assert.equal(Object.hasOwn(match(p, graph().view).bindings, '__proto__'), true);
  assert.throws(() => match({ type: 'entity', surprise: true }, graph().view), /unsupported field/);
  assert.throws(() => pattern({ a: entity() }).where(distinct('a', 'b')), /undeclared capture/);
  const cyclic = { type: 'capture', name: 'x' }; cyclic.pattern = cyclic;
  assert.throws(() => describePattern(cyclic), /exceeds/);
  const getter = Object.defineProperty({}, 'type', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => describePattern(getter), /accessors/);
});

test('one rewrite commits exact revision changes while keeping the original view immutable', async () => {
  const { view, store } = graph(), initial = view.artifact;
  const out = await applyOnce(view, increment);
  assert.equal(out.status, 'applied'); assert.equal(out.applications, 1); assert.equal(out.view.resolve('x').attributes.n, 1);
  assert.equal(view.resolve('x').attributes.n, 0); assert.equal(store.head('test').revision, out.artifact.revision);
  assert.notEqual(initial.revision, out.artifact.revision); assert.equal(out.steps[0].match.artifact.revision, initial.revision);
  assert.equal(out.steps[0].result.changes.entities[0].kind, 'updated');
  assert.equal(out.steps[0].preservation.verification, 'unverified');
  assert.ok(Object.isFrozen(out.steps[0].result));
});

test('all applies the initial match frontier, revalidating overlaps after each accepted edit', async () => {
  const { view } = graph([ent('a', 'definition', { mesh: 1 }), ent('b', 'definition', { mesh: 1 }), ent('c', 'definition', { mesh: 1 }), ent('i', 'instance')], [edge('ref', 'binds', 'i', 'c')]);
  const merge = rewrite({ id: 'merge', match: pattern({ a: entity('definition'), b: entity('definition') }).where(distinct('a', 'b')).where(equalContent('a', 'b')),
    guard: found => found.bindings.a.entity < found.bindings.b.entity,
    replace(found, edit) { edit.redirectReferences(found.bindings.b, found.bindings.a); edit.remove(found.bindings.b); edit.correspond(found.bindings.b, found.bindings.a, 'merged'); }
  });
  const out = await applyAll(view, merge);
  assert.equal(out.applications, 2); assert.deepEqual(out.view.find(e => e.kind === 'definition').map(r => r.entity), ['a']);
  assert.equal(out.view.successors('i', 'binds')[0].entity, 'a');
  assert.equal(out.steps.filter(s => s.status === 'applied')[1].match.artifact.revision, out.steps[0].after.revision);
});

const treeRule = rewrite({ id: 'tree.value', match: capture('node', entity('node')),
  guard(found, view) { const children = view.children(found.bindings.node); return view.resolve(found.bindings.node).attributes.n !== (children.length ? view.resolve(children[0]).attributes.n + 1 : 1); },
  replace(found, edit, view) { const children = view.children(found.bindings.node); edit.update(found.bindings.node, { n: children.length ? view.resolve(children[0]).attributes.n + 1 : 1 }); }
});
function tree() { return graph([ent('root', 'node', { n: 0 }), ent('leaf', 'node', { n: 0 })], [edge('child', 'child', 'root', 'leaf')], ['root']).view; }
test('top-down and bottom-up are single sweeps with observably different dependency order', async () => {
  const top = await topDown(tree(), treeRule), bottom = await bottomUp(tree(), treeRule);
  assert.deepEqual(top.steps.filter(s => s.status === 'applied').map(s => s.match.root.entity), ['root', 'leaf']);
  assert.deepEqual(bottom.steps.filter(s => s.status === 'applied').map(s => s.match.root.entity), ['leaf', 'root']);
  assert.equal(top.view.resolve('root').attributes.n, 1); assert.equal(bottom.view.resolve('root').attributes.n, 2);
});
test('innermost and outermost normalize with real post-order versus pre-order scheduling', async () => {
  const inner = await innermost(tree(), treeRule), outer = await outermost(tree(), treeRule);
  assert.equal(inner.status, 'converged'); assert.equal(outer.status, 'converged');
  assert.equal(inner.applications, 2); assert.equal(outer.applications, 3);
  assert.equal(inner.view.resolve('root').attributes.n, 2); assert.equal(outer.view.resolve('root').attributes.n, 2);
});

test('newly introduced matches are outside a sweep but included by normalization', async () => {
  const spawn = rewrite({ id: 'spawn', match: capture('x', entity('item', { n: 0 })), replace(found, edit) {
    edit.update(found.bindings.x, { n: 1 }); edit.insert(ent(found.bindings.x.entity + '-child', 'item', { n: 0 }));
  } });
  const sweep = await applyAll(graph().view, spawn);
  assert.equal(sweep.applications, 1); assert.equal(sweep.view.entities().length, 2);
  const normalization = await saturate(graph().view, [spawn], { budget: 3 });
  assert.equal(normalization.status, 'budget'); assert.equal(normalization.applications, 3); assert.equal(normalization.view.entities().length, 4);
});

test('saturation detects a directed cycle before publishing its repeated candidate', async () => {
  const forward = rewrite({ id: 'forward', match: capture('x', entity('item', { n: 0 })), replace(found, edit) { edit.update(found.bindings.x, { n: 1 }); } });
  const reverse = rewrite({ id: 'reverse', match: capture('x', entity('item', { n: 1 })), replace(found, edit) { edit.update(found.bindings.x, { n: 0 }); } });
  const { view, store } = graph(); let verified = 0;
  const out = await saturate(view, [forward, reverse], { verify() { verified++; return { commit() {}, rollback() {} }; } });
  assert.equal(out.status, 'cycle'); assert.equal(out.applications, 1); assert.equal(out.view.resolve('x').attributes.n, 1); assert.equal(verified, 1);
  assert.equal(out.steps.at(-1).status, 'cycle-rejected'); assert.equal(out.steps.at(-1).result.artifact.value.entities[0].attributes.n, 0);
  assert.equal(store.head('test').revision, out.artifact.revision);
});

test('application budget distinguishes an uncommitted candidate from established convergence', async () => {
  const limited = await saturate(graph().view, [increment], { budget: 1 });
  assert.equal(limited.status, 'budget'); assert.equal(limited.applications, 1); assert.equal(limited.view.resolve('x').attributes.n, 1);
  assert.equal(limited.steps.at(-1).status, 'budget-rejected'); assert.equal(limited.steps.at(-1).preservation.verification, 'unverified');
  const exact = await saturate(graph().view, [increment], { budget: 3 });
  assert.equal(exact.status, 'converged'); assert.equal(exact.applications, 3);
  const zero = await applyOnce(graph().view, increment, { budget: 0 }); assert.equal(zero.status, 'budget'); assert.equal(zero.applications, 0);
});

test('matching and attempt budgets apply across the entire schedule', async () => {
  assert.equal((await applyOnce(graph().view, increment, { budget: { maxMatchSteps: 1 } })).status, 'budget');
  const two = graph([ent('a', 'item', { n: 0 }), ent('b', 'item', { n: 0 })]).view;
  const matched = await applyAll(two, increment, { budget: { maxMatches: 1 } }); assert.equal(matched.status, 'budget'); assert.equal(matched.applications, 0);
  const guarded = rewrite({ id: 'deny', match: entity('item'), guard: () => false, replace() { throw new Error('must not run'); } });
  const attempted = await applyAll(two, guarded, { budget: { maxAttempts: 1 } });
  assert.equal(attempted.status, 'budget'); assert.equal(attempted.attempts, 1);
  await assert.rejects(() => applyOnce(graph().view, increment, { budget: { maxApplications: -1 } }), /nonnegative safe integer/);
});

test('no-op rules terminate without publishing revisions or claiming semantic verification', async () => {
  const noop = rewrite({ id: 'noop', match: entity('item'), replace() {}, preserves: [{ id: 'value', version: '1' }] });
  let calls = 0; const { view, store } = graph();
  const out = await saturate(view, [noop], { verify() { calls++; return { commit() {}, rollback() {} }; } });
  assert.equal(out.status, 'converged'); assert.equal(out.applications, 0); assert.equal(calls, 0); assert.equal(store.revisions('test').length, 1);
  assert.equal(out.steps[0].status, 'unchanged'); assert.equal(out.steps[0].preservation.verification, 'unverified');
});

test('semantic acceptance runs before publication and is separately identified from declarations', async () => {
  const { view, store } = graph(); const observations = [];
  const out = await applyOnce(view, increment, { async verify(candidate, original) {
    assert.equal(original.revision, view.artifact.revision); assert.equal(store.head('test').revision, original.revision);
    assert.equal(candidate.artifact.value.entities[0].attributes.n, 1); observations.push('checked');
    return { commit() { assert.equal(store.head('test').revision, original.revision); observations.push('accepted'); }, rollback() { observations.push('rolled back'); } };
  } });
  assert.deepEqual(observations, ['checked', 'accepted']); assert.equal(out.steps[0].preservation.verification, 'host-accepted');
  assert.deepEqual(out.steps[0].preservation.declared, [{ id: 'nonnegative', version: '1' }]);
});

test('semantic rejection rolls back atomically and retains its provisional edit as evidence', async () => {
  const { view, store } = graph(); let rolledBack = 0;
  const out = await applyOnce(view, increment, { verify() { return { commit() { throw new RewriteRejected('Semantic invariant failed'); }, rollback() { rolledBack++; } }; } });
  assert.equal(out.status, 'rejected'); assert.equal(out.applications, 0); assert.equal(rolledBack, 1); assert.equal(store.head('test').revision, view.artifact.revision);
  assert.equal(out.steps[0].status, 'rejected'); assert.equal(out.steps[0].result.artifact.value.entities[0].attributes.n, 1);
  assert.equal(out.steps[0].preservation.verification, 'unverified');
});

test('unexpected errors remain fatal while an explicit host classifier can recognize rejection', async () => {
  const verify = () => { throw new Error('contract violation'); };
  await assert.rejects(() => applyOnce(graph().view, increment, { verify }), error => error instanceof RewriteExecutionError && error.result.status === 'failed' && error.result.steps[0].status === 'failed');
  const out = await applyOnce(graph().view, increment, { verify, classifyRejection: error => error.message === 'contract violation' }); assert.equal(out.status, 'rejected');
  const broken = rewrite({ id: 'broken', match: capture('x'), replace(found, edit) { edit.update(found.bindings.x, { n: 9 }); throw new Error('algorithm bug'); } });
  const { view, store } = graph(); await assert.rejects(() => applyOnce(view, broken), /algorithm bug/); assert.equal(store.head('test').revision, view.artifact.revision);
});

test('native invalid edits and stale views fail without publishing artifacts', async () => {
  const invalid = rewrite({ id: 'invalid', match: capture('x'), replace(found, edit) { edit.update(found.bindings.x, { n: -1 }); } });
  const { view, store } = graph(); await assert.rejects(() => applyOnce(view, invalid), /nonnegative/); assert.equal(store.head('test').revision, view.artifact.revision);
  await applyOnce(view, increment); await assert.rejects(() => applyOnce(view, increment), /Stale edit/);
});

test('an awaited gate cannot publish over a concurrently committed revision', async () => {
  const { view, store } = graph(); let release, entered, rolledBack = 0;
  const waiting = new Promise(resolve => { entered = resolve; }), ready = new Promise(resolve => { release = resolve; });
  const pending = applyOnce(view, increment, { async verify() { entered(); await ready; return { commit() { throw new Error('stale semantic acceptance must never commit'); }, rollback() { rolledBack++; } }; } });
  await waiting; const competitor = view.beginEdit(); competitor.update('x', { n: 8 }); const committed = await competitor.commit(); release();
  await assert.rejects(() => pending, /Stale edit/); assert.equal(rolledBack, 1); assert.equal(store.head('test').revision, committed.artifact.revision);
});

test('cancellation before a schedule or during its semantic gate never publishes its draft', async () => {
  const early = new AbortController(); early.abort(); const stopped = await applyOnce(graph().view, increment, { signal: early.signal });
  assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.attempts, 0);
  const controller = new AbortController(), { view, store } = graph(); let rolledBack = 0;
  const out = await applyOnce(view, increment, { signal: controller.signal, async verify() { controller.abort(); return { commit() { throw new Error('must not commit'); }, rollback() { rolledBack++; } }; } });
  assert.equal(out.status, 'cancelled'); assert.equal(out.applications, 0); assert.equal(rolledBack, 1); assert.equal(store.head('test').revision, view.artifact.revision);
});

test('async acceptance callbacks are never masked by the cancellation wrapper', async () => {
  let effects = 0;
  const controller = new AbortController();
  await assert.rejects(() => applyOnce(graph().view, increment, { signal: controller.signal, verify() { return { async commit() { effects++; }, rollback() {} }; } }), /synchronous/);
  assert.equal(effects, 0);
  await assert.rejects(() => applyOnce(graph().view, increment, { verify() { return { commit() { return Promise.reject(new Error('drain async result')); }, rollback() {} }; } }), /synchronous/);
});

test('rule definitions and callback protocols are immutable and fail closed', async () => {
  let ran = 0;
  assert.throws(() => rewrite({ id: 'async.guard', match: entity(), async guard() { ran++; return true; }, replace() {} }), /synchronous/);
  assert.equal(ran, 0);
  assert.throws(() => rewrite({ id: 'generator', match: entity(), *replace() { ran++; } }), /generator/);
  const thenable = rewrite({ id: 'thenable', match: entity(), guard() { return Promise.reject(new Error('guard result drained')); }, replace() {} });
  await assert.rejects(() => applyOnce(graph().view, thenable), /synchronous/);
  const declarations = [{ id: 'p', version: '1' }], definition = { id: 'captured', match: capture('x'), preserves: declarations, replace(found, edit) { edit.update(found.bindings.x, { n: 1 }); } };
  const captured = rewrite(definition); declarations[0].version = '2'; definition.replace = () => { throw new Error('must not execute'); };
  const out = await applyOnce(graph().view, captured); assert.equal(out.artifact.value.entities[0].attributes.n, 1); assert.equal(out.steps[0].preservation.declared[0].version, '1');
});

test('rewrite registries use version tuples and reusable schedules expose plain descriptors', async () => {
  const registry = new RewriteRegistry().register(rewrite({ ...increment, id: 'a@b', version: 'c' })).register(rewrite({ ...increment, id: 'a', version: 'b@c' }));
  assert.equal(registry.descriptors().length, 2); assert.equal(registry.get({ id: 'a@b', version: 'c' }).id, 'a@b');
  assert.throws(() => registry.register(registry.get({ id: 'a', version: 'b@c' })), /already registered/);
  const compiled = saturate([increment], { budget: 3 }); assert.equal(JSON.parse(JSON.stringify(compiled.descriptor)).mode, 'saturate');
  assert.equal((await compiled.run(graph().view)).status, 'converged'); assert.equal((await compiled.run(graph().view, { budget: 1 })).status, 'budget');
  assert.equal((await applyOnce(increment).run(graph().view)).applications, 1); assert.equal((await applyOnce(increment, graph().view)).applications, 1);
});

test('replacement callbacks cannot publish early or bypass scheduler budgets through their view', async () => {
  const earlyCommit = rewrite({ id: 'early.commit', match: capture('x'), replace(found, edit, view) {
    assert.equal(edit.prepare, undefined); assert.equal(edit.rollback, undefined); assert.equal(view.beginEdit, undefined); assert.equal(view.at, undefined);
    edit.update(found.bindings.x, { n: 1 }); return edit.commit();
  } });
  const { view, store } = graph();
  await assert.rejects(() => applyOnce(view, earlyCommit, { budget: 0 }), /edit.commit is not a function/);
  assert.equal(store.head('test').revision, view.artifact.revision); assert.equal(store.revisions('test').length, 1);
  const viewEscape = rewrite({ id: 'early.view', match: entity(), replace(_found, _edit, reader) { reader.beginEdit().commit(); } });
  await assert.rejects(() => applyOnce(view, viewEscape), /beginEdit is not a function/);
  assert.equal(store.head('test').revision, view.artifact.revision);
});

test('edit capabilities expire before asynchronous verification, including retained callback references', async () => {
  let capturedEdit;
  const rule = rewrite({ id: 'leased.edit', match: capture('x'), replace(found, edit) { capturedEdit = edit; edit.update(found.bindings.x, { n: 1 }); } });
  const out = await applyOnce(graph().view, rule, { async verify() {
    assert.throws(() => capturedEdit.update('x', { n: 7 }), /capability expired/); await Promise.resolve();
    assert.throws(() => capturedEdit.remove('x'), /capability expired/); return { commit() {}, rollback() {} };
  } });
  assert.equal(out.view.resolve('x').attributes.n, 1); assert.throws(() => capturedEdit.insert(ent('late')), /capability expired/);
});

test('custom predicates and rule guards receive read-only observation capabilities', async () => {
  const registry = new PatternPredicateRegistry().register({ id: 'read-only', version: '1', description: 'Read only', test({ view }) {
    assert.equal(view.beginEdit, undefined); assert.equal(view.at, undefined); assert.ok(Object.isFrozen(view)); return true;
  } });
  const p = pattern(capture('x')).where(where({ id: 'read-only', version: '1' }));
  assert.equal(match(p, graph().view, { registry }).root.entity, 'x');
  const rule = rewrite({ id: 'read.guard', match: capture('x'), guard(_found, view) { assert.equal(view.beginEdit, undefined); return true; }, replace(found, edit) { edit.update(found.bindings.x, { n: 1 }); } });
  assert.equal((await applyOnce(graph().view, rule)).applications, 1);
});

test('selected dependency relationships give nested expressions actual inner and outer order', async () => {
  function arena() {
    // Flat structural membership deliberately differs from nested semantic operand dependencies.
    return graph([ent('program', 'program'), ent('a-parent', 'node', { n: 0 }), ent('z-child', 'node', { n: 0 }), ent('unrelated', 'other')], [
      edge('member1', 'child', 'program', 'a-parent'), edge('member2', 'child', 'program', 'z-child'),
      edge('operand', 'uses', 'a-parent', 'z-child')
    ], ['program']).view;
  }
  const dependent = rewrite({ id: 'dependency.value', match: capture('node', entity('node')),
    guard(found, view) { const dependencies = view.successors(found.bindings.node, 'uses'); return view.resolve(found.bindings.node).attributes.n !== (dependencies.length ? view.resolve(dependencies[0]).attributes.n + 1 : 1); },
    replace(found, edit, view) { const dependencies = view.successors(found.bindings.node, 'uses'); edit.update(found.bindings.node, { n: dependencies.length ? view.resolve(dependencies[0]).attributes.n + 1 : 1 }); }
  });
  assert.deepEqual(matchAll(entity('node'), arena(), { order: 'post', relations: ['uses'] }).map(found => found.root.entity), ['z-child', 'a-parent']);
  assert.deepEqual(matchAll(entity('node'), arena(), { order: 'post' }).map(found => found.root.entity), ['a-parent', 'z-child']);
  const inner = await innermost(arena(), dependent, { relations: ['uses'] }), outer = await outermost(arena(), dependent, { relations: ['uses'] });
  assert.equal(inner.applications, 2); assert.equal(outer.applications, 3);
  assert.deepEqual(inner.steps.filter(s => s.status === 'applied').map(s => s.match.root.entity), ['z-child', 'a-parent']);
  assert.deepEqual(outer.steps.filter(s => s.status === 'applied').map(s => s.match.root.entity), ['a-parent', 'z-child', 'a-parent']);
  const sweep = await bottomUp(arena(), dependent, { relations: ['uses'] }); assert.equal(sweep.view.resolve('a-parent').attributes.n, 2);
  assert.deepEqual(innermost(dependent, { relations: ['uses'] }).descriptor.relations, ['uses']);
  await assert.rejects(() => topDown(arena(), dependent, { relations: ['missing'] }), /undeclared relation/);
});

test('explicit ordering relation cycles and disconnected components are visited once', () => {
  const { view } = graph([ent('a'), ent('b'), ent('c')], [edge('ab', 'uses', 'a', 'b'), edge('ba', 'uses', 'b', 'a')], ['a']);
  const first = matchAll(entity(), view, { relations: ['uses'], order: 'post' });
  assert.equal(first.length, 3); assert.deepEqual(first.map(m => m.root.entity), ['c', 'b', 'a']);
  assert.deepEqual(matchAll(entity(), view, { relations: [] }).map(m => m.root.entity), ['a', 'b', 'c']);
});

test('native expression rewrite order follows explicitly selected operand dependencies', async () => {
  const native = { root: 'a-outer', nodes: {
    'a-outer': { op: 'add', args: ['z-inner', 'z-inner'] },
    'z-inner': { op: 'add', args: ['x', 'x'] }, x: { op: 'variable', name: 'x' }
  } };
  const fresh = () => openIR(createIRArtifact(expressionAdapter, 'nested-expression', native), expressionAdapter);
  const inner = await innermost(fresh(), expressionDouble, { relations: ['operand'] });
  const outer = await outermost(fresh(), expressionDouble, { relations: ['operand'] });
  assert.deepEqual(inner.steps.filter(s => s.status === 'applied').map(s => s.match.root.entity), ['z-inner', 'a-outer']);
  assert.deepEqual(outer.steps.filter(s => s.status === 'applied').map(s => s.match.root.entity), ['a-outer', 'z-inner']);
  assert.equal(inner.artifact.value.nodes['a-outer'].op, 'mul'); assert.equal(outer.artifact.value.nodes['z-inner'].op, 'mul');
});
