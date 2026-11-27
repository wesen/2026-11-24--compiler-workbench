---
Title: Tasks
Ticket: IRWB-030-F
Status: active
Topics:
    - tensor
    - gpu
DocType: tasks
Intent: working
LastUpdated: 2026-11-27T02:10:00-05:00
---

# Tasks

- [ ] 1. Design committed (design/01-fusion-that-is-never-slower.md)
- [ ] 2. Parallel-term staging in the plan (fusion.ts) and the emitter (cuda-source.ts), template <bool Shared, bool Staged>
- [ ] 3. Launch-shape cost gate (gatedPlan) wired into runTixCuda; cudaSource keeps the ungated plan
- [ ] 4. CPU tests: staging decisions and refusals; stage-2 digests unchanged; corpus plans unchanged
- [ ] 5. GPU tests: staged/serial/scratch paths exact vs interpreter; gated candidate exact; inside variants
- [ ] 6. Scripts: gate calibration sweeps, staging probes, benchmark tables, contract cost
- [ ] 7. Final report and diary
