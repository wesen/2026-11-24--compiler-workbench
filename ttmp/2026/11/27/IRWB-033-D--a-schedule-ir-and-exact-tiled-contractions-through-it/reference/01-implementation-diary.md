---
Title: Implementation diary
Ticket: IRWB-033-D
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:13:44.434236671-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Goal

<!-- What is the purpose of this reference document? -->

## Context

<!-- Provide background context needed to use this reference -->

## Quick Reference

<!-- Provide copy/paste-ready content, API contracts, or quick-look tables -->

## Usage Examples

<!-- Show how to use this reference in practice -->

## Related

<!-- Link to related documents or resources -->

## Step 1: reading, probe 01, design

Read stage 3b's and stage 3's designs and reports, stage 2's report, the framework READMEs (contracts, IR, strategy), `define-pass.ts` and `src/tensor/`. Asked a fetch agent for a summary of arXiv 2609.11356: its bit-equivalence classes are reduction-order trees per output, reconstructed from PTX; BLOCK_M/N re-tiling and pipeline depth preserve bits, split-K and attention key-block widths do not. That matches the rule used here: tile sizes in m and n, staging and binding are free, the order of r per output is fixed.

Probe 01 (`scripts/01-tile-probe/`, output `01-tile-probe.out.json`): eight hand-written exact tiled GEMM variants against one thread per output at the brief's contraction shapes. All bit-identical. No variant wins at every shape, so the tile is chosen at launch. Wrote and committed the design (40efedf).

## Step 2: framework legality hook, planFusion noBlock, the schedule IR

- `PassSpec.legal` and `PassError('illegal')` in `define-pass.ts`, run by both apply functions before `run`; a framework test in `tests/framework/native-pass-sync.test.mjs`.
- `planFusion(fn, { noBlock })`.
- `src/tensor/schedule.ts`: IR, adapter, passes, order analysis; `src/tensor/strategy.ts`.

**Problem: scheduling took 2 to 11 s per program.** A CPU profile showed the order analysis's simulation at the top (it walked the whole nest, 262,144 points for a 128 x 64 tile) and the framework's `immutable` and `fingerprint` next. Fixes: the simulation runs per dim (the accumulator is indexed by the output point, so other dims' loops cannot change one output's term sequence), results are memoized per variant, passes copy only the variants they edit (`structuredClone` had made the shared, frozen Tix function look new to `immutable`), and the adapter resolves entities from a map. The schedule of a function is memoized. Each pass application still costs some 10 ms in the framework (projection, diff, correspondence, hashing); a contraction kernel takes 53 steps.

## Step 3: printer and contract

`src/tensor/cuda-contraction.ts` prints a contraction kernel as `template <int V>` with one `if constexpr` branch per variant; `kernelWriter` gained a `reduced` hook (the accumulator stands in for the reduction in the epilogue). The contract runs every sample in every mode (each variant forced, alternating gate sides). All six corpus programs were accepted exact, fused and unfused (script 02).

## Step 4: printed kernels slower than the probe

Script 03 `--variants` at 512^3: printed variants 1 and 2 took 0.112 ms against the probe's 0.060 and 0.045. Probe 04 patched the printed source: `__launch_bounds__` per variant brought them to 0.064 and 0.050-0.058 (registers had been allocated for 1,024 threads), and putting n tiles on `blockIdx.x` to 0.062 and 0.044. Both adopted; the second is a `bind` choice in the strategy.

**Mistake:** I started a second script-03 run while the first was still running in the background, both writing the same output file, and rebuilt `dist/` in between. Killed both and reran into a fresh file.

## Step 5: the launch rule, final measurements

Script 03 `--variants` (`03-variants.out.jsonl`) timed each variant forced, five alternating calls each, at the brief's contraction shapes. It took about four minutes per shape (the GPU's timed lock is shared by about eleven agents), so I stopped it before 4096^3 and the odd shapes. Variant 2 lost to variant 3 at 64 and 144 terms (attention's score, conv2d) and won from 256 terms up, so the rule gained a term threshold (`minTerms`, a field of `select` entries, checked by the `select` pass and printed by the host rule).

**Mistake:** `schedule-gpu.test.mjs` compared a 640^3 product with the JS interpreter, which ran for over ten minutes; the test file's process timed out. Replaced by 200 x 130 x 300.

The base build for the `base` side of the final table is the branch's first commit, built into a scratch directory by script 06 (`06-build-base.sh`).

## Step 6: final runs and tests

- Script 06 (`06-final-corpus.out.jsonl`): the six corpus programs, fused, unfused and base, five alternating benchmark calls each. All identical; attention 0.750 → 0.184 ms, mlp 0.626 → 0.219, matmul 512^3 0.218 → 0.046, conv2d 0.167 → 0.100; softmax and layernorm unchanged (same source).
- `schedule-gpu.test.mjs`: 3 of 3 pass. The older GPU tests (`cuda-gpu`, `fusion-gpu`, `terms-gpu`, `gate-choice-gpu`): 19 of 20 passed in one run; the 20th failed with an ssh "Connection reset by peer" and passed when rerun alone.
- Non-GPU tests: `schedule`, `fusion`, `cuda`, `passes`, `language`, `corpus` (tensor) and `native-pass-sync` (framework) pass.
- The report is assembled by script 08 from its parts and script 07's tables.
