# Changelog

## 2026-11-27

- Initial workspace created
- 22:24 Dumped the `batched` lowering (`scripts/00-dump-batched.mjs`): plain plus three tiled variants, barriers where
  they should be
- 22:26 Probe 01: 100 single-process checks, no failure — the defect needs the suite's concurrency
- 22:28 Probe 02: 200 repeats of one case per variant, one bit pattern, equal to the interpreter
- 22:31 Probes 04/05: `racecheck`, `memcheck`, `synccheck`, `initcheck` clean on all four variants over tails, a whole
  tile, a single row and an empty reduction
- 22:34 `node --test tests/tensor/*-gpu.test.mjs` failed once per run, both times on an ssh drop
- 22:36 Probe 03 reproduced F39: 35 of 72 checks failed (48.6 %), all `Connection closed`/`kex_exchange_identification`
- 22:40 sshd journal on the GPU machine: `MaxStartups` throttling, `drop connection #10`, 125 connections dropped in
  11 s. Cause identified as the transport, not the kernel
- 22:47 Fixed `tools/cuda-remote.mjs`: dropped connection vs failed command, whole-job retry in a fresh directory, six
  attempts with jittered backoff; cleanup retried
- 22:48 Probe 03 after the fix: 0 of 72, then 0 of 2 952 checks
- 22:52 Probe 07 A/B: 288 of 288 jobs failed before, 0 of 288 after, 339 drops absorbed
- 23:00 Probe 09: the case generator is deterministic
- 23:02 Acceptance: GPU suite 23/23 twice, baselines `no differences`, 549 other tests 0 failures, `npm run check`
  clean
- 23:06 Design doc, diary and report written
- 23:14 Final commit verified: 800 more checks (0 failures), GPU suite 23/23 again, 2 952 checks after the fix
