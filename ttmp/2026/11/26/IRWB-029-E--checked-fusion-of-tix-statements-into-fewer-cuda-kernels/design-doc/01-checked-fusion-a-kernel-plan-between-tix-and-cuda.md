---
Title: 'Checked fusion: a kernel plan between Tix and CUDA'
Ticket: IRWB-029-E
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Fusion is decided as a kernel plan, a second v6 artifact between Tix and CUDA, whose validator is the legality check. Two fusions (inline at an injective top-level read, and a block per row with rows staged in shared memory) and what they refuse.
LastUpdated: 2026-11-26T23:13:19.608712511-05:00
WhatFor: ""
WhenToUse: ""
---

# Checked fusion: a kernel plan between Tix and CUDA

## Domain

The input is a function of a `TixProgram` revision that stage 2 lowers: the fixed core, and the `blocks` and `tail` extents that `split-sum` produces. Inputs are finite f32 tensors with in-bounds reads, on the GB10. Fusion changes neither the accepted programs nor the accepted sizes. `fuse: false` gives stage 2's source text, byte for byte (a test compares hashes recorded from the base by `scripts/01`).

## Where fusion lives

Fusion is a **kernel plan**: a second v6 artifact (`tensor.kernels`) between the Tix artifact and the CUDA source.

```ts
interface KernelPlan {
  fn: Fn;                 // the Tix function, unchanged
  inlined: string[];      // statements that have no kernel: substituted into their readers
  kernels: Kernel[];      // in statement order
}
type Kernel =
  | { mapping: 'element'; statement: string }                    // stage 2: one thread per output element
  | { mapping: 'row'; outer: number; statements: string[] };     // one block per row
```

- **The legality check is the plan IR's validator.** `createArtifact` runs it, so a plan that breaks a rule below cannot exist as an artifact. The planner proposes greedily and asks the same function, so there is one statement of the rules. The rules read only the Tix function inside the plan.
- **The emitter prints a plan.** Stage 2's lowering is the plan with nothing inlined and one element kernel per statement, so there is one emitter for both values of `fuse`.
- **`tensor.lower-cuda`** gets a `fuse` input and a `plan` output, and returns a correspondence from the Tix entities to the plan's kernels. Its `ensures` is the existing exact GPU invariant.

Alternatives:
- **A pass on the Tix IR** is the simplest for elementwise chains and epilogues: they are substitutions, and stage 1's `inline` is one. It falls short for row reductions. `softmax`'s `m[i]` is read by `e[i,j]` for every `j`; in Tix the only way to merge them is to substitute the reduction into each element, which repeats it `C` times. What has to be said is "these four statements share a block and `m[i]` is computed once in it", and Tix has no word for a block.
- **The emitter alone** would work, and is less code. Then the decision exists only as text in CUDA: nothing can validate it before emission, count kernels without parsing, or relate statements to kernels. The plan costs one small type and a validator.

## The two fusions

Both keep each element's expression tree as the meaning has it. Every reduction is still one thread's loop in the meaning's order with `__fadd_rn` or the max step; only *which* thread evaluates a tree and *where* an intermediate value is stored (a register, shared memory) change. Storing and loading an f32 is exact, so no result bit can change.

**1. Inline (elementwise chains, epilogues).** Statement `p` is inlined when every read of `p` in the function
- is outside any reduction of its reader `c`, and
- has as indices a permutation of all of `c`'s own axes (so each element of `c` reads a different element of `p`),
- and, if `p` (after its own inlining) contains a reduction, all reads are in one statement with one index tuple.

`p` is not the result. The thread mapping is unchanged. The emitter evaluates an inlined statement once per element (equal subtrees outside loops share a temporary; this sharing is on only when a plan inlines something, so stage 2's text is unchanged).
*Simplest alternative:* stage 1's `inline` rule (pointwise, one use). It refuses `mlp`'s `h`, which has a reduction and is read five times at the same index.

**2. Rows (row reductions with producers and consumers).** A run of consecutive statements, at least two, becomes one kernel with a block per row. With `outer = r`:
- every statement has rank `r` (a *row scalar*) or `r + 1` (a *row vector*), and the same first `r` dimensions;
- every read of another statement of the run has the reader's own first `r` axes as its first `r` indices (it reads its own row); the last index is free;
- every statement after the first reads at least one earlier statement of the run.

The planner tries `r = rank` and `r = rank − 1` for the first statement and keeps the longer run. Per block: a row vector is computed by all threads of the block (thread `t` takes elements `t, t + B, …`) into a staged buffer; a row scalar is computed by thread 0 and stored in the staged area. `__syncthreads()` separates the steps. Reductions inside a statement run in the evaluating thread exactly as in stage 2.
- **Thread mapping change, and why:** a row scalar is computed once per row and read by every element of the row, which needs the row's threads in one block.
- **Staging:** an outside tensor's row is copied to the staged area when a row scalar reads it (thread 0 would otherwise walk global memory alone). A vector reuses the slot of a vector that dies at that step if it reads it only at its own position (`e` over `x`, `weight` over `e` over `score`).
- **Long rows:** staged bytes above 48 KB (the launch limit without opting in; probe 03: 49152 accepted, 49156 refused) go to a global scratch buffer instead, same kernel, selected by one pointer. So no size is refused.
*Simplest alternative:* keep stage 2's mapping and substitute; refused above. *Rows per block > 1* (several folds in one warp): probe 03 measured no gain (0.44 to 0.46 ms for 1, 2, 4, 8 rows at their best block size), so one row per block.

Measured before the design (softmax 4096 × 1024, probes 02 to 05): the fused kernel is bit-identical to stage 2's four; 0.41 to 0.46 ms against 0.80 ms. The floor is the double-precision `exp` (stage 2's `e` kernel alone is 0.37 ms), not memory. `minmax`'s branches made the max fold cost ten sum folds; writing the same step with selects gives 0.49 → 0.41 ms at 128 threads, so row kernels use that form.

**Threads per block** is one constant, chosen by benchmark over the four fused corpus programs (reported).

## Refused, with reasons

- A read inside a reduction (`e` into `s`, `weight` into `out`): substitution would evaluate the producer once per term. Rows handle it when the read is in the same row.
- A reduction read by more than one statement or broadcast (`m[i]` into `e[i,j]`): substitution would repeat the reduction.
- Rows whose key is not the leading axes (a column normalisation), reads of another row (a transpose), non-adjacent statements, statements with no dependence.
- A lone statement keeps stage 2's mapping (`matmul`, `conv2d`, a lone row reduction): nothing is fused, so nothing changes.

## Contract

`checkLowering(program, fn, { fuse })` runs the existing differential invariant on the fused source: the f32 meaning's result against the GPU's, bit for bit, NaN as a class. Two additions, both because the stage-2 cases cannot reach code the fused kernels have:
- **Long-row cases:** for each shape symbol, one assignment with that symbol at `B + 3` and the others at 2, so a thread takes a second element and the last stride is partial.
- **Spilled rows:** when the plan has a row kernel, the batch runs a second time with `--spill`, which forces the scratch path; a case agrees only if both runs agree.

## API

`cudaSource`, `runTixCuda`, `checkLowering` take `fuse` (default `true`); `runTixCuda` takes `benchmark` and passes it to `runCudaBatch`. `emitCuda(fn)` stays and is the unfused plan's source.

## Framework and tool

Expected: none in `tools/cuda-remote.mjs` (program arguments already pass through). In the framework, the open question is whether a transformation's correspondence can relate Tix entities to kernels of another IR kind (many to one); the implementation will show it and the report will say.

## Left out

- Row mapping for a lone row reduction, and staging of reduction bodies that are not a plain row read (they run in thread 0's loop): no corpus program needs them.
- Row keys other than the leading axes.

## Later

- Staging `blocks`/`tail` reductions (after `split-sum` thread 0 reads staged rows through the split loops; correct, not tuned).
- Choosing threads per block per kernel from runtime sizes.
