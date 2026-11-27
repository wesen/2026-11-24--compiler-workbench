---
Title: Implementation diary
Ticket: IRWB-030-C
Status: active
Topics: [tensor, gpu, verification]
DocType: reference
Intent: long-term
---

# Implementation diary

## 1. Initial investigation

Read stage 3's design and report, then stage 2's design and report. The current planner fuses legal chains without a cost model; block row scalars execute serial reductions. The existing API already exposes benchmark timing. The brief supplied in the session is the authoritative request.

## 2. Parallel terms and verification

Added an emitter path for a top-level single-axis sum with division in a block-row scalar. Each thread writes independent terms, a barrier precedes the ordered thread-zero fold, and the existing buffer capacity and scratch choice cover the extra storage. Other reductions use the original code. `npm run build` and `node --test tests/tensor/fusion.test.mjs` passed.

The first GPU benchmark compile failed: nvcc rejected `std::max` in a kernel as a host-only function. Replaced the device expression with a sum of term-buffer lengths, also used by the host. `node --test tests/tensor/parallel-terms-gpu.test.mjs` passed, checking exact contract acceptance and dimensions 0, 1, 7, 129, and 1025. `node --test tests/tensor/fusion-gpu.test.mjs` passed all five tests. The full-size benchmark script and raw results are in scripts/; fused and unfused digests match.

The profitability decision is not implemented. The current planner still fuses every legal group. Consequently this is an incomplete stage and does not establish the requested never-slower property. Measurements collected while other GPU tests ran can show larger variation than the nominal locked-run noise because untimed work is not locked.

## 3. Measurements and remaining work

Three benchmark calls per program are recorded in scripts/01-results-{a,b,c}.jsonl. The separate contract script observed a 3.681 s first check and 6.4 ms repeat. Concurrent untimed GPU tests may have affected the measurements, so the report explicitly qualifies them. The required fusion profitability rule remains open.
