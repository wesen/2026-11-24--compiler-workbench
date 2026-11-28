---
Title: 'F39: the evidence, the cause and the alternatives'
Ticket: IRWB-054
Status: active
Topics:
    - compiler
    - ir
    - tensor
    - gpu
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://tools/cuda-remote.mjs
      Note: the runner, where the fix is
    - Path: repo://src/tensor/cuda-contract.ts
      Note: the lowering check that reported accepted false
    - Path: repo://src/tensor/cuda-runtime.ts
      Note: one job per mode, three ssh steps each
    - Path: repo://tests/tensor/schedule-gpu.test.mjs
      Note: the test that failed once in four runs
ExternalSources: []
Summary: 'F39 is not a race in the tiled contraction: sshd on the GPU machine drops connections past MaxStartups, and the runner reported the dropped job as a rejection. Fix: retry the job, never retry a failed command.'
LastUpdated: 2026-11-27T23:00:05.614031139-05:00
WhatFor: ""
WhenToUse: ""
---

# F39: the evidence, the cause and the alternatives

## Executive Summary

`tests/tensor/schedule-gpu.test.mjs:35` failed once in four runs of the GPU suite, on the lowering check of the
`batched` contraction. The suspicion was a race inside the emitted CUDA kernel, which would undercut every exactness
claim the lowering makes. It is not: the kernel is deterministic and race-free, and no case ever disagreed with the
interpreter. The failure came from outside the kernel — sshd on the GPU machine accepts ten unauthenticated
connections at a time (`MaxStartups 10:30:100`, the OpenSSH default) and drops the rest, and a GPU test suite holds
far more than ten at a time. Each job in `tools/cuda-remote.mjs` opens three connections (copy in, run, copy back),
so about half of the checks in a drop window lose one of their three connections, and `checkCudaLowering` reports any
failure of the evidence as `accepted: false`.

The fix is in the runner: a step whose *connection* was dropped is repeated as a whole job in a fresh remote
directory, up to six attempts with a jittered exponential backoff; a step whose *command* failed (a compile, the
program itself) is still reported at once. Under the same concurrency that made every job fail before, no job fails
now: 288 of 288 failed before, 0 of 288 after, with 339 dropped connections absorbed.

## Problem Statement

The claim under test — the tiled CUDA lowering computes the current revision's f32 meaning bit for bit — is only
worth what the harness that checks it is worth. A result that changes between runs of the same kernel on the same
input can mean three things: a race in the kernel (missing barrier, shared-memory reuse, an out-of-bounds tail), a
transport corruption between the checker and the GPU machine, or a non-deterministic checker. The first would make
the exactness claim false; the other two make the *evidence* unreliable while leaving the claim untested.

Within F39 the domain is fixed and narrow: the `batched` contraction `t[b,i,j] = sum(k) a[b,i,k] * b[b,k,j]` lowered by
`emitSchedule` in its four variants (plain and three tiled), checked by `checkLowering` on the ten shape assignments and
four value streams `cudaCases` generates, against the interpreter at f32. The GPU is a single remote machine reached
through `tools/cuda-remote.mjs`.

## Proposed Solution

`tools/cuda-remote.mjs` gains one distinction and one loop:

- **Dropped connection vs failed command.** A failed ssh step whose stderr matches an ssh connection error
  (`kex_exchange_identification`, `Connection closed`, `Connection reset`, `Connection timed out`, `closed by remote
  host`, `client_loop`, …) or that exits 255 with no output is a `StrayConnection`; anything else (the compile exiting
  97, the program exiting non-zero, a short transfer that tar reported) stays a plain error.
- **Repeat the job, not the step.** A `StrayConnection` re-runs the whole job in a fresh
  `~/irwb-cuda/run/<uuid>` directory, so a half-written request, a stale binary link or a partially fetched result
  from the failed attempt cannot be mistaken for the retry's. Six attempts, delays 250, 500, 1000, 2000, 4000 ms,
  each ±25 % jitter: the sshd throttling bursts in the journal last up to 11 s but are probabilistic, so a handful of
  spread-out attempts is enough, and the delay is bounded so a genuinely unreachable machine still fails in ~8 s.
- **Cleanup is retried too** (three attempts), because a cleanup connection is dropped like any other; the success
  path still removes the directory in the same connection that fetches the results, so a passing job pays nothing.

Nothing in `src/` changes: the CUDA source, the schedule IR, the checker and the baselines are untouched.

## Design Decisions

**Retry at the job, not at the ssh step.** Retrying only the failed step would have to reason about what the failed
step may have half-done: a partially uploaded tree, a `prog` link into the cache, an `out/results.bin` from the
previous attempt, and — with `--timed` — an orphan holding `~/irwb-cuda/.gpu.lock`. Restarting the job in a fresh
directory makes every one of those questions disappear; the only cost is re-sending the request (a few kilobytes for
the Tix checks).

**The cache means a retry does not recompile.** The build key is a hash of the build files, so the retried job links
the binary the first attempt (or another process) already compiled. Measured: probe 07 sends 288 jobs per side through
the same build, and the whole A/B run takes under two minutes.

**Backoff, because the drop is a burst.** sshd throttles while surplus connections keep arriving and stops once the
queue drains. Fixed-delay retries inside a burst would mostly be dropped again; the doubling delay is what gets past
it. The cap at 4 s and the six attempts are a budget of ~8 s, which is the order of the longest burst seen in the
journal (11 s, 125 connections dropped) and keeps a broken host failing promptly.

**Which failures are retried is decided by the ssh layer, not by the caller.** The runner is used by every GPU test
and by the lowering checks; making the classification there means no caller has to know about sshd, and no check
becomes weaker: a job that fails for a real reason still fails on its first attempt with its own stderr.

## Alternatives Considered

**A. Fix the kernel race that was suspected.** Rejected on evidence, not on taste: `compute-sanitizer --tool
racecheck` reports 0 hazards, `memcheck`, `synccheck` and `initcheck` 0 errors on all four variants (including tails
on every tile axis, a whole tile, a single row and an empty reduction), and the same case repeated 200 times per
variant in one process returned one bit pattern, equal to the interpreter's (probe 02). There was nothing to fix.

**B. Multiplex all ssh traffic over one connection (`ControlMaster`/`ControlPath`/`ControlPersist`).** This is the
textbook answer to a `MaxStartups` limit and it cuts the handshakes by ~3x, but `MaxSessions 10` then limits
*concurrent channels on that connection*, so a 32-job burst would hit a second server limit; a shared socket also
needs stale-socket handling and cross-process creation races. It treats the limit rather than the failure. Retry is
simpler and does not depend on sshd's configuration staying what it is.

**C. Serialise the four forced-variant jobs inside one check** (`Promise.all` in `cuda-contract.ts`'s `decide`).
Cheap to try, and it would cut peak concurrency fourfold, but it makes every lowering check four times slower — and
the suite's concurrency comes from five test files, which this would not touch.

**D. Raise `MaxStartups` on the GPU machine.** Needs root there and changes a shared machine's policy for one
repository's test suite; also out of the worktree.

**E. A cross-process semaphore in the runner capping live ssh sessions.** Would reduce the drops rather than
tolerate them, but it is hand-rolled inter-process locking in a tool whose whole job is one ssh round trip, and it
still leaves the burst from other users' sessions. Listed under Later if drops ever exceed the retry budget.

## Implementation Plan

Done in this session; see the report for the measurements.

1. Probes in `scripts/`: the loop (03), the repeat test (02), the sanitizer run (04, 05), the old runner kept aside
   (06), the A/B (07, 08), the case-generation hash (09).
2. The retry, transport classification and cleanup retry in `tools/cuda-remote.mjs`.
3. Acceptance: the loop at 2 952 checks with no failure, the A/B, the GPU suite, the baselines, the other suites.

## Open Questions

- Should `checkCudaLowering` distinguish "the check could not run" from "the check rejected the lowering"? Today both
  are `{accepted: false, reason}`, so a test asserting only `accepted` cannot tell them apart; that conflation is what
  made F39 look like a race in the first place. Left alone because the verdict's `reason` carries the distinction and
  `src/tensor/cuda-contract.ts` is shared with steps that are changing now.

## References

- `ttmp/2026/11/27/IRWB-033-D--a-schedule-ir-and-exact-tiled-contractions-through-it/` — the lowering and its checks.
- `ttmp/2026/11/26/IRWB-022-I--lowering-tix-to-cuda-with-checked-execution-on-the-gpu-machine/` — the runner.
- OpenSSH `sshd_config(5)`, `MaxStartups` and `MaxSessions`.
- `reference/01-implementation-diary.md`, `reference/02-report-f39-the-intermittent-gpu-rejection.md`.
