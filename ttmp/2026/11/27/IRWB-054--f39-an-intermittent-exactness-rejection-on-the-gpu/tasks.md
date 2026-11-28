# Tasks

## TODO

- [x] Read `tools/cuda-remote.mjs`, dump the `batched` lowering's four variants, read the emitted kernel
- [x] Probe 01: run the `batched` check in a loop (100 single-process runs: no failure)
- [x] Probe 02: 200 repeats of one case per variant in one request (one bit pattern, equal to the interpreter)
- [x] Probe 04/05: `compute-sanitizer` racecheck, memcheck, synccheck, initcheck on all four variants: clean
- [x] Probe 03: reproduce under the suite's concurrency (35 of 72 checks failed, all transport)
- [x] Read the GPU machine's sshd journal: `MaxStartups` throttling drops, counted
- [x] Probe 09: the check's case generation is deterministic
- [x] Fix `tools/cuda-remote.mjs`: classify dropped connections, retry the whole job, retry cleanup
- [x] Probe 06/07/08: A/B the two runners under forced concurrency (288/288 failed before, 0/288 after, 339 drops absorbed)
- [x] Probe 03 after the fix: 2 152 checks, no failure
- [x] Design doc, diary, report
- [ ] Later: `checkCudaLowering` should distinguish "evidence unavailable" from "rejected"
- [ ] Later: if drops exceed the retry budget, multiplex the three ssh steps over one connection (`MaxSessions 10` caps channels)
