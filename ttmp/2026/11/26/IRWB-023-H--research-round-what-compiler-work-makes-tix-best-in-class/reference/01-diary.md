---
Title: IRWB-023-H research diary
Ticket: IRWB-023-H
Status: active
Topics:
    - compiler
    - verification
    - gpu
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological research diary for the best-in-class Tix compiler round.
LastUpdated: 2026-11-26T00:00:00Z
---

# IRWB-023-H diary

## 1. Orientation and ticket setup (2026-11-26)

The authored request (verbatim, first appearance): "Your ticket is IRWB-023-H. This is a research round: design and experiment, no changes to the product code. The question: What compiler work would make Tix best in class? 'Best in class' is yours to define and defend. ... This round measures ingenuity, creativity and scientific depth. What scores well: ideas that exploit what is specific to Tix: an exactly specified f32 meaning, index notation, every transformation a checked pass in the v6 framework, and a GPU available for experiments; a familiar technique, when you find something new to say about it here; claims tested by experiments you design and run, including the ones that refute your idea."

I read the Stage 1 (IRWB-020-B) design and report and the Stage 2 (IRWB-022-I) design and report, then skimmed `src/tensor/*.ts` (model, evaluator, passes, CUDA emitter) and the framework differential contract. Key facts I take forward:

- The f32 meaning is exactly specified: every arithmetic op, literal, shape value and fold step rounds with `Math.fround`; sums start at +0, maxima at -Infinity; folds are lexicographic, first binder outermost. The CUDA emitter reproduces these rounding sites with explicit `__f*_rn` intrinsics and double transcendentals, and the coordinator measured bit-identity with the f32 meaning for all 2^32 f32 exp/log/tanh inputs.
- The two existing passes: `inline` (exact gate) and `split-sum` (tolerance gate, budget `2e-6 + 2e-5*|r|`, checked against the f64 interpreter on sampled cases with at most 4096 elements per tensor).
- Naive CUDA: one kernel per statement, one thread per output element. GB10 timings (coordinator): matmul 512^3 0.197 ms vs cuBLAS 0.0329 ms; streaming 244 GB/s; softmax 0.785 ms; layernorm 0.563 ms; attention 1.81 ms; mlp 1.05 ms; conv2d 0.341 ms.
- CPU interpreter is very slow at full size (matmul 512^3: 781 s wall), so full-size checking is only possible with a GPU oracle.
- `checkLowering` sampling is limited to small shapes (<= 4096 elements/tensor), so deployment-shape behaviour is unchecked.

Created the ticket with docmgr. Plan: three research threads — (A) certified (static) error bounds for reduction rewrites vs the sampled gate; (B) meaning-preserving tiling/fusion chasing vendor performance under the exact gate; (C) a GPU f64 oracle so checks run at deployment shapes. Each gets an experiment.

`npm run build` succeeds on this worktree.
