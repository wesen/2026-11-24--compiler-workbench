---
Title: Implementation diary
Ticket: IRWB-029-G
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/tensor/fusion.ts
      Note: The planner that decides groups and mappings
    - Path: repo://src/tensor/cuda-source.ts
      Note: Emission for both lowerings
ExternalSources: []
Summary: Chronological record of the fusion stage: probes, the emitter rewrite, the exactness and timing evidence, and every failure met on the way.
LastUpdated: 2026-11-26T23:55:00-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

Worktree `t3-ds-h-irwb-029-g`, base `f706115` (`main` as of IRWB-019's merge, without IRWB-019's own ticket).
Node 24.18.0, `tsc` into `dist/`, GB10 reached only through `tools/cuda-remote.mjs`.

## 1. Read the two earlier tickets and the code

The stage-2 report settles two things I depend on and did not have to re-derive: the lowering's relation is *exact*
(bit equality with the current revision's f32 meaning, NaN as a class, from IRWB-019 F17), and the emitter is
`src/tensor/cuda-source.ts` with one `__global__` per statement. Stage 2's design also records why it emitted
directly from the Tix IR rather than through a kernel IR: the IR already determines every loop and every address.

I read `src/framework/contracts/README.md`, `src/framework/ir/README.md`, `passes/define-pass.ts`,
`src/tensor/{model,parser,evaluate,ir,contract,cuda-contract,cuda-runtime,cuda-source,index}.ts` and the six corpus
programs. Two facts shaped the design:

- axis identities are *per statement* (the parser allocates `i0, i1, …` over the whole function), and a load's
  address tuple is expressed over the **consumer's** binders. So "which element of a producer does this consumer
  need" is a purely positional question about the load's affine forms; there is no name link to use.
- a statement's free axes and reduction axes are the only loops it has, so the meaning's order is the lexical order
  of a statement's reduction binders. Any mapping change has to leave those loops sequential.

## 2. Probe: can the framework express many statements becoming one kernel?

`scripts/01-correspondence-probe.mjs`. `makeCorrespondence` accepts a grouped entry:

```
source entities: e m s
grouped many-to-one entries: [{"from":["e","m","s"],"relation":"fused-into","to":["k0"]}]
```

so the IR layer can express it. What cannot: the lowering's output port. `src/tensor/cuda-contract.ts` builds its
artifact with `createArtifact` (not `createIRArtifact`), so there is no adapter and no entity universe on the target
side:

```
CUDA artifact keys: contentHash id kind revision schemaVersion value
CUDA artifact carries an adapter: false
kernels named by the CUDA artifact: none (its value is {fn, source}; the IR kind declares no entities)
```

Naming kernels in a correspondence is exactly the kernel-IR artifact the design rejects, so the lowering claims no
correspondence and is judged on its output instead. Two probe failures on the way, both adapter rules I had not
expected: entities need `attributes: {}`, and `createIRArtifact` refuses an IR without an adapter, so the second half
of the probe uses `createArtifact` as the real code does.

## 3. Probe: what does a fused row kernel cost, and does dynamic shared memory work on sm_121?

`scripts/02-shared-row-probe.mjs`. First version failed to compile: `uint64_t` undefined (no `<cstdint>`) and
`__uint_as_float` called from a host function (the row max helper needs `__device__`). Then, at the softmax size
(4096 × 1024), the hand-written fused kernel took **0.542 ms** against stage 2's 0.785 ms — 1.45×, not the 4.25×
the brief recalls. So I measured the parts. One row kernel, one part disabled at a time, 128 threads:

| variant | ms |
| --- | ---: |
| memory only (stage row, broadcast, write) | 0.110 |
| + the two sequential folds | 0.294 |
| + the exponential | 0.379 |
| everything | 0.458 |
| `y = 2x` stream kernel over the same 16 MB | 0.108 (311 GB/s here) |

and a thread/unroll sweep of the full kernel: 32 → 0.611, 64 → 0.552, 128 → 0.458, 256 → 0.558 (unroll 1);
unroll 4 gives 0.438 at 128 threads, unroll 8 nothing further.

Three conclusions, all recorded in the design and the emitter: the fused kernel is **not** memory-bound at this size;
the exact `exp` (CUDA double `exp`, rounded once — the relation forbids `expf`) costs about 0.27 ms and the two
order-preserving folds about 0.18 ms; and 128 threads per block is the best of the four sizes because more blocks stay
resident while one thread folds a row. Unrolling buys 4% for a more complicated emitter, so the emitter keeps stage
2's plain fold loops.

## 4. Design committed

`design-doc/01-checked-fusion-of-tix-statements-into-fewer-kernels.md`, commit `3b11f89`: where fusion lives (a
planner over the Tix IR that the emitter consumes — not a pass, not a kernel-IR artifact), the two policies and their
legality rules, the refused shapes with reasons, the emission sketch, the API, and the verification plan.

## 5. Planner and emitter

`src/tensor/fusion.ts` (new) computes `Kernel[]` from `Fn`: a flat kernel is one anchor plus its inlined producers, a
row kernel is a block-axis list, shared slots and an ordered phase list. `src/tensor/cuda-source.ts` was rewritten
around a `Body` class that emits scalar trees with a pluggable load resolver, so the flat kernel (stage 2's text plus
tree expansion at load sites) and the row kernel (stages, thread-0 folds, strided vector phases, barriers) share one
tree walker.

First build error: `Env.subs` typed `ReadonlyMap` while `substitute` takes a `Map`; changed the type. Kernel counts
came out right on the first build (1/1/1/1/1/1 fused, 1/4/4/6/3/1 unfused).

### The stage-2 text must not move

`fuse: false` has to be stage 2's lowering unchanged, so I pinned it by experiment: stash the new emitter, build the
old one, dump `cudaSource` for the six corpus programs to `/tmp/old-sources.json`, restore, rebuild, diff. Fused text
differed from stage 2 even for single-statement programs, which it must not:

```
97 "  result[thread] = v0;" => "}"
98 "}" => "result[thread] = v0;"
```

A stray closing brace closed the kernel before its store, leaving `result[thread] = v0;` outside the function. Cause:
my reduce case closed two braces per binder after I had moved the loop header from `open()` to a plain `line()`. After
the fix, `fuse: false` is byte-identical to stage 2 for all six programs (digests recorded in
`tests/tensor/fusion.test.mjs`), and the fused text is byte-identical to stage 2 for `matmul` and `conv2d`, which have
one statement each.

### The first GPU compile of a fused kernel failed

```
main.cu(95): error: identifier "t0" is undefined
      smem[so0 + stage0] = t0[((r0) * (d1) + (stage0))];
```

The stage phase reads the tensor from global memory, but my read set was computed from the compute phases only. Fixed
by adding each staged tensor to the kernel's read parameters.

## 6. Full-size equivalence, then the contract

`scripts/03-full-size-equivalence.mjs` (single launches, not a timing report): fused and stage-2 outputs are
**word-identical** on all six programs at the brief's sizes, with the kernel counts above. First observation of the
per-program difference: matmul 0.198 → 0.195, softmax 0.784 → 0.463, layernorm 0.468 → 0.183, attention 1.080 →
0.872, mlp 1.066 → 0.982, conv2d 0.182 → 0.181 ms.

`scripts/04-check-lowering.mjs` runs the contract: 24 verdicts (6 programs × {original, optimized} × {fused,
unfused}), **all accepted, all exact**, 2.2–3.5 s per check for a fresh verdict and 1 ms when the subject is already
cached (conv2d's optimized revision is identical, so its fused verdict replays).

The optimizer's revisions and the fused lowering interact as intended: `optimizeTix(program, ['inline','split-sum'])`
changes the statements that fusion then groups (softmax's `s[i]` becomes a nested block/tail sum), and the fused
lowering of the optimized revision is still exact — the nested fold is a scalar phase with the same loops, and staged
reads take the composed index `4*block + lane`.

## 7. Tests

- `tests/tensor/cuda.test.mjs`: the two-kernel assertion describes stage 2, so it now asks for `{fuse:false}`, and the
  test also asserts the fused text (one kernel, no global read of the intermediate). The mutation tests are unchanged:
  their programs have one statement each, so both lowerings emit the same text.
- `tests/tensor/fusion.test.mjs` (new, no GPU): corpus kernel counts, the stage-2 digests, inlining and staging
  decisions, and four refusals. Three of my first attempts failed, and each taught me something:
  - a refused program has to be *well-formed* Tix: `m[j]` where `m`'s axis is `N` and `j` is `K` is an extent error,
    so the refusal tests use square shapes or explicit annotations;
  - the assertion that fusion does not change the program was wrong as written: `optimizeTix` does change revisions
    (that is its job). Replaced by "the optimized program still fuses into the same number of kernels";
  - a producer read twice is **not** refused by the row policy — it stages the value once and both reads share it, so
    `p[i]=x[i]*2; y[i]=p[i]+p[i]` is one row kernel. The flat policy's single-use rule only shows when staging is
    impossible (a transposed read, say).
- `tests/tensor/cuda-gpu.test.mjs` passes unchanged with fusion on by default (11 tests): shadowing, empty reductions,
  empty outputs, intrinsic edges, a direct parameter return, and both stage-1 mutants.
- `tests/tensor/cuda-fused-gpu.test.mjs` (new): the fused lowering of every corpus program is accepted as exact on the
  original and the optimized revision with one kernel; the four reduction programs are word-equal to the interpreter
  at shapes the contract does not sample (softmax 5 × 300, layernorm 3 × 40, attention 4 × 6 × 8 × 5, mlp 3 × 6 × 9 ×
  4); an empty extra axis, an empty row set and a one-lane row; and `benchmark: true` under both lowerings.

## 8. Random programs

`scripts/05-fuzz-random-programs.mjs`. The first generator crashed (`Cannot read properties of undefined`) because its
defined-tensor list started empty while the parameters were not in it, and its replacement produced mostly
non-fusable programs (each statement read the parameters, so no producer/consumer pairs existed). Biasing reads
towards the just-defined statement fixed that. Result: 11 programs, `1 → 1`, `2 → 2`, `3 → 1`, `4 → 1` kernels,
**198 of 198 cases identical in f32 words** against the interpreter, with stage 2 identical too. Four generated
programs were rejected by the front end ("Cannot infer extent") before reaching any lowering.

## 9. Measurement

`scripts/06-benchmark-and-traffic.mjs` (benchmark runs take the tool's `--timed` lock; twelve short invocations).
First version had a stub in the stage-phase traffic (it counted a slot as nothing); fixed by counting the staged row
once per block and adding a compulsory-traffic column, because the issued count for matmul, conv2d, mlp and attention
is dominated by re-reads of L2-resident tensors and its 244 GB/s floor is far above the measured time. Two full
passes; the numbers are in the report.

`scripts/07-fusion-ledger.mjs` prints the plan of every corpus program (phases, slots, staged and inlined sets) — the
report's fusion table is that output.

## 10. Formatting

`npx prettier --write src/tensor/fusion.ts src/tensor/cuda-source.ts`. `cuda-source.ts` was prettier-clean at the
base commit (checked with `git show f706115:… | npx prettier --check --stdin-filepath …`), so reformatting it is
allowed; `fusion.ts` is new. Rebuilt and re-ran the fusion and CUDA tests afterwards: 17 pass.
