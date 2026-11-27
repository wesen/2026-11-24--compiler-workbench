---
Title: Implementation diary
Ticket: IRWB-033-A
Status: active
Topics: [tensor, gpu, verification]
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Chronological design, implementation and GB10 measurement evidence for stage 6.
---

# Implementation diary

## 1. Design and baseline

I read the row-fusion stages first, then the stage 2 design and CUDA report. The emitter used the scalar Tix tree for all paths, so it already preserved several unusual cases such as split sums and staged expensive terms. The requested paper suggested treating order as a restriction on scheduling. Its static checker works at PTX or GCN level. The proposed check works at the schedule level and keeps a separate CUDA execution check. [Yang et al.](https://arxiv.org/html/2609.11356v1)

`docmgr ticket create-ticket` and `docmgr doc add` succeeded. `npm ci --offline` installed the lockfile's dependencies and `npm run build` passed with Node 24.18.0. The ordinary `git add` could not create the index lock because the sandbox mounted the linked Git worktree read-only. The escalated commit succeeded at `f0719b4`, before changing compiler code. Script 01 captured base CUDA and ran a matmul smoke test on GB10. The one untimed launch was 0.197248 ms.

## 2. Schedule passes and a row mapping experiment

The schedule seed imports the fusion groups. Recognition records output reuse directions and a rectangular reduction. Mapping adds shared and register tiles. I added a third argument to the synchronous native gate so the same check can inspect the exact v6 entity correspondence. A relational contract-manager probe initially failed TypeScript with TS2741 because the new correspondence omitted its required `evidence` field. Supplying the function and phase identity fixed the build. The checked seed now runs as a heterogeneous transformation, and the CUDA transaction can name the final schedule revision.

The first two standalone fused kernels matched the stage 3b CUDA output digest in five timed calls each. The initial guarded tile was 0.097408 ms for matmul and 0.125344 ms for convolution. An alternate in-row patch reused the output-invariant operand across four accumulators. Untimed corpus launches took 1.909 ms for attention and 1.385 ms for MLP. In script 01's first timed attention comparison it also failed the digest comparison and stopped with `Error: attention output differs for fused`. I discarded the in-row patch. The measurements of its latency are observations of the rejected implementation.

The layout probe used the same input for each variant and verified its common output hash. The medians were 0.088512 ms for the aligned 32×64 register tile, 0.098656 ms with bounds checks, 0.108800 ms for the smaller grid tile and 0.199136 ms for shared memory without a register patch. [Raw runs](../scripts/03-layout-probe.jsonl)

## 3. Tiled boundary phases

I tried keeping the ordered row computation as one phase and tiling its boundary contractions on either side of it. This uses kernel launches for cross-phase visibility, preserves the original row and per-statement branches, and keeps the phase dispatch in the same templated CUDA kernel definition. The smoke times were 0.350 ms for attention and 0.457 ms for MLP. I then required the exact checker to force this phase path in addition to both existing sides, since its usual small inputs would leave the phase selector off.

The CPU-only tensor suites passed 42 tests including stage 2 source digests, mock exact checking, and an invalid tile correspondence witness. Initial test expectation for convolution treated its batch axis as independent. Inspection showed the input image uses it but the filter does not, so it is correctly folded into the spatial reuse direction. The revised test asserts that classification.
