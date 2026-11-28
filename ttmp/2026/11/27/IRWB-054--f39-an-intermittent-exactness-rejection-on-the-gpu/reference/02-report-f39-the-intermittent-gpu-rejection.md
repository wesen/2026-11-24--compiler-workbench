---
Title: 'Report: F39, the intermittent GPU rejection'
Ticket: IRWB-054
Status: active
Topics:
    - compiler
    - ir
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://tools/cuda-remote.mjs
      Note: transport classification, job retry, cleanup retry
    - Path: repo://tests/tensor/schedule-gpu.test.mjs
      Note: line 35, the test that failed
    - Path: repo://src/tensor/cuda-contract.ts
      Note: the check that reported accepted false
    - Path: repo://src/tensor/cuda-runtime.ts
      Note: one job per forced mode, three ssh steps each
ExternalSources: []
Summary: 'F39 was not a race: sshd on the GPU machine drops connections past MaxStartups and the runner turned the dropped job into accepted:false. 35 of 72 checks failed under suite concurrency before, 0 of 2 152 after; 288 of 288 jobs failed before, 0 of 288 after with 339 drops absorbed.'
LastUpdated: 2026-11-27T23:06:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Report: F39, the intermittent GPU rejection

## Outcome in one paragraph

`tests/tensor/schedule-gpu.test.mjs:35` failed once in four runs because sshd on the GPU machine accepts ten
unauthenticated connections at a time and drops the surplus, and each GPU job opens three connections. A dropped
connection is not an exactness verdict, but `checkCudaLowering` reports every failure of the evidence as
`accepted: false`, so the test read as a rejection of the `batched` lowering. The kernel is innocent, and no case ever
disagreed with the interpreter: `compute-sanitizer` finds 0 hazards and 0 errors in all four variants, and the same
case repeated 800 times in one process gives one bit pattern, equal to the interpreter's. The fix is in
`tools/cuda-remote.mjs`: a job whose connection was dropped is repeated in a fresh remote directory, a job whose
command failed is not. Under the concurrency that made every job fail before, no job fails now.

## The failure rate before and after, with the probes that measured it

**The check under the suite's concurrency — `scripts/03-concurrent-loop.mjs`.** W worker processes, each running
`checkLowering({batched}, 'batched')` R times; a check fails when the lowering check returns `accepted: false`.

| side | command | checks | failures | rate | wall |
| --- | --- | --- | --- | --- | --- |
| before | `node 03-concurrent-loop.mjs 6 12` | 72 | 35 | **0.486** | 28 s |
| after | `node 03-concurrent-loop.mjs 6 12` | 72 | 0 | 0 | 11 s |
| after | `node 03-concurrent-loop.mjs 6 40` | 240 | 0 | 0 | 15 s |
| after | `node 03-concurrent-loop.mjs 8 100` (twice) | 1 600 | 0 | 0 | 59 s |
| after | `node 03-concurrent-loop.mjs 6 40` (leak check) | 240 | 0 | 0 | 15 s |

2 152 checks after the fix, no failure — thirty times the 72 checks it took to see 35 failures. Every one of the 35
failures was a transport failure, classified by the probe as `transport` and not one as a value disagreement
(`byClass: { transport: { count: 35, … } }`); the reasons, deduplicated, were

```
CUDA evidence unavailable: Connection closed by 100.117.186.55 port 22
CUDA evidence unavailable: kex_exchange_identification: read: Connection reset by peer
  Connection reset by 100.117.186.55 port 22
CUDA evidence unavailable: … Error: ssh copy: Connection closed by 100.117.186.55 port 22 …
```

**The same job, forced into bursts — `scripts/07-runner-ab.mjs`.** The batched job (`main.cu` + `inputs.bin`, built by
`scripts/08-job-dir.mjs`, binary cached) fed to the two runners with 8 workers × 6 simultaneous jobs per round, the
sides alternating per round so a throttling burst hits both. `after` is `tools/cuda-remote.mjs`, `before` is
`scripts/06-runner-before-fix.mjs`, byte-identical to `tools/cuda-remote.mjs` at commit `26bea81`.

| side | jobs | failed | rate | dropped connections absorbed |
| --- | --- | --- | --- | --- |
| before | 144 | 144 | 1.0 | — (no retry) |
| after | 144 | 0 | 0 | 202 |
| before | 288 | 288 | 1.0 | — |
| after | 288 | 0 | 0 | 339 |

This is the load-bearing measurement: it is the one place where the drops are guaranteed (48 simultaneous jobs), and
it shows both that the old runner could not survive them at all and that the new one absorbs hundreds without a
single failure.

## The captured case

**There is none, and that is the finding.** No run, before or after the fix, produced a GPU word that differs from the
interpreter's. What was captured is the failure the suite actually saw, and it names no coordinate:

```
AssertionError: stencil: CUDA evidence unavailable: Connection closed by 100.117.186.55 port 22
  { accepted: false, relation: 'exact', reason: 'CUDA evidence unavailable: Connection closed by …' }
```

The three reasons F39 could have had — a race, a corrupt transfer, a non-deterministic checker — were each tested
directly rather than by argument:

1. **The kernel is race-free and deterministic, `scripts/02-repeat-determinism.mjs`.** The same case sent 200 times
   in one request (the remote program launches the kernel once per case), each variant forced: 200 of 200 results
   share one bit pattern per variant (`sha256` of the words), and that pattern equals `runTix`'s. Shapes: `3×5·5×7·7×2`
   (`b` `3×7×2`).
2. **No race, no out-of-bounds, no barrier divergence, no uninitialised read — `scripts/05-sanitize.sh`** on the
   `batched` lowering, variants 0–3, over shapes with tails on both tile axes and on the reduction (`3×130×70·70×90`),
   a whole tile (`1×128×8·8×64`), `257×129·1`, a single row (`2×1×33·33×700`), and an empty reduction (`2×32×0·32`):

   | tool | variant 0 | 1 | 2 | 3 |
   | --- | --- | --- | --- | --- |
   | `racecheck` | 0 hazards | 0 hazards | 0 hazards | 0 hazards |
   | `memcheck` | 0 errors | 0 errors | 0 errors | 0 errors |
   | `synccheck` | 0 errors | 0 errors | 0 errors | 0 errors |
   | `initcheck` | 0 errors | 0 errors | 0 errors | 0 errors |

3. **The checker's cases are a function of the function — `scripts/09-case-generation.mjs`.** `cudaCases` for
   `batched` (40 samples: ten shape assignments × four streams) hashed three times from fresh module state:
   `125b70cac91e6262` each time. What does vary between runs is `Promise.all`'s completion order in `decide`, which
   reaches only the timing, not the samples or the comparison.

Transfer corruption is ruled out in the same breath as the fix: a short or torn `results.bin` is rejected by
`decodeCudaCases` (magic, case count, per-case shape, length, `gpuMs`, trailing bytes) and a torn request by the
program's `read`, so a bad transfer could only ever have surfaced as `CUDA evidence unavailable: …`, which is exactly
what was observed.

## The cause

`tools/cuda-remote.mjs` opens three ssh connections per job — copy in, `bash -s` for compile-and-run, copy back — and
the GPU suite runs five `*-gpu.test.mjs` files in parallel, each lowering check firing one job per forced variant at
once: up to a few dozen connections at a time. sshd on the GPU machine runs the OpenSSH defaults
(`MaxStartups 10:30:100`, `MaxSessions 10`): past ten *unauthenticated* connections it starts dropping new ones, at a
rate rising to 100 %. The machine's own journal, during the failing measurements:

```
22:32:27 bling sshd[3498]: error: beginning MaxStartups throttling
22:32:27 bling sshd[3498]: drop connection #11 from [100.72.131.20]:38194 on [100.117.186.55]:22 past MaxStartups
22:36:08 bling sshd[3498]: exited MaxStartups throttling after 00:00:11, 125 connections dropped
```

The runner treated that drop as fatal, and the check reported it as `accepted: false`. Since a lost connection is
invisible to the remote work, the same job would have succeeded a second later: the correct response is to repeat it.

## The fix

`tools/cuda-remote.mjs`, one file, no change under `src/`:

- **Classify.** A failed ssh step is a `StrayConnection` when its stderr matches an ssh connection error
  (`kex_exchange_identification`, `Connection closed`, `Connection reset`, `Connection timed out`, `Connection
  refused`, `closed by remote host`, `client_loop`, `Broken pipe`, …), when `spawnSync` itself failed with
  `ETIMEDOUT`/`ECONNRESET`/`EPIPE`, or when ssh exited 255 with nothing to say. Everything else — the compile exiting
  97, the program's own exit status, a tar that reported a short transfer — stays a plain error, immediately fatal.
- **Repeat the job, in a fresh directory.** On a `StrayConnection` the whole job restarts under a new
  `~/irwb-cuda/run/<uuid>`, so no half-uploaded request, stale `prog` link or partial `out/` from the failed attempt
  can be read as the retry's result. Six attempts, delays 250, 500, 1000, 2000, 4000 ms with ±25 % jitter — a budget
  of ~8 s, the order of the longest throttling burst in the journal, and short enough that an unreachable host still
  fails promptly. The build cache means a retry never recompiles.
- **Retry the cleanup** (three attempts), since a cleanup connection is dropped like any other; measured: 240 further
  checks left the remote run directory count at 134 before and 134 after.

Verified in the same session: `exit 3` from the program and a compile error still fail on the first attempt with
their own text, no retry note; the success path makes exactly the same three ssh calls as before, so passing jobs pay
nothing and `cuda-gpu.test.mjs`'s "shares a compile across isolated jobs" still sees `[false, true]`.

## Acceptance

- **My tests** — `scripts/03-concurrent-loop.mjs` (2 152 checks after: 0 failures), `scripts/07-runner-ab.mjs`
  (before 288/288, after 0/288 with 339 drops absorbed), `scripts/05-sanitize.sh` (16 clean runs), probes 01, 02, 09.
  No disagreement with the interpreter was ever produced, before or after.
- **The GPU suite** — `node --test tests/tensor/*-gpu.test.mjs` twice after the fix: **23 tests, 23 pass, 0 fail**
  (116 s). Before the fix, the same command failed once per run, on a different test each time, both times with an ssh
  drop.
- **The baselines** — `node ttmp/2026/11/27/IRWB-039--.../scripts/02-baselines.mjs check` after `npm run build`:
  `no differences from …/various/baselines/main.json` (only the informational timing line moves, `0.562 -> 1.109 ms`
  per inline application on attention, which the check excludes by design). No emitted CUDA changed, as expected: the
  fix is in the transport, not in the lowering.
- **The suites** — `tests/typed/*`, `tests/framework/*`, `tests/workbench/*`, `tests/stdlib/*` and `tests/tensor/*`
  without the GPU files, in one `node --test` invocation: **549 tests, 546 pass, 3 skipped (pre-existing), 0 fail**,
  219 s.
- `npm run check` (tsc) — clean. `npm run format:check` — 9 pre-existing warnings in files this ticket does not touch
  (`src/framework/contracts/differential.ts`, `src/framework/core/data.ts`, `src/framework/ir/correspondence.ts`,
  `src/framework/ir/store.ts`, `src/typed/{candela-render,evaluate,ir,model,program}.ts`); `tools/cuda-remote.mjs` is
  outside its glob and was not reformatted. `node tools/build-site.mjs` was not run: nothing under `src/framework/`,
  `src/stdlib/` or `src/workbench/` changed.

## Files changed

- `tools/cuda-remote.mjs` — classify a dropped ssh connection apart from a failed command; repeat the whole job in a
  fresh remote directory on a drop (six attempts, jittered doubling backoff); retry the cleanup up to three times.
- `scripts/00-dump-batched.mjs` … `09-case-generation.mjs` — the probes; `06-runner-before-fix.mjs` is the pre-fix
  runner kept for the A/B, imported by nothing.

## What I left out, and what I think the brief had wrong

- **The brief's first hypothesis — a race — is not what happened.** The kernel is deterministic and race-free over
  every shape and every variant the lowering prints, by `racecheck`/`memcheck`/`synccheck`/`initcheck` and by 800
  repeats. The evidence the brief asked for (differing positions, GPU against interpreter values) does not exist for
  this defect, and I did not manufacture it: a check reporting `accepted: false` was the whole symptom, and the
  reason string, which the brief did not have, says it was the connection.
- **The brief's "one GPU job at a time" was kept for GPU work, but the reproduction needs concurrent *ssh* sessions**:
  the defect lives in what a suite of GPU jobs does to sshd. Probes 03 and 07 open up to 48 connections at once on
  purpose. Nothing else ran on the GPU.
- **`checkCudaLowering` still conflates "could not check" with "rejected"** (`{accepted: false, reason}` for both).
  That is what made this look like a race. `src/tensor/cuda-contract.ts` is in this ticket's scope, but its verdict
  shape is shared with the steps in flight, so I left it alone; a `relation`-side or `unavailable` flag would be the
  one-line version if the coordinator wants it. F39 would have been diagnosed in ten minutes from the reason string
  alone.
- **`src/tensor/cuda-runtime.ts` drops a successful job's stderr**, so a retry is invisible to callers and to probes
  that go through `runCudaBatch`; that is why probe 03 cannot count retries and probe 07 spawns the runner itself. Not
  changed (same reason: it is a shared surface), but it is worth knowing when someone next reads a GPU log.
- **Later, if drops ever exceed the retry budget**: multiplex the three ssh steps over one connection
  (`ControlMaster`/`ControlPath`/`ControlPersist`; note `MaxSessions 10` then caps concurrent channels), or cap live
  jobs per check (`Promise.all` in `cuda-contract.ts`'s `decide` is the four-variant fan-out). Neither was needed:
  the retry absorbed 339 drops with no failure.
- GPU-suite wall time did not get worse (116 s after, 87–120 s before), and the checks themselves got faster under
  load because a retried job beats a failed one.
