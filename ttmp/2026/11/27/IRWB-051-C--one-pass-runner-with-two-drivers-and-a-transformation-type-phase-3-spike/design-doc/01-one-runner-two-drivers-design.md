---
Title: 'One runner, two drivers: design'
Ticket: IRWB-051-C
Status: active
Topics:
    - framework
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:22:26.053626428-05:00
WhatFor: ""
WhenToUse: ""
---

# One runner, two drivers: design

Written before the prototype (IRWB-051-C, a spike for phase 3 of IRWB-039). The report
(`reference/02-report.md`) has the measurements and the recommendation.

## The question

Can one pass runner, written once, serve a synchronous and an asynchronous caller, with the synchronous one
answering analysis requests through the analysis manager's cache and records? Or does a synchronous `analyse`
duplicate so much of the manager that one pass specification with two thin runners is better?

## Supported input domain

- **Transformations:** endomorphic passes over one IR with an adapter, as `definePass` accepts today: a native
  result with correspondence entries, or an `IREdit` on the projection.
- **Analyses the synchronous driver can answer:** *pure* analyses, meaning `run` (and `transfer.verify`) return a
  value, not a promise, and request nothing from their context that is asynchronous (`ctx.analysis`, `ctx.check`,
  `ctx.require`, `ctx.checkInvariant` all return promises). Every Typed analysis (`src/typed/analyses.ts`) and
  every `dataflow()` analysis is pure in this sense.
- **Obligations the synchronous driver can answer:** checks that return a `CheckResult`. A v6 transformation
  contract is answered by `manager.verifyTransformation`, which is asynchronous, so it is in the asynchronous
  driver's domain only (see Later).
- Outside this domain the synchronous driver stops with an ordinary `Error` whose message names the transformation
  and says a step answered asynchronously. Nothing else is specified for such inputs.

## Decisions

### D1. One effect: a value that may be a promise

The runner is a generator. It yields a value; the driver sends back what the value resolves to.

```ts
type Steps<T> = Generator<unknown, T, any>;
function* wait<T>(v: T | PromiseLike<T>): Steps<T> { return (yield v) as T; }   // typed yield
function driveSync<T>(steps: Steps<T>, what: string): T      // sends a value back; refuses a promise
function driveAsync<T>(steps: Steps<T>): Promise<T>          // awaits every yielded value
```

- **Simplest alternative:** R3 reviewer D's shape: the runner yields tagged requests
  (`{ effect: 'analysis' | 'gate' | 'body' }`) and each driver has a handler per tag. It falls short on exactly the
  point the synthesis marks as open: each driver then needs its own way to answer `analysis`, and the synchronous
  one has no manager path to call, so D's prototype called `def.run` directly.
- **Chosen:** the manager's own logic becomes a generator of the same kind (D2), and the runner delegates to it
  with `yield*`. Then there is one code path per job and the drivers know nothing about passes or analyses. A
  driver is about ten lines.
- **Cost:** a driver cannot intercept a request by kind (for example to batch deferred obligations). See Later.

The synchronous driver abandons a generator that yields a promise with `return()`, not `throw()`: probe 02 shows
`return()` runs the `finally` blocks and skips the `catch` blocks. The runner has a
`try { transfer } catch { recompute }` that would otherwise swallow the refusal.

### D2. `analyseSync` shares `analyse`'s code, not a copy of it

`AnalysisManager.analyseInternal` (the cache lookup, dependency replay, frame, run, record, events) becomes the
generator `analyseSteps`. Its two `await`s become yields. Then:

```ts
analyse(d, a, p)     = driveAsync(this.analyseSteps(d, a, p))
analyseSync(d, a, p) = driveSync(this.analyseSteps(d, a, p), ...)
```

`preserveInternal` gets the same treatment (`preserveSteps`, `preserveSync`), because a pass's `preserves` claims
are checked by `preserve` and then, when the transfer is refused, by recomputing.

- **Simplest alternative:** a second method `analyseSync` that repeats the lookup and the record construction.
  `analyseInternal` is about 105 lines of which 3 involve `await`; a copy would repeat the other 100 and the two
  would have to be kept equal by hand (record ids are fingerprints of the same fields; a drift changes cache hits).
  The brief asks for one path per job.
- **Second alternative:** split `analyseInternal` into `lookup`, `run`, `record` helpers and call them from two
  short methods. It works for `analyse`, but `preserve` and later the contract path each need their own split; the
  generator is one mechanism for all of them.
- **What can differ for existing asynchronous callers:** only the number of microtask turns. Today
  `await this.drain(frame)` and the `finally`'s `await Promise.allSettled([])` take turns even when nothing is
  pending; the generator yields a promise only when something is pending. Values, records, record ids and events
  are produced by the same statements in the same order. The framework and Typed suites and the baselines check
  this.

### D3. The transformation type

```ts
type Relation = 'exact' | 'tolerance';

interface TransformationSpec<S, N extends Needs, P> {
  id; version; description; ir; adapter;
  needs?: N;                                   // as today
  writes: { entities; relations };             // as today
  relation: Relation;                          // declared by the transformation
  eligible?(ctx: { before, view, facts, params }): CheckResult;           // today's `legal`, and it sees facts
  prepare(ctx: PassRunContext<S, N, P>): void | NativeResult<S> | Promise<...>;   // today's `run`
  obligations?: {
    requires?: readonly Requires<S, N, P>[];   // { id, check({ before, view, facts, params, inputs }) }
    ensures?: readonly Ensures<S, P>[];        // { id, check({ before, candidate, relation, params, inputs }) }
                                               //   or a v6 TransformationDefinition (a contract)
    preserves?: readonly AnalysisDefinition[]; // as today
  };
}
```

- `relation` is `'exact' | 'tolerance'`, the type Tix already has (`src/tensor/contract.ts`). The bound of
  `'tolerance'` stays in the domain's `ensures` check, which reads `ctx.relation`. **Simplest alternative:** leave
  the relation on the Tix pass object, as today; it falls short because the gate is then built by the caller from
  a field the framework does not know (`meaningGate(origin, definition.relation)` in `optimizeTix`). A bound as
  data (K3's `within(bound)`) is under Later: no ported pass has one.
- `eligible` runs after `needs`, so it can read facts; today's `legal` runs before and cannot. **Simplest
  alternative:** today's order. It was not kept because an eligibility that depends on a fact (T6's order checks,
  `strength`'s range proof if it became a per-application decision) could not be stated. An ineligible
  application now computes its needs first; the facts are cached for the same revision.
- `requires` is a named check on the input; a failed one refuses the application exactly as `eligible` does
  (`PassError('illegal')`), before `prepare`. `ensures` is checked on the candidate; a failed one is
  `PassError('contractRejected')`. No new error code.
- The meaning gate is an `ensures` obligation. A transformation carries its own (`tensor.inline`: the Tix meaning
  gate, reading `inputs.origin`), and an application can add more (`options.ensures`: Typed's optimization
  contract is built per project from its case inputs, as `ApplyOptions.contract` is today). This replaces both the
  `gate` argument of `applyNativePassSync` and `options.contract` of `applyPass`.
- A transformation is also a `Pass`: `transformation(spec)` returns the spec plus the fields the two existing
  runners read (`run = prepare`, `legal`, `preserves`, `category`). So a ported pass stays in `PASSES` and in
  `optimizeTix`, and every existing caller keeps working. The migration deletes this view with the old runners.
  `legal` of the view calls `eligible` with no facts, so the view is only given to transformations whose
  `eligible` does not read them (both ports have none).

### D4. The runner

One generator, `runTransformation(t, before, options)`, in `src/framework/passes/transformation.ts`. Order:
needs, requires, eligible, prepare, unchanged?, writes, ensures, preserves, publish. It reuses today's helpers
from `define-pass.ts` (`prepareNative`, `enforceWrites`, `publishAccepted`, `discardEvidence`), which are exported
for it, so candidate construction, the correspondence, F33's publication boundary and the rejection cleanup are
the same code as `applyPass`.

```ts
applyTransformation(t, before, options)     = driveAsync(runTransformation(t, before, options))
applyTransformationSync(t, before, options) = driveSync(runTransformation(t, before, options), t.id)
```

The result is today's `PassResult` plus `relation` and the obligations' evidence; refusals and rejections are
today's `PassError`s. **Simplest alternative:** outcomes as values (K1's accepted, unchanged, refused, rejected).
Not done: the comparison with today's runners is easier with today's result, and it is independent of the
question.

### D5. Ports

- **Tix `inline`** (`src/tensor/passes.ts`): `relation: 'exact'`, `prepare` is today's `run`, `ensures` is the
  meaning gate against `inputs.origin`. `optimizeTix` is unchanged (it still calls `applyNativePassSync` on the
  pass view).
- **Typed `strength`** (`src/typed/passes.ts`), not `licm` or `bce`: those two declare `preserves: []`, so they
  would not exercise the preservation half. `strength` needs `typed.ranges` (a `dataflow()` analysis with a
  checked transfer) and preserves `typed.cfg`, `typed.dominators` and `typed.loops`. `typedPass` builds a
  transformation for this one pass; the others stay on `definePass`.

## What is built in this session

- `src/framework/contracts/steps.ts`: `Steps`, `wait`, `driveSync`, `driveAsync`.
- `analysis-manager.ts`: `analyseSteps`, `analyseSync`, `preserveSteps`, `preserveSync`; `analyse` and `preserve`
  driven from the same generators.
- `src/framework/passes/transformation.ts`: the type, `transformation()`, the runner, the two entry points.
- The two ports, a test in `tests/framework/`, and a measurement script.

## Measurements planned

1. Revisions: both ports, both drivers, against `applyPass` / `applyNativePassSync`, on every corpus program.
2. Milliseconds per application, same process, interleaved: Tix inline on `attention` (today's sync runner, new
   sync, new async); Typed `strength` (today's `applyPass`, new async, new sync). And `analyse` itself, before and
   after the change, on a cache miss and a cache hit, since every existing caller pays for D2.
3. Size: lines of `analyseSync`, lines it shares with `analyse`, lines duplicated.

The decision rule: if `analyseSync` needs a copy of more than a few lines of `analyse`, or the generator makes
`analyse` or a pass application measurably slower than the run-to-run spread, recommend one specification with
two thin runners; otherwise one runner.

## Later

- Contracts under the synchronous driver: `beginTransformation` / `verify` / `condition` / `checkInternal` as
  `Steps` (13 `await`s in the transformation path).
- A synchronous strategy driver: `strategy/interpreter.ts` as `Steps` (27 `await`s), so `optimizeTix` and Tix's
  scheduling rule can run a plan.
- Migrating every other pass, deleting `applyPass`, `applyNativePassSync` and the pass view.
- Outcomes as values (accepted, unchanged, refused, rejected, unavailable, pending).
- Deferred and batched obligations (needs a driver that can see the kind of a request).
- `decide` and plans as data (K6), derivations (K2), ports in and out (cross-IR transformations).
- A tolerance bound as data in `relation`; method and scope of evidence (K3) combined per application.
