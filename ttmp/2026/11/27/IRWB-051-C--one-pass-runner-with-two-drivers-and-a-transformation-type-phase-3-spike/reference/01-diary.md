---
Title: Diary
Ticket: IRWB-051-C
Status: active
Topics:
    - framework
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:22:27.072081855-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## Step 1: reading, two probes, the design

Read the brief's list: the design doc's Phase 3, the R3 synthesis (K1, K3, K5, the merged lifecycle,
`verification.md` line 53), `define-pass.ts`, `bridge.ts`, and `analyse` / `preserve` / `verifyTransformation` in
the manager.

What I found that shapes the design:

- `analyseInternal` is about 105 lines and awaits in three places: `definition.run`, `drain`, and
  `Promise.allSettled` in its `finally`. Everything else (key, cache lookup, dependency replay, the record) is
  synchronous code. `preserveInternal` has the same shape.
- Every Typed analysis ignores its context and returns a value. So "pure" can be defined operationally: `run`
  returns a non-promise and leaves nothing pending.
- `verifyTransformation` is a different size of problem: 13 awaits, nested conditions, invariants that may be
  asynchronous (Typed's meaning check hands cases to worker threads when an executor is installed).
- `licm` and `bce`, the brief's examples, both declare `preserves: []`. `strength` has needs and three
  preservation claims, so I port that one.

Probes (`scripts/01-…`, `scripts/02-…`, outputs beside them):

- A throw into a generator suspended in `try` runs its `finally`, through `yield*`. One `yield*` round trip costs
  about 0.2 µs.
- `gen.return()` runs `finally` blocks and skips `catch` blocks; a yield inside a `finally` is passed by calling
  `return()` again (2 calls in the probe). This is how the synchronous driver abandons a runner.
- Today, at r0: `strength` changes 3 corpus programs (chess-search, sha-chacha, strength), `licm` 12, `bce` 10.
  `applyNativePassSync(inline, attention)` with a trivial gate: 1.7 ms on this machine at this moment (other
  agents share it; the brief's figure is 0.6 ms).

`npm ci` was needed (the worktree had no `node_modules`).

Decision: one effect (a value that may be a promise), the manager's own functions as generators, the runner
delegating with `yield*`. Design committed before the prototype.

## Step 2: the manager's functions as steps

Before touching the manager I recorded `analyse` on the base commit (`scripts/03-bench-analyse.mjs`, output
`03-bench-analyse.base-3ba86fc.out.txt`), so the cost to existing asynchronous callers can be compared.

Changes in `analysis-manager.ts` (+90 −17 lines):

- `analyseInternal` (103 lines, `async`) became the generator `analyseFrom` (106 lines). Three statements changed:
  `await definition.run(...)` is `yield* wait(definition.run(...))`; `await this.drain(frame)` is
  `yield* this.drainSteps(frame)`; the `finally` yields `Promise.allSettled` only when something is pending, inside
  an inner `try/finally` so that `frame.active = false` also runs when the synchronous driver abandons the run.
- `analyseInternal` is now `driveAsync(this.analyseFrom(...))`, so `analyse`, `ctx.analysis`, `recordProof` and
  `evaluateObjective` are unchanged callers. `analyseSync` is `driveSync(this.analyseFrom(...))`: 7 lines.
- The same for `preserveInternal` → `preserveFrom`, `preserveSync`.

The 243 framework tests passed on the first run after the change.

What was tricky: the synchronous driver first threw its refusal *into* the generator. The runner's
`try { preserve } catch { recompute }` would have caught that and gone on to recompute. Probe 02 settled it:
`return()` instead of `throw()`. The consequence for anyone writing a runner: cleanup that must also run when a
synchronous driver gives up belongs in `finally`, not `catch`.

## Step 3: the transformation type, the runner, the ports

- `src/framework/passes/transformation.ts`: the type, `transformation()`, `runTransformation` (205 lines; today's
  `applyPass` is 154 and `applyNativePassSync` 42, and the runner covers both plus `requires`, several `ensures`
  and the evidence list), `applyTransformation`, `applyTransformationSync`.
- `define-pass.ts`: `export` on four helpers, nothing else.
- `tensor/passes.ts`: `inlinePass` is a transformation with `relation: 'exact'` and the meaning gate as its
  `ensures`. `typed/passes.ts`: `TypedPassSpec.relation`; `strength` declares it and is built by `transformation()`.

`tsc` was clean. First test run: 7 of 9 passed; the two failures were my expectations (inline changes 2 Tix
programs, not 3; `fixed-point` does not reach `strength` in O2), not the runner.

The machine's load average was 54 during the measurements (other agents). All timings are therefore interleaved in
one process and reported as median and min..max of batch means.

## Step 4: measurements

- `scripts/04-revisions-and-timings.mjs revisions`: 0 differences on 6 Tix programs and 53 Typed inputs.
- The first timing run used wall-clock time and was useless at load average 50: the same runner varied by a
  factor of two between batches. I switched both scripts to CPU time of the process.
- For "before" numbers of `analyse` I built the base commit into `.base-build/` inside the worktree
  (`git archive 3ba86fc src tsconfig.json`), not a second worktree. First attempt was wrong in an instructive way:
  I made the artifact with the prototype's build and analysed it with the base build, and `typed.cfg` took 110 ms
  instead of 1 ms, because `immutable()` recognises frozen values per module instance and re-froze the whole
  program each time. The script now loads everything from one build.
- A mistake of mine: `pkill -f` with a pattern that matched my own shell. I killed the leftover process by PID.
  The deleted `03-bench-analyse.base-3ba86fc.out.txt` was wall-clock data from before the script changed.
- Results: no difference beyond the spread anywhere (report, tables 2 and 3).

## Step 5: acceptance

Baselines `no differences`; framework 252, stdlib 7, workbench 24 (+1 skipped), tensor 45, typed 186 (+2 skipped);
`tsc` clean; the site builds. No existing test changed.

## What I would check when reviewing this

- `analyseFrom`'s `finally`: the inner `try/finally` is what keeps `frame.active = false` when the synchronous
  driver returns through a yield in the outer `finally`.
- `runTransformation`'s `settled` flag: `catch` handles rejections (with the reason), `finally` handles
  abandonment; `claimsChecked` keeps the invalidation of the candidate's analyses where `applyPass` has it.
- That the asynchronous callers' behaviour differs only in microtask turns (report, limit 2).
