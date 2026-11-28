---
Title: 'Implementation diary'
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
      Note: the only file that changed
ExternalSources: []
Summary: 'Chronological record of F39: reproduction attempts, the sanitizer run, the journal evidence for MaxStartups, the retry, and the measurements before and after.'
LastUpdated: 2026-11-27T23:05:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

Ticket IRWB-054, worktree `v7-f39-ds-x-irwb-054`, one session. Times are local (EST), 2026-11-27.

**22:20 Ticket and environment.** `docmgr ticket create --ticket IRWB-054 ...`. Built `dist/` (`npm run build`, clean).
Read `tools/cuda-remote.mjs` first, as the brief says: each job uploads a directory, holds a compile lock on
`~/irwb-cuda/build/<hash>`, links the cached `prog`, runs it, fetches `out/`, and removes the directory — three ssh
connections per job. GPU machine is up: GB10, CUDA 13.0, nvcc at `/usr/local/cuda-13.0/bin/nvcc`.

**22:24 Dumped the lowering under suspicion** (`scripts/00-dump-batched.mjs`): `batched` gets four variants — plain,
128×64×8/8×4, 32×32×8/4×4, 32×32×8/2×2. Read `emitContraction` against the emitted source: the tile copies, then
`__syncthreads()`, then the reads, then `__syncthreads()` at the end of each `r0` step; the stores are per-thread
distinct. Nothing obviously racy, so the claim needed evidence rather than reading.

**22:26 Probe 01 — the loop.** `checkLowering(features,'batched')` once: 2.6 s, accepted (the remote compile dominates
the first job). Then 100 in a loop: 0 failures in 6.4 s (voice: 35–125 ms per check after the first, because each job
is 40 tiny cases × 4 forced modes). So the defect does not reproduce with one process at a time. Per the brief's own
hypothesis list, that points either at load (the suite) or at a rare race.

**22:28 Probe 02 — is the kernel deterministic?** Sent the same case 200 times in one request, per variant (the remote
program runs the kernel once per case), compared all 200 against each other and against `runTix`. 800 kernel runs, one
distinct bit pattern per variant, all equal to the interpreter. Not proof of race-freeness, but no 1-in-a-few-hundred
race either.

**22:31 Probe 05 — compute-sanitizer.** `scripts/04-race-probe.mjs` builds a job with tails on both tile axes and the
reduction axis (`3×130×70·70×90`), a whole tile, `257×129·1`, a single row, and an empty reduction; `scripts/05-sanitize.sh`
compiles it with `-lineinfo` and runs each variant under `racecheck`, `memcheck`, `synccheck` and `initcheck`:
0 hazards, 0 errors in all sixteen runs. The kernel is not the defect.

**22:34 Ran the real thing.** `node --test tests/tensor/*-gpu.test.mjs` (five files in parallel, as in the report that
started this ticket): 1 failure in 28 tests — `fusion-gpu.test.mjs`, `stencil`, `CUDA evidence unavailable: Connection
closed by 100.117.186.55 port 22`. A second run: 1 failure, `kex_exchange_identification`. This is the shape of F39: a
check reporting `accepted: false` for a reason that is not exactness at all.

**22:36 Probe 03 — the loop under the suite's concurrency.** Six workers, each running the `batched` check 12 times:
**35 of 72 checks failed (48.6 %)**, every one a transport failure, none a value disagreement. The failure text is
the runner's own (`ssh copy: Connection closed…`, `kex_exchange_identification…`). In the same window the GPU
machine's journal says `error: beginning MaxStartups throttling`, `drop connection #10 … past MaxStartups`, and
`exited MaxStartups throttling after 00:00:11, 125 connections dropped`. Cause found: sshd's default
`MaxStartups 10:30:100` (and `MaxSessions 10`) against a client that opens three connections per job and 4–32 jobs at
a time.

**22:47 The fix** in `tools/cuda-remote.mjs`: classify a failed ssh step as a dropped connection (ssh connection error
text, or exit 255 with nothing to say) or as a failed command; repeat the *whole job* in a fresh remote directory on a
drop, six attempts, 250 ms doubling to 4 s with ±25 % jitter; never retry a compile error (the job script's `exit 97`)
or the program's own exit; retry cleanup up to three times. Kept `git show 26bea81:tools/cuda-remote.mjs` as
`scripts/06-runner-before-fix.mjs` so both runners can be measured against each other later.

**22:48 Probe 03 again, same command: 0 of 72 failed** (and 11.4 s instead of 28 s, because a failed job is slower
than a retried one). Then 6×40 → 0/240; 8×100 → 0/800, twice; 6×40 → 0/240, and 8×100 again on the final commit → 0/800. 2 952 checks, no failure. The retry
counter stayed at 0 in these runs because `src/tensor/cuda-runtime.ts` drops a *successful* job's stderr (only a
failing `execFile` keeps it) — the runner's retry note never reaches the probe. Recorded, and the A/B below counts
retries by spawning the runner itself.

**22:52 Probe 07 — A/B under forced concurrency.** Eight workers × six simultaneous jobs per round, the real
`batched` job, sides alternating per round: before the fix **144 of 144 jobs failed**, after **0 of 144** with 202
dropped connections absorbed; then six rounds — **288 of 288 vs 0 of 288**, 339 drops absorbed. Cleanup leaving
nothing behind: `~/irwb-cuda/run` was 134 directories before and after 240 further checks.

**23:00 Probe 09 — the case generator.** Hashed `cudaCases` for `batched` (40 samples: shapes, stream, inputs,
interpreter reference) three times from fresh module state: identical, `125b70cac91e6262`. The counterexample cannot
come from the generator.

**23:02 Acceptance.** `tests/tensor/*-gpu.test.mjs` run twice: 23 tests, 0 failures each. Baselines
(`02-baselines.mjs check`, coordinator's file, read-only): `no differences from …/various/baselines/main.json` — the
fix changes no emitted CUDA, no RV32 image and no edit record. Suites `tests/typed`, `tests/framework`,
`tests/workbench`, `tests/stdlib`, `tests/tensor/*.test.mjs` without the GPU files: 549 tests, 546 pass, 3 skipped
(pre-existing), 0 fail. `npm run check` clean.

**23:14 Final commit verified.** After tidying the transport classifier and the cleanup retry: 800 more checks
(8×100, 0 failures) and the GPU suite again (23 tests, 0 failures, 94 s). 2 952 checks after the fix in total.

**23:06 Report and design doc written**; one line left open on purpose (`checkCudaLowering` conflating "could not
check" with "rejected") and listed under Later, because `src/tensor/cuda-contract.ts` belongs to steps in flight.
